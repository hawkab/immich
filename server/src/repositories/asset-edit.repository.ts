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

  replaceAll(
    assetId: string,
    edits: AssetEditActionItem[],
    options?: {
      includeAnnotations?: boolean;
      ifUneditedChecksum?: string;
      saveOriginal?: { actorId: string; requestId: string; sourcePath: string; sourceFileChecksum: string };
    },
  ): Promise<AssetEditActionItemResponseDto[]>;
  replaceAll(
    assetId: string,
    edits: AssetEditActionItem[],
    ifUneditedChecksum: string,
  ): Promise<AssetEditActionItemResponseDto[] | null>;
  @GenerateSql({ params: [DummyValue.UUID] })
  replaceAll(
    assetId: string,
    edits: AssetEditActionItem[],
    options?:
      | string
      | {
          includeAnnotations?: boolean;
          ifUneditedChecksum?: string;
          saveOriginal?: { actorId: string; requestId: string; sourcePath: string; sourceFileChecksum: string };
        },
  ): Promise<AssetEditActionItemResponseDto[] | null> {
    const ifUneditedChecksum = typeof options === 'string' ? options : options?.ifUneditedChecksum;
    const includeAnnotations = typeof options === 'object' && options.includeAnnotations === true;
    return this.db.transaction().execute(async (trx) => {
      const asset = await trx
        .selectFrom('asset')
        .select(['checksum', 'isEdited'])
        .where('id', '=', assetId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (ifUneditedChecksum !== undefined) {
        const existing = await trx
          .selectFrom('asset_edit')
          .select('id')
          .where('assetId', '=', assetId)
          .executeTakeFirst();
        if (asset.isEdited || existing || !asset.checksum.equals(Buffer.from(ifUneditedChecksum, 'base64'))) {
          return null;
        }
      }
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
      const saveOriginal = typeof options === 'object' ? options.saveOriginal : undefined;
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
