import json
from contextlib import nullcontext

import httpx
import pytest

from auto_orient import cli


@pytest.mark.parametrize("expected", ["owner", "another-owner"])
def test_file_credentials_create_and_revoke_only_the_private_session(monkeypatch, tmp_path, capsys, expected):
    credential = tmp_path / "login.json"
    credential.write_text(json.dumps({"email": "owner@example.test", "password": "sample-password"}))
    monkeypatch.setenv("IMMICH_URL", "http://immich")
    monkeypatch.setenv("IMMICH_CREDENTIAL_FILE", str(credential))
    monkeypatch.setenv("IMMICH_EXPECTED_OWNER_ID", expected)
    monkeypatch.delenv("IMMICH_API_KEY", raising=False)
    monkeypatch.setattr("sys.argv", ["immich-auto-orient", "report", "--state", str(tmp_path / "state")])
    seen = []
    original_client = httpx.Client

    def reply(request):
        seen.append(request.url.path)
        if request.url.path.endswith("/auth/login"):
            assert json.loads(request.content)["password"] == "sample-password"
            return httpx.Response(200, json={"accessToken": "private-session-token"})
        assert request.headers["Authorization"] == "Bearer private-session-token"
        return httpx.Response(200, json={"id": "owner"} if request.url.path.endswith("/users/me") else {})

    monkeypatch.setattr(
        cli.httpx, "Client", lambda **kwargs: original_client(transport=httpx.MockTransport(reply), **kwargs)
    )
    expectation = pytest.raises(PermissionError) if expected != "owner" else nullcontext()
    with expectation:
        cli.main()
    assert seen == ["/api/auth/login", "/api/users/me", "/api/auth/logout"]
    output = capsys.readouterr()
    assert "sample-password" not in output.out + output.err
    assert "private-session-token" not in output.out + output.err
