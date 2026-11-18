# Automatic photo albums

Author: Olshansky Grigory.

Uploads join stable albums by capture month, visible subjects and recorded
location after source-bound scene analysis is available. Late imports use the
capture date. All eligible originals remain album members.

Graves, gravestones, cemeteries, burials and mourning scenes are excluded from
all automatic collections, including date and location albums. Confirmed
exclusions are remembered by original checksum so another caption or duplicate
import does not reintroduce them. Original files remain in the photo library and
search. Ordinary public monuments, flower wreaths and toys are not burial evidence.
A portrait depicted on an object does not by itself mean games or creativity.

The worker does not generate videos, music, collages or derived media. The signed
installer retires outputs from the previous generator: an owner-bound metadata
marker or exact persisted upload receipt must prove their origin. Only those
videos are detached from albums and moved to the recoverable native Trash.
Original photographs and authored videos are preserved. Verified legacy cache
files are removed while diagnostic receipts remain.

Managed albums preserve user names, covers, additions and exclusions. Removing
the description marker detaches an album; deleting an album does not recreate it.
The burial policy also removes known burial photographs manually added to a
managed collection. Independently authored albums are not maintained by this worker.

Each account uses its own native session and albums are private by default.
Native upload and metadata events plus incremental and daily API reconciliation
keep memberships current. Accepted work survives restarts; uncertain writes are
read back before another mutation. Native album-scoped timeline queries supply
actual membership, including partner additions and archived media.

## Tests and execution

The album worker uses the Python standard library. The existing scene indexer
retains its independent image-processing dependencies.

```sh
mise //misc/auto-albums:test
PYTHONPATH=misc/auto-albums python3 -m photo_memories.runtime /protected/album-profile.json
```

The common installer provisions the encrypted event spool, source manifest,
legacy-output retirement and single-consumer service. Credentials, family images
and operational receipts remain outside this repository.
