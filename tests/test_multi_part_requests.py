"""Requests with several parts, or that ask for something to be written, get
room for every part instead of the short format."""

import pytest

from backend import claude


@pytest.mark.parametrize("question", [
    "Write a short poem for Shabbat about rest.",
    "Recommend five books for a beginner who wants to learn about Judaism.",
    "Can I use an electric toothbrush on Shabbat, and what about toothpaste?",
    "What are the 39 melachot of Shabbat? List them all with an example of each.",
    "Who were the Beta Israel, how did they come to Israel, and what is the Sigd?",
    "What are the differences between Ashkenazi and Sephardi customs for Pesach, weddings and mourning?",
    "Can you help me write a eulogy for my grandfather?",
])
def test_multi_part_or_task_request_is_not_simple(question):
    assert not claude._is_simple_question(question)


@pytest.mark.parametrize("question", [
    "Is it permitted to write on Shabbat?",
    "Can I carry on Shabbat?",
    "What blessing do I say on bread?",
    "On Shabbat, can I open an umbrella?",
])
def test_single_question_stays_simple(question):
    assert claude._is_simple_question(question)


def test_off_topic_refusal_does_not_say_sh_elah_is_only_for_rulings():
    message = claude._off_topic_refusal_message("football", "en")
    assert "everyday Jewish life" in message
