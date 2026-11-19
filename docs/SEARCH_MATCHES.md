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
