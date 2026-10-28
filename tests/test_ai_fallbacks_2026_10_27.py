"""The 2026-10-27 fixes: a chosen community with nothing on the topic falls back
to every community, plain "candle lighting" finds the Shabbat candle chapters,
and "who says..." questions get the full prompt."""

import app
from backend import claude, rag, sefaria

CANDLE_ROW = {"id": "1", "community_name": "Ashkenaz", "topic": "shabbat candles",
              "halakhic_source": "SA", "content": "lighting rules"}


def _knowledge_setup(monkeypatch, queries):
    """Rows come back only when no community filter is applied."""
    def _fake_query(_client, _table, community_filter, *_args, **_kwargs):
        queries.append(community_filter)
        return [] if community_filter else [CANDLE_ROW]

    monkeypatch.setattr(app, "_get_supabase_client", lambda: object())
    monkeypatch.setattr(app, "RAG_TOP_KNOWLEDGE_ROWS", 5)
    monkeypatch.setattr(app, "_extract_query_keywords", lambda q, max_keywords=10: ["shabbat"])
    monkeypatch.setattr(app, "SUPABASE_COMMUNITY_KNOWLEDGE_TABLE", "community_knowledge")
    monkeypatch.setattr(app, "_normalize_rag_text", lambda text, max_chars=360: str(text or ""))
    monkeypatch.setattr(app, "_detect_community_in_text", lambda q: None)
    monkeypatch.setattr(rag, "_run_community_knowledge_query", _fake_query)


def test_a_community_with_nothing_on_the_topic_falls_back_to_every_community(monkeypatch):
    _knowledge_setup(monkeypatch, [])
    result = rag._retrieve_community_knowledge("shabbat candles", canonical_lens="Yemenite")
    assert [row["id"] for row in result] == ["1"]


def test_the_fallback_query_drops_the_community_filter(monkeypatch):
    queries = []
    _knowledge_setup(monkeypatch, queries)
    rag._retrieve_community_knowledge("shabbat candles", canonical_lens="Yemenite")
    assert queries == ["Yemenite", None]


def test_all_communities_queries_once(monkeypatch):
    queries = []
    _knowledge_setup(monkeypatch, queries)
    rag._retrieve_community_knowledge("shabbat candles", canonical_lens="All")
    assert queries == [None]


def test_plain_candle_lighting_finds_the_shabbat_candle_chapters():
    refs = sefaria.find_refs_for_question("who should do the candle lighting")
    assert "Shulchan_Arukh,_Orach_Chayim.263" in refs


def test_chanukah_candle_lighting_does_not_bring_the_shabbat_chapters():
    refs = sefaria.find_refs_for_question("chanukah candle lighting time")
    assert "Shulchan_Arukh,_Orach_Chayim.263" not in refs


def test_an_important_person_preparing_for_shabbat_finds_oc_250():
    refs = sefaria.find_refs_for_question("must an adam gadol help with candle lighting")
    assert "Shulchan_Arukh,_Orach_Chayim.250" in refs


def test_adam_gadol_outside_shabbat_brings_no_shabbat_chapter():
    refs = sefaria.find_refs_for_question("must you stand up for an adam gadol")
    assert "Shulchan_Arukh,_Orach_Chayim.250" not in refs


def test_which_rabbi_says_is_not_a_simple_question():
    assert claude._is_simple_question("which rabbi says to light two candles") is False


def test_who_holds_is_not_a_simple_question():
    assert claude._is_simple_question("who holds you can carry in an eruv") is False


def test_a_short_question_without_an_attribution_stays_simple():
    assert claude._is_simple_question("when is candle lighting") is True


def test_the_short_prompt_carries_the_unclear_wording_rule():
    assert "never answer only" in claude.SIMPLE_SYSTEM_PROMPT


def test_the_full_prompt_carries_the_unclear_wording_rule():
    assert "never answer that no source exists" in claude.CORE_SYSTEM_PROMPT
