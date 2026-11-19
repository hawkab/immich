"""Fetch the public model only at build time and verify its pinned bytes.

Author: Olshansky Grigory.
"""

import hashlib
import json
import os
import shutil
import sys
import urllib.request
from pathlib import Path


def main() -> None:
    """Publish a complete verified artifact without using the secret volume."""
    lock_path, destination = map(Path, sys.argv[1:])
    lock = json.loads(lock_path.read_text())
    destination.mkdir(parents=True, exist_ok=True)
    filename = lock["filename"]
    if Path(filename).name != filename or not lock["url"].startswith("https://github.com/ultralytics/assets/releases/"):
        raise ValueError("Invalid visual localizer model source")
    temporary = destination / (filename + ".partial")
    with urllib.request.urlopen(lock["url"]) as response, temporary.open("wb") as stream:
        shutil.copyfileobj(response, stream)
    with temporary.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if temporary.stat().st_size != lock["size"] or digest != lock["sha256"]:
        temporary.unlink()
        raise ValueError("Downloaded visual localizer model differs from the pinned release")
    os.replace(temporary, destination / filename)
    shutil.copyfile(lock_path, destination / "models.lock.json")


if __name__ == "__main__":
    main()
