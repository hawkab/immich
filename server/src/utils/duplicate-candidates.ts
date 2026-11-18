import { sql, type Kysely } from 'kysely';
import { type DB } from 'src/schema/index.js';
import { anyUuid } from 'src/utils/database.js';

export type DuplicateCandidateMode = 'content' | 'size' | 'name' | 'metadata';

export interface CandidateGroup {
  key: string;
  reason: string;
  assetIds: string[];
  totalGroups: number;
}

export async function duplicateCandidates(
  db: Kysely<DB>,
  userIds: string[],
  mode: DuplicateCandidateMode,
  page: number,
  size: number,
): Promise<CandidateGroup[]> {
  const signatures = {
    size: sql`case when e."fileSizeInByte" > 0 then a.type || ':' || e."fileSizeInByte"::text end`,
    name: sql`case when a."originalFileName" <> '' then a.type || ':' || lower(normalize(a."originalFileName", NFC)) end`,
    metadata: sql`case when e."exifImageWidth" > 0 and e."exifImageHeight" > 0 then
      a.type || ':' || date_trunc('second', coalesce(e."dateTimeOriginal", a."fileCreatedAt"))::text || ':' ||
      e."exifImageWidth"::text || ':' || e."exifImageHeight"::text end`,
    content: sql`encode(a.checksum, 'hex')`,
  };
  const grouped =
    mode === 'content'
      ? sql`
    select 'checksum:' || signature as key, 'checksum' as reason, array_agg(id order by id) as "assetIds"
    from eligible group by signature having count(*) > 1
    union all
    select 'visual:' || "duplicateId"::text as key, 'visual' as reason, array_agg(id order by id) as "assetIds"
    from eligible where "duplicateId" is not null group by "duplicateId" having count(*) > 1
  `
      : sql`
    select ${mode} || ':' || signature as key, ${mode} as reason, array_agg(id order by id) as "assetIds"
    from eligible where signature is not null group by signature having count(*) > 1
  `;
  const result = await sql<CandidateGroup>`
    with eligible as (
      select a.id, a."duplicateId", ${signatures[mode]} as signature
      from asset a left join asset_exif e on e."assetId" = a.id
      where a."ownerId" = ${anyUuid(userIds)} and a."deletedAt" is null and a.visibility = 'timeline'
    ), grouped as (${grouped}), unique_groups as (
      select distinct on ("assetIds") key, reason, "assetIds" from grouped
      order by "assetIds", case when reason = 'checksum' then 0 else 1 end, key
    )
    select key, reason, "assetIds", count(*) over()::integer as "totalGroups"
    from unique_groups order by cardinality("assetIds") desc, key
    offset ${(page - 1) * size} limit ${size + 1}
  `.execute(db);
  return result.rows;
}
