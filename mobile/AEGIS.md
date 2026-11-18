# Immich (Aegis)

This client installs alongside official Immich as `app.alextran.immich.aegis`.
It uses the same server and owner permissions. The official application's data
and signing identity are retained.

**Advanced settings → Keep device and Immich copies independent** is enabled by
default. The ordinary delete action targets owned server copies only. It is
unavailable for a local original without a server copy. **Delete from device**
remains a separate explicit action; deleting an unbacked original requires
confirmation. Automatic trash/deletion synchronization is disabled in both
directions while independence is enabled.

The client records owner-scoped checksums before permanent remote deletion and
before a full remote sync reset. Automatic backup then respects that deletion
instead of uploading the retained device file again. These records survive
client restarts; a different owner's backup and edited files with different
checksums remain eligible. Explicit manual upload remains available. The local
history begins with the server state observed by this installation; its first
synchronization includes existing server trash.

## Build

The repository pins Flutter 3.47.2 and Rust 1.98.0. Tested Flutter bundles Dart
3.13.2; Android uses SDK 36 and NDK 28.2.13676358. Linux FFI generation also needs
libclang and its matching C resource headers. A nonstandard header installation
can be supplied through `C_INCLUDE_PATH` for code generation.

Keep the durable release keystore and its credentials outside the checkout. The
credential JSON contains `alias`, `password`, and the public
`certificate_sha256`; it must be readable only by its owner. Set `ANDROID_HOME`
to the Android SDK and run:

```sh
mise //mobile:build:aegis --credentials /private/release.json \
  --keystore /private/release.jks --output /private/artifacts
```

The task installs dependencies, generates bindings, builds an arm64 release,
checks the APK signature, application ID and ABI, and writes `APK.json` beside
`immich-aegis-arm64.apk`. The same retained signing key is used for updates.
The Aegis OAuth callback scheme is `app.immich.aegis`; an OAuth provider needs
`app.immich.aegis:///oauth-callback` as an additional redirect URL when using
that login method. Password login uses the ordinary Immich endpoint.
