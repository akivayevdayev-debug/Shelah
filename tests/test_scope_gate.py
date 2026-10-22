"""Questions that are in scope are not refused (docs/evals/2026-10-22-refusals.md).

The keyword gate used to read every question alone, so a follow-up that swaps in
a new thing ("what about football?" after a Shabbat answer) looked like a sports
question and was refused before the model saw the thread. The model's own
out_of_scope flag also refused plain Jewish history and zmanim questions.
"""

import asyncio

import pytest

from backend import claude

ELLIPTICAL = [
    "what about football?",
    "and what about a movie?",
    "How about a concert?",
    "what if it is a novel?",
    "and for a movie?",
    "in the cinema?",
    "Also what about a poem?",
    "and a poem?",
    "but on a ship?",
]
OFF_TOPIC_ANYWHERE = [
    "who wrote Hamlet?",
    "write me a poem about the ocean",
    "Who won the football game last night?",
    "What is the capital of France?",
]


@pytest.mark.parametrize("question", ["what about football?", "and what about a movie?"])
def test_an_elliptical_follow_up_alone_is_refused(question):
    assert claude.off_topic_block_result(question) is not None


@pytest.mark.parametrize("question", ELLIPTICAL)
def test_an_elliptical_follow_up_in_a_thread_goes_to_the_model(question):
    assert claude.off_topic_block_result(question, in_thread=True) is None


@pytest.mark.parametrize("question", OFF_TOPIC_ANYWHERE)
def test_an_off_topic_question_is_refused_in_a_thread_too(question):
    assert claude.off_topic_block_result(question, in_thread=True) is not None


def test_inappropriate_content_is_refused_in_a_thread():
    validation = claude.validate_user_query("what about porn?", True)
    assert validation["blocked"]
    assert "inappropriate_content" in validation["reasons"]


def test_the_thread_reaches_the_gate_from_ask_ai_async(monkeypatch):
    seen = []

    async def gemini(prompt, dynamic_system_context="", is_simple=False, history_turns=None, max_tokens=None):
        seen.append(prompt)
        return {"answer": '{"ruling": "Jewish law has a view on it."}',
                "structured": {"ruling": "Jewish law has a view on it.", "sources": []}, "is_fallback": False}

    monkeypatch.setattr(claude, "_call_gemini_httpx_model", gemini)
    history = [
        {"role": "user", "content": "Can I play ball on Shabbat?"},
        {"role": "assistant", "content": "Playing ball is discussed under muktzeh and carrying."},
    ]
    result = asyncio.run(claude.ask_ai_async(
        "what about football?", [], [], conversation_history=history, web_search=False))
    assert seen, "the model was never asked"
    assert not str(result.get("error") or "").startswith("security_blocked")

    seen.clear()
    result = asyncio.run(claude.ask_ai_async("what about football?", [], [], web_search=False))
    assert not seen
    assert str(result.get("error") or "").startswith("security_blocked")


@pytest.mark.parametrize("prompt", [claude.CORE_SYSTEM_PROMPT, claude.SIMPLE_SYSTEM_PROMPT])
def test_the_scope_text_keeps_jewish_history_and_zmanim_in_scope(prompt):
    assert "Jewish history" in prompt
    assert "zmanim" in prompt
    assert "what about football?" in prompt


def test_the_prompt_for_a_question_tells_the_model_the_same_thing():
    prompt = claude.build_prompt("Who was King David?", [], [])
    assert "Jewish history, Jewish figures, the calendar and zmanim are not out of scope" in prompt


def _fake_gemini(replies, prompts):
    async def gemini(prompt, dynamic_system_context="", is_simple=False, history_turns=None, max_tokens=None):
        prompts.append(prompt)
        reply = replies[min(len(prompts) - 1, len(replies) - 1)]
        return {"answer": "x", "structured": reply, "is_fallback": False}
    return gemini


REFUSED = {"ruling": "", "sources": [], "out_of_scope": True, "out_of_scope_subject": "biography"}
ANSWERED = {"ruling": "King David was the second king of Israel.", "sources": []}


