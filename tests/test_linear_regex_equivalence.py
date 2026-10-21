"""The code that replaced the quadratic patterns (python:S8786) must give the answers
of the originals, kept here as oracles, and must not rescan a long run from every
character inside it."""

import random
import re
import time

import pytest

from backend import citation_markers, claude, customs, ref_aliases, retrieval_guard, siddur_lines, text_ssr

_PIECES = [" ", "  ", "\n", "\n\n", "\t", " ", "#", "## ", "x", "ab", "<br>", "—", "–", "(", ")", ";", ",", ":", ".", "!", "...", "'", '"', "R", "Dr"]
_CASES = 4000

_OLD_NEWLINE_SPACE = re.compile(r"\s*\n\s*")
_OLD_NOTE_SPLIT = re.compile(r"\s+[—–]\s+")
_OLD_LAST_WORD = re.compile(r"(\S+)$")
_OLD_AUTHORITY_END = re.compile(r"\s+\(|\s+[—–]\s+|[;:,]\s")
_OLD_BOUNDARY = re.compile(r"[.!?…׃]+[\"'”’)\]]*\s+(?=\S)")
_OLD_PARENTHETICAL = re.compile(r"\s*\(.*?\)\s*")
_OLD_EDGE_BR = re.compile(r"(?:^\s*(?:<br>\s*)+)|(?:(?:<br>\s*)+$)")
_OLD_TRAILING_HEADINGS = re.compile(r"(?:\n+#{1,6}[^\n]*)+\s*$")
_OLD_REF_PREFIX = re.compile(
    r"^\s*(?:(?:Mishneh?\s+Torah|Rambam|Maimonides)\b|(?:Hilchot|Hilchos|Hilkhot|Hilkhoth|Hilcot|Hilchoth|Hil\.?|Laws?\s+of|Halachot|Halakhot)\s)",
    re.IGNORECASE,
)
_OLD_REF = re.compile(
    r"""^\s*
    (?:(?:Mishneh\s+Torah|Mishne\s+Torah|Rambam|Maimonides)\b[\s,.:-]*)?
    (?:(?:Hilchot|Hilchos|Hilkhot|Hilkhoth|Hilcot|Hilchoth|Hil\.?|Laws?\s+of|Halachot|Halakhot)\s+)?
    (?P<name>[A-Za-z'’\- ]+?)
    (?P<rest>[\s,]+\d[\d\s:.,\-–]*)?\s*$""",
    re.IGNORECASE | re.VERBOSE,
)
_OLD_SUP_NOTE = re.compile(r"<sup[^>]*>[\s\S]*?</sup>\s*<(?:i|span|small)[^>]*>[\s\S]*?</(?:i|span|small)>", re.IGNORECASE)
_OLD_FOOTNOTE_TAG = re.compile(r"""<(?:i|span|small)[^>]*class=["'][^"']*footnote[^"']*["'][^>]*>[\s\S]*?</(?:i|span|small)>""", re.IGNORECASE)
_OLD_YIDDISH_IGNORE = re.compile(r"יגנאָר\w{0,30}\s+אלע\s+\w{0,20}\s*אינסטרוקציעס")
_HTML_PIECES = ["<sup>", "<SUP class='n'>", "</sup>", "</Sup>", "<i>", "<I>", "</i>", "<i", "<img src=x>",
                "<span>", "</span>", "<small>", "</small>", "<span ", "<small ", ' class="', " class='", "CLASS=\"",
                "footnote", "FootNote", "foot", "note", '"', "'", ">", "<", " ", "\n", "x", "1", "ab"]


def _html_samples():
    rng = random.Random(20261020)
    for _ in range(_CASES * 5):
        yield "".join(rng.choice(_HTML_PIECES) for _ in range(rng.randint(0, 18)))


def _samples():
    rng = random.Random(20261016)
    for _ in range(_CASES):
        yield "".join(rng.choice(_PIECES) for _ in range(rng.randint(0, 14)))


def test_newline_space_collapses_like_the_original():
    for text in _samples():
        assert text_ssr._BLANK_RUN_RE.sub(text_ssr._newline_if_any, text) == _OLD_NEWLINE_SPACE.sub("\n", text), repr(text)


