import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "short_link" (
  "code" text NOT NULL,
  "userId" uuid NOT NULL,
  "type" text NOT NULL,
  "targetId" uuid NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "short_link_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "short_link_user_target_uq" UNIQUE ("userId", "type", "targetId"),
  CONSTRAINT "short_link_pkey" PRIMARY KEY ("code")
);`.execute(db);
  await sql`CREATE INDEX "short_link_userId_idx" ON "short_link" ("userId");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "short_link";`.execute(db);
}
