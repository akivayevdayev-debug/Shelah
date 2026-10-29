"""
Puts the Hebrew terms of an English answer into the one form the prompt asks
for (backend/claude.py instruction 3): the Hebrew letters, then the
transliteration and meaning in one pair of parentheses:

    בורא מיני מזונות (borei minei mezonot, who creates kinds of food)

The models mostly write that, and now and then one of two near misses, both
seen live:

- nested parentheses:
  "borei minei mezonot (בורא מיני מזונות (borei minei mezonot, ...))"
- the transliteration first, and again inside:
  "ha'adamah (האדמה, ha'adamah, the blessing over produce)"

Only those two shapes are rewritten, and only when the words around the
Hebrew are its transliteration; anything else ("netilat yadayim (נטילת
ידיים, washing hands)", "Rambam (רמב"ם (Hilchot Shabbat 5:1))") is left as
written.
"""

from __future__ import annotations

import re

_HEBREW = r"[א-ת][֑-ׇא-ת׳״'\"\-]*"
_HEBREW_PHRASE = rf"{_HEBREW}(?:[ ־]{_HEBREW})*"
# PRE (HEB (INNER))
_NESTED_RE = re.compile(rf"\(\s*({_HEBREW_PHRASE})\s*\(([^()]+)\)\s*\)")
# (HEB, REST)
_HEBREW_FIRST_IN_PARENS_RE = re.compile(rf"\(\s*({_HEBREW_PHRASE}),\s*([^()]+)\)")
_TRANSLIT_RE = re.compile(r"[A-Za-z][A-Za-z'\u2019\- ]*")


def _same(a: str, b: str) -> bool:
    return a.casefold().replace("\u2019", "'") == b.casefold().replace("\u2019", "'")


def _ends_with(text: str, phrase: str) -> int:
    """Length of `phrase` at the end of `text` (ignoring case and trailing
    spaces) when it is whole words there, or 0."""
    stripped = text.rstrip()
    if phrase and len(stripped) >= len(phrase) and _same(stripped[-len(phrase):], phrase):
        start = len(stripped) - len(phrase)
        if start == 0 or not stripped[start - 1].isalnum():
            return len(text) - start
    return 0


def _transliteration(inner: str) -> str:
    """The first part of "translit, meaning", or "" when it is not a
    transliteration (a reference such as "Hilchot Shabbat 5:1")."""
    first = inner.split(",")[0].strip()
    return first if _TRANSLIT_RE.fullmatch(first) else ""


def _fix_nested(text: str) -> str:
    out, last = [], 0
    for found in _NESTED_RE.finditer(text):
        hebrew, inner = found.group(1), found.group(2).strip()
        translit = _transliteration(inner)
        if not translit:
            continue
        before = text[last:found.start()]
        cut = _ends_with(before, translit)
        if cut:
            # "mezonot (מזונות (mezonot, ...))": the word before is the
            # transliteration again, so the Hebrew takes its place.
            out.append(before[:len(before) - cut])
            out.append(f"{hebrew} ({inner})")
        else:
            # "cooking (בישול (bishul))": the English stays, the term follows it.
            out.append(before.rstrip())
            out.append(f", {hebrew} ({inner})")
        last = found.end()
    out.append(text[last:])
    return "".join(out)


def _fix_translit_first(text: str) -> str:
    # Only when the transliteration is written twice, before the Hebrew and
    # again inside: "ha'adamah (האדמה, ha'adamah, ...)". Without the repeat the
    # word before could just as well be English ("the blessing (ברכה, bracha)"),
    # so the text is left as written.
    out, last = [], 0
    for found in _HEBREW_FIRST_IN_PARENS_RE.finditer(text):
        hebrew, rest = found.group(1), found.group(2).strip()
        translit = _transliteration(rest)
        before = text[last:found.start()]
        cut = _ends_with(before, translit) if translit else 0
        if not cut:
            continue
        out.append(before[:len(before) - cut])
        out.append(f"{hebrew} ({rest})")
        last = found.end()
    out.append(text[last:])
    return "".join(out)


def normalize(text: str) -> str:
    """`text` with its Hebrew terms in the "HEB (translit, meaning)" form."""
    if not text or not re.search(r"[א-ת]", text):
        return text
    return _fix_translit_first(_fix_nested(text))
