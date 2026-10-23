"""
Verse search for the search bar: type the words of a verse, get the verse.

``search_verses("בראשית ברא אלהים")`` -> Genesis 1:1, ``"let there be light"``
-> Genesis 1:3. Hebrew is matched with or without nikud and te'amim, and a
phrase from the middle of a verse is found as well as its opening. Tanakh
comes first; matches elsewhere in the library follow when Tanakh has fewer
than asked for.

The text index is Sefaria's own (``/api/search-wrapper``, the same one
backend/utils/search_provider.py reads for the AI). It matches whole words in
order, so a typo or a stray abbreviation ("ה" for the Name) finds nothing;
then each word is left out in turn and the rest searched with a little slack,
and those results come back marked ``"match": "close"``.

Every hit is one verse in one version, so a verse appears once per edition;
results are folded to one per ref, with the snippet from the edition in the
query's script (a Hebrew query shows the Hebrew verse, without te'amim). The
snippet arrives from Sefaria as HTML with <b> around the matched words; it is
returned as plain-text ``parts`` (``{"text", "match"}``), never as markup, so
nothing from upstream is ever inserted into the page as HTML.

Blocking (``requests``): called from the Flask route only, never from the
FastAPI event loop. Results are memoised per normalised query for ten minutes.
"""

import html
import logging
import re
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor

import requests

from backend import text_trust
from backend.health_check import health

logger = logging.getLogger(__name__)

SEARCH_URL = "https://www.sefaria.org/api/search-wrapper"
_TIMEOUT_SECONDS = 4
_MAX_QUERY_CHARS = 120
_MAX_WORDS = 12
_MIN_QUERY_LETTERS = 3
# How many hits to ask for per search: each verse comes back once per
# edition (5-10 of them for a Torah verse), so a handful of verses needs
# several times as many hits.
_HITS_PER_SEARCH = 40
# Close matches leave out one word at a time; at most this many searches.
_MAX_CLOSE_SEARCHES = 5
_CLOSE_SLOP = 2
_SNIPPET_CHARS = 180

_CACHE_TTL_SECONDS = 600
_CACHE_MAX = 256
_cache: dict = {}
_cache_lock = threading.Lock()

# Cantillation (te'amim), vowels (nikud) and the other pointing marks, plus
# paseq and sof pasuq. Letters (U+05D0-U+05EA) are kept.
_HEBREW_MARKS_RE = re.compile("[\u0591-\u05bd\u05bf-\u05c2\u05c4-\u05c7\u05c3]")
_TEAMIM_RE = re.compile("[֑-ֽ֯׀׃]")
_HEBREW_LETTER_RE = re.compile("[א-ת]")
# Anything that is not a letter, digit or space becomes a space (maqaf,
# geresh, gershayim, punctuation), so "ה׳" and "על־פני" search as words.
_NON_WORD_RE = re.compile(r"[\W_]", re.UNICODE)
_SPACES_RE = re.compile(r"\s+")
_TAG_RE = re.compile(r"<[^>]*>")
_BOLD_SPLIT_RE = re.compile(r"(<b>.*?</b>)", re.IGNORECASE | re.DOTALL)

# Hebrew editions whose text reads best in a snippet, best first: pointed
# without te'amim, then plain. Anything else is used as it comes.
_PREFERRED_HEBREW_VERSIONS = ("Tanach with Nikkud", "Tanach with Text Only")

# The books of Tanakh themselves. Commentary on them is filed under
# "Tanakh/" too ("Tanakh/Rishonim on Tanakh/Rashi/..."), so the plain
# "Tanakh" prefix would mix Rashi in with the verses.
_TANAKH_PATHS = ("Tanakh/Torah", "Tanakh/Prophets", "Tanakh/Writings")

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="verse-search")


def normalize_query(query) -> str:
    """The query as it is searched: NFC, pointing removed, punctuation turned
    into spaces, whitespace collapsed, capped in length and word count."""
    text = unicodedata.normalize("NFC", str(query or ""))[: _MAX_QUERY_CHARS * 2]
    text = text.replace("־", " ")  # maqaf joins words; search them apart
    text = _HEBREW_MARKS_RE.sub("", text)
    text = _NON_WORD_RE.sub(" ", text)
    words = _SPACES_RE.sub(" ", text).strip().split(" ")
    return " ".join(words[:_MAX_WORDS])[:_MAX_QUERY_CHARS].strip()


def is_hebrew(text) -> bool:
    return bool(_HEBREW_LETTER_RE.search(str(text or "")))


def _letter_count(text) -> int:
    return sum(1 for ch in text if ch.isalpha())


def _payload(query, *, tanakh_only, slop):
    return {
        "type": "text",
        "query": query,
        "field": "naive_lemmatizer",
        "source_proj": True,
        "slop": slop,
        "start": 0,
        "size": _HITS_PER_SEARCH,
        "filters": list(_TANAKH_PATHS) if tanakh_only else [],
        "filter_fields": ["path"] * len(_TANAKH_PATHS) if tanakh_only else [],
        "aggs": [],
        "sort_method": "score",
        "sort_fields": ["pagesheetrank"],
        "sort_reverse": False,
        "sort_score_missing": 0.04,
    }


