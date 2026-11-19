import { sql, type Kysely } from 'kysely';
import { AssetType, AssetVisibility } from 'src/enum.js';
import type { AssetSearchScope } from 'src/repositories/search.repository.js';
import type { DB } from 'src/schema/index.js';
import { searchAssetBuilder } from 'src/utils/database.js';
import type { TranscriptSearchOptions } from 'src/utils/transcript-search.js';
import { TRANSCRIPT_KEY } from 'src/utils/transcription.js';

export const transcriptSearchCenter = async (
  database: Kysely<DB>,
  options: TranscriptSearchOptions & { transcriptQuery?: string },
  scope: AssetSearchScope,
): Promise<string | undefined> => {
  if (
    !options.embedding ||
    !options.transcriptModel ||
    !options.transcriptQuery ||
    /["-]|\bOR\b/iu.test(options.transcriptQuery)
  ) {
    return;
  }
  const row = await searchAssetBuilder(
    database,
    {
      filter: { visibility: { ne: AssetVisibility.Locked }, trashedAt: { eq: null } },
    },
    scope,
  )
    .innerJoin('transcript_search as speech', 'speech.assetId', 'asset.id')
    .innerJoin('asset_metadata as transcript', (join) =>
      join.onRef('transcript.assetId', '=', 'asset.id').on('transcript.key', '=', TRANSCRIPT_KEY),
    )
    .select(sql<string | null>`avg(speech.embedding)::text`.as('center'))
    .where('asset.type', '=', AssetType.Video)
    .where('speech.modelName', '=', options.transcriptModel)
    .where(sql<boolean>`vector_dims(speech.embedding) = vector_dims(${options.embedding}::vector)`)
    .where(
      sql<boolean>`transcript.value->>'schemaVersion' = '1'
      and transcript.value->>'status' in ('complete', 'processing')
      and speech."sourceChecksum" = encode(asset.checksum, 'base64')
      and speech."sourceChecksum" = transcript.value->>'sourceChecksum'
      and speech.configuration = transcript.value->>'configuration'
      and speech."textChecksum" = md5(coalesce(transcript.value->>'text', ''))`,
    )
    .executeTakeFirst();
  return row?.center ?? undefined;
};
