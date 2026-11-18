import { sql, type SqlBool } from 'kysely';
import { transcriptMatches } from 'src/utils/transcription.js';

export const SCENE_DESCRIPTION_KEY = 'org.immich.scene.v1';

/** Match visible-scene facts only while they still describe this source and edit. */
export function sceneDescriptionMatches(query: string, includeDepictions = false) {
  const facts = sql`to_tsvector('russian',
    case scene.value->>'kind'
      when 'photo' then 'фото фотография снимок '
      when 'screenshot' then 'скриншот '
      when 'document' then 'документ '
      when 'drawing' then 'рисунок иллюстрация '
      else ''
    end || coalesce(scene.value->>'searchText', ''))`;
  const evidence = includeDepictions
    ? facts
    : sql`ts_delete(${facts},
    tsvector_to_array(to_tsvector('russian', coalesce(scene.value->>'depictedText', ''))))`;
  return sql<SqlBool>`exists (
    select 1 from asset_metadata scene
    where scene."assetId" = asset.id
      and scene.key = ${SCENE_DESCRIPTION_KEY}
      and scene.value->>'schemaVersion' = '1'
      and scene.value->>'sourceChecksum' = encode(asset.checksum, 'base64')
      and coalesce(scene.value->>'thumbhash', '') = coalesce(encode(asset.thumbhash, 'base64'), '')
      and coalesce(scene.value->>'isEdited', 'false') = asset."isEdited"::text
      and ${evidence} @@ websearch_to_tsquery('russian', ${query})
  )`;
}

export const smartSearchEvidence = (options: {
  embedding: string;
  transcriptQuery?: string;
  transcriptOnly?: boolean;
  sceneQuery?: string;
  includeDepictions?: boolean;
  minSimilarity?: number | null;
}) => {
  const speech = options.transcriptQuery ? transcriptMatches(options.transcriptQuery) : sql<SqlBool>`false`;
  if (options.transcriptOnly) {
    return speech;
  }
  const scene = options.sceneQuery
    ? sceneDescriptionMatches(options.sceneQuery, options.includeDepictions)
    : sql<SqlBool>`true`;
  const threshold =
    typeof options.minSimilarity === 'number'
      ? sql<SqlBool>`smart_search.embedding <=> ${options.embedding} <= ${1 - options.minSimilarity}`
      : sql<SqlBool>`true`;
  return sql<SqlBool>`((smart_search."assetId" is not null and ${scene} and ${threshold}) or ${speech})`;
};
