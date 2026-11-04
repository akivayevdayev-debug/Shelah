"""backend/source_search.py: Sefaria's own search finds extra paragraphs for a
question, and the loaded sources are ordered by how well they match it."""

import time

from backend import source_search

_REAL_RUN_SEARCHES = source_search._run_searches

IMPORTANT_PERSON = (
    'Even a very important person <sup class="footnote-marker">1</sup>'
    '<i class="footnote">A long <i>note</i> about candles and lighting.</i>'
    " is required to prepare by himself for the Sabbath."
)


def _source(ref, *paragraphs):
    return {"ref": ref, "lines": [{"en": text, "he": ""} for text in paragraphs]}


def _hit(ref, text):
    return {"ref": ref, "exact": text}


def test_a_transliterated_phrase_brings_the_words_the_translations_use():
    assert source_search.question_terms("must an adam gadol help")[:2] == ["important", "person"]


def test_question_words_drop_the_filler():
    assert source_search.question_words("which rabbi says you should light candles") == ["light", "candles"]


def test_terms_are_stemmed():
    assert source_search.question_terms("lighting candles") == ["light", "candle"]


def test_hebrew_is_compared_without_vowel_points():
    assert source_search._plain("שַׁבָּת") == "שבת"


def test_footnotes_do_not_count_as_the_source_text():
    assert "candles" not in source_search._plain(IMPORTANT_PERSON)


def test_the_ruling_around_a_footnote_is_kept():
    assert "prepare by himself" in source_search._plain(IMPORTANT_PERSON)


def test_queries_pair_neighbouring_words_first():
    assert source_search._queries("important person preparing shabbat")[0] == "important person"


def test_a_one_word_question_is_searched_as_that_word():
    assert source_search._queries("tefillin") == ["tefillin"]


def test_the_source_that_shares_the_most_words_comes_first():
    sources = [
        _source("A", "Lighting candles on Friday."),
        _source("B", "An important person must prepare for Shabbat himself."),
    ]
    ranked = source_search.rank_sources("must an important person prepare for shabbat", sources)
    assert [s["ref"] for s in ranked] == ["B", "A"]


def test_a_long_chapter_does_not_win_for_its_length():
    long_chapter = _source("Long", *["Shabbat candles are lit before sunset."] * 30)
    exact = _source("Exact", "An important person prepares for Shabbat himself.")
    ranked = source_search.rank_sources("important person prepare shabbat", [long_chapter, exact])
    assert ranked[0]["ref"] == "Exact"


def test_with_no_shared_words_the_order_stands():
    sources = [_source("A", "x"), _source("B", "y")]
    assert [s["ref"] for s in source_search.rank_sources("tefillin straps", sources)] == ["A", "B"]


def test_a_searched_source_that_matches_poorly_is_dropped():
    sources = [
        _source("Curated", "An important person must prepare for Shabbat himself."),
        _source("Searched", "Chanukah lights."),
    ]
    ranked = source_search.rank_sources("important person prepare shabbat", sources, optional_refs=["Searched"])
    assert [s["ref"] for s in ranked] == ["Curated"]


def test_a_curated_source_that_matches_poorly_is_kept():
    sources = [
        _source("Searched", "An important person must prepare for Shabbat himself."),
        _source("Curated", "Chanukah lights."),
    ]
    ranked = source_search.rank_sources("important person prepare shabbat", sources, optional_refs=["Searched"])
    assert [s["ref"] for s in ranked] == ["Searched", "Curated"]


def test_one_source_is_returned_as_it_is():
    sources = [_source("A", "x")]
    assert source_search.rank_sources("tefillin straps", sources) == sources


def test_search_returns_the_best_paragraph(monkeypatch):
    monkeypatch.setattr(source_search, "_run_searches", lambda queries: [
        _hit("Mishneh Torah, Sabbath 30:6", "Even a very important person must prepare for the Sabbath."),
        _hit("Mishneh Torah, Sabbath 1:1", "Resting on the Sabbath."),
    ])
    assert source_search.search_refs("must an important person prepare for shabbat") == [
        "Mishneh Torah, Sabbath 30:6"]