def _post_search(payload) -> list:
    """One search-wrapper call -> its hits, [] on any failure."""
    if not health.is_healthy("sefaria"):
        return []
    try:
        resp = requests.post(SEARCH_URL, json=payload, timeout=_TIMEOUT_SECONDS)
        if not resp.ok:
            health.record_failure("sefaria")
            return []
        data = resp.json() if resp.content else {}
        health.record_success("sefaria")
        hits = ((data or {}).get("hits") or {}).get("hits") or []
        return hits if isinstance(hits, list) else []
    except (requests.RequestException, ValueError, TimeoutError) as exc:
        health.record_failure("sefaria")
        logger.warning("verse_search: search-wrapper call failed: %s", exc)
        return []


def _categories(source) -> list:
    value = source.get("categories")
    if isinstance(value, list):
        return [str(c) for c in value if c]
    return []


def _is_tanakh(source) -> bool:
    path = str(source.get("path") or "")
    return any(path == p or path.startswith(p + "/") for p in _TANAKH_PATHS)


def snippet_parts(highlight_html, fallback_text="") -> list:
    """Sefaria's highlighted snippet as plain-text parts: [{"text", "match"}].
    Tags other than the <b> markers are dropped and entities decoded; the
    result is text only. Te'amim are removed; long snippets are trimmed to
    the matched words with an ellipsis."""
    source = str(highlight_html or "") or html.escape(str(fallback_text or ""))
    parts = []
    for piece in _BOLD_SPLIT_RE.split(source):
        if not piece:
            continue
        matched = piece[:3].lower() == "<b>"
        text = html.unescape(_TAG_RE.sub("", piece))
        text = _TEAMIM_RE.sub("", text)
        text = _SPACES_RE.sub(" ", text)
        if not text:
            continue
        if parts and parts[-1]["match"] == matched:
            parts[-1]["text"] += text
        else:
            parts.append({"text": text, "match": matched})
    return _trim_parts(_join_adjacent_matches(parts))


def _join_adjacent_matches(parts) -> list:
    """Matched words separated only by a space or a maqaf read as one phrase."""
    joined = []
    for part in parts:
        if (part["match"] and len(joined) >= 2 and joined[-2]["match"]
                and not joined[-1]["match"] and not joined[-1]["text"].replace("\u05be", "").strip()):
            gap = joined.pop()
            joined[-1]["text"] += gap["text"] + part["text"]
        else:
            joined.append(dict(part))
    return joined


def _trim_parts(parts) -> list:
    total = sum(len(p["text"]) for p in parts)
    if total <= _SNIPPET_CHARS:
        return _strip_ends(parts)
    first = next((i for i, p in enumerate(parts) if p["match"]), 0)
    lead = sum(len(p["text"]) for p in parts[:first])
    trimmed, budget = [], _SNIPPET_CHARS
    # Keep a little context before the first match, then fill forwards.
    context = 40
    if lead > context:
        before = parts[first - 1]["text"] if first else ""
        trimmed.append({"text": "…" + before[-context:].lstrip(), "match": False})
        budget -= context
        start = first
    else:
        start = 0
    for part in parts[start:]:
        if budget <= 0:
            break
        text = part["text"]
        if len(text) > budget:
            text = text[:budget].rstrip() + "…"
        trimmed.append({"text": text, "match": part["match"]})
        budget -= len(text)
    if sum(len(p["text"]) for p in trimmed) < total and not trimmed[-1]["text"].endswith("…"):
        trimmed[-1]["text"] = trimmed[-1]["text"].rstrip() + "…"
    return _strip_ends(trimmed)


def _strip_ends(parts) -> list:
    if parts:
        parts[0]["text"] = parts[0]["text"].lstrip()
        parts[-1]["text"] = parts[-1]["text"].rstrip()
    return [p for p in parts if p["text"]]


def _version_rank(source, hebrew_query) -> int:
    lang = str(source.get("lang") or "")
    if hebrew_query != (lang == "he"):
        return 9  # the other language's edition: only if nothing else
    if lang == "he":
        version = str(source.get("version") or "")
        return _PREFERRED_HEBREW_VERSIONS.index(version) if version in _PREFERRED_HEBREW_VERSIONS else 5
    return 0


def _hit_allowed(source) -> bool:
    """text_trust's policy for one search hit: never a hidden work, never a
    denied edition, and English only from a reviewed translation."""
    ref = str(source.get("ref") or "")
    if text_trust.is_work_denied(ref) or text_trust.is_work_denied(source.get("index_title")):
        return False
    is_hebrew = str(source.get("lang") or "") == "he"
    version = {"versionTitle": source.get("version"), "language": "he" if is_hebrew else "en",
               "isSource": is_hebrew}
    return text_trust.is_version_shown(version)


