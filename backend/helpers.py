"""
Shared helpers, constants, and word-meaning/translation utilities for Sh'elah blueprints.

All implementations are self-contained — no lazy proxies to app.py.

Hebrew word-meaning lookup chain:
  local glossary → Sefaria BDB/Jastrow → Google Translate → MyMemory

Alternatives pipeline:
  interpretive glossary → parsed meaning candidates → Sefaria lexicon variants
  (falls back to Google Translate only when Sefaria has no result)
"""

import html
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import unquote, quote, urlparse

import requests as _requests
from flask import request as _flask_request

# Canonical HEBREW_DIACRITICS_RE/RABBI_FINAL_RULING_FOOTER now live in
# backend/utils/text_engine.py (backend refactor) —
# re-imported here to avoid the divergent-duplicate constants that previously
# existed in both files.
from backend.csp import DEFAULT_CONTENT_SECURITY_POLICY
from backend.utils.text_engine import HEBREW_DIACRITICS_RE, RABBI_FINAL_RULING_FOOTER
# Backend refactor: HEBREW_WORD_GLOSSARY, _translate_text_google,
# _translate_text_mymemory, _is_translation_echo, and _extract_google_translated_text
# now live in backend/utils/search_provider.py as the single canonical
# implementation (they were previously diverged, duplicated copies). Re-imported here to avoid reintroducing the duplicate.
# HEBREW_LETTER_RE and INTERNAL_AI_KNOWLEDGE_DISCLAIMER were also independently
# duplicated and are reconciled the same way.
from backend.utils.search_provider import (
    HEBREW_WORD_GLOSSARY,
    HEBREW_LETTER_RE,
    INTERNAL_AI_KNOWLEDGE_DISCLAIMER,
    _is_translation_echo,
    _extract_google_translated_text,  # noqa: F401 -- consumed as helpers._extract_google_translated_text by tests/test_helpers.py
    _translate_text_google,
    _translate_text_mymemory,
)

# ── Same-origin request check ───────────────────────────────────────────────────
# Shared by any route that needs CSRF-style protection beyond SameSite=Lax's
# cookie-attribute default — e.g. a GET handler that has a side effect (see
# routes_calendar.py's zmanim endpoints, security audit P2: SameSite=Lax
# still allows cookies on cross-site top-level GET navigation, so a plain
# GET-with-side-effect needs its own origin check) or a POST route reachable
# without a Clerk bearer token (routes_devtools.py's /api/client-errors).


def _is_same_origin_request() -> bool:
    """Origin (falling back to Referer) must match this request's own Host.

    Compares against request.host rather than a hardcoded domain so this
    works unchanged across production and Vercel preview deployments.
    """
    origin = (_flask_request.headers.get("Origin") or _flask_request.headers.get("Referer") or "").strip()
    if not origin:
        return False
    try:
        origin_host = urlparse(origin).netloc
    except ValueError:
        return False
    return bool(origin_host) and origin_host == _flask_request.host


# ── Response security headers ──────────────────────────────────────────────────
# Single source of truth for both transports: app.py's Flask
# @app.after_request applies these to every WSGI-mounted route, and asgi.py's
# request_id_middleware applies them (setdefault-style, so it never clobbers
# what Flask already set) to native FastAPI routes like /ask that bypass the
# WSGI mount entirely and would otherwise ship with none of this (security
# audit P2 — headers previously only covered the Flask-routed half of the
# app). Defined once here so the two transports can't drift out of sync.
#
# The Content-Security-Policy is built in backend/csp.py: script-src has no
# 'unsafe-inline' (inline scripts are admitted by hash, inline event handlers
# are refused outright). The value below is the default for responses that are
# not an HTML document with inline scripts; app.py's after_request replaces it
# per HTML response with the hashes of that page's own scripts. style-src still
# allows 'unsafe-inline' -- see backend/csp.py and docs/SECURITY.md.
SECURITY_RESPONSE_HEADERS = {
    "X-Frame-Options": "SAMEORIGIN",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    # X-XSS-Protection intentionally omitted — deprecated, ignored by modern
    # browsers, and can introduce vulnerabilities in old ones.
    # geolocation=() — the app never calls navigator.geolocation (removed
    # 2026-08-21 in favor of the session-cookie + IP-geolocation fallback
    # already used server-side by get_engine() in app.py).
    # microphone=(self) — the composer's dictation button (conversation-voice.js)
    # needs the site's own origin allowed, or the browser refuses without ever
    # showing its permission prompt. Third-party frames stay blocked.
    "Permissions-Policy": (
        "geolocation=(), camera=(), microphone=(self), payment=(), usb=(), "
        "magnetometer=(), gyroscope=(), interest-cohort=()"
    ),
    # HSTS: force HTTPS on every subsequent visit. Vercel terminates TLS in
    # front of this app, so this is safe to set unconditionally.
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "Content-Security-Policy": DEFAULT_CONTENT_SECURITY_POLICY,
}

# ── Answer-mode & source-attribution constants ────────────────────────────────

ANSWER_MODES = {"balanced", "practical", "sources", "strict"}

# ── Bounded cache ─────────────────────────────────────────────────────────────

_CACHE_MAX_SIZE = 512


def _bounded_cache_set(cache: dict, key, value, maxsize: int = _CACHE_MAX_SIZE) -> None:
    if key not in cache and len(cache) >= maxsize:
        cache.pop(next(iter(cache)), None)
    cache[key] = value


TRANSLATION_CACHE: dict = {}
TRANSLATION_SOURCE_CACHE: dict = {}

# ── Text aliases ──────────────────────────────────────────────────────────────

_EARLY_PROPHETS_EVERETT_FOX_CITATION = "The Early Prophets, by Everett Fox, Joshua, Part I; Preparations for Conquest"

