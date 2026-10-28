"""Questions the AI has answered wrong, or could, each with the sources a
right answer rests on (the ``accuracy`` suite of scripts/eval_ai_quality.py).

Grading is plain code, no judge model:

* ``retrieved``: a required source reached the model (the /ask context's
  primary sources).
* ``cited``: the answer cites a required source.
* ``bad_citations``: cited sources the case rules out (a known wrong source).
* ``bad_claims``: wording the case rules out ("appears only in ...").

A case passes when a required source is both retrieved and cited and there
is nothing bad. ``also`` lists other good sources: reported, not required.

To add a question a reader flagged as wrong, append a Case. Only list
sources you are sure of: a wrong expectation fails a right answer.

No side effects on import, so tests can load it (tests/test_eval_accuracy_cases.py).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable

# "Appears only in", "exclusively in": a "where is it written" answer that
# claims a single place when there are several.
ONLY_ONE_PLACE = r"\bexclusively\b|\bappears? only\b|\bonly (?:once|in (?:one|this|parashat))\b|\bthe only (?:place|verse|time)\b"


@dataclass(frozen=True)
class Case:
    question: str
    required: tuple[str, ...]  # any one of these
    also: tuple[str, ...] = ()
    banned_refs: tuple[str, ...] = ()  # ref prefixes that must not be cited
    banned_text: str = ""  # regex that must not match the answer
    note: str = ""
    tags: tuple[str, ...] = field(default=())


CASES: tuple[Case, ...] = (
    Case(
        "where else in the torah does it say the land ate the people",
        required=("Numbers 13:32",),
        also=("Leviticus 26:38", "Ezekiel 36:13"),
        banned_text=ONLY_ONE_PLACE,
        note="shelah.org/a/APTbHK5nxUYaEGEGvu42IA answered 'exclusively Parashat Behar' (2026-10-28)",
        tags=("reported",),
    ),
    Case(
        "why is there two books of Samuel",
        required=("Bava Batra 14b", "Bava Batra 15a"),
        banned_refs=("Mishneh Torah, Tefillin",),
        note="same chat: cited MT Tefillin, Mezuzah and the Torah Scroll 7:15",
        tags=("reported",),
    ),
    Case(
        "who wrote the book of Samuel",
        required=("Bava Batra 14b", "Bava Batra 15a"),
        banned_refs=("Mishneh Torah, Tefillin",),
        tags=("reported",),
    ),
    Case(
        "must an adam gadol help with candle lighting",
        required=("Shulchan Arukh, Orach Chayim 250", "Mishneh Torah, Sabbath 30:6", "Shabbat 119a"),
        note="the adam gadol fix (2026-10-27)",
        tags=("reported",),
    ),
    Case(
        "where does the Torah say to honor your father and mother",
        required=("Exodus 20:12", "Deuteronomy 5:16"),
        also=("Leviticus 19:3",),
        banned_text=ONLY_ONE_PLACE,
    ),
    Case(
        "where in the Torah is the mitzvah of tzitzit",
        required=("Numbers 15:38", "Numbers 15:39", "Deuteronomy 22:12"),
    ),
    Case(
        "where does the Torah say not to cook a kid in its mother's milk",
        required=("Exodus 23:19", "Exodus 34:26", "Deuteronomy 14:21"),
        banned_text=ONLY_ONE_PLACE,
    ),
    Case(
        "where does it say love your neighbor as yourself",
        required=("Leviticus 19:18",),
    ),
    Case(
        "who wrote the book of Psalms according to the Talmud",
        required=("Bava Batra 14b", "Bava Batra 15a"),
    ),
    Case(
        "where does it say that Moshe hit the rock",
        required=("Numbers 20:11",),
        also=("Exodus 17:6",),
    ),
    Case(
        "where in the Talmud is the mitzvah of lighting Chanukah candles",
        required=("Shabbat 21b", "Shabbat 22a", "Shabbat 23a"),
    ),
    Case(
        "how long do I wait between meat and milk",
        required=("Chullin 105a", "Shulchan Arukh, Yoreh De'ah 89"),
    ),
    Case(
        "where is the story of Chana praying for a son",
        required=("1 Samuel 1",),
    ),
)

# ── refs ─────────────────────────────────────────────────────────────────────

# "Title 13:32", "Title 14b:3-5", "Title 250:1", "Title 13" (a whole chapter).
_REF_RE = re.compile(r"^(?P<title>.+?)[ .](?P<section>\d+[ab]?)(?:[:.](?P<start>\d+))?(?:-(?P<end>[\d:ab]+))?$")


def _parts(ref: str) -> tuple[str, str, int | None, int | None] | None:
    text = re.sub(r"\s+", " ", str(ref or "").replace("_", " ")).strip()
    # A cited source may carry a note after the ref: "Numbers 13:32 (the spies)".
    text = re.split(r"\s[(\u2014\u2013]|\s-\s|;", text)[0].strip().rstrip(".,")
    # Sefaria writes "I Samuel", "II Kings"; people write "1 Samuel".
    text = re.sub(r"^(I{1,2})\s", lambda m: f"{len(m.group(1))} ", text)
    found = _REF_RE.match(text)
    if not found:
        return None
    start = int(found["start"]) if found["start"] else None
    end = found["end"]
    stop = int(end) if end and end.isdigit() and start is not None else start
    return found["title"].casefold().rstrip(","), found["section"].casefold(), start, stop


def ref_matches(expected: str, got: str) -> bool:
    """Whether source ``got`` covers ``expected``: same work and chapter (or
    daf), and the verse in range when both name one. A whole chapter covers
    any verse in it; "1 Samuel 1" is covered by any verse of chapter 1."""
    want, have = _parts(expected), _parts(got)
    if not want or not have or want[:2] != have[:2]:
        return False
    if want[2] is None or have[2] is None:
        return True
    return have[2] <= want[2] <= (have[3] or have[2])


def _ref_of(item: Any) -> str:
    if isinstance(item, dict):
        for key in ("ref", "title", "label", "source"):
            if item.get(key):
                return str(item[key])
        return ""
    return str(item or "")


def refs_of(items: Iterable[Any]) -> list[str]:
    """The ref strings in a list of sources (strings, or dicts with a ``ref``)."""
    return [ref for ref in (_ref_of(item) for item in items or []) if ref]


def _found(wanted: Iterable[str], refs: list[str]) -> list[str]:
    return [want for want in wanted if any(ref_matches(want, ref) for ref in refs)]


def grade(case: Case, retrieved: Iterable[Any], cited: Iterable[Any], answer: str = "") -> dict[str, Any]:
    """One case's verdict (see the module docstring)."""
    retrieved_refs, cited_refs = refs_of(retrieved), refs_of(cited)
    bad_citations = [ref for ref in cited_refs
                     if any(ref.replace("_", " ").casefold().startswith(b.casefold()) for b in case.banned_refs)]
    bad_claim = re.search(case.banned_text, answer or "", re.IGNORECASE) if case.banned_text else None
    row = {
        "retrieved": bool(_found(case.required, retrieved_refs)),
        "cited": bool(_found(case.required, cited_refs)),
        "also_cited": _found(case.also, cited_refs),
        "bad_citations": bad_citations,
        "bad_claim": answer[max(0, bad_claim.start() - 80):bad_claim.end() + 60] if bad_claim else "",
    }
    row["passed"] = row["retrieved"] and row["cited"] and not bad_citations and not row["bad_claim"]
    return row


def grade_retrieval(case: Case, retrieved: Iterable[Any]) -> dict[str, Any]:
    """The retrieval half alone, for a run that skips the answer model."""
    found = bool(_found(case.required, refs_of(retrieved)))
    return {"retrieved": found, "passed": found}
