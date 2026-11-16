import { sql, type SqlBool } from 'kysely';

export const SCENE_DESCRIPTION_KEY = 'org.immich.scene.v1';

/** Match visible-scene facts only while they still describe this source and edit. */
export function sceneDescriptionMatches(query: string) {
  return sql<SqlBool>`exists (
    select 1 from asset_metadata scene
    where scene."assetId" = asset.id
      and scene.key = ${SCENE_DESCRIPTION_KEY}
      and scene.value->>'schemaVersion' = '1'
      and scene.value->>'sourceChecksum' = encode(asset.checksum, 'base64')
      and coalesce(scene.value->>'thumbhash', '') = coalesce(encode(asset.thumbhash, 'base64'), '')
      and coalesce(scene.value->>'isEdited', 'false') = asset."isEdited"::text
      and to_tsvector('russian',
        case scene.value->>'kind'
          when 'photo' then 'фото фотография снимок '
          when 'screenshot' then 'скриншот '
          when 'document' then 'документ '
          when 'drawing' then 'рисунок иллюстрация '
          else ''
        end || coalesce(scene.value->>'searchText', ''))
        @@ websearch_to_tsquery('russian', ${query})
  )`;
}
