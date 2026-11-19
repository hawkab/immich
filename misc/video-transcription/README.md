# Video speech search

Configure **Administration → Settings → Machine Learning → Video transcription**.
The default provider is the GigaAM gateway at Raspberry/Asterisk, using
`v3_e2e_ctc` and Russian. An OpenAI-compatible audio API can be selected instead;
its endpoint, model, language and optional API key are administrator settings.
The common Proxmox installer enables the feature; a generic standalone Immich
installation enables it in administration.

Existing videos are backfilled automatically. New videos enter the native
**Transcription** queue after metadata extraction. The default concurrency is
one, matching the Raspberry inference slot. Audio is decoded directly into
16 kHz mono PCM, one GigaAM model window at a time. Video length is unrestricted;
completed segments are checkpointed in `org.immich.transcript.v1` metadata.
Original media and descriptions remain unchanged.

Search normally to include speech matches, or use **`speech: words`** /
**`речь: слова`** for speech only. Speech-only search works without CLIP.
The video information panel shows the transcript and segment timestamps.
Search retains the existing owner, partner, album, locked-media and trash filters.
Russian morphology and literal words are indexed separately in PostgreSQL.

A restart resumes the first unfinished segment. An uncertain gateway request is
reconciled using its stable request ID; confirmed transient HTTP failures get a
new request identity. No successful audio segment is retranscribed during normal
recovery. The admin queue exposes failures and supports explicit reprocessing.

### Speech search relevance

Fuzzy speech search compares complete normalized words with `pg_trgm` strict-word similarity. Russian inflections remain supported, and misspellings such as `Камчтка` still match `Камчатку`. A shared prefix such as `ко` in `коза`, `кофе`, or `копали` is insufficient evidence. Excerpt selection uses the same whole-word representation.

Text-to-text semantic scoring removes the common embedding mean before cosine comparison. The mean is calculated once per request from current transcript embeddings of the selected model and dimension, within the viewer's permitted owner scope; locked, trashed, stale and incompatible rows are excluded. Explain requests use the same scope as ordinary searches. This is query-time calibration: stored vectors, transcription, visual image matching and the configured relevance threshold are unchanged. A zero residual supplies no semantic evidence.

The normalization is motivated by [mean removal in embedding postprocessing](https://arxiv.org/abs/1702.01417) and verified with actual configured-model contrasts as well as PostgreSQL regressions. The implementation removes the mean; it does not perform the paper's principal-component removal. [PostgreSQL strict-word operators](https://www.postgresql.org/docs/14/pgtrgm.html) supply the whole-word fuzzy comparison.
