"""A reader who asks for a long answer gets one (docs/evals/2026-10-22-long-answers.md).

Three controls used to disagree: a request of twelve words or fewer was "simple"
(768 tokens, "2-5 sentences, no headings"), the model call only received the
study ceiling, and nothing told the model that an explicit request for length
outweighs "answer at the size it was asked". Follow-ups such as "go deeper" or
"answer in a long answer" are five words long, so they always lost.
"""

import asyncio

import pytest

from backend import claude

LONG_REQUESTS = [
    "Explain in depth the laws of lighting Shabbat candles.",
    "explain in more depth",
    "answer in a long answer",
    "Give me a long answer: why do we dip the bread in salt?",
    "in extreme detail with commentary",
    "go deeper into pesukim 1-3",
    "Elaborate on the meaning of Yom Kippur",
    "Describe the Pesach seder in great detail.",
    "tell me more",
    "more",
    "I want a detailed explanation of the Omer",
    "Discuss tzedakah at length",
    "תסביר בהרחבה את הלכות ברכת המזון",
    "הסבר מפורט על ראש השנה",
    "תשובה ארוכה בבקשה",
    "what does rashi, unkelus, and ibin ezra really say in their whole commentary",
    "give me the pasuk by pasuk translation of Bamidbar 12",
    "Go through Genesis 1 verse-by-verse",
    "tell me everything about Sukkot",
]
ORDINARY = [
    "Can I eat before Kiddush?",
    "How long do I wait between meat and milk?",
    "What is the deep meaning of tefillin?",
    "How deep is a mikveh?",
    "Why do we cover the challah?",
    "Explain the blessing on bread",
    "What is the longest day of the year?",
    "מה הברכה על בננה?",
    "Is everything in this store kosher?",
    "Which verse is the Shema?",
    "",
]


@pytest.mark.parametrize("question", LONG_REQUESTS)
def test_a_request_for_length_is_recognised(question):
    assert claude.wants_long_answer(question)


@pytest.mark.parametrize("question", ORDINARY)
def test_an_ordinary_question_is_not_a_request_for_length(question):
    assert not claude.wants_long_answer(question)


@pytest.mark.parametrize("question", LONG_REQUESTS)
def test_a_request_for_length_is_never_simple_and_gets_the_long_ceiling(question):
    is_simple, is_study, ceiling = claude.question_profile(question)
    assert is_simple is False
    assert ceiling >= claude.LONG_ANSWER_MAX_TOKENS
    if not is_study:
        assert ceiling == claude.LONG_ANSWER_MAX_TOKENS


def test_an_ordinary_short_question_keeps_the_small_ceiling():
    assert claude.question_profile("Can I eat before Kiddush?") == (True, False, claude.SIMPLE_ANSWER_MAX_TOKENS)


def test_a_study_request_that_also_asks_for_length_keeps_the_study_ceiling():
    profile = claude.question_profile("Give me a learning guide to Bamidbar 12 in great detail")
    assert profile == (False, True, claude.STUDY_ANSWER_MAX_TOKENS)


def test_the_prompt_for_a_long_request_asks_for_a_long_answer_not_a_paragraph():
    prompt = claude.build_prompt("Explain in depth the laws of lighting Shabbat candles.", [], [])
    assert "LONG ANSWER FORMAT" in prompt
    assert f"at least {claude.LONG_ANSWER_MIN_WORDS} words" in prompt
    assert "SIMPLE QUESTION FORMAT" not in prompt
    assert "a few sentences is not an acceptable answer" in prompt


def test_the_prompt_for_an_everyday_question_is_still_short():
    prompt = claude.build_prompt("Can I eat before Kiddush?", [], [])
    assert "SIMPLE QUESTION FORMAT" in prompt
    assert "LONG ANSWER FORMAT" not in prompt


def test_a_study_request_that_asks_for_length_gets_the_word_floor_too():
    prompt = claude.build_prompt("Give me a learning guide to Bamidbar 12 in great detail", [], [])
    assert "STUDY FORMAT" in prompt
    assert f"write at least {claude.LONG_ANSWER_MIN_WORDS} words" in prompt


def test_a_bare_follow_up_for_length_is_about_the_subject_of_the_last_answer():
    history = [
        {"role": "user", "content": "What is Sukkot?"},
        {"role": "assistant", "content": "Sukkot is the autumn festival."},
    ]
    prompt = claude.build_prompt("answer in a long answer", [], [], conversation_history=history, history_as_turns=True)
    assert "LONG ANSWER FORMAT" in prompt
    assert "never treat it as out of scope or as an empty question" in prompt


def test_the_system_prompt_lets_an_explicit_request_for_length_outweigh_the_default():
    assert "outweighs the default" in claude.CORE_SYSTEM_PROMPT


def test_the_ceiling_reaches_the_model_calls():
    assert claude._model_call_extras([], claude.LONG_ANSWER_MAX_TOKENS) == {"max_tokens": claude.LONG_ANSWER_MAX_TOKENS}
    assert claude._model_call_extras([], claude.STUDY_ANSWER_MAX_TOKENS) == {"max_tokens": claude.STUDY_ANSWER_MAX_TOKENS}
    assert claude._model_call_extras([], claude.COMPLEX_ANSWER_MAX_TOKENS) == {}


def test_both_providers_are_given_the_long_ceiling_for_a_follow_up(monkeypatch):
    """Gemini first, then (when it errors) the Claude fallback, each with the
    long ceiling and the thread's earlier turns."""
    seen = []

    async def gemini(prompt, dynamic_system_context="", is_simple=False, history_turns=None, max_tokens=None):
        seen.append(("gemini", is_simple, max_tokens, bool(history_turns)))
        return {"answer": "", "error": "gemini_sdk_error: down", "is_fallback": True}

    async def anthropic(prompt, dynamic_system_context="", gemini_error="", history_turns=None, max_tokens=None):
        seen.append(("claude", None, max_tokens, bool(history_turns)))
        return {"answer": '{"ruling": "A long answer."}', "structured": {"ruling": "A long answer.", "sources": []},
                "is_fallback": False}

    monkeypatch.setattr(claude, "_call_gemini_httpx_model", gemini)
    monkeypatch.setattr(claude, "_call_anthropic_httpx_model", anthropic)
    history = [
        {"role": "user", "content": "What is Sukkot?"},
        {"role": "assistant", "content": "Sukkot is the autumn festival."},
    ]
    asyncio.run(claude.ask_ai_async(
        "answer in a long answer", [], [], conversation_history=history, web_search=False))
    assert seen == [
        ("gemini", False, claude.LONG_ANSWER_MAX_TOKENS, True),
        ("claude", None, claude.LONG_ANSWER_MAX_TOKENS, True),
    ]


def test_a_long_answer_is_still_seen_whole_by_its_follow_up():
    answer = "A full paragraph about the verse and what Rashi says about it. " * 66
    assert 2400 < len(answer) < claude.HISTORY_ASSISTANT_TURN_CHARS
    turns = claude.build_history_turns([
        {"role": "user", "content": "Explain Numbers 12 in depth"},
        {"role": "assistant", "content": answer},
    ])
    assert answer.strip() in turns[1]["text"]