def test_search_skips_a_chapter_the_keyword_table_brings(monkeypatch):
    monkeypatch.setattr(source_search, "_run_searches", lambda queries: [
        _hit("Shulchan Arukh, Orach Chayim 250:1", "An important person prepares for Shabbat himself."),
    ])
    refs = source_search.search_refs(
        "must an important person prepare for shabbat", ["Shulchan_Arukh,_Orach_Chayim.250"])
    assert refs == []


def test_search_leaves_out_the_commentaries(monkeypatch):
    monkeypatch.setattr(source_search, "_run_searches", lambda queries: [
        _hit("Beit Yosef, Orach Chayim 250:1", "An important person prepares for Shabbat himself."),
    ])
    assert source_search.search_refs("must an important person prepare for shabbat") == []


def test_search_needs_two_shared_words(monkeypatch):
    monkeypatch.setattr(source_search, "_run_searches", lambda queries: [
        _hit("Mishneh Torah, Sabbath 1:1", "Resting on the Sabbath."),
    ])
    assert source_search.search_refs("must an important person prepare for shabbat") == []


def test_search_is_skipped_for_a_question_with_no_telling_word(monkeypatch):
    calls = []
    monkeypatch.setattr(source_search, "_run_searches", lambda queries: calls.append(queries) or [])
    source_search.search_refs("what is it?")
    assert calls == []


def test_a_one_word_question_takes_a_paragraph_with_that_word(monkeypatch):
    monkeypatch.setattr(source_search, "_run_searches", lambda queries: [
        _hit("Mishneh Torah, Sabbath 24:12", "Why did the sages forbid moving muktzeh things?"),
    ])
    assert source_search.search_refs("What is muktzeh?") == ["Mishneh Torah, Sabbath 24:12"]


def test_search_results_are_remembered(monkeypatch):
    calls = []
    monkeypatch.setattr(source_search, "_run_searches", lambda queries: calls.append(queries) or [])
    source_search.search_refs("important person prepare shabbat")
    source_search.search_refs("important person prepare shabbat")
    assert len(calls) == 1


def test_a_failed_search_call_finds_nothing(monkeypatch):
    def down(*args, **kwargs):
        raise source_search.requests.ConnectionError("down")

    monkeypatch.setattr(source_search._session, "post", down)
    assert source_search._post_search("important person") == []


def test_the_search_is_limited_to_the_halachic_codes():
    assert source_search._payload("x")["filters"] == list(source_search.SEARCH_PATHS)


def test_a_paragraph_ref_names_its_chapter():
    assert source_search._chapter("Shulchan Arukh, Orach Chayim 250:1") == "shulchan arukh, orach chayim 250"


def test_a_chapter_ref_in_the_keyword_tables_form_matches():
    assert source_search._chapter("Shulchan_Arukh,_Orach_Chayim.250") == "shulchan arukh, orach chayim 250"


LAND_QUESTION = "where else in the torah does it say the land ate the people"
LAND_PLAN = {"refs": ["Numbers 13:32"], "hebrew": ["אכלת יושביה"], "english": ["devourest men"]}


def _with_plan(monkeypatch, plan, hits_by_query):
    monkeypatch.setattr(source_search.question_plan, "plan", lambda question: plan)
    monkeypatch.setattr(source_search, "_run_searches", lambda queries: [
        hit for query in queries for hit in hits_by_query.get(query[0] if isinstance(query, tuple) else query, [])])


def test_a_question_about_the_torah_is_a_tanakh_question():
    assert source_search.is_tanakh_question(LAND_QUESTION) is True


def test_a_question_about_a_law_is_not_a_tanakh_question():
    assert source_search.is_tanakh_question("can i carry on shabbat") is False


def test_a_paragraph_holding_every_word_of_a_phrase_holds_it():
    assert source_search._holds_phrase("a land that eateth up the inhabitants", ["eateth inhabitants"]) is True


