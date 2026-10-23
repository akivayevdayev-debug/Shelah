"""Which Sefaria texts and versions Sh'elah shows, and which one is the default.

The policy (owner, 2026-10-20: "hide most unorthodox conservative and all
reformed"):

- Works. Sefaria's library is curated and overwhelmingly classical, so a work
  is allowed unless DENIED_WORKS names it. Every entry carries its reason.
- Versions. data/text_versions.json is the reviewed mapping (label,
  community, trust, reason) for each known versionTitle. On top of it:
  DENIED_SOURCE_DOMAINS (movement publishers), DENIED_TITLE_PATTERNS
  (test / temp / personal uploads) and a language rule (Sefaria files many
  French, Yiddish, Persian ... versions under "en"/"he"; only real Hebrew,
  Aramaic and English are shown).
- Fail closed. A version the mapping doesn't know is "Unlabelled": hidden from
  the picker and never a default, with one exception: the original-language
  text of an allowed work (Sefaria's isSource Hebrew/Aramaic) may be shown when
  no mapped Hebrew exists, so a classical commentary never loses its own words.
  An unknown English translation is dropped; the reader shows Hebrew only.

Trust levels: "preferred" may be the default; "listed" is shown and becomes the
default only when no preferred version exists in that language; "denied" never
reaches a reader, a route or the AI. Unknown versions report "unknown".

Every Sefaria fetch path goes through here: sefaria_library.get_text (reader,
commentary text, siddur, AI quotes), get_linked_texts (links / commentary
panel), search_library and the library index, verse_search, and the AI tools
built on them.
"""

from __future__ import annotations

import json
import re
from contextlib import contextmanager
from contextvars import ContextVar
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from backend.minhag import ASHKENAZI, MIZRAHI, SEPHARDI, resolve_minhag

_MAPPING_PATH = Path(__file__).resolve().parent.parent / "data" / "text_versions.json"

PREFERRED = "preferred"
LISTED = "listed"
DENIED = "denied"
UNKNOWN = "unknown"

UNLABELLED = "Unlabelled"
ORIGINAL_TEXT = "Original text"

# A community's own versions first, then neutral ones, then the others'.
_COMMUNITY_ORDER = {
    SEPHARDI: ("sephardi", "mizrahi", "general", "ashkenazi", "chabad"),
    MIZRAHI: ("mizrahi", "sephardi", "general", "ashkenazi", "chabad"),
    ASHKENAZI: ("ashkenazi", "general", "chabad", "sephardi", "mizrahi"),
}

# Languages a reader can read. Sefaria's `language` is only "he"/"en"; its
# `actualLanguage` says what the text really is.
_SHOWN_LANGUAGES = {"he": {"he", "arc", ""}, "en": {"en", ""}}

_BIALIK_COMMENTARY = "Commentary on Bialik's secular essay above."
_RECONSTRUCTIONIST = "Reconstructionist movement."

