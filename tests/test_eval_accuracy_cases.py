"""The accuracy eval's cases and grading (scripts/eval_accuracy_cases.py),
offline: no model, no network."""

import importlib.util
import sys
from pathlib import Path

import pytest

_PATH = Path(__file__).resolve().parent.parent / "scripts" / "eval_accuracy_cases.py"
_SPEC = importlib.util.spec_from_file_location("eval_accuracy_cases", _PATH)
cases = importlib.util.module_from_spec(_SPEC)
sys.modules.setdefault(_SPEC.name, cases)  # dataclasses look their module up here
_SPEC.loader.exec_module(cases)

LAND = cases.CASES[0]  # "the land ate the people": Numbers 13:32
SAMUEL = cases.CASES[1]  # Bava Batra 14b; Mishneh Torah, Tefillin is ruled out


@pytest.mark.parametrize("expected, got", [
    ("Numbers 13:32", "Numbers 13:32"),
    ("Numbers 13:32", "Numbers 13:30-33"),
    ("Numbers 13:32", "Numbers 13"),
    ("1 Samuel 1", "I Samuel 1:11"),
    ("Bava Batra 14b", "Bava Batra 14b:3"),
    ("Numbers 13:32", "Numbers 13:32 (the spies' report)"),
    ("Numbers 13:32", "Numbers_13:32"),
])
def test_a_ref_covers_the_expected_source(expected, got):
    assert cases.ref_matches(expected, got) is True


@pytest.mark.parametrize("expected, got", [
    ("Numbers 13:32", "Numbers 14:32"),
    ("Numbers 13:32", "Numbers 13:1-5"),
    ("Bava Batra 14b", "Bava Batra 15a"),
    ("1 Samuel 1", "2 Samuel 1"),
    ("Numbers 13:32", "not a ref"),
])
def test_a_ref_that_does_not_cover_the_expected_source(expected, got):
    assert cases.ref_matches(expected, got) is False


def test_refs_are_read_from_dicts_and_strings():
    assert cases.refs_of([{"ref": "Numbers 13:32"}, "Leviticus 26:38", {}, ""]) == ["Numbers 13:32", "Leviticus 26:38"]


def test_retrieved_and_cited_passes():
    assert cases.grade(LAND, ["Numbers 13:32"], ["Numbers 13:32"], "It says so.")["passed"] is True


def test_retrieved_but_not_cited_fails():
    assert cases.grade(LAND, ["Numbers 13:32"], ["Leviticus 26:38"])["passed"] is False


def test_a_claim_of_one_place_fails():
    row = cases.grade(LAND, ["Numbers 13:32"], ["Numbers 13:32"], "It appears only in Parashat Behar.")
    assert row["passed"] is False


def test_a_ruled_out_citation_fails():
    row = cases.grade(SAMUEL, ["Bava Batra 14b"], ["Bava Batra 14b", "Mishneh Torah, Tefillin 1:1"])
    assert row["bad_citations"] == ["Mishneh Torah, Tefillin 1:1"]


def test_other_good_sources_are_reported():
    row = cases.grade(LAND, ["Numbers 13:32"], ["Numbers 13:32", "Ezekiel 36:13"])
    assert row["also_cited"] == ["Ezekiel 36:13"]


def test_retrieval_alone_can_pass():
    assert cases.grade_retrieval(LAND, [{"ref": "Numbers 13:32"}])["passed"] is True


def test_every_case_has_a_required_source():
    assert all(case.required for case in cases.CASES)


def test_every_required_source_parses_as_a_ref():
    assert [ref for case in cases.CASES for ref in case.required if cases._parts(ref) is None] == []
