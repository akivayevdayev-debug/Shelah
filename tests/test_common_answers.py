"""Common questions answered once and served again (backend/common_answers.py,
backend/routes_common_answers.py, the /ask and conversation hooks)."""

import asyncio
import json
from pathlib import Path

import pytest

from backend import common_answers as ca

CASES_FILE = Path(__file__).resolve().parent.parent / "tests_js" / "fixtures" / "common_answer_cases.json"
SHARED = json.loads(CASES_FILE.read_text(encoding="utf-8"))
SCOPE = ca.scope("en", "balanced", "All", None, "v1:claude")
QUESTION = "Can I cook on Shabbat?"


@pytest.fixture(autouse=True)
def _empty_cache():
    ca.clear()
    yield
    ca.clear()


def _ask_payload(**meta):
    return {
        "answer": "Cooking is forbidden on Shabbat. [1]",
        "ai_cited_sources": ["Shabbat 73a"],
        "sources": [{"ref": "Shabbat 73a"}],
        "history_id": "row-1",
        "meta": {
            "fallback": False, "safety_class": "ok", "is_prohibited": False,
            "input_sanitized": False, "memory_count": 0, "identity_aware": True,
            "security": {"input": {"blocked": False, "reasons": [], "markers": []},
                         "output": {"blocked": False, "reason": ""}},
            **meta,
        },
    }


def _asked_by(n, question=QUESTION, kind=ca.KIND_ASK, answer="stored"):
    for i in range(n):
        ca.remember(question, SCOPE, kind, f"reader-{i}", answer)


# ── folding ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("case", SHARED["cases"], ids=lambda case: case["question"])
def test_folding_matches_the_shared_cases(case):
    assert ca.question_key(case["question"]) == case["key"]


def test_the_shared_rules_are_the_modules_rules():
    assert SHARED["rules"] == ca.client_config()


def test_the_shared_fingerprint_is_the_modules():
    assert ca.fingerprint(SHARED["fingerprint"]["key"]) == SHARED["fingerprint"]["print"]


def test_a_negation_keeps_two_questions_apart():
    assert ca.question_key("can I cook on Shabbat") != ca.question_key("can I not cook on Shabbat")


def test_word_order_keeps_two_questions_apart():
    assert ca.question_key("meat then milk") != ca.question_key("milk then meat")


def test_numbers_keep_two_questions_apart():
    assert ca.question_key("what is in Samuel 1") != ca.question_key("what is in Samuel 2")


def test_filler_never_takes_the_whole_question():
    assert ca.question_key("thank you") == "thank you"


# ── what may be cached ──────────────────────────────────────────────────────

@pytest.mark.parametrize("question", [
    "when is candle lighting", "what time is sunset tonight", "zmanim for Brooklyn",
    "is Shabbat today", "what is the parasha this week", "is Pesach in 2027 early",
    "מתי הדלקת נרות",
])
def test_a_time_bound_question_is_not_cached(question):
    assert ca.cacheable_question(question) is False


def test_a_one_word_question_is_not_cached():
    assert ca.cacheable_question("Shabbat?") is False


def test_a_long_question_is_not_cached():
    assert ca.cacheable_question("word " * 60) is False


def test_a_plain_question_is_cached():
    assert ca.cacheable_question(QUESTION) is True


def test_may_is_not_a_month():
    assert ca.cacheable_question("may I cook on Shabbat") is True


def test_a_sound_answer_is_worth_keeping():
    assert ca.ask_worth_keeping(_ask_payload()) is True


@pytest.mark.parametrize("meta", [
    {"fallback": True}, {"safety_class": "crisis"},
    {"input_sanitized": True}, {"memory_count": 2}, {"cached": True},
    {"security": {"input": {"blocked": False, "reasons": ["injection"], "markers": []}}},
    {"security": {"output": {"blocked": True}}},
], ids=str)
def test_an_answer_with_a_doubt_is_not_kept(meta):
    assert ca.ask_worth_keeping(_ask_payload(**meta)) is False


def test_a_ruling_that_forbids_is_still_kept():
    assert ca.ask_worth_keeping(_ask_payload(is_prohibited=True)) is True


def test_an_answer_that_cites_nothing_is_not_kept():
    payload = {**_ask_payload(), "ai_cited_sources": []}
    assert ca.ask_worth_keeping(payload) is False


def test_the_stored_answer_has_no_history_row():
    assert "history_id" not in ca.ask_to_store(_ask_payload())


def test_the_stored_answer_does_not_say_who_asked():
    assert "identity_aware" not in ca.ask_to_store(_ask_payload())["meta"]


def test_a_served_answer_is_marked():
    served = ca.ask_to_serve(ca.ask_to_store(_ask_payload()), "row-2", None)
    assert served["meta"]["cached_common"] is True


