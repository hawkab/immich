import { Kysely } from 'kysely';
import { AssetEditAction, MirrorAxis } from 'src/dtos/editing.dto.js';
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
    it('should preserve an existing manual edit when an automatic correction arrives', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const manual = await sut.replaceAll(asset.id, [{ action: AssetEditAction.Rotate, parameters: { angle: 180 } }]);
      const automatic = await sut.replaceAll(
        asset.id,
        [{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }],
        asset.checksum.toString('base64'),
      );
      expect(automatic).toBeNull();
      expect(await sut.getAll(asset.id)).toEqual(manual);
    });

    it('should reject an automatic correction for a replaced original', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const result = await sut.replaceAll(
        asset.id,
        [{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }],
        Buffer.alloc(32).toString('base64'),
      );
      expect(result).toBeNull();
      expect(await sut.getAll(asset.id)).toEqual([]);
    });

    it('should accept exactly one of two concurrent automatic corrections', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const results = await Promise.all(
        [90, 270].map((angle) =>
          sut.replaceAll(
            asset.id,
            [{ action: AssetEditAction.Rotate, parameters: { angle } }],
            asset.checksum.toString('base64'),
          ),
        ),
      );
      expect(results.filter((result) => result !== null)).toHaveLength(1);
      expect(await sut.getAll(asset.id)).toHaveLength(1);
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
