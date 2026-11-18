import base64
import json
import unittest

from photo_memories.previews import PreviewPending, validate_preview


class PreviewProofTests(unittest.TestCase):
    def test_immutable_managed_unedited_preview_is_not_blocked_by_legacy_header(self):
        asset = {'id': 'asset', 'checksum': 'hash', 'isEdited': False, 'libraryId': None}
        self.assertEqual(validate_preview(asset, [], {'X-Immich-Media-Kind': 'original'})['basis'], 'managed_immutable_original')
        with self.assertRaises(PreviewPending):
            validate_preview(asset, [], {'X-Immich-Media-Kind': 'edited'})

    def test_edited_preview_needs_actual_producer_revision(self):
        asset = {'id': 'asset', 'checksum': 'hash', 'isEdited': True}
        edits = [{'action': 'rotate', 'parameters': {'angle': 90}}]
        with self.assertRaises(PreviewPending):
            validate_preview(asset, edits, {})
        proof = {'assetId': 'asset', 'sourceChecksum': 'hash', 'edits': edits,
                 'previewKind': 'edited', 'generation': 'actual-immutable-producer-generation'}
        encode = lambda value: {'X-Immich-Media-Proof': base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')}
        self.assertEqual(validate_preview(asset, edits, encode(proof)), proof)
        self.assertEqual(validate_preview(asset, {'assetId': 'asset', 'edits': edits}, encode(proof)), proof)
        for changed in ({**proof, 'assetId': 'other'}, {**proof, 'sourceChecksum': 'old'},
                        {**proof, 'edits': [{'action': 'rotate', 'parameters': {'angle': 180}}]}):
            with self.assertRaises(PreviewPending):
                validate_preview(asset, edits, encode(changed))

    def test_mutable_external_preview_does_not_inherit_managed_original_assumption(self):
        with self.assertRaises(PreviewPending):
            validate_preview({'id': 'asset', 'checksum': 'hash', 'libraryId': 'external'}, [], {})


if __name__ == '__main__':
    unittest.main()
