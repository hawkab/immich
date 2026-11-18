from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from photo_memories import pipeline, runtime
from photo_memories.albums import sync_album
from photo_memories.catalog import plan_buckets
from photo_memories.sources import digest, evict_verified_render
from photo_memories.state import Registry
from test_albums import FakeOwner
from test_catalog import photo


class SchedulingTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.registry = Registry(self.root / 'registry.sqlite3')
        self.addCleanup(self.registry.close)
        self.owner = FakeOwner()
        self.owner.preview = lambda asset: (b'preview', {'X-Immich-Media-Kind': 'original'})
        self.profile = {'state_directory': str(self.root), 'event_directory': str(self.root / 'events')}
        self.now = datetime(2026, 11, 18, tzinfo=timezone.utc)

    def store(self, assets):
        self.owner.assets.update({asset['id']: asset for asset in assets})
        for asset in assets:
            self.registry.put('assets:owner', asset['id'], {'asset': asset, 'scene': None})

    def render(self, items, destination, **kwargs):
        video, collage = destination / 'memory.mp4', destination / 'collage.jpg'
        video.write_bytes(b'synthetic generated video')
        collage.write_bytes(b'synthetic generated collage')
        return {'video': str(video), 'collage': str(collage), 'cover': str(collage),
                'video_sha256': hashlib.sha256(video.read_bytes()).hexdigest(),
                'collage_sha256': hashlib.sha256(collage.read_bytes()).hexdigest()}

    def publish(self, owner, registry, group, record, result):
        return {**record, 'memory_phase': 'verified', 'render_input_digest': result['input_digest']}

    def run_process(self, **kwargs):
        with patch.object(pipeline, 'synchronize', return_value=set()), \
             patch.object(pipeline, 'render_memory', side_effect=self.render) as render, \
             patch.object(pipeline, 'publish_memory', side_effect=self.publish), \
             patch.object(pipeline, 'pending_sources', return_value=False):
            status = pipeline.process(self.owner, self.registry, self.profile, [], {}, self.now, **kwargs)
            return status, render.call_count

    def test_date_change_and_source_removal_clean_obsolete_memberships_only(self):
        asset = photo()
        old = next(iter(plan_buckets([asset], {}).values()))
        record = sync_album(self.owner, self.registry, old)
        album = self.owner.albums[record['album_id']]
        album['assets'] += [{'id': 'human-addition'}, {'id': 'old-archived-movie'}]
        record['video_id'] = 'old-archived-movie'
        self.registry.put('albums:owner', old['key'], record)
        self.store([{**asset, 'localDateTime': '2020-02-01T01:00:00', 'thumbhash': None}])
        status, _ = self.run_process()
        self.assertEqual(status['errors'], [])
        self.assertEqual({item['id'] for item in album['assets']}, {'human-addition', 'old-archived-movie'})
        self.assertIn(asset['id'], self.owner.assets)
        self.assertTrue(all(call[0].startswith('/albums/') for call in self.owner.writes if call[2] == 'DELETE'))
        self.registry.remove('assets:owner', asset['id'])
        self.run_process()
        self.assertEqual({item['id'] for item in album['assets']}, {'human-addition', 'old-archived-movie'})

    def test_one_render_per_owner_pass_then_cursor_continues_without_repeating(self):
        self.store([photo(), photo('b', '2020-02-01T01:00:00')])
        first, calls = self.run_process()
        self.assertEqual((calls, first['albums'], first['published'], first['continue_pending']), (1, 2, 1, True))
        second, calls = self.run_process(continuation=True)
        self.assertEqual((calls, second['published'], second['continue_pending']), (1, 1, False))
        third, calls = self.run_process()
        self.assertEqual((calls, third['unchanged_reels']), (0, 2))
        self.assertEqual(len(list(self.root.rglob('render-result.json'))), 2)
        self.assertEqual(list(self.root.rglob('memory.mp4')), [])

    def test_unknown_publication_preserves_cache_and_does_not_busyloop_continuations(self):
        self.store([photo(), photo('b', '2020-02-01T01:00:00')])
        self.publish = lambda owner, registry, group, record, result: {**record, 'memory_phase': 'upload_unknown'}
        first, calls = self.run_process()
        self.assertEqual((calls, first['continue_pending']), (1, True))
        second, calls = self.run_process(continuation=True)
        self.assertEqual((calls, second['continue_pending']), (1, False))
        third, calls = self.run_process(continuation=True)
        self.assertEqual((calls, third['continue_pending']), (0, False))
        self.assertEqual(len(list(self.root.rglob('memory.mp4'))), 2)

    def test_explicit_bucket_selection_does_not_busyloop_other_buckets(self):
        self.store([photo(), photo('b', '2020-02-01T01:00:00')])
        status, calls = self.run_process(render_key='month:2018-07')
        self.assertEqual((calls, status['continue_pending']), (1, False))

    def test_runtime_immediately_continues_pending_work_after_servicing_each_owner(self):
        credentials = self.root / 'credentials'
        (credentials / 'users').mkdir(parents=True)
        (credentials / 'login.json').write_text('{}')
        (credentials / 'users/partner.login.json').write_text('{}')
        profile = {**self.profile, 'credential_directory': str(credentials)}
        calls = []

        def owner(_profile, credential):
            return type('Owner', (), {'id': credential.name, 'close': lambda self: None})()

        def process(account, *args, **kwargs):
            calls.append((account.id, kwargs['continuation']))
            if len(calls) == 4:
                runtime.STOP.set()
            return {'continue_pending': len(calls) <= 2, 'errors': []}

        runtime.STOP.clear()
        self.addCleanup(runtime.STOP.clear)
        with patch.object(runtime, 'Owner', side_effect=owner), patch.object(runtime, 'process', side_effect=process), \
             patch.object(runtime, 'claim', return_value=[]), patch.object(runtime, 'wait_for_changes') as wait:
            runtime.run(profile)
        self.assertEqual(calls, [('login.json', False), ('partner.login.json', False),
                                 ('login.json', True), ('partner.login.json', True)])
        wait.assert_not_called()


