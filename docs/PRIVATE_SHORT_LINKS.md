# Private short links

Use **Copy short link** in a photo or video menu. Links use `/s/{code}` and require
normal Immich sign-in and current access to the asset. They never create public
shares or add permissions. The API also supports album and person targets.

Aliases are stable per creator and target, stored in a dedicated table. The
creator can list and revoke them using `/api/short-links`. Access is checked again
on every resolution, including after a partnership or album grant is revoked.
Targets are typed identifiers rather than arbitrary URLs, preventing open redirects.

The standalone web feature redirects authenticated users to canonical Immich
routes. The optional self-hosted app-link feature uses the same authenticated
resolution endpoint and canonical relative-path response; neither feature imports
the other's server implementation. Short links work in a browser without the app.
