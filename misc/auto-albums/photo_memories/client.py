from email.utils import parsedate_to_datetime
import json
from pathlib import Path
import ssl
import urllib.error
import urllib.parse
import urllib.request


class Owner:
    def __init__(self, profile, credential_file):
        self.root = profile['immich_url'].rstrip('/') + '/api'
        self.tls = ssl.create_default_context(cafile=profile['ca_file'])
        self.token = None
        self.server_started_at = None
        credential = json.loads(Path(credential_file).read_text())
        self.token = self.call('/auth/login', {key: credential[key] for key in ('email', 'password')})['accessToken']
        self.user = self.call('/users/me')
        self.id = self.user['id']

    def call(self, path, value=None, method=None, raw=False, include_headers=False):
        headers = {'Content-Type': 'application/json'}
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        request = urllib.request.Request(self.root + path, headers=headers, method=method,
            data=None if value is None else json.dumps(value).encode())
        with urllib.request.urlopen(request, context=self.tls) as response:
            if self.server_started_at is None and response.headers.get('Date'):
                self.server_started_at = parsedate_to_datetime(response.headers['Date'])
            result = response.read()
            if include_headers:
                return result, dict(response.headers)
            return result if raw else (json.loads(result) if result else None)

    def assets(self, since=None, *, original_file_name=None):
        page, seen = 1, set()
        while True:
            body = {'size': 1000, 'page': page, 'withExif': True, 'withStacked': True, 'withDeleted': True}
            if since:
                body['updatedAfter'] = since
            if original_file_name:
                body['originalFileName'] = original_file_name
            result = self.call('/search/metadata', body)['assets']
            ids = tuple(asset['id'] for asset in result['items'])
            if ids in seen and result.get('nextPage'):
                raise RuntimeError('Asset pagination repeated without progress')
            seen.add(ids)
            yield from (asset for asset in result['items'] if asset['ownerId'] == self.id)
            if not result.get('nextPage'):
                return
            page = int(result['nextPage'])

    def metadata(self, asset_id, key):
        rows = self.call('/assets/' + asset_id + '/metadata')
        return next((row['value'] for row in rows if row['key'] == key), None)

    def album(self, album_id):
        try:
            value = self.call('/albums/' + album_id)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            raise
        if value['albumUsers'][0]['user']['id'] != self.id:
            raise PermissionError('Refusing to modify another owner album')
        if 'assets' not in value:
            query = {'albumId': album_id, 'withStacked': 'false'}
            buckets = self.call('/timeline/buckets?' + urllib.parse.urlencode(query))
            if not isinstance(buckets, list):
                raise ValueError('Native album time buckets are unavailable')
            assets, identities, bucket_keys = [], set(), set()
            for bucket in buckets:
                key, count = bucket['timeBucket'], bucket['count']
                if not isinstance(key, str) or key in bucket_keys or type(count) is not int or count < 0:
                    raise ValueError('Native album time bucket is malformed')
                bucket_keys.add(key)
                rows = self.call('/timeline/bucket?' + urllib.parse.urlencode({**query, 'timeBucket': key}))
                ids = rows.get('id') if isinstance(rows, dict) else None
                if (not isinstance(ids, list) or len(ids) != count
                        or any(not isinstance(identity, str) or not identity for identity in ids)
                        or len(set(ids)) != len(ids) or identities.intersection(ids)):
                    raise ValueError('Native album membership changed or is incomplete')
                identities.update(ids)
                assets.extend({'id': identity} for identity in ids)
            if type(value.get('assetCount')) is not int or value['assetCount'] != len(assets):
                raise ValueError('Native album membership count changed or is incomplete')
            value['assets'] = assets
        elif not isinstance(value['assets'], list):
            raise ValueError('Native album membership is unavailable')
        return value

    def owned_albums(self):
        return self.call('/albums?isOwned=true')

    def close(self):
        if self.token:
            self.call('/auth/logout', {}, 'POST')
            self.token = None
