import { Kysely } from 'kysely';
import { AssetStatus, AssetVisibility, Permission, SharingDirection, SystemMetadataKey } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TrashRepository } from 'src/repositories/trash.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { AssetService } from 'src/services/asset.service.js';
import { PartnerService } from 'src/services/partner.service.js';
import { TrashService } from 'src/services/trash.service.js';
import { checkAccess } from 'src/utils/access.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let database: Kysely<DB>;
beforeAll(async () => {
  database = await getKyselyDB();
});

const setup = async () => {
  const options = {
    database,
    real: [
      AccessRepository,
      AssetRepository,
      PartnerRepository,
      TrashRepository,
      UserRepository,
      ConfigRepository,
      SystemMetadataRepository,
    ],
    mock: [EventRepository, JobRepository, LoggingRepository],
  };
  const { sut: partners, ctx } = newMediumService(PartnerService, options);
  const { sut: photos, ctx: photoCtx } = newMediumService(AssetService, options);
  const { sut: trash, ctx: trashCtx } = newMediumService(TrashService, options);
  photoCtx.getMock(EventRepository).emit.mockResolvedValue();
  trashCtx.getMock(EventRepository).emit.mockResolvedValue();
  const { user: owner } = await ctx.newUser();
  const { user: recipient } = await ctx.newUser();
  const ownerAuth = factory.auth({ user: owner });
  const recipientAuth = factory.auth({ user: recipient });
  await partners.create(ownerAuth, { sharedWithId: recipient.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id });
  const grant = (canDelete: boolean) => partners.updatePermissions(ownerAuth, recipient.id, { canDelete });
  return { partners, photos, trash, ctx, photoCtx, trashCtx, owner, recipient, ownerAuth, recipientAuth, asset, grant };
};

