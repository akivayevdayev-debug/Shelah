"""The live progress line shows only work the answer uses: lookups that found
nothing are never announced, a step that found nothing ends as "none", and the
web pages read are sent as `site` events the client links."""

from unittest import mock

import pytest

import app as flask_app_module
import asgi
from backend import ai_tools, ask_progress, claude, search

HALACHIPEDIA = {"title": "[Halachipedia] Shabbat Candles", "summary": "s"}


def _capture(work):
    events = []
    token = ask_progress.bind(events.append)
    try:
        work()
    finally:
        ask_progress.unbind(token)
    return events


# ── ask_progress ─────────────────────────────────────────────────────────────

def test_a_site_is_sent_with_its_title_and_url():
    events = _capture(lambda: ask_progress.sites("commentary", [{"title": "T", "url": "https://a.org/x"}]))
    assert events == [{"type": "site", "stage": "commentary", "site": {"title": "T", "url": "https://a.org/x"}}]


@pytest.mark.parametrize("url", ["http://a.org/x", "javascript:alert(1)", "https://a.org/a b", "", None])
def test_only_plain_https_links_are_sent(url):
    assert _capture(lambda: ask_progress.sites("commentary", [{"title": "T", "url": url}])) == []


def test_at_most_six_sites_are_sent():
    pages = [{"title": str(i), "url": f"https://a.org/{i}"} for i in range(9)]
    assert len(_capture(lambda: ask_progress.sites("thinking", pages))) == ask_progress.MAX_SITES


def test_a_long_title_is_cut():
    events = _capture(lambda: ask_progress.sites("thinking", [{"title": "x" * 500, "url": "https://a.org"}]))
    assert len(events[0]["site"]["title"]) == ask_progress.MAX_SITE_TITLE_CHARS


def test_sites_for_an_unknown_stage_are_dropped():
    assert _capture(lambda: ask_progress.sites("nope", [{"title": "T", "url": "https://a.org"}])) == []


def test_sites_are_silent_with_no_stream():
    assert ask_progress.sites("thinking", [{"title": "T", "url": "https://a.org"}]) is None


def test_a_used_lookup_is_one_finished_step():
    events = _capture(lambda: ask_progress.used("customs"))
    assert [e["state"] for e in events] == ["start", "done"]


def test_used_context_leaves_out_what_was_not_used():
    assert _capture(lambda: ask_progress.used_context([None], False)) == []


def test_used_context_reports_customs():
    events = _capture(lambda: ask_progress.used_context([], True))
    assert {e["stage"] for e in events} == {"customs"}


def test_a_stage_that_found_nothing_ends_as_none():
    def work():
        with ask_progress.stage("sources") as step:
            step.empty()

    assert _capture(work)[-1] == {"type": "stage", "stage": "sources", "state": "none"}


def test_a_stage_that_found_something_ends_as_done():
    def work():
        with ask_progress.stage("sources"):
            pass

    assert _capture(work)[-1]["state"] == "done"


async def test_track_with_an_empty_result_ends_as_none():
    async def nothing():
        return []

    events = []
    token = ask_progress.bind(events.append)
    try:
        await ask_progress.track("sources", nothing(), found=bool)
    finally:
        ask_progress.unbind(token)
    assert events[-1]["state"] == "none"


async def test_track_with_a_broken_found_check_still_ends_as_done():
    async def work():
        return [1]

    def broken(result):
        raise RuntimeError("bad check")

    events = []
    token = ask_progress.bind(events.append)
    try:
        await ask_progress.track("sources", work(), found=broken)
    finally:
        ask_progress.unbind(token)
    assert events[-1]["state"] == "done"


# ── the times step ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("question", [
    "who should do the candle lighting",
    "how many candles on chanukah",
    "can I carry out on shabbat",
])
def test_naming_a_moment_without_asking_its_time_is_not_a_time_question(question):
    assert ask_progress.times_topic(question) is None


def test_asking_when_a_holiday_is_is_a_time_question():
    assert ask_progress.times_topic("when is chanukah this year") == "holiday"


# ── the pages a lookup came from ─────────────────────────────────────────────

def test_a_halachipedia_result_links_its_page():
    assert search.context_page(HALACHIPEDIA, "halachipedia") == {
        "title": "Shabbat Candles", "url": "https://halachipedia.com/index.php?title=Shabbat_Candles"}


def test_a_wikipedia_result_links_its_article():
    assert search.context_page({"title": "Shabbat"}, "wikipedia")["url"] == "https://en.wikipedia.org/wiki/Shabbat"


def test_a_result_with_its_own_url_keeps_it():
    item = {"title": "[HebrewBooks] Sefer", "url": "https://www.hebrewbooks.org/pdfpager.aspx?req=1"}
    assert search.context_page(item) == {"title": "Sefer", "url": item["url"]}


def test_a_result_without_a_title_has_no_page():
    assert search.context_page({"title": ""}, "wikipedia") is None


def test_an_unknown_site_has_no_page():
    assert search.context_page({"title": "x"}, "elsewhere") is None


# ── the sync (Flask) path ────────────────────────────────────────────────────

