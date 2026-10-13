"""
The weekly portion a Chumash reference falls in, for a text page's heading.

The reader titles a Torah chapter "Genesis 1 · Parashat Bereshit"
(static/js/hebrew-ref.js parashaLabel). A server-rendered /text/ page
(backend/text_ssr.py) has to open with that same heading, or the centred title
changes width the moment the app boots and the whole page shifts sideways. The
portion table has one home, that file; this module reads it from there rather
than keeping a second copy, and tests/test_parasha.py checks every answer here
against the script's own.
"""

import re
from functools import lru_cache
from pathlib import Path

_SOURCE = Path(__file__).resolve().parent.parent / "static" / "js" / "hebrew-ref.js"
_ROW_RE = re.compile(r"\[\s*'(\w+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']+)'\s*,\s*'[^']+'\s*\]")
_REF_RE = re.compile(r"^(Genesis|Exodus|Leviticus|Numbers|Deuteronomy) (\d+)(?:[ :](\d+))?(?:-.*)?$", re.IGNORECASE)
_TORAH_BOOKS = ("Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy")


@lru_cache(maxsize=1)
def _portions():
    """[(book, chapter, verse, English name)] in Torah order, or () when the
    table cannot be read (the heading then simply has no portion)."""
    try:
        source = _SOURCE.read_text(encoding="utf-8")
    except OSError:
        return ()
    table = source.split("const PARASHOT = [", 1)[-1].split("].map(", 1)[0]
    return tuple(
        (book, int(chapter), int(verse), name)
        for book, chapter, verse, name in _ROW_RE.findall(table)
        if book in _TORAH_BOOKS
    )


def _parse(ref):
    text = re.sub(r"\s+", " ", re.sub(r"[._]", " ", str(ref or ""))).strip()
    match = _REF_RE.match(text)
    if not match:
        return None
    book = next(name for name in _TORAH_BOOKS if name.lower() == match.group(1).lower())
    return book, int(match.group(2)), int(match.group(3)) if match.group(3) else None


def _starts_at_or_before(entry, chapter, verse):
    return entry[1] < chapter or (entry[1] == chapter and entry[2] <= verse)


def _portion_at(book, chapter, verse):
    found = None
    for entry in _portions():
        if entry[0] != book:
            continue
        if not _starts_at_or_before(entry, chapter, verse):
            break
        found = entry
    return found


def label(ref):
    """"Parashat Naso", "Parashot Bamidbar–Naso" for a chapter split between
    two portions, or "" outside the Chumash."""
    parsed = _parse(ref)
    if not parsed:
        return ""
    book, chapter, verse = parsed
    if verse:
        entries = [_portion_at(book, chapter, verse)]
    else:
        later = [e for e in _portions() if e[0] == book and e[1] == chapter and e[2] > 1]
        entries = [_portion_at(book, chapter, 1), *later]
    names = [entry[3] for entry in entries if entry]
    if not names:
        return ""
    return f"Parashot {'–'.join(names)}" if len(names) > 1 else f"Parashat {names[0]}"
