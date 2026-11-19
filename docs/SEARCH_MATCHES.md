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

Selecting a visual explanation measures cosine similarity with the configured CLIP model against
rendered image regions. It tests overlapping square crops at two scales and shows the strongest region only
when its measured similarity exceeds the whole image. These are relevance regions, not object-detector boxes.
If no crop improves the score, the explanation explicitly identifies whole-frame similarity.

For video, the viewer checks actual frames throughout the duration at one-second spacing, then localizes
the strongest sampled frame. Its clickable timestamp seeks and pauses that frame with the same region overlay.
The overlay disappears when playback moves away; it never tracks an object across unexamined frames.
This refinement is requested on click and does not rerun library indexing or change search admission.
Progress can be paused; completed frame queries are reused when resumed. There is no overall analysis deadline.

The API verifies current access to both the asset and any image reference, binds evidence to checksum,
logical edits and the CLIP model, and rechecks access and media generation after inference. Normalized
coordinates refer to the displayed, oriented preview or decoded video frame. Edits must have a current
rendered preview; stale evidence is rejected. No media is sent outside the configured local ML endpoint.
