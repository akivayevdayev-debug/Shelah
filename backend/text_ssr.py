"""
Server-rendered body for ``/text/<ref>`` (the reader's chapter pages).

The SPA shell used to send every text page with an empty ``#readerSources``
and let the browser fetch ``/api/text/<ref>`` after the app booted, so a
crawler that does not run JavaScript -- most AI crawlers, and Google's first
pass -- saw a title and a description and no text. This module builds the
chapter's rows on the server, from the same ``sefaria_library.get_text`` the
API serves, in the markup the client's own ``renderTextRowsForPayload``
produces for its default (side-by-side) layout.

The rest is hand-off. ``routes_spa_paths.text_path`` puts the rows into
``#readerSources`` and embeds the payload as ``<script type="application/json"
id="ssrTextPayload">``; ``readText`` (templates/index.html) seeds
``textPayloadCache`` from it and re-renders in place with the visitor's real
preferences, with no skeleton and no refetch. If anything here fails -- an
upstream error, a slow Sefaria, a ref with no sections -- ``build`` returns
None and the route sends the plain shell, exactly as before.

The text sanitizer is a port of ``escapeDisplayTextPreservingEmphasis`` /
``normalizeDisplayText`` in index.html (footnotes dropped, ``<br>`` to a
newline, an allowlist of b/strong/i/em/small, entities decoded, whitespace
collapsed). It parses with ``html.parser`` rather than regexes, so what comes
out is only fixed tags and escaped text.
"""

import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from html import escape
from html.parser import HTMLParser

from markupsafe import Markup

from backend import page_meta, parasha, sefaria_library

logger = logging.getLogger(__name__)

# How long a visitor's request waits for Sefaria before falling back to the
# plain shell. The lookup keeps running in its worker after the wait is over,
# so it still lands in the response cache and the next visit finds it there.
SSR_TIMEOUT_SECONDS = 3.0
# More rows than this is a range ("Genesis 1-50"), not a page of text.
MAX_SSR_LINES = 400

# Cache-Control for the plain shell sent when the render was tried and failed.
FALLBACK_CACHE_CONTROL = "public, max-age=60, must-revalidate"

_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="text-ssr")

_DISPLAY_SAFE_TAGS = frozenset({"b", "strong", "i", "em", "small"})
_SKIPPED_CONTENT_TAGS = frozenset({"script", "style"})

# The three footnote shapes normalizeDisplayText strips, in the same order.
_FOOTNOTE_RES = (
    re.compile(r"<sup[^>]*>[\s\S]*?</sup>\s*<(?:i|span|small)[^>]*>[\s\S]*?</(?:i|span|small)>", re.IGNORECASE),
    re.compile(r"""<(?:i|span|small)[^>]*class=["'][^"']*footnote[^"']*["'][^>]*>[\s\S]*?</(?:i|span|small)>""", re.IGNORECASE),
    re.compile(r"<sup[^>]*>[\s\S]*?</sup>", re.IGNORECASE),
)
_BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_INLINE_SPACE_RE = re.compile(r"[ \t]+")
_NEWLINE_SPACE_RE = re.compile(r"\s*\n\s*")
_DIVINE_NAME_RES = ((re.compile(r"\bG\s+OD\b"), "GOD"), (re.compile(r"\bL\s+ORD\b"), "LORD"))

