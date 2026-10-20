"""The AI's own one-line note on an answer it just gave.

A reader may rate or comment on an answer (backend/routes_feedback.py) but most
never do. So the server also leaves a short note of its own for every answer:
what it actually did (answered from N sources, looked the web up as a last
resort, fell back to the sources alone, declined). /admin/feedback shows these
rows with an "AI" badge and keeps them out of the helpful / not-helpful counts,
so the operator always has something to read for an answer nobody rated.

The note is composed from fixed wording and numbers, never by the model and
never from the question, the answer or a source's title -- so it cannot leak
what a reader asked, and it costs no extra AI call. It is written under no
user id (the reader is not identified), linked to the stored answer by
``history_id`` when there is one.

Storage needs scripts/sql/migrate_answer_feedback_ai_notes.sql (the ``source``
column and the widened verdict CHECK). Until it runs the insert fails and the
note is skipped quietly; nothing about the answer depends on it.

``AI_FEEDBACK_NOTES=0`` turns the notes off.
"""

from __future__ import annotations

import hashlib
import os
from typing import Any, Dict, Optional

AI_NOTE_VERDICT = "ai_note"
AI_NOTE_SOURCE = "ai"
_MAX_NOTE_CHARS = 500  # answer_feedback.comment's CHECK

# PostgREST / Postgres codes that mean "the migration has not run": undefined
# column, column missing from the schema cache, CHECK violation (the old
# verdict list). Expected until the SQL is applied, so not worth an alert.
_MIGRATION_PENDING = frozenset({"42703", "PGRST204", "23514"})
_LINK_COLUMNS_MISSING = frozenset({"42703", "PGRST204"})


def notes_enabled() -> bool:
    return os.environ.get("AI_FEEDBACK_NOTES", "1").strip().lower() not in {"0", "false", "no", "off"}


def _plural(count: int, word: str) -> str:
    return f"{count} {word}" if count == 1 else f"{count} {word}s"


def web_lookup_summary(result: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """{"used": bool, "pages": int} for the web lookup an AI result reports
    (``result["web_lookup"]``, see backend/web_lookup.py), tolerating its
    absence."""
    info = (result or {}).get("web_lookup")
    if not isinstance(info, dict) or not info.get("used"):
        return {"used": False, "pages": 0}
    sources = info.get("sources")
    return {"used": True, "pages": len(sources) if isinstance(sources, list) else 0}


def compose_note(
    *,
    fallback: bool = False,
    source_count: int = 0,
    mode: str = "balanced",
    community: str = "All",
    safety_class: str = "ok",
    out_of_scope: bool = False,
    web_used: bool = False,
    web_pages: int = 0,
) -> str:
    """The note's text: plain English, fixed wording, numbers and enum-like
    labels only."""
    if out_of_scope:
        text = "Declined: the question was outside Jewish law and learning."
    elif fallback:
        text = (
            "The AI did not respond, so the reader was shown "
            f"{_plural(source_count, 'discovered source')} instead of a written answer."
        )
    elif source_count > 0:
        text = f"Answered from {_plural(source_count, 'retrieved source')} in {mode} mode"
        text += "." if not community or community == "All" else f", {community} lens."
    else:
        text = f"Answered in {mode} mode without any retrieved source text."
    if web_used and not fallback and not out_of_scope:
        text += (
            f" Looked the web up as a last resort ({_plural(web_pages, 'page')})."
            if web_pages
            else " Looked the web up as a last resort; nothing usable came back."
        )
    if safety_class and safety_class != "ok":
        text += f" Safety route: {safety_class}."
    return text[:_MAX_NOTE_CHARS]


def _insert(supabase, table: str, record: Dict[str, Any], link: Dict[str, Any]) -> None:
    query = supabase.table(table)
    if not link:
        query.insert(record).execute()
        return
    try:
        query.insert({**record, **link}).execute()
    except Exception as e:  # noqa: BLE001 - classified just below
        if str(getattr(e, "code", "") or "") not in _LINK_COLUMNS_MISSING:
            raise
        # Either the link columns or the new ``source`` column is missing; the
        # second attempt settles which (it keeps ``source``, drops the link).
        supabase.table(table).insert(record).execute()


def record_ai_note(
    question: str,
    *,
    history_id: Optional[str] = None,
    result: Optional[Dict[str, Any]] = None,
    structured: Optional[Dict[str, Any]] = None,
    mode: str = "balanced",
    language: str = "en",
    community: str = "All",
    source_count: int = 0,
    fallback: bool = False,
) -> bool:
    """Store the AI's note for one answer. Blocking (one Supabase insert): call
    it from a thread on async paths. Never raises; True when a row was stored."""
    if not notes_enabled() or not str(question or "").strip():
        return False
    try:
        import app as _app  # lazy -- app imports this module's callers at load time

        supabase = _app._get_supabase_client()
        if not supabase:
            return False
        structured = structured if isinstance(structured, dict) else {}
        web = web_lookup_summary(result)
        record = {
            "user_id": None,
            "question_hash": hashlib.sha256(str(question).strip().encode("utf-8")).hexdigest(),
            "verdict": AI_NOTE_VERDICT,
            "source": AI_NOTE_SOURCE,
            "comment": compose_note(
                fallback=fallback,
                source_count=int(source_count or 0),
                mode=str(mode or "balanced")[:32],
                community=str(community or "All")[:40],
                safety_class=str(structured.get("safety_class") or "ok")[:32],
                out_of_scope=bool(structured.get("out_of_scope")),
                web_used=web["used"],
                web_pages=web["pages"],
            ),
            "mode": str(mode or "balanced")[:32],
            "language": str(language or "en")[:16],
            "fallback": bool(fallback),
            "safety_class": str(structured.get("safety_class") or "ok")[:32],
        }
        link = {"history_id": history_id, "shared_view": False} if history_id else {}
        _insert(supabase, _app.SUPABASE_ANSWER_FEEDBACK_TABLE, record, link)
        return True
    except Exception as e:  # noqa: BLE001 - a note must never break an answer
        if str(getattr(e, "code", "") or "") not in _MIGRATION_PENDING:
            try:
                import app as _app

                _app._capture_backend_error("ai_note_persist_failed", e, {})
            except Exception:  # noqa: BLE001
                pass
        return False
