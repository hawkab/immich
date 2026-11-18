import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX "asset_metadata_transcript_trgm_idx" ON "asset_metadata" USING gin (lower(coalesce(value->>'text', '')) gin_trgm_ops) WHERE (key = 'org.immich.transcript.v1');`.execute(db);
  await sql`CREATE TABLE "transcript_search" (
  "assetId" uuid NOT NULL,
  "part" integer NOT NULL,
  "partCount" integer NOT NULL,
  "sourceChecksum" text NOT NULL,
  "configuration" text NOT NULL,
  "modelName" text NOT NULL,
  "textChecksum" text NOT NULL,
  "contentChecksum" text NOT NULL,
  "embedding" vector NOT NULL,
  CONSTRAINT "transcript_search_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "transcript_search_pkey" PRIMARY KEY ("assetId", "part")
);`.execute(db);
  await sql`ALTER TABLE "transcript_search" ALTER COLUMN "embedding" SET STORAGE EXTERNAL;`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_asset_metadata_transcript_trgm_idx', '{"type":"index","name":"asset_metadata_transcript_trgm_idx","sql":"CREATE INDEX \\"asset_metadata_transcript_trgm_idx\\" ON \\"asset_metadata\\" USING gin (lower(coalesce(value->>''text'', '''')) gin_trgm_ops) WHERE (key = ''org.immich.transcript.v1'');"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "asset_metadata_transcript_trgm_idx";`.execute(db);
  await sql`DROP TABLE "transcript_search";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_asset_metadata_transcript_trgm_idx';`.execute(db);
}