QUICK_TEXT_ALIASES = {
    "genesis": "Genesis 1",
    "bereishit": "Genesis 1",
    "exodus": "Exodus 1",
    "shemot": "Exodus 1",
    "leviticus": "Leviticus 1",
    "vayikra": "Leviticus 1",
    "numbers": "Numbers 1",
    "bamidbar": "Numbers 1",
    "deuteronomy": "Deuteronomy 1",
    "devarim": "Deuteronomy 1",
    "psalms": "Psalms 1",
    "tehillim": "Psalms 1",
    "proverbs": "Proverbs 1",
    "mishlei": "Proverbs 1",
    "jonathan sacks": "Covenant and Conversation; Genesis; The Book of the Beginnings, Living with the Times; The Parasha",
    "jonathan sacks essays": "The Jonathan Sacks Haggadah; Essays, The Story of Stories",
    "jonathan sacks haggadah essays": "The Jonathan Sacks Haggadah; Essays, The Story of Stories",
    "covenant and conversation": "Covenant and Conversation; Genesis; The Book of the Beginnings, Living with the Times; The Parasha",
    "everett fox": _EARLY_PROPHETS_EVERETT_FOX_CITATION,
    "the early prophets by everett fox": _EARLY_PROPHETS_EVERETT_FOX_CITATION,
    "the early prophets, by everett fox": _EARLY_PROPHETS_EVERETT_FOX_CITATION,
    "the five books of moses by everett fox": "The Five Books of Moses, by Everett Fox, Translator's Preface",
    "the five books of moses, by everett fox": "The Five Books of Moses, by Everett Fox, Translator's Preface",
}

# ── Community registry ────────────────────────────────────────────────────────

COMMUNITIES = {
    "Ashkenaz": "ashkenaz",
    "Bukharian": "bukharian",
    "Ethiopian": "ethiopian",
    "Georgian": "georgian",
    "Greek-Romaniote": "greek-romaniote",
    "Iraqi": "iraqi",
    "Kavkazi": "mountain-jewish-kavkazi",
    "Syrian": "syrian",
    "Persian": "persian",
    "Sefardic": "sefardic",
    "Turkish-Ottoman": "turkish-ottoman-sefardic",
    "Yemenite": "yemenite",
    "Moroccan": "moroccan",
    "Israeli": "sefardic",
}

COMMUNITY_ALIASES = {
    "ashkenazi": "Ashkenaz",
    "ashkenaz": "Ashkenaz",
    "sefardi": "Sefardic",
    "sephardi": "Sefardic",
    "sefardic": "Sefardic",
    "sephardic": "Sefardic",
    "iraqi": "Iraqi",
    "mizrahi": "Iraqi",
    "syrian": "Syrian",
    "yemenite": "Yemenite",
    "yemeni": "Yemenite",
    "moroccan": "Moroccan",
    "morrocan": "Moroccan",
    "israeli": "Israeli",
    "israel": "Israeli",
    "kavkazi": "Kavkazi",
    "mountain jewish": "Kavkazi",
    "mountain-jewish": "Kavkazi",
    "kavkazi jews": "Kavkazi",
    "mountain-jewish-kavkazi": "Kavkazi",
    "bukharan": "Bukharian",
    "bukharian": "Bukharian",
    "ethiopian": "Ethiopian",
    "beta israel": "Ethiopian",
    "georgian": "Georgian",
    "persian": "Persian",
    "iranian": "Persian",
    "greek": "Greek-Romaniote",
    "romaniote": "Greek-Romaniote",
    "greek-romaniote": "Greek-Romaniote",
    "turkish": "Turkish-Ottoman",
    "ottoman": "Turkish-Ottoman",
    "ottoman sefardic": "Turkish-Ottoman",
    "turkish ottoman": "Turkish-Ottoman",
    "turkish ottoman sefardic": "Turkish-Ottoman",
    "turkish-ottoman community": "Turkish-Ottoman",
    "turkish ottoman community": "Turkish-Ottoman",
    "turkish-ottoman": "Turkish-Ottoman",
    "turkish-ottoman-sefardic": "Turkish-Ottoman",
}

# ── Hebrew constants ──────────────────────────────────────────────────────────

HEBREW_INTERPRETIVE_GLOSSARY = {
    "ברא": ["create", "fashion", "bring into being"],
    "עשה": ["make", "do", "perform"],
    "אמר": ["say", "speak", "declare"],
    "הלך": ["go", "walk", "proceed"],
    "שמר": ["guard", "keep", "observe"],
}

# ── Hebrew text utilities ─────────────────────────────────────────────────────


def _strip_hebrew_diacritics(text):
    return HEBREW_DIACRITICS_RE.sub("", str(text or ""))


def _contains_hebrew_letters(text):
    return bool(HEBREW_LETTER_RE.search(str(text or "")))


def _normalize_lookup_word(text):
    cleaned = _strip_hebrew_diacritics(text).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


def _normalize_glossary_meaning(value):
    text = re.sub(r"\s+", " ", str(value or "").strip())
    if not text:
        return ""
    if "," in text:
        head, tail = text.split(",", 1)
        if re.fullmatch(r"[A-Za-z'\-\s]{2,40}", head.strip()) and tail.strip():
            return tail.strip()
    return text


def _tokenize_for_transliteration_check(text):
    """Normalize and validate `text` for the transliteration heuristics
    below, returning (tokens, lower) -- or ([], "") if it doesn't look
    like a plausible transliterated word at all. Split out of
    _looks_like_transliteration() (SonarCloud python:S3776).
    """
    value = re.sub(r"\s+", " ", str(text or "").strip())
    if not value:
        return [], ""
    if not re.fullmatch(r"[A-Za-z'\-\s]{2,80}", value):
        return [], ""

    lower = value.lower()
    tokens = [part for part in lower.split(" ") if part]
    return tokens, lower


def _has_apostrophe_or_hyphen_token(tokens):
    """A token containing ' or - is a strong transliteration signal (e.g.
    "b'rosh", "kavod-melech"). Split out of _looks_like_transliteration()
    (SonarCloud python:S3776).
    """
    return any("'" in token or "-" in token for token in tokens)


def _has_short_transliteration_marker(tokens, lower):
    """A short phrase containing a Hebrew-transliteration digraph (sh, kh,
    tz, ...). Split out of _looks_like_transliteration() (SonarCloud
    python:S3776).
    """
    translit_markers = ("sh", "kh", "tz", "ts", "aa", "ee", "oo", "iy", "ui")
    return len(tokens) <= 3 and any(marker in lower for marker in translit_markers)


def _all_tokens_end_with_transliteration_suffix(tokens):
    """Every token (of at most 2) ends with a common Hebrew-transliteration
    suffix (im, ot, ah, ...). Split out of _looks_like_transliteration()
    (SonarCloud python:S3776).
    """
    translit_suffixes = ("im", "ot", "ah", "eh", "it", "ut", "iyyah")
    return len(tokens) <= 2 and all(
        any(token.endswith(suffix) for suffix in translit_suffixes) for token in tokens
    )


