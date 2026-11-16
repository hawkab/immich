import { Kysely } from 'kysely';
import { AssetEditAction } from 'src/dtos/editing.dto.js';
import { AssetVisibility, Permission, SharingDirection } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { AssetService } from 'src/services/asset.service.js';
import { PartnerService } from 'src/services/partner.service.js';
import { PersonService } from 'src/services/person.service.js';
import { checkAccess } from 'src/utils/access.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory, newUuid } from 'test/small.factory.js';
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
      AssetEditRepository,
      PersonRepository,
      PartnerRepository,
      UserRepository,
      ConfigRepository,
    ],
    mock: [JobRepository, LoggingRepository],
  };
  const { sut: partners, ctx } = newMediumService(PartnerService, options);
  const { sut: photos, ctx: photoCtx } = newMediumService(AssetService, options);
  const { sut: people, ctx: peopleCtx } = newMediumService(PersonService, options);
  photoCtx.getMock(JobRepository).queue.mockResolvedValue();
  peopleCtx.getMock(JobRepository).queueAll.mockResolvedValue();
  const { user: owner } = await ctx.newUser();
  const { user: editor } = await ctx.newUser();
  const ownerAuth = factory.auth({ user: owner });
  const editorAuth = factory.auth({ user: editor });
  await partners.create(ownerAuth, { sharedWithId: editor.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id, width: 200, height: 200 });
  await ctx.newExif({ assetId: asset.id, exifImageWidth: 200, exifImageHeight: 200 });
  const access = ctx.get(AccessRepository);
  const allowed = (permission: Permission, ids = [asset.id]) =>
    checkAccess(access, { auth: editorAuth, permission, ids });
  const grant = (canEdit: boolean) => partners.updatePermissions(ownerAuth, editor.id, { canEdit });
  return { partners, photos, people, ctx, owner, editor, ownerAuth, editorAuth, asset, allowed, grant };
};