def test_a_paragraph_missing_a_word_does_not_hold_the_phrase():
    assert source_search._holds_phrase("a land that eateth up men", ["eateth inhabitants"]) is False


def test_the_planner_named_ref_comes_first(monkeypatch):
    _with_plan(monkeypatch, LAND_PLAN, {})
    assert source_search.find_sources(LAND_QUESTION)["refs"] == ["Numbers 13:32"]


def test_a_phrase_hit_is_found(monkeypatch):
    _with_plan(monkeypatch, LAND_PLAN, {"devourest men": [_hit("Ezekiel 36:13", "a land that devourest men")]})
    assert "Ezekiel 36:13" in source_search.find_sources(LAND_QUESTION)["refs"]


def test_a_phrase_hit_is_matched(monkeypatch):
    _with_plan(monkeypatch, LAND_PLAN, {"devourest men": [_hit("Ezekiel 36:13", "a land that devourest men")]})
    assert source_search.find_sources(LAND_QUESTION)["matched"] == ["Ezekiel 36:13"]


def test_the_named_ref_is_vouched_for(monkeypatch):
    _with_plan(monkeypatch, LAND_PLAN, {})
    assert source_search.find_sources(LAND_QUESTION)["vouched"] == ["Numbers 13:32"]


def test_the_plan_phrases_are_passed_on(monkeypatch):
    _with_plan(monkeypatch, LAND_PLAN, {})
    assert source_search.find_sources(LAND_QUESTION)["phrases"] == ["אכלת יושביה", "devourest men"]


def test_no_plan_still_searches_the_question(monkeypatch):
    _with_plan(monkeypatch, None, {})
    assert source_search.find_sources(LAND_QUESTION)["refs"] == []


def _land_sources():
    return [
        _source("Numbers 13:32", "The land eateth up the inhabitants thereof; all the people are men of stature."),
        _source("Ezekiel 36:13", "Thou land devourest men."),
    ]


def test_a_weak_optional_source_is_dropped():
    ranked = source_search.rank_sources(LAND_QUESTION, _land_sources(), optional_refs=["Ezekiel 36:13"])
    assert [s["ref"] for s in ranked] == ["Numbers 13:32"]


def test_a_vouched_source_sharing_a_word_is_kept():
    ranked = source_search.rank_sources(
        LAND_QUESTION, _land_sources(), optional_refs=["Ezekiel 36:13"], vouched_refs=["Ezekiel 36:13"])
    assert [s["ref"] for s in ranked] == ["Numbers 13:32", "Ezekiel 36:13"]


def test_a_vouched_source_sharing_no_word_is_dropped():
    sources = [*_land_sources(), _source("Psalms 1:1", "Happy is the one who walks not in the counsel.")]
    ranked = source_search.rank_sources(
        LAND_QUESTION, sources, optional_refs=["Psalms 1:1"], vouched_refs=["Psalms 1:1"])
    assert "Psalms 1:1" not in [s["ref"] for s in ranked]


def test_a_phrase_matched_source_ranks_ahead_of_a_keyword_match():
    sources = [
        _source("Shulchan Arukh, Orach Chayim 580:2", "On the twenty-eighth Samuel the prophet died."),
        _source("I Samuel 3:20", "All Israel knew that Samuel was a prophet."),
    ]
    ranked = source_search.rank_sources(
        "what book is samuel the prophet in", sources, matched_refs=["I Samuel 3:20"])
    assert ranked[0]["ref"] == "I Samuel 3:20"


def test_a_slow_search_does_not_hold_up_the_round(monkeypatch):
    def search(query, paths):
        if query == "slow":
            time.sleep(source_search._TIMEOUT_SECONDS)
        return []

    monkeypatch.setattr(source_search, "_post_search", search)
    started = time.monotonic()
    _REAL_RUN_SEARCHES(["a", "b", "c", "slow"])
    assert time.monotonic() - started < source_search._STRAGGLER_GRACE_SECONDS + 0.5


