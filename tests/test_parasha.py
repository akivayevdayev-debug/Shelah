"""
backend/parasha.py reads the portion table out of static/js/hebrew-ref.js and
must answer exactly as that script does -- a /text/ page's server-rendered
heading and the one the app sets on boot are the same string only if it does.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from backend import parasha

REPO_ROOT = Path(__file__).resolve().parent.parent
CHUMASH = (("Genesis", 50), ("Exodus", 40), ("Leviticus", 27), ("Numbers", 36), ("Deuteronomy", 34))


def _refs():
    refs = [f"{book} {chapter}" for book, chapters in CHUMASH for chapter in range(1, chapters + 1)]
    refs += [
        "Numbers 4:21", "Numbers 4:20", "Genesis 6:9", "Genesis 6:8", "Genesis 1:1", "Exodus 6:2", "Exodus 6:1",
        "Numbers 4:21-7:89", "Genesis 1-2", "genesis 1", "Genesis.1", "Genesis_6_9", "  Genesis   6  ",
        "Deuteronomy 33:1", "Deuteronomy 34:12",
        "Isaiah 1", "Psalms 23", "Berakhot 2a", "Genesis", "Genesis x", "", "Shulchan Arukh, Orach Chayim 345:1",
    ]
    return refs


def test_the_whole_table_is_read():
    assert len(parasha._portions()) == 54
    assert parasha._portions()[0] == ("Genesis", 1, 1, "Bereshit")
    assert parasha._portions()[-1] == ("Deuteronomy", 33, 1, "Vezot Haberakhah")


@pytest.mark.parametrize("ref, expected", [
    ("Genesis 1", "Parashat Bereshit"),
    ("Numbers 4", "Parashot Bamidbar–Naso"),
    ("Numbers 4:21", "Parashat Naso"),
    ("Genesis.6.9", "Parashat Noach"),
    ("Isaiah 1", ""),
    ("Genesis", ""),
])
def test_labels(ref, expected):
    assert parasha.label(ref) == expected


def test_an_unreadable_table_leaves_the_heading_without_a_portion(monkeypatch, tmp_path):
    monkeypatch.setattr(parasha, "_SOURCE", tmp_path / "missing.js")
    parasha._portions.cache_clear()
    try:
        assert parasha.label("Genesis 1") == ""
    finally:
        monkeypatch.undo()
        parasha._portions.cache_clear()


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_every_answer_matches_the_scripts_own():
    refs = _refs()
    script = (
        "const h = require('./static/js/hebrew-ref.js');"
        "const refs = JSON.parse(process.argv[1]);"
        "process.stdout.write(JSON.stringify(refs.map((r) => h.parashaLabel(r, 'en'))));"
    )
    result = subprocess.run(
        ["node", "-e", script, json.dumps(refs)], cwd=REPO_ROOT, capture_output=True, text=True, check=True, timeout=30,
    )
    expected = json.loads(result.stdout)
    assert [parasha.label(ref) for ref in refs] == expected
    assert any(expected), "the comparison would pass vacuously"
