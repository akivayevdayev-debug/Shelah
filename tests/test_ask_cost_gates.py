"""Cost gates + spend attribution (backend/cost_gates.py), the sync-side
helpers the Flask conversation ask uses.

cost_meter's two async gates are replaced by spies on backend.cost_gates,
so no test reaches the real Supabase budget RPC / usage read -- but every
test still goes through the real loop-bridge hop (submit_with_context +
asyncio.run on claude's bridge executor). The model call is replaced by a
spy that records the attribution contextvars as seen from inside the
synthesis worker thread, which is exactly where record_llm_call() reads
them.
"""
from __future__ import annotations


import pytest

import app as flask_app_module
import backend.ask_pipeline as ask_pipeline_module
import backend.claude as claude_module
from backend import cost_gates
from backend import logging_setup
from backend.ip_hash import keyed_hash

CLIENT_IP = "203.0.113.7"
USER_ID = "user_cost_gates_test"


class _GateSpy:
    def __init__(self):
        self.tripped = False
        self.allowed = True
        self.reservation_id = "res-flask-ask"
        self.breaker_calls = 0
        self.budget_calls = []

    async def breaker(self):
        self.breaker_calls += 1
        return {"tripped": self.tripped, "total_usd": 12.5, "threshold_usd": 10.0, "configured": True}

    async def budget(self, user_id, client_ip=""):
        self.budget_calls.append((user_id, client_ip))
        if self.allowed and self.reservation_id:
            logging_setup.bind_budget_reservation(self.reservation_id)
        return {"allowed": self.allowed, "total_usd": 1.9876, "threshold_usd": 2.0}


@pytest.fixture
def gates(monkeypatch):
    spy = _GateSpy()
    monkeypatch.setattr(cost_gates, "is_global_cost_breaker_tripped", spy.breaker)
    monkeypatch.setattr(cost_gates, "check_user_budget_and_enforce", spy.budget)
    return spy


@pytest.fixture
def model_calls(monkeypatch):
    """Replace both model entry points (which one runs depends on
    AI_AGENTIC_TOOLS) with a spy that records the attribution context the
    model call sees, then fails -- so the route takes its no-model
    source-discovery fallback and the test needs no real answer shape."""
    seen = []

    def _record():
        seen.append({
            "user_id": logging_setup.get_user_id(),
            "client_key": logging_setup.get_client_key(),
            "reservation_id": logging_setup.get_budget_reservation(),
        })
        raise RuntimeError("model call stubbed out")

    async def _record_async(*args, **kwargs):
        _record()

    monkeypatch.setattr(claude_module, "ask_claude", lambda *a, **k: _record())
    monkeypatch.setattr(ask_pipeline_module, "run_agentic_ask", _record_async)
    return seen


@pytest.fixture
def caller(monkeypatch):
    """Resolved caller identity for the route: signed out unless a test
    sets caller["user_id"]."""
    state = {"user_id": None}
    monkeypatch.setattr(flask_app_module, "_get_request_user_id", lambda: state["user_id"])
    monkeypatch.setattr(flask_app_module, "_extract_client_ip", lambda: CLIENT_IP)
    flask_app_module.ASK_RESPONSE_CACHE.clear()
    yield state
    flask_app_module.ASK_RESPONSE_CACHE.clear()
    cost_gates.clear_cost_attribution()


def _ask(test_client, question="What is the law of muktzeh? [cost-gates test]"):
    return test_client.post("/ask", json={"question": question})


# ─── Flask /ask route ────────────────────────────────────────────────────────


def test_attribution_is_cleared_once_the_request_ends(test_client, gates, model_calls, caller):
    caller["user_id"] = USER_ID

    _ask(test_client)

    # Flask's test client runs the view on this thread, so a leftover
    # binding would be visible here -- as it would be to the next request
    # on a reused dev-server worker thread.
    assert logging_setup.get_user_id() == ""
    assert logging_setup.get_client_key() == ""
    assert logging_setup.get_budget_reservation() == ""



# ─── backend/cost_gates.py ───────────────────────────────────────────────────

@pytest.mark.parametrize(
    ("user_id", "client_ip", "expected"),
    [
        (USER_ID, CLIENT_IP, ""),
        (None, CLIENT_IP, f"ip:{keyed_hash(CLIENT_IP)}"),
        ("", "", ""),
    ],
    ids=["signed-in", "signed-out", "signed-out-no-ip"],
)
def test_client_key_for(user_id, client_ip, expected):
    assert cost_gates.client_key_for(user_id, client_ip) == expected


def test_evaluate_cost_gates_sync_does_not_leak_a_stale_reservation(gates):
    """With the per-user cap disabled the budget gate binds nothing, so the
    result must not echo a reservation id left over in the caller's context."""
    gates.reservation_id = ""
    logging_setup.bind_budget_reservation("stale-res")
    try:
        result = cost_gates.evaluate_cost_gates_sync(USER_ID, CLIENT_IP)
    finally:
        logging_setup.bind_budget_reservation("")

    assert result["reservation_id"] == ""
    assert result["tripped"] is False


def test_bind_then_clear_cost_attribution():
    cost_gates.bind_cost_attribution(None, CLIENT_IP, "res-1")
    assert (
        logging_setup.get_user_id(), logging_setup.get_client_key(), logging_setup.get_budget_reservation()
    ) == ("", f"ip:{keyed_hash(CLIENT_IP)}", "res-1")

    cost_gates.clear_cost_attribution()
    assert (
        logging_setup.get_user_id(), logging_setup.get_client_key(), logging_setup.get_budget_reservation()
    ) == ("", "", "")
