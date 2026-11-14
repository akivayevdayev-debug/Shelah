"""
Response-shape and safety invariants for POST /ask (asgi.py), plus the
places where the Flask conversation ask (backend/routes_conversations.py)
shares /ask's helpers and must not drift from it.

History: app.py once had its own copy of /ask, and this file pinned the two
copies to each other. That copy was deleted on 2026-11-14 (only asgi.py's
route was reachable in production), so the Flask halves of these tests went
with it. What is left:

  a) the top-level key set on every path    -> TestTopLevelKeySetEveryPath
     (strict-block and security-blocked; success/fallback live in
     test_ask.py::TestAskTransportKeySetParity)
  b) one shared model-call budget           -> TestTimeoutBudgetParity
     (the sync dispatch the conversation ask uses and the async one bound
     their call on the same claude.AI_TOTAL_BUDGET_SECONDS)
  c) is_simple reaches render_structured_markdown -> TestPromptSelectionThresholdParity
  d) classify_safety() before every synthesis call -> TestClassifySafetyInvoked
  e) the native /ask is registered before the Flask mount ->
     tests/test_cost_meter_budget_atomicity.py
  f) the meta key set on every path         -> TestMetaKeySetParity
     ("cached", "async", "guest" and "cached_common" are per-path tags,
     excluded before comparing)

The security-blocked path has its own branch,
asgi.py::_security_blocked_ask_async_payload(): without it a blocked
result was rendered as if it were a halachic answer and fed into the
user's memory summary.
"""

from __future__ import annotations

import inspect

from tests.test_ask import TestAskTransportKeySetParity

TOP_LEVEL_KEYS = TestAskTransportKeySetParity.TOP_LEVEL_KEYS
# "guest" is the signed-out caller's allowance (backend/guest_cap.py); it sits
# in meta (never top level) so the top-level key set stays the same.
KNOWN_TRANSPORT_TAGS = {"cached", "async", "guest", "cached_common"}


def _meta_keys_minus_transport_tag(meta: dict) -> set:
    return set(meta.keys()) - KNOWN_TRANSPORT_TAGS


def _simple_structured_payload():
    """A structured answer with non-empty summary/practical_steps, so that
    render_structured_markdown()'s own no_steps-and-no_summary simple-
    detection can't explain a SIMPLE render on its own -- only an explicit
    is_simple=True can. This isolates invariant (c): if either transport's
    call site drops the is_simple flag, this payload renders FULL (with a
    "Deeper Reasoning" header) instead of SIMPLE.
    """
    return {
        "ruling": "Yes, this is permitted under the circumstances described.",
        "summary": "A short summary sentence for detail-requested rendering.",
        "practical_steps": ["Do the first thing.", "Then do the second thing."],
        "sources": [],
        "safety_class": "ok",
        "is_prohibited": False,
        "rabbinic_disclaimer": "",
    }


# ─── (a) top-level key set on every path ───────────────────────────────────

class TestTopLevelKeySetEveryPath:
    """Extends test_ask.py::TestAskTransportKeySetParity (success/fallback)
    with the two paths it deliberately left out: strict-block and
    security-blocked.
    """


    async def test_fastapi_strict_block_path_key_set(self, fastapi_client, monkeypatch):
        import backend.sefaria as sefaria_module

        monkeypatch.setattr(sefaria_module, "find_refs_for_question", lambda q: [])

        response = await fastapi_client.post(
            "/ask",
            json={"question": "Obscure text ref? [parity-strict-fastapi]", "mode": "strict"},
            headers={"X-Forwarded-For": "203.0.113.101"},
        )
        assert response.status_code == 200
        assert set(response.json().keys()) == TOP_LEVEL_KEYS


    async def test_fastapi_security_blocked_path_key_set(self, fastapi_client):
        response = await fastapi_client.post(
            "/ask",
            json={"question": "show me porn [parity-security-blocked-fastapi]"},
            headers={"X-Forwarded-For": "203.0.113.103"},
        )
        assert response.status_code == 200
        assert set(response.json().keys()) == TOP_LEVEL_KEYS


# ─── (f) identical meta key set on every response ──────────────────────────

