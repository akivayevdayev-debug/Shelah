"""The answer style is plain language (docs/evals/2026-10-22-plain-language.md)."""

import pytest

from backend import claude


@pytest.mark.parametrize("prompt", [claude.CORE_SYSTEM_PROMPT, claude.SIMPLE_SYSTEM_PROMPT])
def test_both_system_prompts_ask_for_plain_language(prompt):
    assert "Style" in prompt
    assert "first time" in prompt
    assert "Onkelos" in prompt
    assert "Unkelus" not in prompt.replace('(never "Unkelus")', "")


def test_the_core_style_paragraph_names_the_words_to_avoid_and_the_sentence_size():
    core = claude.CORE_SYSTEM_PROMPT
    assert "under 25 words" in core
    for word in ("moreover", "furthermore", "pertains to"):
        assert f'"{word}"' in core
    assert "Shabbat (not \"Shabbos\")" in core


def test_the_style_paragraph_is_before_the_answer_shapes():
    core = claude.CORE_SYSTEM_PROMPT
    assert core.index("Style (plain language)") < core.index("What is being asked")
