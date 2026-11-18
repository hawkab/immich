from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3

SCENE_KEY = 'org.immich.scene.v1'
GENERATED_KEY = 'org.immich.memory.v1'


def instant(value):
    parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def captured(asset):
    return instant(asset.get('localDateTime') or (asset.get('exifInfo') or {}).get('dateTimeOriginal')
                   or asset['fileCreatedAt'])


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode()).hexdigest()


def source_token(asset):
    raw = json.dumps({key: asset.get(key) for key in ('checksum', 'thumbhash', 'isEdited')}, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()


def current_scene(asset, scene):
    if not isinstance(scene, dict):
        return False
    if asset.get('isEdited'):
        proof = scene.get('previewProof') or {}
        if not isinstance(proof, dict):
            return False
        edits = logical_edits(asset.get('_edits', []))
        if ('_edits' not in asset or proof.get('edits') != edits or proof.get('assetId') != asset['id']
                or proof.get('sourceChecksum') != asset.get('checksum') or not proof.get('generation')):
            return False
    return (isinstance(scene, dict) and scene.get('schemaVersion') == 1
            and scene.get('sourceChecksum') == asset.get('checksum')
            and scene.get('sourceToken') == source_token(asset)
            and scene.get('thumbhash') == asset.get('thumbhash')
            and (not asset.get('isEdited') or scene.get('previewKind') == 'edited'))


def logical_edits(response):
    rows = response['edits'] if isinstance(response, dict) else response
    return [{'action': row['action'], 'parameters': row['parameters']} for row in rows]


def live_photo(asset, owner):
    return (asset.get('ownerId') == owner and not asset.get('isTrashed') and not asset.get('isOffline')
            and asset.get('visibility') not in ('hidden', 'locked')
            and asset.get('type') in ('IMAGE', 'VIDEO'))


def scene_cache(path):
    if not path or not Path(path).is_file():
        return {}
    with closing(sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)) as database:
        return {(owner, asset): json.loads(value) for owner, asset, value in database.execute(
            "SELECT owner,asset,value FROM outbox WHERE phase='verified'")}