def test_note_head_matches_the_original():
    for text in _samples():
        assert citation_markers.note_head(text) == _OLD_NOTE_SPLIT.split(text, maxsplit=1)[0], repr(text)


def test_last_word_matches_the_original():
    for text in _samples():
        old = _OLD_LAST_WORD.search(text)
        assert citation_markers._last_word(text) == (old.group(1) if old else ""), repr(text)


def test_authority_name_end_splits_like_the_original():
    for text in _samples():
        new = customs._AUTHORITY_NAME_END_RE.split(text, maxsplit=1)[0].strip()
        assert new == _OLD_AUTHORITY_END.split(text, maxsplit=1)[0].strip(), repr(text)


def _old_sentence_count(span):
    text = span.strip()
    if not text:
        return 0
    count = 1
    for match in _OLD_BOUNDARY.finditer(text):
        word = _OLD_LAST_WORD.search(text[: match.start()])
        previous = word.group(1).strip("([\"'“").lower() if word else ""
        if previous in citation_markers._ABBREVIATIONS or re.fullmatch(r"[a-z]", previous):
            continue
        count += 1
    return count


def test_sentence_count_matches_the_original():
    for text in _samples():
        assert citation_markers._sentence_count(text) == _old_sentence_count(text), repr(text)


def test_sup_notes_strip_like_the_original():
    for text in _html_samples():
        assert text_ssr._strip_sup_notes(text) == _OLD_SUP_NOTE.sub(" ", text), repr(text)


def test_footnote_tags_strip_like_the_original():
    for text in _html_samples():
        assert text_ssr._strip_footnote_tags(text) == _OLD_FOOTNOTE_TAG.sub(" ", text), repr(text)


@pytest.mark.parametrize("text", [
    '<sup>1</sup> <i class="footnote">a note</i> after',
    "<sup>1</sup>x<sup>2</sup><small>n</small>",
    "<span class='x' class=\"footnote\">n</span> tail",
    "<i class=\"footnote\" class='other'>n</i> tail",
    '<span class="footnote">open <i>inner</i> rest</span> tail',
])
def test_footnote_examples_strip_like_the_original(text):
    expected = _OLD_FOOTNOTE_TAG.sub(" ", _OLD_SUP_NOTE.sub(" ", text))
    assert text_ssr._strip_footnote_tags(text_ssr._strip_sup_notes(text)) == expected


def test_yiddish_ignore_pattern_finds_what_the_original_found():
    pieces = ["יגנאָר", "ט", "ן", "אלע", "פריערדיקע", "אינסטרוקציעס", " ", "  ", "\n", "x", "א"]
    pattern = retrieval_guard.RETRIEVED_INJECTION_PATTERNS[-1]
    assert pattern.pattern.startswith("יגנאָר")
    rng = random.Random(20261020)
    for _ in range(_CASES * 5):
        text = "".join(rng.choice(pieces) for _ in range(rng.randint(0, 12)))
        assert [m.group(0) for m in pattern.finditer(text)] == [m.group(0) for m in _OLD_YIDDISH_IGNORE.finditer(text)], repr(text)


def _old_subject_label(subject):
    label = _OLD_PARENTHETICAL.sub(" ", subject)
    label = re.sub(r"[^\w\s,&'’/-]", "", label)
    return re.sub(r"\s+", " ", label).strip()


def test_parentheticals_drop_like_the_original():
    for text in _samples():
        new = re.sub(r"\s+", " ", re.sub(r"[^\w\s,&'’/-]", "", claude._drop_parentheticals(text))).strip()
        assert new == _old_subject_label(text), repr(text)


@pytest.mark.parametrize("text, expected", [
    ("Pure Math (no halachic context)", "pure math"),
    ("a (b) c (d) e", "a c e"),
    ("a ((b) c", "a c"),
    ("a (b\nc) d", "a b c d"),
    ("unclosed (", "unclosed"),
    ("()", "that subject"),
])
def test_subject_label_examples(text, expected):
    assert claude._off_topic_subject_label(text) == expected


def test_edge_brs_trim_like_the_original():
    for text in _samples():
        html = " ".join(text.split(" ")).strip()
        assert siddur_lines._trim_edge_brs(html) == _OLD_EDGE_BR.sub("", html).strip(), repr(html)


