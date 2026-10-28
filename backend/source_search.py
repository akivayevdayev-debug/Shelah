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

import contextvars
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

from backend import question_plan
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
# The longest find_sources takes: the plan (with the first searches running
# meanwhile), then one round of searches for its phrases.
MAX_WAIT_SECONDS = 3.5 + 0.5 + _TIMEOUT_SECONDS + 0.5 + 0.5
_HITS_PER_SEARCH = 20
_SLOP = 12
_MAX_SEARCH_WORDS = 5
_MAX_SEARCHES = 4
_MAX_EXTRA_REFS = 3
_MATCHED_BOOST = 1.5
# An extra paragraph must score at least this share of the best one's score.
_MIN_SHARE_OF_BEST = 0.6
# A question about the Bible itself searches the Bible.
TANAKH_PATHS = ("Tanakh",)
# The planner's phrases (backend/question_plan.py) are searched across the
# library's primary texts: Bible, Mishnah, Talmud and the codes.
BROAD_PATHS = ("Tanakh", "Mishnah", "Talmud/Bavli", "Halakhah")
# Commentaries filed beside the codes (the Tur's path also holds the Beit Yosef),
# whose refs carry no " on ".
_COMMENTARY_PREFIXES = ("beit yosef", "bayit chadash", "darchei moshe", "perishah", "drishah")
_MAX_PLAN_REFS = 4
# A paragraph must share at least this many of the question's words to be read
# (or the one word a one-word question has).
_MIN_SHARED_WORDS = 2

_CACHE_TTL_SECONDS = 600
_CACHE_MAX = 256
_cache: dict[str, tuple[float, dict[str, list[str]]]] = {}
_cache_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="source-search")

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

# Words that say where to look, not what is written there.
_TANAKH_STOPWORDS = frozenset({
    "torah", "tanakh", "tanach", "chumash", "bible", "biblical", "verse", "verses", "pasuk", "passuk",
    "pasuk", "pesukim", "psukim", "else", "phrase", "written", "write", "wrote", "mention", "mentioned",
    "mentions", "appear", "appears", "place", "places", "book", "books", "navi", "prophet", "prophets",
    "parasha", "parashat", "parsha", "תורה", "פסוק", "פסוקים", "תנך", "חומש", "כתוב",
})
_TANAKH_QUESTION_RE = re.compile(
    r"\b(?:torah|tanakh|tanach|chumash|bible|biblical|verses?|pas+uk|pesukim|psukim|navi|nevi'?im|prophets?|"
    r"genesis|exodus|leviticus|numbers|deuteronomy|bereishi?t|shemot|vayikra|bamidbar|devarim|joshua|"
    r"judges|samuel|shmuel|kings|melachim|isaiah|yeshayahu|jeremiah|yirmiyahu|ezekiel|yechezkel|psalms?|"
    r"tehillim|proverbs|mishlei|job|iyov|ruth|esther|lamentations|eichah|ecclesiastes|kohelet|"
    r"song of songs|shir hashirim|daniel|ezra|nehemiah|chronicles|divrei hayamim)\b"
    r"|תורה|פסוק|תנ\"?ך|חומש|נביא",
    re.IGNORECASE,
)

_WORD_RE = re.compile(r"[a-zא-ת']{3,}")
_HEBREW_RE = re.compile(r"[א-ת]")
_TAG_RE = re.compile(r"<[^>]+>")
_SEGMENT_RE = re.compile(r"^(.*\D)(\d+[ab]?):(\d+)$")


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


def is_tanakh_question(question: str) -> bool:
    """True when the question is about the Bible's own text ("where in the Torah...")."""
    return bool(_TANAKH_QUESTION_RE.search(str(question or "")))


