"""
Common questions, answered once and served again.

When different readers ask the same question in the same setting (language,
answer mode, community, web search, prompt version, answer model), the answer
the first one got is served to the next ones straight away, without the 5-10 s
of source lookup and model time.

Matching allows a little variance and no more. ``question_key`` folds case,
accents, niqqud, quote marks and punctuation, a few transliteration variants
("shabbos" and "sabbath" are "shabbat") and polite filler at either end ("can
you tell me ...", "... thanks"). It never drops a content word, a number or a
negation, and the folded questions must then be identical: "can I cook on
Shabbat" and "can I not cook on Shabbat" stay two questions, and so do "how
long between meat and milk" and "how long between milk and meat".

What is never stored or served:

* a follow-up (its answer depends on the turns before it), and anything the
  caller does not offer (see the routes);
* a time-bound question ("today", "this week", "when is", zmanim, a year);
* an answer that was refused, came from the source-only fallback or the paused
  breaker, has no cited source, was personalised by the reader's saved
  memories, or is not safety class "ok";
* a question a reader marked "not helpful": that blocks it (``block``) for as
  long as an answer would have lived, so a wrong answer is not handed out again.

A reader is never served the cached answer to their own earlier ask of the
question: asking again usually means the first answer did not help.

The panel's composer can show a cached answer the moment it is sent
(static/js/common-answers.js). It loads only fingerprints (``fingerprint``,
SHA-256 of the folded question) of the questions at least ``LIST_AFTER``
different readers asked, never their text, and fetches an answer only for the
question its reader has typed.

Storage is backend/cache.py's TTLCache: in-process, plus Redis across
instances when RATE_LIMIT_REDIS_URL is set. Counts are read-modify-write, so two
instances may each miss one asker; that only delays a question's listing.
Blocking I/O (Redis): call from a worker thread on the ASGI side.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Any

from backend.cache import TTLCache

TTL_SECONDS = 3 * 24 * 3600
LIST_AFTER = 3          # distinct readers before a question is listed for the panel
MAX_LIST = 40
MAX_ASKERS = 8
MAX_QUESTION_CHARS = 200
FINGERPRINT_CHARS = 32

KIND_ASK = "ask"        # the /ask payload (search bar, signed-out panel)
KIND_THREAD = "thread"  # a conversation reply: {"answer", "citations"}
KINDS = (KIND_ASK, KIND_THREAD)

# One spelling per word for the transliterations readers mix. Sent to the
# browser with the fingerprints, so the two sides fold identically.
VARIANTS: dict[str, str] = {
    "shabbos": "shabbat", "shabbes": "shabbat", "shabbas": "shabbat", "shabat": "shabbat",
    "sabbath": "shabbat",
    "hanukkah": "chanukah", "hanukah": "chanukah", "chanuka": "chanukah", "chanukkah": "chanukah",
    "hanuka": "chanukah", "chanukka": "chanukah",
    "succos": "sukkot", "sukkos": "sukkot", "succot": "sukkot", "sukkoth": "sukkot",
    "pesah": "pesach",
    "tzitzis": "tzitzit", "tsitsit": "tzitzit",
    "mezuza": "mezuzah", "mezuzza": "mezuzah",
    "tfillin": "tefillin", "tefilin": "tefillin",
    "kashrus": "kashrut",
    "halakha": "halacha", "halakhah": "halacha", "halachah": "halacha",
    "bracha": "beracha", "brocha": "beracha", "berakha": "beracha", "berakhah": "beracha",
    "brachos": "berachot", "brachot": "berachot", "berakhot": "berachot", "berachos": "berachot",
    "kidush": "kiddush",
    "hashana": "hashanah",
    "kipur": "kippur",
    "moses": "moshe",
}

# Filler that can go without changing the question, as whole words at the
# start or the end. Only phrases with no content of their own.
LEADING_FILLER: tuple[tuple[str, ...], ...] = tuple(tuple(p.split()) for p in (
    "can you please tell me", "could you please tell me", "can you tell me", "could you tell me",
    "please tell me", "tell me", "i want to know", "i wanted to know", "i would like to know",
    "do you know", "quick question", "question", "please", "hey", "hi", "hello",
))
TRAILING_FILLER: tuple[tuple[str, ...], ...] = tuple(tuple(p.split()) for p in (
    "thank you very much", "thank you so much", "thank you", "thanks a lot", "thanks", "thx",
    "please",
))

# A question whose answer changes with the date or the reader's place.
_TIME_BOUND_RE = re.compile(
    r"\b(?:today|tonight|tomorrow|yesterday|now|currently|this (?:week|month|year|shabbat|morning|evening|afternoon)"
    r"|next (?:week|month|year|shabbat)|last (?:week|month|year)|when (?:is|does|do|will)|what time"
    r"|zmanim|zman|sunset|sunrise|nightfall|candle ?lighting time|daf yomi|omer count"
    r"|january|february|april|june|july|august|september|october|november|december"
    r"|(?:19|20|57|58)\d\d)\b"
    r"|היום|הלילה|מחר|אתמול|השבוע|השנה|מתי|זמני|שקיעה|הדלקת נרות",
)

# Hebrew points and cantillation (letters are 05D0-05EA); the maqaf joins words.
_HEBREW_MARKS_RE = re.compile(r"[\u0591-\u05bd\u05bf-\u05c7]")
_QUOTES_RE = re.compile(r"['\u2018\u2019`\"\u201c\u201d\u05f3\u05f4]")

_answers = TTLCache(maxsize=512, ttl=TTL_SECONDS, redis_prefix="common_answer:v1:")
_lists = TTLCache(maxsize=128, ttl=TTL_SECONDS, redis_prefix="common_answer_list:v1:")
_blocked = TTLCache(maxsize=2048, ttl=TTL_SECONDS, redis_prefix="common_answer_blocked:v1:")


def _strip(tokens: list[str], phrases: tuple[tuple[str, ...], ...], at_start: bool) -> list[str]:
    changed = True
    while changed and tokens:
        changed = False
        for phrase in phrases:
            n = len(phrase)
            if n >= len(tokens):
                continue  # filler never takes the whole question
            part = tokens[:n] if at_start else tokens[-n:]
            if tuple(part) == phrase:
                tokens = tokens[n:] if at_start else tokens[:-n]
                changed = True
                break
    return tokens


def question_key(question: str) -> str:
    """The question folded for matching (module docstring); "" for nothing."""
    # Unicode categories, not str methods, so static/js/common-answers.js
    # (\p{M}, \p{L}, \p{N}) folds every character the same way.
    text = unicodedata.normalize("NFD", str(question or "").replace("\u05be", " "))
    text = "".join(ch for ch in text if not unicodedata.category(ch).startswith("M"))
    text = _HEBREW_MARKS_RE.sub("", text).lower()
    text = _QUOTES_RE.sub("", text)
    text = "".join(ch if unicodedata.category(ch)[0] in "LN" else " " for ch in text)
    tokens = [VARIANTS.get(token, token) for token in text.split()]
    tokens = _strip(tokens, LEADING_FILLER, at_start=True)
    tokens = _strip(tokens, TRAILING_FILLER, at_start=False)
    return " ".join(tokens)


def fingerprint(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:FINGERPRINT_CHARS]


def scope(language: str, mode: str, community: str, web_search: Any, version: str) -> str:
    """The setting an answer belongs to. ``version`` names the prompt and the
    answer model, so a change to either starts afresh."""
    web = "noweb" if web_search is False else "web"
    return "|".join((str(language or "en"), str(mode or "balanced"), str(community or "All").lower(), web, version))


def cacheable_question(question: str) -> bool:
    text = str(question or "")
    if not text.strip() or len(text) > MAX_QUESTION_CHARS:
        return False
    if _TIME_BOUND_RE.search(text.lower()):
        return False
    return len(question_key(text).split()) >= 2


def _entry_key(scope_id: str, print_: str) -> str:
    return f"{scope_id}#{print_}"


def is_blocked(question: str) -> bool:
    return _blocked.get(fingerprint(question_key(question))) is not None


def block(question: str) -> None:
    """A reader marked an answer to this question not helpful: stop serving
    it, in every setting, and keep it out of the cache for TTL_SECONDS."""
    key = question_key(question)
    if key:
        _blocked.set(fingerprint(key), True)


def lookup(question: str, scope_id: str, kind: str, asker: str) -> Any | None:
    """The stored answer of ``kind`` for this question, or None. Not for the
    reader who asked it before (see the module docstring). A hit counts the
    reader as one more asker."""
    if kind not in KINDS or not cacheable_question(question) or is_blocked(question):
        return None
    print_ = fingerprint(question_key(question))
    entry = _answers.get(_entry_key(scope_id, print_))
    if not isinstance(entry, dict) or entry.get(kind) is None:
        return None
    askers = list(entry.get("askers") or [])
    if asker in askers:
        return None
    _record_asker(scope_id, print_, entry, asker)
    return entry[kind]


def remember(question: str, scope_id: str, kind: str, asker: str, answer: Any) -> None:
    """Store ``answer`` (already checked as worth keeping by the caller) for
    the next reader who asks this question in this setting."""
    if kind not in KINDS or answer is None or not cacheable_question(question) or is_blocked(question):
        return
    print_ = fingerprint(question_key(question))
    entry = _answers.get(_entry_key(scope_id, print_))
    entry = dict(entry) if isinstance(entry, dict) else {"askers": []}
    if entry.get(kind) is None:
        entry[kind] = answer
    _record_asker(scope_id, print_, entry, asker)


def _record_asker(scope_id: str, print_: str, entry: dict[str, Any], asker: str) -> None:
    askers = [a for a in (entry.get("askers") or []) if a != asker][-(MAX_ASKERS - 1):] + [asker]
    entry = {**entry, "askers": askers}
    _answers.set(_entry_key(scope_id, print_), entry)
    if len(askers) >= LIST_AFTER:
        _list_question(scope_id, print_, len(askers))


def _list_question(scope_id: str, print_: str, count: int) -> None:
    listed = _lists.get(scope_id)
    counts = {str(p): int(c) for p, c in (listed or []) if isinstance(p, str)} if isinstance(listed, list) else {}
    counts[print_] = max(count, counts.get(print_, 0))
    top = sorted(counts.items(), key=lambda item: -item[1])[:MAX_LIST]
    _lists.set(scope_id, [[p, c] for p, c in top])


def listed(scope_id: str) -> list[str]:
    """Fingerprints of this setting's common questions, most asked first."""
    found = _lists.get(scope_id)
    if not isinstance(found, list):
        return []
    return [p for p, _count in found if isinstance(p, str)]


