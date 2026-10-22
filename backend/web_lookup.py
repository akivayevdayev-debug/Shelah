"""Web lookup: the AI's very last resort for a question the sources cannot settle.

Some questions are plain facts about the world that no Sefaria text or poskim
discuss: "is this brand of gum kosher?", "does this product carry an OU?". For
those, and only those, the AI may ask for a web lookup. It is never the first
move and never automatic:

  1. The normal answer pass runs with the Sefaria/commentary/customs context. If
     (and only if) the model decides that context cannot settle a concrete
     real-world fact, it returns a short ``web_query`` instead of a ruling
     (instruction 21 in claude.build_prompt, offered only when lookup is allowed).
  2. This module runs ONE Google-Search-grounded Gemini call for that query and
     returns the findings plus the pages they came from. The call is plain text:
     Gemini cannot combine Search grounding with its JSON answer mode, so the
     grounded call and the answer call are separate.
  3. The answer pass runs again with those findings as a clearly-labelled,
     untrusted ``<retrieved_context source="web_lookup_last_resort">`` section.
     The reader sees the standard web-last-resort warning and the answer cites the
     pages by name.

Allowed only when the server switch ``AI_WEB_SEARCH`` is on (default on) AND the
reader has not turned "Web search" off in settings. Fail-open: a timeout, an
empty result, a missing SDK or key means the answer is written without it.

Privacy: the query is written by the model from the question and capped; the
reader's identity, history and memories are never sent. Search results are third
-party text: they are screened by backend.retrieval_guard and framed as data,
never instructions.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any, Dict, List, Optional

from backend import text_trust

logger = logging.getLogger(__name__)

MAX_QUERY_CHARS = 160
MAX_FINDINGS_CHARS = 2400
MAX_PAGES = 6
_DEFAULT_TIMEOUT_SECONDS = 15.0
_LOOKUP_MAX_OUTPUT_TOKENS = 700
# A lookup plus a second answer pass needs room in the overall AI budget.
MIN_REMAINING_BUDGET_SECONDS = 20.0

_FALSE_VALUES = {"0", "false", "no", "off"}

_LOOKUP_SYSTEM = (
    "You are a research assistant for a Jewish-law (halacha) question-answering app. "
    "Use Google Search to find current, factual information that answers the query. "
    "Report what the pages say in 80-200 words of plain prose, in the language of the "
    "query: name the manufacturer, product, ingredient or organisation and any kosher "
    "certification (agency and symbol) the pages state. If the pages disagree, are "
    "unclear, or you find nothing reliable, say exactly that. Prefer manufacturer, "
    "kashrut-agency and well-known reference sites. Report facts only: do not give a "
    "halachic ruling and do not invent a certification."
)


def server_enabled() -> bool:
    """The deployment-wide kill switch: ``AI_WEB_SEARCH=0`` turns every lookup off."""
    return os.environ.get("AI_WEB_SEARCH", "1").strip().lower() not in _FALSE_VALUES


def coerce_preference(value: Any) -> Optional[bool]:
    """The reader's "Web search" setting from a request body: False/True when
    they sent one, None when they did not (the default, on)."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in _FALSE_VALUES:
            return False
        if lowered in {"1", "true", "yes", "on"}:
            return True
    return None


def allowed(preference: Optional[bool]) -> bool:
    """Whether this request may use a web lookup: the server switch is on and
    the reader has not turned it off."""
    return server_enabled() and preference is not False


def _timeout_seconds() -> float:
    try:
        return max(5.0, float(os.environ.get("AI_WEB_SEARCH_TIMEOUT_SECONDS", _DEFAULT_TIMEOUT_SECONDS)))
    except ValueError:
        return _DEFAULT_TIMEOUT_SECONDS


def requested_query(result: Optional[Dict[str, Any]]) -> str:
    """The web query a first-pass result asks for, cleaned, or "" when it does not
    ask for one."""
    structured = (result or {}).get("structured")
    if not isinstance(structured, dict) or structured.get("out_of_scope"):
        return ""
    return clean_query(structured.get("web_query"))


def clean_query(raw: Any) -> str:
    """A search query the model wrote, reduced to short plain text. Anything
    that looks like a link, an email address or a long number is refused: the
    query goes to a third party and must hold no personal data."""
    from backend.claude import sanitize_user_query

    text = re.sub(r"\s+", " ", str(raw or "")).strip()
    if not text or re.search(r"https?://|www\.|@\S+\.\S+|\d{7,}", text, re.I):
        return ""
    return sanitize_user_query(text, max_chars=MAX_QUERY_CHARS)


def _prompt(query: str, language: str) -> str:
    wants_hebrew = str(language or "").strip().lower().startswith("he")
    return (
        f"Query: {query}\n"
        f"Write the findings in {'Hebrew' if wants_hebrew else 'English'}."
    )


def _generation_config(types_module: Any) -> Any:
    return types_module.GenerateContentConfig(
        system_instruction=_LOOKUP_SYSTEM,
        tools=[types_module.Tool(google_search=types_module.GoogleSearch())],
        max_output_tokens=_LOOKUP_MAX_OUTPUT_TOKENS,
        temperature=0.2,
    )


def _model_name() -> str:
    from backend import claude

    return (
        os.environ.get("GEMINI_WEB_MODEL")
        or os.environ.get("GEMINI_MODEL")
        or claude._DEFAULT_GEMINI_MODEL
    ).strip()


def _usage(response: Any) -> Dict[str, int]:
    usage = getattr(response, "usage_metadata", None)
    return {
        "input": int(getattr(usage, "prompt_token_count", 0) or 0),
        "output": int(getattr(usage, "candidates_token_count", 0) or 0),
    }


