import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database.js';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetEditAction, AssetEditActionItem, AssetEditActionItemResponseDto } from 'src/dtos/editing.dto.js';
import { DB } from 'src/schema/index.js';

@Injectable()
export class AssetEditRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  replaceAll(
    assetId: string,
    edits: AssetEditActionItem[],
    options?: { includeAnnotations?: boolean },
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
    options?: string | { includeAnnotations?: boolean },
  ): Promise<AssetEditActionItemResponseDto[] | null> {
    const ifUneditedChecksum = typeof options === 'string' ? options : undefined;
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