def enabled():
    """``TEXT_SSR_ENABLED=0`` turns the server render off without a deploy."""
    return os.getenv("TEXT_SSR_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}


class _DisplayTextParser(HTMLParser):
    """Keeps text, and the allowlisted emphasis tags with no attributes;
    drops every other tag and the contents of script/style."""

    def __init__(self, keep_emphasis):
        super().__init__(convert_charrefs=True)
        self._keep_emphasis = keep_emphasis
        self._parts = []
        self._open = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in _SKIPPED_CONTENT_TAGS:
            self._skip_depth += 1
        elif self._keep_emphasis and tag in _DISPLAY_SAFE_TAGS and not self._skip_depth:
            self._parts.append(f"<{tag}>")
            self._open.append(tag)

    def handle_endtag(self, tag):
        if tag in _SKIPPED_CONTENT_TAGS:
            self._skip_depth = max(self._skip_depth - 1, 0)
        elif tag in self._open:
            while self._open:
                closing = self._open.pop()
                self._parts.append(f"</{closing}>")
                if closing == tag:
                    break

    def handle_data(self, data):
        if not self._skip_depth:
            self._parts.append(escape(data, quote=False))

    def result(self):
        self.close()
        while self._open:
            self._parts.append(f"</{self._open.pop()}>")
        return "".join(self._parts)


def _display_text(raw, keep_emphasis):
    text = str(raw or "")
    for footnote_re in _FOOTNOTE_RES:
        text = footnote_re.sub(" ", text)
    text = _BR_RE.sub("\n", text)
    parser = _DisplayTextParser(keep_emphasis)
    parser.feed(text)
    cleaned = parser.result().replace(" ", " ")
    cleaned = _INLINE_SPACE_RE.sub(" ", cleaned)
    return _NEWLINE_SPACE_RE.sub("\n", cleaned).strip()


def _plain_text(raw):
    """normalizeDisplayText: the text with every tag gone; used to ask
    whether a side of a row has anything to show. Left HTML-escaped, which
    is harmless for an emptiness check."""
    return _display_text(raw, keep_emphasis=False)


def _clean_line(raw):
    """cleanLine in renderTextRowsForPayload: emphasis kept, a newline (every
    <br>, once whitespace is collapsed) a space."""
    text = _display_text(raw, keep_emphasis=True).replace("\n", " ")
    for pattern, replacement in _DIVINE_NAME_RES:
        text = pattern.sub(replacement, text)
    return text


def _segment_label(segment, index):
    fallback = str(index + 1)
    raw = str(segment or "").strip()
    if not raw:
        return fallback
    parts = [part for part in raw.split(".") if part]
    digits = re.search(r"\d+", parts[-1] if parts else raw)
    return str(int(digits.group(0))) if digits else fallback


_HE_CLASS = "source-he reader-text-he text-start font-hebrew text-2xl lg:text-3xl leading-[1.8] lg:leading-9 py-2"
_EN_CLASS = "source-en reader-text-en font-serif leading-relaxed py-2 text-slate-700 text-lg"
_ROW_BASE = "source-grid segment-row reader-text-row"


def _render_row(line, index):
    """One verse, in renderTextRowsForPayload's side-by-side branch."""
    he = _clean_line(line.get("he")) if _plain_text(line.get("he")) else ""
    en = _clean_line(line.get("en")) if _plain_text(line.get("en")) else ""
    segment = escape(str(line.get("segment") or ""), quote=True)
    label = escape(_segment_label(line.get("segment"), index))

    if he and en:
        return (
            f'<div class="{_ROW_BASE} reader-side-row grid grid-cols-1 lg:grid-cols-2 lg:gap-x-6 '
            f'border-b border-slate-200 last:border-b-0" data-segment="{segment}">'
            f'<span class="segment-label reader-row-mid-label">{label}</span>'
            f'<div class="{_HE_CLASS}" dir="rtl"><p>{he}</p></div>'
            f'<div class="{_EN_CLASS}" dir="ltr"><p>{en}</p></div>'
            "</div>"
        )
    only_hebrew = bool(he)
    return (
        f'<div class="{_ROW_BASE} reader-single-row grid grid-cols-1 border-b border-slate-200 '
        f'last:border-b-0" data-segment="{segment}">'
        f'<span class="segment-label reader-row-right-label">{label}</span>'
        f'<div class="{_HE_CLASS if only_hebrew else _EN_CLASS}" dir="{"rtl" if only_hebrew else "ltr"}">'
        f"<p>{he if only_hebrew else en}</p></div>"
        "</div>"
    )


def render_rows(lines):
    return "".join(_render_row(line, index) for index, line in enumerate(lines))


def _fetch_text(ref):
    """``get_text`` with a deadline: the payload, or None when Sefaria is
    slow or fails."""
    future = _POOL.submit(sefaria_library.get_text, ref)
    try:
        return future.result(timeout=SSR_TIMEOUT_SECONDS)
    except FutureTimeout:
        logger.info("text SSR: %r not back in %.1fs; sending the plain shell", ref, SSR_TIMEOUT_SECONDS)
    except Exception:
        logger.warning("text SSR: lookup of %r failed", ref, exc_info=True)
    return None


def header_title(payload, fallback):
    """The reader's heading as readText sets it for the English interface
    (getChunkHeaderTitle): the title with the book's Hebrew name, or with the
    weekly portion in its place for a Chumash chapter. It has to match: the
    heading is centred, so a different width moves the page when the app boots."""
    title = str(payload.get("title") or fallback).strip()
    he_title = str(payload.get("heTitle") or "").strip()
    portion = parasha.label(payload.get("ref") or fallback)
    if portion:
        shown = title
    else:
        shown = f"{title} · {he_title}" if he_title and he_title != title else title
    return " · ".join(part for part in (shown, portion) if part)


# What the client keeps of a payload. The flat he/en arrays are left out (they
# are the lines again); readText rebuilds them when it seeds its cache.
_PAYLOAD_KEYS = ("ref", "title", "heTitle", "heRef", "lines", "sections", "sectionNames",
                 "next", "prev", "categories", "authors", "era")


def applies(ref):
    """Whether ``ref`` is a page this module tries to render."""
    return enabled() and page_meta.ref_has_sections(ref)


def build(ref):
    """The server render for the text at ``ref``, or None to send the plain
    shell: ``{"requested_ref", "payload", "rows_html", "title"}``."""
    if not applies(ref):
        return None
    payload = _fetch_text(ref)
    if not isinstance(payload, dict) or payload.get("error"):
        return None
    lines = [line for line in (payload.get("lines") or []) if isinstance(line, dict)]
    if not lines or len(lines) > MAX_SSR_LINES:
        return None
    # A page with no verse text in it is no page (the client says "no text
    # found" for it); rows with nothing in them are still drawn, as the client does.
    if not any(_plain_text(line.get("he")) or _plain_text(line.get("en")) for line in lines):
        return None
    rows_html = render_rows(lines)
    trimmed = {key: payload[key] for key in _PAYLOAD_KEYS if key in payload}
    trimmed["lines"] = lines
    return {
        "requested_ref": ref,
        "payload": trimmed,
        "rows_html": Markup(rows_html),
        "title": header_title(payload, ref),
    }
