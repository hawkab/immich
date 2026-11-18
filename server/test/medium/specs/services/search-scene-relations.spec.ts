import { Kysely } from 'kysely';
import { AssetEditAction } from 'src/dtos/editing.dto.js';
import { DB } from 'src/schema/index.js';
import { sceneEmbedding as embedding, sceneRelationFixture } from 'test/medium/scene-relations.fixture.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let database: Kysely<DB>;
beforeAll(async () => {
  database = await getKyselyDB();
});
const fixture = () => sceneRelationFixture(database);

describe('source-bound riding scene relations', () => {
  it('requires the named person to ride instead of matching a nearby horse or a plush toy', async () => {
    const { sut, user, photo } = await fixture();
    const riding = await photo('masha');
    await photo('other');
    await photo(null, true);
    const auth = factory.auth({ user: { id: user.id } });
    for (const shape of [{}, { filter: {} }]) {
      const result = await sut.searchSmart(auth, {
        size: 1,
        query: 'Маша на лошади',
        useSceneDescriptions: true,
        includeDepictions: true,
        ...shape,
      });
      expect(result.assets.items.map((asset) => asset.id)).toEqual([riding.asset.id]);
      expect(result.assets.nextPage).toBeNull();
    }
  });

  it('allows two named riders on different horses but not a named bystander', async () => {
    const { sut, user, photo } = await fixture();
    const both = await photo('masha');
    await photo('masha');
    const relation = { ...both.scene.relations[0], subjectFaceIds: [both.otherFace.id] };
    await database
      .updateTable('asset_metadata')
      .set({ value: { ...both.scene, relations: [...both.scene.relations, relation] } })
      .where('assetId', '=', both.asset.id)
      .execute();
    const auth = factory.auth({ user: { id: user.id } });
    for (const shape of [{}, { filter: {} }]) {
      const result = await sut.searchSmart(auth, {
        size: 20,
        query: 'Маша и Другой человек на лошадях',
        useSceneDescriptions: true,
        ...shape,
      });
      expect(result.assets.items.map((asset) => asset.id)).toEqual([both.asset.id]);
    }
  });

  it('retains bare object search and the depiction switch without inventing a riding relation', async () => {
    const { repository, user, masha, photo } = await fixture();
    const real = await photo('masha');
    const toyRide = await photo('masha', true);
    const nearbyToy = await photo(null, true);
    const base = { embedding, scenePersonIds: [masha.personGroupId], sceneQuery: 'на лошади' };
    const scope = { userIds: [user.id], lockedOwnerId: user.id };
    for (const includeDepictions of [false, true]) {
      const expected = includeDepictions ? [real.asset.id, toyRide.asset.id] : [real.asset.id];
      const modern = await repository.searchSmartV3({ take: 20 }, { ...base, includeDepictions, filter: {} }, scope);
      const legacy = await repository.searchSmart(
        { page: 1, size: 20 },
        { ...base, includeDepictions, userIds: [user.id] },
      );
      expect(modern.items.map((asset) => asset.id).sort()).toEqual(expected.sort());
      expect(legacy.items.map((asset) => asset.id).sort()).toEqual(expected.sort());
    }
    const objects = await repository.searchSmartV3(
      { take: 20 },
      { ...base, sceneQuery: 'лошадь', includeDepictions: true, filter: {} },
      scope,
    );
    expect(objects.items.map((asset) => asset.id).sort()).toEqual(
      [real.asset.id, toyRide.asset.id, nearbyToy.asset.id].sort(),
    );
  });

  it('uses current curated face groups and cannot borrow a foreign or deleted actor face', async () => {
    const { repository, user, masha, other, photo } = await fixture();
    const riding = await photo('masha');
    const unrelated = await photo('masha');
    const scope = { userIds: [user.id], lockedOwnerId: user.id };
    const search = async (personId: string) => {
      const result = await repository.searchSmartV3(
        { take: 20 },
        { embedding, sceneQuery: 'на лошади', scenePersonIds: [personId], filter: {} },
        scope,
      );
      return result.items.map((asset) => asset.id);
    };
    await database
      .updateTable('asset_face')
      .set({ personGroupId: other.personGroupId })
      .where('id', '=', riding.mashaFace.id)
      .execute();
    expect(await search(masha.personGroupId)).toEqual([unrelated.asset.id]);
    expect(await search(other.personGroupId)).toEqual([riding.asset.id]);
    const foreign = {
      ...riding.scene,
      relations: [{ ...riding.scene.relations[0], subjectFaceIds: [unrelated.mashaFace.id] }],
    };
    await database
      .updateTable('asset_metadata')
      .set({ value: foreign })
      .where('assetId', '=', riding.asset.id)
      .execute();
    expect(await search(masha.personGroupId)).toEqual([unrelated.asset.id]);
    await database
      .updateTable('asset_face')
      .set({ deletedAt: new Date() })
      .where('id', '=', unrelated.mashaFace.id)
      .execute();
    expect(await search(masha.personGroupId)).toEqual([]);
  });

  it('rejects malformed relation payloads without breaking unrelated object searches', async () => {
    const { repository, user, masha, photo } = await fixture();
    const malformed = await photo('masha');
    await database
      .updateTable('asset_metadata')
      .set({ value: { ...malformed.scene, relations: {} } })
      .where('assetId', '=', malformed.asset.id)
      .execute();
    const scope = { userIds: [user.id], lockedOwnerId: user.id };
    const options = { embedding, sceneQuery: 'на лошади', scenePersonIds: [masha.personGroupId], filter: {} };
    const missing = await repository.searchSmartV3({ take: 20 }, options, scope);
    expect(missing.items).toEqual([]);
    const object = await repository.searchSmartV3({ take: 20 }, { ...options, sceneQuery: 'лошадь' }, scope);
    expect(object.items.map((asset) => asset.id)).toEqual([malformed.asset.id]);
  });

  it('rejects stale edited-to-edited relations even when isEdited and thumbnail hashes have not changed', async () => {
    const { repository, user, masha, photo } = await fixture();
    const current = await photo('masha');
    const edit = { action: AssetEditAction.Rotate, parameters: { angle: 90 } };
    await database
      .insertInto('asset_edit')
      .values({ ...edit, assetId: current.asset.id, sequence: 0 })
      .execute();
    await database.updateTable('asset').set({ isEdited: true }).where('id', '=', current.asset.id).execute();
    const value = { ...current.scene, isEdited: true, relationAnalysis: { edits: [edit] } };
    await database.updateTable('asset_metadata').set({ value }).where('assetId', '=', current.asset.id).execute();
    const scope = { userIds: [user.id], lockedOwnerId: user.id };
    const options = { embedding, sceneQuery: 'на лошади', scenePersonIds: [masha.personGroupId], filter: {} };
    const before = await repository.searchSmartV3({ take: 20 }, options, scope);
    expect(before.items.map((asset) => asset.id)).toEqual([current.asset.id]);
    await database
      .updateTable('asset_edit')
      .set({ parameters: { angle: 270 } })
      .where('assetId', '=', current.asset.id)
      .execute();
    const after = await repository.searchSmartV3({ take: 20 }, options, scope);
    expect(after.items).toEqual([]);
  });
});
