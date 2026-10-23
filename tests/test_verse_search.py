"""
Verse search (backend/verse_search.py, GET /api/search/verses).

Sefaria's search-wrapper is faked: each fake answers a query string with hits
shaped like the real ones (one hit per edition of a verse, <b> around the
matched words), so these tests pin what the module does with them, not what
Sefaria returns. The real responses were probed on 2026-10-20 for the same
queries.
"""

import pytest

import backend.verse_search as vs
from backend.health_check import health


def _hit(ref, he_ref, text, *, lang="he", version="Tanach with Nikkud", path="Tanakh/Torah/Genesis"):
    return {
        "_source": {
            "ref": ref, "heRef": he_ref, "lang": lang, "version": version,
            "path": path, "categories": path.split("/")[:-1] + [path.split("/")[-1]],
            "naive_lemmatizer": text,
        },
        "highlight": {"naive_lemmatizer": [text]},
    }


GEN_1_1 = [
    _hit("Genesis 1:1", "בראשית א׳:א׳", "<b>בְּרֵאשִׁ֖ית</b> <b>בָּרָ֣א</b> <b>אֱלֹהִ֑ים</b> אֵ֥ת הַשָּׁמַ֖יִם", version="Miqra according to the Masorah"),
    _hit("Genesis 1:1", "בראשית א׳:א׳", "<b>בְּרֵאשִׁית</b> <b>בָּרָא</b> <b>אֱלֹהִים</b> אֵת הַשָּׁמַיִם"),
    _hit("Genesis 1:1", "בראשית א׳:א׳", "When God began to create", lang="en", version="The Contemporary Torah"),
]
DEUT_6_4 = [_hit("Deuteronomy 6:4", "דברים ו׳:ד׳", "<b>שְׁמַע</b> <b>יִשְׂרָאֵל</b> יְהוָה אֱלֹהֵינוּ", path="Tanakh/Torah/Deuteronomy")]
GEN_1_3_EN = [
    _hit("Genesis 1:3", "בראשית א׳:ג׳", "<b>וַיֹּאמֶר</b> אֱלֹהִים", version="Tanach with Nikkud"),
    _hit("Genesis 1:3", "בראשית א׳:ג׳", "God said, &ldquo;<b>Let</b> <b>there</b> <b>be</b> <b>light</b>&rdquo;; and there was light.", lang="en", version="The Koren Jerusalem Bible"),
]
MID_VERSE = [_hit("Genesis 1:3", "בראשית א׳:ג׳", "וַיֹּאמֶר אֱלֹהִים יְהִי אוֹר <b>וַיְהִי</b> <b>אוֹר</b>")]
RASHI = [_hit("Rashi on Genesis 1:1:1", "רש״י על בראשית א׳:א׳:א׳", "<b>בראשית</b> <b>ברא</b>", path="Tanakh/Rishonim on Tanakh/Rashi/Torah/Rashi on Genesis")]


@pytest.fixture
def sefaria(monkeypatch):
    """Fake search-wrapper: {(query, tanakh_only): hits}; records calls."""
    vs._cache.clear()
    table = {}
    calls = []
    monkeypatch.setattr(health, "is_healthy", lambda name: True)

    def fake(payload):
        tanakh_only = bool(payload["filters"])
        calls.append((payload["query"], tanakh_only, payload["slop"]))
        return table.get((payload["query"], tanakh_only), [])

    monkeypatch.setattr(vs, "_post_search", fake)
    yield table, calls
    vs._cache.clear()


def _text(result):
    return "".join(p["text"] for p in result["parts"])


def _matched(result):
    return [p["text"] for p in result["parts"] if p["match"]]


# --- normalising the query --------------------------------------------------

@pytest.mark.parametrize("raw, expected", [
    ("בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים", "בראשית ברא אלהים"),
    ("  שמע   ישראל ", "שמע ישראל"),
    ("עַל־פְּנֵי", "על פני"),
    ("ה׳ אחד", "ה אחד"),
    ("\"Let there be light!\"", "Let there be light"),
])
def test_queries_lose_pointing_and_punctuation(raw, expected):
    assert vs.normalize_query(raw) == expected


def test_a_long_query_is_capped():
    assert len(vs.normalize_query("א " * 200).split(" ")) <= 12


# --- finding verses ---------------------------------------------------------

def test_the_opening_words_of_genesis_find_genesis_1_1_once(sefaria):
    table, _ = sefaria
    table[("בראשית ברא אלהים", True)] = GEN_1_1
    out = vs.search_verses("בְּרֵאשִׁית בָּרָא אֱלֹהִים")
    assert [r["ref"] for r in out["results"]] == ["Genesis 1:1"]
    first = out["results"][0]
    assert first["tanakh"]
    assert first["match"] == "exact"
    assert not out["close"]
    # The Hebrew edition without te'amim is the snippet; matched words marked.
    assert first["lang"] == "he"
    assert _matched(first) == ["בְּרֵאשִׁית בָּרָא אֱלֹהִים"]


