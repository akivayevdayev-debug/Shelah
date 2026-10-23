"""
Retrieval-augmented-generation helpers for Sh'elah.

Extracted verbatim from ``app.py`` (part of the zero-breakage
backend split). This module owns ask-time tool context assembly, community
knowledge retrieval/scoring, and answer prefix composition.

Shared collaborators (Supabase client factory, keyword extraction, text
normalization, community detection, and related constants) remain defined
in ``app.py`` and are reached here via lazy ``import app as _app`` inside
each function body.

Why lazy imports?  ``app.py`` imports from this module (re-import shims),
so a module-level ``from app import ...`` here would create a circular
dependency whose safety depends entirely on load ordering — a fragile
invariant that breaks silently when anything in ``app.py`` is reordered.
Lazy imports resolve to the already-cached module object in ``sys.modules``
on every call after startup, so there is zero runtime cost difference.

``app.py`` re-imports the public symbols so existing consumers —
including the async path in ``asgi.py`` — keep working unchanged.
"""

import os
import re

from backend.device_identity import current_history_owner
from backend.logging_setup import _capture_backend_error, hash_user_id
from backend.health_check import health
from backend.helpers import COMMUNITY_ALIASES
from backend.sefaria import UMBRELLA_KEYWORDS


def _compose_answer_with_prefixes(body_text, *, include_web_warning=False, source_attribution_note=""):
    body = str(body_text or "").strip()
    if not body:
        return ""

    blocks = []
    if include_web_warning:
        import app as _app  # lazy — app is fully loaded by the time this is called
        blocks.append(_app.WEB_LAST_RESORT_WARNING)

    attribution = str(source_attribution_note or "").strip()
    if attribution:
        blocks.append(attribution)

    if blocks:
        blocks.append(body)
        return "\n\n".join(blocks)

    return body


def _zmanim_snapshot_for_tool_context(zmanim):
    """The small subset of zmanim values worth surfacing in the AI tool
    context. Split out of _build_ask_tool_context() to keep this loop out of
    that function's own complexity count (SonarCloud python:S3776).
    """
    snapshot = {}
    for key in (
        "Dawn (16.1° / 72m)",
        "Sunrise",
        "Latest Shema (GRA)",
        "Plag HaMincha",
        "Sunset",
        "Nightfall (3 Stars)",
    ):
        value = str(zmanim.get(key) or "").strip()
        if value and value != "N/A":
            snapshot[key] = value
    return snapshot


def _build_ask_tool_context(engine):
    import app as _app  # lazy — app is fully loaded by the time this is called
    context = {
        "route": "/ask",
        "auth_enforced": _app.CLERK_ENFORCE_AUTH,
        "trusted_source_priority": "Sefaria, HebrewBooks, Halachipedia, Peninei Halakha (YHB)",
        "factuality_guardrail": "Reject random/non-halakhic domains and avoid generic English Bible websites when validating web context.",
    }

    try:
        zmanim_payload = engine.get_zmanim("standard")
        if isinstance(zmanim_payload, dict):
            metadata = zmanim_payload.get("metadata", {})
            zmanim = zmanim_payload.get("zmanim", {})

            if isinstance(metadata, dict):
                context["civil_date"] = metadata.get("date")
                context["hebrew_date"] = metadata.get("hebrew_date")
                context["parasha"] = metadata.get("parasha")
                context["holiday"] = metadata.get("holiday")
                context["timezone"] = metadata.get("timezone")

            if isinstance(zmanim, dict):
                snapshot = _zmanim_snapshot_for_tool_context(zmanim)
                if snapshot:
                    context["zmanim_snapshot"] = snapshot
    except Exception:
        # Keep ask flow resilient even if zmanim context is unavailable.
        pass

    return context


