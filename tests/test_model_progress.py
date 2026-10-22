"""The model call tells the reader why it is taking longer than a few seconds
(backend/ask_progress.py STEPS, worded in static/js/ask-progress.js): a long answer
was asked for, the first model is being asked again, a second model has taken over,
or the answer is getting a second look."""

import asyncio

from backend import ask_progress, claude

ANSWERED = {"ruling": "King David was the second king of Israel.", "sources": []}
REFUSED = {"ruling": "", "sources": [], "out_of_scope": True, "out_of_scope_subject": "biography"}


def _steps(events):
    return [e["detail"]["step"] for e in events if e.get("detail") and e["detail"].get("kind") == "step"]


def _run(question, monkeypatch, gemini_replies, anthropic_reply=None):
    events, calls = [], []

    async def gemini(prompt, dynamic_system_context="", is_simple=False, history_turns=None, max_tokens=None):
        calls.append("gemini")
        reply = gemini_replies[min(len(calls) - 1, len(gemini_replies) - 1)]
        if isinstance(reply, str):
            return {"answer": "", "error": reply, "is_fallback": False}
        return {"answer": "x", "structured": reply, "is_fallback": False}

    async def anthropic(prompt, dynamic_system_context="", gemini_error="", history_turns=None, max_tokens=None):
        calls.append("anthropic")
        return {"answer": "x", "structured": anthropic_reply, "is_fallback": True}

    monkeypatch.setattr(claude, "_call_gemini_httpx_model", gemini)
    monkeypatch.setattr(claude, "_call_anthropic_httpx_model", anthropic)
    token = ask_progress.bind(events.append)
    try:
        asyncio.run(claude.ask_ai_async(question, [], [], web_search=False))
    finally:
        ask_progress.unbind(token)
    return _steps(events), calls


def test_an_ordinary_answer_reports_no_step(monkeypatch):
    steps, _ = _run("Who was King David?", monkeypatch, [ANSWERED])
    assert steps == []


def test_a_long_answer_says_so_before_the_model_is_asked(monkeypatch):
    steps, _ = _run("Explain in depth the story of King David.", monkeypatch, [ANSWERED])
    assert steps == ["long"]


def test_a_failed_first_model_says_a_second_one_took_over(monkeypatch):
    steps, calls = _run("Who was King David?", monkeypatch, ["gemini_unavailable"], ANSWERED)
    assert calls == ["gemini", "anthropic"]
    assert steps == ["second_model"]


def test_a_question_the_model_flags_gets_a_second_look_and_says_so(monkeypatch):
    steps, calls = _run("Who was King David?", monkeypatch, [REFUSED, ANSWERED])
    assert calls == ["gemini", "gemini"]
    assert steps == ["second_look"]


def test_a_gemini_retry_says_the_first_model_is_being_asked_again():
    events = []
    token = ask_progress.bind(events.append)
    try:
        claude._announce_gemini_retry(object())
    finally:
        ask_progress.unbind(token)
    assert _steps(events) == ["retry"]
