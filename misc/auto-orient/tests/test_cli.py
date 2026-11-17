from unittest.mock import Mock

import pytest

from auto_orient import cli
from auto_orient.errors import InferenceError


def test_a_broken_inference_contract_does_not_repeat_the_same_request_across_the_library(monkeypatch, tmp_path, capsys):
    for name, value in {
        "IMMICH_URL": "http://immich",
        "IMMICH_API_KEY": "private-test-key",
        "IMMICH_MACHINE_LEARNING_URL": "http://ml",
        "ORIENTATION_VISION_URL": "http://vision/v1",
        "ORIENTATION_VISION_MODEL": "test-model",
    }.items():
        monkeypatch.setenv(name, value)
    api = Mock(owner_id="owner")
    api.assets.return_value = iter([{"id": "first"}, {"id": "second"}])
    engine = Mock()
    engine.process.side_effect = InferenceError("Provider did not satisfy the image assessment schema")

    class Client:
        base_url = "http://immich/api/"

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(cli.httpx, "Client", lambda **kwargs: Client())
    monkeypatch.setattr(cli, "Immich", lambda client: api)
    monkeypatch.setattr(cli, "Engine", lambda *args: engine)
    monkeypatch.setattr("sys.argv", ["immich-auto-orient", "run", "--all", "--state", str(tmp_path)])
    with pytest.raises(SystemExit) as error:
        cli.main()
    assert error.value.code == 1
    engine.process.assert_called_once_with("first", apply=True)
    assert "Provider did not satisfy" in capsys.readouterr().err
