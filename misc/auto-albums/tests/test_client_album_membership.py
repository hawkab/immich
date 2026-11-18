import copy
from pathlib import Path
import tempfile
import unittest
import urllib.error
import urllib.parse

from photo_memories.albums import member_ids, sync_album
from photo_memories.client import Owner
from photo_memories.state import Registry
from test_albums import FakeOwner


class NativeAlbumOwner(FakeOwner):
    def __init__(self):
        super().__init__()
        self.reads = []
        self.bad_membership = False

    def album(self, identity):
        return Owner.album(self, identity)

    def call(self, path, value=None, method=None):
        parsed = urllib.parse.urlsplit(path)
        query = urllib.parse.parse_qs(parsed.query)
        if parsed.path == '/timeline/buckets':
            self.reads.append(path)
            assets = self.albums[query['albumId'][0]]['assets']
            return [{'timeBucket': '2018-07-01', 'count': len(assets)}] if assets else []
        if parsed.path == '/timeline/bucket':
            self.reads.append(path)
            assets = self.albums[query['albumId'][0]]['assets']
            ids = [item['id'] for item in assets]
            return {} if self.bad_membership else {'id': ids,
                'ownerId': ['partner' if item.startswith('manual') else self.id for item in ids],
                'visibility': ['archive' if item.startswith('old') else 'timeline' for item in ids]}
        if parsed.path.startswith('/albums/') and not parsed.path.endswith('/assets'):
            self.reads.append(path)
            album = self.albums.get(parsed.path.split('/')[2])
            if album is None:
                raise urllib.error.HTTPError(path, 404, 'Synthetic missing album', {}, None)
            dto = copy.deepcopy(album)
            dto['assetCount'] = len(dto.pop('assets'))
            return dto
        return super().call(path, value, method)


class NativeMembershipTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.registry = Registry(Path(temporary.name) / 'registry.sqlite3')
        self.addCleanup(self.registry.close)
        self.owner = NativeAlbumOwner()
        self.photos = [{'id': identity, 'ownerId': self.owner.id, 'checksum': identity, 'type': 'IMAGE'}
                       for identity in ('photo-a', 'photo-b')]
        self.owner.assets = {asset['id']: asset for asset in self.photos}
        self.bucket = {'key': 'family:2018', 'title': 'Семья', 'assets': self.photos, 'input_digest': 'input-1'}

    def test_current_native_album_dto_hydrates_real_membership_after_accepted_put(self):
        record = sync_album(self.owner, self.registry, self.bucket)
        self.assertEqual(record['membership_phase'], 'verified')
        self.assertEqual(record['managed_source_ids'], ['photo-a', 'photo-b'])
        self.assertEqual(record['source_ids'], ['photo-a', 'photo-b'])
        self.assertEqual(record['membership_uncertain_ids'], [])
        self.assertEqual(len([call for call in self.owner.writes if call[2] == 'PUT']), 1)

    def test_previous_accepted_put_recovers_without_repeating_and_future_removal_is_managed(self):
        record = sync_album(self.owner, self.registry, self.bucket)
        album = self.owner.albums[record['album_id']]
        album['assets'] += [{'id': 'manual-partner-photo'}, {'id': 'old-archived-reel'}]
        record.update(managed_source_ids=[], source_ids=[], membership_uncertain_ids=['photo-a', 'photo-b'],
                      membership_phase='unknown_add_or_remove')
        self.registry.put('albums:owner', self.bucket['key'], record)
        writes = len(self.owner.writes)
        reopened = Registry(self.registry.db.execute('PRAGMA database_list').fetchone()[2])
        try:
            recovered = sync_album(self.owner, reopened, self.bucket)
        finally:
            reopened.close()
        self.assertEqual(recovered['membership_phase'], 'verified')
        self.assertEqual(recovered['managed_source_ids'], ['photo-a', 'photo-b'])
        self.assertEqual(recovered['source_ids'], ['photo-a', 'photo-b'])
        self.assertEqual(len(self.owner.writes), writes)
        self.bucket['assets'] = self.photos[:1]
        sync_album(self.owner, self.registry, self.bucket)
        self.assertEqual(member_ids(album), {'photo-a', 'manual-partner-photo', 'old-archived-reel'})
        self.assertIn('photo-b', self.owner.assets)
        for route in self.owner.reads:
            if route.startswith('/timeline/'):
                query = urllib.parse.parse_qs(urllib.parse.urlsplit(route).query)
                self.assertEqual(query['albumId'], [record['album_id']])
                self.assertEqual(query['withStacked'], ['false'])
                self.assertNotIn('userId', query)
                self.assertNotIn('visibility', query)

    def test_absent_unknown_add_is_not_falsely_accepted_or_repeated(self):
        self.owner.lose_membership = True
        sync_album(self.owner, self.registry, self.bucket)
        self.owner.lose_membership = False
        writes = len(self.owner.writes)
        record = sync_album(self.owner, self.registry, self.bucket)
        self.assertEqual(record['membership_uncertain_ids'], ['photo-a', 'photo-b'])
        self.assertEqual(record['managed_source_ids'], [])
        self.assertEqual(record['exclusions'], [])
        self.assertEqual(len(self.owner.writes), writes)

    def test_human_removal_of_previously_verified_source_remains_excluded(self):
        record = sync_album(self.owner, self.registry, self.bucket)
        self.owner.albums[record['album_id']]['assets'] = [{'id': 'photo-a'}]
        record = sync_album(self.owner, self.registry, self.bucket)
        self.assertEqual(record['exclusions'], ['photo-b'])
        self.assertEqual(record['source_ids'], ['photo-a'])

    def test_missing_native_ids_is_an_error_and_never_empty_membership(self):
        record = sync_album(self.owner, self.registry, self.bucket)
        self.owner.bad_membership = True
        writes = len(self.owner.writes)
        with self.assertRaises(ValueError):
            sync_album(self.owner, self.registry, self.bucket)
        self.assertEqual(len(self.owner.writes), writes)
        with self.assertRaises(ValueError):
            member_ids({'id': record['album_id'], 'assetCount': 2})

    def test_legacy_explicit_assets_are_supported_without_timeline_requests(self):
        owner = Owner.__new__(Owner)
        owner.id = 'owner'
        owner.call = lambda path: {'albumUsers': [{'user': {'id': 'owner'}}], 'assets': [{'id': 'legacy'}]}
        self.assertEqual(member_ids(owner.album('legacy-album')), {'legacy'})

    def test_wrong_owner_does_not_enumerate_album_assets(self):
        record = sync_album(self.owner, self.registry, self.bucket)
        self.owner.albums[record['album_id']]['albumUsers'][0]['user']['id'] = 'partner'
        self.owner.reads.clear()
        with self.assertRaises(PermissionError):
            self.owner.album(record['album_id'])
        self.assertFalse(any(route.startswith('/timeline/') for route in self.owner.reads))

    def test_count_mismatch_raises_instead_of_accepting_partial_or_duplicate_results(self):
        owner = Owner.__new__(Owner)
        owner.id = 'owner'
        for ids in (None, [], ['a', 'a'], ['a'], 'a'):
            with self.subTest(ids=ids):
                def call(path):
                    if path.startswith('/albums/'):
                        return {'albumUsers': [{'user': {'id': 'owner'}}], 'assetCount': 2}
                    if path.startswith('/timeline/buckets?'):
                        return [{'timeBucket': '2018-07-01', 'count': 2}]
                    return {'id': ids}
                owner.call = call
                with self.assertRaises(ValueError):
                    owner.album('album')


if __name__ == '__main__':
    unittest.main()
