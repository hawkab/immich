import { Kysely } from 'kysely';
import { AssetEditAction, MirrorAxis, type AssetEditActionItem } from 'src/dtos/editing.dto.js';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

// eslint-disable-next-line unicorn/no-unnecessary-parameters
const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(AssetEditRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(AssetEditRepository.name, () => {
  describe('replaceAll', () => {
    it('round-trips annotations and preserves them across legacy writes, but allows an explicit reset', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const annotation: AssetEditActionItem = {
        action: AssetEditAction.Annotate,
        parameters: { layers: [{ type: 'emoji' as const, emoji: '1f600', x: 0.5, y: 0.5, size: 0.2 }] },
      };
      await sut.replaceAll(asset.id, [annotation], { includeAnnotations: true });
      expect(await sut.getAll(asset.id)).toEqual([expect.objectContaining(annotation)]);
      expect(await sut.getWithSyncInfo(asset.id)).toEqual([]);
      await sut.replaceAll(asset.id, [{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }]);
      const rotated = await sut.getAll(asset.id);
      expect(rotated.map((edit) => edit.action)).toEqual([AssetEditAction.Rotate, AssetEditAction.Annotate]);
      await sut.replaceAll(asset.id, []);
      const reset = await sut.getAll(asset.id);
      expect(reset.map((edit) => edit.action)).toEqual([AssetEditAction.Annotate]);
      await sut.replaceAll(asset.id, [], { includeAnnotations: true });
      expect(await sut.getAll(asset.id)).toEqual([]);
      expect(
        await ctx.database.selectFrom('asset').select('isEdited').where('id', '=', asset.id).executeTakeFirstOrThrow(),
      ).toEqual({ isEdited: false });
    });

    it('should set isEdited on insert', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await expect(
        ctx.database.selectFrom('asset').select('isEdited').where('id', '=', asset.id).executeTakeFirstOrThrow(),
      ).resolves.toEqual({ isEdited: false });

      await sut.replaceAll(asset.id, [
        { action: AssetEditAction.Crop, parameters: { height: 1, width: 1, x: 1, y: 1 } },
      ]);

      await expect(
        ctx.database.selectFrom('asset').select('isEdited').where('id', '=', asset.id).executeTakeFirstOrThrow(),
      ).resolves.toEqual({ isEdited: true });
    });

    it('should set isEdited when inserting multiple edits', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await expect(
        ctx.database.selectFrom('asset').select('isEdited').where('id', '=', asset.id).executeTakeFirstOrThrow(),
      ).resolves.toEqual({ isEdited: false });

      await sut.replaceAll(asset.id, [
        { action: AssetEditAction.Crop, parameters: { height: 1, width: 1, x: 1, y: 1 } },
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Horizontal } },
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
      ]);

      await expect(
        ctx.database.selectFrom('asset').select('isEdited').where('id', '=', asset.id).executeTakeFirstOrThrow(),
      ).resolves.toEqual({ isEdited: true });
    });

    it('should keep isEdited when removing some edits', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await expect(
        ctx.database.selectFrom('asset').select('isEdited').where('id', '=', asset.id).executeTakeFirstOrThrow(),
      ).resolves.toEqual({ isEdited: false });

      await sut.replaceAll(asset.id, [
        { action: AssetEditAction.Crop, parameters: { height: 1, width: 1, x: 1, y: 1 } },
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Horizontal } },
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
      ]);

      await expect(
        ctx.database.selectFrom('asset').select('isEdited').where('id', '=', asset.id).executeTakeFirstOrThrow(),
      ).resolves.toEqual({ isEdited: true });

      await sut.replaceAll(asset.id, [
        { action: AssetEditAction.Crop, parameters: { height: 1, width: 1, x: 1, y: 1 } },
      ]);

      await expect(
        ctx.database.selectFrom('asset').select('isEdited').where('id', '=', asset.id).executeTakeFirstOrThrow(),
      ).resolves.toEqual({ isEdited: true });
    });

    it('should set isEdited to false if all edits are deleted', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await expect(
        ctx.database.selectFrom('asset').select('isEdited').where('id', '=', asset.id).executeTakeFirstOrThrow(),
      ).resolves.toEqual({ isEdited: false });

      await sut.replaceAll(asset.id, [
        { action: AssetEditAction.Crop, parameters: { height: 1, width: 1, x: 1, y: 1 } },
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Horizontal } },
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
      ]);

      await sut.replaceAll(asset.id, []);

      await expect(
        ctx.database.selectFrom('asset').select('isEdited').where('id', '=', asset.id).executeTakeFirstOrThrow(),
      ).resolves.toEqual({ isEdited: false });
    });
  });
});
