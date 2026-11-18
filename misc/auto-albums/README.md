# Automatic albums and memory movies

Author: Olshansky Grigory.

New uploads join stable albums by capture month, confirmed subjects and recorded
location. Late imports are grouped by the date the picture was taken. A late
earlier picture keeps the existing city/month collection instead of creating a
second album. All matching originals remain members; highlight selection only
affects the short movie.

Memories use chronological, diverse frames with original procedural music, gentle
movement and a final collage. Portraits fit completely over a blurred background.
Native duplicate groups and favorites guide selection. Screenshots and documents
are organized separately and do not become family highlight movies. Videos use
their native display frame in this version.

The default presentation is 45 seconds. This is an editable movie format, not an
execution deadline. Albums are updated first; one render runs at a time and yields
to newly arriving source events. Current events settle briefly before an edition;
historical collections can be rendered after their initial snapshot. The registry
caches output and safely reconciles uncertain publication without duplicate albums
or films. Generated output never becomes a new source for its own curation.

Automatic albums have an ownership marker in their description. Changing their
name or cover preserves the user's choice. Removing the marker detaches the album
from automatic maintenance; deleting an automatic album does not recreate it.
Manual additions remain, manual removals become exclusions, and deleting a
generated film suppresses automatic replacement. Retired films remain archived;
the worker changes only its album membership and never deletes originals.

Each configured account is processed with its own native session. Inputs and
generated films remain owner-scoped. Sharing is private by default and uses native
album roles only when explicitly configured. Secrets, event receipts and source
images belong in the protected operational directory, outside this repository.

The event spool provides immediate dirty signals. Incremental API reconciliation
and a daily metadata-only census recover missed events. Existing source-bound
scene descriptions are reused without a second whole-library model pass.
Edited previews require a producer-bound immutable generation and actual native
media kind; legacy output requests a targeted native thumbnail job.

## Tests and execution

Dependencies: Python, Pillow, NumPy, FFmpeg with libx264/AAC and DejaVu Sans.

```sh
mise //misc/auto-albums:test
PYTHONPATH=misc/auto-albums python3 -m photo_memories.runtime /protected/memory-profile.json
```

The common Proxmox installer provisions dependencies, the encrypted event spool,
native event hooks and the single-consumer service on the application node.

The design draws on [Google Photos highlight videos](https://support.google.com/photos/answer/6128862)
and [Apple Photos memories](https://support.apple.com/guide/iphone/iphee2ee53fe/ios):
people, places and activities define the collection; a paced story and music
define the movie. It uses the existing [Immich API](https://api.immich.app/)
and [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html).
