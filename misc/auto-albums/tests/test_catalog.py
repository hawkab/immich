from copy import deepcopy
from pathlib import Path
import json
import tempfile
import unittest
import uuid

from photo_memories.catalog import classification, curate, plan_buckets
from photo_memories.events import claim
from photo_memories.sources import current_scene, source_token


def photo(identity='photo-a', date='2018-07-04T12:30:00', **extra):
    return {'id': identity, 'ownerId': 'owner', 'localDateTime': date, 'fileCreatedAt': date,
            'createdAt': '2026-11-18T12:00:00Z', 'checksum': identity, 'thumbhash': 'hash',
            'isEdited': False, 'type': 'IMAGE', 'exifInfo': {}, **extra}


def scene(asset, **extra):
    return {'schemaVersion': 1, 'sourceChecksum': asset['checksum'], 'thumbhash': asset['thumbhash'],
            'sourceToken': source_token(asset), 'kind': 'photo', 'facts': [], 'depictedOnly': [], **extra}


class CatalogTests(unittest.TestCase):
    def test_import_date_does_not_merge_historical_years(self):
        a, b = photo(), photo('b', '2020-02-01T01:00:00')
        result = plan_buckets([a, b], {})
        self.assertEqual(set(result), {'month:2018-07', 'month:2020-02'})

    def test_late_earlier_source_keeps_location_album_identity(self):
        later = photo(exifInfo={'city': 'Сочи'})
        earlier = photo('early', '2018-07-01T01:00:00', exifInfo={'city': 'Сочи'})
        old = {key for key in plan_buckets([later], {}) if key.startswith('place:')}
        new = {key for key in plan_buckets([earlier, later], {}) if key.startswith('place:')}
        self.assertEqual(old, new)

    def test_toy_horse_is_a_horse_theme_without_riding_requirement(self):
        asset = photo()
        value = scene(asset, facts=['девочка стоит у мягкой игрушки лошади'], depictedOnly=['лошадь'])
        self.assertIn('horse', classification(asset, value))

    def test_source_bound_visible_horse_creates_theme(self):
        asset = photo()
        value = scene(asset, facts=['девочка стоит рядом с лошадью'])
        self.assertIn('horse', classification(asset, value))
        changed = {**asset, 'checksum': 'new original'}
        self.assertFalse(current_scene(changed, value))
        self.assertNotIn('horse', classification(changed, value))

    def test_cat_theme_does_not_match_cottage_or_cutlet(self):
        asset = photo()
        for word in ('коттедж', 'котлета'):
            self.assertNotIn('cat', classification(asset, scene(asset, facts=[word])))

    def test_malformed_edited_proof_is_not_an_accepted_scene(self):
        asset = photo(isEdited=True, _edits=[])
        self.assertFalse(current_scene(asset, scene(asset, previewProof=['malformed'])))

    def test_screenshot_is_organized_without_a_family_reel(self):
        asset = photo(originalFileName='Screenshot_2018.png')
        result = plan_buckets([asset], {})
        self.assertEqual(list(result), ['technical:2018'])
        self.assertFalse(result['technical:2018']['render'])

    def test_membership_is_not_limited_to_video_frame_selection(self):
        assets = [photo(str(index)) for index in range(1201)]
        result = plan_buckets(assets, {})['month:2018-07']
        self.assertEqual(len(result['assets']), len(assets))

    def test_duplicate_group_uses_favorite_but_keeps_distinct_groups(self):
        a, b, c = photo(duplicateId='dupe'), photo('b', duplicateId='dupe', isFavorite=True), photo('c')
        self.assertEqual({x['id'] for x in curate([a, b, c])}, {'b', 'c'})

    def test_edit_to_edit_changes_render_digest(self):
        asset = photo(isEdited=True, _edits=[{'action': 'rotate', 'parameters': {'angle': 90}}])
        changed = deepcopy(asset)
        changed['_edits'][0]['parameters']['angle'] = 180
        self.assertNotEqual(plan_buckets([asset], {})['month:2018-07']['input_digest'],
                            plan_buckets([changed], {})['month:2018-07']['input_digest'])


class EventTests(unittest.TestCase):
    def test_one_malformed_event_does_not_poison_the_valid_queue(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            owner, asset = str(uuid.uuid4()), str(uuid.uuid4())
            (root / 'bad.json').write_text('{invalid-json')
            (root / 'good.json').write_text(json.dumps({'ownerId': owner, 'assetId': asset}))
            result = list(claim(root))
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0][1:], (owner, asset))
            self.assertEqual(len(list((root / 'processing/quarantine').glob('*.json'))), 1)

    def test_claim_survives_restart_and_preserves_new_coalesced_event(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            owner, asset = str(uuid.uuid4()), str(uuid.uuid4())
            value = {'ownerId': owner, 'assetId': asset, 'reason': 'metadata'}
            path = root / (owner + '.' + asset + '.json')
            path.write_text(json.dumps(value))
            first = list(claim(root))
            self.assertEqual(len(first), 1)
            path.write_text(json.dumps({**value, 'reason': 'scene-metadata'}))
            self.assertEqual(len(list(claim(root))), 2)
            self.assertTrue(first[0][0].exists())


if __name__ == '__main__':
    unittest.main()