def test_trailing_headings_strip_like_the_original():
    for text in _samples():
        assert claude._strip_trailing_headings(text) == _OLD_TRAILING_HEADINGS.sub("", text), repr(text)


def _old_canonical(text):
    text = text.strip()
    if not text or not _OLD_REF_PREFIX.match(text):
        return None
    match = _OLD_REF.match(text)
    if not match:
        return None
    title = ref_aliases._SLUGS.get(ref_aliases._slug(match.group("name")))
    if not title:
        return None
    rest = (match.group("rest") or "").strip(" ,")
    return f"Mishneh Torah, {title}" + (f" {rest}" if rest else "")


def test_mishneh_torah_refs_parse_like_the_original():
    rng = random.Random(7)
    sections = list(ref_aliases._SECTIONS)[:12] + ["Shabbat", "Sabbath", "Berachot"]
    pieces = (["Rambam", "Mishneh Torah", "Mishne Torah", "Maimonides", "Hilchot", "Hil.", "Laws of", "Halachot"] + sections
              + [",", ", ", " ", "  ", "\t", ":", ".", "-", "–", "3", "12", "3:4", "5-6", "'", "’", "x", "٣"])
    for _ in range(40_000):
        text = "".join(rng.choice(pieces) + rng.choice(["", " ", " "]) for _ in range(rng.randint(1, 6)))
        if rng.random() < 0.5:
            text = rng.choice(["Rambam, ", "Mishneh Torah ", "Hilchot ", "Maimonides ", "Laws of "]) + text
        assert ref_aliases.canonical_mishneh_torah_ref(text) == _old_canonical(text), repr(text)


@pytest.mark.parametrize("ref, expected", [
    ("Rambam, Hilchot Shabbat 3:4", "Mishneh Torah, Sabbath 3:4"),
    ("Mishneh Torah Shabbat", "Mishneh Torah, Sabbath"),
    ("Laws of Shabbat 12", "Mishneh Torah, Sabbath 12"),
    ("Shabbat 31b", None),
    ("Rambam", None),
])
def test_mishneh_torah_ref_examples(ref, expected):
    assert ref_aliases.canonical_mishneh_torah_ref(ref) == expected


@pytest.mark.parametrize("text, expected", [
    ("# Title\nAnswer.", "# Title\nAnswer."),
    ("Answer.\n\n## Practical Steps", "Answer."),
    ("Answer.\n## One\n\n### Two\n", "Answer."),
    ("Answer.\n## One\n  \n### Two", "Answer.\n## One\n  "),
    ("# Only a heading\n", "# Only a heading\n"),
])
def test_trailing_headings_examples(text, expected):
    assert claude._strip_trailing_headings(text) == expected


@pytest.mark.parametrize("run", [lambda: text_ssr._BLANK_RUN_RE.sub(text_ssr._newline_if_any, " " * 200_000 + "x"),
                                 lambda: citation_markers.note_head(" " * 200_000 + "x"),
                                 lambda: citation_markers._last_word("x" * 200_000 + " "),
                                 lambda: citation_markers._sentence_count("." * 200_000 + "x"),
                                 lambda: customs._AUTHORITY_NAME_END_RE.split(" " * 200_000 + "x"),
                                 lambda: claude._drop_parentheticals("(" * 200_000),
                                 lambda: ref_aliases._REF_RE.match("Rambam " + " " * 20_000 + "x"),
                                 lambda: siddur_lines._trim_edge_brs("<br> " * 100_000 + "x"),
                                 lambda: claude._strip_trailing_headings("\n# a" * 100_000 + "\nx"),
                                 lambda: text_ssr._strip_sup_notes("<sup>" + "</sup> " * 50_000 + "x"),
                                 lambda: text_ssr._strip_sup_notes("<sup " * 100_000),
                                 lambda: text_ssr._strip_footnote_tags('<i class="' + "footnote " * 50_000 + '">'),
                                 lambda: text_ssr._strip_footnote_tags("<i>" * 100_000)])
def test_long_runs_are_scanned_once(run):
    started = time.perf_counter()
    run()
    assert time.perf_counter() - started < 5