def _is_short_vowel_ending_token(tokens):
    """A single short token ending in a vowel (e.g. "ima"). Split out of
    _looks_like_transliteration() (SonarCloud python:S3776).
    """
    return len(tokens) == 1 and len(tokens[0]) <= 4 and tokens[0].endswith(("a", "e", "i", "o", "u"))


def _looks_like_transliteration(text):
    tokens, lower = _tokenize_for_transliteration_check(text)
    if not tokens:
        return False

    return (
        _has_apostrophe_or_hyphen_token(tokens)
        or _has_short_transliteration_marker(tokens, lower)
        or _all_tokens_end_with_transliteration_suffix(tokens)
        or _is_short_vowel_ending_token(tokens)
    )


# ── Pure utilities ────────────────────────────────────────────────────────────


def _coerce_int(value, default, min_value=1, max_value=100):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(min_value, min(parsed, max_value))


def _json_object_body():
    """The request's JSON body when it is an object, else ``{}``: the value an
    empty or unparsable body already gives, so the route's own validation
    answers it. A JSON array, string or number used to reach ``.get()`` and
    surface as a 500 (and an error-bot alert) for the caller's malformed body."""
    payload = _flask_request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


# Trust order verified against Vercel's own request-headers reference: Vercel
# overwrites X-Forwarded-For (and sets X-Vercel-Forwarded-For) so client-
# supplied values for those two headers cannot pass through unmodified.
# CF-Connecting-IP is deliberately never read here — this deployment has no
# Cloudflare in front of it, so that header arrives verbatim from whoever
# sends it and is trivially spoofable (previously read
# first, independently, in both app.py's _rate_limit_key and asgi.py's
# _get_client_ip -- reconciled here into the one implementation both import).
def _resolve_client_ip(headers, remote_addr=None, default="unknown"):
    for header in ("X-Vercel-Forwarded-For", "X-Forwarded-For", "X-Real-IP"):
        value = (headers.get(header) or "").split(",")[0].strip()
        if value:
            return value
    return (remote_addr or "").strip() or default


def _decode_route_ref(value, max_rounds=3):
    decoded = str(value or "").strip()
    for _ in range(max_rounds):
        next_value = unquote(decoded).strip()
        if next_value == decoded:
            break
        decoded = next_value
    return decoded


# ── Translation infrastructure ────────────────────────────────────────────────

# Backend refactor: GOOGLE_TRANSLATE_API_URL,
# MYMEMORY_TRANSLATE_API_URL, _is_translation_echo, _extract_google_translated_text,
# _translate_text_google, and _translate_text_mymemory moved to
# backend/utils/search_provider.py as the single canonical implementation
# (re-imported above; search: "Backend refactor").


def _translate_hebrew_text_google(text):
    value = str(text or "").strip()
    if not value or not _contains_hebrew_letters(value):
        return ""
    translated = _translate_text_google(value, "he", "en")
    if not translated or _is_translation_echo(value, translated):
        return ""
    return translated


def _translate_hebrew_text_mymemory(text):
    value = str(text or "").strip()
    if not value or not _contains_hebrew_letters(value):
        return ""
    translated = _translate_text_mymemory(value, "he", "en")
    if not translated or _is_translation_echo(value, translated):
        return ""
    return translated


def _translate_hebrew_text_online(text, try_fallback=True):
    """Hebrew → English: Google first, MyMemory fallback. Results cached.

    try_fallback=False skips the MyMemory round-trip on a Google miss --
    each provider has its own 2.5s network timeout (search_provider.py), so
    the full chain can cost ~5s per call. _fill_missing_english_lines()
    below calls this per-line on the request path that renders a commentary
    passage, and that latency compounding across several lines is what made
    the reader/commentary sidebar feel "extremely slow and unresponsive"
    (worth it for a single user-initiated lookup elsewhere; not worth it for
    a best-effort bulk auto-translate blocking a page render).
    """
    value = _normalize_lookup_word(text)
    if not value or not _contains_hebrew_letters(value):
        return "", ""

    cache_key = value[:320]
    if cache_key in TRANSLATION_CACHE:
        return TRANSLATION_CACHE.get(cache_key, ""), TRANSLATION_SOURCE_CACHE.get(cache_key, "")

    translated = _translate_hebrew_text_google(cache_key)
    source = "google-translate"

    if not translated and try_fallback:
        translated = _translate_hebrew_text_mymemory(cache_key)
        source = "mymemory-translate"

    # A miss with try_fallback=False hasn't exhausted every provider, so it
    # isn't a definitive "no translation available" -- don't cache it, or a
    # later try_fallback=True call for the same text would see the cached
    # empty result and skip MyMemory entirely, losing that fallback for good.
    if translated or try_fallback:
        _bounded_cache_set(TRANSLATION_CACHE, cache_key, translated)
        _bounded_cache_set(TRANSLATION_SOURCE_CACHE, cache_key, source if translated else "")

    return (translated, source) if translated else ("", "")


def _translate_english_text_online(text):
    """English → Hebrew: Google first, MyMemory fallback. Results cached."""
    value = _normalize_lookup_word(text)
    if not value:
        return "", ""

    cache_key = f"en-he::{value[:320]}"
    if cache_key in TRANSLATION_CACHE:
        return TRANSLATION_CACHE.get(cache_key, ""), TRANSLATION_SOURCE_CACHE.get(cache_key, "")

    translated = _translate_text_google(value, "en", "he")
    source = "google-translate"

    if not translated or _is_translation_echo(value, translated):
        translated = _translate_text_mymemory(value, "en", "he")
        source = "mymemory-translate"

    if _is_translation_echo(value, translated):
        translated = ""

    _bounded_cache_set(TRANSLATION_CACHE, cache_key, translated)
    _bounded_cache_set(TRANSLATION_SOURCE_CACHE, cache_key, source if translated else "")

    return (translated, source) if translated else ("", "")


# ── Sefaria lexicon (Klein, BDB, Jastrow) ─────────────────────────────────────