def test_a_served_answer_carries_the_new_readers_row():
    served = ca.ask_to_serve(ca.ask_to_store(_ask_payload()), "row-2", None)
    assert served["history_id"] == "row-2"


def test_a_thread_reply_that_cites_sources_is_kept():
    assert ca.thread_worth_keeping({"answer": "x"}, {"safety_class": "ok"}, ["Shabbat 73a"], {}) is True


def test_a_thread_reply_built_on_memories_is_not_kept():
    ctx = {"user_memory_summaries": ["keeps Sephardi customs"]}
    assert ca.thread_worth_keeping({"answer": "x"}, {}, ["Shabbat 73a"], ctx) is False


def test_a_thread_reply_that_cites_nothing_is_not_kept():
    assert ca.thread_worth_keeping({"answer": "x"}, {}, [], {}) is False


def test_an_out_of_scope_thread_reply_is_not_kept():
    assert ca.thread_worth_keeping({"answer": "x"}, {"out_of_scope": True}, ["a"], {}) is False


# ── serving ─────────────────────────────────────────────────────────────────

def test_another_reader_gets_the_stored_answer():
    _asked_by(1)
    assert ca.lookup("can i cook on shabbos", SCOPE, ca.KIND_ASK, "someone-else") == "stored"


def test_the_reader_who_asked_is_not_served_their_own_answer():
    _asked_by(1)
    assert ca.lookup(QUESTION, SCOPE, ca.KIND_ASK, "reader-0") is None


def test_a_different_question_gets_nothing():
    _asked_by(1)
    assert ca.lookup("Can I not cook on Shabbat?", SCOPE, ca.KIND_ASK, "someone-else") is None


def test_another_setting_gets_nothing():
    _asked_by(1)
    other = ca.scope("he", "balanced", "All", None, "v1:claude")
    assert ca.lookup(QUESTION, other, ca.KIND_ASK, "someone-else") is None


def test_another_prompt_version_gets_nothing():
    _asked_by(1)
    other = ca.scope("en", "balanced", "All", None, "v2:claude")
    assert ca.lookup(QUESTION, other, ca.KIND_ASK, "someone-else") is None


def test_web_search_off_is_its_own_setting():
    assert ca.scope("en", "balanced", "All", False, "v") != ca.scope("en", "balanced", "All", None, "v")


def test_a_thread_reply_is_not_served_as_an_ask():
    _asked_by(1, kind=ca.KIND_THREAD)
    assert ca.lookup(QUESTION, SCOPE, ca.KIND_ASK, "someone-else") is None


def test_the_first_answer_is_kept():
    ca.remember(QUESTION, SCOPE, ca.KIND_ASK, "a", "first")
    ca.remember(QUESTION, SCOPE, ca.KIND_ASK, "b", "second")
    assert ca.lookup(QUESTION, SCOPE, ca.KIND_ASK, "c") == "first"


def test_a_time_bound_question_is_never_served():
    ca.remember("when is Shabbat over", SCOPE, ca.KIND_ASK, "a", "stored")
    assert ca.lookup("when is Shabbat over", SCOPE, ca.KIND_ASK, "b") is None


# ── blocking ────────────────────────────────────────────────────────────────

def test_a_blocked_question_is_not_served():
    _asked_by(1)
    ca.block("can I cook on shabbos?")
    assert ca.lookup(QUESTION, SCOPE, ca.KIND_ASK, "someone-else") is None


def test_a_blocked_question_is_not_stored():
    ca.block(QUESTION)
    _asked_by(1)
    assert ca.is_blocked(QUESTION) is True


def test_a_blocked_question_is_not_handed_to_the_panel():
    _asked_by(ca.LIST_AFTER)
    ca.block(QUESTION)
    print_ = ca.fingerprint(ca.question_key(QUESTION))
    assert ca.listed_answer(SCOPE, print_, ca.KIND_ASK) is None


# ── the panel's list ────────────────────────────────────────────────────────

def test_a_question_is_listed_once_enough_readers_asked():
    _asked_by(ca.LIST_AFTER)
    assert ca.listed(SCOPE) == [ca.fingerprint(ca.question_key(QUESTION))]


def test_a_question_fewer_readers_asked_is_not_listed():
    _asked_by(ca.LIST_AFTER - 1)
    assert ca.listed(SCOPE) == []


def test_one_reader_asking_again_counts_once():
    for _ in range(ca.LIST_AFTER):
        ca.remember(QUESTION, SCOPE, ca.KIND_ASK, "same-reader", "stored")
    assert ca.listed(SCOPE) == []


def test_a_listed_answer_is_handed_out_by_fingerprint():
    _asked_by(ca.LIST_AFTER)
    print_ = ca.fingerprint(ca.question_key(QUESTION))
    assert ca.listed_answer(SCOPE, print_, ca.KIND_ASK) == "stored"


