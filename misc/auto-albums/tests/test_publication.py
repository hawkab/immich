import copy
import hashlib
from pathlib import Path
import unittest

from photo_memories.albums import sync_album
from photo_memories.publishing import publish_memory
from photo_memories.sources import GENERATED_KEY
from test_albums import AlbumFixture


class PublicationTests(AlbumFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.record = sync_album(self.owner, self.registry, self.bucket)
        self.path = Path(self.temporary.name) / 'generated.mp4'
        self.path.write_bytes(b'synthetic-verified-renderer-output')
        self.render = {'video': self.path, 'video_sha256': hashlib.sha256(self.path.read_bytes()).hexdigest(),
                       'membership_signature': 'signature-1', 'selected_ids': ['photo-a', 'photo-b'],
                       'width': 1280, 'height': 720, 'created_at': '2020-01-01T00:00:00Z',
                       'input_digest': 'worker-input-1', 'soundtrack': {'kind': 'original_procedural'}}

    def publish(self, record=None):
        return publish_memory(self.owner, self.registry, self.bucket, record or self.record, self.render)

    def test_upload_lost_reply_reconciles_checksum_without_duplicate(self):
        self.owner.lose_upload = True
        record = self.publish()
        self.assertEqual(record['memory_phase'], 'upload_unknown')
        record = self.registry.get('albums:owner', self.bucket['key'])
        record = self.publish(record)
        self.assertEqual(record['memory_phase'], 'verified')
        self.assertEqual(len(self.owner.uploads), 1)
        self.assertEqual(self.owner.metadata(record['video_id'], GENERATED_KEY)['sourceAssetIds'], ['photo-a', 'photo-b'])
        self.assertEqual(record['render_input_digest'], 'worker-input-1')

    def test_unchanged_movie_retains_creation_provenance_after_preference_change(self):
        record = self.publish()
        original = self.owner.metadata(record['video_id'], GENERATED_KEY)
        self.bucket['input_digest'] = 'new-favorite-preference'
        self.render['input_digest'] = 'new-worker-input'
        writes = len(self.owner.writes)
        record = self.publish(record)
        self.assertEqual(record['memory_phase'], 'verified')
        self.assertEqual(record['render_input_digest'], 'new-worker-input')
        self.assertEqual(self.owner.metadata(record['video_id'], GENERATED_KEY), original)
        self.assertEqual(len(self.owner.writes), writes)
        self.assertEqual(len(self.owner.uploads), 1)

    def test_unknown_upload_with_zero_results_never_blindly_retries(self):
        self.owner.lose_upload = True
        record = self.publish()
        self.owner.assets = {asset['id']: asset for asset in self.photos}
        self.assertEqual(self.publish(record)['memory_phase'], 'upload_unknown')
        self.assertEqual(len(self.owner.uploads), 1)

    def test_sources_removed_from_native_album_are_not_uploaded_or_readded(self):
        self.owner.albums[self.record['album_id']]['assets'] = [{'id': 'photo-a'}]
        record = self.publish()
        self.assertEqual(record['memory_phase'], 'sources_changed')
        self.assertIn('photo-b', record['exclusions'])
        self.assertEqual(self.owner.uploads, [])

    def test_changed_or_foreign_source_is_rejected_before_upload(self):
        for change in [{'checksum': 'changed'}, {'thumbhash': 'changed'}, {'ownerId': 'stranger'}]:
            with self.subTest(change=change):
                self.owner.assets['photo-a'] = {**self.photos[0], **change}
                self.assertEqual(self.publish()['memory_phase'], 'sources_changed')
                self.assertEqual(self.owner.uploads, [])

    def test_changed_edits_are_rejected_even_if_is_edited_stays_true(self):
        self.photos[0]['isEdited'] = True
        self.owner.assets['photo-a'] = {**self.photos[0], 'edits': {'rotation': 90}}
        self.render['source_revisions'] = {'photo-a': {**self.photos[0], 'edits': {'rotation': 180}}}
        self.assertEqual(self.publish()['memory_phase'], 'sources_changed')
        self.assertEqual(self.owner.uploads, [])

    def test_generated_video_trash_or_manual_removal_stays_suppressed(self):
        record = self.publish()
        identity = record['video_id']
        self.owner.assets[identity]['isTrashed'] = True
        self.assertTrue(self.publish(record)['video_suppressed'])
        self.assertEqual(len(self.owner.uploads), 1)

    def test_manual_video_membership_removal_is_not_readded(self):
        record = self.publish()
        album = self.owner.albums[record['album_id']]
        album['assets'] = [item for item in album['assets'] if item['id'] != record['video_id']]
        writes = len(self.owner.writes)
        self.assertTrue(self.publish(record)['video_suppressed'])
        self.assertEqual(len(self.owner.writes), writes)

    def test_replacement_removes_only_old_membership_after_new_verified(self):
        record = self.publish()
        old = record['video_id']
        self.path.write_bytes(b'new-synthetic-verified-renderer-output')
        self.render.update(video_sha256=hashlib.sha256(self.path.read_bytes()).hexdigest(), membership_signature='signature-2')
        record = self.publish(record)
        self.assertNotEqual(record['video_id'], old)
        self.assertIn(old, self.owner.assets)
        self.assertEqual(self.owner.assets[old]['visibility'], 'archive')
        calls = self.owner.writes
        attach = next(index for index, call in enumerate(calls) if call[2] == 'PUT' and call[1] == {'ids': [record['video_id']]})
        removal = next(index for index, call in enumerate(calls) if call[2] == 'DELETE' and call[1] == {'ids': [old]})
        self.assertLess(attach, removal)
        self.assertTrue(all(call[0].startswith('/albums/') for call in calls if call[2] == 'DELETE'))

    def test_authored_video_is_not_claimed_or_modified(self):
        self.owner.assets['authored'] = {'id': 'authored', 'ownerId': self.owner.id, 'type': 'VIDEO',
                                         'originalFileName': 'my-film.mp4', 'checksum': 'other', 'visibility': 'timeline'}
        self.owner.upload = lambda *args, **kwargs: 'authored'
        before = copy.deepcopy(self.owner.assets['authored'])
        with self.assertRaises(PermissionError):
            self.publish()
        self.assertEqual(self.owner.assets['authored'], before)
        self.assertEqual(self.owner.tags, {})

    def test_no_raw_original_metadata_is_changed(self):
        before = copy.deepcopy(self.owner.assets)
        record = self.publish()
        self.publish(record)
        self.assertEqual({identity: self.owner.assets[identity] for identity in before}, before)
        metadata_writes = [call[0] for call in self.owner.writes if call[0].endswith('/metadata')]
        self.assertEqual(metadata_writes, ['/assets/' + record['video_id'] + '/metadata'])
        self.assertEqual(len(self.owner.uploads), 1)

    def test_intent_and_generated_cache_precede_uncertain_native_writes(self):
        original_upload, original_call = self.owner.upload, self.owner.call

        def upload(*args, **kwargs):
            stored = self.registry.get('albums:owner', self.bucket['key'])
            self.assertEqual(stored['video_intent']['phase'], 'upload_intent')
            self.assertTrue(kwargs['name'].startswith('Aegis_Memory_'))
            return original_upload(*args, **kwargs)

        def call(path, value=None, method=None):
            if path.endswith('/metadata') and method == 'PUT':
                identity = path.split('/')[2]
                self.assertTrue(self.registry.get('generated:owner', identity)['generated'])
            return original_call(path, value, method)

        self.owner.upload, self.owner.call = upload, call
        self.publish()

    def test_lost_attach_reply_reconciles_without_second_membership_add(self):
        original_call = self.owner.call
        interrupted = False

        def call(path, value=None, method=None):
            nonlocal interrupted
            result = original_call(path, value, method)
            if method == 'PUT' and path.endswith('/assets') and value['ids'][0].startswith('video-') and not interrupted:
                interrupted = True
                raise ConnectionError('Synthetic committed attach lost reply')
            return result

        self.owner.call = call
        with self.assertRaises(ConnectionError):
            self.publish()
        record = self.registry.get('albums:owner', self.bucket['key'])
        record = self.publish(record)
        self.assertEqual(record['memory_phase'], 'verified')
        additions = [call for call in self.owner.writes if call[2] == 'PUT' and call[1] == {'ids': [record['video_id']]}]
        self.assertEqual(len(additions), 1)


if __name__ == '__main__':
    unittest.main()
