"""
A reader can change the rating or comment they left on an answer.

POST /api/feedback answers with the new row's id; PATCH /api/feedback/<id>
changes that row's verdict and comment, and only for whoever wrote it: the
same account (``user_id``) or, signed out, the same device (``device_owner``,
the hash of the ``shelah_device`` cookie, backend/device_identity.py). Anyone
else gets a 404, so the route never confirms another reader's row exists. The
server's own notes (source "ai") are never editable. Before
scripts/sql/migrate_answer_feedback_edit.sql runs, feedback is still saved,
just without the device column, and guests' rows can't be edited.
"""

import pytest

import backend.routes_feedback as feedback_module
from backend.device_identity import DEVICE_COOKIE, owner_for_token

ROW = "0b6a3f58-2f5e-4c1d-9a7e-3d2b1c0a9f88"
OTHER_ROW = "9f9f9f9f-2f5e-4c1d-9a7e-3d2b1c0a9f88"
AI_ROW = "1a1a1a1a-2f5e-4c1d-9a7e-3d2b1c0a9f88"
DEVICE = "d" * 32
OTHER_DEVICE = "e" * 32


class _APIError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters, self.op, self.payload = [], "select", None

    def select(self, *_):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def limit(self, *_):
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def _matches(self):
        return [r for r in self.db.rows if all(r.get(k) == v for k, v in self.filters)]

    def execute(self):
        if self.op == "insert":
            if self.db.device_column_missing and "device_owner" in self.payload:
                raise _APIError("PGRST204")
            row = {"id": f"new-{len(self.db.rows)}", **self.payload}
            self.db.rows.append(row)
            return _Result([row])
        if self.op == "update":
            self.db.updates.append((list(self.filters), dict(self.payload)))
            hit = self._matches()
            for row in hit:
                row.update(self.payload)
            return _Result(hit)
        return _Result(self._matches())


class _DB:
    def __init__(self):
        self.rows = [
            {"id": ROW, "user_id": "user_me", "device_owner": None, "verdict": "not_helpful", "comment": "", "source": "reader"},
            {"id": OTHER_ROW, "user_id": None, "device_owner": owner_for_token(OTHER_DEVICE), "verdict": "helpful", "comment": "", "source": "reader"},
            {"id": AI_ROW, "user_id": None, "device_owner": owner_for_token(DEVICE), "verdict": "ai_note", "comment": "x", "source": "ai"},
        ]
        self.updates = []
        self.device_column_missing = False

    def table(self, _name):
        return _Query(self, _name)


@pytest.fixture
def db(monkeypatch):
    database = _DB()
    monkeypatch.setattr(feedback_module, "_get_supabase_client", lambda: database)
    monkeypatch.setattr(feedback_module, "_get_request_user_id", lambda: None)
    return database


def _signed_in(monkeypatch, user_id):
    monkeypatch.setattr(feedback_module, "_get_request_user_id", lambda: user_id)


def _with_device(client, token):
    client.set_cookie(DEVICE_COOKIE, token, domain="localhost")


# --- POST: the id comes back, and a guest's row is tied to their device -----

def test_post_returns_the_new_row_id(test_client, db):
    response = test_client.post("/api/feedback", json={"question": "Q", "verdict": "not_helpful"})
    assert response.status_code == 200
    assert response.get_json()["id"] == db.rows[-1]["id"]


def test_a_guest_row_stores_the_device_hash_never_the_cookie(test_client, db):
    _with_device(test_client, DEVICE)
    test_client.post("/api/feedback", json={"question": "Q", "verdict": "helpful"})
    stored = db.rows[-1]
    assert stored["device_owner"] == owner_for_token(DEVICE)
    assert DEVICE not in repr(stored)


def test_a_signed_in_row_is_tied_to_the_account_not_the_device(test_client, db, monkeypatch):
    _signed_in(monkeypatch, "user_me")
    _with_device(test_client, DEVICE)
    test_client.post("/api/feedback", json={"question": "Q", "verdict": "helpful"})
    assert db.rows[-1]["user_id"] == "user_me"
    assert "device_owner" not in db.rows[-1]


def test_before_the_migration_a_guest_rating_is_still_saved(test_client, db):
    db.device_column_missing = True
    _with_device(test_client, DEVICE)
    response = test_client.post("/api/feedback", json={"question": "Q", "verdict": "helpful"})
    assert response.status_code == 200
    assert db.rows[-1]["verdict"] == "helpful"
    assert "device_owner" not in db.rows[-1]