# An unreviewed Hebrew edition counts as the work's own text only as a fallback,
# as in sefaria_library.get_text: a reviewed edition of the same ref always wins.
_ORIGINAL_TEXT_FALLBACK_PENALTY = 100


def _is_original_text_fallback(source) -> bool:
    if str(source.get("lang") or "") != "he":
        return False
    version = {"versionTitle": source.get("version"), "language": "he", "isSource": True}
    return text_trust.assess_version(version)["label"] == text_trust.ORIGINAL_TEXT


def _best_hit_per_ref(hits, hebrew_query):
    """``(refs in first-seen order, {ref: (version rank, hit rank, hit)})`` with
    the best edition of each ref kept."""
    by_ref, order = {}, []
    for rank, hit in enumerate(hits or []):
        source = (hit or {}).get("_source") or {}
        ref = str(source.get("ref") or "").strip()
        if not ref or not _hit_allowed(source):
            continue
        version_rank = _version_rank(source, hebrew_query)
        if _is_original_text_fallback(source):
            version_rank += _ORIGINAL_TEXT_FALLBACK_PENALTY
        candidate = (version_rank, rank, hit)
        if ref not in by_ref:
            order.append(ref)
            by_ref[ref] = candidate
        elif candidate[:2] < by_ref[ref][:2]:
            by_ref[ref] = candidate
    return order, by_ref


def _result_row(ref, hit, match) -> dict:
    source = hit.get("_source") or {}
    highlight = hit.get("highlight") or {}
    marked = next((v[0] for v in highlight.values() if isinstance(v, list) and v), "")
    return {
        "ref": ref,
        "heRef": str(source.get("heRef") or ""),
        "categories": _categories(source)[:3],
        "tanakh": _is_tanakh(source),
        "lang": "he" if str(source.get("lang")) == "he" else "en",
        "parts": snippet_parts(marked, source.get("naive_lemmatizer") or source.get("exact") or ""),
        "match": match,
    }


def _fold_hits(hits, hebrew_query, match) -> list:
    """One result per ref, in first-seen order, with the best edition's
    snippet."""
    order, by_ref = _best_hit_per_ref(hits, hebrew_query)
    return [_result_row(ref, by_ref[ref][2], match) for ref in order]


def _merge(*groups) -> list:
    seen, merged = set(), []
    for group in groups:
        for item in group:
            if item["ref"] in seen:
                continue
            seen.add(item["ref"])
            merged.append(item)
    return merged


def _close_queries(words) -> list:
    if len(words) < 2:
        return []
    queries = []
    for i in range(len(words)):
        rest = words[:i] + words[i + 1:]
        if _letter_count(" ".join(rest)) >= _MIN_QUERY_LETTERS:
            queries.append(" ".join(rest))
        if len(queries) >= _MAX_CLOSE_SEARCHES:
            break
    return queries


def _close_tanakh(query, hebrew) -> list:
    futures = [
        _executor.submit(_post_search, _payload(q, tanakh_only=True, slop=_CLOSE_SLOP))
        for q in _close_queries(query.split(" "))
    ]
    groups = [_fold_hits(f.result(), hebrew, "close") for f in futures]
    # Interleave so each left-out word gets its best verse near the top.
    interleaved = []
    for depth in range(max((len(g) for g in groups), default=0)):
        interleaved.extend(g[depth] for g in groups if depth < len(g))
    return _merge(interleaved)


def _search_uncached(query, size) -> dict:
    hebrew = is_hebrew(query)
    tanakh_future = _executor.submit(_post_search, _payload(query, tanakh_only=True, slop=0))
    library_future = _executor.submit(_post_search, _payload(query, tanakh_only=False, slop=0))
    tanakh = _fold_hits(tanakh_future.result(), hebrew, "exact")
    library = [r for r in _fold_hits(library_future.result(), hebrew, "exact") if not r["tanakh"]]
    if tanakh:
        return {"query": query, "close": False, "results": _merge(tanakh, library)[:size]}
    # No verse matched as typed: a typo, or words quoted only in later
    # books. Close verses take the top half; exact matches elsewhere follow.
    close = _close_tanakh(query, hebrew)
    if close and library:
        close = close[: max(1, size // 2)]
    results = _merge(close, library)[:size]
    return {"query": query, "close": bool(close), "results": results}


def search_verses(query, size=6) -> dict:
    """{"query", "close", "results": [...]} for the search bar. ``close`` is
    True when nothing matched exactly and the results are close matches."""
    normalized = normalize_query(query)
    size = max(1, min(int(size or 6), 12))
    if _letter_count(normalized) < _MIN_QUERY_LETTERS:
        return {"query": normalized, "close": False, "results": []}
    key = (normalized.lower(), size)
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < _CACHE_TTL_SECONDS:
            return hit[1]
    result = _search_uncached(normalized, size)
    # A failed upstream (nothing at all, Sefaria unhealthy) is not memoised.
    if result["results"] or health.is_healthy("sefaria"):
        with _cache_lock:
            if len(_cache) >= _CACHE_MAX:
                _cache.pop(next(iter(_cache)))
            _cache[key] = (now, result)
    return result
