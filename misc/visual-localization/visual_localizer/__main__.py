"""Read one image from stdin and emit only normalized object coordinates.

Author: Olshansky Grigory.
"""

import json
import sys
from pathlib import Path

from .detector import ObjectDetector


def main() -> None:
    """Release inference memory when this on-demand operation finishes."""
    directory = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/opt/immich-visual-localizer/models")
    boxes = ObjectDetector(directory).detect(sys.stdin.buffer.read())
    print(json.dumps(boxes, allow_nan=False))


if __name__ == "__main__":
    main()