# Words that say nothing about WHAT a question is about. community_knowledge
# rows are ~400-char summaries full of everyday English, so matching these
# ("eat" inside "great", "use" inside "house", "can", "custom", "community")
# made nearly every row look relevant and the model was handed unrelated
# customs for every question. Community names are here too: the community is
# applied as a filter, not as a topic.
_CUSTOMS_STOPWORDS = frozenset({
    "the", "and", "for", "with", "from", "that", "this", "these", "those", "are",
    "was", "were", "been", "being", "have", "has", "had", "does", "did", "doing",
    "can", "could", "may", "might", "must", "shall", "should", "will", "would",
    "not", "but", "nor", "any", "all", "some", "each", "every", "other", "another",
    "same", "also", "just", "only", "very", "much", "many", "more", "most", "less",
    "least", "than", "then", "there", "their", "them", "they", "you", "your",
    "yours", "our", "ours", "his", "her", "hers", "its", "him", "she", "let",
    "what", "when", "where", "which", "while", "who", "whom", "whose", "why", "how",
    "about", "above", "after", "before", "during", "into", "onto", "over", "under",
    "between", "without", "within", "against", "around", "through", "until",
    "again", "ever", "never", "always", "often", "still", "even", "else",
    "tell", "explain", "describe", "give", "show", "need", "want", "like", "know",
    "think", "say", "said", "ask", "please", "use", "used", "using", "make",
    "made", "take", "took", "get", "got", "getting", "going", "come", "see",
    "look", "find", "keep", "put", "eat", "eating", "drink", "wear", "wearing",
    "day", "days", "time", "times", "week", "year", "years", "way", "thing",
    "things", "someone", "something", "anyone", "anything", "person", "people",
    "allowed", "permitted", "permissible", "forbidden", "prohibited", "okay",
    "right", "wrong", "good", "bad", "best", "better", "able", "possible",
    "custom", "customs", "minhag", "minhagim", "tradition", "traditions",
    "traditional", "practice", "practices", "practise", "community",
    "communities", "jewish", "jews", "halacha", "halachah", "halakhah",
    "halakha", "halachic", "law", "laws", "rule", "rules", "ruling",
    "question", "answer", "what's", "isn't", "don't", "doesn't",
    # The stored text is written for the model ("ask their own rabbi", "the
    # Shulchan Aruch forbids ...", "in the Torah"), and a question about a
    # rabbi, a sage or a book names an author, not a custom. Demonyms are
    # community names too.
    "torah", "rabbi", "rav", "talmud", "gemara", "mishnah", "mishna", "shulchan",
    "aruch", "arukh", "berurah", "rema", "rambam", "ramban", "maimonides",
    "rashi", "tosafot", "zohar", "sefer", "book", "chapter", "verse", "story",
    "among", "teach", "view", "opinion", "meaning", "significance", "number",
    "twice", "difference", "according", "happens", "become", "jew", "god",
    "build", "built", "treat", "celebrate", "celebrated", "celebrating", "observe",
    "observed", "observing", "perform", "performed", "follow", "followed", "hold",
    "held", "handle", "begin", "start",
    "ashkenazim", "sephardim", "sefardim", "mizrahim",
    *COMMUNITY_ALIASES,
    *(word for alias in COMMUNITY_ALIASES for word in alias.split()),
})


def _distinctive_keywords(keywords):
    """The question's keywords that carry a topic, in order: no stopwords, no
    community names, no duplicates."""
    kept = []
    for keyword in keywords or []:
        word = str(keyword or "").strip().lower()
        if len(word) < 3 or word in kept:
            continue
        if word in _CUSTOMS_STOPWORDS or (word.endswith("s") and word[:-1] in _CUSTOMS_STOPWORDS):
            continue
        kept.append(word)
    return kept


def _keyword_in(keyword, text):
    """keyword starts a word of text, plural or not ("candles" finds "candle"
    and "candles") -- but "eat" no longer finds "great"."""
    stem = keyword[:-1] if len(keyword) > 4 and keyword.endswith("s") else keyword
    return re.search(r"(?<![a-z0-9])" + re.escape(stem), text) is not None