# --- PATCH: owner-only edits ----------------------------------------------

def test_the_account_that_wrote_it_can_change_rating_and_comment(test_client, db, monkeypatch):
    _signed_in(monkeypatch, "user_me")
    response = test_client.patch(f"/api/feedback/{ROW}", json={"verdict": "helpful", "comment": "Actually clear"})
    assert response.status_code == 200
    row = next(r for r in db.rows if r["id"] == ROW)
    assert (row["verdict"], row["comment"]) == ("helpful", "Actually clear")
    # The update itself is scoped to the owner, not only the pre-check.
    filters, _ = db.updates[-1]
    assert ("id", ROW) in filters
    assert ("user_id", "user_me") in filters


def test_adding_a_comment_keeps_the_rating(test_client, db, monkeypatch):
    _signed_in(monkeypatch, "user_me")
    test_client.patch(f"/api/feedback/{ROW}", json={"verdict": "not_helpful", "comment": "Missed the source"})
    row = next(r for r in db.rows if r["id"] == ROW)
    assert row["verdict"] == "not_helpful"


def test_the_same_device_can_edit_a_guest_row(test_client, db):
    _with_device(test_client, OTHER_DEVICE)
    response = test_client.patch(f"/api/feedback/{OTHER_ROW}", json={"verdict": "not_helpful", "comment": ""})
    assert response.status_code == 200
    filters, _ = db.updates[-1]
    assert ("device_owner", owner_for_token(OTHER_DEVICE)) in filters


@pytest.mark.parametrize("who", ["other_account", "other_device", "nobody"])
def test_someone_else_cannot_edit_a_row_and_learns_nothing(test_client, db, monkeypatch, who):
    if who == "other_account":
        _signed_in(monkeypatch, "user_someone_else")
    elif who == "other_device":
        _with_device(test_client, DEVICE)
    for row_id in (ROW, OTHER_ROW):
        response = test_client.patch(f"/api/feedback/{row_id}", json={"verdict": "helpful", "comment": "hijack"})
        assert response.status_code == 404
    assert db.updates == []
    assert all(r["comment"] != "hijack" for r in db.rows)


def test_a_signed_in_reader_cannot_edit_a_guest_row_from_their_own_device(test_client, db, monkeypatch):
    # The account is who they are once signed in; another device's row stays out of reach.
    _signed_in(monkeypatch, "user_me")
    _with_device(test_client, DEVICE)
    response = test_client.patch(f"/api/feedback/{OTHER_ROW}", json={"verdict": "helpful", "comment": ""})
    assert response.status_code == 404


def test_the_servers_own_note_is_never_editable(test_client, db):
    _with_device(test_client, DEVICE)
    response = test_client.patch(f"/api/feedback/{AI_ROW}", json={"verdict": "helpful", "comment": "x"})
    assert response.status_code == 404
    assert db.updates == []


@pytest.mark.parametrize("body", [
    {"verdict": "ai_note", "comment": ""},
    {"verdict": "bogus", "comment": ""},
    {"verdict": "comment", "comment": ""},
])
def test_bad_edits_are_refused(test_client, db, monkeypatch, body):
    _signed_in(monkeypatch, "user_me")
    response = test_client.patch(f"/api/feedback/{ROW}", json=body)
    assert response.status_code == 400
    assert db.updates == []


def test_a_malformed_id_is_a_404_without_a_lookup(test_client, db, monkeypatch):
    _signed_in(monkeypatch, "user_me")
    response = test_client.patch("/api/feedback/not-a-uuid", json={"verdict": "helpful"})
    assert response.status_code == 404


def test_an_edited_comment_is_sanitised_and_capped(test_client, db, monkeypatch):
    _signed_in(monkeypatch, "user_me")
    test_client.patch(f"/api/feedback/{ROW}", json={"verdict": "not_helpful", "comment": "<b>bold</b>" + "x" * 900})
    row = next(r for r in db.rows if r["id"] == ROW)
    assert "<b>" not in row["comment"]
    assert len(row["comment"]) <= 500


def test_the_edit_route_shares_the_feedback_rate_limit_class():
    import backend.rate_limit as rate_limit_mod
    assert rate_limit_mod.classify_route(f"/api/feedback/{ROW}") == "feedback"