def _sync_context(monkeypatch, primary_sources, knowledge_rows=()):
    def submit(pool, fn, *args, **kwargs):
        fut = mock.Mock()
        fut.result.return_value = fn(*args, **kwargs)
        return fut

    monkeypatch.setattr(flask_app_module, "submit_with_context", submit)
    monkeypatch.setattr(flask_app_module, "_collect_primary_sources_sync", lambda *a, **k: list(primary_sources))
    monkeypatch.setattr(flask_app_module, "_retrieve_community_knowledge", lambda *a, **k: list(knowledge_rows))
    monkeypatch.setattr(flask_app_module, "_fetch_user_memory_summaries", lambda *a, **k: [])
    engine = mock.Mock(get_halachipedia_summary=lambda q: HALACHIPEDIA, get_wiki=lambda q: {"title": "Shabbat"})
    return _capture(lambda: flask_app_module._collect_ask_question_context("q", "All", None, "en", engine))


SOURCE = {"ref": "Berakhot 1:1", "lines": [{"en": "Text", "he": ""}]}


def test_sync_path_links_the_halachipedia_page(monkeypatch):
    events = _sync_context(monkeypatch, [SOURCE])
    assert [e["site"]["url"] for e in events if e["type"] == "site"] == [
        "https://halachipedia.com/index.php?title=Shabbat_Candles"]


def test_sync_path_does_not_show_customs_it_did_not_find(monkeypatch):
    events = _sync_context(monkeypatch, [SOURCE])
    assert not [e for e in events if e.get("stage") == "customs"]


def test_sync_path_drops_a_source_search_that_found_nothing(monkeypatch):
    events = _sync_context(monkeypatch, [])
    assert {"type": "stage", "stage": "sources", "state": "none"} in events


def test_sync_sources_add_the_searched_paragraphs(monkeypatch):
    engine = mock.Mock()
    engine.get_library_text = lambda ref: {"ref": ref, "lines": [{"en": f"{ref} text", "he": ""}]}
    monkeypatch.setattr(flask_app_module, "_primary_ref_candidates", lambda q, c: ["A 1"])
    monkeypatch.setattr(flask_app_module.source_search, "search_refs", lambda q, refs: ["B 2:3"])
    monkeypatch.setattr(flask_app_module, "is_usable_primary_source", lambda s: True)
    sources = flask_app_module._collect_primary_sources_sync("q", engine)
    assert [s["ref"] for s in sources] == ["A 1", "B 2:3"]


# ── the async path ───────────────────────────────────────────────────────────

async def test_async_sources_put_the_best_match_first(monkeypatch):
    texts = {"A": "Lighting candles.", "B": "An important person prepares for Shabbat himself."}

    class Engine:
        def get_library_text(self, ref):
            return {"ref": ref, "lines": [{"en": texts[ref], "he": ""}]}

    monkeypatch.setattr(asgi._backend_sefaria, "find_refs_for_question", lambda q: ["A"])
    monkeypatch.setattr(asgi._source_search, "search_refs", lambda q, refs: ["B"])
    monkeypatch.setattr(asgi, "ShelahEngine", Engine)
    _, sources = await asgi._collect_primary_sources("must an important person prepare for shabbat")
    assert [s["ref"] for s in sources] == ["B", "A"]


async def test_async_sources_survive_a_failed_search(monkeypatch):
    class Engine:
        def get_library_text(self, ref):
            return {"ref": ref, "lines": [{"en": "text", "he": ""}]}

    def broken(q, refs):
        raise RuntimeError("search down")

    monkeypatch.setattr(asgi._backend_sefaria, "find_refs_for_question", lambda q: ["A"])
    monkeypatch.setattr(asgi._source_search, "search_refs", broken)
    monkeypatch.setattr(asgi, "ShelahEngine", Engine)
    _, sources = await asgi._collect_primary_sources("q")
    assert [s["ref"] for s in sources] == ["A"]


# ── the model's own web lookups ──────────────────────────────────────────────

async def test_the_responsa_tool_links_the_pages_it_read(monkeypatch):
    async def halachipedia(query):
        return dict(HALACHIPEDIA)

    async def hebrewbooks(query):
        return None

    monkeypatch.setattr(ai_tools, "async_search_halachipedia", halachipedia)
    monkeypatch.setattr(ai_tools, "async_search_hebrewbooks", hebrewbooks)
    events = []
    token = ask_progress.bind(events.append)
    try:
        await ai_tools._h_search_responsa_external({"query": "candles"}, {})
    finally:
        ask_progress.unbind(token)
    assert [e["site"]["title"] for e in events if e["type"] == "site"] == ["Shabbat Candles"]


async def test_the_web_lookup_links_the_pages_it_cites(monkeypatch):
    found = {"text": "t", "sources": [{"title": "OU Kosher", "url": "https://www.oukosher.org/x"}]}

    async def lookup(query, language):
        return found

    async def again(findings):
        return {"answer": "a"}

    monkeypatch.setattr(claude.web_lookup, "requested_query", lambda first: "is gum kosher")
    monkeypatch.setattr(claude.web_lookup, "lookup_async", lookup)
    monkeypatch.setattr(claude, "_web_budget_left", lambda started: True)
    monkeypatch.setattr(claude, "_finish_web_lookup", lambda result, query, found: result)
    events = []
    token = ask_progress.bind(events.append)
    try:
        await claude._web_second_pass_async({"answer": "first"}, 0, again, "en")
    finally:
        ask_progress.unbind(token)
    assert [e["site"]["url"] for e in events if e["type"] == "site"] == ["https://www.oukosher.org/x"]

