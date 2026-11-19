"""Map letterboxed detector coordinates back to the original image.

Author: Olshansky Grigory.
"""

from dataclasses import dataclass

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class Transform:
    """Record the exact rounded resize and padding used by inference."""

    width: int
    height: int
    resized_width: int
    resized_height: int
    left: int
    top: int

    def region(self, xyxy: list[float]) -> dict[str, float] | None:
        """Return visible object bounds in normalized source coordinates."""
        x1, y1, x2, y2 = map(float, xyxy)
        x1 = min(self.width, max(0.0, (x1 - self.left) * self.width / self.resized_width))
        x2 = min(self.width, max(0.0, (x2 - self.left) * self.width / self.resized_width))
        y1 = min(self.height, max(0.0, (y1 - self.top) * self.height / self.resized_height))
        y2 = min(self.height, max(0.0, (y2 - self.top) * self.height / self.resized_height))
        if x2 <= x1 or y2 <= y1:
            return None
        return {
            "x": x1 / self.width,
            "y": y1 / self.height,
            "width": (x2 - x1) / self.width,
            "height": (y2 - y1) / self.height,
        }


def prepare(image: Image.Image, input_height: int, input_width: int) -> tuple[np.ndarray, Transform]:
    """Letterbox once and allocate a single contiguous float input tensor."""
    width, height = image.size
    scale = min(input_width / width, input_height / height)
    rw, rh = max(1, round(width * scale)), max(1, round(height * scale))
    left, top = (input_width - rw) // 2, (input_height - rh) // 2
    canvas = Image.new("RGB", (input_width, input_height), (114, 114, 114))
    canvas.paste(image.resize((rw, rh), Image.Resampling.BILINEAR), (left, top))
    tensor = np.empty((1, 3, input_height, input_width), dtype=np.float32)
    np.multiply(np.asarray(canvas).transpose(2, 0, 1), 1 / 255, out=tensor[0])
    return tensor, Transform(width, height, rw, rh, left, top)


def overlap(a: dict, b: dict) -> float:
    """Compute intersection over union for normalized rectangles."""
    x1, y1 = max(a["x"], b["x"]), max(a["y"], b["y"])
    x2 = min(a["x"] + a["width"], b["x"] + b["width"])
    y2 = min(a["y"] + a["height"], b["y"] + b["height"])
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    return intersection / (a["width"] * a["height"] + b["width"] * b["height"] - intersection)


def suppress_duplicates(boxes: list[dict], iou: float) -> list[dict]:
    """Retain separate objects while suppressing duplicate predictions of one class."""
    selected = []
    for box in sorted(boxes, key=lambda candidate: candidate["confidence"], reverse=True):
        if not any(
            box["classId"] == prior["classId"] and overlap(box["region"], prior["region"]) > iou for prior in selected
        ):
            selected.append(box)
    return selected
