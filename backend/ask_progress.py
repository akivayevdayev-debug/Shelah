"""
Live progress for one AI answer.

The /ask pipeline does several independent things before and while it asks the
model: look up primary sources, pull Halachipedia / Wikipedia context, read
the reader's community customs, look up today's zmanim and Hebrew date, and
finally wait on the model. Until now the browser saw a silent skeleton for the
whole time. This module lets each of those steps say when it starts and ends,
so the client can show what is actually happening.

Design constraints:

* Reporting is optional and free when unused. Nothing is bound on the plain
  JSON path, so begin()/end() return immediately there.
* The reporter is carried in a ContextVar. asyncio tasks, asyncio.to_thread
  and backend.logging_setup.submit_with_context all copy the caller's context,
  so a step that runs on a worker still reports to the request that started
  it. Work that has no bound reporter (a background job, another request)
  reports to nobody.
* Reporting can never fail a request: every send is guarded.
* Steps that fan out into several lookups (Halachipedia and Wikipedia are one
  "commentary" step) are reference-counted, so the client sees one start when
  the first lookup begins and one done when the last one ends.
* A step is shown only for work the answer really uses. A lookup that may
  find nothing (Halachipedia, Wikipedia, community customs) is not announced
  while it runs; once the context for the model is settled, used() reports
  the ones whose findings went in, with the web pages they read (a `site`
  event the client turns into a link). A step that ran but found nothing
  ends as "none", and the client drops it.
* A step can also say exactly what it is doing right now ("Reading Shulchan
  Arukh, Orach Chayim 261", "Checking sunset and nightfall for Shabbat
  times"). That is a separate `detail` event with a closed vocabulary of
  kinds plus plain parameters, never prose: the client owns the wording, in
  both languages, so a detail can never carry markup or the wrong language.
"""

from __future__ import annotations

import json
import re
import threading
from collections.abc import Callable
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Any

from backend.logging_setup import get_logger

logger = get_logger(__name__)

# Stage ids the client knows how to label (static/js/ask-progress.js). Kept as
# a closed set so a typo here is a loud test failure, not a silent no-op.
STAGE_SOURCES = "sources"
STAGE_COMMENTARY = "commentary"
STAGE_CUSTOMS = "customs"
STAGE_TIMES = "times"
STAGE_THINKING = "thinking"
STAGES = frozenset({
    STAGE_SOURCES, STAGE_COMMENTARY, STAGE_CUSTOMS, STAGE_TIMES, STAGE_THINKING,
})

# What a step can say about itself (static/js/ask-progress.js words each kind).
DETAIL_REFS = "refs"          # sources:  refs=[...up to 3], count=<all refs>
DETAIL_COMMUNITY = "community"  # customs: community=<the reader's lens>
DETAIL_TIMES = "times"        # times:    topic=<one of TIMES_TOPICS>
DETAIL_TOOL = "tool"          # thinking: tool=<tool name>, ref=<a text ref>
DETAIL_STEP = "step"          # thinking: step=<one of STEPS>
MAX_DETAIL_REFS = 3
DETAIL_KINDS = frozenset({DETAIL_REFS, DETAIL_COMMUNITY, DETAIL_TIMES, DETAIL_TOOL, DETAIL_STEP})

# What the model call itself is doing when it is not just thinking: the
# reader sees why an answer is taking longer than the usual few seconds.
STEP_LONG = "long"                  # a long, detailed answer was asked for
STEP_RETRY = "retry"                # the first model was busy; asking it again
STEP_SECOND_MODEL = "second_model"  # the first model failed; asking another
STEP_SECOND_LOOK = "second_look"    # the answer is being checked once more
STEPS = frozenset({STEP_LONG, STEP_RETRY, STEP_SECOND_MODEL, STEP_SECOND_LOOK})

# Web pages reported per step (`site` events), and how long their fields may be.
MAX_SITES = 6
MAX_SITE_URL_CHARS = 500
MAX_SITE_TITLE_CHARS = 120

NDJSON_MIMETYPE = "application/x-ndjson"


