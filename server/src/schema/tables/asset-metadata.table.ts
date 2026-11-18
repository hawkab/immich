import {
  AfterDeleteTrigger,
  Column,
  ForeignKeyColumn,
  Index,
  PrimaryColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
  type Generated,
} from '@immich/sql-tools';
import { UpdateIdColumn, UpdatedAtTrigger } from 'src/decorators.js';
import { AssetMetadataKey } from 'src/enum.js';
import { asset_metadata_audit } from 'src/schema/functions.js';
import { AssetTable } from 'src/schema/tables/asset.table.js';

@UpdatedAtTrigger('asset_metadata_updated_at')
@Table('asset_metadata')
@Index({
  name: 'asset_metadata_transcript_ru_idx',
  using: 'gin',
  expression: "to_tsvector('russian'::regconfig, coalesce(value->>'text', ''))",
  where: "key = 'org.immich.transcript.v1'",
})
@Index({
  name: 'asset_metadata_transcript_simple_idx',
  using: 'gin',
  expression: "to_tsvector('simple'::regconfig, coalesce(value->>'text', ''))",
  where: "key = 'org.immich.transcript.v1'",
})
@Index({
  name: 'asset_metadata_transcript_trgm_idx',
  using: 'gin',
  expression: "lower(coalesce(value->>'text', '')) gin_trgm_ops",
  where: "key = 'org.immich.transcript.v1'",
})
@AfterDeleteTrigger({
  scope: 'statement',
  function: asset_metadata_audit,
  referencingOldTableAs: 'old',
  when: 'pg_trigger_depth() = 0',
})
export class AssetMetadataTable {
  @ForeignKeyColumn(() => AssetTable, {
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    primary: true,
    //  [assetId, key] is the PK constraint
    index: false,
  })
  assetId!: string;

  @PrimaryColumn({ type: 'character varying' })
  key!: AssetMetadataKey | string;

  @Column({ type: 'jsonb' })
  value!: Record<string, unknown>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;

  @UpdateDateColumn({ index: true })
  updatedAt!: Generated<Timestamp>;
}
