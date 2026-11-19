import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/utils/server_link.dart';

void main() {
  final endpoint = Uri.parse('https://photos.example:8449/api');
  test(
    'opens same-server assets without asking the optional shortlink provider',
    () async {
      final incoming = Uri.parse(
        'https://photos.example:8449/search/photos/123?query=test',
      );
      expect(
        await resolveServerLink(
          incoming,
          endpoint,
          (_) => throw StateError('not needed'),
        ),
        incoming,
      );
    },
  );
  test('resolves a shortlink to its canonical route', () async {
    final incoming = Uri.parse(
      'https://photos.example:8449/s/abcdefghijklmnop',
    );
    expect(
      (await resolveServerLink(
        incoming,
        endpoint,
        (_) async => '/photos/123',
      ))?.path,
      '/photos/123',
    );
  });
  test(
    'rejects foreign origins and redirects without exposing a session token',
    () async {
      for (final url in [
        'https://evil.example/s/abcdefghijklmnop',
        'http://photos.example:8449/s/abcdefghijklmnop',
        'https://photos.example/s/abcdefghijklmnop',
      ]) {
        expect(
          await resolveServerLink(
            Uri.parse(url),
            endpoint,
            (_) => throw StateError('must not contact'),
          ),
          isNull,
        );
      }
      for (final path in [
        'https://evil.example/photos/123',
        '//evil.example/photos/123',
        r'/\evil.example',
      ]) {
        expect(
          await resolveServerLink(
            Uri.parse('https://photos.example:8449/s/abcdefghijklmnop'),
            endpoint,
            (_) async => path,
          ),
          isNull,
        );
      }
    },
  );
  test('works without the optional shortlink feature', () async {
    expect(
      await resolveServerLink(
        Uri.parse('https://photos.example:8449/s/abcdefghijklmnop'),
        endpoint,
        (_) async => null,
      ),
      isNull,
    );
  });
}
