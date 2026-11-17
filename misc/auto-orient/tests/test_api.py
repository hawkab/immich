import json

import httpx
import pytest

from auto_orient.api import Immich


def test_legacy_server_is_rejected_before_conditional_writes():
    def handler(request):
        assert request.method == "GET"
        return httpx.Response(200, json={"id": "owner"} if request.url.path.endswith("/me") else {})

    with httpx.Client(base_url="http://immich/api/", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError, match="conditional-edit server"):
            Immich(client).require_conditional_edits()


def test_partner_read_access_does_not_authorise_automatic_edits():
    def handler(request):
        return httpx.Response(200, json={"id": "owner"} if request.url.path.endswith("/me") else {"ownerId": "partner"})

    with httpx.Client(base_url="http://immich/api/", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(PermissionError):
            Immich(client).asset("shared-photo")


def test_conditional_edits_use_the_frozen_original_checksum():
    def handler(request):
        if request.method == "GET":
            return httpx.Response(200, json={"id": "owner"})
        assert json.loads(request.content) == {
            "ifUneditedChecksum": "source",
            "edits": [{"action": "rotate", "parameters": {"angle": 270}}],
        }
        return httpx.Response(200, json={"edits": [{"id": "accepted"}]})

    with httpx.Client(base_url="http://immich/api/", transport=httpx.MockTransport(handler)) as client:
        assert Immich(client).rotate("photo", "source", 270) == [{"id": "accepted"}]


def test_empty_page_cannot_create_an_endless_pagination_loop():
    def handler(request):
        if request.method == "GET":
            return httpx.Response(200, json={"id": "owner"})
        return httpx.Response(200, json={"assets": {"items": [], "nextPage": "2"}})

    with httpx.Client(base_url="http://immich/api/", transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError, match="without progress"):
            list(Immich(client).assets())
