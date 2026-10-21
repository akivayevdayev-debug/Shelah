"""backend/minhag.py: the community setting's values, the haftarah each
community reads (checked against real Hebcal 2026 leyning), and the copy of
the values the browser keeps in static/js/state.js."""

import re
from pathlib import Path

import pytest

from backend import minhag

# Real Hebcal leyning (https://www.hebcal.com/hebcal?v=1&cfg=json&year=2026&s=on&leyning=on),
# trimmed to the keys the calendar forwards.
SHEMOT = {  # 2026-01-10: the Sephardi haftarah differs
    "torah": "Exodus 1:1-6:1",
    "haftarah": "Isaiah 27:6-28:13, 29:22-23",
    "haftarah_sephardic": "Jeremiah 1:1-2:3",
    "maftir": "Exodus 5:22-6:1",
}
NOACH = {  # 2026-10-17: Sephardim read a shorter haftarah
    "torah": "Genesis 6:9-11:32",
    "haftarah": "Isaiah 54:1-55:5",
    "haftarah_sephardic": "Isaiah 54:1-10",
    "maftir": "Genesis 11:29-11:32",
}
VAYETZEI = {  # 2026-11-21: a different passage altogether
    "torah": "Genesis 28:10-32:3",
    "haftarah": "Hosea 12:13-14:10",
    "haftarah_sephardic": "Hosea 11:7-12:12",
    "maftir": "Genesis 32:1-32:3",
}
VAERA = {  # 2026-01-17: the same for everyone, so Hebcal has no Sephardi key
    "torah": "Exodus 6:2-9:35",
    "haftarah": "Ezekiel 28:25-29:21",
    "maftir": "Exodus 9:33-9:35",
}


@pytest.mark.parametrize("week, sephardi, ashkenazi", [
    (SHEMOT, "Jeremiah 1:1-2:3", "Isaiah 27:6-28:13, 29:22-23"),
    (NOACH, "Isaiah 54:1-10", "Isaiah 54:1-55:5"),
    (VAYETZEI, "Hosea 11:7-12:12", "Hosea 12:13-14:10"),
    (VAERA, "Ezekiel 28:25-29:21", "Ezekiel 28:25-29:21"),
])
def test_haftarah_follows_the_community(week, sephardi, ashkenazi):
    assert minhag.haftarah_for(week, "sephardi") == sephardi
    assert minhag.haftarah_for(week, "mizrahi") == sephardi
    assert minhag.haftarah_for(week, "ashkenazi") == ashkenazi


def test_haftarah_defaults_to_sephardi_for_unknown_or_missing_minhag():
    assert minhag.haftarah_for(VAYETZEI, None) == "Hosea 11:7-12:12"
    assert minhag.haftarah_for(VAYETZEI, "chabad") == "Hosea 11:7-12:12"


def test_haftarah_ignores_blank_sephardi_value_and_bad_input():
    assert minhag.haftarah_for({**VAERA, "haftarah_sephardic": "  "}, "sephardi") == "Ezekiel 28:25-29:21"
    assert minhag.haftarah_for(None, "sephardi") is None
    assert minhag.haftarah_for({}, "ashkenazi") is None


def test_normalize_and_resolve():
    assert minhag.normalize_minhag(" Mizrahi ") == "mizrahi"
    assert minhag.normalize_minhag("sefardi") is None
    assert minhag.resolve_minhag("") == "sephardi"
    assert minhag.DEFAULT_MINHAG == "sephardi"


def test_sefaria_custom_uses_sephardi_for_mizrahi():
    # Sefaria's "edot hamizrach" custom returns the default (Ashkenazi)
    # haftarah, so Mizrahi readers ask for the Sephardi one.
    assert minhag.sefaria_custom("sephardi") == "sephardi"
    assert minhag.sefaria_custom("mizrahi") == "sephardi"
    assert minhag.sefaria_custom("ashkenazi") == "ashkenazi"
    assert minhag.sefaria_custom("x") == "sephardi"


def test_browser_copy_matches():
    source = (Path(__file__).resolve().parent.parent / "static" / "js" / "state.js").read_text(encoding="utf-8")
    match = re.search(r"export const MINHAGIM = Object\.freeze\(\[([^\]]*)\]\)", source)
    assert match, "state.js must export MINHAGIM"
    assert tuple(re.findall(r'"([a-z]+)"', match.group(1))) == minhag.MINHAGIM
    assert f'export const DEFAULT_MINHAG = "{minhag.DEFAULT_MINHAG}"' in source


@pytest.mark.parametrize("text, found", [
    ("On Shabbos and Sukkos we read Toras Moshe.", ["Shabbos", "Sukkos", "Toras"]),
    ("The bris is at the Bais Medrash; emes.", ["bris", "Bais", "emes"]),
    ("SHAVUOS", ["SHAVUOS"]),
    ("On Shabbat, Sukkot and Shavuot, Beit, emet, Torat, berit.", []),
    ("brisket, emesis, Baiser, Shabbosdik", []),
    (None, []),
])
def test_ashkenazi_forms_flags_whole_words_only(text, found):
    assert minhag.ashkenazi_forms(text) == found
