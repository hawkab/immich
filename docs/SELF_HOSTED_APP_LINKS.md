# Self-hosted Android links

Build the Android client with `--dart-define=IMMICH_APP_LINK_ORIGIN=https://photos.example:8449`.
The same value controls manifest host/port registration and runtime origin checks.
The active signed-in server must have the same HTTPS origin; a link never switches
servers or forwards credentials elsewhere. Existing `immich://` and My Immich
links remain supported.

Publish `/.well-known/assetlinks.json` on the HTTPS hostname using the signing
certificate fingerprint of this application. Android verifies the hostname on
port 443. Private IP addresses, nonstandard ports and a privately trusted CA may
require the user to enable that hostname in Android's supported-link settings.
A user selection must be recorded as a user selection, not as domain verification.

Short links are an optional independent protocol: `GET /api/short-links/{code}`
returns a same-server relative `path` after the usual authentication and object
access checks. The mobile resolver invokes it only for `/s/{code}` links. Its
absence does not affect ordinary asset/album/person links.
