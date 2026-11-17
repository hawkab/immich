from unittest.mock import Mock

from PIL import Image
from test_orientation import detection

from auto_orient.detector import HeadDetector


def test_already_upright_heads_need_only_one_detector_pass():
    detector = HeadDetector(Mock(), "buffalo_l")
    detector.predict = Mock(return_value=detection())
    angle, reason, evidence = detector.propose(Image.new("RGB", (100, 100)))
    assert angle == 0
    assert reason == "upright_head_present"
    assert len(evidence) == 1
    detector.predict.assert_called_once()


def test_rotated_candidates_still_require_every_quadrant():
    detector = HeadDetector(Mock(), "buffalo_l")
    empty = {"facial-recognition": {"boxes": [], "scores": [], "landmarks": []}}
    detector.predict = Mock(side_effect=[empty, empty, detection(), empty])
    angle, _, evidence = detector.propose(Image.new("RGB", (100, 100)))
    assert angle == 180
    assert len(evidence) == 4
    assert detector.predict.call_count == 4