def listed_answer(scope_id: str, print_: str, kind: str) -> Any | None:
    """The answer behind a listed fingerprint, for the reader who typed the
    question (the panel only asks for the one in its composer)."""
    if kind not in KINDS or print_ not in listed(scope_id):
        return None
    if _blocked.get(print_) is not None:
        return None
    entry = _answers.get(_entry_key(scope_id, print_))
    return entry.get(kind) if isinstance(entry, dict) else None


def version(prompt_version: str, provider: str) -> str:
    return f"{prompt_version}:{provider}"


def _meta(payload: dict[str, Any]) -> dict[str, Any]:
    meta = payload.get("meta")
    return meta if isinstance(meta, dict) else {}


def _security_clear(security: Any) -> bool:
    """Nothing in the question or the answer tripped a check."""
    if not security:
        return True
    if not isinstance(security, dict):
        return False
    found = security.get("input") or {}
    said = security.get("output") or {}
    return not (
        found.get("blocked") or found.get("reasons") or found.get("markers")
        or said.get("blocked")
    )


def ask_worth_keeping(payload: Any) -> bool:
    """Whether an /ask answer may be handed to other readers (module docstring)."""
    if not isinstance(payload, dict) or not str(payload.get("answer") or "").strip():
        return False
    meta = _meta(payload)
    return (
        not meta.get("fallback", True)
        and meta.get("safety_class") == "ok"
        and not meta.get("input_sanitized")
        and _security_clear(meta.get("security"))
        and not meta.get("memory_count")
        and not meta.get("cached")
        and bool(payload.get("ai_cited_sources"))
    )


