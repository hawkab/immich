from pathlib import Path
import subprocess
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageStat

from photo_memories.rendering import render_memory
from photo_memories.rendering.encoding import probe_video


class ActualEncodingTests(unittest.TestCase):
    def fixture(self, root, name, size, color, captured_at):
        path = root / (name + '.png')
        image = Image.new('RGB', size, color)
        ImageDraw.Draw(image).rectangle((size[0] // 4, size[1] // 4, size[0] * 3 // 4, size[1] * 3 // 4),
                                        fill='white')
        image.save(path)
        return {'id': name, 'path': path, 'captured_at': captured_at}

    def test_real_mp4_has_audio_chronology_and_final_collage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            older = self.fixture(root, 'older', (120, 240), 'coral', '2020-01-01T00:00:00Z')
            newer = self.fixture(root, 'newer', (240, 120), 'seagreen', '2021-02-03T00:00:00Z')
            result = render_memory([newer, older], root / 'render', title='Наши воспоминания', theme='family',
                                   duration_seconds=10, width=320, height=180)
            self.assertEqual(result['selected_ids'], ['older', 'newer'])
            streams = {stream['codec_type']: stream for stream in probe_video(result['video'])['streams']}
            self.assertEqual(streams['video']['codec_name'], 'h264')
            self.assertEqual(streams['audio']['codec_name'], 'aac')
            self.assertEqual((streams['video']['width'], streams['video']['height']), (320, 180))
            self.assertAlmostEqual(float(streams['video']['duration']), result['duration'], places=2)
            audio = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(result['video']), '-map', '0:a:0',
                                    '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'],
                                   check=True, capture_output=True).stdout
            self.assertGreater(np.sqrt(np.mean(np.frombuffer(audio, dtype='<i2').astype(float) ** 2)), 100)
            last = root / 'last.png'
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-sseof', '-0.08', '-i', str(result['video']),
                            '-frames:v', '1', str(last)], check=True, capture_output=True)
            with Image.open(last) as actual, Image.open(result['collage']) as expected:
                difference = ImageStat.Stat(ImageChops.difference(actual.convert('RGB'), expected.convert('RGB')))
                self.assertLess(sum(difference.mean) / 3, 8)
            self.assertTrue((root / 'render/render.json').is_file())
            self.assertFalse(list((root / 'render').glob('.render-*')))

    def test_one_photo_still_produces_real_reel_and_collage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            only = self.fixture(root, 'only', (120, 240), 'steelblue', '2020-01-01T00:00:00Z')
            result = render_memory([only], root / 'render', title='Один тёплый момент', duration_seconds=2,
                                   width=320, height=180)
            self.assertEqual(result['selected_ids'], ['only'])
            self.assertGreater(result['video'].stat().st_size, 1000)
            with Image.open(result['collage']) as image:
                self.assertEqual(image.size, (320, 180))
            repeated = render_memory([only], root / 'again', title='Один тёплый момент', duration_seconds=2,
                                     width=320, height=180)
            self.assertEqual(result['video_sha256'], repeated['video_sha256'])
            self.assertEqual(result['collage_sha256'], repeated['collage_sha256'])

    def test_unselected_members_need_no_download_and_still_define_album_date_range(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            middle = self.fixture(root, 'middle', (120, 240), 'steelblue', '2020-01-01T00:00:00Z')
            items = [middle, {'id': 'before', 'captured_at': '2019-01-01T00:00:00Z'},
                     {'id': 'after', 'captured_at': '2021-01-01T00:00:00Z'}]
            result = render_memory(items, root / 'render', title='Семейные истории', duration_seconds=2,
                                   width=320, height=180)
            self.assertEqual(result['selected_ids'], ['middle'])
            self.assertEqual(result['date_caption'], '01.01.2019 — 01.01.2021')
            self.assertEqual(result['created_at'], '2019-01-01T00:00:00+00:00')
            self.assertEqual(probe_video(result['video'])['format']['tags']['creation_time'], '2019-01-01T00:00:00.000000Z')
            self.assertEqual(result['selection']['candidate_count'], 3)


if __name__ == '__main__':
    unittest.main()
