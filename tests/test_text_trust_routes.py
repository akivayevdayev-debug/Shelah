"""Denied works and versions never reach any library route.

Every Sefaria endpoint is mocked to return an allowed item next to denied
ones (a denied commentary, a denied translation, a denied search hit); each
route's body must carry none of the denied markers.
"""

import json
import re

import pytest
import responses as responses_lib

import backend.sefaria_library as sl
from backend import verse_search

DENIED_WORK = "Rereading the Rabbis"
DENIED_VERSION = "THE JPS TANAKH: Gender-Sensitive Edition"
DENIED_TEXT = "DENIED-MARKER"
ALLOWED_TEXT = "In the beginning God created"

MASORAH = {"versionTitle": "Miqra according to the Masorah", "language": "he",
           "actualLanguage": "he", "isSource": True, "text": ["בְּרֵאשִׁ֖ית"]}
KOREN = {"versionTitle": "The Koren Jerusalem Bible", "language": "en",
         "actualLanguage": "en", "text": [ALLOWED_TEXT]}
DENIED_EN = {"versionTitle": DENIED_VERSION, "language": "en",
             "actualLanguage": "en", "text": [DENIED_TEXT]}


def _v3(index_title="Genesis", *versions):
    return {"ref": "Genesis 1:1", "indexTitle": index_title, "title": "Genesis 1",
            "versions": list(versions) or [MASORAH, DENIED_EN],
            "available_versions": [MASORAH, KOREN, DENIED_EN]}


RELATED = {"links": [
    {"ref": "Rashi on Genesis 1:1:1", "sourceRef": "Rashi on Genesis 1:1:1",
     "index_title": "Rashi on Genesis", "category": "Commentary", "type": "commentary",
     "collectiveTitle": {"en": "Rashi", "he": "רש״י"}, "anchorRef": "Genesis 1:1"},
    {"ref": f"{DENIED_WORK} 1:1", "sourceRef": f"{DENIED_WORK} 1:1",
     "index_title": DENIED_WORK, "category": "Commentary", "type": "commentary",
     "collectiveTitle": {"en": DENIED_WORK, "he": ""}, "anchorRef": "Genesis 1:1"},
]}

SEARCH_HITS = {"hits": {"total": 3, "hits": [
    {"_id": "Genesis 1:1 (en) [The Koren Jerusalem Bible]",
     "_source": {"ref": "Genesis 1:1", "heRef": "בראשית א:א", "version": "The Koren Jerusalem Bible",
                 "lang": "en", "index_title": "Genesis", "categories": ["Tanakh", "Torah"],
                 "exact": ALLOWED_TEXT, "naive_lemmatizer": ALLOWED_TEXT},
     "highlight": {"exact": [ALLOWED_TEXT]}},
    {"_id": f"Genesis 1:1 (en) [{DENIED_VERSION}]",
     "_source": {"ref": "Genesis 1:1", "heRef": "בראשית א:א", "version": DENIED_VERSION,
                 "lang": "en", "index_title": "Genesis", "categories": ["Tanakh", "Torah"],
                 "exact": DENIED_TEXT, "naive_lemmatizer": DENIED_TEXT},
     "highlight": {"exact": [DENIED_TEXT]}},
    {"_id": f"{DENIED_WORK} 1:1 (en) [Sefaria]",
     "_source": {"ref": f"{DENIED_WORK} 1:1", "heRef": "", "version": "Sefaria",
                 "lang": "en", "index_title": DENIED_WORK, "categories": ["Modern Works"],
                 "exact": DENIED_TEXT, "naive_lemmatizer": DENIED_TEXT},
     "highlight": {"exact": [DENIED_TEXT]}},
]}}

LIBRARY_INDEX = [{"category": "Modern Works", "heCategory": "", "contents": [
    {"title": DENIED_WORK, "heTitle": "", "categories": ["Modern Works"]},
    {"title": "Mesillat Yesharim", "heTitle": "מסילת ישרים", "categories": ["Musar"]},
]}]

NAME = {"is_ref": False, "completions": [DENIED_WORK, "Genesis"],
        "completion_objects": [
            {"title": DENIED_WORK, "key": DENIED_WORK, "type": "ref", "is_primary": True},
            {"title": "Genesis", "key": "Genesis", "type": "ref", "is_primary": True}]}