_SEFARIA_LEXICON_BASE = "https://www.sefaria.org/api/words/"
# The lexicons a word meaning may come from, best first. Klein gives plain
# English glosses ("king, sovereign"); Jastrow and BDB are denser and only
# fill in when Klein has nothing. Everything else Sefaria returns for a word
# (Ben Yehuda's Hebrew prose with its footnotes, the Aramaic BDB) is commentary
# on the word, not a gloss, and is never shown.
_PREFERRED_LEXICONS = ("klein dictionary", "bdb augmented strong", "jastrow dictionary", "bdb dictionary")
_DENSE_LEXICONS = frozenset({"jastrow dictionary", "bdb dictionary"})
LEXICON_GLOSS_MAX_CHARS = 90
LEXICON_SENSES_PER_GLOSS = 3
LEXICON_GLOSSES_PER_WORD = 3

_PAREN_GROUP_RE = re.compile(r"\([^()]*\)|\[[^\[\]]*\]")
# Part-of-speech tags a dense entry opens with ("n.m.", "v. intr.").
_LEXICON_POS_TAG_RE = re.compile(
    r"\s*(?:n|v|adj|adv|prep|conj|pron|interj|vb|pr|denom|intr|tr|pl|sing|[mf])\.\s*", re.IGNORECASE)
_LEXICON_SPACE_BEFORE_PUNCT_RE = re.compile(r"\s+([,;:.])")
_GLOSS_TRIM_CHARS = " .;,:"
_NOT_HEBREW_LETTER_RE = re.compile(r"[^א-ת]")
_NOT_A_GLOSS_RE = re.compile(r"^(?:=|see\b|v\.|cf\.|prefix\b|abbr)", re.IGNORECASE)


def _without_lexicon_pos(text):
    """The sense without the part-of-speech tags it opens with ("n.m.", "v. intr.")."""
    end = 0
    while match := _LEXICON_POS_TAG_RE.match(text, end):
        end = match.end()
    return text[end:]


def _clean_lexicon_gloss(raw_definition, dense=False):
    """One lexicon sense as a short English gloss, or "". Tags, parentheses
    and part-of-speech labels go; a dense (BDB, Jastrow) sense is cut at its
    first clause. A sense that is a cross-reference, or mostly Hebrew, is not
    a gloss."""
    text = re.sub(r"<[^>]+>", "", str(raw_definition or ""))
    text = html.unescape(text)
    for _ in range(2):
        text = _PAREN_GROUP_RE.sub(" ", text)
    text = _LEXICON_SPACE_BEFORE_PUNCT_RE.sub(r"\1", " ".join(text.split()))
    text = _without_lexicon_pos(text)
    text = re.split(r"[;—]| - " if dense else r"\.\s", text, maxsplit=1)[0].strip(_GLOSS_TRIM_CHARS)
    if not re.search(r"[A-Za-z]", text) or _NOT_A_GLOSS_RE.match(text):
        return ""
    if len(HEBREW_LETTER_RE.findall(text)) * 4 > len(text):
        return ""
    if len(text) > LEXICON_GLOSS_MAX_CHARS:
        text = text[:LEXICON_GLOSS_MAX_CHARS].rsplit(" ", 1)[0].strip(_GLOSS_TRIM_CHARS)
    return text


def _gloss_from_lexicon_entry(entry, dense):
    """The first few senses of one lexicon entry joined into one gloss
    ("that; because; when, while, as"), or ""."""
    senses = ((entry or {}).get("content") or {}).get("senses")
    if not isinstance(senses, list):
        return ""
    parts = []
    for sense in senses:
        gloss = _clean_lexicon_gloss(sense.get("definition") if isinstance(sense, dict) else "", dense)
        if gloss and gloss.lower() not in {part.lower() for part in parts}:
            parts.append(gloss)
        if len(parts) == LEXICON_SENSES_PER_GLOSS:
            break
    joined = "; ".join(parts)
    if len(joined) > LEXICON_GLOSS_MAX_CHARS:
        joined = joined[:LEXICON_GLOSS_MAX_CHARS].rsplit(";", 1)[0].strip(_GLOSS_TRIM_CHARS) or parts[0]
    return joined


_VOCALIZATION_KEEP_RE = re.compile(r"[^\u05B0-\u05BC\u05C1\u05C2\u05D0-\u05EA]")


def _vocalization_key(text):
    """A Hebrew word's letters and vowel points, without cantillation marks or
    anything else, so a pointed word can be matched to a lexicon headword."""
    return _VOCALIZATION_KEEP_RE.sub("", unicodedata.normalize("NFC", str(text or "")))


def _lexicon_candidates(entries, consonants):
    """(lexicon, vocalization, gloss) for each entry of a preferred lexicon
    that is exactly this word, in Sefaria's order. Entries for other headwords,
    which Sefaria also returns, are skipped."""
    candidates = []
    for entry in entries:
        lexicon = str((entry or {}).get("parent_lexicon") or "").strip()
        if lexicon.lower() not in _PREFERRED_LEXICONS:
            continue
        headword = str(entry.get("headword") or "")
        if _NOT_HEBREW_LETTER_RE.sub("", headword) != consonants:
            continue
        gloss = _gloss_from_lexicon_entry(entry, lexicon.lower() in _DENSE_LEXICONS)
        if gloss:
            candidates.append((lexicon, _vocalization_key(headword), gloss))
    return tuple(candidates)


def _pick_lexicon_glosses(candidates, vocalized=""):
    """(glosses, lexicon_name) from the best lexicon: one gloss per entry
    (homographs give one each), at most LEXICON_GLOSSES_PER_WORD. A pointed
    word (בָּרָא, "created") has the entries pointed the same way first, so it
    is not answered with its homograph בְּרָא, "son"; the lexicon is the best one
    that has such an entry."""
    exact = [candidate for candidate in candidates if vocalized and candidate[1] == vocalized]
    ordered = exact + [candidate for candidate in candidates if candidate not in exact]
    by_lexicon = {}
    for lexicon, _, gloss in ordered:
        by_lexicon.setdefault(lexicon, []).append(gloss)
    ranked = sorted(by_lexicon, key=lambda name: _PREFERRED_LEXICONS.index(name.lower()))
    exact_lexicons = {candidate[0] for candidate in exact}
    if not ranked:
        return [], ""
    lexicon = next((name for name in ranked if name in exact_lexicons), ranked[0])
    return list(dict.fromkeys(by_lexicon[lexicon]))[:LEXICON_GLOSSES_PER_WORD], lexicon


