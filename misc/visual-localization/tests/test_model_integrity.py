"""Reject damaged weights before running inference.

Author: Olshansky Grigory.
"""

import json

import pytest

from visual_localizer.detector import ObjectDetector


def test_invalid_model_is_rejected_before_a_session_is_loaded(tmp_path):
    """A changed model cannot silently generate authoritative object coordinates."""
    (tmp_path / "model.onnx").write_bytes(b"damaged")
    (tmp_path / "models.lock.json").write_text(json.dumps({"filename": "model.onnx", "sha256": "wrong", "size": 7}))
    with pytest.raises(ValueError, match="pinned release"):
        ObjectDetector(tmp_path)