def test_shema_yisrael_finds_deuteronomy_6_4(sefaria):
    table, _ = sefaria
    table[("שמע ישראל", True)] = DEUT_6_4
    assert vs.search_verses("שמע ישראל")["results"][0]["ref"] == "Deuteronomy 6:4"


def test_a_phrase_from_the_middle_of_a_verse_finds_it(sefaria):
    table, _ = sefaria
    table[("ויהי אור", True)] = MID_VERSE
    result = vs.search_verses("ויהי אור")["results"][0]
    assert result["ref"] == "Genesis 1:3"
    assert _matched(result) == ["וַיְהִי אוֹר"]


def test_english_words_find_the_verse_with_an_english_snippet(sefaria):
    table, _ = sefaria
    table[("let there be light", True)] = GEN_1_3_EN
    result = vs.search_verses("let there be light")["results"][0]
    assert result["ref"] == "Genesis 1:3"
    assert result["lang"] == "en"
    assert "“" in _text(result)  # entities decoded to text
    assert _matched(result) == ["Let there be light"]


def test_tanakh_comes_before_the_rest_of_the_library(sefaria):
    table, _ = sefaria
    table[("בראשית ברא", True)] = GEN_1_1
    table[("בראשית ברא", False)] = RASHI + GEN_1_1
    refs = [r["ref"] for r in vs.search_verses("בראשית ברא")["results"]]
    assert refs == ["Genesis 1:1", "Rashi on Genesis 1:1:1"]


def test_a_typo_falls_back_to_close_matches(sefaria):
    table, calls = sefaria
    # "בראשת" (missing yod) matches nothing; leaving it out finds the verse.
    table[("ברא אלהים", True)] = GEN_1_1
    out = vs.search_verses("בראשת ברא אלהים")
    assert out["close"] is True
    assert out["results"][0]["ref"] == "Genesis 1:1"
    assert out["results"][0]["match"] == "close"
    assert all(slop == vs._CLOSE_SLOP for q, _t, slop in calls if q != "בראשת ברא אלהים")
    assert len([c for c in calls if c[0] != "בראשת ברא אלהים"]) <= vs._MAX_CLOSE_SEARCHES


def test_no_match_is_an_empty_list(sefaria):
    out = vs.search_verses("qwzx plorb")
    assert out == {"query": "qwzx plorb", "close": False, "results": []}


def test_too_short_a_query_never_reaches_sefaria(sefaria):
    _, calls = sefaria
    assert vs.search_verses("אב")["results"] == []
    assert calls == []


def test_repeated_queries_are_served_from_the_cache(sefaria):
    table, calls = sefaria
    table[("שמע ישראל", True)] = DEUT_6_4
    vs.search_verses("שמע ישראל")
    count = len(calls)
    vs.search_verses("שְׁמַע יִשְׂרָאֵל")
    assert len(calls) == count


def test_an_outage_is_not_cached(sefaria, monkeypatch):
    table, calls = sefaria
    monkeypatch.setattr(health, "is_healthy", lambda name: False)
    vs.search_verses("שמע ישראל")
    assert vs._cache == {}


# --- snippets are text, never markup ----------------------------------------

def test_snippet_markup_from_upstream_is_dropped():
    parts = vs.snippet_parts('<b>שמע</b> <script>alert(1)</script><i onclick="x">ישראל</i> &lt;img&gt;')
    joined = "".join(p["text"] for p in parts)
    assert "<script>" not in joined
    assert "onclick" not in joined
    assert joined == "שמע alert(1)ישראל <img>"
    assert parts[0] == {"text": "שמע", "match": True}


def test_teamim_are_removed_but_nikud_kept():
    parts = vs.snippet_parts("<b>בְּרֵאשִׁ֖ית</b>")
    assert parts == [{"text": "בְּרֵאשִׁית", "match": True}]


def test_a_long_snippet_is_trimmed_around_the_match():
    text = "א" * 300 + " <b>שמע</b> " + "ב" * 300
    parts = vs.snippet_parts(text)
    joined = "".join(p["text"] for p in parts)
    assert len(joined) <= vs._SNIPPET_CHARS + 4
    assert "שמע" in joined
    assert joined.startswith("…")
    assert joined.endswith("…")


# --- the HTTP call ------------------------------------------------------------

class _Resp:
    def __init__(self, ok=True, data=None):
        self.ok, self._data = ok, data
        self.content = b"x"

    def json(self):
        return self._data


