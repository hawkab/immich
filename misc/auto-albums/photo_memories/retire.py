import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import urllib.error
import uuid

from .client import Owner
from .legacy_cache import clear_legacy_cache
from .sources import GENERATED_KEY
from .state import Registry
from .status import save_status


def generated_origin(asset, metadata, intent):
    if asset.get('type') != 'VIDEO':
        return False
    if not re.fullmatch(r'Aegis_Memory_[a-f0-9]{64}_[a-f0-9-]{36}\.mp4', asset.get('originalFileName', '')):
        return False
    if intent and (asset['id'] == intent.get('asset_id') and asset['originalFileName'] == intent.get('name')
                   and asset['checksum'] in (intent.get('sha1'), intent.get('sha1_hex'))):
        return True
    if not isinstance(metadata, dict) or metadata.get('generated') is not True or metadata.get('manager') != 'aegis-auto-albums-v1':
        return False
    marker = metadata.get('albumMarker', '')
    signature = metadata.get('signature', '')
    if not isinstance(marker, str) or not isinstance(signature, str):
        return False
    try:
        identity = str(uuid.UUID(marker.removeprefix('[aegis:memory:v1:').removesuffix(']')))
    except (ValueError, AttributeError):
        return False
    return (marker == '[aegis:memory:v1:' + identity + ']' and re.fullmatch('[a-f0-9]{64}', signature) is not None
            and asset['originalFileName'] == 'Aegis_Memory_' + signature + '_' + identity + '.mp4')


def retire_owner(owner, registry):
    intents = {record['video_intent']['asset_id']: record['video_intent']
        for record in registry.rows('albums:' + owner.id).values()
        if (record.get('video_intent') or {}).get('asset_id')}
    candidates = {asset['id']: asset for asset in owner.assets(original_file_name='Aegis_Memory_')}
    known = registry.rows('generated:' + owner.id)
    for identity in (intents.keys() | known.keys()) - candidates.keys():
        try:
            candidates[identity] = owner.call('/assets/' + identity)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
    scope = 'legacy-retirement:' + owner.id
    result = {'candidates': len(candidates), 'trashed': 0, 'already_trashed': 0, 'previously_retired': 0,
              'preserved_unverified': 0, 'errors': []}
    for identity in candidates:
        previous = registry.get(scope, identity, {})
        if previous.get('phase') == 'verified':
            result['previously_retired'] += 1
            continue
        try:
            asset = owner.call('/assets/' + identity)
            if asset.get('ownerId') != owner.id:
                raise PermissionError('A legacy artifact belongs to another owner')
            metadata = owner.metadata(identity, GENERATED_KEY)
            if metadata is None:
                metadata = known.get(identity)
            if not generated_origin(asset, metadata, intents.get(identity)):
                result['preserved_unverified'] += 1
                continue
            if asset.get('isTrashed'):
                result['already_trashed'] += 1
            else:
                proof = {'checksum': asset['checksum'], 'filename': asset['originalFileName'], 'phase': 'detach_intent'}
                registry.put(scope, identity, proof)
                for album in owner.call('/albums?assetId=' + identity):
                    if album.get('albumUsers', [{}])[0].get('user', {}).get('id') == owner.id:
                        owner.call('/albums/' + album['id'] + '/assets', {'ids': [identity]}, 'DELETE')
                fresh = owner.call('/assets/' + identity)
                if (fresh.get('ownerId'), fresh.get('checksum')) != (owner.id, proof['checksum']):
                    raise PermissionError('The legacy artifact changed during retirement')
                registry.put(scope, identity, {**proof, 'phase': 'trash_intent'})
                try:
                    owner.call('/assets', {'ids': [identity], 'force': False}, 'DELETE')
                except OSError:
                    if not owner.call('/assets/' + identity).get('isTrashed'):
                        raise
                if not owner.call('/assets/' + identity).get('isTrashed'):
                    raise RuntimeError('Legacy artifact retirement needs readback reconciliation')
                result['trashed'] += 1
            registry.put(scope, identity, {'phase': 'verified', 'checksum': asset['checksum'], 'filename': asset['originalFileName']})
        except Exception as error:
            result['errors'].append({'asset': identity, 'error_type': type(error).__name__, 'detail': str(error)})
    return result


def run(profile):
    os.umask(0o077)
    directory = Path(profile['state_directory'])
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (directory / 'worker.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        registry = Registry(directory / 'registry.sqlite3')
        accounts = [Path(profile['credential_directory']) / 'login.json',
                    *sorted((Path(profile['credential_directory']) / 'users').glob('*.login.json'))]
        result = {'phase': 'complete', 'owners': {}}
        try:
            for account in accounts:
                if not account.is_file():
                    continue
                owner = Owner(profile, account)
                try:
                    result['owners'][owner.id] = retire_owner(owner, registry)
                    if result['owners'][owner.id]['errors']:
                        result['phase'] = 'reconciliation_pending'
                finally:
                    owner.close()
        finally:
            registry.close()
        result['cache'] = clear_legacy_cache(directory)
        save_status(directory / 'GENERATED-RETIREMENT.json', result)
        return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('profile', type=Path)
    args = parser.parse_args()
    result = run(json.loads(args.profile.read_text()))
    print(json.dumps({'phase': result['phase'], 'owners': result['owners']}))
    raise SystemExit(0 if result['phase'] == 'complete' else 1)
