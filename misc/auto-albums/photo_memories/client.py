import base64
from email.utils import parsedate_to_datetime
import hashlib
import http.client
import json
from pathlib import Path
import ssl
import urllib.error
import urllib.parse
import urllib.request
import uuid


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

    def preview(self, asset):
        route = '/assets/' + asset['id'] + '/thumbnail?size=preview&edited=' + ('true' if asset.get('isEdited') else 'false')
        return self.call(route, raw=True, include_headers=True)

    def assets(self, since=None):
        page, seen = 1, set()
        while True:
            body = {'size': 1000, 'page': page, 'withExif': True, 'withStacked': True, 'withDeleted': True}
            if since:
                body['updatedAfter'] = since
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
        return value

    def owned_albums(self):
        return self.call('/albums?isOwned=true')

    def upload(self, path, *, name, created_at):
        path = Path(path)
        with path.open('rb') as source:
            sha1 = hashlib.file_digest(source, 'sha1').digest()
        check = self.call('/assets/bulk-upload-check', {'assets': [
            {'id': name, 'checksum': base64.b64encode(sha1).decode()}]})['results'][0]
        if check['action'] == 'reject':
            if check.get('isTrashed'):
                raise RuntimeError('The generated video was deliberately trashed; publication remains paused')
            return check['assetId']
        boundary = 'aegis-memories-' + uuid.uuid4().hex
        fields = {'deviceAssetId': name, 'deviceId': 'aegis-memories', 'fileCreatedAt': created_at,
                  'fileModifiedAt': created_at, 'visibility': 'archive'}
        prefix = b''.join((f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n').encode()
                          for key, value in fields.items())
        prefix += (f'--{boundary}\r\nContent-Disposition: form-data; name="assetData"; filename="{name}"\r\n'
                   'Content-Type: video/mp4\r\n\r\n').encode()
        suffix = f'\r\n--{boundary}--\r\n'.encode()

        def body():
            yield prefix
            with path.open('rb') as source:
                yield from iter(lambda: source.read(1024 * 1024), b'')
            yield suffix

        url = urllib.parse.urlsplit(self.root)
        connection = http.client.HTTPSConnection(url.hostname, url.port, context=self.tls)
        try:
            connection.request('POST', url.path + '/assets', body=body(), headers={
                'Authorization': 'Bearer ' + self.token, 'Content-Type': 'multipart/form-data; boundary=' + boundary,
                'Content-Length': str(len(prefix) + path.stat().st_size + len(suffix))})
            response = connection.getresponse()
            value = json.loads(response.read())
            if response.status not in (200, 201):
                raise RuntimeError('Generated-video upload returned HTTP ' + str(response.status))
            return value['id']
        finally:
            connection.close()

    def close(self):
        if self.token:
            self.call('/auth/logout', {}, 'POST')
            self.token = None
