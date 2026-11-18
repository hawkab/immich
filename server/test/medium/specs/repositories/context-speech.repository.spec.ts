import { Kysely } from 'kysely';
import { AssetType, AssetVisibility } from 'src/enum.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { transcriptTextChecksum } from 'src/utils/transcript-search.js';
import { TRANSCRIPT_KEY } from 'src/utils/transcription.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let database: Kysely<DB>;
beforeAll(async () => {
  database = await getKyselyDB();
});

const setup = async () => {
  const { ctx } = newMediumService(BaseService, {
    database,
    real: [AssetRepository, AssetJobRepository, SearchRepository],
    mock: [LoggingRepository],
  });
  const search = ctx.get(SearchRepository);
  const assets = ctx.get(AssetRepository);
  const { user } = await ctx.newUser();
  const make = async (text: string, properties: Record<string, unknown> = {}) => {
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
    return asset;
  };
  const searchFor = (query: string, options: Record<string, unknown> = {}) =>
    search.searchSmartV3(
      { take: 100 },
      {
        embedding: '',
        transcriptQuery: query,
        transcriptOnly: true,
        filter: { visibility: { ne: AssetVisibility.Locked }, trashedAt: { eq: null } },
        ...options,
      },
      { userIds: [user.id], viewingUserId: user.id, lockedOwnerId: user.id },
    );
  return { ctx, search, assets, user, make, searchFor };
};

it('finds misspellings and reordered inflections without losing query terms', async () => {
  const { make, searchFor } = await setup();
  const target = await make('Мы обсуждали путешествие на Камчатку и вулканы');
  await make('На Камчатке продают вкусную рыбу');
  await make('Завтра идём к доктору');
  for (const query of ['Камчатка вулканы', 'вулканы Камчатка', 'путешествеи Камчатку', 'вулканы Камчтка']) {
    const result = await searchFor(query);
    expect(
      result.items.map((row) => row.id),
      query,
    ).toEqual([target.id]);
  }
  const unrelated = await searchFor('Камчатка самолёт');
  expect(unrelated.items).toHaveLength(0);
  const quoted = await searchFor('"Камчатка вулканы"');
  expect(quoted.items).toHaveLength(0);
});

it('combines semantic, fuzzy and literal evidence while rejecting stale, incompatible and unrelated vectors', async () => {
  const { make, searchFor, search, assets } = await setup();
  const semantic = await make('Завтра пойдём к доктору');
  const exact = await make('Завтра идём к врачу');
  const irrelevant = await make('На улице идёт дождь');
  const stale = await make('Устаревшая запись');
  const changed = await make('Обновлённая расшифровка');
  const wrongModel = await make('Чужая модель');
  const wrongDimension = await make('Несовместимое пространство');
  const hidden = await make('Доктор', { visibility: AssetVisibility.Locked });
  const trashed = await make('Доктор', { deletedAt: new Date() });
  const { ctx } = await setup();
  const { user: stranger } = await ctx.newUser();
  const forbidden = await make('Доктор', { ownerId: stranger.id });
  for (const asset of [semantic, irrelevant, stale, changed, wrongModel, wrongDimension, hidden, trashed, forbidden]) {
    const metadata = await assets.getMetadataByKey(asset.id, TRANSCRIPT_KEY);
    await search.upsertTranscriptSearch({
      assetId: asset.id,
      part: 0,
      partCount: 1,
      sourceChecksum: asset === stale ? 'old-source' : asset.checksum.toString('base64'),
      configuration: 'fixture',
      modelName: asset === wrongModel ? 'different-model' : 'fixture-model',
      textChecksum: asset === changed ? 'old-text' : transcriptTextChecksum(String(metadata!.value.text)),
      contentChecksum: 'fixture',
      embedding: asset === wrongDimension ? '[1,0,0]' : asset === irrelevant ? '[0,1]' : '[1,0]',
    });
  }
  const result = await searchFor('врач', { embedding: '[1,0]', transcriptModel: 'fixture-model' });
  expect(result.items.map((row) => row.id)).toEqual([exact.id, semantic.id]);
  const context = await searchFor('врач', {
    embedding: '[1,0]',
    transcriptModel: 'fixture-model',
    transcriptOnly: false,
  });
  expect(context.items.map((row) => row.id)).toEqual([exact.id, semantic.id]);
  const legacy = await search.searchSmart(
    { page: 1, size: 100 },
    {
      userIds: [semantic.ownerId],
      viewingUserId: semantic.ownerId,
      embedding: '[1,0]',
      transcriptModel: 'fixture-model',
      transcriptQuery: 'врач',
      transcriptOnly: true,
      visibility: AssetVisibility.Timeline,
    },
  );
  expect(legacy.items.map((row) => row.id)).toEqual([exact.id, semantic.id]);
});

it('backfills missing or partial indexes without re-transcribing completed audio and removes index rows with their asset', async () => {
  const { make, search, ctx } = await setup();
  const asset = await make('Поедем отдыхать на побережье');
  const jobs = ctx.get(AssetJobRepository);
  const ids = async (model: string) => {
    const values = [];
    for await (const row of jobs.streamForTranscriptSearch(model)) {
      values.push(row.id);
    }
    return values;
  };
  expect(await ids('fixture-model')).toContain(asset.id);
  const row = {
    assetId: asset.id,
    part: 0,
    partCount: 2,
    sourceChecksum: asset.checksum.toString('base64'),
    configuration: 'fixture',
    modelName: 'fixture-model',
    textChecksum: transcriptTextChecksum('Поедем отдыхать на побережье'),
    contentChecksum: 'fixture',
    embedding: '[1,0]',
  };
  await search.upsertTranscriptSearch(row);
  expect(await ids('fixture-model')).toContain(asset.id);
  await search.upsertTranscriptSearch({ ...row, part: 1 });
  expect(await ids('fixture-model')).not.toContain(asset.id);
  expect(await ids('different-model')).toContain(asset.id);
  await database.deleteFrom('asset').where('id', '=', asset.id).execute();
  expect(await search.getTranscriptSearch(asset.id)).toEqual([]);
});