def test_a_question_with_a_jewish_angle_that_the_model_flags_gets_a_second_look(monkeypatch):
    prompts = []
    monkeypatch.setattr(claude, "_call_gemini_httpx_model", _fake_gemini([REFUSED, ANSWERED], prompts))
    result = asyncio.run(claude.ask_ai_async("Who was King David?", [], [], web_search=False))
    assert len(prompts) == 2
    assert "SCOPE CHECK" not in prompts[0] and "SCOPE CHECK" in prompts[1]
    assert not str(result.get("error") or "").startswith("security_blocked")
    assert "second king" in result["structured"]["ruling"]


def test_a_second_flag_stands_and_the_question_is_refused(monkeypatch):
    prompts = []
    monkeypatch.setattr(claude, "_call_gemini_httpx_model", _fake_gemini([REFUSED], prompts))
    result = asyncio.run(claude.ask_ai_async("Who was King David?", [], [], web_search=False))
    assert len(prompts) == 2
    assert str(result.get("error") or "").startswith("security_blocked")


def test_a_question_with_no_jewish_angle_is_refused_after_one_more_look(monkeypatch):
    prompts = []
    monkeypatch.setattr(claude, "_call_gemini_httpx_model", _fake_gemini([REFUSED], prompts))
    result = asyncio.run(claude.ask_ai_async("What is the speed of light in a vacuum?", [], [], web_search=False))
    assert len(prompts) == 2
    assert str(result.get("error") or "").startswith("security_blocked")


def test_an_unfamiliar_torah_name_that_the_model_flags_is_answered_on_the_second_look(monkeypatch):
    prompts = []
    monkeypatch.setattr(claude, "_call_gemini_httpx_model", _fake_gemini([REFUSED, ANSWERED], prompts))
    result = asyncio.run(claude.ask_ai_async("Explain the story of Korach.", [], [], web_search=False))
    assert len(prompts) == 2
    assert "Korach" in prompts[1].split("SCOPE CHECK")[1]
    assert not str(result.get("error") or "").startswith("security_blocked")


def test_a_short_follow_up_in_a_thread_gets_a_second_look(monkeypatch):
    prompts = []
    monkeypatch.setattr(claude, "_call_gemini_httpx_model", _fake_gemini([REFUSED, ANSWERED], prompts))
    history = [
        {"role": "user", "content": "Can I eat before Kiddush?"},
        {"role": "assistant", "content": "Not a meal."},
    ]
    asyncio.run(claude.ask_ai_async(
        "and what is the speed of light", [], [], conversation_history=history, web_search=False))
    assert len(prompts) == 2


def test_a_long_off_topic_question_in_a_thread_gets_the_name_note_not_the_gentle_one():
    note = claude.scope_second_look_note(
        "please explain to me in great detail how the speed of light was first measured", True)
    assert note == claude._SCOPE_UNFAMILIAR_NAME_NOTE


@pytest.mark.parametrize("question", [
    "What is the Jewish view of Shakespeare's Merchant of Venice?",
    "What is the history of the Spanish Inquisition and the Jews?",
    "מי היה דוד המלך?",
    "What happened in the Holocaust and how do we remember it?",
    "Where does antisemitism come from?",
])
def test_a_question_that_names_a_jewish_subject_gets_the_firm_note(question):
    assert claude.scope_second_look_note(question, False) == claude._SCOPE_FIRM_NOTE


def test_a_weaker_signal_or_a_short_follow_up_gets_the_gentle_note():
    assert claude.scope_second_look_note("Who was King David?", False) == claude._SCOPE_SECOND_LOOK_NOTE
    assert claude.scope_second_look_note("and a poem?", True) == claude._SCOPE_SECOND_LOOK_NOTE
    assert claude.scope_second_look_note("and a poem?", False) == claude._SCOPE_UNFAMILIAR_NAME_NOTE


@pytest.mark.parametrize("question", [
    "Who was King David?", "Explain Bereishit chapter 1 in detail", "Who was King Solomon?",
])
def test_biblical_questions_carry_a_jewish_signal(question):
    assert claude._has_jewish_context(question)


# ── the sync path (Flask /ask and a signed-in conversation reply) ─────────────

