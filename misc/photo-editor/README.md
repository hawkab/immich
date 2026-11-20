# Blur regions and emoji in the photo editor

Open **Edit → Blur and emoji**. Draw a rectangle or paint with the round brush, then choose **Pixelated** or **Frosted glass** and adjust the strength. Select a saved layer in the layer list to change its effect or remove it. Undo and redo operate on whole gestures.

**Add emoji** opens an offline catalog of 3,998 Unicode 18 emoji entries, including flags, skin tones and joined sequences. Search by Russian/English name, keyword, symbol or code point. Insert an emoji, use **Move emoji** to drag it and adjust its size. All artwork is bundled; neither the editor nor the renderer sends photos to an external service.

Draft layer coordinates refer to the oriented source, so blur regions and emoji follow their content through crops, rotations and mirrors. Undo and reset apply to the draft. Save renders the complete draft and replaces the photo under its existing ID; the saved pixels contain the blur and emoji.

## API compatibility

Annotation-aware clients pass `includeAnnotations=true` to the existing asset-edit endpoints. Without this opt-in, responses and the legacy edit sync stream contain only the original crop/rotate/mirror operations. Legacy edits and resets preserve stored annotation layers transactionally, so old mobile clients neither fail decoding a new enum nor silently erase a blur. They display the server-rendered edited preview. Legacy layer documents remain readable until they are explicitly baked by the web editor.

Native asset-edit authorization continues to apply. Emoji IDs are validated against the bundled catalog; arbitrary SVG, paths and remote artwork URLs are not accepted.

## Reproducible resources

Run `python3 misc/photo-editor/update_emoji.py` to regenerate client assets and the server allowlist/artwork from SHA-256-pinned sources in `emoji-sources.json`. Catalog and graphics are generated together. Twemoji artwork is CC-BY-4.0; the Unicode 18 additions use OpenMoji artwork under CC-BY-SA-4.0; notices and Emojibase/Unicode licensing are distributed in `web/static/editor-emoji/`.

Sources: [Twemoji](https://github.com/jdecked/twemoji/tree/v17.0.3), [OpenMoji](https://github.com/hfg-gmuend/openmoji/tree/3e01de523ddefe9c5e46a7765b15efef04bf9002), [Emojibase datasets](https://emojibase.dev/docs/datasets/).


## Saving the edited photo

The web editor saves blur and emoji into a lossless full-resolution PNG, replacing the original under the same asset ID. Capture dates, ownership and album links are preserved. Undo and reset operate on the draft before Save. Legacy API clients retain opt-in annotation-layer compatibility; replacing an original requires the explicit replaceOriginal flag and a stable saveRequestId. The private photo_save operation log supports exact request reconciliation after network loss or restart.