@pytest.fixture
def poisoned_sefaria():
    sl._cache.clear()
    sl._resolved_query_ref_cache.clear()
    with responses_lib.RequestsMock(assert_all_requests_are_fired=False) as rsps:
        api = re.escape(sl.SEFARIA_API)
        v3 = re.escape(sl.SEFARIA_V3_API)
        rsps.add(responses_lib.GET, re.compile(v3 + r"/texts/Rereading.*"),
                 json=_v3(DENIED_WORK, KOREN))
        rsps.add(responses_lib.GET, re.compile(v3 + r"/texts/.*Koren.*"),
                 json=_v3("Genesis", MASORAH, KOREN))
        rsps.add(responses_lib.GET, re.compile(v3 + r"/texts/.*"), json=_v3())
        rsps.add(responses_lib.GET, re.compile(api + r"/texts/.*"),
                 json={"ref": "Genesis 1:1", "he": ["בְּרֵאשִׁ֖ית"], "text": [DENIED_TEXT],
                       "versionTitle": DENIED_VERSION, "indexTitle": "Genesis",
                       "heVersionTitle": "Miqra according to the Masorah"})
        rsps.add(responses_lib.GET, re.compile(api + r"/related/.*"), json=RELATED)
        rsps.add(responses_lib.GET, re.compile(api + r"/name/.*"), json=NAME)
        rsps.add(responses_lib.GET, re.compile(api + r"/index/?$"), json=LIBRARY_INDEX)
        rsps.add(responses_lib.GET, re.compile(api + r"/index/Rereading.*"),
                 json={"title": DENIED_WORK, "categories": ["Modern Works"],
                       "schema": {"nodeType": "JaggedArrayNode", "depth": 2, "lengths": [3]}})
        rsps.add(responses_lib.GET, re.compile(api + r"/index/Modern.*"),
                 json=LIBRARY_INDEX[0]["contents"])
        rsps.add(responses_lib.GET, re.compile(api + r"/index/.*"),
                 json={"title": "Genesis", "categories": ["Tanakh", "Torah"]})
        rsps.add(responses_lib.GET, re.compile(api + r"/category/.*"), json=LIBRARY_INDEX[0])
        rsps.add(responses_lib.POST, re.compile(re.escape(verse_search.SEARCH_URL) + ".*"),
                 json=SEARCH_HITS)
        rsps.add(responses_lib.POST, re.compile(r"https://www\.sefaria\.org/api/search.*"),
                 json=SEARCH_HITS)
        yield rsps
    sl._cache.clear()


ROUTES = [
    "/api/text/Genesis%201:1",
    "/api/text/Genesis%201:1?ven=" + DENIED_VERSION.replace(" ", "%20"),
    "/api/text/Genesis%201:1/links",
    "/api/text/Genesis%201:1/graph",
    "/api/sidebar/Genesis%201:1?stage=links",
    "/api/sidebar/Genesis%201:1?stage=texts",
    "/api/library/search?q=beginning",
    "/api/library/search?q=Rereading",
    "/api/search/suggest?q=Rereading",
    "/api/search/verses?q=beginning",
    "/api/library/category/Modern%20Works",
]

# A reader who asks for the denied work by name gets its name echoed back
# with nothing in it.
DIRECT_ROUTES = [
    f"/api/text/{DENIED_WORK}%201:1",
    f"/api/text/{DENIED_WORK}%201:1/links",
    f"/api/text/{DENIED_WORK}%201:1/graph",
    f"/api/sidebar/{DENIED_WORK}%201:1?stage=texts",
    f"/api/library/leaf-refs?title={DENIED_WORK}",
]


@pytest.mark.parametrize("path", ROUTES)
def test_denied_content_never_reaches_a_route(test_client, poisoned_sefaria, path):
    response = test_client.get(path)
    body = response.get_data(as_text=True)
    for marker in (DENIED_WORK, DENIED_VERSION, DENIED_TEXT):
        assert marker not in body, f"{marker!r} leaked through {path}: {body[:400]}"


@pytest.mark.parametrize("path", DIRECT_ROUTES)
def test_asking_for_a_denied_work_returns_nothing_of_it(test_client, poisoned_sefaria, path):
    body = test_client.get(path).get_data(as_text=True)
    assert DENIED_TEXT not in body
    assert DENIED_VERSION not in body
    payload = json.loads(body)
    for key in ("he", "en", "refs", "texts", "sections"):
        assert not payload.get(key), f"{path} returned {key}: {payload.get(key)!r}"


def test_the_allowed_translation_does_reach_the_reader(test_client, poisoned_sefaria):
    payload = json.loads(test_client.get("/api/text/Genesis%201:1").get_data(as_text=True))
    assert ALLOWED_TEXT in json.dumps(payload)
    assert payload["versions"]["en"]["label"] == "Orthodox (Koren)"


