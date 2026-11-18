import { AssetStatus, AssetType, AssetVisibility } from 'src/enum.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { VideoCompressionRepository } from 'src/repositories/video-compression.repository.js';
import { VideoCompressionService } from 'src/services/video-compression.service.js';
import { compressionPath, type CompressionDraft } from 'src/utils/video-compression.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

const setup = async () => {
  const { ctx } = newMediumService(VideoCompressionService, {
    database: await getKyselyDB(),
    mock: [LoggingRepository],
    real: [AssetRepository, VideoCompressionRepository],
  });
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({
    ownerId: user.id,
    type: AssetType.Video,
    status: AssetStatus.Active,
    libraryId: null,
  });
  await ctx.database.updateTable('user').set({ quotaUsageInBytes: 1000 }).where('id', '=', user.id).execute();
  await ctx.database
    .insertInto('asset_exif')
    .values({ assetId: asset.id, fileSizeInByte: 1000 })
    .onConflict((oc) => oc.column('assetId').doUpdateSet({ fileSizeInByte: 1000 }))
    .execute();
  const requestId = factory.uuid();
  const draft: CompressionDraft = {
    requestId,
    actorId: user.id,
    sourceChecksum: asset.checksum.toString('base64'),
    sourcePath: asset.originalPath,
    outputPath: compressionPath(asset.originalPath, requestId),
    quality: 55,
    status: 'queued',
    originalSize: 1000,
    cleanup: [],
  };
  return { ctx, repo: ctx.get(VideoCompressionRepository), asset, user, draft };
};