describe('Owner-controlled partner photo and face editing', () => {
  it('keeps existing and new partners read-only until the owner opts in', async () => {
    const { partners, ownerAuth, editorAuth, editor, allowed } = await setup();
    await expect(partners.search(ownerAuth, { direction: SharingDirection.SharedBy })).resolves.toEqual([
      expect.objectContaining({ id: editor.id, canEdit: false }),
    ]);
    await expect(allowed(Permission.AssetRead)).resolves.toHaveProperty('size', 1);
    for (const permission of [
      Permission.AssetEditGet,
      Permission.AssetEditCreate,
      Permission.AssetEditDelete,
      Permission.FaceCreate,
    ]) {
      await expect(allowed(permission)).resolves.toEqual(new Set());
    }
    await expect(partners.updatePermissions(editorAuth, ownerAuth.user.id, { canEdit: true })).rejects.toThrow(
      'partner.permissions.update',
    );
  });

  it('supports reversible image edits without granting deletion or metadata ownership', async () => {
    const { photos, editorAuth, asset, allowed, grant } = await setup();
    await expect(photos.get(editorAuth, asset.id)).resolves.toEqual(expect.objectContaining({ canEdit: false }));
    await grant(true);
    await expect(photos.get(editorAuth, asset.id)).resolves.toEqual(expect.objectContaining({ canEdit: true }));
    await expect(
      photos.editAsset(editorAuth, asset.id, {
        edits: [{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }],
      }),
    ).resolves.toEqual(expect.objectContaining({ assetId: asset.id }));
    await expect(photos.getAssetEdits(editorAuth, asset.id)).resolves.toEqual(
      expect.objectContaining({
        edits: [expect.objectContaining({ action: AssetEditAction.Rotate })],
      }),
    );
    await expect(photos.removeAssetEdits(editorAuth, asset.id)).resolves.toBeUndefined();
    for (const permission of [Permission.AssetDelete, Permission.AssetUpdate, Permission.AssetCopy]) {
      await expect(allowed(permission)).resolves.toEqual(new Set());
    }
    await grant(false);
    await expect(photos.removeAssetEdits(editorAuth, asset.id)).rejects.toThrow('asset.edit.delete');
    await expect(photos.editAsset(editorAuth, asset.id, { edits: [] })).rejects.toThrow('asset.edit.create');
  });

  it('creates and reassigns faces in the photo owner catalogue across separate cluster groups', async () => {
    const { people, owner, editor, ownerAuth, editorAuth, asset, grant } = await setup();
    expect(owner.clusterGroupId).not.toBe(editor.clusterGroupId);
    await grant(true);
    const person = await people.create(editorAuth, { assetId: asset.id, name: 'Synthetic person' });
    await people.createFace(editorAuth, {
      assetId: asset.id,
      personId: person.id,
      imageWidth: 200,
      imageHeight: 200,
      x: 10,
      y: 10,
      width: 40,
      height: 50,
    });
    const [face] = await people.getFacesById(ownerAuth, { id: asset.id });
    expect(face.person).toEqual(expect.objectContaining({ id: person.id, name: 'Synthetic person' }));
    await expect(people.getFacesById(editorAuth, { id: asset.id })).resolves.toEqual([
      expect.objectContaining({ id: face.id, person: expect.objectContaining({ id: person.id }) }),
    ]);
    await expect(people.getAll(editorAuth, { assetId: asset.id, page: 1, size: 500 })).resolves.toEqual(
      expect.objectContaining({ people: [expect.objectContaining({ id: person.id })] }),
    );
    const next = await people.create(editorAuth, { assetId: asset.id, name: 'Corrected person' });
    await people.reassignFacesById(editorAuth, next.id, { id: face.id });
    await expect(people.getFacesById(ownerAuth, { id: asset.id })).resolves.toEqual([
      expect.objectContaining({ person: expect.objectContaining({ id: next.id }) }),
    ]);
    await people.deleteFace(editorAuth, face.id, { force: true });
    await expect(people.getFacesById(ownerAuth, { id: asset.id })).resolves.toEqual([]);
    await grant(false);
    await expect(people.create(editorAuth, { assetId: asset.id, name: 'Not permitted' })).rejects.toThrow(
      'face.create',
    );
    await expect(people.getAll(editorAuth, { assetId: asset.id, page: 1, size: 500 })).rejects.toThrow('face.create');
  });

  it('does not reveal a thumbnail taken from a locked photo', async () => {
    const { people, ctx, owner, editorAuth, asset, grant } = await setup();
    const { asset: locked } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });
    const { person } = await ctx.newPerson({ ownerId: owner.id, thumbnailPath: '/synthetic/private.jpg' });
    const { assetFace } = await ctx.newAssetFace({ assetId: locked.id, personGroupId: person.personGroupId });
    await ctx
      .get(PersonRepository)
      .update({ ownerId: owner.id, personGroupId: person.personGroupId, faceAssetId: assetFace.id });
    await grant(true);
    await expect(people.getThumbnail(editorAuth, person.personGroupId, asset.id)).rejects.toThrow('asset.read');
  });

  it('does not grant editing through a shared link', async () => {
    const { ctx, editor, asset, grant } = await setup();
    await grant(true);
    const auth = factory.auth({ user: editor, sharedLink: { allowUpload: true, allowDownload: true } });
    for (const permission of [
      Permission.AssetEditCreate,
      Permission.AssetEditDelete,
      Permission.FaceCreate,
      Permission.FaceUpdate,
      Permission.FaceDelete,
    ]) {
      await expect(checkAccess(ctx.get(AccessRepository), { auth, permission, ids: [asset.id] })).resolves.toEqual(
        new Set(),
      );
    }
  });

  it('does not allow a face to use a person from an unrelated catalogue', async () => {
    const { people, ctx, editorAuth, asset, grant } = await setup();
    const { user: stranger } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: stranger.id });
    await grant(true);
    await expect(
      people.createFace(editorAuth, {
        assetId: asset.id,
        personId: person.personGroupId,
        imageWidth: 200,
        imageHeight: 200,
        x: 10,
        y: 10,
        width: 40,
        height: 50,
      }),
    ).rejects.toThrow('Person');
  });

  it('does not expose locked, archived, trashed or unrelated photos', async () => {
    const { ctx, owner, allowed, grant } = await setup();
    await grant(true);
    const { user: stranger } = await ctx.newUser();
    const assets = await Promise.all([
      ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked }),
      ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive }),
      ctx.newAsset({ ownerId: owner.id, deletedAt: new Date() }),
      ctx.newAsset({ ownerId: stranger.id }),
    ]);
    await expect(
      allowed(
        Permission.AssetEditCreate,
        assets.map(({ asset }) => asset.id),
      ),
    ).resolves.toEqual(new Set());
    await expect(allowed(Permission.FaceCreate, [newUuid()])).resolves.toEqual(new Set());
  });

  it('scopes grants by direction and revokes them when the partnership is removed', async () => {
    const { partners, ctx, owner, editor, ownerAuth, editorAuth, asset, allowed, grant } = await setup();
    await partners.create(editorAuth, { sharedWithId: owner.id });
    await partners.updatePermissions(editorAuth, owner.id, { canEdit: true });
    await expect(allowed(Permission.AssetEditCreate)).resolves.toEqual(new Set());
    await grant(true);
    await expect(allowed(Permission.AssetEditCreate)).resolves.toEqual(new Set([asset.id]));
    await partners.remove(ownerAuth, editor.id);
    await expect(allowed(Permission.AssetEditCreate)).resolves.toEqual(new Set());
    await expect(ctx.get(AssetRepository).getById(asset.id)).resolves.toBeDefined();
  });
});
