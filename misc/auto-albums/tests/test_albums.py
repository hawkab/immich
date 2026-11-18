import base64
import copy
import hashlib
import tempfile
from pathlib import Path
import unittest

from photo_memories.albums import sync_album
from photo_memories.state import Registry


class FakeOwner:
    def __init__(self):
        self.id, self.albums, self.assets = 'owner', {}, {}
        self.writes, self.uploads, self.tags = [], [], {}
        self.lose_create, self.lose_upload = False, False
        self.lose_membership = False

    def album(self, identity):
        return copy.deepcopy(self.albums.get(identity))

    def owned_albums(self):
        return list(copy.deepcopy(self.albums).values())

    def metadata(self, identity, key):
        return copy.deepcopy(self.tags.get((identity, key)))

    def call(self, path, value=None, method=None):
        if method in ('POST', 'PUT', 'DELETE'):
            self.writes.append((path, copy.deepcopy(value), method))
        if path == '/albums' and method == 'POST':
            identity = 'album-' + str(len(self.albums))
            self.albums[identity] = {'id': identity, 'albumName': value['albumName'], 'description': value['description'],
                                     'albumUsers': [{'user': {'id': self.id}}], 'assets': [], 'albumThumbnailAssetId': None}
            if self.lose_create:
                raise ConnectionError('Synthetic committed creation lost reply')
            return {'id': identity}
        if path.startswith('/albums/') and path.endswith('/assets'):
            if self.lose_membership:
                raise ConnectionError('Synthetic unknown membership write')
            album = self.albums[path.split('/')[2]]
            current = {asset['id']: asset for asset in album['assets']}
            for identity in value['ids']:
                if method == 'PUT':
                    current[identity] = {'id': identity}
                elif method == 'DELETE':
                    current.pop(identity, None)
                else:
                    raise AssertionError(method)
            album['assets'] = list(current.values())
            return []
        if path == '/assets/bulk-upload-check':
            request = value['assets'][0]
            match = next((asset for asset in self.assets.values() if asset.get('checksum') == request['checksum']), None)
            return {'results': [{'id': request['id'], 'action': 'reject' if match else 'accept',
                                 **({'assetId': match['id'], 'isTrashed': match.get('isTrashed', False)} if match else {})}]}
        if path.startswith('/assets/'):
            identity = path.split('/')[2]
            if path.endswith('/metadata') and method == 'PUT':
                for item in value['items']:
                    self.tags[(identity, item['key'])] = copy.deepcopy(item['value'])
                return []
            if path.endswith('/edits'):
                return self.assets[identity].get('edits', {'edits': []})
            return copy.deepcopy(self.assets[identity])
        raise AssertionError((path, value, method))

    def upload(self, path, *, name, created_at):
        self.uploads.append(name)
        identity = 'video-' + str(len(self.uploads))
        checksum = base64.b64encode(hashlib.sha1(Path(path).read_bytes()).digest()).decode()
        self.assets[identity] = {'id': identity, 'ownerId': self.id, 'type': 'VIDEO', 'originalFileName': name,
                                 'checksum': checksum, 'visibility': 'archive'}
        if self.lose_upload:
            raise ConnectionError('Synthetic committed upload lost reply')
        return identity


class AlbumFixture:
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.registry = Registry(Path(self.temporary.name) / 'registry.sqlite')
        self.addCleanup(self.registry.close)
        self.owner = FakeOwner()
        self.photos = [{'id': name, 'ownerId': self.owner.id, 'checksum': name, 'type': 'IMAGE', 'thumbhash': name}
                       for name in ['photo-a', 'photo-b']]
        self.owner.assets = {asset['id']: asset for asset in self.photos}
        self.bucket = {'key': 'family:test', 'title': 'Семья', 'theme': 'family', 'render': True,
                       'assets': self.photos, 'input_digest': 'input-1'}


