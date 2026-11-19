typedef ShortLinkLookup = Future<String?> Function(String code);

const appLinkOrigin = String.fromEnvironment(
  'IMMICH_APP_LINK_ORIGIN',
  defaultValue: 'https://my.immich.app',
);

bool sameLinkOrigin(Uri first, Uri second) =>
    first.scheme == 'https' &&
    second.scheme == 'https' &&
    first.host == second.host &&
    first.port == second.port &&
    first.userInfo.isEmpty &&
    second.userInfo.isEmpty;

Future<Uri?> resolveServerLink(
  Uri incoming,
  Uri endpoint,
  ShortLinkLookup lookup,
) async {
  if (!sameLinkOrigin(incoming, endpoint)) return null;
  final segments = incoming.pathSegments;
  if (segments.length == 2 &&
      segments.first == 's' &&
      RegExp(r'^[A-Za-z0-9_-]{16}$').hasMatch(segments.last)) {
    final path = await lookup(segments.last);
    if (path == null ||
        !path.startsWith('/') ||
        path.startsWith('//') ||
        path.contains('\\'))
      return null;
    final target = Uri.tryParse(path);
    if (target == null || target.hasScheme || target.hasAuthority) return null;
    return incoming.replace(
      path: target.path,
      query: target.hasQuery ? target.query : null,
      fragment: '',
    );
  }
  return incoming;
}
