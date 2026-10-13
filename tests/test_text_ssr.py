"""
Tests for the server-rendered body of /text/<ref> (backend/text_ssr.py).

A crawler that doesn't run JavaScript must find the chapter's Hebrew and
English in the first response; a visitor's browser must be able to adopt it
without a second fetch; and when Sefaria can't answer, the page must be the
plain shell it always was.
"""

import json
import re
import time

import pytest

from backend import page_meta, sefaria_library, text_ssr

HE_1 = "בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃"
HE_2 = "וְהָאָ֗רֶץ הָיְתָ֥ה תֹ֙הוּ֙ וָבֹ֔הוּ"
EN_1 = "When God began to create heaven and earth"
EN_2 = "the earth being unformed and void"


def _payload(**overrides):
    payload = {
        "ref": "Genesis 1",
        "title": "Genesis 1",
        "heTitle": "בראשית",
        "heRef": "בראשית א׳",
        "lines": [
            {"he": f"<big>בְּ</big>{HE_1[2:]}", "en": f'{EN_1}<sup class="footnote-marker">a</sup><i class="footnote">a note</i>—', "segment": "1"},
            {"he": HE_2, "en": EN_2, "segment": "2"},
            {"he": "", "en": "English only", "segment": "3"},
            {"he": "עברית בלבד", "en": "", "segment": "4"},
        ],
        "he": [], "en": [],
        "sections": ["1"], "sectionNames": ["Chapter", "Verse"],
        "next": "Genesis 2", "prev": None,
        "categories": ["Tanakh", "Torah"], "authors": [], "era": "",
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def serve_text(monkeypatch):
    """Makes get_text answer with ``payload`` (or run ``behavior``); returns
    the list of refs it was asked for."""
    asked = []

    def install(payload=None, behavior=None):
        def fake_get_text(ref, *args, **kwargs):
            asked.append(ref)
            if behavior is not None:
                return behavior(ref)
            return payload

        monkeypatch.setattr(sefaria_library, "get_text", fake_get_text)
        return asked

    return install


def _plain_shell(test_client, monkeypatch, path):
    with monkeypatch.context() as patch:
        patch.setenv("TEXT_SSR_ENABLED", "0")
        return test_client.get(path).get_data(as_text=True)


def _squash(html):
    return re.sub(r"\s+", " ", html)


class TestDisplayText:
    def test_footnotes_and_their_markers_are_dropped(self):
        raw = 'create<sup class="footnote-marker">a</sup><i class="footnote"><b>x</b>note</i> heaven'
        assert text_ssr._clean_line(raw) == "create heaven"

    def test_a_footnote_class_without_a_marker_is_dropped(self):
        assert text_ssr._clean_line('one <span class="footnote">gone</span> two') == "one two"

    def test_emphasis_tags_survive_without_attributes(self):
        assert text_ssr._clean_line('<b class="x" onclick="evil()">Bold</b> <small>rubric</small> <em>e</em>') == (
            "<b>Bold</b> <small>rubric</small> <em>e</em>"
        )

    @pytest.mark.parametrize("raw, expected", [
        ("<big>בְּ</big>רֵאשִׁ֖ית", "בְּרֵאשִׁ֖ית"),
        ('<span class="poetry">line</span>', "line"),
        ('<a href="https://evil.example">link</a>', "link"),
    ])
    def test_other_tags_are_dropped_and_their_text_kept(self, raw, expected):
        assert text_ssr._clean_line(raw) == expected

    @pytest.mark.parametrize("raw", [
        '<img src=x onerror="alert(1)">',
        "<script>alert(1)</script>safe",
        "<style>body{display:none}</style>safe",
        '<b onmouseover="alert(1)">x</b>',
        "<iframe src=//evil.example></iframe>safe",
    ])
    def test_nothing_executable_comes_out(self, raw):
        out = text_ssr._clean_line(raw)
        assert "alert" not in out
        assert not re.search(r"<(?!/?(?:b|strong|i|em|small|br)\b)", out)
        assert " on" not in out.replace("only", "")

    def test_text_that_looks_like_markup_is_escaped(self):
        assert text_ssr._clean_line("a < b & c > d") == "a &lt; b &amp; c &gt; d"

    def test_unbalanced_emphasis_is_closed(self):
        assert text_ssr._clean_line("<b>bold <i>both") == "<b>bold <i>both</i></b>"
        assert text_ssr._clean_line("stray </b> end") == "stray end"

    def test_entities_and_spaces_are_normalised_like_the_client(self):
        assert text_ssr._clean_line("a&nbsp;&nbsp;b&thinsp;c") == "a b c"
        assert text_ssr._clean_line("  many \t spaces  ") == "many spaces"

    def test_breaks_become_spaces(self):
        # As in the client, where whitespace collapsing leaves one newline.
        assert text_ssr._clean_line("one<br>two") == "one two"
        assert text_ssr._clean_line("one<br><br>two") == "one two"

    def test_the_split_divine_name_is_rejoined(self):
        assert text_ssr._clean_line("the G OD of the L ORD") == "the GOD of the LORD"

    def test_an_empty_side_has_no_plain_text(self):
        assert text_ssr._plain_text('<sup>1</sup><i class="footnote">n</i> <br> ') == ""


class TestRows:
    def test_a_verse_with_both_languages_is_a_side_by_side_row(self):
        html = text_ssr.render_rows([{"he": "עברית", "en": "English", "segment": "7"}])
        assert 'class="source-grid segment-row reader-text-row reader-side-row grid grid-cols-1 lg:grid-cols-2' in html
        assert 'data-segment="7"' in html
        assert '<span class="segment-label reader-row-mid-label">7</span>' in html
        assert '<div class="source-he reader-text-he' in html and 'dir="rtl"><p>עברית</p>' in html
        assert 'dir="ltr"><p>English</p>' in html
        assert html.index("source-he") < html.index("source-en")

    def test_one_language_is_a_single_column_row(self):
        he_only = text_ssr.render_rows([{"he": "עברית", "en": "", "segment": "1"}])
        en_only = text_ssr.render_rows([{"he": "", "en": "English", "segment": "1"}])
        assert "reader-single-row" in he_only and "source-en" not in he_only
        assert "reader-single-row" in en_only and "source-he" not in en_only
        assert 'dir="rtl"><p>עברית</p>' in he_only and 'dir="ltr"><p>English</p>' in en_only

    @pytest.mark.parametrize("segment, index, label", [
        ("12", 0, "12"), ("3.7", 0, "7"), ("", 4, "5"), (None, 0, "1"), ("a", 2, "3"), ("2a", 0, "2"),
    ])
    def test_segment_labels_follow_the_client(self, segment, index, label):
        assert text_ssr._segment_label(segment, index) == label

    def test_the_segment_attribute_is_escaped(self):
        html = text_ssr.render_rows([{"he": "x", "en": "y", "segment": '"><script>alert(1)</script>'}])
        assert "<script" not in html


class TestTextPage:
    def test_the_body_carries_the_hebrew_and_the_english(self, test_client, serve_text):
        serve_text(_payload())
        response = test_client.get("/text/Genesis.1")
        html = response.get_data(as_text=True)
        assert response.status_code == 200
        for verse in (HE_1[2:], HE_2, EN_1, EN_2, "English only", "עברית בלבד"):
            assert verse in html
        rows = html.split('id="readerSources"', 1)[1].split('id="ssrTextPayload"', 1)[0]
        assert "a note" not in rows and "footnote" not in rows
        assert re.search(r'<h1 id="readerTitle"[^>]*>Genesis 1 · Parashat Bereshit</h1>', html)

    def test_the_text_is_in_the_reader_not_behind_the_home_grid(self, test_client, serve_text):
        serve_text(_payload())
        html = test_client.get("/text/Genesis.1").get_data(as_text=True)
        assert re.search(r'<div id="homeGrid" style="display: none"', html)
        assert re.search(r'<article id="reader" class="w-full ', html)
        assert html.index('id="readerSources"') < html.index("בלבד") < html.index('id="ssrTextPayload"')

    def test_head_values_are_the_same_as_without_the_render(self, test_client, monkeypatch, serve_text):
        plain = _plain_shell(test_client, monkeypatch, "/text/Genesis.1")
        serve_text(_payload())
        rendered = test_client.get("/text/Genesis.1").get_data(as_text=True)

        def head_meta(html):
            head = html.split("</head>", 1)[0]
            return {
                "title": re.search(r"<title>(.*?)</title>", head).group(1),
                "description": re.search(r'<meta name="description" content="([^"]*)"', head).group(1),
                "canonical": re.findall(r'<link rel="canonical" href="([^"]*)"', head),
                "og": re.findall(r'<meta property="og:[a-z:]+" content="[^"]*"', head),
            }

        assert head_meta(rendered) == head_meta(plain)
        assert head_meta(rendered)["canonical"] == ["https://shelah.org/text/Genesis.1"]

    def test_only_the_chapter_differs_from_the_plain_shell(self, test_client, monkeypatch, serve_text):
        plain = _plain_shell(test_client, monkeypatch, "/text/Genesis.1")
        serve_text(_payload())
        rendered = test_client.get("/text/Genesis.1").get_data(as_text=True)

        def body(html):
            return _squash(html.split("</head>", 1)[1])

        stripped = body(rendered)
        stripped = stripped.replace('<div id="homeGrid" style="display: none"', '<div id="homeGrid"')
        stripped = stripped.replace('<article id="reader" class="w-full', '<article id="reader" class="hidden w-full')
        stripped = re.sub(r'(<h1 id="readerTitle"[^>]*>)[^<]*(</h1>)', r"\1\2", stripped)
        stripped = re.sub(r'(<div id="readerSources"[^>]*>).*?(</div>\s*</div>)\s*<script type="application/json" id="ssrTextPayload">.*?</script>',
                          r"\1</div>", stripped)
        assert stripped == body(plain)

    def test_the_payload_is_embedded_for_the_client_to_adopt(self, test_client, serve_text):
        serve_text(_payload())
        html = test_client.get("/text/Genesis.1").get_data(as_text=True)
        raw = re.search(r'<script type="application/json" id="ssrTextPayload">(.*?)</script>', html, re.S).group(1)
        embedded = json.loads(raw)
        assert embedded["requestedRef"] == "Genesis 1"
        assert embedded["payload"]["ref"] == "Genesis 1"
        assert [line["segment"] for line in embedded["payload"]["lines"]] == ["1", "2", "3", "4"]
        assert embedded["payload"]["next"] == "Genesis 2"
        assert "he" not in embedded["payload"] and "en" not in embedded["payload"]

    def test_an_alternate_spelling_asks_for_the_same_ref_as_the_api(self, test_client, serve_text):
        asked = serve_text(_payload())
        test_client.get("/text/Genesis+1")
        test_client.get("/text/Genesis.1/chat/new/ashkenaz/sources/mini")
        assert asked == ["Genesis 1", "Genesis 1"]

    def test_markup_in_the_text_cannot_leave_its_script_block_or_the_rows(self, test_client, serve_text):
        hostile = "</script><script>alert(1)</script><img src=x onerror=alert(2)>"
        serve_text(_payload(lines=[{"he": f"עברית{hostile}", "en": f"English{hostile}", "segment": "1"}]))
        html = test_client.get("/text/Genesis.1").get_data(as_text=True)
        body = html.split("</head>", 1)[1]
        assert "<script>alert" not in body and "<img src=x" not in body
        raw = re.search(r'id="ssrTextPayload">(.*?)</script>', body, re.S).group(1)
        assert json.loads(raw)["payload"]["lines"][0]["en"].endswith(hostile)

    def test_the_content_security_policy_is_unchanged(self, test_client, monkeypatch, serve_text):
        def script_src(response):
            policy = response.headers["Content-Security-Policy"]
            return sorted(re.findall(r"'sha256-[^']+'", re.search(r"script-src [^;]*", policy).group(0)))

        with monkeypatch.context() as patch:
            patch.setenv("TEXT_SSR_ENABLED", "0")
            plain = test_client.get("/text/Genesis.1")
        serve_text(_payload())
        assert script_src(test_client.get("/text/Genesis.1")) == script_src(plain)

    def test_it_is_indexable_and_cached_like_any_page(self, test_client, serve_text):
        serve_text(_payload())
        response = test_client.get("/text/Genesis.1")
        assert "X-Robots-Tag" not in response.headers
        assert response.headers["Cache-Control"] == "public, max-age=300, must-revalidate"

    def test_the_page_gets_its_own_structured_data(self, test_client, serve_text):
        serve_text(_payload())
        html = test_client.get("/text/Genesis.1").get_data(as_text=True)
        blocks = [json.loads(raw) for raw in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)]
        by_type = {block["@type"]: block for block in blocks}
        crumbs = by_type["BreadcrumbList"]["itemListElement"]
        assert [(c["position"], c["name"], c["item"]) for c in crumbs] == [
            (1, "Sh'elah", "https://shelah.org/"),
            (2, "Tanakh", "https://shelah.org/tanakh"),
            (3, "Genesis 1", "https://shelah.org/text/Genesis.1"),
        ]
        article = by_type["Article"]
        assert article["headline"] == "Genesis 1"
        assert article["url"] == article["mainEntityOfPage"] == "https://shelah.org/text/Genesis.1"
        assert {"WebApplication", "WebSite", "Organization"} <= set(by_type)
        # The shell's static one-item breadcrumb is replaced, not repeated.
        assert sum(1 for block in blocks if block["@type"] == "BreadcrumbList") == 1

    def test_a_non_tanakh_text_has_no_hub_step(self, test_client, serve_text):
        serve_text(_payload(ref="Berakhot 2a", title="Berakhot 2a", categories=["Talmud", "Bavli"]))
        html = test_client.get("/text/Berakhot.2a").get_data(as_text=True)
        crumbs = [json.loads(raw) for raw in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)]
        names = [c["name"] for block in crumbs if block["@type"] == "BreadcrumbList" for c in block["itemListElement"]]
        assert names == ["Sh'elah", "Berakhot 2a"]

    def test_other_pages_keep_the_static_breadcrumb(self, test_client):
        html = test_client.get("/").get_data(as_text=True)
        assert "Sh'elah Synthesis" in html.split("</head>", 1)[0]


