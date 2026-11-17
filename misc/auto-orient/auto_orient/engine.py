import hashlib
from dataclasses import dataclass
from typing import Any

import httpx

from .api import Immich
from .detector import HeadDetector
from .images import pixel_digest, preview, rotate
from .state import State
from .vision import PROMPT, SceneVerifier, permits_rotation


def exclusion(asset: dict[str, Any], edits: list[dict[str, Any]]) -> str | None:
    if asset.get("isTrashed") or asset.get("visibility") == "locked" or asset.get("isOffline"):
        return "unavailable_asset"
    if asset["type"] != "IMAGE":
        return "not_a_photograph"
    if asset.get("isEdited") or edits:
        return "existing_manual_edit"
    if asset.get("livePhotoVideoId"):
        return "live_photo_editor_unsupported"
    if asset["originalFileName"].lower().endswith((".gif", ".svg")):
        return "animated_or_vector_image"
    if (asset.get("exifInfo") or {}).get("projectionType"):
        return "panorama_editor_unsupported"
    tags = {x.get("value", "").casefold() for x in (asset.get("tags") or [])}
    if tags.intersection({"orientation:keep", "orientation/keep", "artistic-orientation"}):
        return "owner_preserves_orientation"
    return None


def same_rotation(edits: list[dict[str, Any]], angle: int) -> bool:
    return len(edits) == 1 and edits[0]["action"] == "rotate" and edits[0]["parameters"] == {"angle": angle}


@dataclass
class Engine:
    api: Immich
    state: State
    detector: HeadDetector | None = None
    verifier: SceneVerifier | None = None

    def inspect(self, identity: str) -> dict[str, Any]:
        asset = self.api.asset(identity)
        record: dict[str, Any] = {"id": identity, "ownerId": asset["ownerId"], "checksum": asset["checksum"]}
        if reason := exclusion(asset, self.api.edits(identity)):
            record["reason"] = reason
            self.state.save(record, "preserved")
            return record
        if self.detector is None or self.verifier is None:
            raise ValueError("Analysis requires the face detector and scene verifier")
        image = preview(self.api.preview(identity))
        angle, reason, heads = self.detector.propose(image)
        record.update(clockwise=angle, reason=reason, heads=heads, previewSha256=pixel_digest(image))
        if angle is None or angle == 0:
            self.state.save(record, "upright" if angle == 0 else "uncertain")
            return record
        assessment = self.verifier.assess(image, rotate(image, angle))
        record.update(
            assessment=assessment, model=self.verifier.model, promptSha256=hashlib.sha256(PROMPT.encode()).hexdigest()
        )
        self.state.save(record, "proposed" if permits_rotation(assessment, angle) else "preserved")
        return record

    def apply(self, value: dict[str, Any], phase: str) -> str:
        identity, angle = value["id"], value["clockwise"]
        asset, edits = self.api.asset(identity), self.api.edits(identity)
        if asset["checksum"] != value["checksum"]:
            self.state.save(value, "source_changed")
            return "source_changed"
        if phase != "proposed":
            if phase == "write_requested":
                phase = "accepted_unattributed" if same_rotation(edits, angle) else "needs_reconciliation"
                self.state.save(value, phase)
            return phase
        if value.get("promptSha256") != hashlib.sha256(PROMPT.encode()).hexdigest() or not permits_rotation(
            value["assessment"], angle
        ):
            self.state.save(value, "policy_changed")
            return "policy_changed"
        if reason := exclusion(asset, edits):
            value["reason"] = reason
            self.state.save(value, "preserved")
            return "preserved"
        current_preview = preview(self.api.preview(identity))
        if pixel_digest(current_preview) != value["previewSha256"]:
            self.state.save(value, "preview_changed")
            return "preview_changed"
        self.state.save(value, "write_requested")
        try:
            saved = self.api.rotate(identity, value["checksum"], angle)
        except httpx.HTTPStatusError as error:
            if error.response.status_code == 412:
                value["reason"] = "concurrent_source_or_manual_edit"
                self.state.save(value, "preserved")
                return "preserved"
            raise
        if not same_rotation(saved, angle):
            raise ValueError("The accepted edit differs from the source-bound proposal")
        value["acceptedEdits"] = saved
        self.state.save(value, "accepted")
        return "accepted"

    def process(self, identity: str, apply: bool) -> str:
        saved = self.state.get(identity)
        if not saved:
            self.inspect(identity)
            saved = self.state.get(identity)
        if saved is None:
            raise RuntimeError("Missing orientation receipt")
        value, phase = saved
        if apply and phase in ("proposed", "write_requested"):
            return self.apply(value, phase)
        return phase