def _fake_sync_model(replies, prompts):
    def model(prompt, dynamic_system_context="", max_tokens=3072, history_turns=None):
        prompts.append(prompt)
        reply = replies[min(len(prompts) - 1, len(replies) - 1)]
        if isinstance(reply, str):
            return {"answer": "", "error": reply, "is_fallback": True}
        return {"answer": "x", "structured": reply, "is_fallback": False}
    return model


def test_the_sync_path_gives_a_flagged_question_a_second_look(monkeypatch):
    prompts = []
    monkeypatch.setattr(claude, "_call_primary_model_sync", _fake_sync_model([REFUSED, ANSWERED], prompts))
    result = claude.ask_claude("Who was King David?", [], [], web_search=False)
    assert len(prompts) == 2
    assert "SCOPE CHECK" in prompts[1]
    assert not str(result.get("error") or "").startswith("security_blocked")


def test_the_sync_path_refuses_a_question_flagged_twice(monkeypatch):
    prompts = []
    monkeypatch.setattr(claude, "_call_primary_model_sync", _fake_sync_model([REFUSED], prompts))
    result = claude.ask_claude("Who was King David?", [], [], web_search=False)
    assert len(prompts) == 2
    assert str(result.get("error") or "").startswith("security_blocked")


def test_a_second_look_that_fails_keeps_the_first_refusal(monkeypatch):
    prompts = []
    monkeypatch.setattr(claude, "_call_primary_model_sync", _fake_sync_model([REFUSED, "anthropic_circuit_open"], prompts))
    result = claude.ask_claude("Who was King David?", [], [], web_search=False)
    assert str(result.get("error") or "").startswith("security_blocked")


def test_no_second_look_when_the_time_budget_is_nearly_spent(monkeypatch):
    prompts = []
    monkeypatch.setattr(claude, "_call_primary_model_sync", _fake_sync_model([REFUSED, ANSWERED], prompts))
    monkeypatch.setattr(claude, "_second_look_budget_left", lambda started: False)
    result = claude.ask_claude("Who was King David?", [], [], web_search=False)
    assert len(prompts) == 1
    assert str(result.get("error") or "").startswith("security_blocked")


def test_the_async_path_keeps_the_first_refusal_when_the_second_look_fails(monkeypatch):
    prompts = []
    async def gemini(prompt, dynamic_system_context="", is_simple=False, history_turns=None, max_tokens=None):
        prompts.append(prompt)
        if len(prompts) == 1:
            return {"answer": "x", "structured": REFUSED, "is_fallback": False}
        return {"answer": "", "error": "anthropic_circuit_open", "is_fallback": True}
    async def anthropic(prompt, dynamic_system_context="", gemini_error="", history_turns=None, max_tokens=None):
        return {"answer": "", "error": "anthropic_circuit_open", "is_fallback": True}
    monkeypatch.setattr(claude, "_call_gemini_httpx_model", gemini)
    monkeypatch.setattr(claude, "_call_anthropic_httpx_model", anthropic)
    result = asyncio.run(claude.ask_ai_async("Who was King David?", [], [], web_search=False))
    assert str(result.get("error") or "").startswith("security_blocked")


@pytest.mark.parametrize("question", ["what about football?", "and for a movie?", "for a movie?", "in a novel?"])
def test_a_short_follow_up_in_a_thread_passes_the_keyword_gate(question):
    assert claude._detect_off_topic_subject(question, in_thread=True) is None


def test_a_long_question_that_only_starts_like_a_follow_up_is_still_refused_in_a_thread():
    assert claude._detect_off_topic_subject("In the novel Emma, who is Harriet?", in_thread=True) == "Literature and creative writing"


@pytest.mark.parametrize("question", [
    "Can I pay the loan in full before Shabbat?",
    "Is a pit that is deeper than ten handbreadths a private domain?",
])
def test_ordinary_wording_is_not_a_request_for_a_long_answer(question):
    assert claude.question_profile(question)[2] < claude.LONG_ANSWER_MAX_TOKENS


@pytest.mark.parametrize("question", ["Explain the laws of Shabbat in full.", "deeper", "Go deeper please"])
def test_a_plain_request_for_length_still_gets_a_long_answer(question):
    assert claude.question_profile(question)[2] >= claude.LONG_ANSWER_MAX_TOKENS
