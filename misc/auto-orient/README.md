# Head-up photo orientation

Automatically correct sideways and upside-down photographs using real human
heads rather than assuming that sky is at the top. This is an owner-operated
batch command; it does not add a web button or enable a background job by default.

## How it works

1. Read the displayed preview, respecting its existing EXIF orientation. Originals
   are never downloaded, rewritten or recompressed.
2. First check whether a reliable upright head is already present; those photos
   need no further orientation inference. Otherwise run Immich's existing SCRFD
   face detector in all four quarter-turn orientations. Recognition/identity
   embeddings are not requested. Eyes, nose
   and mouth must have plausible upright geometry. Conflicting head directions
   preserve the photograph, even if one face is larger.
3. For a unique sideways/upside-down candidate, first ask a local vision-language
   model to assess the original composition on its own, without showing a
   preferred correction. If that composition is eligible, independently assess
   the corrected preview. This avoids a corrected portrait drawing attention
   away from its original gallery frame or artistic surroundings. The corrected
   pose must be upright, with a visible body or head/neck/shoulders; a horizon is
   not required. An initially uncertain body pose may be resolved by the corrected
   view, but visible intentional cues in the original always veto the change.
4. Preserve deliberate compositions, lying/leaning people, inverted activities,
   artwork, photographs of screens, collages, conflicting observations and
   uncertain intent. Existing manual edits and the `orientation:keep` tag also
   preserve the image. Artistic intent cannot be inferred perfectly from pixels;
   ambiguous photographs are left unchanged.
5. Apply a 90°, 180° or 270° clockwise correction through Immich's
   [non-destructive editor](https://docs.immich.app/features/editing/). The photo
   retains its identity and capture date. Immich generates its normal edited
   preview; the original remains available and the edit can be reverted in Immich.

Landmark tolerances (20° for eye-line and eye-to-mouth roll) define an upright
head, not an execution budget. They exclude ambiguous diagonal compositions.
The detector uses Immich's existing 0.7 detection score. Processing uses a
1024-pixel inference copy; no original is resized. There are no task deadlines,
photo-count limits, model output-token caps or automatic retry budgets.

## Setup

Install the server from this branch before applying changes. Its optional
`ifUneditedChecksum` API precondition compares the source checksum and checks for
existing edits while holding the asset row lock. Concurrent manual edits and
original replacement return HTTP 412 without overwriting them. Normal editing
remains compatible. The command checks `/api/spec.json` and refuses to write to
older servers that would silently ignore the precondition.

Use an owner API key with `user.read`, `asset.read`, `asset.view`, `asset.edit.get`
and `asset.edit.create` permissions. Run separately for each owner;
sharing a photograph does not grant this batch tool authority to edit it.

```sh
mise //misc/auto-orient:install
cp misc/auto-orient/.env.example /private/path/auto-orient.env
# Set the URLs, model and owner key in the private environment file.
```

The face detector endpoint is Immich's internal ML service. Keep it private and
reach it over a private network or SSH tunnel. The vision endpoint must support
OpenAI-compatible image chat and JSON Schema responses. `ORIENTATION_VISION_API_KEY`
is optional. `SSL_CERT_FILE` selects a private CA without disabling TLS checks.
Only previews go to the explicitly configured inference endpoints.

The combined release also contains the `immich-auto-orient` command and its
isolated Python runtime inside the server image. For unattended operation,
`IMMICH_CREDENTIAL_FILE` can point to a read-only mounted JSON file containing
`email` and `password` instead of using an API key. The command creates a private
session and revokes that session on exit. `IMMICH_EXPECTED_OWNER_ID` verifies the
authenticated owner before opening its state directory. Credentials remain in
the protected file and process memory, not in the image or Docker configuration.

## Run

Load the private environment variables in the calling shell, then:

```sh
# Read-only analysis of every owned photograph.
mise //misc/auto-orient:run scan --all --state /private/path/orientation-state

# Apply the saved proposals without loading either model again.
mise //misc/auto-orient:run apply --all --state /private/path/orientation-state

# Or analyse and automatically apply eligible corrections in one command.
mise //misc/auto-orient:run run --all --state /private/path/orientation-state

# Select particular photographs instead of the whole library.
mise //misc/auto-orient:run scan --asset-id ASSET_UUID --state /private/path/orientation-state
```

Private SQLite receipts retain the source checksum, preview digest, four-way
head observations, scene assessment, model, prompt digest and accepted edit IDs.
The state directory is locked against concurrent runs and bound to one server
and owner. Re-running resumes saved work and does not rotate a photo twice or
reapply an edit the owner has reverted. Use a new state directory to explicitly
reassess images with a changed policy/model.
Saved proposals from an older prompt are preserved as `policy_changed` rather
than applied under a different policy.

If a write response is lost, inspect existing edits before doing anything else.
A matching edit is recorded as `accepted_unattributed`; no second write is sent
and authorship is not invented. An unknown outcome without a matching edit is
`needs_reconciliation`, not an invitation to repeat an uncertain write. Full
receipts remain in the private state directory.

Videos, Live Photos, panoramas, GIFs and SVGs are preserved because Immich's
quarter-turn editor does not support them. No image without a reliable head
orientation is changed.

## Verification

```sh
mise //misc/auto-orient:test
mise //misc/auto-orient:lint
mise //misc/auto-orient:check
mise //server:test --run src/controllers/asset.controller.spec.ts src/services/asset.service.spec.ts
mise //server:test-medium --run test/medium/specs/repositories/asset-edit.repository.spec.ts
```

Tests cover all quarter turns, anatomical consistency, artistic/physical vetoes,
EXIF normalization, concurrent manual edits, replaced sources, durable receipts,
uncertain-write recovery and explicit user reverts. PostgreSQL tests exercise the
actual locking and atomic precondition, including simultaneous automatic edits.
