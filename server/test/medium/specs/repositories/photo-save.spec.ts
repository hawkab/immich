import { sql, type Kysely } from 'kysely';
import { AssetEditAction, type AssetEditActionItem } from 'src/dtos/editing.dto.js';
import { AssetFileType } from 'src/enum.js';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import type { RenderedPhoto } from 'src/repositories/photo-save.store.js';
import type { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { newUuid } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let database: Kysely<DB>;
beforeAll(async () => {
  database = await getKyselyDB();
});
const edits: AssetEditActionItem[] = [
  {
    action: AssetEditAction.Annotate,
    parameters: { layers: [{ type: 'emoji', emoji: '1f600', x: 0.5, y: 0.5, size: 0.2 }] },
  },
];
const setup = async () => {
  const { ctx } = newMediumService(BaseService, { database, real: [], mock: [LoggingRepository] });
  const { user } = await ctx.newUser({ quotaUsageInBytes: 1000 });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  await ctx.newExif({ assetId: asset.id, fileSizeInByte: 100, dateTimeOriginal: new Date('2020-03-04T05:06:07Z') });
  const sut = ctx.get(AssetEditRepository);
  const requestId = newUuid();
  const output: RenderedPhoto = {
    path: `/images/${requestId}.png`,
    checksum: Buffer.from(newUuid()),
    size: 140,
    width: 80,
    height: 120,
    thumbhash: Buffer.from('same visual hash'),
    files: [
      {
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: `/previews/${requestId}.jpeg`,
        isProgressive: false,
        isTransparent: false,
      },
    ],
  };
  await sut.replaceAll(asset.id, edits, {
    includeAnnotations: true,
    saveOriginal: {
      actorId: user.id,
      requestId,
      sourcePath: asset.originalPath,
      sourceFileChecksum: asset.checksum.toString('base64'),
    },
  });
  return { ctx, sut, asset, user, requestId, output };
};

describe('atomic annotated photo saves', () => {
  it('publishes the new original under the existing ID, keeps dates and relationships, consumes layers and accounts for storage', async () => {
    const { sut, asset, user, requestId, output } = await setup();
    const before = await database.selectFrom('asset').selectAll().where('id', '=', asset.id).executeTakeFirstOrThrow();
    expect(await sut.commitPhotoSave(asset.id, requestId, output)).toBe(true);
    const after = await database.selectFrom('asset').selectAll().where('id', '=', asset.id).executeTakeFirstOrThrow();
    expect(after).toMatchObject({
      id: asset.id,
      ownerId: user.id,
      originalPath: output.path,
      checksum: output.checksum,
      width: 80,
      height: 120,
      isEdited: false,
      fileCreatedAt: before.fileCreatedAt,
      localDateTime: before.localDateTime,
    });
    expect(after.updateId).not.toBe(before.updateId);
    expect(await sut.getAll(asset.id)).toEqual([]);
    expect(await database.selectFrom('asset_file').selectAll().where('assetId', '=', asset.id).execute()).toEqual([
      expect.objectContaining({ path: output.files[0].path, isEdited: false }),
    ]);
    expect(
      await database.selectFrom('asset_exif').selectAll().where('assetId', '=', asset.id).executeTakeFirst(),
    ).toMatchObject({ fileSizeInByte: 140, orientation: '1', dateTimeOriginal: new Date('2020-03-04T05:06:07Z') });
    expect(
      await database.selectFrom('user').select('quotaUsageInBytes').where('id', '=', user.id).executeTakeFirst(),
    ).toEqual({ quotaUsageInBytes: 1040 });
    expect(await sut.getPhotoSave(asset.id)).toMatchObject({ status: 'committed', cleanup: [asset.originalPath] });
  });
  it('never overwrites a source changed by another operation', async () => {
    const { sut, asset, requestId, output } = await setup();
    await database
      .updateTable('asset')
      .set({ checksum: Buffer.from('another source') })
      .where('id', '=', asset.id)
      .execute();
    expect(await sut.commitPhotoSave(asset.id, requestId, output)).toBe(false);
    expect(await sut.getAll(asset.id)).toEqual([]);
    expect(await sut.getPhotoSave(asset.id)).toMatchObject({ status: 'requested' });
  });
  it('does not replace a photo after its edit permission is revoked', async () => {
    const { sut, asset, requestId, output } = await setup();
    const record = await sut.getPhotoSave(asset.id);
    if (!record) throw new Error('Missing fixture request');
    await database
      .updateTable('photo_save')
      .set({ value: { ...record, actorId: newUuid() } })
      .where('assetId', '=', asset.id)
      .where('requestId', '=', requestId)
      .execute();
    expect(await sut.commitPhotoSave(asset.id, requestId, output)).toBe(false);
  });
  it('reconciles committed saves without applying layers twice and retains durable finalization work', async () => {
    const { sut, asset, requestId, output } = await setup();
    expect(await sut.commitPhotoSave(asset.id, requestId, output)).toBe(true);
    expect(await sut.commitPhotoSave(asset.id, requestId, output)).toBe(false);
    expect(await sut.pendingPhotoSaves()).toContainEqual({ assetId: asset.id });
    await sut.completePhotoSaveCleanup(asset.id, requestId);
    expect(await sut.pendingPhotoSaves()).toContainEqual({ assetId: asset.id });
    await sut.finalizePhotoSave(asset.id, requestId);
    expect(await sut.pendingPhotoSaves()).not.toContainEqual({ assetId: asset.id });
  });
  it('serializes simultaneous writers and rejects a second active save without discarding accepted work', async () => {
    const { sut, asset, user, requestId } = await setup();
    await expect(
      sut.replaceAll(asset.id, edits, {
        includeAnnotations: true,
        saveOriginal: {
          actorId: user.id,
          requestId: newUuid(),
          sourcePath: asset.originalPath,
          sourceFileChecksum: asset.checksum.toString('base64'),
        },
      }),
    ).rejects.toThrow('Previous image save is still running or finalizing');
    expect(await sut.getPhotoSave(asset.id)).toMatchObject({ requestId, status: 'requested' });
    expect(await sut.getAll(asset.id)).toEqual([]);
  });
  it('retains failed-copy cleanup for recovery and never removes a referenced source', async () => {
    const { sut, asset, requestId, output } = await setup();
    await sut.preparePhotoSave(asset.id, requestId, output.path);
    await sut.failPhotoSave(asset.id, requestId);
    expect(await sut.getPhotoSave(asset.id)).toMatchObject({ status: 'failed', cleanup: [output.path] });
    expect(await sut.pendingPhotoSaves()).toContainEqual({ assetId: asset.id });
    expect(await sut.isPhotoPathReferenced(asset.originalPath)).toBe(true);
    expect(await sut.isPhotoPathReferenced(output.path)).toBe(false);
  });
});

describe('photo save authorization and durable history', () => {
  it.each([true, false])('honors the current partner edit grant at commit (%s)', async (allowed) => {
    const { ctx, sut, asset, user, requestId, output } = await setup();
    const { user: editor } = await ctx.newUser();
    await database
      .insertInto('partner')
      .values({ sharedById: user.id, sharedWithId: editor.id, canEdit: allowed })
      .execute();
    const request = await sut.getPhotoSave(asset.id, requestId);
    if (!request) throw new Error('Missing fixture request');
    await database
      .updateTable('photo_save')
      .set({ value: { ...request, actorId: editor.id } })
      .where('assetId', '=', asset.id)
      .where('requestId', '=', requestId)
      .execute();
    expect(await sut.commitPhotoSave(asset.id, requestId, output)).toBe(allowed);
  });
  it('retains the outcome of an older save after a different save has started', async () => {
    const { sut, asset, user, requestId, output } = await setup();
    expect(await sut.commitPhotoSave(asset.id, requestId, output)).toBe(true);
    await sut.completePhotoSaveCleanup(asset.id, requestId);
    await sut.finalizePhotoSave(asset.id, requestId);
    const nextRequest = newUuid();
    await sut.replaceAll(asset.id, edits, {
      includeAnnotations: true,
      saveOriginal: {
        actorId: user.id,
        requestId: nextRequest,
        sourcePath: output.path,
        sourceFileChecksum: output.checksum.toString('base64'),
      },
    });
    expect(await sut.getPhotoSave(asset.id, requestId)).toMatchObject({ status: 'committed' });
    expect(await sut.getPhotoSave(asset.id)).toMatchObject({ requestId: nextRequest, status: 'requested' });
    const pending = await sut.pendingPhotoSaves();
    expect(pending.filter((x) => x.assetId === asset.id)).toHaveLength(1);
    await expect(
      sut.replaceAll(asset.id, edits, {
        includeAnnotations: true,
        saveOriginal: {
          actorId: user.id,
          requestId,
          sourcePath: output.path,
          sourceFileChecksum: output.checksum.toString('base64'),
        },
      }),
    ).rejects.toThrow('Previous image save');
  });
  it('holds a per-photo lock across rendering without locking other photos', async () => {
    const { sut, asset } = await setup();
    await sut.withPhotoSaveLock(asset.id, async () => {
      await database.connection().execute(async (connection) => {
        const result = await sql<{
          locked: boolean;
        }>`select pg_try_advisory_lock(hashtextextended(${`photo-save:${asset.id}`}, 0)) as locked`.execute(connection);
        if (result.rows[0].locked)
          await sql`select pg_advisory_unlock(hashtextextended(${`photo-save:${asset.id}`}, 0))`.execute(connection);
        expect(result.rows[0].locked).toBe(false);
      });
    });
  });
});