# Works hidden everywhere. match "exact" compares the whole title; "prefix"
# also catches the work's per-book parts ("English Explanation of Mishnah
# Berakhot"). Titles are Sefaria index titles.
DENIED_WORKS = (
    {"title": "The Torah; A Women's Commentary", "match": "exact",
     "reason": "Published by the Reform movement (URJ / Women of Reform Judaism)."},
    {"title": "Standing Again at Sinai; Judaism from a Feminist Perspective", "match": "exact",
     "reason": "Judith Plaskow's feminist theology from the Reform/Reconstructionist world."},
    {"title": "Rereading the Rabbis", "match": "exact",
     "reason": "Judith Hauptman (Jewish Theological Seminary), Conservative movement."},
    {"title": "English Explanation of", "match": "prefix",
     "reason": "Mishnah commentary by Rabbi Joshua Kulp of the Conservative Yeshiva (Conservative movement)."},
    {"title": "Daf Shevui", "match": "prefix",
     "reason": "Talmud commentary by Rabbi Joshua Kulp of the Conservative Yeshiva (Conservative movement)."},
    {"title": "Collected Responsa in Wartime", "match": "exact",
     "reason": "Cross-movement chaplaincy committee chaired by a Reform rabbi (Solomon Freehof); rulings are not Orthodox."},
    {"title": "Collected Responsa to Chaplains", "match": "exact",
     "reason": "Same cross-movement chaplaincy committee as above."},
    {"title": "Dirshuni", "match": "prefix",
     "reason": "Contemporary women's midrash from across movements; modern creative writing, not a classical or Orthodox source."},
    {"title": "Jewish Legal Writings by Women", "match": "exact",
     "reason": "Cross-movement essay collection presented as revolutionary; not an Orthodox halakhic source."},
    {"title": "Words of Peace and Truth", "match": "exact",
     "reason": "Wessely's Haskalah pamphlet, opposed by the rabbis of its day."},
    {"title": "Moreh Nevukhei HaZeman", "match": "exact",
     "reason": "Nachman Krochmal, a founder of the Haskalah's historical-critical school."},
    {"title": "Halakhah and Aggadah", "match": "exact",
     "reason": "Essay by the secular poet H. N. Bialik, not a religious source."},
    {"title": "Bein HaShitin on Halakhah and Aggadah", "match": "exact",
     "reason": _BIALIK_COMMENTARY},
    {"title": "Revealment and Concealment in Language", "match": "exact",
     "reason": "Essay by the secular poet H. N. Bialik."},
    {"title": "Ali Be'er on Revealment and Concealment in Language", "match": "exact",
     "reason": _BIALIK_COMMENTARY},
    {"title": "Commentaries on Revealment and Concealment in Language", "match": "exact",
     "reason": _BIALIK_COMMENTARY},
    {"title": "The Five Books of Moses, by Everett Fox", "match": "exact",
     "reason": "Academic, non-Orthodox literary translation."},
    {"title": "The Early Prophets, by Everett Fox", "match": "exact",
     "reason": "Academic, non-Orthodox literary translation."},
    {"title": "Footnotes to Kohelet by Bruce Heitler", "match": "exact",
     "reason": "Personal notes by a non-rabbinic author; no Orthodox review."},
)

# Version sources run by non-Orthodox movements or seminaries.
DENIED_SOURCE_DOMAINS = {
    "rabbinicalassembly.org": "Rabbinical Assembly (Conservative movement).",
    "conservativeyeshiva.org": "Conservative Yeshiva (Conservative movement).",
    "jtsa.edu": "Jewish Theological Seminary (Conservative movement).",
    "uscj.org": "United Synagogue of Conservative Judaism.",
    "huc.edu": "Hebrew Union College (Reform seminary).",
    "reformjudaism.org": "Union for Reform Judaism.",
    "urj.org": "Union for Reform Judaism.",
    "ccarnet.org": "Central Conference of American Rabbis (Reform).",
    "ccarpress.org": "CCAR Press (Reform).",
    "reconstructingjudaism.org": _RECONSTRUCTIONIST,
    "rrc.edu": "Reconstructionist Rabbinical College.",
    "ritualwell.org": "Reconstructionist ritual site.",
    "aleph.org": "ALEPH: Alliance for Jewish Renewal.",
    "mechonhadar.org": "Mechon Hadar (egalitarian, non-Orthodox).",
    "hadar.org": "Mechon Hadar (egalitarian, non-Orthodox).",
    "translate.google.com": "Machine translation.",
}

# Uploads that are not finished versions of anything.
DENIED_TITLE_PATTERNS = (
    (re.compile(r"\b(?:temp|test|draft|my version|version title \d+)\b", re.IGNORECASE),
     "Placeholder, test or personal upload."),
    (re.compile(r"\bgender[- ]sensitive\b", re.IGNORECASE),
     "Gender-sensitive revision; non-Orthodox editorial policy."),
    (re.compile(r"\[[a-z]{2,3}\]\s*$", re.IGNORECASE),
     "Another language filed under Hebrew or English."),
)


def _key(title) -> str:
    return " ".join(str(title or "").split()).casefold()


@lru_cache(maxsize=1)
def _mapping() -> dict:
    data = json.loads(_MAPPING_PATH.read_text(encoding="utf-8"))
    return {(_key(e["title"]), e["lang"]): e for e in data["versions"]}


def mapping_entries() -> list[dict]:
    """Every reviewed entry, for the owner-facing allow/deny report."""
    return list(_mapping().values())


def _domain(url) -> str:
    try:
        host = urlparse(str(url or "").strip()).hostname or ""
    except ValueError:  # e.g. a stray "[" reads as a broken IPv6 host
        return ""
    # "jtsa.edu." (a fully qualified name) is the same host as "jtsa.edu".
    return host.removeprefix("www.").lower().rstrip(".")


