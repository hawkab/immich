import { BadRequestException, ConflictException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { extname } from 'node:path';
import type { AssetEditActionItem } from 'src/dtos/editing.dto.js';
import { AssetFileType, AssetStatus, AssetType, ChecksumAlgorithm } from 'src/enum.js';
import type { DB } from 'src/schema/index.js';
import { mediaProof, type MediaProof } from 'src/utils/media-generation.js';

const PENDING = sql<boolean>`value->>'status' = 'requested' or jsonb_array_length(value->'cleanup') > 0 or (value->>'status' = 'committed' and value->>'finalized' is distinct from 'true')`;

export type PhotoSave = {
  requestId: string;
  actorId: string;
  sourceChecksum: string;
  generation: string;
  baseGeneration: string;
  edits?: AssetEditActionItem[];
  status: 'requested' | 'committed' | 'failed';
  cleanup: string[];
  outputChecksum?: string;
  sourcePath: string;
  sourceFileChecksum: string;
  preparedPath?: string;
  finalized?: boolean;
};
export type RenderedPhoto = {
  path: string;
  checksum: Buffer;
  size: number;
  width: number;
  height: number;
  thumbhash: Buffer;
  files: { assetId: string; type: AssetFileType; path: string; isProgressive: boolean; isTransparent: boolean }[];
};

/** Transactional save intent and atomic publication of an immutable rendered photo. */
export class PhotoSaveStore {
  constructor(private db: Kysely<DB>) {}

  static async request(
    db: Kysely<DB>,
    id: string,
    request: { actorId: string; requestId: string; sourcePath: string; sourceFileChecksum: string },
    proof: MediaProof,
  ) {
    const asset = await db.selectFrom('asset').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    if (
      asset.libraryId ||
      asset.isExternal ||
      asset.isOffline ||
      asset.deletedAt ||
      asset.status !== AssetStatus.Active ||
      asset.type !== AssetType.Image
    ) {
      throw new BadRequestException('Only available, managed images can replace their original');
    }
    if (asset.originalPath !== request.sourcePath) throw new ConflictException('Source photo changed before saving');
    const store = new PhotoSaveStore(db);
    const previous = await store.get(id);
    if (
      previous &&
      previous.requestId !== request.requestId &&
      (previous.status === 'requested' ||
        previous.cleanup.length > 0 ||
        (previous.status === 'committed' && !previous.finalized))
    ) {
      throw new ConflictException('Previous image save is still running or finalizing');
    }
    const same = await store.get(id, request.requestId);
    if (same) {
      if (same.generation !== proof.generation || same.actorId !== request.actorId)
        throw new ConflictException('Save request ID belongs to different edits');
      if (same.status === 'committed') throw new ConflictException('This save request has already committed');
      if (same.status === 'failed')
        await db
          .updateTable('photo_save')
          .set({ value: { ...same, status: 'requested' } })
          .where('assetId', '=', id)
          .where('requestId', '=', request.requestId)
          .execute();
      return;
    }
    const published = await db
      .selectFrom('asset_edit')
      .select(['action', 'parameters'])
      .where('assetId', '=', id)
      .orderBy('sequence')
      .execute();
    const baseGeneration = mediaProof({ id, checksum: asset.checksum, edits: published }).generation;
    const value: PhotoSave = {
      ...request,
      baseGeneration,
      edits: proof.edits as AssetEditActionItem[],
      sourceChecksum: proof.sourceChecksum,
      generation: proof.generation,
      status: 'requested',
      sourcePath: asset.originalPath,
      cleanup: [],
    };
    await db.insertInto('photo_save').values({ assetId: id, requestId: request.requestId, value }).execute();
  }

  async get(id: string, requestId?: string): Promise<PhotoSave | undefined> {
    const row = await this.db
      .selectFrom('photo_save')
      .select('value')
      .where('assetId', '=', id)
      .$if(requestId !== undefined, (q) => q.where('requestId', '=', requestId!))
      .orderBy(PENDING, 'desc')
      .orderBy('createdAt', 'desc')
      .executeTakeFirst();
    return row?.value as PhotoSave | undefined;
  }

  pending() {
    return this.db.selectFrom('photo_save').select('assetId').distinct().where(PENDING).execute();
  }

  async commit(id: string, requestId: string, output: RenderedPhoto) {
    return this.db.transaction().execute(async (tx) => {
      const asset = await tx.selectFrom('asset').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      const store = new PhotoSaveStore(tx);
      const request = await store.get(id, requestId);
      if (!asset || !request || request.requestId !== requestId || request.status !== 'requested') return false;
      const mayEdit = asset.ownerId === request.actorId;
      if (
        !mayEdit ||
        asset.libraryId ||
        asset.isExternal ||
        asset.isOffline ||
        asset.deletedAt ||
        asset.status !== AssetStatus.Active
      )
        return false;
      const edits = await tx
        .selectFrom('asset_edit')
        .select(['action', 'parameters'])
        .where('assetId', '=', id)
        .orderBy('sequence')
        .execute();
      if (mediaProof({ id, checksum: asset.checksum, edits }).generation !== request.baseGeneration) return false;
      const oldFiles = await tx.selectFrom('asset_file').select('path').where('assetId', '=', id).execute();
      const exif = await tx
        .selectFrom('asset_exif')
        .select('fileSizeInByte')
        .where('assetId', '=', id)
        .executeTakeFirst();
      await tx
        .updateTable('asset')
        .set({
          originalPath: output.path,
          originalFileName: asset.originalFileName.replace(/\.[^.]+$/, '') + extname(output.path),
          checksum: output.checksum,
          checksumAlgorithm: ChecksumAlgorithm.sha1File,
          isEdited: false,
          width: output.width,
          height: output.height,
          thumbhash: output.thumbhash,
        })
        .where('id', '=', id)
        .execute();
      await tx
        .updateTable('asset_exif')
        .set({
          fileSizeInByte: output.size,
          exifImageWidth: output.width,
          exifImageHeight: output.height,
          orientation: '1',
        })
        .where('assetId', '=', id)
        .execute();
      await tx
        .updateTable('user')
        .set({ quotaUsageInBytes: sql`"quotaUsageInBytes" + ${output.size - (exif?.fileSizeInByte ?? output.size)}` })
        .where('id', '=', asset.ownerId)
        .execute();
      await tx.deleteFrom('asset_edit').where('assetId', '=', id).execute();
      await tx.deleteFrom('asset_file').where('assetId', '=', id).execute();
      const files = output.files.filter((f) => f.type !== AssetFileType.FullSize);
      if (files.length > 0)
        await tx
          .insertInto('asset_file')
          .values(files.map((f) => ({ ...f, isEdited: false })))
          .execute();
      const retained = new Set([output.path, ...files.map((f) => f.path)]);
      const cleanup = [
        ...new Set([
          ...request.cleanup,
          asset.originalPath,
          ...oldFiles.map((f) => f.path),
          ...output.files.map((f) => f.path),
        ]).difference(retained),
      ];
      const value: PhotoSave = {
        ...request,
        edits: undefined,
        status: 'committed',
        outputChecksum: output.checksum.toString('base64'),
        cleanup,
      };
      await tx
        .updateTable('photo_save')
        .set({ value })
        .where('assetId', '=', id)
        .where('requestId', '=', requestId)
        .execute();
      return true;
    });
  }

  async withLock<T>(id: string, action: () => Promise<T>) {
    return this.db.connection().execute(async (connection) => {
      await sql`select pg_advisory_lock(hashtextextended(${`photo-save:${id}`}, 0))`.execute(connection);
      try {
        return await action();
      } finally {
        await sql`select pg_advisory_unlock(hashtextextended(${`photo-save:${id}`}, 0))`.execute(connection);
      }
    });
  }
  async prepare(id: string, requestId: string, path: string) {
    await this.patch(id, requestId, { preparedPath: path }, true);
  }
  async completeCleanup(id: string, requestId: string) {
    await this.patch(id, requestId, { cleanup: [] });
  }
  async finalize(id: string, requestId: string) {
    await this.patch(id, requestId, { finalized: true });
  }
  async fail(id: string, requestId: string, candidates: string[] = []) {
    const current = await this.get(id, requestId);
    if (current?.status === 'requested')
      await this.patch(
        id,
        requestId,
        {
          status: 'failed',
          cleanup: [...current.cleanup, ...candidates, ...(current.preparedPath ? [current.preparedPath] : [])],
        },
        true,
      );
  }
  private async patch(id: string, requestId: string, patch: object, onlyRequested = false) {
    await this.db
      .updateTable('photo_save')
      .set({ value: sql`value || ${patch}::jsonb` })
      .where('assetId', '=', id)
      .where('requestId', '=', requestId)
      .$if(onlyRequested, (q) => q.where(sql<string>`value->>'status'`, '=', 'requested'))
      .execute();
  }
  async isReferenced(path: string) {
    return (
      !!(await this.db.selectFrom('asset').select('id').where('originalPath', '=', path).executeTakeFirst()) ||
      !!(await this.db.selectFrom('asset_file').select('id').where('path', '=', path).executeTakeFirst())
    );
  }
}
