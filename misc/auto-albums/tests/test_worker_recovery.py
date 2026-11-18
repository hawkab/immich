from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
import urllib.error
from unittest.mock import Mock, patch

from photo_memories import pipeline, sources
from photo_memories.ingest import synchronize
from photo_memories.previews import mark_preview_ready, request_regeneration
from photo_memories.state import Registry


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.registry = Registry(self.root / 'registry.sqlite3')
        self.addCleanup(self.registry.close)
        self.asset = {'id': 'a', 'ownerId': 'owner', 'checksum': 'checksum', 'thumbhash': 'current',
                      'isEdited': False, 'type': 'IMAGE', 'localDateTime': '2018-01-01T10:00:00',
                      'fileCreatedAt': '2018-01-01T10:00:00Z'}
        self.scene = {'schemaVersion': 1, 'sourceChecksum': 'checksum', 'thumbhash': 'current',
                      'sourceToken': sources.source_token(self.asset), 'kind': 'photo'}
        self.now = datetime(2026, 11, 18, tzinfo=timezone.utc)

    def test_missing_or_conflicting_preview_regenerates_but_forbidden_is_an_error(self):
        for code in (404, 409, 403):
            with self.subTest(code=code):
                self.registry.put('assets:owner', 'a', {'asset': self.asset, 'scene': self.scene})
                owner = SimpleNamespace(id='owner', owned_albums=lambda: [],
                    preview=Mock(side_effect=urllib.error.HTTPError('/thumbnail', code, 'synthetic', {}, None)))
                record = {'phase': 'active', 'exclusions': [], 'album_id': 'synthetic'}
                with patch.object(pipeline, 'synchronize', return_value=[]), \
                     patch.object(pipeline, 'sync_album', return_value=record), \
                     patch.object(pipeline, 'request_regeneration') as regenerate:
                    status = pipeline.process(owner, self.registry,
                        {'state_directory': str(self.root), 'event_directory': str(self.root)}, [], {}, self.now)
                self.assertEqual(regenerate.call_count, 0 if code == 403 else 1, status)
                self.assertEqual(len(status['errors']), 1 if code == 403 else 0, status)

    def test_unknown_regeneration_survives_restart_without_duplicate_and_positive_proof_releases_it(self):
        posts = []

        def call(path, value=None, method=None):
            if path.endswith('/edits'):
                return {'assetId': 'a', 'edits': []}
            posts.append(value)
            raise ConnectionError('Synthetic accepted job lost reply')

        owner = SimpleNamespace(id='owner', call=call)
        with self.assertRaises(ConnectionError):
            request_regeneration(owner, self.registry, self.asset)
        reopened = Registry(self.root / 'registry.sqlite3')
        try:
            request_regeneration(owner, reopened, self.asset)
            self.assertEqual(len(posts), 1)
            mark_preview_ready(owner, reopened, self.asset, [], {'basis': 'managed_immutable_original'})
            with self.assertRaises(ConnectionError):
                request_regeneration(owner, reopened, self.asset)
            self.assertEqual(len(posts), 2)
        finally:
            reopened.close()

    def test_scene_cache_closes_each_reader(self):
        path = self.root / 'receipts.sqlite3'
        with sqlite3.connect(path) as database:
            database.execute('CREATE TABLE outbox(owner,asset,value,phase)')
        opened, connect = [], sqlite3.connect

        def capture(*args, **kwargs):
            result = connect(*args, **kwargs)
            opened.append(result)
            return result

        with patch.object(sources.sqlite3, 'connect', side_effect=capture):
            sources.scene_cache(path)
        with self.assertRaises(sqlite3.ProgrammingError):
            opened[0].execute('SELECT 1')

    def test_incremental_empty_delta_keeps_assets_but_native_trash_delta_removes_them(self):
        owner = SimpleNamespace(id='owner', server_started_at=None, assets=lambda since: iter([dict(self.asset)]),
                                metadata=lambda *args: self.scene)
        synchronize(owner, self.registry, {}, [], {}, self.now)
        owner.assets = lambda since: iter([])
        self.assertEqual(synchronize(owner, self.registry, {}, [], {}, self.now + timedelta(minutes=1)), set())
        self.assertIn('a', self.registry.rows('assets:owner'))
        owner.assets = lambda since: iter([{**self.asset, 'isTrashed': True}])
        self.assertEqual(synchronize(owner, self.registry, {}, [], {}, self.now + timedelta(minutes=2)), {'a'})
        self.assertEqual(self.registry.rows('assets:owner'), {})

    def test_deleted_event_removes_asset_and_acknowledges_only_after_reconciliation(self):
        self.registry.put('assets:owner', 'a', {'asset': self.asset, 'scene': self.scene})
        self.registry.put('owners', 'owner', {'cursor': self.now.isoformat(), 'last_full': self.now.timestamp()})
        event = self.root / 'event.json'
        event.write_text('{}')
        owner = SimpleNamespace(id='owner', server_started_at=None, assets=lambda since: iter([]),
            call=Mock(side_effect=urllib.error.HTTPError('/assets/a', 404, 'deleted', {}, None)))
        self.assertEqual(synchronize(owner, self.registry, {}, [(event, 'owner', 'a')], {}, self.now), {'a'})
        self.assertFalse(event.exists())
        self.assertEqual(self.registry.rows('assets:owner'), {})


if __name__ == '__main__':
    unittest.main()
