"""A JSON request body that is not an object (an array, a string, a number)
must be handled like an empty body, not crash the route.

These routes used to read ``request.get_json(silent=True) or {}`` and call
``.get()`` on the result, so ``[1]`` raised AttributeError: a 500 and an
error-bot alert for the caller's own malformed request. Each now goes through
``backend.helpers._json_object_body``; the contract pinned here is that a
non-object body gets exactly the response an empty ``{}`` body gets.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from flask import Flask

import backend.auth as auth_module
import backend.routes_conversations as routes_conversations_module
from backend.helpers import _json_object_body

_HEADERS = {"Authorization": "Bearer faketoken.faketoken.faketoken", "Origin": "http://localhost"}

# (method, path) for every route that parses a JSON body through the helper.
_ROUTES = [
    ("post", "/ask"),
    ("post", "/set_location"),
    ("post", "/api/conversations"),
    ("post", "/api/conversations/c1/messages"),
    ("patch", "/api/conversations/c1"),
    ("post", "/api/conversations/c1/ask"),
    ("post", "/api/client-errors"),
    ("post", "/api/devtools/segment-report"),
    ("post", "/api/feedback"),
    ("post", "/api/export/chapter"),
    ("post", "/api/user/delete-account"),
    ("post", "/api/accept-legal"),
    ("put", "/api/user/preferences"),
    ("post", "/api/bookmarks/semantic"),
]


@pytest.mark.parametrize("body, expected", [
    ({"a": 1}, {"a": 1}),
    ({}, {}),
    ([1], {}),
    ([], {}),
    ("text", {}),
    (5, {}),
    (None, {}),
    (True, {}),
])
def test_helper_returns_only_object_bodies(body, expected):
    app = Flask(__name__)
    with app.test_request_context(json=body):
        assert _json_object_body() == expected


def test_helper_treats_unparsable_json_as_empty():
    app = Flask(__name__)
    with app.test_request_context(data="{not json", content_type="application/json"):
        assert _json_object_body() == {}


@pytest.fixture
def signed_in(monkeypatch):
    monkeypatch.setattr(
        auth_module, "_verify_clerk_token", lambda token: {"sub": "user_test_fake_123", "sid": "sess_fake"})
    client = MagicMock()
    client.table.return_value.insert.return_value.execute.return_value.data = [{"id": "c1"}]
    monkeypatch.setattr(routes_conversations_module, "_get_user_scoped_supabase_client", lambda: client)


@pytest.mark.parametrize("method, path", _ROUTES)
@pytest.mark.parametrize("bad_body", [[1], "text", 5], ids=["array", "string", "number"])
def test_non_object_body_is_answered_like_an_empty_body(test_client, signed_in, method, path, bad_body):
    send = getattr(test_client, method)
    empty = send(path, json={}, headers=_HEADERS)
    malformed = send(path, json=bad_body, headers=_HEADERS)

    assert malformed.status_code < 500
    assert malformed.status_code == empty.status_code