# Movement bodies an AI citation or a web page title may name instead of a
# Sefaria title or a domain.
DENIED_SOURCE_NAMES = {
    "Rabbinical Assembly": "Conservative movement's rabbinical body.",
    "Committee on Jewish Law and Standards": "Conservative movement's law committee.",
    "CJLS": "Conservative movement's law committee.",
    "Jewish Theological Seminary": "Conservative movement's seminary.",
    "United Synagogue of Conservative Judaism": "Conservative movement.",
    "Central Conference of American Rabbis": "Reform movement's rabbinical body.",
    "CCAR": "Reform movement's rabbinical body.",
    "Reform Responsa": "Reform movement responsa.",
    "Reform Judaism Responsa": "Reform movement responsa.",
    "Conservative Yeshiva": "Conservative movement's yeshiva in Jerusalem.",
    "Mechon Hadar": "Egalitarian, non-Orthodox.",
    "Union for Reform Judaism": "Reform movement.",
    "Hebrew Union College": "Reform movement's seminary.",
    "Reconstructionist": _RECONSTRUCTIONIST,
    "Reconstructing Judaism": _RECONSTRUCTIONIST,
}
_DENIED_SOURCE_NAMES_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(name) for name in DENIED_SOURCE_NAMES) + r")\b",
    re.IGNORECASE,
)


# A host named inside a citation ("Responsa, see jtsa.edu").
_HOST_IN_TEXT_RE = re.compile(r"\b(?:[a-z0-9-]{1,63}\.){1,4}[a-z]{2,24}\b", re.IGNORECASE)


def is_source_denied(*values) -> bool:
    """True when any of `values` (a URL, a bare domain such as Gemini's
    grounding `domain`, or a page title or citation) names a denied publisher
    or work."""
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        if _denied_domain_reason(text if "://" in text else f"https://{text}"):
            return True
        if is_work_denied(text) or _DENIED_SOURCE_NAMES_RE.search(text):
            return True
        if any(_denied_domain_reason(f"https://{host}") for host in _HOST_IN_TEXT_RE.findall(text)):
            return True
    return False


def _denied_domain_reason(url) -> str | None:
    host = _domain(url)
    for domain, reason in DENIED_SOURCE_DOMAINS.items():
        if host == domain or host.endswith("." + domain):
            return reason
    return None


def _lang(version) -> str:
    return "he" if str(version.get("language") or "") == "he" else "en"


def assess_version(version) -> dict:
    """{trust, label, community, rank, reason} for one Sefaria version dict
    (versionTitle, language, actualLanguage, isSource, versionSource)."""
    title = version.get("versionTitle")
    lang = _lang(version)
    entry = _mapping().get((_key(title), lang))
    if entry and entry["trust"] == DENIED:
        return _verdict(DENIED, entry=entry)
    actual = str(version.get("actualLanguage") or "").lower()
    if actual not in _SHOWN_LANGUAGES[lang]:
        return _verdict(DENIED, reason=f"Written in {actual}, not {'Hebrew' if lang == 'he' else 'English'}.")
    domain_reason = _denied_domain_reason(version.get("versionSource"))
    if domain_reason:
        return _verdict(DENIED, reason=domain_reason)
    if entry:
        return _verdict(entry["trust"], entry=entry)
    for pattern, reason in DENIED_TITLE_PATTERNS:
        if pattern.search(str(title or "")):
            return _verdict(DENIED, reason=reason)
    if lang == "he" and version.get("isSource"):
        return _verdict(LISTED, label=ORIGINAL_TEXT, rank=50,
                        reason="The work's own Hebrew/Aramaic text; the work itself is allowed.")
    return _verdict(UNKNOWN, label=UNLABELLED, reason="Not in the reviewed mapping.")


def _verdict(trust, *, entry=None, label=None, rank=99, reason=""):
    entry = entry or {}
    return {
        "trust": trust,
        "label": entry.get("label") or label or UNLABELLED,
        "community": entry.get("community") or "general",
        "rank": entry.get("rank", rank),
        "reason": entry.get("reason") or reason,
    }


def is_version_shown(version) -> bool:
    return assess_version(version)["trust"] in (PREFERRED, LISTED)


def _sort_key(version, community):
    verdict = assess_version(version)
    order = _COMMUNITY_ORDER[resolve_minhag(community)]
    place = order.index(verdict["community"]) if verdict["community"] in order else len(order)
    try:
        priority = -float(version.get("priority") or 0)
    except (TypeError, ValueError):
        priority = 0.0
    return (0 if verdict["trust"] == PREFERRED else 1, place, verdict["rank"], priority)