def test_an_unlisted_fingerprint_gets_nothing():
    _asked_by(ca.LIST_AFTER - 1)
    print_ = ca.fingerprint(ca.question_key(QUESTION))
    assert ca.listed_answer(SCOPE, print_, ca.KIND_ASK) is None


def test_the_asker_id_hides_the_account():
    assert "user-123" not in ca.asker_id("user-123", None)


def test_signed_out_readers_are_told_apart_by_address():
    assert ca.asker_id(None, "1.1.1.1") != ca.asker_id(None, "2.2.2.2")


# ── the endpoints ───────────────────────────────────────────────────────────

ENDPOINT_SCOPE_ARGS = "lang=en&mode=balanced&lens=All&kind=ask"


@pytest.fixture
def listed_question(monkeypatch):
    from backend import claude

    scope_id = ca.scope("en", "balanced", "All", None,
                        ca.version(claude.PROMPT_VERSION, claude.AI_ANSWER_PROVIDER))
    for i in range(ca.LIST_AFTER):
        ca.remember(QUESTION, scope_id, ca.KIND_ASK, f"reader-{i}", {"answer": "Not on Shabbat."})
    return ca.fingerprint(ca.question_key(QUESTION))


def test_the_list_names_the_common_questions(test_client, listed_question):
    body = test_client.get(f"/api/ai/common-answers?{ENDPOINT_SCOPE_ARGS}").get_json()
    assert body["keys"] == [listed_question]


def test_the_list_carries_the_folding_rules(test_client):
    body = test_client.get(f"/api/ai/common-answers?{ENDPOINT_SCOPE_ARGS}").get_json()
    assert body["variants"] == ca.VARIANTS


def test_the_list_is_cached_privately(test_client):
    response = test_client.get(f"/api/ai/common-answers?{ENDPOINT_SCOPE_ARGS}")
    assert response.headers["Cache-Control"].startswith("private")


def test_another_setting_lists_nothing(test_client, listed_question):
    body = test_client.get("/api/ai/common-answers?lang=he&mode=balanced&lens=All").get_json()
    assert body["keys"] == []


def test_a_listed_answer_is_returned_as_text(test_client, listed_question):
    body = test_client.get(f"/api/ai/common-answers/{listed_question}?{ENDPOINT_SCOPE_ARGS}").get_json()
    assert body == {"answer": "Not on Shabbat."}


def test_an_unlisted_answer_is_not_found(test_client):
    response = test_client.get(f"/api/ai/common-answers/{'0' * 32}?{ENDPOINT_SCOPE_ARGS}")
    assert response.status_code == 404


def test_a_malformed_fingerprint_is_not_found(test_client):
    response = test_client.get(f"/api/ai/common-answers/not-a-hash?{ENDPOINT_SCOPE_ARGS}")
    assert response.status_code == 404


def test_a_not_helpful_vote_blocks_the_question(test_client, monkeypatch):
    from backend import routes_feedback

    monkeypatch.setattr(routes_feedback, "_get_supabase_client", lambda: None)
    test_client.post("/api/feedback", json={"verdict": "not_helpful", "question": QUESTION})
    assert ca.is_blocked("can i cook on shabbos") is True


def test_a_helpful_vote_blocks_nothing(test_client, monkeypatch):
    from backend import routes_feedback

    monkeypatch.setattr(routes_feedback, "_get_supabase_client", lambda: None)
    test_client.post("/api/feedback", json={"verdict": "helpful", "question": QUESTION})
    assert ca.is_blocked(QUESTION) is False


# ── the /ask hook ───────────────────────────────────────────────────────────

@pytest.fixture
def stored_history(monkeypatch):
    import asgi

    rows = []

    def store(user_id, question, answer, **fields):
        rows.append((user_id, question, answer))
        return f"row-{len(rows)}"

    monkeypatch.setattr(asgi, "_store_ask_history", store)
    return rows


def _serve(question, asker="next-reader"):
    import asgi

    return asyncio.run(asgi._serve_common_answer(question, SCOPE, asker, None))


def _remember(payload, asker="first-reader"):
    import asgi

    asyncio.run(asgi._remember_common_answer(QUESTION, SCOPE, asker, payload))


def test_ask_serves_a_kept_answer_to_the_next_reader(stored_history):
    _remember(_ask_payload())
    assert _serve("can i cook on shabbos?")["answer"] == _ask_payload()["answer"]


def test_ask_stores_the_served_answer_in_the_readers_history(stored_history):
    _remember(_ask_payload())
    _serve(QUESTION)
    assert stored_history == [(None, QUESTION, _ask_payload()["answer"])]


def test_ask_does_not_keep_a_fallback_answer(stored_history):
    _remember(_ask_payload(fallback=True))
    assert _serve(QUESTION) is None


def test_ask_does_not_serve_a_reader_their_own_answer(stored_history):
    _remember(_ask_payload())
    assert _serve(QUESTION, asker="first-reader") is None