def test_the_allowed_commentary_does_reach_the_links_panel(test_client, poisoned_sefaria):
    body = test_client.get("/api/text/Genesis%201:1/links").get_data(as_text=True)
    assert "Rashi on Genesis 1:1:1" in body


def test_the_allowed_book_does_reach_the_category_list(test_client, poisoned_sefaria):
    body = test_client.get("/api/library/category/Modern%20Works").get_data(as_text=True)
    assert "Mesillat Yesharim" in body


def test_minhag_param_picks_the_communitys_version(test_client, poisoned_sefaria):
    payload = json.loads(test_client.get(
        "/api/text/Genesis%201:1?minhag=ashkenazi").get_data(as_text=True))
    assert payload["versions"]["en"] is None or payload["versions"]["en"]["title"] != DENIED_VERSION


# ── AI context ────────────────────────────────────────────────────────────────

import types  # noqa: E402

from backend import text_trust, web_lookup  # noqa: E402


def _found(*urls):
    results = [types.SimpleNamespace(type="web_search_result", title=u, url=u) for u in urls]
    citations = [types.SimpleNamespace(type="web_search_result_location", title=u, url=u, cited_text="x") for u in urls]
    return types.SimpleNamespace(content=[
        types.SimpleNamespace(type="web_search_tool_result", content=results),
        types.SimpleNamespace(type="text", text="Findings.", citations=citations),
    ])


@pytest.mark.parametrize("url", [
    "https://reformjudaism.org/x", "https://www.rabbinicalassembly.org/x", "https://learn.jtsa.edu/x",
])
def test_web_lookup_drops_findings_from_a_denied_publisher(url):
    assert web_lookup._result_from("q", _found("https://oukosher.org/x", url)) is None


def test_web_lookup_keeps_findings_from_allowed_sites():
    assert web_lookup._result_from("q", _found("https://oukosher.org/x", "https://www.chabad.org/y"))["sources"]


@pytest.mark.parametrize("lens, minhag", [
    ("All", "sephardi"), ("sefardic", "sephardi"), ("Moroccan", "sephardi"),
    ("iraqi", "mizrahi"), ("ashkenaz", "ashkenazi"), ("Ashkenazi", "ashkenazi"), ("Chabad", "ashkenazi"),
])
def test_the_answers_community_lens_picks_the_quoted_texts_versions(lens, minhag):
    assert text_trust.minhag_for_lens(lens) == minhag


def test_the_ai_reads_the_same_filtered_text_as_the_reader(poisoned_sefaria):
    """AI retrieval (ai_tools, rag) reads through get_text and get_linked_texts."""
    with text_trust.community_scope("ashkenazi"):
        assert text_trust.current_community() == "ashkenazi"
        text = sl.get_text("Genesis 1:1")
        links = sl.get_linked_texts("Genesis 1:1")
    assert text_trust.current_community() == "sephardi"
    blob = json.dumps([text, links])
    for marker in (DENIED_WORK, DENIED_VERSION, DENIED_TEXT):
        assert marker not in blob


def test_ai_citations_of_denied_sources_are_dropped_with_their_markers():
    from backend.citation_markers import finalize_sources, remap_markers
    raw = ["Shulchan Arukh, Orach Chayim 1:1", "Rereading the Rabbis, ch. 3",
           "Rabbinical Assembly responsum (2006)", "https://www.reformjudaism.org/x [Bracket",
           "Mishnah Berurah 1:1"]
    sources, index_map = finalize_sources(raw, lambda value: value)
    assert sources == ["Shulchan Arukh, Orach Chayim 1:1", "Mishnah Berurah 1:1"]
    assert remap_markers("Rule [1][2][3]. Custom [5].", index_map) == "Rule [1]. Custom [2]."


@pytest.mark.parametrize("value", ["Rabbinical Assembly", "the CJLS ruled", "CCAR Press",
                                   "Reconstructionist Siddur", "rabbinicalassembly.org"])
def test_movement_bodies_are_denied_sources(value):
    assert text_trust.is_source_denied(value)


@pytest.mark.parametrize("value", ["Rashi on Genesis 1:1", "Shulchan Arukh, Orach Chayim 1:1",
                                   "ou.org", "chabad.org", "Rabbi Ovadia Yosef, Yechave Daat 1:1"])
def test_orthodox_sources_are_not_denied(value):
    assert not text_trust.is_source_denied(value)
