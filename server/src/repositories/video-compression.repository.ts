import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { AssetFileType, AssetStatus, AssetType, ChecksumAlgorithm } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { type CompressionDraft } from 'src/utils/video-compression.js';

@Injectable()
export class VideoCompressionRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async get(id: string) {
    const row = await this.db
      .selectFrom('video_compression')
      .select('value')
      .where('assetId', '=', id)

      .executeTakeFirst();
    return row?.value as CompressionDraft | undefined;
  }

  async pending() {
    return this.db
      .selectFrom('video_compression')
      .select('assetId')

      .where(
        sql<boolean>`value->>'status' in ('queued', 'processing', 'saving') or jsonb_array_length(value->'cleanup') > 0 or (value->>'status' = 'committed' and value->>'finalized' is distinct from 'true')`,
      )
      .execute();
  }

  async create(id: string, ownerId: string, draft: CompressionDraft) {
    return this.db.transaction().execute(async (tx) => {
      const asset = await tx.selectFrom('asset').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (
        !asset ||
        asset.ownerId !== ownerId ||
        asset.libraryId ||
        asset.deletedAt ||
        asset.isOffline ||
        asset.type !== AssetType.Video ||
        asset.status !== AssetStatus.Active ||
        asset.checksum.toString('base64') !== draft.sourceChecksum ||
        asset.originalPath !== draft.sourcePath
      ) {
        return false;
      }
      const row = await tx
        .selectFrom('video_compression')
        .select('value')
        .where('assetId', '=', id)

        .executeTakeFirst();
      const previous = row?.value as CompressionDraft | undefined;
      if (previous?.requestId === draft.requestId) {
        return previous.sourceChecksum === draft.sourceChecksum && previous.quality === draft.quality;
      }
      if (
        previous &&
        (['queued', 'processing', 'saving'].includes(previous.status) ||
          (previous.status === 'committed' && !previous.finalized))
      ) {
        return false;
      }
      draft.cleanup = previous
        ? [...previous.cleanup, ...(previous.status === 'committed' ? [] : [previous.outputPath])]
        : [];
      await tx
        .insertInto('video_compression')
        .values({ assetId: id, value: draft })
        .onConflict((oc) => oc.columns(['assetId']).doUpdateSet({ value: draft }))
        .execute();
      return true;
    });
  }

  async update(
    id: string,
    requestId: string,
    patch: Partial<CompressionDraft>,
    states: CompressionDraft['status'][],
    producerId?: string,
  ) {
    const result = await this.db
      .updateTable('video_compression')
      .set({ value: sql`value || ${patch}::jsonb` })
      .where('assetId', '=', id)

      .where(sql<string>`value->>'requestId'`, '=', requestId)
      .where(sql<string>`value->>'status'`, 'in', states)
      .$if(producerId !== undefined, (qb) => qb.where(sql<string>`value->>'producerId'`, '=', producerId!))
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async commit(id: string, ownerId: string, requestId: string, sourceChecksum: string) {
    return this.db.transaction().execute(async (tx) => {
      const asset = await tx.selectFrom('asset').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      const row = await tx
        .selectFrom('video_compression')
        .select('value')
        .where('assetId', '=', id)

        .forUpdate()
        .executeTakeFirst();
      const draft = row?.value as CompressionDraft | undefined;
      if (
        !asset ||
        asset.ownerId !== ownerId ||
        asset.libraryId ||
        asset.deletedAt ||
        asset.isOffline ||
        !draft ||
        draft.requestId !== requestId ||
        draft.sourceChecksum !== sourceChecksum
      ) {
        return false;
      }
      if (['saving', 'committed'].includes(draft.status)) {
        return true;
      }
      if (
        draft.status !== 'ready' ||
        !draft.outputChecksum ||
        draft.compressedSize === undefined ||
        asset.checksum.toString('base64') !== sourceChecksum ||
        asset.originalPath !== draft.sourcePath
      ) {
        return false;
      }
      const exif = await tx
        .selectFrom('asset_exif')
        .select('fileSizeInByte')
        .where('assetId', '=', id)
        .executeTakeFirst();
      await tx
        .updateTable('asset')
        .set({
          originalPath: draft.outputPath,
          checksum: Buffer.from(draft.outputChecksum, 'base64'),
          checksumAlgorithm: ChecksumAlgorithm.sha1File,
          originalFileName: asset.originalFileName.replace(/\.[^.]+$/, '') + '.mp4',
        })
        .where('id', '=', id)
        .execute();
      await tx
        .updateTable('asset_exif')
        .set({ fileSizeInByte: draft.compressedSize })
        .where('assetId', '=', id)
        .execute();
      const encoded = await tx
        .deleteFrom('asset_file')
        .where('assetId', '=', id)
        .where('type', '=', AssetFileType.EncodedVideo)
        .returning('path')
        .execute();
      await tx.deleteFrom('asset_keyframe').where('assetId', '=', id).execute();
      await tx
        .updateTable('user')
        .set({
          quotaUsageInBytes: sql`"quotaUsageInBytes" + ${draft.compressedSize - (exif?.fileSizeInByte ?? draft.originalSize)}`,
        })
        .where('id', '=', ownerId)
        .execute();
      const value = {
        ...draft,
        status: 'saving' as const,
        cleanup: [...draft.cleanup, draft.sourcePath, ...encoded.map(({ path }) => path)],
      };
      await tx
        .updateTable('video_compression')
        .set({ value })
        .where('assetId', '=', id)

        .execute();
      return true;
    });
  }

  async isOriginal(path: string) {
    return !!(await this.db.selectFrom('asset').select('id').where('originalPath', '=', path).executeTakeFirst());
  }
}