class ProgressReporter:
    """Turns begin()/end() calls from any thread into ordered stage events."""

    def __init__(self, send: Callable[[dict[str, Any]], None]):
        self._send = send
        self._lock = threading.Lock()
        self._depth: dict[str, int] = {}
        self._detail_depth: dict[str, int] = {}

    def begin(self, stage: str) -> None:
        with self._lock:
            depth = self._depth.get(stage, 0)
            self._depth[stage] = depth + 1
            if depth:
                return
            self._deliver({"type": "stage", "stage": stage, "state": "start"})

    def end(self, stage: str, empty: bool = False) -> None:
        """`empty`: the step found nothing the answer uses, so the client drops
        it instead of listing it as done."""
        with self._lock:
            depth = self._depth.get(stage, 0)
            if depth <= 0:
                return
            self._depth[stage] = depth - 1
            if depth > 1:
                return
            self._deliver({"type": "stage", "stage": stage, "state": "none" if empty else "done"})

    def event(self, event: dict[str, Any]) -> None:
        with self._lock:
            self._deliver(event)

    def detail(self, stage: str, detail: dict[str, Any] | None) -> None:
        """What `stage` is doing right now; None clears it. Not reference
        counted: the latest word wins, which is what the line should say."""
        with self._lock:
            self._deliver({"type": "detail", "stage": stage, "detail": detail})

    def enter_detail(self, stage: str, detail: dict[str, Any]) -> None:
        with self._lock:
            self._detail_depth[stage] = self._detail_depth.get(stage, 0) + 1
            self._deliver({"type": "detail", "stage": stage, "detail": detail})

    def leave_detail(self, stage: str) -> None:
        """The matching end of enter_detail: the line goes back to naming the
        step only when the last concurrent piece of work under it is over."""
        with self._lock:
            depth = self._detail_depth.get(stage, 0)
            if depth <= 0:
                return
            self._detail_depth[stage] = depth - 1
            if depth == 1:
                self._deliver({"type": "detail", "stage": stage, "detail": None})

    def _deliver(self, event: dict[str, Any]) -> None:
        try:
            self._send(event)
        except Exception:  # noqa: BLE001 -- progress is best-effort by design
            logger.debug("ask progress send failed", exc_info=True)


_reporter: ContextVar[ProgressReporter | None] = ContextVar("ask_progress_reporter", default=None)


def bind(send: Callable[[dict[str, Any]], None]) -> Token:
    """Start reporting this context (and every context copied from it) to
    `send`. `send` may be called from any thread and must not block."""
    return _reporter.set(ProgressReporter(send))


def unbind(token: Token) -> None:
    _reporter.reset(token)


def begin(stage: str) -> None:
    reporter = _reporter.get()
    if reporter is not None and stage in STAGES:
        reporter.begin(stage)


def end(stage: str) -> None:
    reporter = _reporter.get()
    if reporter is not None and stage in STAGES:
        reporter.end(stage)


def _clean_site(page: Any) -> dict[str, str] | None:
    """{"title", "url"} for a web page the answer reads, or None when it is not
    a plain https link (the client renders it as a link, so nothing else may
    pass)."""
    if not isinstance(page, dict):
        return None
    url = str(page.get("url") or "").strip()
    if not url.startswith("https://") or len(url) > MAX_SITE_URL_CHARS or any(ch.isspace() for ch in url):
        return None
    title = " ".join(str(page.get("title") or "").split())[:MAX_SITE_TITLE_CHARS]
    return {"title": title, "url": url}


def sites(stage_id: str, pages: Any) -> None:
    """Report the web pages `stage_id` read, one `site` event each (at most
    MAX_SITES). A no-op with no stream bound."""
    reporter = _reporter.get()
    if reporter is None or stage_id not in STAGES or not isinstance(pages, (list, tuple)):
        return
    cleaned = [site for site in (_clean_site(page) for page in pages) if site][:MAX_SITES]
    for site in cleaned:
        reporter.event({"type": "site", "stage": stage_id, "site": site})


def used(stage_id: str, pages: Any = ()) -> None:
    """A lookup whose findings go into the answer, reported once it is known
    to be used: its web pages, then the step as finished."""
    sites(stage_id, pages)
    begin(stage_id)
    end(stage_id)