class CacheEvictionTests(unittest.TestCase):
    def test_only_verified_unchanged_own_files_are_evicted_and_receipt_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            signature = digest('signature')
            directory = Path(temporary) / signature
            directory.mkdir()
            video, collage, receipt = directory / 'memory.mp4', directory / 'collage.jpg', directory / 'render-result.json'
            video.write_bytes(b'video')
            collage.write_bytes(b'collage')
            receipt.write_text('{}')
            result = {'video': str(video), 'collage': str(collage), 'cover': str(collage),
                'video_sha256': hashlib.sha256(b'video').hexdigest(), 'collage_sha256': hashlib.sha256(b'collage').hexdigest()}
            pending = {'memory_phase': 'upload_unknown', 'render_input_digest': signature}
            self.assertEqual(evict_verified_render(directory, result, pending, signature)['bytes_freed'], 0)
            self.assertTrue(video.exists())
            record = {**pending, 'memory_phase': 'verified'}
            self.assertEqual(evict_verified_render(directory, result, record, signature)['bytes_freed'], 12)
            self.assertTrue(receipt.exists())
            self.assertFalse(video.exists())
            self.assertFalse(collage.exists())

    def test_unsafe_links_foreign_paths_and_changed_files_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, signature = Path(temporary), digest('signature')
            directory = root / signature
            directory.mkdir()
            original = root / 'manual-input.jpg'
            original.write_bytes(b'manual')
            link = directory / 'memory.mp4'
            link.symlink_to(original)
            result = {'video': str(link), 'video_sha256': hashlib.sha256(b'manual').hexdigest()}
            record = {'memory_phase': 'verified', 'render_input_digest': signature}
            self.assertEqual(evict_verified_render(directory, result, record, signature)['bytes_freed'], 0)
            self.assertTrue(link.is_symlink())
            link.unlink()
            link.hardlink_to(original)
            self.assertEqual(evict_verified_render(directory, result, record, signature)['bytes_freed'], 0)
            result['video'] = str(original)
            self.assertEqual(evict_verified_render(directory, result, record, signature)['bytes_freed'], 0)
            link.unlink()
            link.write_bytes(b'changed')
            result['video'] = str(link)
            self.assertEqual(evict_verified_render(directory, result, record, signature)['bytes_freed'], 0)
            self.assertEqual(original.read_bytes(), b'manual')


if __name__ == '__main__':
    unittest.main()