def test_a_hit_carries_the_books_it_was_searched_in(monkeypatch):
    monkeypatch.setattr(source_search, "_post_search", lambda query, paths: [{"ref": "Zohar, Noach 34:266"}])
    assert _REAL_RUN_SEARCHES([("x", ("Kabbalah/Zohar",))])[0]["_paths"] == ("Kabbalah/Zohar",)


RAINBOW_QUESTION = "what blessing do i say when i see a rainbow"
RAINBOW_PLAN = {"refs": [], "hebrew": ["הרואה הקשת"], "english": []}
ZOHAR_HIT = {"ref": "Zohar, Noach 34:266", "exact": "הרואה הקשת בענן"}
MORE_ZOHAR_HIT = {"ref": "Zohar, Bereshit 83:228", "exact": "הרואה הקשת בענן"}
BERURAH_HIT = {"ref": "Mishnah Berurah 229:1", "exact": "הרואה הקשת בענן"}


def _rainbow_searches(monkeypatch, codes_hits):
    monkeypatch.setattr(source_search.question_plan, "plan", lambda question: RAINBOW_PLAN)

    def run(queries):
        found = []
        for query in queries:
            paths = query[1] if isinstance(query, tuple) else source_search.SEARCH_PATHS
            if paths == source_search.WIDER_PATHS[0]:
                found += [{**ZOHAR_HIT, "_paths": paths}, {**MORE_ZOHAR_HIT, "_paths": paths}]
            elif paths == source_search.WIDER_PATHS[1]:
                found.append({**BERURAH_HIT, "_paths": paths})
            elif paths == source_search.BROAD_PATHS:
                found.extend({**hit, "_paths": paths} for hit in codes_hits)
        return found

    monkeypatch.setattr(source_search, "_run_searches", run)


def test_the_zohar_is_searched_for_the_plan_phrases(monkeypatch):
    _rainbow_searches(monkeypatch, [])
    assert "Zohar, Noach 34:266" in source_search.find_sources(RAINBOW_QUESTION)["wider"]


def test_the_zohar_does_not_take_the_mishnah_berurahs_place(monkeypatch):
    _rainbow_searches(monkeypatch, [])
    assert source_search.find_sources(RAINBOW_QUESTION)["wider"] == ["Zohar, Noach 34:266", "Mishnah Berurah 229:1"]


def test_a_zohar_match_is_kept_beside_strong_code_matches(monkeypatch):
    codes = [_hit(f"Shulchan Arukh, Orach Chayim {n}:1", "הרואה הקשת בענן מברך") for n in range(220, 226)]
    _rainbow_searches(monkeypatch, codes)
    assert "Zohar, Noach 34:266" in source_search.find_sources(RAINBOW_QUESTION)["refs"]


def test_the_plan_named_refs_start_loading_early(monkeypatch):
    loading = []
    monkeypatch.setattr(source_search.question_plan, "plan", lambda question: LAND_PLAN)
    monkeypatch.setattr(source_search, "_prefetch", loading.extend)
    source_search.find_sources(LAND_QUESTION)
    assert loading == ["Numbers 13:32"]


def test_a_wider_source_below_the_cut_takes_the_last_place():
    ranked = [_source(f"Shulchan Arukh, Orach Chayim {n}:1", "x") for n in range(1, 4)] + [
        _source("Zohar, Noach 34:266", "x")]
    kept = source_search.cap_sources(ranked, ["Zohar, Noach 34:266"], 3)
    assert [s["ref"] for s in kept] == [
        "Shulchan Arukh, Orach Chayim 1:1", "Shulchan Arukh, Orach Chayim 2:1", "Zohar, Noach 34:266"]


def test_with_no_wider_sources_the_cut_stands():
    ranked = [_source(f"Shulchan Arukh, Orach Chayim {n}:1", "x") for n in range(1, 5)]
    assert len(source_search.cap_sources(ranked, [], 3)) == 3