def choose_versions(available, community=None, requested=None) -> dict:
    """The Hebrew and English version a reader gets: {"he": v|None, "en": v|None}.

    `requested` ({"he": title, "en": title}) is the reader's own pick from the
    version picker; it wins when that version exists and is shown. Otherwise
    the best shown version for the community, or None (fail closed)."""
    requested = requested or {}
    chosen = {}
    for lang in ("he", "en"):
        shown = [v for v in available or [] if isinstance(v, dict)
                 and _lang(v) == lang and is_version_shown(v)]
        wanted = _key(requested.get(lang))
        pick = next((v for v in shown if wanted and _key(v.get("versionTitle")) == wanted), None)
        if pick is None and shown:
            pick = min(shown, key=lambda v: _sort_key(v, community))
        chosen[lang] = pick
    return chosen


def picker_versions(available, community=None) -> list[dict]:
    """The versions the reader's picker lists: shown ones only, best first,
    each {title, lang, label}."""
    rows, seen = [], set()
    for v in sorted((v for v in available or [] if isinstance(v, dict) and is_version_shown(v)),
                    key=lambda v: (_lang(v) != "he", _sort_key(v, community))):
        key = (_key(v.get("versionTitle")), _lang(v))
        if key in seen:
            continue
        seen.add(key)
        rows.append({"title": str(v.get("versionTitle") or "").strip(), "lang": _lang(v),
                     "label": assess_version(v)["label"]})
    return rows


# A work's main title before its ";" subtitle, used on its own only when it is
# distinctive (four words or more): "Standing Again at Sinai" yes, "The Torah" no.
_SHORT_TITLE_MIN_WORDS = 4


def _short_title_key(work_key: str) -> str:
    short = work_key.partition(";")[0].strip()
    if short == work_key or len(short.split()) < _SHORT_TITLE_MIN_WORDS:
        return ""
    return short


def _names_work(key: str, work_key: str) -> bool:
    """`key` is the work itself or a ref inside it ("<work> 3", "<work>, p. 40")."""
    if not work_key:
        return False
    return key == work_key or key.startswith(work_key + " ") or key.startswith(work_key + ",")


def denied_work_reason(title) -> str | None:
    """Why the work `title` (an index title, or a ref inside it) is hidden;
    None when it is allowed."""
    key = _key(title)
    if not key:
        return None
    for work in DENIED_WORKS:
        work_key = _key(work["title"])
        if _names_work(key, work_key) or _names_work(key, _short_title_key(work_key)):
            return work["reason"]
        if work["match"] == "prefix" and key.startswith(work_key):
            return work["reason"]
    return None


def is_work_denied(title) -> bool:
    return denied_work_reason(title) is not None


# The community whose versions a fetch should prefer when its caller doesn't
# say: the reader routes pass ?minhag=, the /ask pipelines set this from the
# answer's community lens, and everything else gets the default (Sephardi).
_current_community: ContextVar[str | None] = ContextVar("text_trust_community", default=None)


def current_community() -> str:
    return resolve_minhag(_current_community.get())


def use_community(community):
    """Set the community for this context; returns the token to reset with."""
    return _current_community.set(resolve_minhag(community))


def reset_community(token) -> None:
    _current_community.reset(token)


# The AI's community lens (backend/claude.py's community names) -> the minhag
# whose versions its quoted texts use. Mizrahi is the Iraqi lens (the site's
# Mizrahi setting sends it); every other non-Ashkenazi community reads the
# Sephardi defaults.
_ASHKENAZI_LENS_WORDS = ("ashkenaz", "chabad", "hasid", "chasid", "litvish", "yekke")
_MIZRAHI_LENS_WORDS = ("iraqi", "mizrahi", "mizrachi", "babylonian")


def minhag_for_lens(community_lens) -> str:
    key = str(community_lens or "").strip().lower()
    if any(word in key for word in _ASHKENAZI_LENS_WORDS):
        return ASHKENAZI
    if any(word in key for word in _MIZRAHI_LENS_WORDS):
        return MIZRAHI
    return SEPHARDI


@contextmanager
def community_scope(community):
    """Run a block with `community` (a minhag) as the default community."""
    token = use_community(community)
    try:
        yield
    finally:
        reset_community(token)