def _pages(response: Any) -> List[Dict[str, str]]:
    """The distinct pages Gemini grounded its findings on: {"title", "url"}."""
    pages: List[Dict[str, str]] = []
    seen = set()
    for candidate in getattr(response, "candidates", None) or []:
        metadata = getattr(candidate, "grounding_metadata", None)
        for chunk in getattr(metadata, "grounding_chunks", None) or []:
            web = getattr(chunk, "web", None)
            title = str(getattr(web, "title", "") or getattr(web, "domain", "") or "").strip()
            url = str(getattr(web, "uri", "") or "").strip()
            key = (title.lower(), url)
            if not (title or url) or key in seen:
                continue
            seen.add(key)
            pages.append({"title": title[:120], "url": url[:600]})
            if len(pages) >= MAX_PAGES:
                return pages
    return pages


def _cites_denied_source(response: Any) -> bool:
    """True when any grounding page is a publisher backend/text_trust.py
    denies (Reform, Conservative, ...). Gemini's `uri` is a redirect, so the
    page's `domain` and `title` are what name the real site."""
    for candidate in getattr(response, "candidates", None) or []:
        metadata = getattr(candidate, "grounding_metadata", None)
        for chunk in getattr(metadata, "grounding_chunks", None) or []:
            web = getattr(chunk, "web", None)
            if text_trust.is_source_denied(getattr(web, "domain", ""), getattr(web, "title", ""),
                                           getattr(web, "uri", "")):
                return True
    return False


def _search_queries(response: Any) -> List[str]:
    queries: List[str] = []
    for candidate in getattr(response, "candidates", None) or []:
        metadata = getattr(candidate, "grounding_metadata", None)
        for query in getattr(metadata, "web_search_queries", None) or []:
            text = str(query or "").strip()[:MAX_QUERY_CHARS]
            if text and text not in queries:
                queries.append(text)
    return queries[:4]


def _result_from(query: str, response: Any) -> Optional[Dict[str, Any]]:
    """The lookup result for a grounded reply, or None when there is nothing
    usable (no text, no pages to stand behind it, or injected instructions)."""
    from backend import claude
    from backend.retrieval_guard import withhold_injected

    text = str(getattr(response, "text", "") or "").strip()
    pages = _pages(response)
    if not text or not pages:
        return None
    # Fail closed: findings drawn partly from a denied publisher are dropped whole.
    if _cites_denied_source(response):
        logger.info("web lookup dropped: a grounding page is a denied source")
        return None
    if withhold_injected([text, *[p["title"] for p in pages]], source="web_lookup") is None:
        return None
    return {
        "query": query,
        "text": claude._sanitize_prompt_payload(text, max_chars=MAX_FINDINGS_CHARS),
        "sources": pages,
        "search_queries": _search_queries(response),
    }


async def lookup_async(query: str, language: str = "en") -> Optional[Dict[str, Any]]:
    """One grounded search, off the event loop's critical path (the SDK's own
    async client). None on any failure."""
    from backend import claude
    from backend.cost_meter import record_llm_call
    from backend.logging_setup import get_request_id

    query = clean_query(query)
    if not query:
        return None
    try:
        if claude._configure_gemini_client() or claude._cached_gemini_client is None or not claude.genai_types:
            return None
        model = _model_name()
        response = await asyncio.wait_for(
            claude._cached_gemini_client.aio.models.generate_content(
                model=model,
                contents=_prompt(query, language),
                config=_generation_config(claude.genai_types),
            ),
            timeout=_timeout_seconds(),
        )
        tokens = _usage(response)
        await record_llm_call(
            provider="gemini", model=model, input_tokens=tokens["input"],
            output_tokens=tokens["output"], route="/ask", request_id=get_request_id(),
        )
        return _result_from(query, response)
    except Exception as exc:  # noqa: BLE001 - fail open: the answer is written without the web
        logger.warning("web lookup failed: %s", type(exc).__name__)
        return None


def lookup_sync(query: str, language: str = "en") -> Optional[Dict[str, Any]]:
    """The same lookup for the Flask path (a worker thread with no event loop)."""
    from backend import claude
    from backend.cost_meter import record_llm_call
    from backend.logging_setup import get_request_id

    query = clean_query(query)
    if not query:
        return None
    try:
        if claude._configure_gemini_client() or claude._cached_gemini_client is None or not claude.genai_types:
            return None
        model = _model_name()
        response = claude._cached_gemini_client.models.generate_content(
            model=model,
            contents=_prompt(query, language),
            config=_generation_config(claude.genai_types),
        )
        tokens = _usage(response)
        try:
            asyncio.run(record_llm_call(
                provider="gemini", model=model, input_tokens=tokens["input"],
                output_tokens=tokens["output"], route="/ask", request_id=get_request_id(),
            ))
        except Exception:  # noqa: BLE001 - cost bookkeeping never blocks the answer
            pass
        return _result_from(query, response)
    except Exception as exc:  # noqa: BLE001 - fail open
        logger.warning("web lookup failed: %s", type(exc).__name__)
        return None


def format_findings(found: Dict[str, Any]) -> str:
    """The findings as the text of the prompt section: what was found, then the
    pages by name (titles only; links stay out of the prompt)."""
    pages = ", ".join(p["title"] for p in found.get("sources", []) if p.get("title"))
    return f"Search: {found.get('query', '')}\nFindings: {found.get('text', '')}\nPages: {pages or '(unnamed)'}"


def result_summary(found: Optional[Dict[str, Any]], query: str) -> Dict[str, Any]:
    """What an AI result reports about its lookup (result["web_lookup"]): used or
    not, never the findings themselves."""
    return {
        "used": bool(found),
        "queried": bool(query),
        "sources": list((found or {}).get("sources", [])),
    }
