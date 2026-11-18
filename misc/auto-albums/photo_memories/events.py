import json
import ctypes
import os
from pathlib import Path
import select
import stat
import time
import uuid


def claim(directory, workspace=None):
    directory = Path(directory)
    if not directory.is_dir():
        return
    claimed = Path(workspace) if workspace else directory / 'processing'
    if claimed.is_symlink():
        raise PermissionError('The claim directory must not be a symlink')
    claimed.mkdir(mode=0o700, exist_ok=True)
    for path in sorted(directory.glob('*.json')):
        target = claimed / (path.stem + '.' + uuid.uuid4().hex + '.json')
        try:
            os.replace(path, target)
        except FileNotFoundError:
            continue
    for path in sorted(claimed.glob('*.json')):
        try:
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ValueError('An event must be a regular single-link file')
            value = json.loads(path.read_text())
            owner = str(uuid.UUID(value['ownerId']))
            asset = str(uuid.UUID(value['assetId']))
            yield path, owner, asset
        except (ValueError, KeyError, TypeError):
            quarantine = claimed / 'quarantine'
            quarantine.mkdir(mode=0o700, exist_ok=True)
            os.replace(path, quarantine / path.name)


def wait_for_changes(directory, seconds):
    library = ctypes.CDLL(None, use_errno=True)
    descriptor = library.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
    if descriptor < 0:
        time.sleep(seconds)
        return
    try:
        watch = library.inotify_add_watch(descriptor, os.fsencode(directory), 0x00000080 | 0x00000008)
        if watch < 0:
            time.sleep(seconds)
            return
        if any(Path(directory).glob('*.json')):
            return
        if select.select([descriptor], [], [], seconds)[0]:
            os.read(descriptor, 65536)
    finally:
        os.close(descriptor)


def pending_sources(directory, registry):
    for path in Path(directory).glob('*.json'):
        try:
            value = json.loads(path.read_text())
        except FileNotFoundError:
            continue
        except ValueError:
            return True
        if not isinstance(value, dict) or 'ownerId' not in value or 'assetId' not in value:
            return True
        if not registry.get('generated:' + value['ownerId'], value['assetId']):
            return True
    return False
