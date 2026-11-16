# Scene-aware photo search

This release keeps fast CLIP ranking and adds two complementary constraints:

- An exact saved person name in a query becomes a person filter. The remaining
  words describe the scene. Hidden names and other users' private catalogues are
  not consulted; ambiguous names are not silently assigned to one person.
- Source-bound scene descriptions can filter Russian queries using PostgreSQL
  full-text search and Russian stemming. Thus an aircraft mention on a boarding
  pass need not match an aircraft visible in a photo. Existing asset access rules
  apply before pagination.

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
  "searchText": "крыло самолёта, облака, вид из иллюминатора"
}
```

The indexer may include provenance and resumable-publication fields. Originals,
EXIF descriptions and face labels are independent of this namespace. Retrieval
rejects descriptions after the source checksum, preview hash or edit state changes.
Videos can be indexed from their preview; this does not describe unseen frames.

This fork does not embed a new vision endpoint in the Immich server. The common
installer runs a separate resumable indexer against the configured local Spark1
and owner-authenticated APIs. New uploads are indexed on subsequent scans.
