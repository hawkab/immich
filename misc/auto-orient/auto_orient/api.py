from collections.abc import Iterator
from typing import Any

import httpx


class Immich:
    def __init__(self, client: httpx.Client):
        self.client = client
        self.owner_id = self.call("GET", "users/me")["id"]

    def call(self, method: str, path: str, value: Any = None) -> Any:
        response = self.client.request(method, path, json=value)
        response.raise_for_status()
        return response.json() if response.content else None

    def require_conditional_edits(self) -> None:
        spec = self.call("GET", "spec.json")
        properties = spec.get("components", {}).get("schemas", {}).get("AssetEditsCreateDto", {}).get("properties", {})
        if "ifUneditedChecksum" not in properties:
            raise ValueError("Install the conditional-edit server from this feature branch before applying rotations")

    def assets(self) -> Iterator[dict[str, Any]]:
        page = 1
        seen = set()
        while True:
            result = self.call("POST", "search/metadata", {"page": page, "size": 250, "withStacked": True})["assets"]
            identities = tuple(x["id"] for x in result["items"])
            if identities in seen or (not identities and result.get("nextPage")):
                raise ValueError("Asset pagination repeated without progress")
            seen.add(identities)
            for asset in result["items"]:
                if asset["ownerId"] == self.owner_id:
                    yield asset
            if not result.get("nextPage"):
                break
            page = int(result["nextPage"])

    def asset(self, identity: str) -> dict[str, Any]:
        asset: dict[str, Any] = self.call("GET", f"assets/{identity}")
        if asset["ownerId"] != self.owner_id:
            raise PermissionError("Only the authenticated owner's photographs can be rotated")
        return asset

    def edits(self, identity: str) -> list[dict[str, Any]]:
        edits: list[dict[str, Any]] = self.call("GET", f"assets/{identity}/edits")["edits"]
        return edits

    def preview(self, identity: str) -> bytes:
        response = self.client.get(f"assets/{identity}/thumbnail", params={"size": "preview"})
        response.raise_for_status()
        return response.content

    def rotate(self, identity: str, checksum: str, clockwise: int) -> list[dict[str, Any]]:
        result = self.call(
            "PUT",
            f"assets/{identity}/edits",
            {
                "ifUneditedChecksum": checksum,
                "edits": [{"action": "rotate", "parameters": {"angle": clockwise}}],
            },
        )
        edits: list[dict[str, Any]] = result["edits"]
        return edits
