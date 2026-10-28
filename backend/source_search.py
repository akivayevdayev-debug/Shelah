"""
Search the halachic library for a question, and put the sources that answer it best first.

The curated keyword table (backend/sefaria.find_refs_for_question) only knows the topics
someone wrote down. A question worded another way ("must an important person help get
ready for Shabbat?") finds nothing there, or finds a chapter that is only near the point.
This module adds two things:

* ``search_refs(question, known_refs)``: searches Sefaria's own text index
  (``/api/search-wrapper``) for pairs of the question's words, in the Shulchan Arukh,
  Mishneh Torah, Tur and Kitzur Shulchan Arukh only. The paragraphs that come back are
  scored against the question, and the best one or two are returned as extra refs to read.
* ``rank_sources(question, sources)``: orders the loaded sources by how well they match
  the question, so the source that answers it is the first one the model reads and cites.

Scoring is plain word overlap: each question word found in a source counts by how rare it
is among the candidates (a word every candidate has, like "shabbat", says little), and a
source that covers more of the question's words gets more. Hebrew is compared without
vowel points.

Blocking (``requests``): run it in a worker thread on the async path. Any failure returns
no extra refs, so the answer is never worse than the keyword table alone.
"""

from __future__ import annotations

import logging
import math
import re
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, wait
from itertools import combinations
from typing import Any, Iterable

import requests

from backend.health_check import health

logger = logging.getLogger(__name__)

SEARCH_URL = "https://www.sefaria.org/api/search-wrapper"
# The books whose paragraphs can stand as a halachic source for an answer.
SEARCH_PATHS = (
    "Halakhah/Shulchan Arukh/Shulchan Arukh",
    "Halakhah/Mishneh Torah",
    "Halakhah/Tur",
    "Halakhah/Kitzur Shulchan Arukh",
)
_TIMEOUT_SECONDS = 2.5
_HITS_PER_SEARCH = 20
_SLOP = 12
_MAX_SEARCH_WORDS = 5
_MAX_SEARCHES = 4
_MAX_EXTRA_REFS = 2
# An extra paragraph must score at least this share of the best one's score.
_MIN_SHARE_OF_BEST = 0.6
# The books themselves, not their commentaries (the Tur's path also holds the Beit Yosef).
_BOOK_PREFIXES = ("shulchan arukh, ", "mishneh torah, ", "tur, ", "kitzur shulchan arukh ")
# A paragraph must share at least this many of the question's words to be read
# (or the one word a one-word question has).
_MIN_SHARED_WORDS = 2

_CACHE_TTL_SECONDS = 600
_CACHE_MAX = 256
_cache: dict[str, tuple[float, list[str]]] = {}
_cache_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="source-search")

_STOPWORDS = frozenset({
    "the", "and", "for", "with", "from", "that", "this", "are", "was", "were", "have", "has",
    "had", "during", "about", "into", "when", "what", "where", "which", "who", "whom", "whose",
    "why", "how", "does", "did", "can", "could", "may", "might", "must", "should", "would",
    "will", "shall", "need", "needed", "needs", "say", "says", "said", "hold", "holds", "rabbi",
    "rav", "allowed", "permitted", "halacha", "halakha", "halakhah", "halachah", "question",
    "please", "tell", "you", "your", "one", "someone", "there", "their", "them", "they", "his",
    "her", "its", "not", "but", "any", "all", "some", "also", "even", "than", "then", "only",
    "very", "just", "like", "get", "got", "make", "made", "know", "want", "use", "used",
    "source", "sources", "according", "opinion", "opinions", "view", "views", "require",
    "required", "requires", "supposed", "okay", "jewish", "jew", "jews", "under", "over",
    "without", "before", "after", "while", "because", "then", "able", "ever", "much", "many",
    "other", "same", "such", "these", "those", "out", "off", "being", "been", "other",
    "איך", "מה", "האם", "עם", "של", "על", "גם", "לא", "כן", "מי", "זה", "את", "אם", "או", "יש",
    "אין", "צריך", "מותר", "אסור", "למה", "מתי", "הלכה",
})

# Transliterated phrases the English translations never use, with the words they do use.
_ALIASES = {
    "adam gadol": ("important", "person"),
    "adam hagadol": ("important", "person"),
    "adam chashuv": ("important", "person"),
    "talmid chacham": ("scholar",),
    "hadlakat nerot": ("light", "candles"),
    "erev shabbat": ("friday", "shabbat"),
    "motzei shabbat": ("saturday", "night"),
    "kibbud av": ("honor", "father"),
    "lashon hara": ("speech", "evil"),
}

_WORD_RE = re.compile(r"[a-zא-ת']{3,}")
_HEBREW_RE = re.compile(r"[א-ת]")
_TAG_RE = re.compile(r"<[^>]+>")
_SEGMENT_RE = re.compile(r"^(.*\D)(\d+):(\d+)$")


