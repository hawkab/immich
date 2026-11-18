import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX "asset_metadata_transcript_simple_idx" ON "asset_metadata" USING gin (to_tsvector('simple'::regconfig, coalesce(value->>'text', ''))) WHERE (key = 'org.immich.transcript.v1');`.execute(db);
  await sql`CREATE INDEX "asset_metadata_transcript_ru_idx" ON "asset_metadata" USING gin (to_tsvector('russian'::regconfig, coalesce(value->>'text', ''))) WHERE (key = 'org.immich.transcript.v1');`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_asset_metadata_transcript_simple_idx', '{"type":"index","name":"asset_metadata_transcript_simple_idx","sql":"CREATE INDEX \\"asset_metadata_transcript_simple_idx\\" ON \\"asset_metadata\\" USING gin (to_tsvector(''simple''::regconfig, coalesce(value->>''text'', ''''))) WHERE (key = ''org.immich.transcript.v1'');"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_asset_metadata_transcript_ru_idx', '{"type":"index","name":"asset_metadata_transcript_ru_idx","sql":"CREATE INDEX \\"asset_metadata_transcript_ru_idx\\" ON \\"asset_metadata\\" USING gin (to_tsvector(''russian''::regconfig, coalesce(value->>''text'', ''''))) WHERE (key = ''org.immich.transcript.v1'');"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "asset_metadata_transcript_simple_idx";`.execute(db);
  await sql`DROP INDEX "asset_metadata_transcript_ru_idx";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_asset_metadata_transcript_simple_idx';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_asset_metadata_transcript_ru_idx';`.execute(db);
}