def ask_to_store(payload: dict[str, Any]) -> dict[str, Any]:
    """The answer without what belongs to the reader who got it."""
    meta = {k: v for k, v in _meta(payload).items() if k not in ("identity_aware", "guest")}
    return {**{k: v for k, v in payload.items() if k not in ("history_id", "guest")}, "meta": meta}


def ask_to_serve(stored: dict[str, Any], history_id: Any, user_id: str | None) -> dict[str, Any]:
    meta = {**_meta(stored), "identity_aware": bool(user_id), "cached_common": True}
    return {**stored, "history_id": history_id, "meta": meta}


def thread_worth_keeping(result: Any, structured: Any, cited: Any, ctx: Any) -> bool:
    """Whether a conversation's first reply may be handed to other readers.
    ``cited`` is what the answer itself cites (not the retrieved fallback)."""
    if not isinstance(result, dict) or result.get("error") or result.get("is_fallback"):
        return False
    structured = structured if isinstance(structured, dict) else {}
    memories = (ctx or {}).get("user_memory_summaries") if isinstance(ctx, dict) else None
    return (
        structured.get("safety_class", "ok") == "ok"
        and not structured.get("out_of_scope")
        and _security_clear(result.get("security"))
        and not memories
        and bool(cited)
    )


def asker_id(user_id: str | None, client_ip: str | None) -> str:
    """Who asked, without keeping who: a hash of the account or the address."""
    raw = f"user:{user_id}" if user_id else f"ip:{client_ip or ''}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def client_config() -> dict[str, Any]:
    """The folding rules, for static/js/common-answers.js."""
    return {
        "variants": VARIANTS,
        "leading": [" ".join(p) for p in LEADING_FILLER],
        "trailing": [" ".join(p) for p in TRAILING_FILLER],
    }


def clear() -> None:
    """For tests."""
    for cache in (_answers, _lists, _blocked):
        cache.clear()
