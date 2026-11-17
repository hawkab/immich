import math
from dataclasses import dataclass
from typing import Any

QUARTER_TURNS = (0, 90, 180, 270)


@dataclass(frozen=True)
class HeadEvidence:
    clockwise: int
    faces: int
    weight: float
    largest_face_fraction: float


def head_evidence(clockwise: int, output: dict[str, Any], width: int, height: int) -> HeadEvidence:
    detection = output["facial-recognition"]
    boxes, scores, landmarks = (detection[k] for k in ("boxes", "scores", "landmarks"))
    if not (len(boxes) == len(scores) == len(landmarks)) or width <= 0 or height <= 0:
        raise ValueError("Invalid face detector dimensions")
    weights, fractions = [], []
    for box, score, points in zip(boxes, scores, landmarks, strict=True):
        if len(box) != 4 or len(points) != 5 or any(len(p) != 2 for p in points):
            raise ValueError("Five facial landmarks are required")
        values = [*box, score, *(coordinate for point in points for coordinate in point)]
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in values):
            raise ValueError("Non-finite face detector output")
        if not 0.7 <= score <= 1:
            continue
        eyes = tuple((points[0][i] + points[1][i]) / 2 for i in range(2))
        mouth = tuple((points[3][i] + points[4][i]) / 2 for i in range(2))
        dx, dy = mouth[0] - eyes[0], mouth[1] - eyes[1]
        roll = abs(math.degrees(math.atan2(dx, dy)))
        eye_roll = abs(math.degrees(math.atan2(points[1][1] - points[0][1], points[1][0] - points[0][0])))
        eye_roll = min(eye_roll, abs(180 - eye_roll))
        area = max(0, min(width, box[2]) - max(0, box[0])) * max(0, min(height, box[3]) - max(0, box[1]))
        fraction = area / (width * height)
        if dy <= 0 or roll > 20 or eye_roll > 20 or fraction <= 0:
            continue
        if not eyes[1] < points[2][1] < mouth[1]:
            continue
        weights.append(score * math.sqrt(fraction) * math.cos(math.radians(roll)))
        fractions.append(fraction)
    return HeadEvidence(clockwise, len(weights), sum(weights), max(fractions, default=0))


def choose_rotation(evidence: list[HeadEvidence]) -> tuple[int | None, str]:
    if {x.clockwise for x in evidence} != set(QUARTER_TURNS) or len(evidence) != 4:
        raise ValueError("Every quadrant must be evaluated exactly once")
    ranked = sorted(evidence, key=lambda x: x.weight, reverse=True)
    best, runner_up = ranked[:2]
    if best.faces == 0:
        return None, "no_reliable_heads"
    if runner_up.weight > 0:
        return None, "conflicting_head_directions"
    return best.clockwise, "upright" if best.clockwise == 0 else "head_direction_candidate"
