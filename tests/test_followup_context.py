"""A follow-up keeps the thread (docs/evals/2026-10-22-followup-context.md)."""

import asyncio

from backend import claude, guest_cap

THREAD = [
    {"role": "user", "content": "What is the blessing on wine?"},
    {"role": "assistant", "content": "Borei pri hagafen."},
    {"role": "user", "content": "And on grape juice?"},
    {"role": "assistant", "content": "The same blessing, Borei pri hagafen."},
]


def _fake_providers(monkeypatch, seen):
    async def gemini(prompt, dynamic_system_context="", is_simple=False, history_turns=None, max_tokens=None):
        seen.append(("gemini", history_turns))
        return {"answer": "", "error": "gemini_sdk_error: down", "is_fallback": True}

    async def anthropic(prompt, dynamic_system_context="", gemini_error="", history_turns=None, max_tokens=None):
        seen.append(("claude", history_turns))
        return {"answer": '{"ruling": "ok"}', "structured": {"ruling": "ok", "sources": []}, "is_fallback": False}

    monkeypatch.setattr(claude, "_call_gemini_httpx_model", gemini)
    monkeypatch.setattr(claude, "_call_anthropic_httpx_model", anthropic)


def test_the_third_turn_reaches_both_providers_with_the_first_two_turns(monkeypatch):
    seen = []
    _fake_providers(monkeypatch, seen)
    asyncio.run(claude.ask_ai_async(
        "What about on the second one?", [], [], conversation_history=THREAD, web_search=False))
    assert [name for name, _ in seen] == ["gemini", "claude"]
    for _name, turns in seen:
        assert [t["role"] for t in turns] == ["user", "assistant", "user", "assistant"]
        assert "wine" in turns[0]["text"]
        assert "grape juice" in turns[2]["text"]
    assert seen[0][1] == seen[1][1]


def test_a_refused_question_leaves_the_thread_with_its_refusal():
    refusal = claude._off_topic_refusal_message("literature")
    history = THREAD[:2] + [
        {"role": "user", "content": "who wrote Hamlet?"},
        {"role": "assistant", "content": refusal},
    ] + THREAD[2:]
    turns = claude.build_history_turns(history)
    assert [t["role"] for t in turns] == ["user", "assistant", "user", "assistant"]
    assert not any("Hamlet" in t["text"] or "outside what I can help" in t["text"] for t in turns)


def test_the_hebrew_refusal_leaves_the_thread_too():
    refusal = claude._off_topic_refusal_message("x", "he")
    history = THREAD[:2] + [{"role": "user", "content": "מי כתב המלט"}, {"role": "assistant", "content": refusal}]
    turns = claude.build_history_turns(history)
    assert len(turns) == 2
    assert "המלט" not in turns[0]["text"]


def test_a_thread_that_opens_with_a_refusal_is_just_empty():
    history = [{"role": "user", "content": "who wrote Hamlet?"},
               {"role": "assistant", "content": claude._off_topic_refusal_message("literature")}]
    assert claude.build_history_turns(history) == []


def test_the_claude_messages_keep_the_roles_and_cache_the_thread():
    turns = claude.build_history_turns(THREAD)
    messages = claude._anthropic_messages("What about on the second one?", turns)
    assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant", "user"]
    cached = messages[-2]["content"][0]
    assert cached["cache_control"] == {"type": "ephemeral"}
    assert "Borei pri hagafen" in cached["text"]
    assert messages[-1] == {"role": "user", "content": "What about on the second one?"}


def test_the_same_words_asked_in_two_threads_do_not_share_an_answer():
    one = guest_cap.GuestThread(owner="device", rows=[{"id": "a"}, {"id": "b"}])
    two = guest_cap.GuestThread(owner="device", rows=[{"id": "c"}])
    assert one.cache_scope != two.cache_scope
