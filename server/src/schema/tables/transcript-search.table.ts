import { Column, ForeignKeyColumn, PrimaryColumn, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table.js';

@Table('transcript_search')
export class TranscriptSearchTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', primary: true, index: false })
  assetId!: string;

  @PrimaryColumn({ type: 'integer' })
  part!: number;

  @Column({ type: 'integer' })
  partCount!: number;

  @Column({ type: 'text' })
  sourceChecksum!: string;

  @Column({ type: 'text' })
  configuration!: string;

  @Column({ type: 'text' })
  modelName!: string;

  @Column({ type: 'text' })
  textChecksum!: string;

  @Column({ type: 'text' })
  contentChecksum!: string;

  @Column({ type: 'vector', storage: 'external' })
  embedding!: string;
}
