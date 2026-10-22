"""
Answer-feedback blueprint for Sh'elah.

A single write-only endpoint: readers leave a thumbs up/down (and an
optional short comment) on an AI answer, or just a comment ("comment" verdict,
no rating). Feedback is accepted from signed-out readers too (nullable
user_id), matching the accept_legal() optional-auth pattern in
backend/routes_user.py.

Readers can never write the server's own note on an answer (verdict
"ai_note", source "ai" -- backend/ai_notes.py): ``source`` is not read from
the request, and "ai_note" is not an accepted verdict here.

Feedback on a stored answer is linked to its ask_history row (deep-link
Phase 6): the owner's client sends ``history_id``, a visitor on a shared
link sends ``share_token``. Neither is trusted as-is -- a history_id counts
only if it is the caller's own row, a share token only while its link is
live -- and the stored link is the row id (``history_id``, plus
``shared_view`` for a visitor's feedback), never the token, which the owner
can revoke. The columns come from
scripts/sql/migrate_answer_feedback_history_link.sql; until it runs, the
feedback is still saved, just unlinked.

A reader can change their rating or comment afterwards: POST answers with the
new row's ``id`` and ``PATCH /api/feedback/<id>`` edits that row, only for
whoever wrote it -- the same account, or signed out, the same device
(``device_owner``, the hash of the ``shelah_device`` cookie, never the cookie;
backend/device_identity.py). Anyone else, and the server's own notes, get a
404 that says nothing about whether the row exists. The ownership filter is
on the UPDATE itself, not only on a lookup before it. ``device_owner`` comes
from scripts/sql/migrate_answer_feedback_edit.sql; until it runs a guest's
feedback is saved without it and can't be edited.
"""

import hashlib
import re

from flask import Blueprint, jsonify, request

from backend.claude import sanitize_user_query
from backend.auth import maybe_require_clerk_auth
from backend.device_identity import DEVICE_COOKIE, owner_for_token
from backend.helpers import _json_object_body

from app import (
    SUPABASE_ANSWER_FEEDBACK_TABLE,
    SUPABASE_ASK_HISTORY_TABLE,
    _get_request_user_id,
    _get_supabase_client,
    _capture_backend_error,
)

routes_feedback = Blueprint("feedback", __name__)

_VALID_VERDICTS = ("helpful", "not_helpful", "comment")
# An edit changes the rating (or drops it to a bare comment); it can't turn a
# row into the server's note.
_EDIT_VERDICTS = _VALID_VERDICTS
_MAX_COMMENT_CHARS = 500
# The three metadata fields are enum-like short strings ("balanced"/"strict",
# "en"/"he", "ok"/"mental_health_or_self_harm" -- the longest safety class is
# 26 chars), so their caps are far tighter than the free-text comment's.
_MAX_MODE_CHARS = 32
_MAX_LANGUAGE_CHARS = 16
_MAX_SAFETY_CLASS_CHARS = 32

_HISTORY_ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_SHARE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
# PostgREST's "no such column": undefined column (42703) and column missing
# from the schema cache (PGRST204) -- the link migration hasn't run.
_LINK_COLUMNS_MISSING = frozenset({"42703", "PGRST204"})


def _short_field(payload, key, default, max_chars):
    """A capped, sanitized enum-like string field; `default` when the value
    is missing or sanitizes to nothing. Caps the way `comment` is capped
    (sanitize_user_query) so a malformed/oversized value can't land in a
    column that is expected to hold a short label (AI_SECURITY_REVIEW L2)."""
    return sanitize_user_query(str(payload.get(key) or ""), max_chars=max_chars) or default


def _linked_answer(supabase, payload, user_id):
    """{"history_id", "shared_view"} for the stored answer this feedback is
    about, or {} when it isn't one the caller may point at. Best effort: a
    failed lookup (e.g. the share columns don't exist yet) links nothing."""
    token = str(payload.get("share_token") or "")
    history_id = str(payload.get("history_id") or "")
    try:
        if _SHARE_TOKEN_RE.match(token):
            rows = (
                supabase.table(SUPABASE_ASK_HISTORY_TABLE).select("id")
                .eq("share_token", token).eq("is_public", True).limit(1).execute()
            ).data or []
            return {"history_id": rows[0]["id"], "shared_view": True} if rows else {}
        if user_id and _HISTORY_ID_RE.match(history_id):
            rows = (
                supabase.table(SUPABASE_ASK_HISTORY_TABLE).select("id")
                .eq("id", history_id).eq("user_id", user_id).limit(1).execute()
            ).data or []
            return {"history_id": rows[0]["id"], "shared_view": False} if rows else {}
    except Exception:
        return {}
    return {}


def _row_id(result):
    rows = getattr(result, "data", None) or []
    return rows[0].get("id") if rows and isinstance(rows[0], dict) else None