def test_post_search_reads_hits_and_records_health(monkeypatch):
    seen = []
    monkeypatch.setattr(health, "is_healthy", lambda name: True)
    monkeypatch.setattr(health, "record_success", lambda name: seen.append("ok"))
    monkeypatch.setattr(vs.requests, "post", lambda *a, **k: _Resp(data={"hits": {"hits": DEUT_6_4}}))
    assert vs._post_search({}) == DEUT_6_4
    assert seen == ["ok"]


@pytest.mark.parametrize("post", [
    lambda *a, **k: _Resp(ok=False),
    lambda *a, **k: (_ for _ in ()).throw(vs.requests.Timeout("slow")),
])
def test_post_search_failures_are_empty_and_recorded(monkeypatch, post):
    failed = []
    monkeypatch.setattr(health, "is_healthy", lambda name: True)
    monkeypatch.setattr(health, "record_failure", lambda name: failed.append(name))
    monkeypatch.setattr(vs.requests, "post", post)
    assert vs._post_search({}) == []
    assert failed == ["sefaria"]


def test_post_search_skips_an_unhealthy_sefaria(monkeypatch):
    monkeypatch.setattr(health, "is_healthy", lambda name: False)
    monkeypatch.setattr(vs.requests, "post", lambda *a, **k: pytest.fail("should not call"))
    assert vs._post_search({}) == []


# --- the route --------------------------------------------------------------

def test_the_route_returns_verse_results(test_client, sefaria):
    table, _ = sefaria
    table[("שמע ישראל", True)] = DEUT_6_4
    response = test_client.get("/api/search/verses?q=שמע ישראל&size=4")
    assert response.status_code == 200
    body = response.get_json()
    assert body["results"][0]["ref"] == "Deuteronomy 6:4"
    assert body["close"] is False


def test_a_found_result_is_cached_at_the_edge_and_an_empty_one_is_not(test_client, sefaria):
    table, _ = sefaria
    table[("שמע ישראל", True)] = DEUT_6_4
    found = test_client.get("/api/search/verses?q=שמע ישראל&size=4")
    assert "s-maxage" in found.headers["Cache-Control"]
    empty = test_client.get("/api/search/verses?q=zzzqqqxxx")
    assert empty.get_json()["results"] == []
    assert "no-store" in empty.headers["Cache-Control"]


def test_the_route_answers_an_empty_query_without_searching(test_client, sefaria):
    _, calls = sefaria
    response = test_client.get("/api/search/verses?q=")
    assert response.get_json()["results"] == []
    assert calls == []


def test_the_route_is_rate_limited_and_cached_like_library_search():
    import backend.cache_policy as cache_policy
    import backend.rate_limit as rate_limit_mod
    assert rate_limit_mod.classify_route("/api/search/verses") == "fanout"
    assert "/api/search/verses" in cache_policy._CORPUS_EXACT


def test_a_typo_still_offers_the_verse_when_later_books_match_exactly(sefaria):
    table, _ = sefaria
    table[("בראשת ברא אלהים", False)] = RASHI
    table[("ברא אלהים", True)] = GEN_1_1
    out = vs.search_verses("בראשת ברא אלהים")
    assert [r["ref"] for r in out["results"]] == ["Genesis 1:1", "Rashi on Genesis 1:1:1"]
    assert out["close"] is True
    assert [r["match"] for r in out["results"]] == ["close", "exact"]


def test_matched_words_joined_by_a_maqaf_are_one_phrase():
    parts = vs.snippet_parts("<b>לֶךְ</b>־<b>לְךָ</b> מֵאַרְצְךָ")
    assert parts[0] == {"text": "לֶךְ־לְךָ", "match": True}


def test_reviewed_hebrew_edition_beats_an_unreviewed_one_listed_first():
    hits = [
        _hit("Genesis 1:1", "בראשית א׳:א׳", "<b>בראשית</b> ברא", version="Some Unreviewed Upload"),
        _hit("Genesis 1:1", "בראשית א׳:א׳", "<b>בְּרֵאשִׁית</b> בָּרָא", version="Miqra according to the Masorah"),
    ]
    _order, by_ref = vs._best_hit_per_ref(hits, hebrew_query=True)
    assert by_ref["Genesis 1:1"][2]["_source"]["version"] == "Miqra according to the Masorah"


def test_unreviewed_hebrew_edition_still_shows_when_it_is_the_only_one():
    hits = [_hit("Genesis 1:1", "בראשית א׳:א׳", "<b>בראשית</b> ברא", version="Some Unreviewed Upload")]
    order, _by_ref = vs._best_hit_per_ref(hits, hebrew_query=True)
    assert order == ["Genesis 1:1"]
