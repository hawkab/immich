import { sql } from 'kysely';
import { AssetEditAction } from 'src/dtos/editing.dto.js';
import { AssetFileType } from 'src/enum.js';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

const setup = async () => {
  const database = await getKyselyDB();
  const { ctx } = newMediumService(BaseService, { database, real: [], mock: [LoggingRepository] });
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const assets = ctx.get(AssetRepository);
  const editor = ctx.get(AssetEditRepository);
  return { database, asset, assets, editor };
};

describe('atomic rendered-generation publication', () => {
  it('rejects an older job after the new edits and their preview have committed', async () => {
    const { database, asset, assets, editor } = await setup();
    try {
      const oldEdits = await editor.replaceAll(asset.id, [
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
      ]);
      const old = { id: asset.id, checksum: asset.checksum, edits: oldEdits };
      const newEdits = await editor.replaceAll(asset.id, [
        { action: AssetEditAction.Rotate, parameters: { angle: 180 } },
      ]);
      const current = { ...old, edits: newEdits };
      const file = {
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/generated/new-preview.jpg',
        isEdited: true,
        isProgressive: false,
        isTransparent: false,
      };
      await expect(assets.replaceEditedFiles(current, [file])).resolves.toMatchObject({ applied: true });
      await expect(assets.replaceEditedFiles(old, [{ ...file, path: '/generated/old-preview.jpg' }])).resolves.toEqual({
        applied: false,
        obsoletePaths: [],
      });
      const rows = await database.selectFrom('asset_file').select('path').where('assetId', '=', asset.id).execute();
      expect(rows).toEqual([{ path: '/generated/new-preview.jpg' }]);
    } finally {
      await database.destroy();
    }
  });

  it('does not let an old removal job delete a newly edited preview', async () => {
    const { database, asset, assets, editor } = await setup();
    try {
      const empty = { id: asset.id, checksum: asset.checksum, edits: [] };
      const edits = await editor.replaceAll(asset.id, [
        { action: AssetEditAction.Mirror, parameters: { axis: 'horizontal' } },
      ]);
      const file = {
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/generated/current.jpg',
        isEdited: true,
        isProgressive: false,
        isTransparent: false,
      };
      await assets.replaceEditedFiles({ ...empty, edits }, [file]);
      await expect(assets.replaceEditedFiles(empty, [])).resolves.toEqual({ applied: false, obsoletePaths: [] });
      expect(await database.selectFrom('asset_file').select('path').where('assetId', '=', asset.id).execute()).toEqual([
        { path: '/generated/current.jpg' },
      ]);
    } finally {
      await database.destroy();
    }
  });

  it('removes obsolete derivative records only after a matching current snapshot', async () => {
    const { database, asset, assets, editor } = await setup();
    try {
      const edits = await editor.replaceAll(asset.id, [{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }]);
      const snapshot = { id: asset.id, checksum: asset.checksum, edits };
      const file = {
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/generated/first.jpg',
        isEdited: true,
        isProgressive: false,
        isTransparent: false,
      };
      await assets.replaceEditedFiles(snapshot, [file]);
      const result = await assets.replaceEditedFiles(snapshot, [{ ...file, path: '/generated/second.jpg' }]);
      expect(result).toEqual({ applied: true, obsoletePaths: ['/generated/first.jpg'] });
      await editor.replaceAll(asset.id, []);
      expect(await assets.replaceEditedFiles({ ...snapshot, edits: [] }, [])).toEqual({
        applied: true,
        obsoletePaths: ['/generated/second.jpg'],
      });
    } finally {
      await database.destroy();
    }
  });

  it('rejects an older source checksum even when the edits and isEdited remain unchanged', async () => {
    const { database, asset, assets, editor } = await setup();
    try {
      const edits = await editor.replaceAll(asset.id, [{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }]);
      await database
        .updateTable('asset')
        .set({ checksum: Buffer.from('new-original') })
        .where('id', '=', asset.id)
        .execute();
      await expect(assets.replaceEditedFiles({ id: asset.id, checksum: asset.checksum, edits }, [])).resolves.toEqual({
        applied: false,
        obsoletePaths: [],
      });
    } finally {
      await database.destroy();
    }
  });

  it('serializes a concurrent edit behind the generation pointer transaction', async () => {
    const { database, asset, assets, editor } = await setup();
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const { promise: locked, resolve: signal } = Promise.withResolvers<void>();
    const running: Promise<unknown>[] = [];
    const waitForLock = async (pattern: string, finished: () => boolean) => {
      while (!finished()) {
        const result = await sql<{ waiting: boolean }>`select exists (
          select 1 from pg_stat_activity where pid <> pg_backend_pid() and wait_event_type = 'Lock'
          and query ilike ${pattern}) as waiting`.execute(database);
        if (result.rows[0].waiting) {
          return true;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      return false;
    };
    try {
      const edits = await editor.replaceAll(asset.id, [{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }]);
      const control = database.transaction().execute(async (transaction) => {
        await sql`lock table asset_file in exclusive mode`.execute(transaction);
        signal();
        await gate;
      });
      running.push(control);
      await locked;
      let committed = false;
      const publication = assets
        .replaceEditedFiles({ id: asset.id, checksum: asset.checksum, edits }, [
          {
            assetId: asset.id,
            type: AssetFileType.Preview,
            path: '/generated/locked.jpg',
            isEdited: true,
            isProgressive: false,
            isTransparent: false,
          },
        ])
        .finally(() => {
          committed = true;
        });
      running.push(publication);
      expect(await waitForLock('%insert into "asset_file"%', () => committed)).toBe(true);
      let edited = false;
      const update = editor
        .replaceAll(asset.id, [{ action: AssetEditAction.Rotate, parameters: { angle: 180 } }])
        .finally(() => {
          edited = true;
        });
      running.push(update);
      expect(await waitForLock('%from "asset"%for update%', () => edited)).toBe(true);
      expect(edited).toBe(false);
      release();
      await Promise.all(running);
    } finally {
      release();
      await Promise.allSettled(running);
      await database.destroy();
    }
  });
});