def _insert_feedback(supabase, record, link, device):
    """Insert the row with its optional columns -- the answer link, and the
    guest's device -- dropping them one migration at a time when a column
    isn't there yet, so the verdict itself is never lost. Returns the new
    row's id, or None."""
    attempts = [{**link, **device}]
    if link and device:
        # Either migration may be the one that is missing: keep whichever column exists.
        attempts += [device, link]
    if attempts[0]:
        attempts.append({})
    for extra in attempts:
        try:
            return _row_id(supabase.table(SUPABASE_ANSWER_FEEDBACK_TABLE).insert({**record, **extra}).execute())
        except Exception as e:
            if not extra or str(getattr(e, "code", "") or "") not in _LINK_COLUMNS_MISSING:
                raise
    return None


def _caller_device_owner():
    return owner_for_token(request.cookies.get(DEVICE_COOKIE))


def _owner_filter(user_id):
    """The (column, value) that scopes an edit to the caller, or None when
    there is no one to scope it to. Signed in, the account is the owner --
    a guest row from another device stays out of reach."""
    if user_id:
        return ("user_id", user_id)
    device = _caller_device_owner()
    return ("device_owner", device) if device else None


@routes_feedback.route("/api/feedback", methods=["POST"])
@maybe_require_clerk_auth
def submit_feedback():
    payload = _json_object_body()

    verdict = str(payload.get("verdict") or "").strip()
    if verdict not in _VALID_VERDICTS:
        return jsonify({"error": "verdict must be 'helpful', 'not_helpful' or 'comment'"}), 400

    question = str(payload.get("question") or "").strip()
    if not question:
        return jsonify({"error": "question is required"}), 400
    question_hash = hashlib.sha256(question.encode("utf-8")).hexdigest()

    comment = sanitize_user_query(
        str(payload.get("comment") or ""), max_chars=_MAX_COMMENT_CHARS)
    if verdict == "comment" and not comment:
        return jsonify({"error": "comment is required"}), 400

    record = {
        "user_id": _get_request_user_id(),
        "question_hash": question_hash,
        "verdict": verdict,
        "comment": comment,
        "mode": _short_field(payload, "mode", "balanced", _MAX_MODE_CHARS),
        "language": _short_field(payload, "language", "en", _MAX_LANGUAGE_CHARS),
        "fallback": bool(payload.get("fallback")),
        "safety_class": _short_field(payload, "safety_class", "ok", _MAX_SAFETY_CLASS_CHARS),
    }

    try:
        supabase_client = _get_supabase_client()
        if not supabase_client:
            return jsonify({"error": "Supabase not configured"}), 503
        link = _linked_answer(supabase_client, payload, record["user_id"])
        device_owner = None if record["user_id"] else _caller_device_owner()
        device = {"device_owner": device_owner} if device_owner else {}
        row_id = _insert_feedback(supabase_client, record, link, device)
    except Exception as e:
        _capture_backend_error("answer_feedback_persist_failed", e, {
            "verdict": verdict,
        })
        return jsonify({"error": "Could not save feedback"}), 500

    return jsonify({"success": True, "id": row_id}), 200


@routes_feedback.route("/api/feedback/<row_id>", methods=["PATCH"])
@maybe_require_clerk_auth
def edit_feedback(row_id):
    not_found = (jsonify({"error": "Not found"}), 404)
    if not _HISTORY_ID_RE.match(row_id or ""):
        return not_found
    payload = _json_object_body()

    verdict = str(payload.get("verdict") or "").strip()
    if verdict not in _EDIT_VERDICTS:
        return jsonify({"error": "verdict must be 'helpful', 'not_helpful' or 'comment'"}), 400
    comment = sanitize_user_query(
        str(payload.get("comment") or ""), max_chars=_MAX_COMMENT_CHARS)
    if verdict == "comment" and not comment:
        return jsonify({"error": "comment is required"}), 400

    owner = _owner_filter(_get_request_user_id())
    if not owner:
        return not_found
    try:
        supabase_client = _get_supabase_client()
        if not supabase_client:
            return jsonify({"error": "Supabase not configured"}), 503
        rows = (
            supabase_client.table(SUPABASE_ANSWER_FEEDBACK_TABLE).select("id, verdict")
            .eq("id", row_id).eq(*owner).limit(1).execute()
        ).data or []
        # The server's notes carry no user_id or device, so the owner filter
        # already skips them; the verdict check keeps it that way regardless.
        if not rows or rows[0].get("verdict") == "ai_note":
            return not_found
        updated = (
            supabase_client.table(SUPABASE_ANSWER_FEEDBACK_TABLE)
            .update({"verdict": verdict, "comment": comment})
            .eq("id", row_id).eq(*owner).execute()
        ).data or []
    except Exception as e:
        if str(getattr(e, "code", "") or "") in _LINK_COLUMNS_MISSING:
            return not_found  # no device column yet: no guest row is editable
        _capture_backend_error("answer_feedback_edit_failed", e, {"verdict": verdict})
        return jsonify({"error": "Could not save feedback"}), 500
    if not updated:
        return not_found
    return jsonify({"success": True, "id": row_id}), 200