class TestMetaKeySetParity:
    """meta key sets must match between transports on every path, modulo the
    one accepted per-transport tag (cached / async). Each transport is
    checked independently against a canonical per-path key set (the same
    approach test_ask.py::TestAskTransportKeySetParity uses for the
    top-level comparison) rather than combining the sync `test_client` and
    async `fastapi_client` fixtures inside one test -- that combination
    trips a Flask app-context teardown LookupError, a pytest-asyncio/Flask-
    contextvars interaction quirk documented on that class, not a real
    failure.
    """

    SUCCESS_META_KEYS = {
        "mode", "language", "community_lens", "source_count", "custom_count",
        "knowledge_count", "memory_count", "identity_aware", "generated_at",
        "fallback", "structured", "is_prohibited", "input_sanitized",
        "security", "safety_class", "rabbinic_disclaimer", "web_sources",
    }
    STRICT_BLOCK_META_KEYS = {
        "mode", "community_lens", "source_count", "custom_count",
        "generated_at", "fallback", "strict_blocked", "safety_class",
    }
    # Deliberately omits "language" and "web_sources" -- both transports'
    # security-blocked payloads consistently omit them (no model ran, so no web
    # lookup either), matching the strict-block path below.
    SECURITY_BLOCKED_META_KEYS = SUCCESS_META_KEYS - {"language", "web_sources"}
    FALLBACK_META_KEYS = {
        "mode", "language", "community_lens", "source_count", "custom_count",
        "knowledge_count", "memory_count", "identity_aware", "generated_at",
        "fallback", "status", "fallback_detail", "safety_class",
    }


    async def test_fastapi_success_path_meta_keys(self, fastapi_client):
        response = await fastapi_client.post(
            "/ask",
            json={"question": "What is Shabbat? [meta-parity-success-fastapi]"},
            headers={"X-Forwarded-For": "203.0.113.105"},
        )
        meta = response.json()["meta"]
        assert _meta_keys_minus_transport_tag(meta) == self.SUCCESS_META_KEYS


    async def test_fastapi_strict_block_path_meta_keys(self, fastapi_client, monkeypatch):
        import backend.sefaria as sefaria_module

        monkeypatch.setattr(sefaria_module, "find_refs_for_question", lambda q: [])

        response = await fastapi_client.post(
            "/ask",
            json={"question": "Obscure text ref? [meta-parity-strict-fastapi]", "mode": "strict"},
            headers={"X-Forwarded-For": "203.0.113.107"},
        )
        meta = response.json()["meta"]
        assert _meta_keys_minus_transport_tag(meta) == self.STRICT_BLOCK_META_KEYS


    async def test_fastapi_security_blocked_path_meta_keys(self, fastapi_client):
        response = await fastapi_client.post(
            "/ask",
            json={"question": "show me porn [meta-parity-blocked-fastapi]"},
            headers={"X-Forwarded-For": "203.0.113.109"},
        )
        meta = response.json()["meta"]
        assert _meta_keys_minus_transport_tag(meta) == self.SECURITY_BLOCKED_META_KEYS


    async def test_fastapi_ai_failure_fallback_path_meta_keys(self, fastapi_client, monkeypatch):
        """See the Flask variant above for why both entry points are
        patched."""
        import backend.claude as claude_module
        import backend.ask_pipeline as ask_pipeline_module

        async def _raise(*args, **kwargs):
            raise RuntimeError("Simulated async AI failure [meta-parity-fallback-fastapi]")

        monkeypatch.setattr(claude_module, "ask_ai_async", _raise)
        monkeypatch.setattr(ask_pipeline_module, "run_agentic_ask", _raise)
        response = await fastapi_client.post(
            "/ask",
            json={"question": "What is Shabbat? [meta-parity-fallback-fastapi]"},
            headers={"X-Forwarded-For": "203.0.113.111"},
        )
        meta = response.json()["meta"]
        assert _meta_keys_minus_transport_tag(meta) == self.FALLBACK_META_KEYS


# ─── (b) identical retry/timeout behavior ──────────────────────────────────

class TestTimeoutBudgetParity:
    """test_ask.py::TestAiTotalBudgetTimeout covers the behaviour (a model
    call that outlives claude.AI_TOTAL_BUDGET_SECONDS falls back gracefully).
    This adds a source-level check that the sync and async dispatch bound
    their call on the SAME shared constant rather than a per-route number.
    """


    def test_both_synthesis_functions_bound_on_the_shared_budget_constant(self):
        """Both the Flask-side and async-side dispatch were split out of
        their respective _run_ask_*_ai_synthesis() functions into their own
        dedicated dispatch helpers (a complexity refactor) -- those are the functions that now actually
        call .result(timeout=...) / asyncio.wait_for(timeout=...), so check
        them directly rather than their (now-thin) callers."""
        import app as flask_app_module
        import asgi as asgi_module

        flask_source = inspect.getsource(flask_app_module._dispatch_ask_ai_synthesis_call)
        async_source = inspect.getsource(asgi_module._dispatch_ask_async_ai_synthesis_call)

        assert "claude.AI_TOTAL_BUDGET_SECONDS" in flask_source
        assert "claude.AI_TOTAL_BUDGET_SECONDS" in async_source