# The stored text of a row (scripts/migrate_customs_to_supabase.py) is the
# summary, then lines written for the model: a "Confidence:" line ("Rabbis
# differ; give each side and tell the user to ask their own rabbi"), and the
# labels "Variants:" and "Common practices:". Matching a question against that
# wording made every row about "rabbis", "users" and "sides".
_MODEL_INSTRUCTION_LINE = re.compile(r"^Confidence:[^\n]*(?:\n|$)", re.MULTILINE)
_ROW_LABEL = re.compile(r"^(?:Variants|Common practices):\s*", re.MULTILINE)


def _substantive_content(content):
    """What a row says about the custom: its content without the lines and
    labels that address the model."""
    text = _MODEL_INSTRUCTION_LINE.sub("", str(content or ""))
    return _ROW_LABEL.sub("", text)


def _keyword_match_score(keywords, topic, source, content):
    """Sum of per-keyword topic/source/content hits. Split out of
    _score_community_knowledge_row() to keep this loop out of that
    function's own complexity count (SonarCloud python:S3776).
    """
    score = 0
    for keyword in keywords:
        if _keyword_in(keyword, topic):
            score += 8
        if _keyword_in(keyword, source):
            score += 4
        if _keyword_in(keyword, content):
            score += 2
    return score


def _is_on_topic(keywords, topic, source, content):
    """Whether a row is about what the question asks, not just near it. A
    question about the mikveh on Shabbat must not get a row on lighting
    Shabbat candles because both say "Shabbat": when the question has any
    keyword more specific than an umbrella one ("shabbat", "kosher",
    "prayer"), the row has to mention one of those."""
    anchors = [keyword for keyword in keywords if keyword not in UMBRELLA_KEYWORDS]
    if not anchors:
        return True
    haystack = f"{topic} {source} {content}"
    return any(_keyword_in(anchor, haystack) for anchor in anchors)


