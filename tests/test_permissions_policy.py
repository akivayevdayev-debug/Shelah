"""Permissions-Policy: the site may use its own microphone (dictation), nothing else."""

from backend.helpers import SECURITY_RESPONSE_HEADERS


def _policy():
    return dict(
        part.strip().split("=", 1)
        for part in SECURITY_RESPONSE_HEADERS["Permissions-Policy"].split(",")
    )


def test_microphone_allowed_for_own_origin_only():
    # microphone=() blocks the page itself, so the browser never even prompts
    # for the composer's dictation button.
    assert _policy()["microphone"] == "(self)"


def test_other_powerful_features_stay_blocked():
    policy = _policy()
    for feature in ("geolocation", "camera", "payment", "usb"):
        assert policy[feature] == "()", feature


def test_flask_sends_it(test_client):
    response = test_client.get("/privacy")
    assert "microphone=(self)" in response.headers["Permissions-Policy"]


async def test_asgi_sends_it(fastapi_client):
    response = await fastapi_client.get("/api/health")
    assert "microphone=(self)" in response.headers["Permissions-Policy"]
