# Video compression with a reviewed preview

Open a video you own or have permission to edit and choose **Compress video** in the viewer toolbar. The
popover stays beside its button and contains a quality slider, the measured
original and compressed sizes, and a player for the complete encoded preview.
Move left for a smaller file or right for better quality. Changing the setting
prepares another preview from the current original, without recompressing the
previous preview. Closing the popover preserves the draft; Cancel discards it.

**Save** opens a separate irreversible-replacement confirmation. Until the user
confirms it, the original is unchanged. Confirming keeps the same asset ID,
capture dates, album membership, people and sharing, while atomically updating
the file reference, checksum, size and quota usage. The original and obsolete
playback copy are then removed. There is no undo operation for this replacement.

Previews use software H.264 at the original resolution and frame timing. Audio
tracks are retained, copying compatible audio without another lossy encode.
HDR is tone mapped to SDR for browser playback. Standard container metadata and
chapters are copied; private camera data streams are not part of the output.
The quality control spans the encoder's CRF range, with a balanced default. It
does not promise a particular output size: the size shown is measured after the
full encoding completes.

The native video-conversion queue runs the work asynchronously. Drafts live in
a dedicated internal table rather than writable asset metadata. Request IDs
reconcile repeated submissions; source checksums reject stale previews; worker
generation IDs keep a recovered worker from publishing superseded output.
Queued encodes and committed replacements with unfinished cleanup resume after
server restart. An interrupted preview can be regenerated from the retained
original, without imposing a total-video deadline.

Owners and partners with the existing edit grant can use this operation; there
is no separate compression grant. API keys need asset-edit-create permission;
preview playback also requires asset-download permission. A shared view alone
and shared links do not authorize compression. The grant is checked again when
saving, and quota changes belong to the video owner. External-library originals
remain managed outside this workflow.

The feature branch is `feature/video-compression`; the locally deployed fork
also includes it in `feature/combined-photo-tools`. The signed common installer
pins the same image for clean installation and application upgrades.
