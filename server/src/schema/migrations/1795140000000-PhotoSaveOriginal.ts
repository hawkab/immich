import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "photo_save" (
    "assetId" uuid NOT NULL,
    "requestId" uuid NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "value" jsonb NOT NULL,
    CONSTRAINT "photo_save_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON DELETE CASCADE,
    CONSTRAINT "photo_save_pkey" PRIMARY KEY ("assetId", "requestId")
  );`.execute(db);
  await sql`CREATE INDEX "photo_save_assetId_createdAt_idx" ON "photo_save" ("assetId", "createdAt");`.execute(db);
}
export async function down(db: Kysely<any>): Promise<void> { await sql`DROP TABLE "photo_save";`.execute(db); }
