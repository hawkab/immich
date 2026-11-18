from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageDraw

from photo_memories.rendering.imaging import photo_frame
from photo_memories.rendering.planning import membership_signature, select_memory_items
from photo_memories.rendering.music import synthesize_music


class SelectionTests(unittest.TestCase):
    def test_duration_selection_is_chronological_and_spans_membership(self):
        start = datetime(2020, 1, 1, tzinfo=timezone.utc)
        items = [{'id': str(index), 'captured_at': (start + timedelta(days=index)).isoformat()} for index in range(300)]
        selected = select_memory_items(list(reversed(items)), 45)
        self.assertEqual(selected[0]['id'], '0')
        self.assertEqual(selected[-1]['id'], '299')
        self.assertEqual(selected, sorted(selected, key=lambda item: item['captured_at']))
        self.assertGreater(len(select_memory_items(items, 90)), len(selected))

    def test_single_photo_is_never_dropped(self):
        item = {'id': 'only', 'captured_at': '2020-01-01T00:00:00Z'}
        self.assertEqual(select_memory_items([item], 45), [item])
        self.assertEqual(select_memory_items([item], 0.01), [item])

    def test_changed_membership_changes_signature_even_when_not_rendered(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'preview.png'
            Image.new('RGB', (80, 60), 'coral').save(path)
            selected = [{'id': 'rendered', 'path': path}]
            options = {'title': 'Дом', 'theme': 'family', 'duration_seconds': 45, 'width': 1280, 'height': 720}
            first, _ = membership_signature(selected, selected, **options)
            second, _ = membership_signature([*selected, {'id': 'new-unselected'}], selected, **options)
            self.assertNotEqual(first, second)

    def test_modified_verified_preview_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'preview.png'
            Image.new('RGB', (80, 60), 'coral').save(path)
            item = {'id': 'changed', 'path': path, 'sha256': '0' * 64}
            with self.assertRaisesRegex(ValueError, 'changed after'):
                membership_signature([item], [item], title='Дом', theme='family', duration_seconds=45, width=1280, height=720)


class ImagingAndMusicTests(unittest.TestCase):
    def test_portrait_foreground_keeps_all_four_edges_even_after_maximum_zoom(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'portrait.png'
            image = Image.new('RGB', (80, 160), 'white')
            drawing = ImageDraw.Draw(image)
            drawing.rectangle((0, 0, 79, 9), fill=(255, 0, 0))
            drawing.rectangle((0, 150, 79, 159), fill=(0, 255, 0))
            drawing.rectangle((0, 10, 9, 149), fill=(0, 0, 255))
            drawing.rectangle((70, 10, 79, 149), fill=(255, 255, 0))
            image.save(path)
            frame = photo_frame(path, 640, 360)
            margin_x, margin_y = (640 - 640 / 1.035) / 2, (360 - 360 / 1.035) / 2
            safe = frame.crop((margin_x, margin_y, 640 - margin_x, 360 - margin_y))
            pixels = np.asarray(safe, dtype=np.int16)
            for expected in [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)]:
                self.assertGreater(np.all(np.abs(pixels - np.array(expected)) < 10, axis=2).sum(), 100)

    def test_original_music_is_deterministic_and_seeded(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            a = synthesize_music(root / 'a.wav', 1.3, 'alpha', sample_rate=8000)
            b = synthesize_music(root / 'b.wav', 1.3, 'alpha', sample_rate=8000)
            c = synthesize_music(root / 'c.wav', 1.3, 'beta', sample_rate=8000)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            self.assertNotEqual(a.read_bytes(), c.read_bytes())


if __name__ == '__main__':
    unittest.main()
