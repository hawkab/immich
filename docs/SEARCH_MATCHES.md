# Search result evidence

Search results carry a source-bound explanation computed alongside admission to
the result set. The grid badge and the asset information panel distinguish
visual similarity, indexed scene words, literal speech, fuzzy speech and semantic
speech matches. Metadata constraints and recognized-person names remain visible.
Speech matches include an actual timestamped excerpt; semantic excerpts reuse
the same indexed text-window boundaries without a second model call.

Opening a result directly can request a single-asset explanation through the
same search endpoint. Every original filter and normal asset permission remains
in force. Evidence for a changed original is hidden. Similarity is described as
similarity, not as a verified object label or a probability.

## Interactive evidence

Search explanations link the matched speech excerpt to the existing timestamped transcript.
Selecting it expands the transcript, scrolls to the overlapping segments and pulses their highlight;
the timestamp seeks the current asset's player. Reduced-motion preferences disable pulsing and smooth scrolling.

Selecting a visual explanation first detects complete objects in the rendered image with the packaged,
hash-pinned CPU detector. The configured CLIP model compares the whole frame with the same frame after
each detected object is masked. The object whose removal most reduces query similarity supplies the box.
This preserves image scale and composition instead of comparing arbitrary cropped fragments with a full image.
The box is mapped through exact letterboxing and rounded outwards to contain the detected object. If no
detected object contributes, the explanation identifies whole-frame similarity without an object rectangle.
Detector proposals are reused for queries of the same source generation; failed inference remains recoverable.
The model and dependencies are installed in the application image, with no runtime model download.

For video, the viewer checks actual frames throughout the duration at one-second spacing, then localizes
the strongest sampled frame. Its clickable timestamp seeks and pauses that frame with the same region overlay.
The overlay disappears when playback moves away; it never tracks an object across unexamined frames.
This refinement is requested on click and does not rerun library indexing or change search admission.
Progress can be paused; completed frame queries are reused when resumed. There is no overall analysis deadline.

The API verifies current access to both the asset and any image reference, binds evidence to checksum,
logical edits and the CLIP model, and rechecks access and media generation after inference. Normalized
coordinates refer to the displayed, oriented preview or decoded video frame. Edits must have a current
rendered preview; stale evidence is rejected. No media is sent outside the configured local ML endpoint.