def _parse_sefaria_lexicon_response(resp):
    """Validate and parse one Sefaria lexicon HTTP response into an
    entries list, or None if the response wasn't usable (non-OK status or
    an unexpected payload shape). Split out of _lookup_sefaria_lexicon_glosses()
    (SonarCloud python:S3776).
    """
    if not resp.ok:
        return None
    entries = resp.json() if resp.content else []
    if not isinstance(entries, list):
        return None
    return entries


def _lookup_sefaria_lexicon_glosses(word):
    """Short glosses for a Hebrew word from Sefaria's Klein, BDB or Jastrow
    lexicon. Returns (glosses, lexicon_name) or ([], ""). A word written with
    vowel points is matched to the lexicon entries pointed the same way."""
    value = str(word or "").strip()
    if not value or not _contains_hebrew_letters(value):
        return [], ""

    consonants = _NOT_HEBREW_LETTER_RE.sub("", value)
    vocalized = _vocalization_key(value)
    vocalized = vocalized if vocalized != consonants else ""
    cache_key = f"sefaria-gloss::{consonants[:80]}"
    if cache_key in TRANSLATION_CACHE:
        return _pick_lexicon_glosses(TRANSLATION_CACHE[cache_key], vocalized)

    try:
        resp = _requests.get(
            _SEFARIA_LEXICON_BASE + quote(consonants, safe=""),
            params={"always_consonants": "1"},
            headers={"User-Agent": "Shelah-App/1.0", "Accept": "application/json"},
            timeout=3.0,
        )
        entries = _parse_sefaria_lexicon_response(resp)
        candidates = _lexicon_candidates(entries or [], consonants)
        _bounded_cache_set(TRANSLATION_CACHE, cache_key, candidates)
        return _pick_lexicon_glosses(candidates, vocalized)
    except Exception:
        return [], ""


def _lookup_sefaria_lexicon(word):
    """Look up a Hebrew word in Sefaria's lexicon.
    Returns (gloss, lexicon_name) or ("", "")."""
    glosses, lex_name = _lookup_sefaria_lexicon_glosses(word)
    return (glosses[0], lex_name) if glosses else ("", "")


# ── English dictionary lookup ─────────────────────────────────────────────────


def _first_definition_text_in_meanings(meanings):
    """Return the first non-blank definition text found across all
    dictionaryapi.dev meaning entries, or "". Split out of
    _extract_definition_from_dictionaryapi_payload() (SonarCloud
    python:S3776).
    """
    for meaning in meanings:
        definitions = meaning.get("definitions", []) if isinstance(meaning, dict) else []
        for definition in definitions:
            text = str((definition or {}).get("definition") or "").strip()
            if text:
                return text
    return ""


def _extract_definition_from_dictionaryapi_payload(payload):
    """Pull the first non-blank definition text out of a dictionaryapi.dev
    response payload, or "" if none exists. Split out of
    _lookup_english_word_meaning() (SonarCloud python:S3776).
    """
    if not isinstance(payload, list) or not payload:
        return ""
    entry = payload[0] if isinstance(payload[0], dict) else {}
    meanings = entry.get("meanings", []) if isinstance(entry.get("meanings"), list) else []
    return _first_definition_text_in_meanings(meanings)


def _lookup_english_word_meaning(word):
    clean_word = str(word or "").strip().lower()
    if not clean_word:
        return "", ""
    try:
        resp = _requests.get(
            f"https://api.dictionaryapi.dev/api/v2/entries/en/{quote(clean_word, safe='')}",
            timeout=5,
        )
        if not resp.ok:
            return "", ""
        text = _extract_definition_from_dictionaryapi_payload(resp.json())
        if text:
            return text, "dictionaryapi.dev"
    except Exception:
        return "", ""
    return "", ""


# ── Hebrew word variant helpers ───────────────────────────────────────────────


def _hebrew_word_variant_candidates(raw_word):
    clean_word = _normalize_lookup_word(raw_word)
    letters_only = re.sub(r"[^א-ת\s]", "", clean_word).strip()
    if not letters_only:
        return []

    variants = []

    def add_variant(value):
        token = str(value or "").strip()
        if token and token not in variants:
            variants.append(token)

    add_variant(letters_only)
    parts = [part for part in letters_only.split() if part]
    if parts:
        add_variant(parts[0])

    for part in parts[:2] if parts else [letters_only]:
        if len(part) >= 4 and part[0] in {"ו", "ה", "ב", "כ", "ל", "מ", "ש"}:
            add_variant(part[1:])

    return variants[:4]


def _parse_meaning_candidates(raw_meaning):
    value = re.sub(r"\s+", " ", str(raw_meaning or "").strip())
    if not value:
        return []
    if not any(sep in value for sep in [";", "/", "|"]):
        return [value]
    chunks = [chunk.strip(" .") for chunk in re.split(r"[;/|]", value) if chunk.strip()]
    return chunks[:4] if chunks else [value]


# ── Hebrew word lookup (full chain) ──────────────────────────────────────────


_HEBREW_PREFIX_LETTERS = frozenset("והבכלמש")
_HEBREW_VERB_PREFIX_LETTERS = frozenset("יתנא")
_HEBREW_ENDINGS = ("ים", "ות", "תי", "תם", "נו", "כם", "הם", "ו", "ה", "ך", "ת", "י")


def _without_hebrew_ending(word):
    """The word with its first matching ending taken off, or "" when no ending
    leaves at least two letters."""
    for ending in _HEBREW_ENDINGS:
        if word.endswith(ending) and len(word) - len(ending) >= 2:
            return word[:-len(ending)]
    return ""


def _hebrew_word_forms(token):
    """The word as written, then with its prefix letters (ו ה ב כ ל מ ש)
    taken off one at a time, each followed by the same form without its
    plural, possessive or verb ending. A lexicon is indexed by the base form, so "ושמרו"
    is looked up as ושמרו, ושמר, שמרו, שמר."""
    forms = []

    def add(form):
        if len(form) >= 2 and form not in forms:
            forms.append(form)

    current = token
    for _ in range(3):
        add(current)
        stem = _without_hebrew_ending(current)
        if stem:
            add(stem)
        if len(current) < 3 or current[0] not in _HEBREW_PREFIX_LETTERS:
            break
        current = current[1:]
    # A future-tense verb (ויאמר, "and he said") is indexed under its root, so
    # the leading י ת נ א comes off last, after every other form has had its
    # turn. A plural noun keeps it: ימים is "days", not מים, "water".
    for form in tuple(forms):
        if len(form) >= 4 and form[0] in _HEBREW_VERB_PREFIX_LETTERS and not form.endswith(("ים", "ות")):
            add(form[1:])
    return forms


