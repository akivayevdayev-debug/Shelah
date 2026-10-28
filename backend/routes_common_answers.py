"""
The answers to common questions, for the AI panel to show the moment a
reader sends one (backend/common_answers.py, static/js/common-answers.js).

``GET /api/ai/common-answers`` lists the fingerprints of the setting's
common questions plus the folding rules the browser needs to compute them.
``GET /api/ai/common-answers/<fingerprint>`` returns one answer's text. The
real request still runs: it is answered from the same cache on the server,
stored in the reader's history, and replaces what was shown.

Both take the setting as query parameters: ``lang``, ``mode``, ``lens``,
``web`` ("0" when web search is off) and ``kind`` ("thread" for a signed-in
reader's conversation, "ask" otherwise).
"""

from __future__ import annotations

import re

from flask import Blueprint, jsonify, request

from backend import claude, common_answers
from backend.helpers import _canonicalize_community_name, _sanitize_answer_mode

routes_common_answers = Blueprint("routes_common_answers", __name__)

# Short enough that a newly common question shows up within minutes.
_LIST_MAX_AGE = 300
_ANSWER_MAX_AGE = 120
_FINGERPRINT_RE = re.compile(rf"^[0-9a-f]{{{common_answers.FINGERPRINT_CHARS}}}$")


def _scope_from_query() -> str:
    language = (request.args.get("lang") or "en").strip().lower()
    if language not in ("en", "he"):
        language = "en"
    mode = _sanitize_answer_mode(request.args.get("mode"))
    lens = (request.args.get("lens") or "All").strip()[:80] or "All"
    lens = "All" if lens.lower() == "all" else (_canonicalize_community_name(lens) or lens)
    web = False if request.args.get("web") == "0" else None
    return common_answers.scope(
        language, mode, lens, web,
        common_answers.version(claude.PROMPT_VERSION, claude.AI_ANSWER_PROVIDER))


def _kind_from_query() -> str:
    kind = request.args.get("kind")
    return kind if kind in common_answers.KINDS else common_answers.KIND_ASK


def _cached(response, max_age):
    # private: a shared cache could keep serving an answer after it was blocked.
    response.headers["Cache-Control"] = f"private, max-age={max_age}"
    response.headers["Vary"] = "Accept-Encoding"
    return response


@routes_common_answers.route("/api/ai/common-answers", methods=["GET"])
def list_common_answers():
    return _cached(jsonify({
        **common_answers.client_config(),
        "keys": common_answers.listed(_scope_from_query()),
    }), _LIST_MAX_AGE)


@routes_common_answers.route("/api/ai/common-answers/<print_>", methods=["GET"])
def get_common_answer(print_):
    if not _FINGERPRINT_RE.match(print_ or ""):
        return jsonify({"error": "Not found"}), 404
    found = common_answers.listed_answer(_scope_from_query(), print_, _kind_from_query())
    text = str((found or {}).get("answer") or "") if isinstance(found, dict) else ""
    if not text:
        return jsonify({"error": "Not found"}), 404
    return _cached(jsonify({"answer": text}), _ANSWER_MAX_AGE)
