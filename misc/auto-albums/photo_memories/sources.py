from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat

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


def preview_item(asset):
    return {'id': asset['id'], 'captured_at': captured(asset).isoformat(),
            'checksum': asset.get('checksum'), 'thumbhash': asset.get('thumbhash'),
            'isEdited': asset.get('isEdited', False), 'duplicateId': asset.get('duplicateId'),
            'isFavorite': asset.get('isFavorite', False),
            'rating': (asset.get('exifInfo') or {}).get('rating')}


def evict_verified_render(destination, result, record, signature):
    if record.get('memory_phase') != 'verified' or record.get('render_input_digest') != signature:
        return {'phase': 'publication_pending', 'bytes_freed': 0}
    directory = Path(destination).absolute()
    if directory.name != signature or directory.resolve() != directory:
        return {'phase': 'unsafe_cache_path', 'bytes_freed': 0}
    released, blocked, seen = 0, [], set()
    for field, hash_key in [('video', 'video_sha256'), ('collage', 'collage_sha256'), ('cover', 'collage_sha256')]:
        if not result.get(field):
            continue
        path = Path(result[field]).absolute()
        if path in seen:
            continue
        seen.add(path)
        if path.parent != directory or path.name not in ('memory.mp4', 'collage.jpg', 'cover.jpg'):
            blocked.append(field)
            continue
        if not path.exists() and not path.is_symlink():
            continue
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, 'rb') as source:
                before = os.fstat(source.fileno())
                if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                    raise ValueError('Only a single-link generated regular cache file can be evicted')
                if hashlib.file_digest(source, 'sha256').hexdigest() != result.get(hash_key):
                    raise ValueError('Generated cache bytes differ from the verified publication')
            after = path.lstat()
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
                raise ValueError('Generated cache changed during eviction verification')
            path.unlink()
            released += before.st_size
        except (OSError, ValueError):
            blocked.append(field)
    return {'phase': 'unsafe_cache_files_preserved' if blocked else 'evicted', 'bytes_freed': released, 'preserved': blocked}
