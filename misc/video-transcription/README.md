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
