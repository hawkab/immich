import argparse
import json
import os
import ssl
import sys
from contextlib import ExitStack
from pathlib import Path
from typing import Any

import httpx

from .api import Immich
from .detector import HeadDetector
from .engine import Engine
from .errors import InferenceError
from .state import State
from .vision import SceneVerifier


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"Set {name}; secrets belong in environment variables, not command arguments")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description="Correct head orientation using Immich's reversible editor")
    parser.add_argument("command", choices=("scan", "run", "apply", "report"))
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--all", action="store_true", help="Process every photograph owned by this API key's user")
    scope.add_argument("--asset-id", action="append", default=[], help="Process a specific asset; repeatable")
    parser.add_argument("--state", type=Path, required=True, help="Private receipts, bound to this server and owner")
    args = parser.parse_args()
    if args.command != "report" and not args.all and not args.asset_id:
        parser.error("Choose --all or --asset-id explicitly")
    context = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE"))
    with ExitStack() as stack:
        api_client = stack.enter_context(
            httpx.Client(
                base_url=required("IMMICH_URL").rstrip("/") + "/api/",
                headers={"x-api-key": required("IMMICH_API_KEY")},
                timeout=None,
                verify=context,
            )
        )
        api = Immich(api_client)
        state = State(args.state, str(api_client.base_url), api.owner_id)
        stack.callback(state.close)
        if args.command == "report":
            print(json.dumps(state.report()))
            return
        applying = args.command in ("run", "apply")
        if applying:
            api.require_conditional_edits()
        engine = Engine(api, state)
        if args.command in ("scan", "run"):
            ml = stack.enter_context(
                httpx.Client(
                    base_url=required("IMMICH_MACHINE_LEARNING_URL").rstrip("/") + "/", timeout=None, verify=context
                )
            )
            vision_headers = (
                {"Authorization": "Bearer " + os.environ["ORIENTATION_VISION_API_KEY"]}
                if os.environ.get("ORIENTATION_VISION_API_KEY")
                else {}
            )
            vision = stack.enter_context(
                httpx.Client(
                    base_url=required("ORIENTATION_VISION_URL").rstrip("/") + "/",
                    headers=vision_headers,
                    timeout=None,
                    verify=context,
                )
            )
            engine.detector = HeadDetector(ml, os.environ.get("IMMICH_FACE_MODEL", "buffalo_l"))
            engine.verifier = SceneVerifier(vision, required("ORIENTATION_VISION_MODEL"))
        identities = (x["id"] for x in api.assets()) if args.all else iter(args.asset_id)
        failures: list[dict[str, Any]] = []
        for identity in identities:
            try:
                if args.command == "apply" and not state.get(identity):
                    continue
                phase = engine.process(identity, apply=applying)
                print(json.dumps({"asset": identity, "phase": phase}), flush=True)
            except (httpx.HTTPError, ValueError, PermissionError) as error:
                failures.append({"asset": identity, "error": type(error).__name__, "message": str(error)})
                print(json.dumps(failures[-1]), file=sys.stderr, flush=True)
                inference_http_failure = isinstance(error, httpx.HTTPStatusError) and error.request.url.path.endswith(
                    ("/predict", "/chat/completions")
                )
                if isinstance(error, (httpx.TransportError, InferenceError)) or inference_http_failure:
                    break
        print(json.dumps({"phases": state.report(), "failures": failures}))
        if failures:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