def _hebrew_word_variants(raw_word):
    """Candidate Hebrew word forms for glossary and lexicon lookup: the word
    without nikud, teamim or other marks, then its base forms (see
    _hebrew_word_forms); a phrase also tries its first words one by one.
    Moved to module level (out of _lookup_hebrew_word_meaning()) since nested
    closures' own branches count against the enclosing function's
    complexity, but top-level functions' don't (SonarCloud python:S3776).
    """
    letters_only = re.sub(r"[^א-ת\s]", "", _normalize_lookup_word(raw_word)).strip()
    words = letters_only.split()
    candidates = [letters_only] if len(words) > 1 else []
    for token in words[:3]:
        candidates.extend(_hebrew_word_forms(token))
    return list(dict.fromkeys(form for form in candidates if form))[:8]


def _lookup_hebrew_word_in_local_glossary(variants):
    """Stage 1 of _lookup_hebrew_word_meaning(): exact match against the
    curated local glossary. Split out (SonarCloud python:S3776).
    """
    for variant in variants:
        exact = HEBREW_WORD_GLOSSARY.get(variant)
        if exact:
            normalized = _normalize_glossary_meaning(exact)
            if normalized:
                return normalized, "local-hebrew-glossary"
    return "", ""


def _first_hit(fn, candidates, is_hit, max_workers):
    """Run fn(candidate) over candidates with bounded concurrency, resolving
    as soon as the highest-priority (earliest) candidate whose result
    satisfies is_hit() is known -- without waiting on slower, lower-priority
    candidates the way a plain pool.map() gather would.

    Submitting every candidate at once (no cap) traded one failure mode for
    a worse one: it fixed the "waits for every candidate" latency, but it
    also fires several near-simultaneous requests at whatever fn() calls out
    to. Sefaria's lexicon shrugs that off, but the online-translation
    providers (_translate_hebrew_text_online) sit behind a shared,
    process-wide circuit breaker (backend/health_check.py, FAIL_THRESHOLD=3
    consecutive failures -> 120s locked out) -- a burst of concurrent calls
    against the same unofficial endpoint from one process is exactly the
    kind of traffic that trips it, and once it's open every *other* word
    lookup gets nothing from that provider for two minutes. Capping
    max_workers keeps a real speed win (later candidates are usually
    already running, or already done, by the time an earlier one is
    checked) without hammering any one provider.

    A raw ThreadPoolExecutor (not the `with` form) lets an early exit drop
    queued candidates and skip waiting on already-started ones that are no
    longer needed, instead of blocking on the pool's implicit shutdown.
    """
    if not candidates:
        return None
    pool = ThreadPoolExecutor(max_workers=min(max_workers, len(candidates)))
    futures = [pool.submit(fn, c) for c in candidates]
    try:
        for future in futures:
            result = future.result()
            if is_hit(result):
                return result
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return None


def _first_lexicon_glosses(variants, written=""):
    """(glosses, lexicon_name) for the first variant the lexicon knows. `written`
    is the word as the reader selected it, vowel points included: it stands in
    for the variant of the same letters so the lexicon can match its pointing.
    See _first_hit()'s docstring for why this is bounded, early-exiting
    concurrency rather than a plain loop or an uncapped gather."""
    written_letters = _NOT_HEBREW_LETTER_RE.sub("", written)

    def lookup(variant):
        return _lookup_sefaria_lexicon_glosses(written if variant == written_letters else variant)

    result = _first_hit(lookup, variants, lambda r: bool(r[0]), max_workers=6)
    return result or ([], "")


def _lookup_hebrew_word_meaning(word):
    """A short gloss for a Hebrew word: the curated glossary, then Sefaria's
    Klein, BDB or Jastrow lexicon. Nothing else: no machine translation and no
    commentary, so a word with no entry is reported as not found rather than
    answered with a guess."""
    clean_word = _normalize_lookup_word(word)
    if not clean_word:
        return "", ""

    variants = _hebrew_word_variants(clean_word)

    definition, source = _lookup_hebrew_word_in_local_glossary(variants)
    if definition:
        return definition, source

    glosses, lex_name = _first_lexicon_glosses(variants, word)
    return (glosses[0], lex_name) if glosses else ("", "")


# ── Word meaning alternatives (Sefaria-first for Hebrew variants) ─────────────


def _collect_hebrew_word_meaning_options(raw_word, primary_meaning, options, add_option):
    """Hebrew-specific candidate-gathering branch of
    _collect_word_meaning_alternatives(). `options`/`add_option` are the
    caller's accumulator list and dedup-adder closure. Split out to keep
    these three loops out of that function's own complexity count
    (SonarCloud python:S3776).
    """
    variants = _hebrew_word_variant_candidates(raw_word)

    for variant in variants:
        for interpreted in HEBREW_INTERPRETIVE_GLOSSARY.get(variant, []):
            add_option(interpreted)

    for candidate in _parse_meaning_candidates(primary_meaning):
        add_option(candidate)

    # A lexicon gloss is real English ("sheep", "week", "three"), so it skips
    # the transliteration check that screens glossary and machine output.
    glosses, _ = _first_lexicon_glosses(_hebrew_word_variants(raw_word), raw_word)
    for gloss in glosses:
        shown = {option.lower() for option in options}
        parts = _parse_meaning_candidates(gloss)
        # The first gloss is also the primary meaning, already split into options.
        if not (parts and all(part.lower() in shown for part in parts)):
            add_option(gloss, check_transliteration=False)


def _collect_word_meaning_alternatives(raw_word, primary_meaning, word_is_hebrew):
    options = []

    def add_option(candidate, check_transliteration=True):
        normalized = re.sub(r"\s+", " ", str(candidate or "").strip(" ."))
        if not normalized:
            return
        if word_is_hebrew and check_transliteration and _looks_like_transliteration(normalized):
            return
        if normalized.lower() in {item.lower() for item in options}:
            return
        options.append(normalized)

    if word_is_hebrew:
        _collect_hebrew_word_meaning_options(raw_word, primary_meaning, options, add_option)
    else:
        for candidate in _parse_meaning_candidates(primary_meaning):
            add_option(candidate)

    return options[:3]


