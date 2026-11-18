import { sql, type SqlBool } from 'kysely';

export interface SceneRelationIntent {
  predicate: 'riding';
  object: 'horse';
}

export interface SceneRelationActors {
  personIds?: string[];
}

const horse = '(?:лошади|лошадях|коне|конях|пони|жеребце|кобыле)';
const attribute = String.raw`(?:[\p{L}-]+(?:ой|ей|ом|ем|ых|их)|моей|своей|этой|той)`;
const riding = new RegExp(
  String.raw`(?<![\p{L}\p{N}_])(?:верхом\s+)?на\s+(?:${attribute}\s+)*${horse}(?![\p{L}\p{N}_])`,
  'giu',
);

/** Retain an explicit riding relation that Russian full-text stopwords otherwise erase. */
export function resolveSceneRelation(query: string): SceneRelationIntent | undefined {
  const text = query.normalize('NFC');
  for (const match of text.matchAll(riding)) {
    if (!/(?:^|\s)не\s*$/iu.test(text.slice(0, match.index))) {
      return { predicate: 'riding', object: 'horse' };
    }
  }
}

/** Bind the action to current curated people through stable faces, never a guessed name. */
export function sceneRelationMatches(
  intent: SceneRelationIntent,
  includeDepictions: boolean,
  actors: SceneRelationActors,
) {
  const eligible = sql`select scene_relation.value from jsonb_array_elements(
      case when jsonb_typeof(scene.value->'relations') = 'array'
        then scene.value->'relations' else '[]'::jsonb end
    ) scene_relation
    where scene.value->>'relationsSchemaVersion' = '1'
      and scene.value->'relationAnalysis'->'edits' = coalesce((
        select jsonb_agg(jsonb_build_object('action', source_edit.action, 'parameters', source_edit.parameters)
                         order by source_edit.sequence)
        from asset_edit source_edit where source_edit."assetId" = asset.id
      ), '[]'::jsonb)
      and scene_relation.value->>'predicate' = ${intent.predicate}
      and scene_relation.value->>'object' = ${intent.object}
      and jsonb_typeof(scene_relation.value->'depicted') = 'boolean'
      and (${includeDepictions} or scene_relation.value->>'depicted' = 'false')
      and length(trim(coalesce(scene_relation.value->>'evidence', ''))) > 0`;
  const subjects = sql`case when jsonb_typeof(riding_actor.value->'subjectFaceIds') = 'array'
    then riding_actor.value->'subjectFaceIds' else '[]'::jsonb end`;
  const matchesActors = actors.personIds?.length
    ? sql`not exists (
        select 1 from unnest(${`{${actors.personIds}}`}::uuid[]) named_actor(id)
        where not exists (
          select 1 from (${eligible}) riding_actor
          join asset_face actor_face on actor_face."assetId" = asset.id
          where actor_face."deletedAt" is null
            and actor_face."personGroupId" = named_actor.id
            and actor_face.id::text in (select value from jsonb_array_elements_text(${subjects}))
        )
      )`
    : sql`true`;
  return sql<SqlBool>`exists (${eligible}) and ${matchesActors}`;
}
