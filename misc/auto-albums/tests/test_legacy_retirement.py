import copy
from pathlib import Path
import unittest
import uuid

from photo_memories.retire import generated_origin, retire_owner
from test_albums import AlbumFixture


class LegacyOwner:
    def __init__(self):
        self.id = 'owner'
        self.signature = 'a' * 64
        self.marker_id = str(uuid.uuid4())
        self.video = {'id': 'video', 'ownerId': self.id, 'type': 'VIDEO', 'checksum': 'sha1',
                      'originalFileName': 'Aegis_Memory_' + self.signature + '_' + self.marker_id + '.mp4'}
        self.tag = {'generated': True, 'manager': 'aegis-auto-albums-v1',
                    'signature': self.signature, 'albumMarker': '[aegis:memory:v1:' + self.marker_id + ']'}
        self.writes, self.lost_reply = [], False
        self.album = {'id': 'album', 'albumUsers': [{'user': {'id': self.id}}], 'present': True}

    def assets(self, **kwargs):
        return iter([copy.deepcopy(self.video)])

    def metadata(self, identity, key):
        return copy.deepcopy(self.tag)

    def call(self, path, value=None, method=None):
        if method == 'DELETE':
            self.writes.append((path, value))
        if path == '/assets/video':
            return copy.deepcopy(self.video)
        if path.startswith('/albums?'):
            return [self.album] if self.album['present'] else []
        if path == '/albums/album/assets':
            self.album['present'] = False
            return []
        if path == '/assets':
            assert value == {'ids': ['video'], 'force': False}
            self.video['isTrashed'] = True
            if self.lost_reply:
                raise ConnectionError('Accepted soft-trash reply lost')
            return None
        raise AssertionError(path)


class RetirementTests(AlbumFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.legacy = LegacyOwner()

    def test_only_verified_generated_video_is_detached_and_soft_trashed(self):
        result = retire_owner(self.legacy, self.registry)
        self.assertEqual(result['trashed'], 1)
        self.assertEqual(result['errors'], [])
        self.assertFalse(self.legacy.album['present'])
        self.assertTrue(self.legacy.video['isTrashed'])
        self.assertEqual(retire_owner(self.legacy, self.registry)['previously_retired'], 1)
        self.assertEqual(len(self.legacy.writes), 2)

    def test_lost_trash_reply_reads_actual_outcome_without_duplicate_delete(self):
        self.legacy.lost_reply = True
        self.assertEqual(retire_owner(self.legacy, self.registry)['trashed'], 1)
        retire_owner(self.legacy, self.registry)
        self.assertEqual(sum(path == '/assets' for path, _ in self.legacy.writes), 1)

    def test_original_image_and_authored_prefixed_video_are_preserved(self):
        original = dict(self.legacy.video)
        for change, tag in [({'type': 'IMAGE'}, self.legacy.tag), ({}, None), ({}, {'generated': False})]:
            with self.subTest(change=change, tag=tag):
                self.legacy.video = {**original, **change}
                self.legacy.tag = tag
                result = retire_owner(self.legacy, self.registry)
                self.assertEqual(result['preserved_unverified'], 1)
                self.assertEqual(self.legacy.writes, [])

    def test_foreign_owner_is_never_modified(self):
        self.legacy.video['ownerId'] = 'someone-else'
        self.assertEqual(len(retire_owner(self.legacy, self.registry)['errors']), 1)
        self.assertEqual(self.legacy.writes, [])

    def test_durable_upload_intent_proves_unpublished_legacy_output(self):
        self.legacy.tag = None
        self.registry.put('albums:owner', 'old', {'video_intent': {'asset_id': 'video',
            'name': self.legacy.video['originalFileName'], 'sha1': 'sha1'}})
        self.assertEqual(retire_owner(self.legacy, self.registry)['trashed'], 1)