def used_context(commentary_pages: Any, customs_used: bool) -> None:
    """Report the background lookups whose findings go into the answer: the
    Halachipedia / Wikipedia pages (`commentary_pages`, [{"title", "url"}])
    and the community customs. Nothing for the ones left out."""
    pages = [page for page in (commentary_pages or ()) if page]
    if pages:
        used(STAGE_COMMENTARY, pages)
    if customs_used:
        used(STAGE_CUSTOMS)


def _clean_detail(kind: str, params: dict[str, Any]) -> dict[str, Any]:
    """The detail's wire form: its kind and whichever parameters have a value."""
    if isinstance(params.get("refs"), (list, tuple)):
        refs = [str(ref).strip() for ref in params["refs"] if str(ref or "").strip()]
        params = {**params, "refs": refs[:MAX_DETAIL_REFS]}
    return {"kind": kind, **{key: value for key, value in params.items() if value not in (None, "", [], ())}}


def detail(stage_id: str, kind: str, **params: Any) -> None:
    """Say what `stage_id` is doing right now, e.g.
    `detail("sources", "refs", refs=[...], count=7)`. A no-op with no stream
    bound, for a stage or kind the client has no wording for, and when the
    kind has nothing to say."""
    reporter = _reporter.get()
    if reporter is None or stage_id not in STAGES or kind not in DETAIL_KINDS:
        return
    reporter.detail(stage_id, _clean_detail(kind, params))


def step(name: str) -> None:
    """Say which step the model call has reached (one of STEPS). A no-op for a
    name outside STEPS or with no stream bound."""
    if name in STEPS:
        detail(STAGE_THINKING, DETAIL_STEP, step=name)


@contextmanager
def detail_scope(stage_id: str, kind: str, **params: Any):
    """`with ask_progress.detail_scope("thinking", "tool", tool=name):` for
    work that happens inside a step and ends before it does (one tool call of
    the model's). The detail clears when the last such block exits."""
    reporter = _reporter.get()
    if reporter is None or stage_id not in STAGES or kind not in DETAIL_KINDS:
        yield
        return
    reporter.enter_detail(stage_id, _clean_detail(kind, params))
    try:
        yield
    finally:
        reporter.leave_detail(stage_id)


# ── the "times" step: only when the question is about a time ─────────────
#
# Every answer is given today's date and zmanim, because the model has no
# clock of its own. Telling the reader "Looking up today's zmanim" for a
# question about the Rambam would be noise, so the step is reported only when
# the question is about a time or date, and then it says which kind.

TIMES_SHABBAT = "shabbat"
TIMES_ZMANIM = "zmanim"
TIMES_OMER = "omer"
TIMES_PARASHA = "parasha"
TIMES_HOLIDAY = "holiday"
TIMES_TOPICS = (TIMES_SHABBAT, TIMES_ZMANIM, TIMES_OMER, TIMES_PARASHA, TIMES_HOLIDAY)

# A question names a moment (Shabbat, candle lighting, a holiday) without asking
# about its time ("who should light the candles?", "how many candles on
# Chanukah?"): the lookup then is not part of the answer, so nothing is shown.
_WHEN = (
    r"\b(?:when|what time|times?|until|till|starts?|begins?|ends?|finish(?:es)?|how long|how late"
    r"|how early|minutes|tonight|today|this week|this year|next)\b"
)
_SHABBAT_MOMENT = (
    r"(?:candle[\s-]?light\w*|light(?:ing)? (?:the )?candles|havdal\w*|motz[ae]i|kabbalat shabbat"
    r"|shabbat|shabbos|sabbath|yom tov|erev)"
)
_SHABBAT_TIMING = re.compile(
    rf"{_SHABBAT_MOMENT}.*{_WHEN}|{_WHEN}.*{_SHABBAT_MOMENT}",
    re.IGNORECASE,
)
_ZMANIM = re.compile(
    r"\bzman(?:im|ei)?\b|sunrise|sunset|nightfall|\bdawn\b|tz[ae]is?\b|\bnetz\b|shkia|\bplag\b|chatzot"
    r"|latest time|earliest time|what time|alot hashachar|sof zman",
    re.IGNORECASE,
)
_OMER = re.compile(r"\bomer\b", re.IGNORECASE)
_PARASHA = re.compile(r"parash(?:a|ah)\b|\bparsha\b|weekly (?:torah )?portion|torah portion", re.IGNORECASE)
_HOLIDAY_NAME = (
    r"(?:rosh chodesh|rosh hashana\w*|yom kippur|sukkot|simchat torah|chanukah|hanukkah|\bpurim\b|pesach|passover"
    r"|shavuot|tisha b'?av|tu b'?shvat|lag b'?omer|fast day|\bholiday)"
)
_HOLIDAY = re.compile(
    rf"hebrew date|what day is|{_HOLIDAY_NAME}.*{_WHEN}|{_WHEN}.*{_HOLIDAY_NAME}",
    re.IGNORECASE,
)
_TIMES_PATTERNS = (
    (TIMES_SHABBAT, _SHABBAT_TIMING),
    (TIMES_OMER, _OMER),
    (TIMES_PARASHA, _PARASHA),
    (TIMES_ZMANIM, _ZMANIM),
    (TIMES_HOLIDAY, _HOLIDAY),
)


