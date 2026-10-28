"""
Turn a question into what to search for, before it is answered.

A reader asks in their own words ("where else does it say the land ate the
people"); the texts use other words ("a land that eateth up the inhabitants
thereof", ארץ אכלת יושביה). Searching the question's own words misses them.
``plan(question)`` asks a small, fast model (Claude Haiku, about a second; Gemini
Flash-Lite timed out too often to sit in front of every answer) for:

* ``refs``: the few references it expects to hold the answer,
* ``hebrew``: short phrases as the Hebrew original words them,
* ``english``: short phrases as a classic translation words them.

Nothing here is trusted as an answer. The phrases are only searched for
(backend/source_search.py), and every ref, named or found, is loaded and kept
only when its own text matches the question (``rank_sources``). A guessed ref
that does not exist fails to load; one that exists but says something else
scores low and is dropped.

Blocking (the Anthropic SDK's sync client): call it from a worker thread. Any
failure, a missing key, an Anthropic outage, or a reply later than
``PLAN_WAIT_SECONDS`` returns None, and the search runs on the question's own
words as before.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from typing import Any, Optional

from backend.health_check import health

logger = logging.getLogger(__name__)

# How long the search waits for the plan; a late reply is dropped.
PLAN_WAIT_SECONDS = 3.5
_MAX_OUTPUT_TOKENS = 300
MAX_REFS = 4
MAX_PHRASES = 3
_MAX_PHRASE_CHARS = 60
_MAX_REF_CHARS = 90
_MAX_QUESTION_CHARS = 600

# A ref the reader can open: a title, then a chapter/page and optionally a
# verse ("Numbers 13:32", "Bava Batra 14b:3", "Shulchan Arukh, Orach Chayim 263:2").
_REF_RE = re.compile(r"^[A-Za-z][A-Za-z' ,.-]{1,70} \d{1,3}[ab]?(?::\d{1,3})?(?:-\d{1,3})?$")
_HEBREW_RE = re.compile(r"[א-ת]")

_SYSTEM = (
    "You plan a search of the Sefaria library for a question about Jewish texts, law or practice. "
    "Reply with JSON only: {\"refs\": [...], \"hebrew\": [...], \"english\": [...]}.\n"
    "refs: up to 4 Sefaria references that most likely state the answer itself, most likely first, "
    "written the way Sefaria writes them (\"Numbers 13:32\", \"Shulchan Arukh, Orach Chayim 263:3\", "
    "\"Mishneh Torah, Sabbath 30:6\", \"Bava Batra 14b\"). For a question that asks where something is "
    "written, list every place it is written. Leave out any you are not sure of.\n"
    "hebrew: up to 3 short phrases (2-4 words, no vowel points) as the Hebrew or Aramaic original "
    "words the answer.\n"
    "english: up to 3 short phrases (2-3 words) as a classic English translation words the answer "
    "(\"eateth up the inhabitants\", \"important person\").\n"
    "Return empty lists for a question that is not about a text or a law."
)

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="question-plan")


_TALMUD_PREFIX_RE = re.compile(r"^(?:talmud bavli|bavli|babylonian talmud|talmud)\s*,?\s+", re.IGNORECASE)


def _no_points(text: str) -> str:
    """Hebrew without vowel points or cantillation (the search index has none)."""
    return "".join(ch for ch in unicodedata.normalize("NFD", text) if not unicodedata.combining(ch))


def _strings(value: Any, limit: int, max_chars: int) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        text = re.sub(r"\s+", " ", str(item or "")).strip()
        if text and len(text) <= max_chars and text not in out:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def parse(raw: Any) -> Optional[dict[str, list[str]]]:
    """The model's reply as ``{"refs", "hebrew", "english"}``, each a short list
    of clean strings; None when the reply is not that JSON object."""
    try:
        data = json.loads(str(raw or ""))
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    refs = [_TALMUD_PREFIX_RE.sub("", ref) for ref in _strings(data.get("refs"), MAX_REFS, _MAX_REF_CHARS)]
    refs = [ref for ref in refs if _REF_RE.match(ref)]
    hebrew = [_no_points(p) for p in _strings(data.get("hebrew"), MAX_PHRASES, _MAX_PHRASE_CHARS)]
    hebrew = [p for p in hebrew if _HEBREW_RE.search(p)]
    english = [p for p in _strings(data.get("english"), MAX_PHRASES, _MAX_PHRASE_CHARS) if not _HEBREW_RE.search(p)]
    return {"refs": refs, "hebrew": hebrew, "english": english}


def _ask_model(question: str) -> Optional[dict[str, list[str]]]:
    from backend import claude

    client = claude._get_client()
    if client is None:
        return None
    model = claude._CLAUDE_FALLBACK_MODEL
    response = client.messages.create(
        model=model,
        max_tokens=_MAX_OUTPUT_TOKENS,
        system=_SYSTEM,
        messages=[{"role": "user", "content": question[:_MAX_QUESTION_CHARS]}],
        timeout=PLAN_WAIT_SECONDS,
        **claude._anthropic_request_options(model, "low", thinking=False),
    )
    _record_cost(model, response)
    text = "".join(getattr(block, "text", "") for block in getattr(response, "content", None) or [])
    return parse(text)


def _record_cost(model: str, response: Any) -> None:
    """Log the call's cost against the reader (this runs in a copy of the request's
    context). It is its own row: the request's budget reservation is left for the
    answer call to settle."""
    from backend import claude
    from backend.cost_meter import record_llm_call
    from backend.logging_setup import bind_budget_reservation, get_request_id

    tokens_in, tokens_out = claude._anthropic_usage_tokens(getattr(response, "usage", None))
    bind_budget_reservation("")
    try:
        asyncio.run(record_llm_call(
            provider="anthropic", model=model, input_tokens=tokens_in, output_tokens=tokens_out,
            route="/ask", request_id=get_request_id()))
    except Exception as exc:  # noqa: BLE001 - the plan stands without its cost row
        logger.debug("question_plan: cost not recorded: %s", type(exc).__name__)


def plan(question: str) -> Optional[dict[str, list[str]]]:
    """What to search for to answer ``question`` (see the module docstring), or
    None when it cannot be had in time. Never raises."""
    question = str(question or "").strip()
    if not question or not health.is_up("claude"):
        return None
    future = _executor.submit(contextvars.copy_context().run, _ask_model, question)
    try:
        return future.result(timeout=PLAN_WAIT_SECONDS)
    except FutureTimeout:
        logger.info("question_plan: no plan within %.1fs", PLAN_WAIT_SECONDS)
    except Exception as exc:  # noqa: BLE001 - fail open: the search runs on the question's words
        logger.warning("question_plan: failed: %s", type(exc).__name__)
    return None
