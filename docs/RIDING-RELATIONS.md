# Source-bound riding relations

Russian full-text search drops the preposition in `Маша на лошади`. A named face
and an unrelated horse, including a plush toy, could therefore satisfy the query.
An explicit riding query now requires a visually authored relation in the current
`org.immich.scene.v1` metadata:

```json
{
  "relationsSchemaVersion": 1,
  "relationAnalysis": { "edits": [] },
  "relations": [{
    "predicate": "riding",
    "object": "horse",
    "subjectFaceIds": ["a-native-face-uuid"],
    "depicted": false,
    "evidence": "A child in a hat is seated astride the pony."
  }]
}
```

`horse` includes ponies. `subjectFaceIds` identifies native faces in this same
asset, without model-generated names or person-group IDs. Search resolves these
faces against the current curated groups, so renaming or merging people does not
invalidate their role. Every named person must belong to a matching riding
relation; different people may ride different horses. Deleted faces or faces
from another asset cannot supply the identity.

The existing source checksum and rendered thumbnail checks apply to the whole
scene. `relationAnalysis.edits` retains the ordered native edit actions and their
parameters; search compares these with the actual edit rows, also rejecting an
edited-to-edited change before a thumbnail hash is regenerated. An enrichment producer retains the
existing facts and records its own prompt, actual model output, usage and face
context binding. An uncertain actor has no guessed face association. Older
scene documents remain valid for ordinary object searches and receive targeted
relation enrichment before the new riding behavior is deployed.

Bare `лошадь` searches retain their existing behavior. `includeDepictions`
continues to control representations: it may include a child actually riding a
toy horse, but a toy standing elsewhere in the room does not establish riding.
Similarity thresholds, face assignments and original photographs are unchanged.
