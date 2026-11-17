import json
from dataclasses import asdict
from typing import Any

import httpx
from PIL import Image

from .errors import InferenceError
from .geometry import QUARTER_TURNS, choose_rotation, head_evidence
from .images import jpeg, rotate


class HeadDetector:
    def __init__(self, client: httpx.Client, model: str):
        self.client, self.model = client, model

    def predict(self, image: Image.Image) -> dict[str, Any]:
        response = self.client.post(
            "predict",
            data={
                "entries": json.dumps(
                    {
                        "facial-recognition": {"detection": {"modelName": self.model, "options": {"minScore": 0.7}}},
                    }
                )
            },
            files={"image": ("orientation-preview.jpg", jpeg(image), "image/jpeg")},
        )
        response.raise_for_status()
        result: dict[str, Any] = response.json()
        return result

    def propose(self, image: Image.Image) -> tuple[int | None, str, list[dict[str, Any]]]:
        evidence = []
        for angle in QUARTER_TURNS:
            candidate = rotate(image, angle)
            try:
                evidence.append(head_evidence(angle, self.predict(candidate), candidate.width, candidate.height))
            except (KeyError, TypeError, ValueError) as error:
                raise InferenceError(f"Face inference contract failed: {error}") from error
            if angle == 0 and evidence[-1].faces:
                return 0, "upright_head_present", [asdict(evidence[-1])]
        chosen, reason = choose_rotation(evidence)
        return chosen, reason, [asdict(x) for x in evidence]