def times_topic(question: str | None) -> str | None:
    """Which kind of time the question is about, or None when it is not about
    one (the "times" step is then not reported)."""
    text = str(question or "")
    for topic, pattern in _TIMES_PATTERNS:
        if pattern.search(text):
            return topic
    return None


@contextmanager
def times_stage(question: str | None):
    """`with ask_progress.times_stage(question):` around the date/zmanim
    lookup: reported as the "times" step, naming the topic, only when the
    question is about a time."""
    topic = times_topic(question)
    if topic is None:
        yield
        return
    detail(STAGE_TIMES, DETAIL_TIMES, topic=topic)
    with stage(STAGE_TIMES):
        yield


class _StageScope:
    """What `with stage(...) as scope:` yields: `scope.empty()` says the step
    found nothing the answer uses."""

    def __init__(self) -> None:
        self.found_nothing = False

    def empty(self) -> None:
        self.found_nothing = True


@contextmanager
def stage(stage_id: str):
    """`with ask_progress.stage("sources") as scope:` around a blocking step;
    call `scope.empty()` when it found nothing, and the client drops it."""
    begin(stage_id)
    scope = _StageScope()
    try:
        yield scope
    finally:
        reporter = _reporter.get()
        if reporter is not None and stage_id in STAGES:
            reporter.end(stage_id, empty=scope.found_nothing)


async def track(stage_id: str, awaitable, found: Callable[[Any], bool] | None = None):
    """Await `awaitable` as one progress step. With `found`, a result it calls
    empty ends the step as "none", so the client drops it."""
    begin(stage_id)
    result = None
    try:
        result = await awaitable
        return result
    finally:
        empty = found is not None and not _safe_found(found, result)
        reporter = _reporter.get()
        if reporter is not None and stage_id in STAGES:
            reporter.end(stage_id, empty=empty)


def _safe_found(found: Callable[[Any], bool], result: Any) -> bool:
    try:
        return bool(found(result))
    except Exception:  # noqa: BLE001 -- progress is best-effort by design
        return True


async def track_times(question: str | None, awaitable):
    """Await `awaitable` as the "times" step when `question` is about a time
    (see times_stage); otherwise just await it."""
    topic = times_topic(question)
    if topic is None:
        return await awaitable
    detail(STAGE_TIMES, DETAIL_TIMES, topic=topic)
    return await track(STAGE_TIMES, awaitable)


def wants_stream(accept_header: str | None) -> bool:
    """True when the client asked for the NDJSON progress stream. A client
    that does not name it (curl, tests, the service worker, older cached
    JS) gets the unchanged single JSON response."""
    return NDJSON_MIMETYPE in str(accept_header or "").lower()


def encode_event(event: dict[str, Any]) -> bytes:
    """One NDJSON line. ensure_ascii=False keeps Hebrew readable on the wire;
    the newline-delimited framing is safe because json.dumps escapes any
    newline inside a string."""
    return (json.dumps(event, ensure_ascii=False, separators=(",", ":"), default=str) + "\n").encode("utf-8")