# ── Fill missing English lines ────────────────────────────────────────────────


def _translate_line_if_missing_english(line):
    """Attempt to fill in a missing English translation for one text line,
    mutating `line["en"]` in place on success. Returns the translation
    source ("" if unknown) if translated, else None. Split out of
    _fill_missing_english_lines() to keep this per-line branching out of
    that function's own complexity count (SonarCloud python:S3776).
    """
    if not isinstance(line, dict):
        return None

    en_value = str(line.get("en") or "").strip()
    he_value = _normalize_lookup_word(line.get("he") or "")
    if en_value or not he_value:
        return None
    if not _contains_hebrew_letters(he_value):
        return None

    generated, source = _translate_hebrew_text_online(he_value[:320], try_fallback=False)
    if not generated:
        return None
    line["en"] = generated
    return source or ""


def _translate_missing_english_lines(lines, max_lines, max_runtime_seconds):
    """Translate up to max_lines lines missing English text, bounded by a
    wall-clock budget. Returns (translated_count, translation_sources).
    Split out of _fill_missing_english_lines() (SonarCloud python:S3776).
    """
    translated_count = 0
    translation_sources = set()
    started_at = time.time()

    for line in lines:
        if translated_count >= max_lines:
            break
        if time.time() - started_at > max_runtime_seconds:
            break

        source = _translate_line_if_missing_english(line)
        if source is None:
            continue
        translated_count += 1
        if source:
            translation_sources.add(source)

    return translated_count, translation_sources


def _apply_translation_metadata(text_payload, lines, translated_count, translation_sources):
    """Stamp text_payload with translation_generated/_count/_source/_note
    and refresh its `en` list from the (possibly newly-translated) lines.
    Split out of _fill_missing_english_lines() (SonarCloud python:S3776).
    """
    provider_label = (
        ", ".join(sorted(translation_sources)) if translation_sources else "online-translation"
    )
    text_payload["translation_generated"] = True
    text_payload["translation_generated_count"] = translated_count
    text_payload["translation_source"] = provider_label
    text_payload["translation_note"] = (
        f"Automatic English translation added for missing lines ({provider_label})."
    )
    text_payload["en"] = [
        str(line.get("en", "")).strip()
        for line in lines
        if isinstance(line, dict) and str(line.get("en", "")).strip()
    ]


def _fill_missing_english_lines(text_payload, max_lines=12, max_runtime_seconds=1.2):
    if not isinstance(text_payload, dict):
        return text_payload

    lines = text_payload.get("lines", [])
    if not isinstance(lines, list) or not lines:
        return text_payload

    translated_count, translation_sources = _translate_missing_english_lines(
        lines, max_lines, max_runtime_seconds)

    if translated_count:
        _apply_translation_metadata(text_payload, lines, translated_count, translation_sources)

    return text_payload


# ── Flask request helpers ─────────────────────────────────────────────────────


def _parse_multi_value_arg(name):
    raw = (_flask_request.args.get(name, "") or "").strip()
    if not raw:
        return []
    return [v for chunk in raw.split(",") if (v := chunk.strip())]


def _extract_search_metadata_filters():
    metadata_filters = {}
    for key in ("era", "author", "category", "geography", "nusach"):
        values = _parse_multi_value_arg(key)
        if values:
            metadata_filters[key] = values
    return metadata_filters


# ── AI-error reason classifier ────────────────────────────────────────────────
# Security audit P1: asgi.py/app.py's /ask fallback path used to put
# str(ai_error) — the raw provider SDK exception text — into
# meta.fallback_detail.reason on a normal 200 response. Unlike a generic
# 500-handler leak, this fires on routine failure modes (timeouts, rate
# limits, provider outages) on the app's most-used endpoint. The full
# exception is still captured server-side via _capture_backend_error right
# before this is called; only the client-facing value changes here.
_AI_ERROR_TIMEOUT_MARKERS = ("timeout", "timed out")
_AI_ERROR_RATE_LIMIT_MARKERS = ("rate limit", "rate_limit", "429")
_AI_ERROR_BLOCKED_MARKERS = ("security_blocked",)


def _coarse_ai_error_reason(error) -> str:
    """Map an AI-call exception to a coarse, non-identifying category for
    client responses. Never returns the raw exception text."""
    text = str(error or "").lower()
    if any(marker in text for marker in _AI_ERROR_BLOCKED_MARKERS):
        return "blocked"
    if any(marker in text for marker in _AI_ERROR_TIMEOUT_MARKERS):
        return "timeout"
    if any(marker in text for marker in _AI_ERROR_RATE_LIMIT_MARKERS):
        return "rate_limited"
    return "provider_error"


# ── Answer-mode sanitizer ─────────────────────────────────────────────────────


def _sanitize_answer_mode(mode_value):
    mode = (mode_value or "balanced").strip().lower()
    return mode if mode in ANSWER_MODES else "balanced"


# ── Source attribution helpers ────────────────────────────────────────────────


def _join_with_and(values):
    values = [str(v or "").strip() for v in values if str(v or "").strip()]
    if not values:
        return ""
    if len(values) == 1:
        return values[0]
    if len(values) == 2:
        return f"{values[0]} and {values[1]}"
    return f"{', '.join(values[:-1])}, and {values[-1]}"


def _is_machine_translated_source(source):
    """True if `source` credits an online machine-translation provider
    (Google Translate / MyMemory / the "automatic-translation" fallback
    label) rather than a curated glossary, Sefaria lexicon, or dictionary
    entry. Also true for a "+"-joined combined source (e.g.
    "dictionaryapi.dev+google-translate" -- an English definition that was
    then machine-translated to Hebrew) since the machine-translation step
    still touched the text the user sees.

    machine-translated content must be
    labeled as such, never presented as authoritative -- this is the single
    place that decision is made so every caller (currently
    routes_library.py's /api/word/meaning) labels consistently.
    """
    return "translat" in str(source or "").lower()


