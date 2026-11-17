import copy
import json
import math

import httpx
import pytest
from PIL import Image

from auto_orient.geometry import HeadEvidence, choose_rotation, head_evidence
from auto_orient.images import jpeg, pixel_digest, preview, rotate
from auto_orient.vision import FIELDS, SceneVerifier, permits_rotation, validate


def detection(points=None, score=0.95):
    return {
        "facial-recognition": {
            "boxes": [[10, 10, 90, 95]],
            "scores": [score],
            "landmarks": [points or [[30, 30], [70, 30], [50, 50], [35, 70], [65, 70]]],
        }
    }


def observation():
    return {
        "medium": "photograph",
        "posture": "upright",
        "intentional_cues": "absent",
        "framing": "direct_scene",
        "body_visibility": "head_and_shoulders",
        "reason": "Heads and shoulders agree without using a horizon",
    }


def assessment():
    return {"original": observation(), "corrected": observation()}


@pytest.mark.parametrize("angle", [0, 90, 180, 270])
def test_selects_the_only_anatomically_upright_quadrant_without_a_horizon(angle):
    output = detection()
    rotated = []
    for candidate in [0, 90, 180, 270]:
        raw = copy.deepcopy(output)
        radians = math.radians(candidate - angle)
        raw["facial-recognition"]["landmarks"] = [
            [
                [
                    50 + (x - 50) * math.cos(radians) - (y - 50) * math.sin(radians),
                    50 + (x - 50) * math.sin(radians) + (y - 50) * math.cos(radians),
                ]
                for x, y in output["facial-recognition"]["landmarks"][0]
            ]
        ]
        rotated.append(head_evidence(candidate, raw, 100, 100))
    assert choose_rotation(rotated)[0] == angle


def test_conflicting_people_are_preserved_even_if_one_face_is_larger():
    rows = [
        HeadEvidence(angle, int(angle in (90, 180)), float(angle == 90) * 10 + int(angle == 180), 0.5)
        for angle in (0, 90, 180, 270)
    ]
    assert choose_rotation(rows) == (None, "conflicting_head_directions")


def test_sky_alone_and_absent_heads_do_not_create_an_orientation():
    assert choose_rotation([HeadEvidence(a, 0, 0, 0) for a in (0, 90, 180, 270)])[0] is None


@pytest.mark.parametrize(
    "points",
    [
        [[30, 30], [70, 30], [50, 20], [35, 70], [65, 70]],
        [[30, 30], [70, 55], [50, 60], [35, 70], [65, 70]],
        [[30, 70], [70, 70], [50, 50], [35, 30], [65, 30]],
    ],
)
def test_implausible_or_tilted_landmarks_do_not_vote(points):
    assert head_evidence(0, detection(points), 100, 100).faces == 0


def test_non_finite_coordinates_and_incomplete_quadrants_are_rejected():
    with pytest.raises(ValueError):
        head_evidence(0, detection(score=float("nan")), 100, 100)
    with pytest.raises(ValueError):
        choose_rotation([HeadEvidence(0, 1, 1, 1)])


@pytest.mark.parametrize(
    "field,value",
    [
        ("posture", "lying_or_leaning"),
        ("posture", "inverted_activity"),
        ("posture", "mixed"),
        ("medium", "artwork"),
        ("medium", "screen_or_collage"),
        ("intentional_cues", "present"),
        ("intentional_cues", "uncertain"),
        ("framing", "picture_within_picture"),
        ("body_visibility", "head_only"),
        ("body_visibility", "uncertain"),
    ],
)
@pytest.mark.parametrize("side", ["original", "corrected"])
def test_semantic_veto_preserves_artistic_physical_and_ambiguous_orientations(field, value, side):
    data = assessment()
    data[side][field] = value
    validate(data[side])
    assert not permits_rotation(data, 90)


@pytest.mark.parametrize("angle", [90, 180, 270])
def test_scene_veto_does_not_reestimate_the_geometric_quarter_turn(angle):
    assert permits_rotation(assessment(), angle)
    assert not permits_rotation(assessment(), 0)


def test_uncertain_initial_pose_needs_a_clear_corrected_pose_but_not_a_horizon():
    value = assessment()
    value["original"]["posture"] = "uncertain"
    assert permits_rotation(value, 90)
    value["corrected"]["posture"] = "uncertain"
    assert not permits_rotation(value, 90)


@pytest.mark.parametrize("field", list(FIELDS))
def test_incomplete_observations_are_not_implicitly_approved(field):
    data = observation()
    del data[field]
    with pytest.raises(ValueError):
        validate(data)


def test_quarter_turns_preserve_pixels_and_respect_existing_exif():
    image = Image.new("RGB", (90, 60))
    image.putpixel((3, 4), (255, 0, 0))
    assert pixel_digest(image) == pixel_digest(rotate(rotate(image, 90), 270))
    assert rotate(image, 90).size == (60, 90)
    image.getexif()[274] = 6
    from io import BytesIO

    output = BytesIO()
    image.save(output, "JPEG", exif=image.getexif())
    assert preview(output.getvalue()).size == (60, 90)
    assert preview(jpeg(Image.new("RGB", (2000, 1000)))).size == (1024, 512)


@pytest.mark.parametrize("finish_reason", ["length", "tool_calls", "content_filter"])
def test_incomplete_inference_is_never_interpreted_as_an_approval(finish_reason):
    def respond(request):
        body = json.loads(request.content)
        assert "max_tokens" not in body and "max_completion_tokens" not in body
        return httpx.Response(
            200, json={"choices": [{"finish_reason": finish_reason, "message": {"content": json.dumps(observation())}}]}
        )

    with httpx.Client(base_url="http://vision/v1/", transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(ValueError, match="Incomplete"):
            SceneVerifier(client, "local-vision").assess(Image.new("RGB", (20, 30)), Image.new("RGB", (30, 20)))


def test_original_composition_is_checked_before_a_candidate_can_bias_the_model():
    requests = []

    def respond(request):
        body = json.loads(request.content)
        images = [x for x in body["messages"][1]["content"] if x["type"] == "image_url"]
        assert len(images) == 1
        requests.append(body)
        value = observation()
        value["framing"] = "picture_within_picture"
        return httpx.Response(
            200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(value)}}]}
        )

    with httpx.Client(base_url="http://vision/v1/", transport=httpx.MockTransport(respond)) as client:
        result = SceneVerifier(client, "local-vision").assess(Image.new("RGB", (20, 30)), Image.new("RGB", (30, 20)))
    assert result["corrected"] is None
    assert not permits_rotation(result, 90)
    assert len(requests) == 1