def _covers_the_question(keywords, topic, content):
    """Whether a row speaks to what the question names, not to one word of it.
    "Can I eat chicken with cheese?" must not get the Kapparot row because its
    title says "chicken", and "When is the earliest time to say Shema?" must not
    get every row that mentions the morning Shema in passing. Looked for in the
    row's title and its text, never in its source line: a citation ("Shulchan
    Aruch, Orach Chaim") says where the row comes from, not what it is about.

    The title has to carry one of the question's topic keywords (a custom is
    about its title; a passing mention is not an answer), and a question with
    several has to be met by at least two of them, or half of them once it is
    long."""
    anchors = [keyword for keyword in keywords if keyword not in UMBRELLA_KEYWORDS]
    if not anchors:
        return True
    in_title = [keyword for keyword in anchors if _keyword_in(keyword, topic)]
    if not in_title:
        return False
    spoken = [keyword for keyword in anchors if keyword in in_title or _keyword_in(keyword, content)]
    return len(spoken) >= min(len(anchors), max(2, -(-len(anchors) // 2)))


def _score_community_knowledge_row(row, keywords, canonical_lens):
    topic = str(row.get("topic") or "").lower()
    source = str(row.get("halakhic_source") or "").lower()
    content = _substantive_content(row.get("content")).lower()
    community_name = str(row.get("community_name") or "").lower()

    score = 0
    if canonical_lens and canonical_lens != "All":
        lens_text = canonical_lens.lower().strip()
        if lens_text and lens_text in community_name:
            score += 8

    return score + _keyword_match_score(keywords, topic, source, content)


def _community_filter_from_request(query, canonical_lens):
    if canonical_lens and canonical_lens != "All":
        return canonical_lens

    import app as _app  # lazy — app is fully loaded by the time this is called
    detected = _app._detect_community_in_text(query)
    return detected or None


def _build_knowledge_text_or_filter(keywords, max_keywords=6):
    conditions = []
    for keyword in (keywords or [])[:max_keywords]:
        clean = re.sub(r"[^A-Za-z0-9֐-׿\-]",
                       "", str(keyword or "").strip())
        if not clean:
            continue

        pattern = f"%{clean}%"
        conditions.extend([
            f"topic.ilike.{pattern}",
            f"content.ilike.{pattern}",
        ])

    return ",".join(conditions)


def _run_community_knowledge_query(
    supabase, table_name, community_filter, text_or_filter, query_row_cap, apply_text_filter=True,
):
    """Runs the Supabase community_knowledge select with optional
    community-name/text-search filters. Moved to module level (out of
    _retrieve_community_knowledge()) since a nested closure's own branches
    count against the enclosing function's complexity, but a top-level
    function's don't (SonarCloud python:S3776).
    """
    table = supabase.table(table_name).select(
        "id,community_name,topic,halakhic_source,content"
    )

    if community_filter:
        # Case-insensitive match so Ashkenaz/Ashkenazi variants still return rows.
        table = table.ilike("community_name", f"%{community_filter}%")

    if apply_text_filter and text_or_filter:
        table = table.or_(text_or_filter)

    result = table.limit(query_row_cap).execute()
    return result.data if isinstance(result.data, list) else []


def _keyword_score(row, score, community_filter):
    """``score`` less the 8-point bonus for a row of the named community, so
    what is left is what the question's keywords earned. A community-only
    match (no topic/content hit) would score exactly 8 with none of it."""
    community_name_lower = str(row.get("community_name") or "").lower()
    has_community_bonus = bool(
        community_filter
        and community_filter.lower().strip() in community_name_lower
    )
    return score - (8 if has_community_bonus else 0)


def _row_speaks_to_question(row, keywords):
    """True when the row is about the question, not just sharing a broad word
    with it ("shabbat") or speaking to one word of a longer question or
    only citing it."""
    topic = str(row.get("topic") or "").lower()
    source = str(row.get("halakhic_source") or "").lower()
    content = _substantive_content(row.get("content")).lower()
    return _is_on_topic(keywords, topic, source, content) and _covers_the_question(keywords, topic, content)


def _rank_community_knowledge_rows(rows, keywords, community_filter, canonical_lens):
    """Score raw community-knowledge rows and drop keyword-irrelevant ones.
    Split out of _retrieve_community_knowledge() to keep this loop out of
    that function's own complexity count (SonarCloud python:S3776).
    """
    ranked = []
    for row in rows:
        if not isinstance(row, dict):
            continue

        score = _score_community_knowledge_row(
            row,
            keywords,
            community_filter or canonical_lens,
        )

        # Always require keyword relevance, whatever the community match.
        if _keyword_score(row, score, community_filter) <= 0:
            continue
        if _row_speaks_to_question(row, keywords):
            ranked.append((score, row))
    return ranked


def _retrieve_community_knowledge(query, canonical_lens="All", max_rows=None):
    import app as _app  # lazy — app is fully loaded by the time this is called
    supabase = _app._get_supabase_client()
    if not supabase:
        return []

    if not health.is_healthy("community_knowledge"):
        return []

    target_rows = max_rows or _app.RAG_TOP_KNOWLEDGE_ROWS
    keywords = _distinctive_keywords(_app._extract_query_keywords(query, max_keywords=14))
    if not keywords:
        return []  # nothing in the question names a topic a custom could be about
    community_filter = _community_filter_from_request(query, canonical_lens)
    text_or_filter = _build_knowledge_text_or_filter(keywords)

    query_row_cap = max(50, min(600, target_rows * 25))

    try:
        rows = _run_community_knowledge_query(
            supabase, _app.SUPABASE_COMMUNITY_KNOWLEDGE_TABLE,
            community_filter, text_or_filter, query_row_cap, apply_text_filter=True,
        )
    except Exception as e:
        health.record_failure("community_knowledge")
        _capture_backend_error("community_knowledge_query_failed", e, {})
        return []
    health.record_success("community_knowledge")

    ranked = _rank_community_knowledge_rows(rows, keywords, community_filter, canonical_lens)

    ranked.sort(
        key=lambda item: (
            item[0],
            len(str(item[1].get("topic") or "")),
        ),
        reverse=True,
    )

    top_rows = []
    for score, row in ranked[:target_rows]:
        top_rows.append({
            "id": str(row.get("id") or "").strip(),
            "community_name": str(row.get("community_name") or "").strip(),
            "topic": str(row.get("topic") or "").strip(),
            "halakhic_source": str(row.get("halakhic_source") or "").strip(),
            "content": _app._normalize_rag_text(row.get("content"), max_chars=RAG_KNOWLEDGE_CONTENT_CHARS),
            "score": score,
        })

    return top_rows


# ── RAG constants ─────────────────────────────────────────────────────────────

def _env_int(name, default):
    raw_value = os.environ.get(name)
    if not raw_value:
        return default
    try:
        return int(raw_value)
    except Exception:
        return default


# Kept as a literal (not env-sourced) to match app.py's own copy of these
# constants -- see app.py's RAG_TOP_KNOWLEDGE_ROWS/RAG_MEMORY_ROWS comment.
RAG_TOP_KNOWLEDGE_ROWS = 5
RAG_MEMORY_ROWS = 2
# A community_knowledge row's content is a summary plus practices, subgroup
# variants and a confidence caveat (median ~410 chars, longest ~1500). Keep
# enough of it that the prompt-side cap (claude.CUSTOMS_ROW_MAX_CHARS) is the
# one that decides what the model sees.
RAG_KNOWLEDGE_CONTENT_CHARS = 700


# ── Knowledge-row helpers ─────────────────────────────────────────────────────


def _knowledge_rows_to_customs(rows):
    customs = []
    for row in rows:
        if not isinstance(row, dict):
            continue

        topic = str(row.get("topic") or "").strip()
        source = str(row.get("halakhic_source") or "").strip()
        content = str(row.get("content") or "").strip()
        customs.append({
            "community": str(row.get("community_name") or "").strip(),
            "topic": topic,
            "ruling": content,
            "source": source,
            "notes": f"Topic: {topic}" if topic else "",
        })

    return customs


# ── User memory helpers ───────────────────────────────────────────────────────


def _fetch_user_memory_summaries(user_id, limit=None, bearer_token=None):
    import app as _app  # lazy — avoids circular import at module load time
    if not user_id:
        return []

    supabase = _app._get_user_scoped_supabase_client(bearer_token)
    if not supabase and not _app.STRICT_SUPABASE_RLS:
        supabase = _app._get_supabase_client()
    if not supabase:
        return []

    target_limit = limit or RAG_MEMORY_ROWS
    try:
        result = (
            supabase
            .table(_app.SUPABASE_USER_MEMORIES_TABLE)
            .select("summary,created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(target_limit)
            .execute()
        )
    except Exception:
        return []

    rows = result.data if isinstance(result.data, list) else []
    summaries = []
    for row in rows:
        if not isinstance(row, dict):
            continue

        summary = _app._normalize_rag_text(row.get("summary"), max_chars=260)
        if not summary:
            continue

        summaries.append({
            "summary": summary,
            "created_at": row.get("created_at"),
        })

    return summaries


# The pages an answer's "Web: ..." citations link to are kept in the row's
# `sources` list, tagged with this kind, so a reopened answer still links them
# without a column of its own; readers split them back out (split_web_pages).
WEB_PAGE_SOURCE_KIND = "web_page"


def _web_page_entries(web_sources):
    entries = []
    for page in web_sources if isinstance(web_sources, list) else []:
        if not isinstance(page, dict) or not page.get("ref") or not page.get("url"):
            continue
        entries.append({"kind": WEB_PAGE_SOURCE_KIND, "ref": str(page["ref"])[:300],
                        "title": str(page.get("title") or "")[:300], "url": str(page["url"])[:1000]})
    return entries


def split_web_pages(row):
    """A stored ask_history row as the reader wants it: its web pages moved
    from `sources` to `meta.web_sources` (where the live /ask answer has them)."""
    if not isinstance(row, dict):
        return row
    sources = row.get("sources") if isinstance(row.get("sources"), list) else []
    pages = [s for s in sources if isinstance(s, dict) and s.get("kind") == WEB_PAGE_SOURCE_KIND]
    if not pages:
        return row
    split = dict(row)
    split["sources"] = [s for s in sources if s not in pages]
    meta = dict(row.get("meta") or {})
    meta["web_sources"] = [{"ref": p["ref"], "title": p.get("title", ""), "url": p["url"]} for p in pages]
    split["meta"] = meta
    return split


def _store_ask_history(
    user_id,
    question,
    answer,
    *,
    sources=None,
    ai_cited_sources=None,
    web_sources=None,
    community="All",
    mode="balanced",
    language="en",
    safety_class="ok",
    prompt_version=None,
):
    """Persist a completed ask interaction to the per-user ask_history table.

    safety_class/prompt_version are defensibility-logging metadata: they let a stored answer's safety-routing outcome and
    governing system-prompt version be reconstructed during a dispute,
    without retaining the full prompt text itself. Requires
    scripts/migrate_ask_history_safety_metadata.sql to have been applied —
    see that file.

    ``user_id`` is the Clerk sub. Signed out, the answer is saved under the
    request's device instead (backend/device_identity.py), so its link is tied
    to that browser; with neither there is nothing to attach it to.

    Returns the stored row's id (str) on success, or None if nothing was
    stored (no owner, no configured client, or the insert raised) — the
    id lets the /ask response carry a deep link (/answer/<id>) back to this
    exact answer.
    """
    import app as _app
    from uuid import uuid4

    user_id = user_id or current_history_owner()
    if not user_id:
        return None

    supabase = _app._get_supabase_client()
    if not supabase:
        return None

    payload = {
        "id": str(uuid4()),
        "user_id": user_id,
        "question": str(question or "")[:2000],
        "answer": str(answer or "")[:10000],
        "sources": (sources if isinstance(sources, list) else []) + _web_page_entries(web_sources),
        "ai_cited_sources": ai_cited_sources if isinstance(ai_cited_sources, list) else [],
        "community": str(community or "All")[:100],
        "mode": str(mode or "balanced")[:50],
        "language": str(language or "en")[:10],
        "safety_class": str(safety_class or "ok")[:50],
        "prompt_version": str(prompt_version or "")[:50] or None,
    }

    try:
        supabase.table(_app.SUPABASE_ASK_HISTORY_TABLE).insert(payload).execute()
        return payload["id"]
    except Exception as e:
        # A PostgREST schema error must never be
        # indistinguishable from success — this is the exact defensibility-
        # logging table the accept_legal() clerk_id/user_id bug was
        # about, and safety_class/prompt_version are the columns
        # migrate_ask_history_safety_metadata.sql added. Keep the write
        # best-effort (never block the ask response), but make a failure
        # observable.
        _capture_backend_error("ask_history_store_failed", e, {"user_id_hash": hash_user_id(user_id)})
        return


def _store_user_memory_summary(user_id, question, answer):
    import app as _app  # lazy — avoids circular import at module load time
    from uuid import uuid4

    if not user_id:
        return

    supabase = _app._get_user_scoped_supabase_client()
    if not supabase and not _app.STRICT_SUPABASE_RLS:
        supabase = _app._get_supabase_client()
    if not supabase:
        return

    summary = _app._build_interaction_summary(question, answer)
    if not summary:
        return

    payload = {
        "id": str(uuid4()),
        "user_id": user_id,
        "summary": summary,
    }

    try:
        supabase.table(_app.SUPABASE_USER_MEMORIES_TABLE).insert(payload).execute()
    except Exception as e:
        # Memory write failures should never block the user response path
        # (kept non-fatal), but the failure itself must
        # stay observable rather than vanish into a bare `except: return`.
        _capture_backend_error("user_memory_store_failed", e, {"user_id_hash": hash_user_id(user_id)})
        return
