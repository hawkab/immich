import json
import os
from pathlib import Path
import tempfile


def save_status(path, value):
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix='.status-', dir=path.parent)
    with os.fdopen(descriptor, 'w') as target:
        json.dump(value, target, ensure_ascii=False, indent=2, default=str)
        target.write('\n')
        target.flush()
        os.fsync(target.fileno())
    os.replace(temporary, path)