describe('durable video compression transactions', () => {
  it('uses the native shared-edit visibility policy again when saving', async () => {
    const { ctx, repo, asset, user, draft } = await setup();
    const { user: editor } = await ctx.newUser();
    await ctx.database
      .insertInto('partner')
      .values({ sharedById: user.id, sharedWithId: editor.id, canEdit: true })
      .execute();
    await repo.create(asset.id, editor.id, { ...draft, actorId: editor.id });
    await repo.update(
      asset.id,
      draft.requestId,
      { status: 'ready', compressedSize: 100, outputChecksum: Buffer.alloc(20, 3).toString('base64') },
      ['queued'],
    );
    await ctx.database
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Locked })
      .where('id', '=', asset.id)
      .execute();
    expect(await repo.commit(asset.id, editor.id, draft.requestId, draft.sourceChecksum)).toBe(false);
    const current = await ctx.database
      .selectFrom('asset')
      .select('originalPath')
      .where('id', '=', asset.id)
      .executeTakeFirstOrThrow();
    expect(current.originalPath).toBe(asset.originalPath);
  });
  it('inherits the edit grant and charges only the video owner after partner confirmation', async () => {
    const { ctx, repo, asset, user, draft } = await setup();
    const { user: editor } = await ctx.newUser();
    await ctx.database.updateTable('user').set({ quotaUsageInBytes: 500 }).where('id', '=', editor.id).execute();
    await ctx.database
      .insertInto('partner')
      .values({ sharedById: user.id, sharedWithId: editor.id, canEdit: true, canDelete: false })
      .execute();
    expect(await repo.create(asset.id, editor.id, { ...draft, actorId: editor.id })).toBe(true);
    await repo.update(
      asset.id,
      draft.requestId,
      { status: 'ready', compressedSize: 100, outputChecksum: Buffer.alloc(20, 3).toString('base64') },
      ['queued'],
    );
    expect(await repo.commit(asset.id, editor.id, draft.requestId, draft.sourceChecksum)).toBe(true);
    const owner = await ctx.database
      .selectFrom('user')
      .select('quotaUsageInBytes')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    const actor = await ctx.database
      .selectFrom('user')
      .select('quotaUsageInBytes')
      .where('id', '=', editor.id)
      .executeTakeFirstOrThrow();
    expect(Number(owner.quotaUsageInBytes)).toBe(100);
    expect(Number(actor.quotaUsageInBytes)).toBe(500);
  });

  it('rechecks the edit grant at save and allows the owner to finish a revoked partner draft', async () => {
    const { ctx, repo, asset, user, draft } = await setup();
    const { user: editor } = await ctx.newUser();
    await ctx.database
      .insertInto('partner')
      .values({ sharedById: user.id, sharedWithId: editor.id, canEdit: false })
      .execute();
    expect(await repo.create(asset.id, editor.id, { ...draft, actorId: editor.id })).toBe(false);
    await ctx.database
      .updateTable('partner')
      .set({ canEdit: true })
      .where('sharedById', '=', user.id)
      .where('sharedWithId', '=', editor.id)
      .execute();
    expect(await repo.create(asset.id, editor.id, { ...draft, actorId: editor.id })).toBe(true);
    await repo.update(
      asset.id,
      draft.requestId,
      { status: 'ready', compressedSize: 100, outputChecksum: Buffer.alloc(20, 3).toString('base64') },
      ['queued'],
    );
    await ctx.database
      .updateTable('partner')
      .set({ canEdit: false })
      .where('sharedById', '=', user.id)
      .where('sharedWithId', '=', editor.id)
      .execute();
    expect(await repo.commit(asset.id, editor.id, draft.requestId, draft.sourceChecksum)).toBe(false);
    const current = await ctx.database
      .selectFrom('asset')
      .select('originalPath')
      .where('id', '=', asset.id)
      .executeTakeFirstOrThrow();
    expect(current.originalPath).toBe(asset.originalPath);
    expect(await repo.commit(asset.id, user.id, draft.requestId, draft.sourceChecksum)).toBe(true);
  });
  it('rejects output from a superseded worker after a recovered lease', async () => {
    const { repo, asset, user, draft } = await setup();
    await repo.create(asset.id, user.id, draft);
    const first = factory.uuid();
    const recovered = factory.uuid();
    await repo.update(asset.id, draft.requestId, { status: 'processing', producerId: first }, ['queued']);
    await repo.update(asset.id, draft.requestId, { producerId: recovered }, ['processing']);
    expect(await repo.update(asset.id, draft.requestId, { status: 'ready' }, ['processing'], first)).toBe(false);
    expect(await repo.update(asset.id, draft.requestId, { status: 'ready' }, ['processing'], recovered)).toBe(true);
  });
  it('serializes competing previews and keeps the source untouched', async () => {
    const { ctx, repo, asset, user, draft } = await setup();
    const results = await Promise.all([
      repo.create(asset.id, user.id, draft),
      repo.create(asset.id, user.id, { ...draft, requestId: factory.uuid() }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const row = await ctx.database.selectFrom('asset').selectAll().where('id', '=', asset.id).executeTakeFirstOrThrow();
    expect(row.checksum).toEqual(asset.checksum);
    expect(row.originalPath).toBe(asset.originalPath);
  });

  it('reconciles an identical creation without overwriting progress', async () => {
    const { repo, asset, user, draft } = await setup();
    expect(await repo.create(asset.id, user.id, draft)).toBe(true);
    await repo.update(asset.id, draft.requestId, { status: 'processing' }, ['queued']);
    expect(await repo.create(asset.id, user.id, draft)).toBe(true);
    const current = await repo.get(asset.id);
    expect(current?.status).toBe('processing');
    expect(await repo.create(asset.id, user.id, { ...draft, quality: 99 })).toBe(false);
  });

  it('rejects ownership, source and state conflicts', async () => {
    const { ctx, repo, asset, user, draft } = await setup();
    expect(await repo.create(asset.id, factory.uuid(), draft)).toBe(false);
    expect(await repo.create(asset.id, user.id, { ...draft, sourcePath: '/other' })).toBe(false);
    expect(
      await repo.create(asset.id, user.id, { ...draft, sourceChecksum: Buffer.alloc(20, 7).toString('base64') }),
    ).toBe(false);
    await ctx.database.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', asset.id).execute();
    expect(await repo.create(asset.id, user.id, draft)).toBe(false);
  });

  it('atomically replaces one confirmed version, updates usage once and preserves dates', async () => {
    const { ctx, repo, asset, user, draft } = await setup();
    await repo.create(asset.id, user.id, draft);
    await repo.update(
      asset.id,
      draft.requestId,
      { status: 'ready', compressedSize: 100, outputChecksum: Buffer.alloc(20, 3).toString('base64') },
      ['queued'],
    );
    expect(await repo.commit(asset.id, user.id, draft.requestId, draft.sourceChecksum)).toBe(true);
    expect(await repo.commit(asset.id, user.id, draft.requestId, draft.sourceChecksum)).toBe(true);
    const row = await ctx.database.selectFrom('asset').selectAll().where('id', '=', asset.id).executeTakeFirstOrThrow();
    const owner = await ctx.database
      .selectFrom('user')
      .select('quotaUsageInBytes')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(row.originalPath).toBe(draft.outputPath);
    expect(row.checksum).toEqual(Buffer.alloc(20, 3));
    expect(row.fileCreatedAt).toEqual(asset.fileCreatedAt);
    expect(row.localDateTime).toEqual(asset.localDateTime);
    expect(Number(owner.quotaUsageInBytes)).toBe(100);
    const current = await repo.get(asset.id);
    expect(current?.cleanup).toContain(asset.originalPath);
  });

  it('does not replace a source changed after preview creation', async () => {
    const { ctx, repo, asset, user, draft } = await setup();
    await repo.create(asset.id, user.id, draft);
    await repo.update(
      asset.id,
      draft.requestId,
      { status: 'ready', compressedSize: 100, outputChecksum: Buffer.alloc(20, 3).toString('base64') },
      ['queued'],
    );
    await ctx.database
      .updateTable('asset')
      .set({ checksum: Buffer.alloc(20, 5) })
      .where('id', '=', asset.id)
      .execute();
    expect(await repo.commit(asset.id, user.id, draft.requestId, draft.sourceChecksum)).toBe(false);
    const currentAsset = await ctx.database
      .selectFrom('asset')
      .select('originalPath')
      .where('id', '=', asset.id)
      .executeTakeFirstOrThrow();
    expect(currentAsset.originalPath).toBe(asset.originalPath);
  });

  it('does not accept a canceled or superseded preview', async () => {
    const { repo, asset, user, draft } = await setup();
    await repo.create(asset.id, user.id, draft);
    await repo.update(asset.id, draft.requestId, { status: 'discarded' }, ['queued']);
    expect(await repo.commit(asset.id, user.id, draft.requestId, draft.sourceChecksum)).toBe(false);
    expect(await repo.update(asset.id, draft.requestId, { status: 'ready' }, ['processing'])).toBe(false);
    expect(await repo.create(asset.id, user.id, { ...draft, requestId: factory.uuid() })).toBe(true);
    expect(await repo.update(asset.id, draft.requestId, { status: 'ready' }, ['queued'])).toBe(false);
  });

  it('cannot forge filesystem control state through ordinary asset metadata', async () => {
    const { ctx, repo, asset, user, draft } = await setup();
    await repo.create(asset.id, user.id, draft);
    await ctx.get(AssetRepository).upsertMetadata(asset.id, [
      {
        key: 'org.immich.video-compression.v1',
        value: { ...draft, outputPath: '/private', status: 'ready' },
      },
    ]);
    const current = await repo.get(asset.id);
    expect(current?.outputPath).toBe(draft.outputPath);
    expect(await repo.commit(asset.id, user.id, draft.requestId, draft.sourceChecksum)).toBe(false);
  });

  it('rolls back pointer, quota and preview state together if the output collides', async () => {
    const { ctx, repo, asset, user, draft } = await setup();
    const checksum = Buffer.alloc(20, 7);
    await ctx.newAsset({ ownerId: user.id, checksum, libraryId: null });
    await repo.create(asset.id, user.id, draft);
    await repo.update(
      asset.id,
      draft.requestId,
      { status: 'ready', compressedSize: 100, outputChecksum: checksum.toString('base64') },
      ['queued'],
    );
    await expect(repo.commit(asset.id, user.id, draft.requestId, draft.sourceChecksum)).rejects.toThrow();
    const row = await ctx.database.selectFrom('asset').selectAll().where('id', '=', asset.id).executeTakeFirstOrThrow();
    const owner = await ctx.database
      .selectFrom('user')
      .select('quotaUsageInBytes')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(row.originalPath).toBe(asset.originalPath);
    expect(row.checksum).toEqual(asset.checksum);
    expect(Number(owner.quotaUsageInBytes)).toBe(1000);
    const current = await repo.get(asset.id);
    expect(current?.status).toBe('ready');
  });
});
