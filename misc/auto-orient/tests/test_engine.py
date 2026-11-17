import copy
from unittest.mock import Mock

import httpx
import pytest
from PIL import Image
from test_orientation import assessment

from auto_orient.engine import Engine, exclusion
from auto_orient.images import jpeg
from auto_orient.state import State


@pytest.fixture
def setup(tmp_path):
    api = Mock(owner_id="owner")
    asset = {
        "id": "photo",
        "type": "IMAGE",
        "ownerId": "owner",
        "checksum": "source",
        "originalFileName": "photo.jpg",
        "isEdited": False,
    }
    edits = []
    api.asset.side_effect = lambda _: copy.deepcopy(asset)
    api.edits.side_effect = lambda _: copy.deepcopy(edits)
    api.preview.return_value = jpeg(Image.new("RGB", (100, 60)))

    def save(identity, checksum, angle):
        edits[:] = [{"id": "edit-receipt", "action": "rotate", "parameters": {"angle": angle}}]
        asset["isEdited"] = True
        return copy.deepcopy(edits)

    api.rotate.side_effect = save
    state = State(tmp_path / "state", "server", "owner")
    detector = Mock()
    detector.propose.return_value = (90, "head_direction_candidate", [{"faces": 1}])
    verifier = Mock(model="local-vision")
    verifier.assess.return_value = assessment()
    yield Engine(api, state, detector, verifier), api, asset, edits
    state.close()


def test_scan_only_saves_a_source_bound_proposal_and_apply_needs_no_model(setup):
    engine, api, _, _ = setup
    assert engine.process("photo", False) == "proposed"
    api.rotate.assert_not_called()
    engine.detector = engine.verifier = None
    assert engine.process("photo", True) == "accepted"
    assert engine.process("photo", True) == "accepted"
    api.rotate.assert_called_once_with("photo", "source", 90)
    assert engine.state.get("photo")[0]["acceptedEdits"][0]["id"] == "edit-receipt"


def test_a_lost_accepted_response_is_read_back_without_a_second_rotation(setup):
    engine, api, _, edits = setup

    def lost(*_):
        edits[:] = [{"id": "unknown-origin", "action": "rotate", "parameters": {"angle": 90}}]
        raise httpx.ReadError("Response lost after commit")

    api.rotate.side_effect = lost
    with pytest.raises(httpx.ReadError):
        engine.process("photo", True)
    assert engine.process("photo", True) == "accepted_unattributed"
    assert engine.process("photo", True) == "accepted_unattributed"
    api.rotate.assert_called_once()
    assert "acceptedEdits" not in engine.state.get("photo")[0]


def test_unknown_outcome_with_no_edit_is_not_blindly_repeated(setup):
    engine, api, _, _ = setup
    api.rotate.side_effect = httpx.ReadError("Outcome unknown")
    with pytest.raises(httpx.ReadError):
        engine.process("photo", True)
    assert engine.process("photo", True) == "needs_reconciliation"
    api.rotate.assert_called_once()


def test_explicit_revert_is_not_undone_by_another_automatic_run(setup):
    engine, api, asset, edits = setup
    engine.process("photo", True)
    edits.clear()
    asset["isEdited"] = False
    engine.process("photo", True)
    api.rotate.assert_called_once()


@pytest.mark.parametrize("change", ["checksum", "manual_edit", "preview"])
def test_changed_source_manual_edit_or_preview_invalidates_the_frozen_proposal(setup, change):
    engine, api, asset, edits = setup
    engine.process("photo", False)
    if change == "checksum":
        asset["checksum"] = "replacement"
    elif change == "manual_edit":
        edits.append({"action": "rotate", "parameters": {"angle": 180}})
    else:
        api.preview.return_value = jpeg(Image.new("RGB", (100, 60), "red"))
    engine.process("photo", True)
    api.rotate.assert_not_called()


def test_server_precondition_failure_preserves_the_concurrent_manual_edit(setup):
    engine, api, _, _ = setup
    response = httpx.Response(412, request=httpx.Request("PUT", "http://immich/api/assets/photo/edits"))
    api.rotate.side_effect = httpx.HTTPStatusError(
        "Changed during inference", request=response.request, response=response
    )
    assert engine.process("photo", True) == "preserved"
    assert engine.process("photo", True) == "preserved"
    api.rotate.assert_called_once()


def test_proposals_from_an_old_policy_are_not_applied_under_a_new_policy(setup):
    engine, api, _, _ = setup
    engine.process("photo", False)
    value, phase = engine.state.get("photo")
    value["promptSha256"] = "superseded-policy"
    engine.state.save(value, phase)
    assert engine.process("photo", True) == "policy_changed"
    api.rotate.assert_not_called()


@pytest.mark.parametrize(
    "key,value,reason",
    [
        ("isEdited", True, "existing_manual_edit"),
        ("livePhotoVideoId", "motion", "live_photo_editor_unsupported"),
        ("tags", [{"value": "orientation:keep"}], "owner_preserves_orientation"),
        ("type", "VIDEO", "not_a_photograph"),
        ("visibility", "locked", "unavailable_asset"),
    ],
)
def test_exclusions_do_not_run_models_or_edit_files(setup, key, value, reason):
    engine, api, asset, _ = setup
    asset[key] = value
    assert exclusion(asset, []) == reason
    assert engine.process("photo", True) == "preserved"
    engine.detector.propose.assert_not_called()
    api.rotate.assert_not_called()


def test_receipts_are_durable_and_bound_to_exactly_one_server_and_owner(tmp_path):
    state = State(tmp_path, "server", "owner")
    state.save({"id": "asset", "checksum": "source"}, "proposed")
    state.close()
    resumed = State(tmp_path, "server", "owner")
    assert resumed.get("asset")[1] == "proposed"
    resumed.close()
    with pytest.raises(ValueError, match="separate state directory"):
        State(tmp_path, "other-server", "owner")
