import { Column, ForeignKeyColumn, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table.js';
import type { CompressionDraft } from 'src/utils/video-compression.js';

@Table('video_compression')
export class VideoCompressionTable {
  @ForeignKeyColumn(() => AssetTable, { primary: true, onDelete: 'CASCADE', index: false })
  assetId!: string;

  @Column({ type: 'jsonb' })
  value!: CompressionDraft;
}
