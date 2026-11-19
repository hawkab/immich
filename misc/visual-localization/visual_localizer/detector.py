"""Run the pinned Ultralytics detector on CPU with no network or source writes.

Author: Olshansky Grigory.
"""

import ast
import hashlib
import json
from io import BytesIO
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps

from .geometry import prepare, suppress_duplicates


class ObjectDetector:
    """Turn model detections into complete, source-relative object proposals."""

    def __init__(self, directory: Path):
        """Verify the immutable model before creating a single-thread CPU session."""
        self.lock = json.loads((directory / "models.lock.json").read_text())
        name = self.lock["filename"]
        if Path(name).name != name:
            raise ValueError("Invalid model filename")
        model = directory / name
        with model.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if model.stat().st_size != self.lock["size"] or digest != self.lock["sha256"]:
            raise ValueError("Visual localizer model differs from the pinned release")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
        self.input = self.session.get_inputs()[0]
        metadata = self.session.get_modelmeta().custom_metadata_map
        self.names = ast.literal_eval(metadata["names"])
        self.height, self.width = map(int, self.input.shape[-2:])

    def detect(self, data: bytes) -> list[dict]:
        """Infer all supported objects and undo resize and padding exactly."""
        image = ImageOps.exif_transpose(Image.open(BytesIO(data))).convert("RGB")
        tensor, transform = prepare(image, self.height, self.width)
        output = self.session.run(None, {self.input.name: tensor})[0]
        if output.ndim != 3 or output.shape[0] != 1 or output.shape[-1] != 6 or not np.isfinite(output).all():
            raise ValueError("Invalid visual localizer output")
        boxes = []
        for x1, y1, x2, y2, confidence, label in output[0]:
            if confidence < self.lock["confidence_threshold"]:
                continue
            class_id = int(label)
            if label != class_id or class_id not in self.names:
                raise ValueError("Invalid visual localizer class")
            region = transform.region([x1, y1, x2, y2])
            if region:
                boxes.append({"region": region, "confidence": float(confidence), "classId": class_id})
        return suppress_duplicates(boxes, self.lock["iou_threshold"])