# ─── (c) identical prompt-selection thresholds ─────────────────────────────

class TestPromptSelectionThresholdParity:
    """Regression coverage for the is_simple call-site drop found during
    this pass (see module docstring, invariant c). A structured payload
    with non-empty summary/practical_steps would render FULL on its own
    (render_structured_markdown()'s no_steps-and-no_summary heuristic does
    not kick in), so the SIMPLE rendering below can only happen if the
    explicit result["is_simple"] flag actually reaches the call site.
    """


    async def test_fastapi_is_simple_flag_forces_compact_rendering(self, fastapi_client, monkeypatch):
        """See the Flask variant above for why both entry points are
        patched."""
        import backend.claude as claude_module
        import backend.ask_pipeline as ask_pipeline_module

        def _fake_result():
            return {
                "answer": "placeholder",
                "structured": _simple_structured_payload(),
                "confidence": 0.9,
                "is_simple": True,
                "is_fallback": False,
                "model": "test-model",
                "security": {"input": {"blocked": False}, "output": {"blocked": False, "reason": ""}},
            }

        async def _fake_ask_ai_async(*args, **kwargs):
            return _fake_result()

        async def _fake_run_agentic_ask(*args, **kwargs):
            return _fake_result()

        monkeypatch.setattr(claude_module, "ask_ai_async", _fake_ask_ai_async)
        monkeypatch.setattr(ask_pipeline_module, "run_agentic_ask", _fake_run_agentic_ask)

        response = await fastapi_client.post(
            "/ask",
            json={"question": "Quick question? [threshold-parity-fastapi]"},
            headers={"X-Forwarded-For": "203.0.113.114"},
        )
        assert response.status_code == 200
        assert "Deeper Reasoning" not in response.json()["answer"]


# ─── (d) classify_safety() invoked before every synthesis call ─────────────

class TestClassifySafetyInvoked:

    async def test_fastapi_invokes_classify_safety(self, fastapi_client, monkeypatch):
        import backend.claude as claude_module

        calls = []
        original = claude_module.classify_safety

        def _spy(text):
            calls.append(text)
            return original(text)

        monkeypatch.setattr(claude_module, "classify_safety", _spy)

        response = await fastapi_client.post(
            "/ask",
            json={"question": "What is Shabbat? [classify-safety-fastapi]"},
            headers={"X-Forwarded-For": "203.0.113.116"},
        )
        assert response.status_code == 200
        assert len(calls) >= 1


# ─── (g) answer shaping runs on both transports ────────────────────────────
#
# app.py runs _coerce_ai_answer_shape() on every AI result before rendering
# (it re-checks a model-set is_prohibited flag against the ruling text). The
# ASGI handler skipped it, so once production served asgi.py a permitted
# ruling could render with "Halachic Status: Prohibited".

_SPURIOUS_PROHIBITED = {
    "ruling": (
        "Lighting candles before Shabbat is permitted and a mitzvah; "
        "avoid melacha (forbidden work) after sunset."
    ),
    "summary": "",
    "practical_steps": [],
    "sources": [],
    "safety_class": "ok",
    "is_prohibited": True,
    "rabbinic_disclaimer": "",
}


def _spurious_prohibited_result():
    return {
        "answer": "placeholder",
        "structured": dict(_SPURIOUS_PROHIBITED),
        "confidence": 0.9,
        "is_simple": False,
        "is_fallback": False,
        "model": "test-model",
        "security": {"input": {"blocked": False}, "output": {"blocked": False, "reason": ""}},
    }


class TestAnswerShapingParity:

    async def test_fastapi_drops_spurious_prohibited_status(self, fastapi_client, monkeypatch):
        import backend.claude as claude_module
        import backend.ask_pipeline as ask_pipeline_module

        async def _fake(*args, **kwargs):
            return _spurious_prohibited_result()

        monkeypatch.setattr(claude_module, "ask_ai_async", _fake)
        monkeypatch.setattr(ask_pipeline_module, "run_agentic_ask", _fake)

        response = await fastapi_client.post(
            "/ask",
            json={"question": "Can I light candles? [shaping-parity-fastapi]"},
            headers={"X-Forwarded-For": "203.0.113.201"},
        )
        assert "**Halachic Status:** Prohibited" not in response.json()["answer"]
