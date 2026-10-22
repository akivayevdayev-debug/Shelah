"""Word meaning (/api/word/meaning) answered from Sefaria's lexicons.

The fixture holds Sefaria's real lexicon answers for eleven words (read with
GET, trimmed to the keys the code uses): Klein, BDB and Jastrow entries, plus
the Ben Yehuda prose that used to be shown as the meaning. The tests pin what a
reader now sees for each word: a short English gloss, never prose, never
commentary, never a machine translation, and nothing when the lexicon has no
entry.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import unquote

import pytest

import backend.helpers as helpers

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "sefaria_lexicon_words.json").read_text(encoding="utf-8"))


class _Response:
    def __init__(self, payload):
        self._payload = payload
        self.ok = payload is not None
        self.content = b"[]" if payload is not None else b""

    def json(self):
        return self._payload


@pytest.fixture
def lexicon(monkeypatch):
    """Sefaria's lexicon endpoint, answered from the fixture; any word the
    fixture does not hold has no entry. Records the words asked for."""
    asked = []

    def fake_get(url, **kwargs):
        word = unquote(url.rsplit("/", 1)[-1])
        asked.append(word)
        return _Response(FIXTURE.get(word, []))

    helpers.TRANSLATION_CACHE.clear()
    helpers.TRANSLATION_SOURCE_CACHE.clear()
    monkeypatch.setattr(helpers._requests, "get", fake_get)

    def forbid_translation(*args, **kwargs):
        raise AssertionError("a word meaning must not be machine-translated")

    monkeypatch.setattr(helpers, "_translate_hebrew_text_online", forbid_translation)
    yield asked
    helpers.TRANSLATION_CACHE.clear()
    helpers.TRANSLATION_SOURCE_CACHE.clear()


# word as selected in the reader (vowel points and all) -> the meaning shown
EXPECTED = [
    ("בְּרֵאשִׁית", "Genesis — name of the first book of the Pentateuch"),
    ("אֱלֹהִים", "gods"),
    ("הַשָּׁמַיִם", "visible heavens, sky"),
    ("וְהָאָרֶץ", "earth"),
    ("בָּרָא", "create"),
    ("מֶלֶךְ", "king, sovereign"),
    ("ושמרו", "to keep, to heed, watch over, guard, to observe"),
    ("כִּי", "that"),
    ("אשר", "who, which, that, that which"),
    ("בְּרִית", "covenant, treaty, alliance"),
    ("אדון", "lord, master, possessor"),
]
LEXICONS = {"Klein Dictionary", "BDB Augmented Strong", "Jastrow Dictionary", "BDB Dictionary"}


def _ask(test_client, word):
    return test_client.get("/api/word/meaning", query_string={"word": word}).get_json()


@pytest.mark.parametrize(("word", "meaning"), EXPECTED)
def test_the_reader_is_shown_a_short_lexicon_gloss(test_client, lexicon, word, meaning):
    body = _ask(test_client, word)
    assert body["status"] == "ok"
    assert body["meaning"] == meaning
    assert body["source"] in LEXICONS
    assert body["machine_translated"] is False
    for option in body["alternatives"]:
        assert len(option) <= helpers.LEXICON_GLOSS_MAX_CHARS
        assert not re.search(r"<[^>]+>|&\w+;|[א-ת]", option)


def test_a_pointed_word_is_matched_to_the_entry_pointed_the_same_way(lexicon):
    # בָּרָא "he created" and בְּרָא "son" share their letters; Sefaria lists "son" first.
    created, lexicon_name = helpers._lookup_sefaria_lexicon_glosses("בָּרָא")
    assert created[0] == "to create, shape, form; to be fat"
    assert lexicon_name == "BDB Augmented Strong"
    son, lexicon_name = helpers._lookup_sefaria_lexicon_glosses("בְּרָא")
    assert son[0] == "son"
    assert lexicon_name == "Klein Dictionary"
    assert helpers._lookup_sefaria_lexicon_glosses("ברא")[0][0] == "son"


def test_a_pointing_the_lexicon_does_not_have_falls_back_to_the_letters(lexicon):
    glosses, lexicon_name = helpers._lookup_sefaria_lexicon_glosses("מֻלֻךְ")
    assert glosses[0] == "king, sovereign"
    assert lexicon_name == "Klein Dictionary"


def test_a_word_with_no_entry_is_not_found_and_never_translated(lexicon):
    assert helpers._lookup_hebrew_word_meaning("זזזזזז") == ("", "")


def test_the_base_form_is_tried_after_the_prefix_and_ending_come_off(lexicon):
    meaning, _ = helpers._lookup_hebrew_word_meaning("ושמרו")
    assert meaning.startswith("to keep")
    # The written form first, then without the prefix, then without the ending.
    assert lexicon[0] == "ושמרו"
    assert "שמר" in lexicon


def test_a_homograph_is_offered_as_another_option_not_as_the_meaning(lexicon):
    alternatives = helpers._collect_word_meaning_alternatives("ברית", "covenant, treaty, alliance", True)
    assert alternatives[0] == "covenant, treaty, alliance"
    assert "lye; soap" in alternatives
    assert len(alternatives) <= 3


def test_an_ordinary_english_gloss_is_not_mistaken_for_a_transliteration(monkeypatch):
    monkeypatch.setattr(helpers, "_lookup_sefaria_lexicon_glosses", lambda word: (["sheep", "week", "three"], "Klein Dictionary"))
    alternatives = helpers._collect_word_meaning_alternatives("שה", "sheep", True)
    assert alternatives == ["sheep", "week", "three"]


# ── the route ────────────────────────────────────────────────────────────────


def test_route_answers_with_the_gloss_and_its_source(test_client, lexicon):
    response = test_client.get("/api/word/meaning?word=%D7%9E%D7%9C%D7%9A")
    body = response.get_json()
    assert response.status_code == 200
    assert body["status"] == "ok"
    assert body["meaning"] == "king, sovereign"
    assert body["source"] == "Klein Dictionary"
    assert body["machine_translated"] is False
    assert body["alternatives"][0] == "king, sovereign"


def test_route_reports_not_found_for_a_word_the_lexicon_lacks(test_client, lexicon):
    response = test_client.get("/api/word/meaning?word=%D7%96%D7%96%D7%96%D7%96%D7%96")
    body = response.get_json()
    assert response.status_code == 404
    assert body["status"] == "not_found"
    assert body["meaning"] == ""
    assert body["alternatives"] == []


# ── cleaning ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "dense", "clean"),
    [
        ("<b>peace</b>, welfare", False, "peace, welfare"),
        ("love &amp; affection", False, "love & affection"),
        ("king (of Israel), ruler", False, "king, ruler"),
        ("n.m. covenant; treaty, alliance", True, "covenant"),
        ("v. intr. to rest — cease", True, "to rest"),
        ("First sentence. Second sentence.", False, "First sentence"),
        ("= שמר", False, ""),
        ("see שמר", False, ""),
        ("prefix meaning in", False, ""),
        ("שלום עליכם", False, ""),
        ("", False, ""),
    ],
)
def test_clean_lexicon_gloss(raw, dense, clean):
    assert helpers._clean_lexicon_gloss(raw, dense) == clean


def test_a_long_gloss_is_cut_at_a_word_boundary():
    gloss = helpers._clean_lexicon_gloss("word " * 60)
    assert len(gloss) <= helpers.LEXICON_GLOSS_MAX_CHARS
    assert gloss.endswith("word")


def test_a_gloss_joins_at_most_three_distinct_senses():
    entry = {"content": {"senses": [{"definition": d} for d in ["that", "because", "That", "when", "while"]]}}
    assert helpers._gloss_from_lexicon_entry(entry, False) == "that; because; when"


def test_a_gloss_that_would_be_too_long_drops_whole_senses():
    entry = {"content": {"senses": [{"definition": "a" * 50}, {"definition": "b" * 50}]}}
    assert helpers._gloss_from_lexicon_entry(entry, False) == "a" * 50


def test_an_entry_without_senses_has_no_gloss():
    assert helpers._gloss_from_lexicon_entry({"content": {"definition": ["prose"]}}, False) == ""
    assert helpers._gloss_from_lexicon_entry(None, False) == ""


# ── forms of a word ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("word", "variants"),
    [
        ("וְהָאָרֶץ", ["והארץ", "הארץ", "ארץ"]),
        ("ושמרו", ["ושמרו", "ושמר", "שמרו", "שמר", "מרו", "מר"]),
        ("הַשָּׁמַיִם", ["השמים", "השמ", "שמים", "שמ", "מים"]),
        ("וַיֹּאמֶר", ["ויאמר", "יאמר", "אמר"]),
        ("ימים", ["ימים", "ימ"]),
        ("וְאָהַבְתָּ", ["ואהבת", "ואהב", "אהבת", "אהב", "הבת"]),
        ("מְאֹדֶךָ", ["מאדך", "מאד", "אדך", "אד"]),
        ("", []),
        ("hello", []),
    ],
)
def test_hebrew_word_variants(word, variants):
    assert helpers._hebrew_word_variants(word) == variants


def test_a_phrase_is_tried_whole_then_word_by_word():
    variants = helpers._hebrew_word_variants("בראשית ברא")
    assert variants[0] == "בראשית ברא"
    assert variants[1] == "בראשית"
    assert "ברא" in variants
    assert len(variants) <= 8


@pytest.mark.parametrize(("word", "meaning"), [("ויאמר", "And he said."), ("ויהי", "And it was.")])
def test_the_commonest_narrative_words_are_in_the_glossary(lexicon, word, meaning):
    assert helpers._lookup_hebrew_word_meaning(word) == (meaning, "local-hebrew-glossary")