class AlbumTests(AlbumFixture, unittest.TestCase):
    def test_lost_create_reply_reconciles_marker_without_duplicate(self):
        self.owner.lose_create = True
        record = sync_album(self.owner, self.registry, self.bucket)
        self.assertEqual(record['phase'], 'create_unknown')
        self.owner.lose_create = False
        record = sync_album(self.owner, self.registry, self.bucket)
        self.assertEqual(record['phase'], 'active')
        self.assertEqual(len(self.owner.albums), 1)
        self.assertEqual(len([call for call in self.owner.writes if call[0] == '/albums']), 1)

    def test_unknown_zero_results_never_blindly_creates(self):
        self.owner.lose_create = True
        sync_album(self.owner, self.registry, self.bucket)
        self.owner.albums.clear()
        sync_album(self.owner, self.registry, self.bucket)
        self.assertEqual(len([call for call in self.owner.writes if call[0] == '/albums']), 1)

    def test_human_rename_cover_additions_and_removal_are_preserved(self):
        record = sync_album(self.owner, self.registry, self.bucket, share_with=['partner'])
        album = self.owner.albums[record['album_id']]
        album.update(albumName='Моё название', albumThumbnailAssetId='manual-cover')
        album['assets'] = [{'id': 'photo-a'}, {'id': 'manual-photo'}]
        record = sync_album(self.owner, self.registry, self.bucket)
        self.assertEqual(record['exclusions'], ['photo-b'])
        self.assertEqual(album['albumName'], 'Моё название')
        self.assertEqual(album['albumThumbnailAssetId'], 'manual-cover')
        self.assertEqual({item['id'] for item in album['assets']}, {'photo-a', 'manual-photo'})
        create = next(call for call in self.owner.writes if call[0] == '/albums')
        self.assertEqual(create[1]['albumUsers'], [{'userId': 'partner', 'role': 'viewer'}])

    def test_human_album_delete_and_marker_removal_are_tombstoned(self):
        for operation in ['delete', 'detach']:
            with self.subTest(operation=operation):
                bucket = {**self.bucket, 'key': operation}
                record = sync_album(self.owner, self.registry, bucket)
                if operation == 'delete':
                    self.owner.albums.pop(record['album_id'])
                else:
                    self.owner.albums[record['album_id']]['description'] = 'Ручной альбом'
                record = sync_album(self.owner, self.registry, bucket)
                self.assertEqual(record['phase'], 'deleted' if operation == 'delete' else 'detached')
                before = len(self.owner.writes)
                sync_album(self.owner, self.registry, bucket)
                self.assertEqual(len(self.owner.writes), before)

    def test_wrong_owner_never_creates_or_updates(self):
        self.bucket['assets'] = [{**self.photos[0], 'ownerId': 'stranger'}]
        with self.assertRaises(PermissionError):
            sync_album(self.owner, self.registry, self.bucket)
        self.assertEqual(self.owner.writes, [])

    def test_uncertain_add_is_not_labeled_a_manual_removal_or_blindly_repeated(self):
        self.owner.lose_membership = True
        sync_album(self.owner, self.registry, self.bucket)
        self.owner.lose_membership = False
        before = len(self.owner.writes)
        record = sync_album(self.owner, self.registry, self.bucket)
        self.assertEqual(record['exclusions'], [])
        self.assertEqual(record['membership_uncertain_ids'], ['photo-a', 'photo-b'])
        self.assertEqual(record['membership_phase'], 'unknown_add_or_remove')
        self.assertEqual(len(self.owner.writes), before)

    def test_obsolete_membership_only_removed_no_original_deletes(self):
        sync_album(self.owner, self.registry, self.bucket)
        self.bucket['assets'] = self.photos[:1]
        sync_album(self.owner, self.registry, self.bucket)
        deletes = [call for call in self.owner.writes if call[2] == 'DELETE']
        self.assertEqual(len(deletes), 1)
        self.assertTrue(deletes[0][0].startswith('/albums/'))
        self.assertIn('photo-b', self.owner.assets)


if __name__ == '__main__':
    unittest.main()
