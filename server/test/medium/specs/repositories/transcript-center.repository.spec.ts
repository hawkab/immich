import { Kysely } from 'kysely';
import { AssetType, AssetVisibility } from 'src/enum.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { transcriptSearchCenter } from 'src/utils/transcript-search-center.js';
import { transcriptTextChecksum } from 'src/utils/transcript-search.js';
import { TRANSCRIPT_KEY } from 'src/utils/transcription.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let database: Kysely<DB>;
beforeAll(async () => {
  database = await getKyselyDB();
});

it('removes a shared embedding direction without losing synonyms or including inaccessible calibration data', async () => {
  const { ctx } = newMediumService(BaseService, {
    database,
    real: [AssetRepository, SearchRepository],
    mock: [LoggingRepository],
  });
  const assets = ctx.get(AssetRepository);
  const search = ctx.get(SearchRepository);
  const { user } = await ctx.newUser();
  const { user: stranger } = await ctx.newUser();
  const make = async (text: string, embedding: string, properties: Record<string, unknown> = {}, stale = false) => {
    const { asset } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video, ...properties });
    await assets.upsertMetadata(asset.id, [
      {
        key: TRANSCRIPT_KEY,
        value: {
          schemaVersion: 1,
          sourceChecksum: asset.checksum.toString('base64'),
          configuration: 'fixture',
          status: 'complete',
          text,
        },
      },
    ]);
    await search.upsertTranscriptSearch({
      assetId: asset.id,
      part: 0,
      partCount: 1,
      sourceChecksum: stale ? 'old' : asset.checksum.toString('base64'),
      configuration: 'fixture',
      modelName: 'fixture-model',
      textChecksum: transcriptTextChecksum(text),
      contentChecksum: 'fixture',
      embedding,
    });
    return asset;
  };
  const target = await make('Доктор', '[10,1,0]');
  await make('Лошадка', '[10,0,1]');
  await make('Овечка', '[10,-1,0]');
  await make('Кофе', '[10,0,-1]');
  await make('Чужой доктор', '[100,1,1]', { ownerId: stranger.id });
  await make('Личный доктор', '[100,1,1]', { visibility: AssetVisibility.Locked });
  await make('Удалённый доктор', '[100,1,1]', { deletedAt: new Date() });
  await make('Старая запись', '[100,1,1]', {}, true);
  await make('Другой размер', '[100,1]');
  const options = {
    embedding: '[10,1,0]',
    transcriptQuery: 'врач',
    transcriptModel: 'fixture-model',
    transcriptOnly: true,
  };
  const scope = { userIds: [user.id], viewingUserId: user.id, lockedOwnerId: user.id };
  expect(JSON.parse((await transcriptSearchCenter(database, options, scope))!)).toEqual([10, 0, 0]);
  const modern = await search.searchSmartV3({ take: 100 }, options, scope);
  const legacy = await search.searchSmart(
    { page: 1, size: 100 },
    { ...options, ...scope, visibility: AssetVisibility.Timeline },
  );
  for (const result of [modern, legacy]) {
    expect(result.items.map((row) => row.id)).toEqual([target.id]);
    expect(result.items[0].searchProvenance).toMatchObject({ score: 1, visual: false });
  }
  const explanation = await search.searchSmartV3({ take: 1 }, { ...options, explainAssetId: target.id }, scope);
  expect(explanation.items.map((row) => row.id)).toEqual([target.id]);
});
