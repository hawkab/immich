import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { randomUUID } from 'node:crypto';
import { columns } from 'src/database.js';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetEditAction, AssetEditActionItem, AssetEditActionItemResponseDto } from 'src/dtos/editing.dto.js';
import { PhotoSaveStore, type RenderedPhoto } from 'src/repositories/photo-save.store.js';
import { DB } from 'src/schema/index.js';
import { mediaProof } from 'src/utils/media-generation.js';

@Injectable()
export class AssetEditRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  replaceAll(
    assetId: string,
    edits: AssetEditActionItem[],
    {
      includeAnnotations = false,
      saveOriginal,
    }: {
      includeAnnotations?: boolean;
      saveOriginal?: { actorId: string; requestId: string; sourcePath: string; sourceFileChecksum: string };
    } = {},
  ): Promise<AssetEditActionItemResponseDto[]> {
    return this.db.transaction().execute(async (trx) => {
      const asset = await trx
        .selectFrom('asset')
        .select(['id', 'checksum'])
        .where('id', '=', assetId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const preserved =
        includeAnnotations || edits.some((edit) => edit.action === AssetEditAction.Annotate)
          ? []
          : await trx
              .selectFrom('asset_edit')
              .select(['action', 'parameters'])
              .where('assetId', '=', assetId)
              .where('action', '=', AssetEditAction.Annotate)
              .orderBy('sequence', 'asc')
              .execute();
      const actions = [...edits, ...preserved];
      if (saveOriginal) {
        await PhotoSaveStore.request(
          trx,
          assetId,
          saveOriginal,
          mediaProof({ id: assetId, checksum: asset.checksum, edits: actions }),
        );
        return actions.map((edit) => ({ ...edit, id: randomUUID() }));
      }
      await trx.deleteFrom('asset_edit').where('assetId', '=', assetId).execute();

      if (actions.length > 0) {
        return trx
          .insertInto('asset_edit')
          .values(actions.map((edit, i) => ({ assetId, sequence: i, ...edit })))
          .returning(['id', 'action', 'parameters'])
          .execute();
      }

      return [];
    });
  }

  withPhotoSaveLock<T>(id: string, action: () => Promise<T>) {
    return new PhotoSaveStore(this.db).withLock(id, action);
  }
  preparePhotoSave(id: string, requestId: string, path: string) {
    return new PhotoSaveStore(this.db).prepare(id, requestId, path);
  }
  getPhotoSave(id: string, requestId?: string) {
    return new PhotoSaveStore(this.db).get(id, requestId);
  }
  pendingPhotoSaves() {
    return new PhotoSaveStore(this.db).pending();
  }
  commitPhotoSave(id: string, requestId: string, output: RenderedPhoto) {
    return new PhotoSaveStore(this.db).commit(id, requestId, output);
  }
  finalizePhotoSave(id: string, requestId: string) {
    return new PhotoSaveStore(this.db).finalize(id, requestId);
  }
  completePhotoSaveCleanup(id: string, requestId: string) {
    return new PhotoSaveStore(this.db).completeCleanup(id, requestId);
  }
  failPhotoSave(id: string, requestId: string, candidates: string[] = []) {
    return new PhotoSaveStore(this.db).fail(id, requestId, candidates);
  }
  isPhotoPathReferenced(path: string) {
    return new PhotoSaveStore(this.db).isReferenced(path);
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getAll(assetId: string): Promise<AssetEditActionItemResponseDto[]> {
    return this.db
      .selectFrom('asset_edit')
      .select(['id', 'action', 'parameters'])
      .where('assetId', '=', assetId)
      .orderBy('sequence', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getWithSyncInfo(assetId: string) {
    return this.db
      .selectFrom('asset_edit')
      .select(columns.syncAssetEdit)
      .where('action', '!=', AssetEditAction.Annotate)
      .where('assetId', '=', assetId)
      .orderBy('sequence', 'asc')
      .execute();
  }
}
