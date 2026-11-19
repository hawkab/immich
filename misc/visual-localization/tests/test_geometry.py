"""Regression tests for complete object bounds and exact inverse transforms.

Author: Olshansky Grigory.
"""

import pytest
from PIL import Image

from visual_localizer.geometry import overlap, prepare, suppress_duplicates


def test_letterbox_preserves_source_center_and_full_extent():
    """A wide source is padded vertically without shifting the detected object."""
    tensor, transform = prepare(Image.new("RGB", (400, 200)), 640, 640)
    assert tensor.shape == (1, 3, 640, 640)
    assert tensor.flags.c_contiguous
    assert transform.region([160, 240, 480, 400]) == {"x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5}
    assert transform.region([0, 160, 640, 480]) == {"x": 0, "y": 0, "width": 1, "height": 1}


def test_odd_resize_uses_actual_rounded_horizontal_and_vertical_scales():
    """Portrait padding and rounded resize sizes cannot displace the object center."""
    _, transform = prepare(Image.new("RGB", (1295, 1514)), 640, 640)
    bounds = [transform.left, 320, transform.left + transform.resized_width, 640]
    assert transform.region(bounds) == {"x": 0, "y": 0.5, "width": 1, "height": 0.5}
    assert transform.region([-20, -20, 700, 700]) == {"x": 0, "y": 0, "width": 1, "height": 1}
    assert transform.region([0, 0, 0, 0]) is None


def test_duplicate_predictions_do_not_hide_distinct_objects():
    """Duplicate cats collapse while separate cats and overlapping other classes remain."""
    first = {"region": {"x": 0.1, "y": 0.2, "width": 0.2, "height": 0.3}, "classId": 15, "confidence": 0.9}
    duplicate = {**first, "confidence": 0.7}
    second = {**first, "region": {**first["region"], "x": 0.6}, "confidence": 0.8}
    other_class = {**first, "classId": 16, "confidence": 0.6}
    assert overlap(first["region"], duplicate["region"]) == pytest.approx(1)
    assert suppress_duplicates([duplicate, second, other_class, first], 0.5) == [first, second, other_class]
