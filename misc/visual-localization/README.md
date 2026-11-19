# Search object localization

Author: Olshansky Grigory

The search explanation uses complete object proposals from a pinned YOLO26 nano ONNX model. The existing configured CLIP encoder measures each proposal's contribution to the query: compare the complete frame with the same frame after masking that object. This preserves framing and scale; cropped-object scores are not compared against a differently composed full image. The returned rectangle covers the detected object in the displayed, orientation-normalized source. If removing no proposal reduces the full-frame score, the explanation stays at frame level and draws no object rectangle.

The worker reads an image from stdin and returns normalized coordinates. It runs on CPU with one inference thread, writes no media, and exits after the request. Object proposals are cached by the existing source-generation identity and reused across queries. Runtime has no model download or external network dependency.

`models.lock.json` records the official AGPL-3.0 model source, SHA-256 and byte size. The Docker build downloads and verifies it. Python dependencies are hash-pinned in `runtime-requirements.txt`. The packaged model integrity is checked before inference.

Run checks from this directory through the repository's `run-mise`: `uv run pytest`, `uv run ruff check .`. The tests cover inverse letterboxing, non-square images, outward bounds, duplicate suppression and model integrity. Server and Chromium tests cover complete-object ablation ranking, source revision binding and frame-only fallback.