def question_words(question: str, tanakh: bool = False) -> list[str]:
    """The question's meaningful words as written (no repeats), with the plain English
    words for transliterated phrases the translations never use. For a question about
    the Bible (`tanakh`), words that only say where to look ("torah", "verse") are
    dropped too."""
    stop = _STOPWORDS | _TANAKH_STOPWORDS if tanakh else _STOPWORDS
    text = _plain(question)
    words: list[str] = []
    for phrase, aliases in _ALIASES.items():
        if phrase in text:
            words.extend(aliases)
            text = text.replace(phrase, " ")
    words.extend(word.strip("'") for word in _WORD_RE.findall(text))
    kept: list[str] = []
    for word in words:
        if len(word) >= 3 and word not in stop and word not in kept:
            kept.append(word)
    return kept


def question_terms(question: str, tanakh: bool = False) -> list[str]:
    """question_words, stemmed (so "candles" meets "candle"), no repeats."""
    terms: list[str] = []
    for word in question_words(question, tanakh):
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


def _holds_phrase(text: str, phrases: Iterable[str]) -> bool:
    """True when `text` holds every word of one of `phrases` (two words or more): a
    paragraph that says the very words the answer is known by."""
    plain = _plain(text)
    for phrase in phrases:
        terms = question_terms(phrase)
        if len(terms) >= 2 and len(_shared_terms(terms, plain)) == len(terms):
            return True
    return False


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
    extra_terms: Iterable[str] = (), phrases: Iterable[str] = (), vouched_refs: Iterable[str] = (),
    matched_refs: Iterable[str] = (),
) -> list[dict[str, Any]]:
    """`sources` ordered best match first. A source counts by its best paragraph, so a
    long chapter does not win just for holding more words. Ties keep their order, so with
    no shared words at all the keyword table's order stands. A source whose ref is in
    `optional_refs` (one the search added) is kept only when it matches nearly as well
    as the best source. `extra_terms` (find_sources' "terms") are the words the texts
    themselves use for the question's subject, which count like the question's own. An
    optional source that holds one of `phrases` word for word is kept however it scores:
    "where else is it written" wants every place that says it. So is one in
    `vouched_refs` (find_sources' "vouched": named by the planner or hit by a phrase
    search, which matches inflections and other translations) that shares any word.
    One in `matched_refs` (find_sources' "matched": a phrase search hit its text) also
    ranks ahead of keyword matches of the same score."""
    terms = list(dict.fromkeys([*question_terms(question, is_tanakh_question(question)), *extra_terms]))
    if len(sources) < 2 or not terms:
        return list(sources)
    paragraphs = [_paragraphs(source) for source in sources]
    flat = [text for texts in paragraphs for text in texts]
    flat_scores = iter(_scores(terms, flat))
    best = [max((next(flat_scores) for _ in texts), default=0.0) for texts in paragraphs]
    top = max(best)
    optional = set(optional_refs)
    vouched = {_chapter(ref) for ref in vouched_refs}
    matched = {_chapter(ref) for ref in matched_refs}
    phrases = list(phrases)
    # A phrase-matched source outranks a keyword match of the same score: its text says
    # what the question asks, not just its words ("what book is Samuel in").
    rank = [best[i] * (_MATCHED_BOOST if _chapter(sources[i].get("ref", "")) in matched else 1.0)
            for i in range(len(sources))]
    order = sorted(range(len(sources)), key=lambda i: -rank[i])
    return [
        sources[i] for i in order
        if sources[i].get("ref") not in optional or best[i] >= top * _MIN_SHARE_OF_BEST
        or (_chapter(sources[i].get("ref", "")) in vouched and best[i] > 0)
        or (phrases and any(_holds_phrase(text, phrases) for text in paragraphs[i]))
    ]


def _chapter(ref: str) -> str:
    """"Shulchan Arukh, Orach Chayim 250:1" -> "shulchan arukh, orach chayim 250"."""
    text = str(ref or "").replace("_", " ").replace(".", " ").strip().lower()
    match = _SEGMENT_RE.match(text)
    return f"{match.group(1)}{match.group(2)}".strip() if match else re.sub(r"\s+", " ", text)


