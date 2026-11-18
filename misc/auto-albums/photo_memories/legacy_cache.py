import hashlib
import json
from pathlib import Path
import stat


def clear_legacy_cache(directory):
    root = Path(directory) / 'renders'
    result = {'files_removed': 0, 'bytes_freed': 0, 'unverified_files_preserved': 0}
    for receipt in root.rglob('render-result.json'):
        if receipt.is_symlink() or receipt.parent.resolve() != receipt.parent:
            continue
        try:
            value = json.loads(receipt.read_text())
        except (OSError, ValueError):
            result['unverified_files_preserved'] += 1
            continue
        if value.get('input_digest') != receipt.parent.name:
            continue
        seen = set()
        for field, checksum in [('video', 'video_sha256'), ('collage', 'collage_sha256'), ('cover', 'collage_sha256')]:
            if not value.get(field):
                continue
            path = Path(value[field])
            if path in seen:
                continue
            seen.add(path)
            if path.parent != receipt.parent or path.name not in ('memory.mp4', 'collage.jpg', 'cover.jpg'):
                result['unverified_files_preserved'] += 1
                continue
            if not path.exists():
                continue
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                result['unverified_files_preserved'] += 1
                continue
            with path.open('rb') as source:
                matches = hashlib.file_digest(source, 'sha256').hexdigest() == value.get(checksum)
            after = path.lstat()
            if not matches or (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
                result['unverified_files_preserved'] += 1
                continue
            path.unlink()
            result['files_removed'] += 1
            result['bytes_freed'] += info.st_size
    return result