_FOOTNOTE_OPEN_RE = re.compile(r'<i class="footnote">', re.IGNORECASE)
_ITALIC_TAG_RE = re.compile(r"<(/?)i\b[^>]*>", re.IGNORECASE)
_MARKER_RE = re.compile(r'<sup class="footnote-marker">.*?</sup>', re.IGNORECASE | re.DOTALL)


def _drop_footnotes(text: str) -> str:
    """The text without translators' footnotes, which can hold more words than the ruling
    itself. A footnote is <i class="footnote">...</i> and may hold <i> of its own."""
    text = _MARKER_RE.sub(" ", text)
    out, pos = [], 0
    while (start := _FOOTNOTE_OPEN_RE.search(text, pos)) is not None:
        out.append(text[pos:start.start()])
        depth, pos = 1, start.end()
        while depth and (tag := _ITALIC_TAG_RE.search(text, pos)) is not None:
            depth += -1 if tag.group(1) else 1
            pos = tag.end()
        if depth:
            return "".join(out)
    out.append(text[pos:])
    return " ".join(out)


def _plain(text: Any) -> str:
    """Lowercase text without footnotes, markup, or Hebrew vowel points and cantillation."""
    stripped = _TAG_RE.sub(" ", _drop_footnotes(str(text or "")))
    decomposed = unicodedata.normalize("NFD", stripped)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower().replace("’", "'")


