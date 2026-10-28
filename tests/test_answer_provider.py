"""Which model writes the answer (backend/claude.py AI_ANSWER_PROVIDER): by
default Gemini Flash Lite for a simple question and Claude Haiku for a harder
one, each backed up by the other; the setting can put one model first always."""

import asyncio

import pytest

from backend import ask_progress, claude

ANSWERED = {"ruling": "King David was the second king of Israel.", "sources": []}


@pytest.fixture
def claude_first(monkeypatch):
    monkeypatch.setattr(claude, "AI_ANSWER_PROVIDER", "claude")


@pytest.fixture
def routed(monkeypatch):
    monkeypatch.setattr(claude, "AI_ANSWER_PROVIDER", "auto")


SIMPLE_QUESTION = "Who was King David?"
HARD_QUESTION = "Compare the views of the Rambam and the Shulchan Aruch on this, in detail"


def _run(monkeypatch, anthropic_reply, gemini_reply=None, question=SIMPLE_QUESTION):
    calls, events = [], []

    async def anthropic(prompt, dynamic_system_context="", gemini_error="", history_turns=None, max_tokens=None):
        calls.append("anthropic")
        if isinstance(anthropic_reply, str):
            return {"answer": "", "error": anthropic_reply, "is_fallback": True}
        return {"answer": "x", "structured": anthropic_reply, "is_fallback": True}

    async def gemini(prompt, dynamic_system_context="", is_simple=False, history_turns=None, max_tokens=None):
        calls.append("gemini")
        if isinstance(gemini_reply, str):
            return {"answer": "", "error": gemini_reply, "is_fallback": False}
        return {"answer": "x", "structured": gemini_reply, "is_fallback": False}

    monkeypatch.setattr(claude, "_call_anthropic_httpx_model", anthropic)
    monkeypatch.setattr(claude, "_call_gemini_httpx_model", gemini)
    token = ask_progress.bind(events.append)
    try:
        result = asyncio.run(claude.ask_ai_async(question, [], [], web_search=False))
    finally:
        ask_progress.unbind(token)
    steps = [e["detail"]["step"] for e in events if (e.get("detail") or {}).get("kind") == "step"]
    return result, calls, steps


def test_routing_is_the_default_with_no_setting():
    assert claude.answer_provider_from_env({}) == "auto"


def test_the_setting_can_put_claude_first():
    assert claude.answer_provider_from_env({"AI_ANSWER_PROVIDER": "claude"}) == "claude"


def test_the_setting_can_put_gemini_first():
    assert claude.answer_provider_from_env({"AI_ANSWER_PROVIDER": " Gemini "}) == "gemini"


def test_an_unknown_setting_keeps_the_routing():
    assert claude.answer_provider_from_env({"AI_ANSWER_PROVIDER": "gpt"}) == "auto"


@pytest.mark.usefixtures("routed")
class TestRouting:
    def test_a_simple_question_goes_to_gemini(self, monkeypatch):
        _, calls, _ = _run(monkeypatch, ANSWERED, ANSWERED)
        assert calls == ["gemini"]

    def test_a_hard_question_goes_to_haiku(self, monkeypatch):
        _, calls, _ = _run(monkeypatch, ANSWERED, ANSWERED, question=HARD_QUESTION)
        assert calls == ["anthropic"]

    def test_haiku_backs_up_a_failed_gemini(self, monkeypatch):
        _, calls, _ = _run(monkeypatch, ANSWERED, "gemini_sdk_error: 503")
        assert calls == ["gemini", "anthropic"]

    def test_gemini_backs_up_a_failed_haiku_on_a_hard_question(self, monkeypatch):
        _, calls, _ = _run(monkeypatch, "anthropic_sdk_error: overloaded", ANSWERED, question=HARD_QUESTION)
        assert calls == ["anthropic", "gemini"]

    def test_the_sync_path_sends_a_short_answer_to_gemini(self, monkeypatch):
        calls = []

        async def claude_model(prompt, dynamic_system_context="", gemini_error="", history_turns=None, max_tokens=None):
            calls.append("anthropic")
            return {"answer": "x", "is_fallback": True}

        def gemini_model(prompt, dynamic_system_context="", max_tokens=3072, history_turns=None):
            calls.append("gemini")
            return {"answer": "y", "is_fallback": False}

        monkeypatch.setattr(claude, "_call_claude_model", claude_model)
        monkeypatch.setattr(claude, "_call_gemini_model", gemini_model)
        asyncio.run(claude._call_primary_model("prompt", max_tokens=claude.SIMPLE_ANSWER_MAX_TOKENS))
        assert calls == ["gemini"]


@pytest.mark.usefixtures("claude_first")
class TestClaudeFirst:
    def test_haiku_answers_and_gemini_is_never_asked(self, monkeypatch):
        _, calls, _ = _run(monkeypatch, ANSWERED)
        assert calls == ["anthropic"]

    def test_haikus_answer_is_not_marked_a_fallback(self, monkeypatch):
        result, _, _ = _run(monkeypatch, ANSWERED)
        assert result["is_fallback"] is False

    def test_a_failed_haiku_hands_over_to_gemini(self, monkeypatch):
        _, calls, _ = _run(monkeypatch, "anthropic_sdk_error: overloaded", ANSWERED)
        assert calls == ["anthropic", "gemini"]

    def test_the_reader_is_told_a_second_model_took_over(self, monkeypatch):
        _, _, steps = _run(monkeypatch, "anthropic_sdk_error: overloaded", ANSWERED)
        assert steps == ["second_model"]

    def test_geminis_backup_answer_is_marked_a_fallback(self, monkeypatch):
        result, _, _ = _run(monkeypatch, "anthropic_sdk_error: overloaded", ANSWERED)
        assert result["is_fallback"] is True

    def test_when_both_fail_the_error_names_both(self, monkeypatch):
        result, _, _ = _run(monkeypatch, "anthropic_sdk_error: overloaded", "gemini_error: 503")
        assert result["error"] == "anthropic_error: anthropic_sdk_error: overloaded; gemini_error: 503"

    def test_a_security_block_is_an_answer_not_a_failure(self, monkeypatch):
        _, calls, _ = _run(monkeypatch, "security_blocked: output", ANSWERED)
        assert calls == ["anthropic"]


@pytest.mark.usefixtures("claude_first")
class TestClaudeFirstSyncPath:
    def _run_sync(self, monkeypatch, anthropic_error=""):
        calls = []

        async def claude_model(prompt, dynamic_system_context="", gemini_error="", history_turns=None, max_tokens=None):
            calls.append("anthropic")
            return {"answer": "", "error": anthropic_error} if anthropic_error else {"answer": "x", "is_fallback": True}

        def gemini_model(prompt, dynamic_system_context="", max_tokens=3072, history_turns=None):
            calls.append("gemini")
            return {"answer": "y", "is_fallback": False}

        monkeypatch.setattr(claude, "_call_claude_model", claude_model)
        monkeypatch.setattr(claude, "_call_gemini_model", gemini_model)
        asyncio.run(claude._call_primary_model("prompt"))
        return calls

    def test_haiku_answers_first(self, monkeypatch):
        assert self._run_sync(monkeypatch) == ["anthropic"]

    def test_gemini_backs_up_a_failed_haiku(self, monkeypatch):
        assert self._run_sync(monkeypatch, "anthropic_sdk_error: x") == ["anthropic", "gemini"]
