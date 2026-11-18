import base64
import json

from .sources import digest, logical_edits


class PreviewPending(Exception):
    pass


def validate_preview(asset, edits, headers):
    value = next((value for key, value in headers.items() if key.casefold() == 'x-immich-media-proof'), None)
    kind = next((value for key, value in headers.items() if key.casefold() == 'x-immich-media-kind'), None)
    if not asset.get('isEdited') and not edits and asset.get('libraryId') is None and kind == 'original':
        return {'basis': 'managed_immutable_original', 'sourceChecksum': asset['checksum']}
    if not value:
        raise PreviewPending('The selected preview has no producer-bound source revision')
    try:
        proof = json.loads(base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True))
        valid = (proof['assetId'] == asset['id'] and proof['sourceChecksum'] == asset['checksum']
                 and proof['edits'] == logical_edits(edits)
                 and proof['previewKind'] == ('edited' if asset.get('isEdited') else 'original')
                 and isinstance(proof['generation'], str) and bool(proof['generation']))
    except (ValueError, KeyError, TypeError):
        valid = False
    if not valid:
        raise PreviewPending('The preview producer revision differs from the current source')
    return proof


def request_regeneration(owner, registry, asset):
    edits = owner.call('/assets/' + asset['id'] + '/edits')
    generation = digest({'checksum': asset['checksum'], 'edits': logical_edits(edits)})
    scope = 'preview-jobs:' + owner.id
    previous = registry.get(scope, asset['id'], {})
    if previous.get('generation') == generation and previous.get('phase') in ('queued', 'intent', 'transport_unknown'):
        return
    record = {'generation': generation, 'phase': 'intent'}
    registry.put(scope, asset['id'], record)
    try:
        owner.call('/assets/jobs', {'assetIds': [asset['id']], 'name': 'regenerate-thumbnail'}, 'POST')
        record['phase'] = 'queued'
    except Exception as error:
        record.update(phase='transport_unknown', error_type=type(error).__name__)
        raise
    finally:
        registry.put(scope, asset['id'], record)


def mark_preview_ready(owner, registry, asset, edits, proof):
    generation = digest({'checksum': asset['checksum'], 'edits': logical_edits(edits)})
    registry.put('preview-jobs:' + owner.id, asset['id'], {
        'generation': generation, 'phase': 'verified', 'producer_generation': proof.get('generation'),
        'basis': proof.get('basis', 'producer_bound'),
    })