def _stem(word: str) -> str:
    """A crude English stem, so "candles" and "candle" or "lighting" and "light" meet."""
    if _HEBREW_RE.search(word):
        return word
    if word.endswith(("ches", "shes", "sses", "xes")) and len(word) >= 7:
        return word[:-2]
    for suffix in ("ing", "ed", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 4:
            return word[: -len(suffix)]
    return word


def question_words(question: str) -> list[str]:
    """The question's meaningful words as written (no repeats), with the plain English
    words for transliterated phrases the translations never use."""
    text = _plain(question)
    words: list[str] = []
    for phrase, aliases in _ALIASES.items():
        if phrase in text:
            words.extend(aliases)
            text = text.replace(phrase, " ")
    words.extend(word.strip("'") for word in _WORD_RE.findall(text))
    kept: list[str] = []
    for word in words:
        if len(word) >= 3 and word not in _STOPWORDS and word not in kept:
            kept.append(word)
    return kept


def question_terms(question: str) -> list[str]:
    """question_words, stemmed (so "candles" meets "candle"), no repeats."""
    terms: list[str] = []
    for word in question_words(question):
        stem = _stem(word)
        if stem not in terms:
            terms.append(stem)
    return terms


def _term_pattern(term: str) -> re.Pattern:
    if _HEBREW_RE.search(term):
        return re.compile(re.escape(term))
    return re.compile(r"(?<![a-z])" + re.escape(term))


def _shared_terms(terms: list[str], text: str) -> set[str]:
    return {term for term in terms if _term_pattern(term).search(text)}


def _scores(terms: list[str], texts: list[str]) -> list[float]:
    """One score per text: the rarer the shared word among `texts`, the more it counts,
    and covering more of the question's words multiplies it."""
    if not terms or not texts:
        return [0.0 for _ in texts]
    shared = [_shared_terms(terms, _plain(text)) for text in texts]
    count = len(texts)
    weight = {
        term: math.log(1 + count / (1 + sum(term in found for found in shared))) + 0.1
        for term in terms
    }
    return [
        sum(weight[term] for term in found) * (0.5 + len(found) / len(terms))
        for found in shared
    ]


def _paragraphs(source: dict[str, Any]) -> list[str]:
    """Each paragraph of a source as one text (its English and Hebrew together)."""
    lines = source.get("lines") if isinstance(source, dict) else None
    if not isinstance(lines, list):
        return []
    return [
        f"{line.get('en') or ''} {line.get('he') or ''}"
        for line in lines
        if isinstance(line, dict)
    ]


def rank_sources(
    question: str, sources: list[dict[str, Any]], optional_refs: Iterable[str] = (),
) -> list[dict[str, Any]]:
    """`sources` ordered best match first. A source counts by its best paragraph, so a
    long chapter does not win just for holding more words. Ties keep their order, so with
    no shared words at all the keyword table's order stands. A source whose ref is in
    `optional_refs` (one the search added) is kept only when it matches nearly as well
    as the best source."""
    terms = question_terms(question)
    if len(sources) < 2 or not terms:
        return list(sources)
    paragraphs = [_paragraphs(source) for source in sources]
    flat = [text for texts in paragraphs for text in texts]
    flat_scores = iter(_scores(terms, flat))
    best = [max((next(flat_scores) for _ in texts), default=0.0) for texts in paragraphs]
    top = max(best)
    optional = set(optional_refs)
    order = sorted(range(len(sources)), key=lambda i: -best[i])
    return [
        sources[i] for i in order
        if sources[i].get("ref") not in optional or best[i] >= top * _MIN_SHARE_OF_BEST
    ]


def _chapter(ref: str) -> str:
    """"Shulchan Arukh, Orach Chayim 250:1" -> "shulchan arukh, orach chayim 250"."""
    text = str(ref or "").replace("_", " ").replace(".", " ").strip().lower()
    match = _SEGMENT_RE.match(text)
    return f"{match.group(1)}{match.group(2)}".strip() if match else re.sub(r"\s+", " ", text)


def _payload(query: str) -> dict[str, Any]:
    return {
        "type": "text",
        "query": query,
        "field": "naive_lemmatizer",
        "source_proj": True,
        "slop": _SLOP,
        "start": 0,
        "size": _HITS_PER_SEARCH,
        "filters": list(SEARCH_PATHS),
        "filter_fields": ["path"] * len(SEARCH_PATHS),
        "aggs": [],
        "sort_method": "score",
        "sort_fields": ["pagesheetrank"],
        "sort_reverse": False,
        "sort_score_missing": 0.04,
    }


def _post_search(query: str) -> list[dict[str, Any]]:
    """One search -> the hits' sources ({"ref", "exact", ...}); [] on any failure."""
    try:
        resp = requests.post(SEARCH_URL, json=_payload(query), timeout=_TIMEOUT_SECONDS)
        if not resp.ok:
            health.record_failure("sefaria")
            return []
        hits = ((resp.json() or {}).get("hits") or {}).get("hits") or []
        health.record_success("sefaria")
    except (requests.RequestException, ValueError, TimeoutError) as exc:
        health.record_failure("sefaria")
        logger.warning("source_search: search-wrapper call failed: %s", exc)
        return []
    return [hit["_source"] for hit in hits if isinstance(hit, dict) and isinstance(hit.get("_source"), dict)]


def _queries(question: str) -> list[str]:
    """Pairs of the question's longest words (a rough stand-in for the most telling
    ones), neighbours first: the index wants every word of a query, so a long query
    finds nothing. The words are searched as written; the index does its own stemming."""
    words = question_words(question)
    picked = set(sorted(words, key=len, reverse=True)[:_MAX_SEARCH_WORDS])
    words = [word for word in words if word in picked]
    if len(words) < 2:
        return words
    pairs = [(words[i], words[i + 1]) for i in range(len(words) - 1)]
    pairs += [pair for pair in combinations(words, 2) if pair not in pairs]
    return [" ".join(pair) for pair in pairs][:_MAX_SEARCHES]


def _run_searches(queries: list[str]) -> list[dict[str, Any]]:
    futures = [_executor.submit(_post_search, query) for query in queries]
    done, _ = wait(futures, timeout=_TIMEOUT_SECONDS + 0.5)
    found: list[dict[str, Any]] = []
    for future in futures:
        if future in done and future.exception() is None:
            found.extend(future.result())
    return found


def _best_refs(terms: list[str], hits: list[dict[str, Any]], known_refs: Iterable[str]) -> list[str]:
    """The best-matching paragraphs among `hits`, one per chapter, skipping chapters the
    keyword table already brings."""
    texts: dict[str, str] = {}
    for hit in hits:
        ref = str(hit.get("ref") or "").strip()
        if ref.lower().startswith(_BOOK_PREFIXES):
            texts[ref] = f"{texts.get(ref, '')} {hit.get('exact') or ''}"
    refs = list(texts)
    scores = _scores(terms, [texts[ref] for ref in refs])
    known = {_chapter(ref) for ref in known_refs}
    picked: list[str] = []
    best = max(scores, default=0.0)
    for i in sorted(range(len(refs)), key=lambda i: -scores[i]):
        ref = refs[i]
        if scores[i] < best * _MIN_SHARE_OF_BEST:
            break
        if len(_shared_terms(terms, _plain(texts[ref]))) < min(_MIN_SHARED_WORDS, len(terms)):
            break
        chapter = _chapter(ref)
        if chapter in known:
            continue
        known.add(chapter)
        picked.append(ref)
        if len(picked) >= _MAX_EXTRA_REFS:
            break
    return picked


def search_refs(question: str, known_refs: Iterable[str] = ()) -> list[str]:
    """Up to two paragraph refs from the halachic library that share the most words
    with `question`, outside the chapters in `known_refs`. [] when the question has
    no telling word, Sefaria is down, or nothing matches well."""
    terms = question_terms(question)
    queries = _queries(question)
    if not queries or not health.is_healthy("sefaria"):
        return []
    known_refs = list(known_refs)
    key = " ".join(terms) + "|" + "|".join(sorted(_chapter(ref) for ref in known_refs))
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(key)
        if cached and now - cached[0] < _CACHE_TTL_SECONDS:
            return list(cached[1])
    refs = _best_refs(terms, _run_searches(queries), known_refs)
    with _cache_lock:
        if len(_cache) >= _CACHE_MAX:
            _cache.pop(next(iter(_cache)))
        _cache[key] = (now, refs)
    return list(refs)
