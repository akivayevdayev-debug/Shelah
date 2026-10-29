"""backend/hebrew_terms.py: Hebrew terms in English answers come out as
"HEB (translit, meaning)"."""

import pytest

from backend.hebrew_terms import normalize


@pytest.mark.parametrize("written, expected", [
    ("is borei minei mezonot (בורא מיני מזונות (borei minei mezonot, who creates kinds of food)), said",
     "is בורא מיני מזונות (borei minei mezonot, who creates kinds of food), said"),
    ("it counts as cooking (בישול (bishul)).", "it counts as cooking, בישול (bishul)."),
    ("it takes ha'adamah (האדמה, ha'adamah, the blessing over produce).",
     "it takes האדמה (ha'adamah, the blessing over produce)."),
    ("under mezonot (מזונות, mezonot, the grain blessing).", "under מזונות (mezonot, the grain blessing)."),
])
def test_near_misses_are_put_in_the_asked_form(written, expected):
    assert normalize(written) == expected


@pytest.mark.parametrize("written", [
    "It is מוקצה (muktzeh, an object you may not move on Shabbat).",
    "the bracha of hagafen (בורא פרי הגפן, who creates the fruit of the vine)",
    "do netilat yadayim (נטילת ידיים, washing hands) first.",
    "Say the blessing (ברכה, bracha) first.",
    "Avoid cooking (בישול, bishul) on Shabbat.",
    "We wash hands (נטילת ידיים, netilat yadayim) first.",
    "Rambam (רמב\"ם (Hilchot Shabbat 5:1)) wrote",
    "Rambam (רמב\"ם) wrote",
    "plain English (no Hebrew here)",
    "",
])
def test_everything_else_is_left_as_written(written):
    assert normalize(written) == written


def _validated(language):
    from backend import claude
    result = {
        "answer": "it takes ha'adamah (האדמה, ha'adamah, produce).",
        "structured": {"ruling": "it takes ha'adamah (האדמה, ha'adamah, produce).", "sources": []},
    }
    return claude.apply_output_validation(result, {"blocked": False}, language, "ok")


def test_an_english_answers_ruling_is_normalized():
    assert _validated("en")["structured"]["ruling"] == "it takes האדמה (ha'adamah, produce)."


def test_a_hebrew_answer_is_left_as_written():
    assert _validated("he")["structured"]["ruling"] == "it takes ha'adamah (האדמה, ha'adamah, produce)."


def test_a_long_run_of_words_is_scanned_quickly():
    import time
    text = "word " * 5000 + "(ברכה, bracha)"
    started = time.monotonic()
    normalize(text)
    assert time.monotonic() - started < 0.2
