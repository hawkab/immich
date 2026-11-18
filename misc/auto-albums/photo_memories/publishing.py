import base64
import hashlib
from pathlib import Path
import urllib.error

from .albums import managed_album, member_ids
from .sources import GENERATED_KEY, digest, live_photo, source_token


def verify_sources(owner, bucket, record, rendered):
    if not rendered['selected_ids']:
        return False
    album, phase = managed_album(owner, record)
    if album is None:
        record['phase'] = phase
        return False
    current = member_ids(album)
    expected = {asset['id']: asset for asset in bucket['assets']}
    snapshots = rendered.get('source_revisions', {})
    removed = set(rendered['selected_ids']) - current
    if removed:
        confirmed = removed & set(record.get('managed_source_ids', []))
        record['exclusions'] = sorted(set(record.get('exclusions', [])) | confirmed)
        record['membership_uncertain_ids'] = sorted(set(record.get('membership_uncertain_ids', [])) | (removed - confirmed))
        return False
    for identity in rendered['selected_ids']:
        if identity not in expected or identity in record.get('exclusions', []):
            return False
        actual = owner.call('/assets/' + identity)
        snapshot = snapshots.get(identity, expected[identity])
        if not live_photo(actual, owner.id) or source_token(actual) != source_token(snapshot):
            return False
        if actual.get('isEdited'):
            if 'edits' not in snapshot or digest(owner.call('/assets/' + identity + '/edits')) != digest(snapshot['edits']):
                return False
    return True


def generated_asset(owner, identity, intent):
    try:
        actual = owner.call('/assets/' + identity)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise
    if actual.get('ownerId') != owner.id or actual.get('type') != 'VIDEO':
        raise PermissionError('Generated video is not owned by the expected user')
    if actual.get('isTrashed'):
        return None
    if (actual.get('originalFileName') != intent['name'] or actual.get('checksum') not in (intent['sha1'], intent['sha1_hex'])
            or actual.get('visibility') != 'archive'):
        raise PermissionError('Refusing to label or alter an existing authored video')
    return actual


def publish_memory(owner, registry, bucket, record, render_result):
    scope, key = 'albums:' + owner.id, bucket['key']

    def save(phase):
        record['memory_phase'] = phase
        registry.put(scope, key, record)
        return record

    if record['phase'] != 'active' or record.get('video_suppressed'):
        return save('suppressed')
    if not verify_sources(owner, bucket, record, render_result):
        return save('sources_changed')
    album, _ = managed_album(owner, record)
    if record.get('video_id') and record['video_id'] not in member_ids(album):
        record['video_suppressed'] = True
        return save('suppressed')
    path = Path(render_result['video'])
    with path.open('rb') as source:
        sha1 = hashlib.file_digest(source, 'sha1').digest()
    with path.open('rb') as source:
        sha256 = hashlib.file_digest(source, 'sha256').hexdigest()
    if sha256 != render_result['video_sha256']:
        raise ValueError('Rendered video changed before publication')
    signature = render_result['membership_signature']
    metadata = {'generated': True, 'manager': 'aegis-auto-albums-v1', 'albumMarker': record['marker'],
                'sourceAssetIds': render_result['selected_ids'], 'inputDigest': bucket['input_digest'],
                'signature': signature, 'renderer': {'width': render_result['width'], 'height': render_result['height']},
                'music': render_result.get('soundtrack', {'kind': 'original_procedural'})}
    intent = record.get('video_intent')
    if intent and intent['signature'] != signature and not intent.get('complete'):
        return save('prior_upload_unknown')
    fresh = not intent or intent['signature'] != signature
    if fresh:
        intent = {'signature': signature, 'name': 'Aegis_Memory_' + signature + '_' + record['marker'].strip('[]').split(':')[-1] + '.mp4',
                  'sha1': base64.b64encode(sha1).decode(), 'sha1_hex': sha1.hex(), 'sha256': sha256, 'phase': 'upload_intent'}
        record['video_intent'] = intent
        save('upload_intent')
    if not intent.get('asset_id'):
        if not fresh:
            checked = owner.call('/assets/bulk-upload-check', {'assets': [{'id': intent['name'], 'checksum': intent['sha1']}]})['results'][0]
            if checked['action'] != 'reject':
                return save('upload_unknown')
            if checked.get('isTrashed'):
                record['video_suppressed'] = True
                return save('suppressed')
            intent['asset_id'] = checked['assetId']
            save('upload_reconciled')
        else:
            try:
                intent['asset_id'] = owner.upload(path, name=intent['name'], created_at=render_result.get('created_at'))
            except Exception as error:
                intent['error'] = type(error).__name__
                return save('upload_unknown')
            save('uploaded')
    identity = intent['asset_id']
    if generated_asset(owner, identity, intent) is None:
        record['video_suppressed'] = True
        return save('suppressed')
    registry.put('generated:' + owner.id, identity, {'generated': True, 'album_id': record['album_id'],
                 'albumMarker': record['marker'], 'signature': signature, 'phase': 'known_asset_id'})
    actual_metadata = owner.metadata(identity, GENERATED_KEY)
    if isinstance(actual_metadata, dict) and isinstance(actual_metadata.get('inputDigest'), str):
        metadata['inputDigest'] = actual_metadata['inputDigest']
    if actual_metadata is not None and actual_metadata != metadata:
        raise PermissionError('Existing video metadata does not match this managed publication')
    if actual_metadata is None:
        intent['phase'] = 'metadata_intent'
        save('metadata_intent')
        owner.call('/assets/' + identity + '/metadata', {'items': [{'key': GENERATED_KEY, 'value': metadata}]}, 'PUT')
    if owner.metadata(identity, GENERATED_KEY) != metadata:
        return save('metadata_unknown')
    if not verify_sources(owner, bucket, record, render_result):
        return save('sources_changed')
    if generated_asset(owner, identity, intent) is None:
        record['video_suppressed'] = True
        return save('suppressed')
    if owner.metadata(identity, GENERATED_KEY) != metadata:
        return save('metadata_unknown')
    album, _ = managed_album(owner, record)
    if identity not in member_ids(album):
        if intent.get('phase') == 'attach_intent':
            record['video_suppressed'] = True
            return save('suppressed')
        intent['phase'] = 'attach_intent'
        save('attach_intent')
        owner.call('/albums/' + record['album_id'] + '/assets', {'ids': [identity]}, 'PUT')
        album, record['phase'] = managed_album(owner, record)
        if album is None or identity not in member_ids(album):
            return save('attach_unknown')
    old = record.get('video_id')
    record.update(video_id=identity, signature=signature,
                  render_input_digest=render_result.get('input_digest', bucket['input_digest']))
    intent.update(phase='attached', complete=True)
    registry.put('generated:' + owner.id, identity, {**metadata, 'phase': 'verified'})
    save('attached')
    if old and old != identity and old in member_ids(album):
        old_detail = owner.call('/assets/' + old)
        old_metadata = owner.metadata(old, GENERATED_KEY)
        if old_detail.get('ownerId') != owner.id or not old_metadata or old_metadata.get('albumMarker') != record['marker'] or not old_metadata.get('generated'):
            raise PermissionError('Refusing to remove an authored video membership')
        record['retirement_intent'] = old
        save('retirement_intent')
        owner.call('/albums/' + record['album_id'] + '/assets', {'ids': [old]}, 'DELETE')
        record.pop('retirement_intent', None)
    elif record.get('retirement_intent'):
        if record['retirement_intent'] in member_ids(album):
            return save('retirement_unknown')
        record.pop('retirement_intent', None)
    return save('verified')
