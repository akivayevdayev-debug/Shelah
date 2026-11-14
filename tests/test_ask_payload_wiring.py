"""The /ask path (asgi.py) must hand the shared payload builders the right
inputs and the right transport marker.

backend/ask_payloads.py's own tests pin the shape; these pin the wiring: the
route passes its `async` marker and forwards the community lens, mode, language, sanitisation flag and the
original AI error (whose *coarse* reason ends up in `fallback_detail`).
"""

from __future__ import annotations

from unittest import mock

import pytest

import app as flask_app
import asgi


@pytest.fixture
def ctx():
    return {
        "wiki_list": [], "halachipedia_list": [], "customs_info": [], "primary_sources": [{"s": 1}],
        "knowledge_rows": [], "user_memory_summaries": [],
        "use_tertiary_web_context": False, "wiki_context_for_claude": "", "wiki_context_for_ai": "",
    }


@pytest.fixture
def ai_result():
    return {"answer": "raw", "confidence": 0.8, "is_fallback": False,
            "structured": {"ruling": "Permitted.", "summary": "s", "practical_steps": [], "sources": []}}



async def _async_ai(ctx, ai_result, **overrides):
    args = dict(question="Q?", mode="strict", canonical_lens="Yemenite", answer_language="he",
                user_id="u1", question_was_sanitized=True)
    args.update(overrides)

    async def fake_dispatch(*a, **k):
        return ai_result

    with mock.patch.object(asgi, "_dispatch_ask_async_ai_synthesis_call", fake_dispatch), \
            mock.patch.object(asgi, "_validate_ask_async_ai_result", return_value=""), \
            mock.patch.object(asgi, "_store_user_memory_summary"), \
            mock.patch.object(asgi, "_store_ask_history"), \
            mock.patch.dict(flask_app.DEVTOOLS_STATS, {"answers_total": 0, "fallback_answers": 0}):
        return await asgi._run_ask_async_ai_synthesis(
            args["question"], args["mode"], args["canonical_lens"], args["answer_language"],
            args["user_id"], args["question_was_sanitized"], ctx)



async def _async_fallback(ctx, error):
    with mock.patch.object(asgi, "get_halakhic_sources",
                           return_value={"sources": [], "source_count": 2, "warning": "web"}), \
            mock.patch.object(asgi, "_capture_backend_error"), \
            mock.patch.object(asgi, "_store_user_memory_summary"), \
            mock.patch.dict(flask_app.DEVTOOLS_STATS, {"answers_total": 0, "fallback_answers": 0}):
        return await asgi._run_ask_async_fallback("Q?", "sources", "Georgian", "he", "u1", error, ctx)


class TestSuccessfulAnswerWiring:

    async def test_asgi_marks_the_payload_async_and_forwards_the_inputs(self, ctx, ai_result):
        meta = (await _async_ai(ctx, ai_result))["meta"]

        assert meta["async"] is True
        assert "cached" not in meta
        assert (meta["mode"], meta["language"], meta["community_lens"]) == ("strict", "he", "Yemenite")
        assert meta["input_sanitized"] is True
        assert meta["identity_aware"] is True
        assert meta["source_count"] == 1


    async def test_asgi_identity_and_sanitisation_follow_the_request(self, ctx, ai_result):
        meta = (await _async_ai(ctx, dict(ai_result), user_id=None, question_was_sanitized=False))["meta"]

        assert meta["identity_aware"] is False
        assert meta["input_sanitized"] is False


class TestSourceFallbackWiring:

    async def test_asgi_fallback_marks_async_and_reports_the_coarse_error_reason(self, ctx):
        payload = await _async_fallback(ctx, RuntimeError("anthropic_sdk_error: 429 rate limit exceeded"))

        meta = payload["meta"]
        assert meta["async"] is True
        assert "cached" not in meta
        assert (meta["mode"], meta["language"], meta["community_lens"]) == ("sources", "he", "Georgian")
        assert meta["identity_aware"] is True
        assert meta["fallback_detail"]["reason"] == "rate_limited"
        assert meta["fallback_detail"]["warning"] == "web"
        assert payload["confidence"] == 0.4
