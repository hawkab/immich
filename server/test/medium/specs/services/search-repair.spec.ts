import { Kysely } from 'kysely';
import { AssetVisibility, SourceType } from 'src/enum.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { DuplicateRepository } from 'src/repositories/duplicate.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let database: Kysely<DB>;
beforeAll(async () => {
  database = await getKyselyDB();
});
const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database,
    real: [PersonRepository, DuplicateRepository, AssetRepository, PartnerRepository],
    mock: [LoggingRepository],
  });
  return { ctx, people: ctx.get(PersonRepository), duplicates: ctx.get(DuplicateRepository) };
};

describe('shared photo search repair', () => {
  it('shares visible catalogue names only while the photo partnership exists', async () => {
    const { ctx, people } = setup();
    const { user: viewer } = await ctx.newUser();
    const { user: owner } = await ctx.newUser();
    const { user: outsider } = await ctx.newUser();
    const { person: named } = await ctx.newPerson({ ownerId: owner.id, name: 'Маша' });
    const { person: hidden } = await ctx.newPerson({ ownerId: owner.id, name: 'Private name' });
    const { person: unrelated } = await ctx.newPerson({ ownerId: outsider.id, name: 'Unrelated name' });
    const { asset } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: locked } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });
    const { asset: unrelatedAsset } = await ctx.newAsset({ ownerId: outsider.id });
    await ctx.newAssetFace({ assetId: asset.id, personGroupId: named.personGroupId });
    await ctx.newAssetFace({ assetId: locked.id, personGroupId: hidden.personGroupId });
    await ctx.newAssetFace({ assetId: unrelatedAsset.id, personGroupId: unrelated.personGroupId });
    expect(await people.getNamedForSearch(viewer.id)).toEqual([]);
    await database.insertInto('partner').values({ sharedById: owner.id, sharedWithId: viewer.id }).execute();
    expect(await people.getNamedForSearch(viewer.id)).toEqual([{ personGroupId: named.personGroupId, name: 'Маша' }]);
    await database.deleteFrom('partner').where('sharedWithId', '=', viewer.id).execute();
    expect(await people.getNamedForSearch(viewer.id)).toEqual([]);
  });

  it('reconciles unnamed machine faces while retaining all named seeds and manual annotations', async () => {
    const { ctx, people } = setup();
    const { user } = await ctx.newUser();
    const { person: named } = await ctx.newPerson({ ownerId: user.id, name: 'Маша' });
    const { person: unnamed } = await ctx.newPerson({ ownerId: user.id, name: '' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: seed } = await ctx.newAssetFace({
      assetId: asset.id,
      personGroupId: named.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    const { assetFace: candidate } = await ctx.newAssetFace({
      assetId: asset.id,
      personGroupId: unnamed.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    const { assetFace: manual } = await ctx.newAssetFace({
      assetId: asset.id,
      personGroupId: unnamed.personGroupId,
      sourceType: SourceType.Manual,
    });
    await people.unassignFaces({
      sourceType: SourceType.MachineLearning,
      clusterGroupId: user.clusterGroupId,
      preserveNamed: true,
    });
    const faces = await database
      .selectFrom('asset_face')
      .select(['id', 'personGroupId'])
      .where('assetId', '=', asset.id)
      .execute();
    expect(faces).toEqual(
      expect.arrayContaining([
        { id: seed.id, personGroupId: named.personGroupId },
        { id: candidate.id, personGroupId: null },
        { id: manual.id, personGroupId: unnamed.personGroupId },
      ]),
    );
  });

  it('finds all file-based candidates with pagination without altering duplicate groups', async () => {
    const { ctx, duplicates } = setup();
    const { user } = await ctx.newUser();
    const { user: other } = await ctx.newUser();
    const before = await database.selectFrom('asset').select('id').execute();
    const first = [];
    for (const [index, visibility] of [
      AssetVisibility.Timeline,
      AssetVisibility.Timeline,
      AssetVisibility.Locked,
    ].entries()) {
      const { asset } = await ctx.newAsset({ ownerId: user.id, originalFileName: 'same.jpg', visibility });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte: 12_345, exifImageWidth: 100, exifImageHeight: 100 });
      if (index < 2) {
        first.push(asset.id);
      }
    }
    for (let index = 0; index < 2; index++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id, originalFileName: 'another.jpg' });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte: 54_321 });
    }
    const { asset: outsider } = await ctx.newAsset({ ownerId: other.id, originalFileName: 'same.jpg' });
    await ctx.newExif({ assetId: outsider.id, fileSizeInByte: 12_345 });
    for (const mode of ['size', 'name'] as const) {
      const page = await duplicates.candidateGroups([user.id], mode, 1, 1);
      expect(page).toHaveLength(2);
      expect(page[0].totalGroups).toBe(2);
      const ids = page.flatMap((group) => group.assetIds);
      expect(ids).not.toContain(outsider.id);
      expect(ids).toEqual(expect.arrayContaining(first));
      expect(await duplicates.candidateGroups([user.id], mode, 2, 1)).toHaveLength(1);
    }
    expect(await database.selectFrom('asset').select('id').where('duplicateId', 'is not', null).execute()).toEqual([]);
    const after = await database.selectFrom('asset').select('id').execute();
    expect(after.length).toBe(before.length + 6);
  });
  it('compares exact content across the selected owners and includes native visual groups', async () => {
    const { ctx, duplicates } = setup();
    const { user: first } = await ctx.newUser();
    const { user: second } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const checksum = Buffer.alloc(20, 51);
    const group = crypto.randomUUID();
    const { asset: one } = await ctx.newAsset({ ownerId: first.id, checksum, duplicateId: group });
    const { asset: two } = await ctx.newAsset({ ownerId: second.id, checksum });
    const { asset: similar } = await ctx.newAsset({ ownerId: first.id, duplicateId: group });
    const { asset: unrelated } = await ctx.newAsset({ ownerId: stranger.id, checksum });
    const rows = await duplicates.candidateGroups([first.id, second.id], 'content', 1, 50);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'checksum', assetIds: [one.id, two.id].sort() }),
        expect.objectContaining({ reason: 'visual', assetIds: [one.id, similar.id].sort() }),
      ]),
    );
    expect(rows.flatMap((row) => row.assetIds)).not.toContain(unrelated.id);
    expect(await duplicates.candidateGroups([second.id], 'content', 1, 50)).toEqual([]);
  });
});
