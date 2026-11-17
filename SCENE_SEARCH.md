# Scene-aware photo search

This release keeps fast CLIP ranking and adds two complementary constraints:

- An exact saved person name in a query becomes a person filter. The remaining
  words describe the scene. Hidden names and other users' private catalogues are
  not consulted; ambiguous names are not silently assigned to one person.
- Source-bound scene descriptions can filter Russian queries using PostgreSQL
  full-text search and Russian stemming. Thus an aircraft mention on a boarding
  pass need not match an aircraft visible in a photo. Existing asset access rules
  apply before pagination.
- Descriptions distinguish real subjects from subjects present only in a toy,
  drawing, model, sculpture or written mention. Default recognised-content
  search excludes those represented-only concepts. For example, an aircraft
  wing qualifies as an aircraft; a painting of an aircraft does not. The web
  search panel and `includeDepictions: true` restore represented subjects.

The web search panel offers recognised content and broader visual similarity.
The server administrator enables recognised-content search after indexing. A
request can override this with `useSceneDescriptions: true/false`. Optional
`minSimilarity` is disabled by default: a single global cosine cutoff removed
relevant photos in the measured library.

## Metadata contract

An owner-authorised indexer writes standard Immich asset metadata under
`org.immich.scene.v1`:

```json
{
  "schemaVersion": 1,
  "sourceChecksum": "original checksum from the asset API",
  "thumbhash": "preview thumbhash from the asset API",
  "isEdited": false,
  "kind": "photo",
  "searchText": "ребёнок, скульптура самолёта, парк",
  "depictedOnly": ["самолёт"],
  "depictedText": "самолёт"
}
```

The indexer includes model/prompt provenance and resumable-publication fields.
`depictedOnly` lists concepts that are represented but not also physically
present; `depictedText` is their flattened Russian search form. PostgreSQL
removes only those stemmed concepts from the default evidence vector. The
original description remains intact. Legacy descriptions are refined from
accepted facts without repeating image inference; ambiguous facts require
another look at the actual preview. Originals,
EXIF descriptions and face labels are independent of this namespace. Retrieval
rejects descriptions after the source checksum, preview hash or edit state changes.
Videos can be indexed from their preview; this does not describe unseen frames.

This fork does not embed a new vision endpoint in the Immich server. The common
installer runs a separate resumable indexer against the configured local Spark1
and owner-authenticated APIs. New uploads are indexed on subsequent scans.

Recognition runs on inference copies, preserving originals. The initial pass
activates recognised-content search only when all configured libraries are
ready. Later scans process new and modified assets using server-clock
watermarks, with a daily full audit and a durable publication outbox. Files
without a visual stream are reported separately rather than labelled as
recognised photos. Existing face labels are preserved.