def _payload(query: str, paths: Iterable[str] = SEARCH_PATHS) -> dict[str, Any]:
    paths = list(paths)
    return {
        "type": "text",
        "query": query,
        "field": "naive_lemmatizer",
        "source_proj": True,
        "slop": _SLOP,
        "start": 0,
        "size": _HITS_PER_SEARCH,
        "filters": paths,
        "filter_fields": ["path"] * len(paths),
        "aggs": [],
        "sort_method": "score",
        "sort_fields": ["pagesheetrank"],
        "sort_reverse": False,
        "sort_score_missing": 0.04,
    }


def _post_search(query: str, paths: Iterable[str] = SEARCH_PATHS) -> list[dict[str, Any]]:
    """One search -> the hits' sources ({"ref", "exact", ...}); [] on any failure."""
    try:
        resp = requests.post(SEARCH_URL, json=_payload(query, paths), timeout=_TIMEOUT_SECONDS)
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


def _queries(question: str, tanakh: bool = False) -> list[str]:
    """Pairs of the question's longest words (a rough stand-in for the most telling
    ones), neighbours first: the index wants every word of a query, so a long query
    finds nothing. The words are searched as written; the index does its own stemming."""
    words = question_words(question, tanakh)
    picked = set(sorted(words, key=len, reverse=True)[:_MAX_SEARCH_WORDS])
    words = [word for word in words if word in picked]
    if len(words) < 2:
        return words
    pairs = [(words[i], words[i + 1]) for i in range(len(words) - 1)]
    pairs += [pair for pair in combinations(words, 2) if pair not in pairs]
    return [" ".join(pair) for pair in pairs][:_MAX_SEARCHES]


def _run_searches(queries: list[str | tuple[str, tuple[str, ...]]]) -> list[dict[str, Any]]:
    """Every query at once; a query is its text (searched in the halachic codes) or
    (text, paths). The hits of those that answered in time."""
    jobs = [(query, SEARCH_PATHS) if isinstance(query, str) else query for query in queries]
    futures = [_executor.submit(_post_search, text, paths) for text, paths in jobs]
    done, _ = wait(futures, timeout=_TIMEOUT_SECONDS + 0.5)
    found: list[dict[str, Any]] = []
    for future in futures:
        if future in done and future.exception() is None:
            found.extend(future.result())
    return found


def _readable(ref: str) -> bool:
    """A primary text, not a commentary filed beside it."""
    lowered = ref.lower()
    return " on " not in lowered and not lowered.startswith(_COMMENTARY_PREFIXES)


def _best_refs(
    terms: list[str], hits: list[dict[str, Any]], known_refs: Iterable[str], limit: int = _MAX_EXTRA_REFS,
    phrases: Iterable[str] = (),
) -> list[str]:
    """The best-matching paragraphs among `hits`, one per chapter, skipping chapters the
    keyword table already brings."""
    texts: dict[str, str] = {}
    for hit in hits:
        ref = str(hit.get("ref") or "").strip()
        if _readable(ref):
            texts[ref] = f"{texts.get(ref, '')} {hit.get('exact') or ''}"
    refs = list(texts)
    phrases = list(phrases)
    scores = _scores(terms, [texts[ref] for ref in refs])
    known = {_chapter(ref) for ref in known_refs}
    picked: list[str] = []
    best = max(scores, default=0.0)
    exact = {ref for ref in refs if phrases and _holds_phrase(texts[ref], phrases)}
    for i in sorted(range(len(refs)), key=lambda i: (refs[i] not in exact, -scores[i])):
        ref = refs[i]
        if ref not in exact and scores[i] < best * _MIN_SHARE_OF_BEST:
            break
        if ref not in exact and len(_shared_terms(terms, _plain(texts[ref]))) < min(_MIN_SHARED_WORDS, len(terms)):
            break
        chapter = _chapter(ref)
        if chapter in known:
            continue
        known.add(chapter)
        picked.append(ref)
        if len(picked) >= limit:
            break
    return picked


