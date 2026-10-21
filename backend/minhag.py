"""The reader's community (minhag) setting: Sephardi, Mizrahi or Ashkenazi.

One small table so the calendar, the preferences API and the tests agree on
the allowed values. The browser keeps its own copy in static/js/state.js
(tests/test_minhag.py compares the two).

Decisions recorded here because the data settled them:

- Haftarah: Hebcal's leyning carries `haftarah_sephardic` only in weeks where
  the Sephardi haftarah differs (Shemot, Noach, Vayetzei, ...). Sephardi and
  Mizrahi readers get it; Ashkenazi readers get `haftarah`.
- Sefaria's calendars API: `custom=sephardi` returns the Sephardi haftarah
  ("Haftarah (S)"), `custom=ashkenazi` the Ashkenazi one. `custom=edot
  hamizrach` returns the default (Ashkenazi) reading, so Mizrahi asks for
  `sephardi` too.
"""

from __future__ import annotations

import re

SEPHARDI = "sephardi"
MIZRAHI = "mizrahi"
ASHKENAZI = "ashkenazi"

MINHAGIM = (SEPHARDI, MIZRAHI, ASHKENAZI)
DEFAULT_MINHAG = SEPHARDI

_SEFARIA_CUSTOM = {SEPHARDI: "sephardi", MIZRAHI: "sephardi", ASHKENAZI: "ashkenazi"}


def normalize_minhag(value) -> str | None:
    """The canonical minhag for `value`, or None when it is not one."""
    key = str(value or "").strip().lower()
    return key if key in MINHAGIM else None


def resolve_minhag(value) -> str:
    """`value` when it is a minhag, else the default (Sephardi)."""
    return normalize_minhag(value) or DEFAULT_MINHAG


def follows_sephardi_haftarah(minhag) -> bool:
    return resolve_minhag(minhag) != ASHKENAZI


def haftarah_for(leyning, minhag) -> str | None:
    """The haftarah this community reads from one Hebcal `leyning` object."""
    if not isinstance(leyning, dict):
        return None
    if follows_sephardi_haftarah(minhag):
        sephardic = leyning.get("haftarah_sephardic")
        if isinstance(sephardic, str) and sephardic.strip():
            return sephardic.strip()
    value = leyning.get("haftarah")
    return value.strip() if isinstance(value, str) and value.strip() else None


def sefaria_custom(minhag) -> str:
    """The `custom` value Sefaria's calendars API takes for this community."""
    return _SEFARIA_CUSTOM[resolve_minhag(minhag)]


# Ashkenazi transliterations a Sephardi or Mizrahi reader's English answer
# should not use (the AI is told the Sephardi forms; docs/evals/ records the
# check). Whole words only, so "brisket" or "emesis" never match.
_ASHKENAZI_FORMS_RE = re.compile(
    r"\b(?:Shabbos|Shabbes|Sukkos|Succos|Shavuos|Bais|emes|Toras|bris)\b",
    re.IGNORECASE,
)


def ashkenazi_forms(text) -> list[str]:
    """The Ashkenazi transliterations in `text`, in order (empty when none)."""
    return _ASHKENAZI_FORMS_RE.findall(str(text or ""))
