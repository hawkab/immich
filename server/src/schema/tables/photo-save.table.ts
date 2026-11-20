import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Index,
  PrimaryColumn,
  Table,
  type Generated,
  type Timestamp,
} from '@immich/sql-tools';
import type { PhotoSave } from 'src/repositories/photo-save.store.js';
import { AssetTable } from 'src/schema/tables/asset.table.js';

/** Private, durable operation records; never client-writable asset metadata. */
@Table('photo_save')
@Index({ name: 'photo_save_assetId_createdAt_idx', columns: ['assetId', 'createdAt'] })
export class PhotoSaveTable {
  @ForeignKeyColumn(() => AssetTable, { primary: true, onDelete: 'CASCADE', index: false })
  assetId!: string;

  @PrimaryColumn({ type: 'uuid' })
  requestId!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @Column({ type: 'jsonb' })
  value!: PhotoSave;
}