def _plan_terms(plan: dict[str, list[str]]) -> list[str]:
    """The words the planner's phrases use, stemmed like the question's."""
    terms: list[str] = []
    for phrase in [*plan.get("english", []), *plan.get("hebrew", [])]:
        for term in question_terms(phrase):
            if term not in terms:
                terms.append(term)
    return terms


def _plan_or_none(future) -> dict[str, list[str]] | None:
    try:
        plan = future.result(timeout=question_plan.PLAN_WAIT_SECONDS + 0.5)
    except Exception:  # noqa: BLE001 - fail open: search on the question's words alone
        return None
    return plan if isinstance(plan, dict) else None


def find_sources(question: str, known_refs: Iterable[str] = ()) -> dict[str, list[str]]:
    """Refs worth reading for `question`, beyond the chapters in `known_refs`, and what
    to judge every loaded source by: ``{"refs", "terms", "phrases"}`` (pass terms and
    phrases on to rank_sources).

    Two searches run together. The question's own word pairs are searched in the
    halachic codes (in the Bible, for a question about the Bible). Meanwhile a small
    model (backend/question_plan.py) names the refs it expects and the phrases the
    texts would use; those phrases are then searched across the library's primary
    texts. The named refs come first, then the paragraphs that say a phrase word for
    word, then the best-matching others. None of it is trusted: the caller loads each ref and keeps only the ones whose own text
    matches (rank_sources with these "terms"). Empty lists when Sefaria is down or
    nothing is found; never raises."""
    tanakh = is_tanakh_question(question)
    terms = question_terms(question, tanakh)
    queries = _queries(question, tanakh)
    if not (queries or terms) or not health.is_healthy("sefaria"):
        return {"refs": [], "terms": [], "phrases": [], "vouched": [], "matched": []}
    known_refs = list(known_refs)
    key = ("t|" if tanakh else "") + " ".join(terms) + "|" + "|".join(sorted(_chapter(ref) for ref in known_refs))
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(key)
        if cached and now - cached[0] < _CACHE_TTL_SECONDS:
            return {name: list(value) for name, value in cached[1].items()}

    plan_future = _executor.submit(contextvars.copy_context().run, question_plan.plan, question)
    own_paths = TANAKH_PATHS if tanakh else SEARCH_PATHS
    hits = _run_searches([(query, own_paths) for query in queries])
    plan = _plan_or_none(plan_future) or {}
    phrases = [*plan.get("hebrew", []), *plan.get("english", [])]
    phrase_hits = _run_searches([(phrase, BROAD_PATHS) for phrase in phrases]) if phrases else []
    hits += phrase_hits
    phrase_chapters = {_chapter(hit.get("ref", "")) for hit in phrase_hits}
    all_terms = list(dict.fromkeys([*terms, *_plan_terms(plan)]))

    known = {_chapter(ref) for ref in known_refs}
    named = []
    for ref in plan.get("refs", [])[:_MAX_PLAN_REFS]:
        if _chapter(ref) not in known:
            known.add(_chapter(ref))
            named.append(ref)
    found = _best_refs(all_terms, hits, [*known_refs, *named], phrases=phrases)
    matched = [ref for ref in named + found if _chapter(ref) in phrase_chapters]
    result = {"refs": named + found, "terms": all_terms, "phrases": phrases,
              "vouched": list(dict.fromkeys(named + matched)), "matched": matched}
    with _cache_lock:
        if len(_cache) >= _CACHE_MAX:
            _cache.pop(next(iter(_cache)))
        _cache[key] = (now, result)
    return {name: list(value) for name, value in result.items()}


def search_refs(question: str, known_refs: Iterable[str] = ()) -> list[str]:
    """find_sources' refs alone."""
    return find_sources(question, known_refs)["refs"]