class TestFallbacks:
    def test_a_book_on_its_own_is_the_plain_shell_and_asks_nobody(self, test_client, serve_text):
        asked = serve_text(_payload())
        html = test_client.get("/text/Genesis").get_data(as_text=True)
        assert asked == []
        assert 'id="ssrTextPayload"' not in html and '<div id="homeGrid" style' not in html

    def test_a_disabled_render_asks_nobody(self, test_client, monkeypatch, serve_text):
        asked = serve_text(_payload())
        monkeypatch.setenv("TEXT_SSR_ENABLED", "0")
        assert 'id="ssrTextPayload"' not in test_client.get("/text/Genesis.1").get_data(as_text=True)
        assert asked == []

    def test_a_slow_sefaria_gets_the_plain_shell_with_a_short_cache(self, test_client, monkeypatch, serve_text):
        monkeypatch.setattr(text_ssr, "SSR_TIMEOUT_SECONDS", 0.05)

        def slow(_ref):
            time.sleep(0.4)
            return _payload()

        serve_text(behavior=slow)
        started = time.monotonic()
        response = test_client.get("/text/Genesis.1")
        assert time.monotonic() - started < 0.3
        html = response.get_data(as_text=True)
        assert response.status_code == 200
        assert 'id="ssrTextPayload"' not in html and HE_2 not in html
        assert response.headers["Cache-Control"] == text_ssr.FALLBACK_CACHE_CONTROL
        assert "X-Robots-Tag" not in response.headers

    def test_a_failing_lookup_gets_the_plain_shell(self, test_client, serve_text):
        def boom(_ref):
            raise RuntimeError("upstream is down")

        serve_text(behavior=boom)
        response = test_client.get("/text/Genesis.1")
        assert response.status_code == 200
        assert 'id="ssrTextPayload"' not in response.get_data(as_text=True)
        assert response.headers["Cache-Control"] == text_ssr.FALLBACK_CACHE_CONTROL

    @pytest.mark.parametrize("payload", [
        {"error": "Sefaria is blocking the request", "error_type": "sefaria_blocked"},
        _payload(lines=[]),
        _payload(lines=[{"he": "", "en": "", "segment": "1"}]),
        None,
    ])
    def test_an_unusable_payload_gets_the_plain_shell(self, test_client, serve_text, payload):
        serve_text(payload)
        response = test_client.get("/text/Genesis.1")
        assert response.status_code == 200
        assert 'id="ssrTextPayload"' not in response.get_data(as_text=True)

    def test_a_range_too_long_to_be_a_page_gets_the_plain_shell(self, test_client, serve_text):
        lines = [{"he": f"ע{i}", "en": f"e{i}", "segment": str(i)} for i in range(text_ssr.MAX_SSR_LINES + 1)]
        serve_text(_payload(lines=lines))
        assert 'id="ssrTextPayload"' not in test_client.get("/text/Genesis.1-50").get_data(as_text=True)

    def test_a_text_sefaria_does_not_have_is_a_404_that_stays_out_of_search(self, test_client, serve_text):
        def not_found(ref):
            sefaria_library._missing_text_refs.set(sefaria_library._normalize_requested_ref(ref).lower(), True)
            return {"error": "Text not found", "error_type": "not_found"}

        serve_text(behavior=not_found)
        response = test_client.get("/text/Genesis.99")
        assert response.status_code == 404
        assert response.headers["X-Robots-Tag"] == "noindex, nofollow"
        assert 'rel="canonical"' not in response.get_data(as_text=True).split("</head>", 1)[0]

    def test_a_known_missing_text_is_not_asked_for_again(self, test_client, serve_text):
        asked = serve_text(_payload())
        sefaria_library._missing_text_refs.set("genesis 99", True)
        assert test_client.get("/text/Genesis.99").status_code == 404
        assert asked == []

    def test_a_transient_failure_is_not_remembered_as_missing(self, test_client, serve_text):
        serve_text({"error": "Text not found", "error_type": "network"})
        assert test_client.get("/text/Genesis.1").status_code == 200
        assert not sefaria_library.is_known_missing_text("Genesis 1")


