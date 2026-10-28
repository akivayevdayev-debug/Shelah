"""backend/source_search.py: Sefaria's own search finds extra paragraphs for a
question, and the loaded sources are ordered by how well they match it."""

from backend import source_search

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

    monkeypatch.setattr(source_search.requests, "post", down)
    assert source_search._post_search("important person") == []


def test_the_search_is_limited_to_the_halachic_codes():
    assert source_search._payload("x")["filters"] == list(source_search.SEARCH_PATHS)


def test_a_paragraph_ref_names_its_chapter():
    assert source_search._chapter("Shulchan Arukh, Orach Chayim 250:1") == "shulchan arukh, orach chayim 250"


def test_a_chapter_ref_in_the_keyword_tables_form_matches():
    assert source_search._chapter("Shulchan_Arukh,_Orach_Chayim.250") == "shulchan arukh, orach chayim 250"
