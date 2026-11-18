import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "video_compression" (
  "assetId" uuid NOT NULL,
  "value" jsonb NOT NULL,
  CONSTRAINT "video_compression_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "video_compression_pkey" PRIMARY KEY ("assetId")
);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "video_compression";`.execute(db);
}