class TestPageMetaHelpers:
    @pytest.mark.parametrize("ref, expected", [
        ("Genesis 1", True), ("Berakhot 2a", True), ("Shulchan Arukh, Orach Chayim 345:1", True),
        ("Genesis 1:1-3", True), ("Genesis", False), ("", False), ("Mishneh Torah, Shabbat", False),
    ])
    def test_ref_has_sections(self, ref, expected):
        assert page_meta.ref_has_sections(ref) is expected


class TestHeading:
    @pytest.mark.parametrize("payload, expected", [
        ({"title": "Genesis 1", "heTitle": "בראשית", "ref": "Genesis 1"}, "Genesis 1 · Parashat Bereshit"),
        ({"title": "Numbers 4", "heTitle": "במדבר", "ref": "Numbers 4"}, "Numbers 4 · Parashot Bamidbar–Naso"),
        ({"title": "Isaiah 1", "heTitle": "ישעיהו", "ref": "Isaiah 1"}, "Isaiah 1 · ישעיהו"),
        ({"title": "Berakhot 2a", "heTitle": "ברכות", "ref": "Berakhot 2a"}, "Berakhot 2a · ברכות"),
        ({"title": "Genesis 1", "heTitle": "", "ref": "Isaiah 1"}, "Genesis 1"),
        ({"title": "Same", "heTitle": "Same", "ref": "Isaiah 1"}, "Same"),
        ({"ref": "Isaiah 1"}, "Isaiah 1"),
    ])
    def test_it_is_the_title_the_app_sets_on_boot(self, payload, expected):
        assert text_ssr.header_title(payload, payload.get("ref", "")) == expected

    def test_the_page_opens_with_it(self, test_client, serve_text):
        serve_text(_payload())
        html = test_client.get("/text/Genesis.1").get_data(as_text=True)
        assert re.search(r'<h1 id="readerTitle"[^>]*>Genesis 1 · Parashat Bereshit</h1>', html)
