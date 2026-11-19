import { sql, type SqlBool } from 'kysely';
import { createHash } from 'node:crypto';
import { TRANSCRIPT_KEY, type Transcript } from 'src/utils/transcription.js';

export type TranscriptSearchOptions = {
  embedding: string;
  transcriptModel?: string;
  transcriptMinSimilarity?: number;
};

export const transcriptTextChecksum = (text: string) => createHash('md5').update(text).digest('hex');

export const transcriptSearchParts = (transcript: Transcript) => {
  const parts: { text: string; start: number; end: number }[] = [];
  for (const segment of transcript.segments) {
    for (const sentence of segment.text.split(/(?<=[.!?])\s+|\n+/u)) {
      const words = sentence.trim().split(/\s+/u).filter(Boolean);
      for (let start = 0; start < words.length; start += 9) {
        parts.push({ text: words.slice(start, start + 12).join(' '), start: segment.start, end: segment.end });
        if (start + 12 >= words.length) {
          break;
        }
      }
    }
  }
  return parts;
};

export const transcriptSearchTexts = (transcript: Transcript) =>
  transcriptSearchParts(transcript).map(({ text }) => text);

export const transcriptLexicalMatch = (query: string) => sql<SqlBool>`(
  to_tsvector('russian', coalesce(transcript.value->>'text', '')) @@ websearch_to_tsquery('russian', ${query})
  or to_tsvector('simple', coalesce(transcript.value->>'text', '')) @@ websearch_to_tsquery('simple', ${query})
)`;

export const transcriptFuzzyMatch = (query: string) => {
  if (/["-]|\bOR\b/iu.test(query)) {
    return sql<SqlBool>`false`;
  }
  const words = sql`tsvector_to_array(to_tsvector('russian', ${query}))`;
  return sql<SqlBool>`cardinality(${words}) > 0 and not exists (
    select 1 from unnest(${words}) term
    where not (lower(coalesce(transcript.value->>'text', '')) %> term)
  )`;
};

export const transcriptSearchScore = (query: string, options: TranscriptSearchOptions) => {
  if (!query.trim()) {
    return sql<{
      score: number;
    }>`select 0 as score, null::jsonb as segments, null::integer as part, null::jsonb as segment`;
  }
  const semantic =
    options.embedding && options.transcriptModel && !/["-]|\bOR\b/iu.test(query)
      ? sql`select case when vector_dims(speech.embedding) = vector_dims(${options.embedding}::vector)
        then 1 - (speech.embedding <=> ${options.embedding}::vector) end as similarity, speech.part
      from transcript_search speech
      where speech."assetId" = asset.id
        and speech."sourceChecksum" = transcript.value->>'sourceChecksum'
        and speech.configuration = transcript.value->>'configuration'
        and speech."modelName" = ${options.transcriptModel}
        and speech."textChecksum" = md5(coalesce(transcript.value->>'text', ''))
      order by similarity desc nulls last, speech.part limit 1`
      : sql`select 0::double precision as similarity, null::integer as part`;
  const score = sql`greatest(
    case when ${transcriptLexicalMatch(query)} then 3
      when ${transcriptFuzzyMatch(query)} then 2 else 0 end,
    case when semantic.similarity >= ${options.transcriptMinSimilarity ?? 0.85} then semantic.similarity else 0 end
  )`;
  return sql<{ score: number }>`select ${score} as score, semantic.part,
    case when ${score} > 0 then transcript.value->'segments' end as segments,
    (select segment.value from jsonb_array_elements(case when jsonb_typeof(transcript.value->'segments') = 'array' then transcript.value->'segments' else '[]'::jsonb end) with ordinality segment(value, position)
     order by ts_rank_cd(to_tsvector('russian', coalesce(segment.value->>'text', '')), websearch_to_tsquery('russian', ${query})) desc,
       word_similarity(lower(${query}), lower(coalesce(segment.value->>'text', ''))) desc, segment.position limit 1) as segment
  from asset_metadata transcript
  left join lateral (${semantic}) semantic on true
  where asset.type = 'VIDEO' and transcript."assetId" = asset.id and transcript.key = ${TRANSCRIPT_KEY}
    and transcript.value->>'schemaVersion' = '1'
    and transcript.value->>'sourceChecksum' = encode(asset.checksum, 'base64')
    and transcript.value->>'status' in ('complete', 'processing')`;
};
