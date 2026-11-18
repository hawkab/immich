from datetime import datetime, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from photo_memories.catalog import classification, plan_buckets
from photo_memories.pipeline import process
from photo_memories.policy import burial_context, eligible_assets
from test_albums import AlbumFixture
from test_catalog import photo, scene


class AlbumPolicyTests(AlbumFixture, unittest.TestCase):
    def test_burial_never_enters_date_place_or_playful_collections(self):
        asset = photo(exifInfo={'city': 'Москва'})
        for text in ('кладбище, осенний лес, надгробие с портретом мужчины',
                     'могила, искусственные цветы, российский флаг', 'траурный венок, гранитная плита',
                     'cemetery gravestone', 'a burial with flowers'):
            with self.subTest(text=text):
                value = scene(asset, searchText=text, depictedOnly=['мужчина'])
                self.assertEqual(plan_buckets([asset], {asset['id']: value}), {})

    def test_wreath_on_child_rattle_and_public_monument_are_not_burials(self):
        for text in ('девочка, цветочный венок, улыбка', 'младенец, погребушка',
                     'памятник в виде самолёта', 'a gravel road'):
            self.assertFalse(burial_context({'searchText': text}), text)

    def test_representation_alone_does_not_mean_play(self):
        asset = photo()
        value = scene(asset, searchText='портрет мужчины', depictedOnly=['мужчина'])
        self.assertNotIn('creative', classification(asset, value))

    def test_unclassified_upload_waits_for_content_without_failing(self):
        asset = photo()
        self.assertEqual(plan_buckets([asset], {}), {})
        allowed, excluded, waiting = eligible_assets(self.owner, self.registry, [asset], {})
        self.assertEqual((allowed, excluded, waiting), ([], [], [asset['id']]))

    def test_confirmed_exclusion_survives_recaptions_and_duplicate_import(self):
        asset = photo()
        eligible_assets(self.owner, self.registry, [asset], {asset['id']: scene(asset, searchText='могила')})
        clone = {**asset, 'id': 'duplicate'}
        allowed, excluded, waiting = eligible_assets(self.owner, self.registry, [clone],
            {clone['id']: scene(clone, searchText='деревья')})
        self.assertEqual((allowed, excluded, waiting), ([], ['duplicate'], []))

    def test_pipeline_removes_burial_from_all_managed_groups_but_keeps_original(self):
        asset = photo('photo-a')
        self.owner.assets[asset['id']] = asset
        clean = scene(asset, searchText='игрушки на прогулке')
        self.registry.put('assets:owner', asset['id'], {'asset': asset, 'scene': clean})
        now = datetime.now(timezone.utc)
        with patch('photo_memories.pipeline.synchronize', return_value=set()):
            process(self.owner, self.registry, {}, [], {}, now)
            burial = scene(asset, searchText='могила, памятник, искусственные цветы', depictedOnly=['мужчина'])
            self.registry.put('assets:owner', asset['id'], {'asset': asset, 'scene': burial})
            status = process(self.owner, self.registry, {}, [], {}, now)
        self.assertEqual(status['excluded_burial'], 1)
        self.assertEqual(status['errors'], [])
        self.assertTrue(all(not album['assets'] for album in self.owner.albums.values()))
        self.assertIn(asset['id'], self.owner.assets)
        self.assertTrue(all(call[0].startswith('/albums/') for call in self.owner.writes if call[2] == 'DELETE'))

    def test_policy_removes_even_manual_burial_addition_only_from_managed_album(self):
        from photo_memories.albums import sync_album
        record = sync_album(self.owner, self.registry, self.bucket)
        album = self.owner.albums[record['album_id']]
        album['assets'].append({'id': 'known-burial'})
        sync_album(self.owner, self.registry, self.bucket, excluded_ids={'known-burial'})
        self.assertNotIn('known-burial', {a['id'] for a in album['assets']})
