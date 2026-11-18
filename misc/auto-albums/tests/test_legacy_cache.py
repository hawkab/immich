import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from photo_memories.legacy_cache import clear_legacy_cache


class LegacyCacheTests(unittest.TestCase):
    def test_only_receipt_bound_outputs_are_removed_without_deleting_receipt(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            directory = root / 'renders/owner/bucket' / ('a' * 64)
            directory.mkdir(parents=True)
            video = directory / 'memory.mp4'
            video.write_bytes(b'owned-derived-video')
            receipt = directory / 'render-result.json'
            receipt.write_text(json.dumps({'input_digest': directory.name, 'video': str(video),
                'video_sha256': hashlib.sha256(video.read_bytes()).hexdigest()}))
            result = clear_legacy_cache(root)
            self.assertEqual(result['files_removed'], 1)
            self.assertFalse(video.exists())
            self.assertTrue(receipt.exists())
            self.assertEqual(clear_legacy_cache(root)['files_removed'], 0)

    def test_foreign_path_changed_file_and_symlink_are_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            directory = root / 'renders/owner/bucket' / ('a' * 64)
            directory.mkdir(parents=True)
            original = root / 'original.mp4';original.write_bytes(b'original')
            for path in (original, directory / 'memory.mp4'):
                if path != original:
                    path.symlink_to(original)
                (directory / 'render-result.json').write_text(json.dumps({'input_digest': directory.name,
                    'video': str(path), 'video_sha256': hashlib.sha256(original.read_bytes()).hexdigest()}))
                self.assertEqual(clear_legacy_cache(root)['files_removed'], 0)
                self.assertEqual(original.read_bytes(), b'original')
