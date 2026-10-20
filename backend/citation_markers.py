"""Numbered source markers in a model answer.

The model ties a claim to a source by putting the source's 1-based position in
its ``sources`` array after the claim -- ``"...kindling is forbidden.[1][2]"``
-- instead of naming the source in the prose. The reader's UI turns each
marker into a small numbered chip that jumps to that source in the sources
list under the answer (static/js/citation-markers.js).

That only works if the numbers still point at the right source once the list
has been cleaned up, so the list is finalised here, in one place: empty
entries are dropped, a source named twice is kept once, the list is capped
like the conversation UI's citation list, and every marker is renumbered to
match. Markers that point at nothing are removed rather than left dangling.

A marker sits where the claim it backs ends: place_markers() leaves each
``[n]`` right after the excerpt that rests on source n -- not gathered at the
bottom of the paragraph -- and shows a source once for a run of consecutive
sentences that all rest on it (at the run's last sentence), never as
``[1]`` after every one of them.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional, Tuple

# The conversation UI shows at most this many citations
# (routes_conversations._MAX_SEED_CITATIONS, conversation-store.js), so a marker
# can never usefully point past it. A learning answer that walks through a
# whole passage may cite up to ten (the prompt allows it); a one-point answer
# usually cites two to four.
MAX_CITED_SOURCES = 10

# One marker -- "[1]", "[1, 2]", "[1,2]", "[1-3]", "[1\u20133]" -- and a run of
# adjacent ones ("[1][2]"), with the spaces before the run (never a line break)
# so a removed run doesn't leave a stray space behind. The brackets must hold digits only
# (plus separators): "[2a]" and "[the Rema]" are text, not markers.
_ONE = r"\[\d{1,2}(?:\s*[,;]\s*\d{1,2}|\s*[-\u2013]\s*\d{1,2})*\]"
_RUN_RE = re.compile(rf"([ \t]*)((?:{_ONE})+)")
# Markers separated only by spaces ("[1] [2]") belong to one sentence too, so
# place_markers() reads them as one run (and writes them back flush: "[1][2]").
_SPACED_RUN_RE = re.compile(rf"([ \t]*)((?:{_ONE})(?:[ \t]*(?:{_ONE}))*)")
_NUMBER_OR_RANGE_RE = re.compile(r"(\d{1,2})(?:\s*[-\u2013]\s*(\d{1,2}))?")
# " — note" / " – note": one blank, a dash, one blank. (No quantifiers: a run of blanks is
# stepped over by note_head(), not rescanned by the pattern.)
_NOTE_SEP_RE = re.compile(r"\s[—–]\s")


def note_head(text: str) -> str:
    """``text`` up to its first " — note" separator, without the blanks before it
    ("Genesis 1:1 — creation" -> "Genesis 1:1"); all of it when there is none."""
    separator = _NOTE_SEP_RE.search(text)
    return text[: separator.start()].rstrip() if separator else text


def source_key(source: str) -> str:
    """A source reduced to the part before its relevance note, lower-cased:
    "Genesis 1:1 — creation" and "genesis 1:1" are the same source."""
    return note_head(str(source or "")).strip().lower()


def finalize_sources(
    raw_sources: Any,
    sanitize: Callable[[str], str],
    limit: int = MAX_CITED_SOURCES,
) -> Tuple[List[str], Dict[int, Optional[int]]]:
    """``(sources, index_map)``: the cleaned list and, for each 1-based
    position in ``raw_sources``, where that entry ended up (``None`` when it
    was dropped)."""
    sources: List[str] = []
    positions: Dict[str, int] = {}
    index_map: Dict[int, Optional[int]] = {}
    for raw_index, item in enumerate(raw_sources if isinstance(raw_sources, list) else [], start=1):
        value = sanitize(str(item or ""))
        key = source_key(value)
        if not value or not key:
            index_map[raw_index] = None
        elif key in positions:
            index_map[raw_index] = positions[key]
        elif len(sources) >= limit:
            index_map[raw_index] = None
        else:
            sources.append(value)
            positions[key] = len(sources)
            index_map[raw_index] = len(sources)
    return sources, index_map


def _numbers_in(run: str) -> List[int]:
    numbers: List[int] = []
    for match in _NUMBER_OR_RANGE_RE.finditer(run):
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) else start
        if end < start or end - start >= MAX_CITED_SOURCES:
            end = start
        numbers.extend(range(start, end + 1))
    return numbers


def remap_markers(text: str, index_map: Dict[int, Optional[int]]) -> str:
    """Rewrite every marker run in ``text`` through ``index_map``: renumbered,
    de-duplicated and sorted, one ``[n]`` per source (``[1, 2]`` becomes
    ``[1][2]``, ``[3][1]`` becomes ``[1][2]``), and removed when none of its
    sources survived."""

    def replace(match: "re.Match[str]") -> str:
        mapped: List[int] = []
        for number in _numbers_in(match.group(2)):
            new = index_map.get(number)
            if new is not None and new not in mapped:
                mapped.append(new)
        if not mapped:
            return ""
        return match.group(1) + "".join(f"[{n}]" for n in sorted(mapped))

    return _RUN_RE.sub(replace, str(text or ""))


def strip_markers(text: str) -> str:
    """``text`` without any marker -- for earlier turns shown to the model,
    whose numbers belong to an answer (and source list) it is not writing."""
    return _RUN_RE.sub("", str(text or ""))


# A sentence boundary inside a span: terminal punctuation (plus closing quotes or
# brackets), whitespace, then more text. Initials and common abbreviations
# ("R. Yochanan", "Dr. Smith", "e.g. the") end in a period but not a sentence.
# The match is the last mark of a run ("..." -> the third dot); _sentence_count walks
# back to the run's start. (A "+" here would be retried from every mark of a long run.)
_TERMINALS = ".!?\u2026\u05c3"
_BOUNDARY_RE = re.compile(r"[.!?\u2026\u05c3][\"'\u201d\u2019)\]]*\s+(?=\S)")
_ABBREVIATIONS = frozenset({
    "r", "rabbi", "rav", "dr", "mr", "mrs", "st", "vs", "cf", "etc", "ibid", "e.g", "i.e",
    "b", "bar", "ben", "no", "vol", "ch", "chap", "sec", "par", "ex", "lev", "num", "deut", "gen",
})


def _last_word(text: str) -> str:
    """The non-space run that ends ``text``, or that ends it before one final
    newline (where ``$`` would also match); "" when ``text`` ends in other
    space. A backwards walk, so a long run is read once."""
    end = len(text) - 1 if text.endswith("\n") else len(text)
    start = end
    while start > 0 and not text[start - 1].isspace():
        start -= 1
    return text[start:end]


def _sentence_count(span: str) -> int:
    """How many sentences ``span`` holds (at least one when it has any text)."""
    text = span.strip()
    if not text:
        return 0
    count = 1
    for match in _BOUNDARY_RE.finditer(text):
        run_start = match.start()
        while run_start > 0 and text[run_start - 1] in _TERMINALS:
            run_start -= 1
        previous = _last_word(text[:run_start]).strip("([\"'\u201c").lower()
        if previous in _ABBREVIATIONS or re.fullmatch(r"[a-z]", previous):
            continue
        count += 1
    return count


def place_markers(text: str) -> str:
    """``text`` with each marker at the end of the excerpt it backs, once per run.

    A marker belongs to the text between it and the marker before it. When the
    very next excerpt is a single sentence that rests on the same source, the
    source is left off the earlier one and shown after the later one, so a run
    of consecutive sentences from one source carries one marker, at its last
    sentence ("Kindling is forbidden.[1] Cooking too.[1][2]" becomes "Kindling
    is forbidden. Cooking too.[1][2]"). A source cited again after a passage
    from a different source is shown again. Each marker group is ascending and
    sits flush against the text it follows. Applying this twice changes
    nothing. Lines inside a code fence are left alone."""
    lines = str(text or "").split("\n")
    in_fence = False
    for index, line in enumerate(lines):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        elif not in_fence:
            lines[index] = _place_line(line)
    return "\n".join(lines)


def _place_line(line: str) -> str:
    runs = list(_SPACED_RUN_RE.finditer(line))
    if not runs:
        return line

    spans: List[str] = []
    cited: List[List[int]] = []
    position = 0
    for match in runs:
        spans.append(line[position:match.start()])
        cited.append(sorted(set(_numbers_in(match.group(2)))))
        position = match.end()
    tail = line[position:]

    pieces: List[str] = []
    for index, span in enumerate(spans):
        numbers = cited[index]
        following = index + 1
        if following < len(spans) and _sentence_count(spans[following]) == 1:
            numbers = [n for n in numbers if n not in cited[following]]
        if numbers:
            span = span.rstrip()
        pieces.append(span + "".join(f"[{n}]" for n in numbers))
    return "".join(pieces) + tail
