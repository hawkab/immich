import { Kysely } from 'kysely';
import { AssetType, AssetVisibility } from 'src/enum.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { TRANSCRIPT_KEY } from 'src/utils/transcription.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let database: Kysely<DB>;
beforeAll(async () => {
  database = await getKyselyDB();
});

it('finds spoken words without a visual embedding while retaining ownership, locked, trash, checksum and filter boundaries', async () => {
  const { ctx } = newMediumService(BaseService, {
    database,
    real: [AssetRepository, SearchRepository],
    mock: [LoggingRepository],
  });
  const assets = ctx.get(AssetRepository);
  const search = ctx.get(SearchRepository);
  const { user: owner } = await ctx.newUser();
  const { user: other } = await ctx.newUser();
  const make = async (properties: Record<string, unknown> = {}, checksum?: string) => {
    const { asset } = await ctx.newAsset({ ownerId: owner.id, type: AssetType.Video, ...properties });
    await assets.upsertMetadata(asset.id, [
      {
        key: TRANSCRIPT_KEY,
        value: {
          schemaVersion: 1,
          sourceChecksum: checksum ?? asset.checksum.toString('base64'),
          status: 'complete',
          text: 'Мы обсуждали путешествие на Камчатку и вулканы',
        },
      },
    ]);
    return asset;
  };
  const allowed = await make();
  const stranger = await make({ ownerId: other.id });
  const locked = await make({ visibility: AssetVisibility.Locked });
  const trashed = await make({ deletedAt: new Date() });
  const stale = await make({}, 'not-the-current-source');
  const photo = await make({ type: AssetType.Image });
  const scope = { userIds: [owner.id], lockedOwnerId: owner.id, viewingUserId: owner.id };
  const options = {
    embedding: '',
    transcriptQuery: 'Камчатка вулкан',
    transcriptOnly: true,
    filter: { visibility: { ne: AssetVisibility.Locked }, trashedAt: { eq: null } },
  };
  const rows = await search.searchSmartV3({ take: 100 }, options, scope);
  expect(rows.items.map((asset) => asset.id)).toContain(allowed.id);
  for (const [name, asset] of Object.entries({ stranger, locked, trashed, stale, photo })) {
    expect(
      rows.items.map((row) => row.id),
      name,
    ).not.toContain(asset.id);
  }
  const wrong = await search.searchSmartV3({ take: 100 }, { ...options, transcriptQuery: 'самолёт' }, scope);
  expect(wrong.items).toHaveLength(0);
  const filtered = await search.searchSmartV3(
    { take: 100 },
    { ...options, filter: { type: { eq: AssetType.Image } } },
    scope,
  );
  expect(filtered.items).toHaveLength(0);
});

it('applies the real search service permissions in legacy and structured speech-only searches', async () => {
  const { SearchService } = await import('src/services/search.service.js');
  const { AccessRepository } = await import('src/repositories/access.repository.js');
  const { PartnerRepository } = await import('src/repositories/partner.repository.js');
  const { defaults } = await import('src/dtos/config.dto.js');
  const { factory } = await import('test/small.factory.js');
  const { sut, ctx } = newMediumService(SearchService, {
    database,
    real: [AssetRepository, SearchRepository, AccessRepository, PartnerRepository],
    mock: [LoggingRepository],
  });
  const config = structuredClone(defaults);
  config.machineLearning.transcription.enabled = true;
  config.machineLearning.clip.enabled = false;
  Object.assign(sut, { getConfig: () => Promise.resolve(config) });
  const { user: owner } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: owner.id, type: AssetType.Video });
  await ctx.get(AssetRepository).upsertMetadata(asset.id, [
    {
      key: TRANSCRIPT_KEY,
      value: {
        schemaVersion: 1,
        sourceChecksum: asset.checksum.toString('base64'),
        status: 'complete',
        text: 'Экспедиция на Камчатку',
      },
    },
  ]);
  const auth = factory.auth({ user: { id: viewer.id } });
  for (const extra of [{}, { filter: { trashedAt: { eq: null } } }]) {
    const result = await sut.searchSmart(auth, { size: 100, query: 'речь: экспедиция', ...extra });
    expect(result.assets.items).toHaveLength(0);
  }
  await database
    .insertInto('partner')
    .values({ sharedById: owner.id, sharedWithId: viewer.id, inTimeline: true })
    .execute();
  for (const extra of [{}, { filter: { trashedAt: { eq: null } } }]) {
    const result = await sut.searchSmart(auth, { size: 100, query: 'речь: экспедиция', ...extra });
    expect(result.assets.items.map((row) => row.id)).toEqual([asset.id]);
  }
  await database.deleteFrom('partner').where('sharedWithId', '=', viewer.id).execute();
  const revoked = await sut.searchSmart(auth, { size: 100, query: 'речь: экспедиция' });
  expect(revoked.assets.items).toHaveLength(0);
});