def _build_source_attribution_note(*, has_sefaria=False, has_customs=False, has_whitelisted_external=False, has_general_web=False, has_internal_knowledge=False):
    if has_internal_knowledge or not any((has_sefaria, has_customs, has_whitelisted_external, has_general_web)):
        return INTERNAL_AI_KNOWLEDGE_DISCLAIMER

    sources = []
    if has_sefaria:
        sources.append("Sefaria")
    if has_customs:
        sources.append("Community Customs")
    if has_whitelisted_external:
        sources.append("Halachipedia / HebrewBooks / YHB")
    if has_general_web:
        sources.append("General Web Context")

    joined_sources = _join_with_and(sources)
    return (
        f"Note: This is educational information pulled from {joined_sources}, "
        f"not a halachic ruling. {RABBI_FINAL_RULING_FOOTER}"
    )


def _compact_source_line(row, max_chars):
    """Clean + truncate one raw source line. Returns a {en, he} dict, or
    None if the line should be skipped entirely. Split out of
    _compact_ai_sources() to keep this per-line branching out of that
    function's own complexity count (SonarCloud python:S3776).
    """
    if not isinstance(row, dict):
        return None

    # Strip Sefaria's embedded HTML (footnote/commentary-link markup) BEFORE
    # truncating by character count — truncating first risked slicing a tag
    # in half (e.g. cutting "<i data-commentary-link=...>" mid-attribute),
    # leaving an unclosed fragment the frontend's tag-stripper can't match
    # (it requires a literal closing ">"), which then rendered as visible
    # garbage text in the source box.
    en = re.sub(r"\s+", " ", re.sub(r"<[^>]*>", "", str(row.get("en") or "")).strip())
    he = re.sub(r"\s+", " ", re.sub(r"<[^>]*>", "", str(row.get("he") or "")).strip())

    # Skip lines that indicate the source was not found
    if en.startswith(("Text not found", "Error")):
        return None

    if len(en) > max_chars:
        en = f"{en[:max_chars].rstrip()}..."
    if len(he) > max_chars:
        he = f"{he[:max_chars].rstrip()}..."

    return {"en": en, "he": he}


def _compact_ai_source_lines(raw_lines, max_lines, max_chars):
    """Compact up to max_lines raw line dicts, or return None if none of
    them end up with usable content. Split out of
    _compact_ai_source_entry() (SonarCloud python:S3776).
    """
    lines = []
    has_valid_content = False
    for row in raw_lines[:max_lines]:
        compacted_line = _compact_source_line(row, max_chars)
        if compacted_line is None:
            continue
        if compacted_line["en"] or compacted_line["he"]:
            has_valid_content = True
        lines.append(compacted_line)

    # Skip sources with no valid content
    if not has_valid_content and not lines:
        return None
    return lines


def _attach_optional_source_fields(entry, src):
    """Copy domain/source_provider/url from `src` onto `entry` in place,
    only when present. Split out of _compact_ai_source_entry() (SonarCloud
    python:S3776).
    """
    domain = str(src.get("domain") or "").strip()
    source_provider = str(src.get("source_provider") or "").strip()
    url = str(src.get("url") or "").strip()
    if domain:
        entry["domain"] = domain
    if source_provider:
        entry["source_provider"] = source_provider
    if url:
        entry["url"] = url


def _compact_ai_source_entry(src, max_lines, max_chars):
    """Trim one raw source dict to the excerpt shape used by the UI, or
    return None if it has no usable content. Split out of
    _compact_ai_sources() (SonarCloud python:S3776) -- see
    _compact_source_line.
    """
    if not isinstance(src, dict):
        return None

    ref = str(src.get("ref") or "").strip()
    title = str(src.get("title") or ref).strip()
    raw_lines_obj = src.get("lines")
    raw_lines = raw_lines_obj if isinstance(raw_lines_obj, list) else []

    lines = _compact_ai_source_lines(raw_lines, max_lines, max_chars)
    if lines is None:
        return None

    entry: dict = {
        "ref": ref[:220],
        "title": title[:220],
        "lines": lines,
    }
    _attach_optional_source_fields(entry, src)

    return entry


def _compact_ai_sources(sources, max_sources=8, max_lines=3, max_chars=280):
    """Trim bulky source payloads to the excerpt shape used by the UI."""
    if not isinstance(sources, list):
        return []

    compacted = []
    for src in sources[:max_sources]:
        entry = _compact_ai_source_entry(src, max_lines, max_chars)
        if entry is not None:
            compacted.append(entry)

    return compacted


def extract_ai_cited(structured_payload):
    """Pull the AI's own citation list out of a structured /ask payload.

    Single source of truth for both app.py and asgi.py so the two transports
    cannot drift in what counts as an "AI-cited" source.
    """
    ai_cited = []
    if isinstance(structured_payload, dict):
        for s in (structured_payload.get("sources") or []):
            s_str = str(s or "").strip()
            if s_str:
                ai_cited.append(s_str)
    return ai_cited


# ── Community name canonicalizer ──────────────────────────────────────────────


def _normalize_for_community_match(value):
    """Lowercase and strip non-alphanumeric characters, for fuzzy
    community-name matching. Split out of _canonicalize_community_name()
    (SonarCloud python:S3776).
    """
    return "".join(ch for ch in value.lower() if ch.isalnum())


def _match_normalized_community_alias(normalized):
    """Find a COMMUNITY_ALIASES entry whose normalized alias matches, or
    None. Split out of _canonicalize_community_name() (SonarCloud
    python:S3776).
    """
    for alias, canonical in COMMUNITY_ALIASES.items():
        if _normalize_for_community_match(alias) == normalized:
            return canonical
    return None


def _match_normalized_community_name(normalized):
    """Find a COMMUNITIES entry whose normalized name matches, or None.
    Split out of _canonicalize_community_name() (SonarCloud
    python:S3776).
    """
    for canonical in COMMUNITIES.keys():
        if _normalize_for_community_match(canonical) == normalized:
            return canonical
    return None


def _canonicalize_community_name(name):
    if not name:
        return None

    if name in COMMUNITIES:
        return name

    lowered = name.strip().lower()
    if lowered in COMMUNITY_ALIASES:
        return COMMUNITY_ALIASES[lowered]

    normalized = _normalize_for_community_match(lowered)
    return (
        _match_normalized_community_alias(normalized)
        or _match_normalized_community_name(normalized)
    )
