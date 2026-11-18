---
title: Video transcription
---

Context search includes spoken content alongside visual content. Enter an ordinary
word, a remembered phrase, or a related description in the existing Context field.
No separate search type or prefix is required.

Speech retrieval combines Russian stemming, word-level PostgreSQL trigrams and
semantic text embeddings from the configured smart-search model. Literal matches
rank first, typo matches next, and meaning matches follow. All query words are
required for the typo fallback. Explicit quotes, exclusions and OR use lexical
search instead of approximate speech matching. Existing people, date, album and
access filters apply to the combined results.

Enable video transcription in Administration → Settings → Machine learning. The
same section controls the speech provider, language and meaning similarity.
GigaAM and OpenAI-compatible audio providers are supported; provider URLs and
credentials stay in administrator configuration. Raising speech meaning similarity
narrows associations; lowering it broadens them. Word matching is independent of
that setting. The existing `speech:` and `речь:` prefixes remain compatible.

Accepted audio segments and derived search windows are checkpointed independently.
Previously transcribed videos are indexed without calling the speech provider
again. Existing vectors are reused after restarts; new audio segments only require
new or changed text windows. Replacing a source, transcript or smart-search model
invalidates the corresponding search evidence. Search indexing runs on the native
smart-search queue and resumes through the transcription recovery scan.

Transcripts are visible in video information. Originals are not modified, and
partner search follows the same permissions as other asset searches.
