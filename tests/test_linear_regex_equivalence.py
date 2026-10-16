"""The run-anchored patterns and line walks that replaced the quadratic ones
(python:S8786) must give the answers of the originals, kept here as oracles,
and must not rescan a long run from every character inside it."""

import random
import re
import time

import pytest

from backend import citation_markers, claude, customs, siddur_lines, text_ssr

_PIECES = [" ", "  ", "\n", "\n\n", "\t", " ", "#", "## ", "x", "ab", "<br>", "—", "–", "(", ")", ";", ",", ":"]
_CASES = 4000

_OLD_NEWLINE_SPACE = re.compile(r"\s*\n\s*")
_OLD_NOTE_SPLIT = re.compile(r"\s+[—–]\s+")
_OLD_LAST_WORD = re.compile(r"(\S+)$")
_OLD_AUTHORITY_END = re.compile(r"\s+\(|\s+[—–]\s+|[;:,]\s")
_OLD_EDGE_BR = re.compile(r"(?:^\s*(?:<br>\s*)+)|(?:(?:<br>\s*)+$)")
_OLD_TRAILING_HEADINGS = re.compile(r"(?:\n+#{1,6}[^\n]*)+\s*$")


def _samples():
    rng = random.Random(20261016)
    for _ in range(_CASES):
        yield "".join(rng.choice(_PIECES) for _ in range(rng.randint(0, 14)))


def test_newline_space_collapses_like_the_original():
    for text in _samples():
        assert text_ssr._NEWLINE_SPACE_RE.sub("\n", text) == _OLD_NEWLINE_SPACE.sub("\n", text), repr(text)


def test_note_split_matches_the_original():
    for text in _samples():
        assert citation_markers._NOTE_SPLIT_RE.split(text, maxsplit=1) == _OLD_NOTE_SPLIT.split(text, maxsplit=1), repr(text)


def test_last_word_matches_the_original():
    for text in _samples():
        new, old = citation_markers._LAST_WORD_RE.search(text), _OLD_LAST_WORD.search(text)
        assert (new and new.group(1)) == (old and old.group(1)), repr(text)


def test_authority_name_end_splits_like_the_original():
    for text in _samples():
        assert customs._AUTHORITY_NAME_END_RE.split(text, maxsplit=1) == _OLD_AUTHORITY_END.split(text, maxsplit=1), repr(text)


def test_edge_brs_trim_like_the_original():
    for text in _samples():
        html = " ".join(text.split(" ")).strip()
        assert siddur_lines._trim_edge_brs(html) == _OLD_EDGE_BR.sub("", html).strip(), repr(html)


def test_trailing_headings_strip_like_the_original():
    for text in _samples():
        assert claude._strip_trailing_headings(text) == _OLD_TRAILING_HEADINGS.sub("", text), repr(text)


@pytest.mark.parametrize("text, expected", [
    ("# Title\nAnswer.", "# Title\nAnswer."),
    ("Answer.\n\n## Practical Steps", "Answer."),
    ("Answer.\n## One\n\n### Two\n", "Answer."),
    ("Answer.\n## One\n  \n### Two", "Answer.\n## One\n  "),
    ("# Only a heading\n", "# Only a heading\n"),
])
def test_trailing_headings_examples(text, expected):
    assert claude._strip_trailing_headings(text) == expected


@pytest.mark.parametrize("run", [lambda: text_ssr._NEWLINE_SPACE_RE.sub("\n", " " * 200_000 + "x"),
                                 lambda: citation_markers._NOTE_SPLIT_RE.split(" " * 200_000 + "x"),
                                 lambda: citation_markers._LAST_WORD_RE.search("x" * 200_000 + " "),
                                 lambda: customs._AUTHORITY_NAME_END_RE.split(" " * 200_000 + "x"),
                                 lambda: siddur_lines._trim_edge_brs("<br> " * 100_000 + "x"),
                                 lambda: claude._strip_trailing_headings("\n# a" * 100_000 + "\nx")])
def test_long_runs_are_scanned_once(run):
    started = time.perf_counter()
    run()
    assert time.perf_counter() - started < 5