describe('Owner-controlled partner deletion', () => {
  it('defaults to read-only and only lets the sharing owner grant deletion', async () => {
    const { partners, photos, ownerAuth, recipientAuth, asset, recipient } = await setup();
    await expect(partners.search(ownerAuth, { direction: SharingDirection.SharedBy })).resolves.toEqual([
      expect.objectContaining({ id: recipient.id, canDelete: false }),
    ]);
    await expect(photos.get(recipientAuth, asset.id)).resolves.toEqual(expect.objectContaining({ canDelete: false }));
    await expect(photos.deleteAll(recipientAuth, { ids: [asset.id] })).rejects.toThrow('asset.trash');
    await expect(partners.updatePermissions(recipientAuth, ownerAuth.user.id, { canDelete: true })).rejects.toThrow(
      'partner.permissions.update',
    );
  });

  it('trashes and restores the original through the normal API and notifies both users', async () => {
    const { photos, trash, photoCtx, trashCtx, ctx, owner, recipient, recipientAuth, asset, grant } = await setup();
    await grant(true);
    await expect(photos.get(recipientAuth, asset.id)).resolves.toEqual(expect.objectContaining({ canDelete: true }));
    await photos.deleteAll(recipientAuth, { ids: [asset.id] });
    const stored = await ctx.get(AssetRepository).getByIds([asset.id]);
    expect(stored[0]).toMatchObject({
      ownerId: owner.id,
      originalPath: asset.originalPath,
      checksum: asset.checksum,
      status: AssetStatus.Trashed,
    });
    for (const userId of [owner.id, recipient.id]) {
      expect(photoCtx.getMock(EventRepository).emit).toHaveBeenCalledWith('AssetTrashAll', {
        userId,
        assetIds: [asset.id],
      });
    }
    await expect(trash.restoreAssets(recipientAuth, { ids: [asset.id] })).resolves.toEqual({ count: 1 });
    const restored = await ctx.get(AssetRepository).getByIds([asset.id]);
    expect(restored[0]).toMatchObject({
      status: AssetStatus.Active,
      deletedAt: null,
    });
    for (const userId of [owner.id, recipient.id]) {
      expect(trashCtx.getMock(EventRepository).emit).toHaveBeenCalledWith('AssetRestoreAll', {
        userId,
        assetIds: [asset.id],
      });
    }
    expect(photoCtx.getMock(JobRepository).queue).not.toHaveBeenCalled();
  });

  it('never grants permanent deletion, even with force=true', async () => {
    const { photos, recipientAuth, asset, grant, ctx } = await setup();
    await grant(true);
    await expect(photos.deleteAll(recipientAuth, { ids: [asset.id], force: true })).rejects.toThrow('asset.delete');
    await expect(ctx.get(AssetRepository).getByIds([asset.id])).resolves.toEqual([
      expect.objectContaining({ status: AssetStatus.Active }),
    ]);
  });

  it('revokes deletion immediately and does not infer permission from a reverse sharing relationship', async () => {
    const { partners, photos, recipientAuth, ownerAuth, asset, owner, grant } = await setup();
    await grant(true);
    await grant(false);
    await partners.create(recipientAuth, { sharedWithId: owner.id });
    await partners.updatePermissions(recipientAuth, owner.id, { canDelete: true });
    await expect(photos.deleteAll(recipientAuth, { ids: [asset.id] })).rejects.toThrow('asset.trash');
    await expect(photos.get(recipientAuth, asset.id)).resolves.toEqual(expect.objectContaining({ canDelete: false }));
    await expect(photos.deleteAll(ownerAuth, { ids: [asset.id] })).resolves.toBeUndefined();
  });

  it.each([AssetVisibility.Archive, AssetVisibility.Locked, AssetVisibility.Hidden])(
    'keeps %s photos outside partner deletion',
    async (visibility) => {
      const { photos, recipientAuth, asset, grant, ctx } = await setup();
      await grant(true);
      await ctx.get(AssetRepository).updateAll([asset.id], { visibility });
      await expect(photos.deleteAll(recipientAuth, { ids: [asset.id] })).rejects.toThrow('asset.trash');
    },
  );

  it('rejects a mixed batch atomically when any photo lacks permission', async () => {
    const { photos, recipientAuth, asset, grant, ctx } = await setup();
    await grant(true);
    const { user: stranger } = await ctx.newUser();
    const { asset: privateAsset } = await ctx.newAsset({ ownerId: stranger.id });
    await expect(photos.deleteAll(recipientAuth, { ids: [asset.id, privateAsset.id] })).rejects.toThrow('asset.trash');
    await expect(ctx.get(AssetRepository).getByIds([asset.id])).resolves.toEqual([
      expect.objectContaining({ status: AssetStatus.Active }),
    ]);
  });

  it('checks the current grant again for undo', async () => {
    const { photos, trash, recipientAuth, asset, grant } = await setup();
    await grant(true);
    await photos.deleteAll(recipientAuth, { ids: [asset.id] });
    await grant(false);
    await expect(trash.restoreAssets(recipientAuth, { ids: [asset.id] })).rejects.toThrow('asset.restore');
  });

  it('does not allow restoring an asset queued for permanent deletion', async () => {
    const { photos, trash, recipientAuth, ownerAuth, asset, grant } = await setup();
    await grant(true);
    await photos.deleteAll(ownerAuth, { ids: [asset.id], force: true });
    await expect(trash.restoreAssets(recipientAuth, { ids: [asset.id] })).rejects.toThrow('asset.restore');
  });

  it('preserves recoverability when server trash is disabled', async () => {
    const { ctx, photos, recipientAuth, asset, grant } = await setup();
    await grant(true);
    const metadata = ctx.get(SystemMetadataRepository);
    await metadata.set(SystemMetadataKey.SystemConfig, { trash: { enabled: false } });
    try {
      await expect(photos.deleteAll(recipientAuth, { ids: [asset.id] })).rejects.toThrow('requires trash');
    } finally {
      await metadata.set(SystemMetadataKey.SystemConfig, {});
    }
  });

  it('does not inherit metadata editing or shared-link deletion rights', async () => {
    const { ctx, recipientAuth, asset, grant } = await setup();
    await grant(true);
    const access = ctx.get(AccessRepository);
    await expect(
      checkAccess(access, { auth: recipientAuth, permission: Permission.AssetUpdate, ids: [asset.id] }),
    ).resolves.toEqual(new Set());
    await expect(
      checkAccess(access, {
        auth: factory.auth({ user: recipientAuth.user, sharedLink: {} }),
        permission: Permission.AssetTrash,
        ids: [asset.id],
      }),
    ).resolves.toEqual(new Set());
  });
});
