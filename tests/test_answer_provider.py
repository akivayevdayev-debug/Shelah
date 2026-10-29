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


GEMINI_ANSWER = {"answer": "gemini", "is_fallback": False}
HAIKU_ANSWER = {"answer": "haiku", "is_fallback": True}


def _hedge(monkeypatch, gemini_steps, haiku_delay=0.0, haiku_error=""):
    """Runs _gemini_then_haiku with a 50 ms hedge. ``gemini_steps`` is a list
    of ("sleep", s) / ("start",) / ("answer",) / ("fail", error) actions."""
    calls, recorded = [], []
    monkeypatch.setattr(claude, "GEMINI_HEDGE_SECONDS", 0.05)
    monkeypatch.setattr(claude, "_record_gemini_error", recorded.append)

    async def gemini():
        calls.append("gemini")
        for step in gemini_steps:
            if step[0] == "sleep":
                await asyncio.sleep(step[1])
            elif step[0] == "start":
                claude._gemini_stream_state.get()["started"].set()
            elif step[0] == "fail":
                return {"answer": "", "error": step[1]}
        return dict(GEMINI_ANSWER)

    async def haiku(gemini_error):
        calls.append(f"haiku:{gemini_error}")
        await asyncio.sleep(haiku_delay)
        return {"answer": "", "error": haiku_error} if haiku_error else dict(HAIKU_ANSWER)

    async def run():
        token = ask_progress.bind(lambda _event: None)
        try:
            return await claude._gemini_then_haiku(gemini, haiku)
        finally:
            ask_progress.unbind(token)

    return asyncio.run(run()), calls, recorded


class TestSlowGemini:
    def test_a_quick_gemini_answer_needs_no_haiku(self, monkeypatch):
        _, calls, _ = _hedge(monkeypatch, [("answer",)])
        assert calls == ["gemini"]

    def test_a_gemini_that_started_in_time_is_waited_for(self, monkeypatch):
        result, _, _ = _hedge(monkeypatch, [("start",), ("sleep", 0.15), ("answer",)])
        assert result["answer"] == "gemini"

    def test_a_gemini_that_started_in_time_does_not_bring_in_haiku(self, monkeypatch):
        _, calls, _ = _hedge(monkeypatch, [("start",), ("sleep", 0.15), ("answer",)])
        assert calls == ["gemini"]

    def test_a_gemini_that_has_not_started_brings_in_haiku(self, monkeypatch):
        result, _, _ = _hedge(monkeypatch, [("sleep", 5)])
        assert result["answer"] == "haiku"

    def test_haiku_is_asked_with_no_gemini_error_when_gemini_is_only_slow(self, monkeypatch):
        _, calls, _ = _hedge(monkeypatch, [("sleep", 5)])
        assert calls == ["gemini", "haiku:"]

    def test_haikus_answer_after_a_slow_gemini_is_a_fallback(self, monkeypatch):
        result, _, _ = _hedge(monkeypatch, [("sleep", 5)])
        assert result["is_fallback"] is True

    def test_a_gemini_that_never_started_counts_as_a_gemini_error(self, monkeypatch):
        _, _, recorded = _hedge(monkeypatch, [("sleep", 5)])
        assert [str(e) for e in recorded] == ["gemini_slow_start"]

    def test_a_late_gemini_still_wins_when_it_beats_haiku(self, monkeypatch):
        result, _, _ = _hedge(monkeypatch, [("sleep", 0.1), ("answer",)], haiku_delay=1)
        assert result["answer"] == "gemini"

    def test_a_late_gemini_that_wins_is_not_counted_as_an_error(self, monkeypatch):
        _, _, recorded = _hedge(monkeypatch, [("sleep", 0.1), ("answer",)], haiku_delay=1)
        assert recorded == []

    def test_a_slow_gemini_that_then_fails_leaves_haikus_answer(self, monkeypatch):
        result, _, _ = _hedge(monkeypatch, [("sleep", 0.1), ("fail", "gemini_sdk_error: 504")], haiku_delay=0.3)
        assert result["answer"] == "haiku"

    def test_a_quick_gemini_failure_hands_its_error_to_haiku(self, monkeypatch):
        _, calls, _ = _hedge(monkeypatch, [("fail", "gemini_sdk_error: 503")])
        assert calls == ["gemini", "haiku:gemini_sdk_error: 503"]

    def test_when_both_fail_in_the_race_the_error_names_both(self, monkeypatch):
        result, _, _ = _hedge(monkeypatch, [("sleep", 0.1), ("fail", "gemini_sdk_error: 504")],
                              haiku_error="anthropic_sdk_error: overloaded")
        assert result["error"] == "gemini_error: gemini_sdk_error: 504; anthropic_sdk_error: overloaded"


@pytest.mark.usefixtures("no_wait_drafts")
def test_a_muted_gemini_stream_sends_no_draft(monkeypatch):
    sent = []

    class _Models:
        async def generate_content_stream(self, **_request):
            async def chunks():
                yield type("C", (), {"text": '{"ruling": "Yes."', "usage_metadata": None})()
            return chunks()

    async def run():
        token = ask_progress.bind(sent.append)
        state_token = claude._gemini_stream_state.set({"started": asyncio.Event(), "muted": True})
        try:
            await claude._stream_gemini_with_draft(type("Client", (), {"aio": type("A", (), {"models": _Models()})()})(), {})
        finally:
            claude._gemini_stream_state.reset(state_token)
            ask_progress.unbind(token)

    asyncio.run(run())
    assert [e for e in sent if e.get("type") == "draft"] == []


@pytest.fixture
def no_wait_drafts(monkeypatch):
    monkeypatch.setattr(claude._RulingDraft, "DRAFT_INTERVAL_SECONDS", 0)
