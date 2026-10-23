"""backend/text_trust.py: which Sefaria versions and works a reader may see,
and which version each community gets by default. Checked against real
Sefaria version lists (tests/fixtures/sefaria_versions.json)."""

import json
from pathlib import Path

import pytest

from backend import text_trust

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "sefaria_versions.json").read_text(encoding="utf-8"))
BOOKS = FIXTURE["books"]


def versions_of(book):
    return BOOKS[book]["versions"]


def chosen_titles(book, community="sephardi"):
    chosen = text_trust.choose_versions(versions_of(book), community)
    return {lang: str((v or {}).get("versionTitle") or "").strip() or None
            for lang, v in chosen.items()}


def test_sephardi_torah_defaults_to_aleppo_codex_and_koren():
    assert chosen_titles("Genesis") == {
        "he": "Miqra according to the Masorah",
        "en": "The Koren Jerusalem Bible",
    }


# The brief: the mapping covers the default versions for Torah, Prophets,
# Writings, Mishnah, Talmud, Shulchan Aruch and Mishneh Torah.
@pytest.mark.parametrize("book, he, en", [
    ("Genesis", "Miqra according to the Masorah", "The Koren Jerusalem Bible"),
    ("Isaiah", "Miqra according to the Masorah", "The Koren Jerusalem Bible"),
    ("Psalms", "Miqra according to the Masorah", "The Koren Jerusalem Bible"),
    ("Esther", "Miqra according to the Masorah", "The Koren Jerusalem Bible"),
    ("Mishnah Berakhot", "Torat Emet 357", "William Davidson Edition - English"),
    ("Berakhot", "William Davidson Edition - Vocalized Aramaic", "William Davidson Edition - English"),
    ("Jerusalem Talmud Berakhot",
     "The Jerusalem Talmud, edition by Heinrich W. Guggenheimer. Berlin, De Gruyter, 1999-2015",
     "The Jerusalem Talmud, translation and commentary by Heinrich W. Guggenheimer. Berlin, De Gruyter, 1999-2015"),
    # Feldheim's Orthodox text outranks the volunteer translation.
    ("Shulchan Arukh, Orach Chayim", "Torat Emet 363", "Mishnah Berurah"),
    # Neutral Orthodox (Hyamson) before Chabad (Touger) for a Sephardi reader.
    ("Mishneh Torah, Prayer and the Priestly Blessing", "Torat Emet 370",
     "Based on trans. by Moses Hyamson, 1937-1949"),
    ("Rashi on Genesis", "On Your Way",
     "Pentateuch with Rashi's commentary by M. Rosenbaum and A.M. Silbermann, 1929-1934"),
    ("Siddur Edot HaMizrach", "Shaliehsaboo Edition", "Shaliehsaboo Edition"),
])
def test_sephardi_defaults_per_category(book, he, en):
    assert chosen_titles(book) == {"he": he, "en": en}


def test_ashkenazi_reader_gets_ashkenazi_orthodox_english():
    assert chosen_titles("Genesis", "ashkenazi")["en"] == "Metsudah Chumash, Metsudah Publications, 2009"
    assert chosen_titles("Kitzur Shulchan Arukh", "ashkenazi")["en"] == (
        "Kitzur Shulchan Aruch, trans. Rabbi Avrohom Davis, Metsudah Pub., 1996")


@pytest.mark.parametrize("book", sorted(BOOKS))
def test_every_default_is_a_reviewed_version(book):
    for lang, version in text_trust.choose_versions(versions_of(book), "sephardi").items():
        if version is None:
            continue
        verdict = text_trust.assess_version(version)
        assert verdict["trust"] in (text_trust.PREFERRED, text_trust.LISTED), (book, lang)
        assert verdict["label"] != text_trust.UNLABELLED, (book, lang)


DENIED_EXAMPLES = (
    "THE JPS TANAKH: Gender-Sensitive Edition",
    "The Contemporary Torah, Jewish Publication Society, 2006",
    "The Five Books of Moses, by Everett Fox. New York, Schocken Books, 1995",
    "Mishnah Yomit by Dr. Joshua Kulp",
    "Hilkhot Yom ha-Kippurim, trans. by Jan M. Brahms. HUC, 1976",
    "Translation v.1",
    "Emoji Megillah",
)


@pytest.mark.parametrize("book", sorted(BOOKS))
def test_picker_lists_only_reviewed_versions(book):
    rows = text_trust.picker_versions(versions_of(book), "sephardi")
    assert rows, book
    for row in rows:
        assert row["label"], row
        assert row["label"] != text_trust.UNLABELLED, row
        assert row["title"] not in DENIED_EXAMPLES, row
        assert 1 <= len(row["label"].split()) <= 4, row


def test_picker_drops_other_languages_filed_as_english():
    titles = {r["title"] for r in text_trust.picker_versions(versions_of("Genesis"))}
    assert "Tora ve Aftara [tr]" not in titles
    assert "Yehoyesh's Yiddish Tanakh Translation [yi]" not in titles
    assert "The Koren Jerusalem Bible" in titles


@pytest.mark.parametrize("title", DENIED_EXAMPLES)
def test_a_denied_version_is_never_chosen_even_when_requested(title):
    version = {"versionTitle": title, "language": "en", "actualLanguage": "en"}
    chosen = text_trust.choose_versions([version], "sephardi", requested={"en": title})
    assert chosen["en"] is None


def test_a_reader_pick_wins_when_it_is_listed():
    chosen = text_trust.choose_versions(
        versions_of("Genesis"), "sephardi",
        requested={"en": "Tanakh: The Holy Scriptures, published by JPS"})
    assert chosen["en"]["versionTitle"] == "Tanakh: The Holy Scriptures, published by JPS"


def test_listed_never_beats_preferred_by_default():
    # JPS 1985 is listed (picker only): Koren stays the default.
    assert chosen_titles("Genesis")["en"] == "The Koren Jerusalem Bible"


def test_unknown_english_is_dropped_not_defaulted():
    unknown = {"versionTitle": "Someone's Translation", "language": "en", "actualLanguage": "en"}
    assert text_trust.assess_version(unknown)["trust"] == text_trust.UNKNOWN
    assert text_trust.choose_versions([unknown], "sephardi")["en"] is None
    assert text_trust.picker_versions([unknown]) == []


def test_original_hebrew_of_an_allowed_work_is_kept():
    source = {"versionTitle": "Some Printing", "language": "he", "actualLanguage": "he", "isSource": True}
    assert text_trust.choose_versions([source], "sephardi")["he"] is source
    assert text_trust.picker_versions([source])[0]["label"] == text_trust.ORIGINAL_TEXT


def test_movement_publisher_domain_is_denied_even_for_unknown_titles():
    version = {"versionTitle": "A New Translation", "language": "en", "actualLanguage": "en",
               "versionSource": "https://www.rabbinicalassembly.org/sites/x.pdf"}
    assert text_trust.assess_version(version)["trust"] == text_trust.DENIED


@pytest.mark.parametrize("title", [
    "The Torah; A Women's Commentary",
    "The Torah; A Women's Commentary, Genesis 1:1",
    "English Explanation of Mishnah Berakhot 1:1",
    "Daf Shevui to Sukkah 2a",
    "Rereading the Rabbis",
    "Dirshuni II",
])
def test_denied_works(title):
    assert text_trust.is_work_denied(title)


@pytest.mark.parametrize("title", [
    "Genesis 1:1", "Rashi on Genesis 1:1", "Berakhot 2a", "Mishneh Torah, Prayer 1:1",
    "Steinsaltz on Berakhot 2a", "Torah of the Mothers", "Peninei Halakhah, Women's Prayer",
    "Covenant and Conversation; Deuteronomy; Renewal of the Sinai Covenant", "",
])
def test_allowed_works(title):
    assert not text_trust.is_work_denied(title)


def test_every_mapping_entry_has_a_reason_and_valid_fields():
    for entry in text_trust.mapping_entries():
        assert entry["reason"].strip(), entry
        assert entry["lang"] in ("he", "en"), entry
        assert entry["trust"] in (text_trust.PREFERRED, text_trust.LISTED, text_trust.DENIED), entry
        if entry["trust"] != text_trust.DENIED:
            assert entry["community"] in ("sephardi", "mizrahi", "ashkenazi", "chabad", "general"), entry
            assert entry["label"], entry
    for work in text_trust.DENIED_WORKS:
        assert work["reason"].strip(), work
        assert work["match"] in ("exact", "prefix"), work


# ─── get_text: the fetch layer applies the policy ────────────────────────────

import re  # noqa: E402

import responses as responses_lib  # noqa: E402

import backend.sefaria_library as sl  # noqa: E402

GENESIS_AVAILABLE = versions_of("Genesis")
MASORAH = {"versionTitle": "Miqra according to the Masorah", "language": "he",
           "actualLanguage": "he", "isSource": True, "text": ["בְּרֵאשִׁ֖ית"]}
GENDER_SENSITIVE = {"versionTitle": "THE JPS TANAKH: Gender-Sensitive Edition", "language": "en",
                    "actualLanguage": "en", "text": ["When God began to create"]}
KOREN = {"versionTitle": "The Koren Jerusalem Bible", "language": "en",
         "actualLanguage": "en", "text": ["In the beginning God created"]}
METSUDAH = {"versionTitle": "Metsudah Chumash, Metsudah Publications, 2009", "language": "en",
            "actualLanguage": "en", "text": ["In the beginning of God's creation"]}


def _v3_payload(*versions):
    return {"ref": "Genesis 1:1", "indexTitle": "Genesis", "title": "Genesis 1",
            "versions": list(versions), "available_versions": GENESIS_AVAILABLE}


@pytest.fixture
def sefaria():
    sl._cache.clear()
    sl._resolved_query_ref_cache.clear()
    with responses_lib.RequestsMock(assert_all_requests_are_fired=False) as rsps:
        yield rsps
    sl._cache.clear()


def _mock_v3(rsps, query_pattern, payload):
    rsps.add(responses_lib.GET,
             re.compile(re.escape(sl.SEFARIA_V3_API) + r"/texts/[^?]*\?" + query_pattern),
             json=payload, status=200)


def test_get_text_swaps_sefarias_gender_sensitive_default_for_koren(sefaria):
    _mock_v3(sefaria, r"version=source", _v3_payload(MASORAH, GENDER_SENSITIVE))
    _mock_v3(sefaria, r".*Koren", _v3_payload(MASORAH, KOREN))
    result = sl.get_text("Genesis 1:1")
    assert result["en"] == ["In the beginning God created"]
    assert result["versions"]["en"] == {"title": "The Koren Jerusalem Bible", "label": "Orthodox (Koren)"}
    assert result["versions"]["he"]["label"] == "Aleppo Codex (Masorah)"
    listed = {row["title"] for row in result["versions"]["available"]}
    assert "THE JPS TANAKH: Gender-Sensitive Edition" not in listed
    assert "The Koren Jerusalem Bible" in listed


def test_a_second_chapter_asks_for_the_chosen_versions_directly(sefaria):
    _mock_v3(sefaria, r"version=source", _v3_payload(MASORAH, GENDER_SENSITIVE))
    _mock_v3(sefaria, r".*Koren", _v3_payload(MASORAH, KOREN))
    sl.get_text("Genesis 1:1")
    sefaria.calls.reset()
    sl.get_text("Genesis 2")
    urls = [call.request.url for call in sefaria.calls]
    assert len(urls) == 1
    assert "Koren" in urls[0]


def test_ashkenazi_reader_gets_metsudah(sefaria):
    _mock_v3(sefaria, r"version=source", _v3_payload(MASORAH, GENDER_SENSITIVE))
    leningrad = {"versionTitle": "Tanach with Ta'amei Hamikra", "language": "he",
                 "actualLanguage": "he", "isSource": True, "text": ["בְּרֵאשִׁית"]}
    _mock_v3(sefaria, r".*Metsudah", _v3_payload(leningrad, METSUDAH))
    result = sl.get_text("Genesis 1:1", community="ashkenazi")
    assert result["en"] == ["In the beginning of God's creation"]
    assert result["versions"]["he"]["label"] == "Leningrad Codex"


def test_reader_pick_is_honoured(sefaria):
    jps = {"versionTitle": "Tanakh: The Holy Scriptures, published by JPS", "language": "en",
           "actualLanguage": "en", "text": ["When God began"]}
    _mock_v3(sefaria, r"version=source", _v3_payload(MASORAH, GENDER_SENSITIVE))
    _mock_v3(sefaria, r".*Holy%20Scriptures", _v3_payload(MASORAH, jps))
    result = sl.get_text("Genesis 1:1",
                         versions={"en": "Tanakh: The Holy Scriptures, published by JPS"})
    assert result["versions"]["en"]["label"] == "Academic (JPS 1985)"


def test_denied_english_is_dropped_when_no_other_exists(sefaria):
    payload = _v3_payload(MASORAH, GENDER_SENSITIVE)
    payload["available_versions"] = [MASORAH, GENDER_SENSITIVE]
    _mock_v3(sefaria, r"version=source", payload)
    result = sl.get_text("Genesis 1:1")
    assert result["he"] == ["בְּרֵאשִׁ֖ית"]
    assert result["en"] == []
    assert result["versions"]["en"] is None


def test_a_denied_work_never_reaches_the_network(sefaria):
    result = sl.get_text("The Torah; A Women's Commentary, Genesis 1:1")
    assert result["error_type"] == "not_available"
    assert sefaria.calls == [] or len(sefaria.calls) == 0


def test_a_denied_work_found_by_alias_is_still_hidden(sefaria):
    payload = _v3_payload(MASORAH)
    payload["indexTitle"] = "Rereading the Rabbis"
    _mock_v3(sefaria, r"version=source", payload)
    assert sl.get_text("Some Alias 1")["error_type"] == "not_available"


def test_v2_fallback_blanks_a_denied_translation(sefaria):
    sefaria.add(responses_lib.GET, re.compile(re.escape(sl.SEFARIA_V3_API) + r"/.*"),
                json={"error": "nope"}, status=200)
    sefaria.add(responses_lib.GET, re.compile(re.escape(sl.SEFARIA_API) + r"/texts/.*"),
                json={"ref": "Genesis 1:1", "he": ["בְּרֵאשִׁ֖ית"], "text": ["When God began"],
                      "versionTitle": "THE JPS TANAKH: Gender-Sensitive Edition",
                      "heVersionTitle": "Miqra according to the Masorah"}, status=200)
    result = sl.get_text("Genesis 1:1")
    assert result["he"] == ["בְּרֵאשִׁ֖ית"]
    assert result["en"] == []


# Citation forms the denied-source check used to miss.
@pytest.mark.parametrize("citation", [
    "Standing Again at Sinai, p. 40",
    "Reform Judaism responsa",
    "Conservative Yeshiva, Mishnah Berakhot 1",
    "Responsa, see jtsa.edu",
    "https://jtsa.edu./responsa",
])
def test_source_denied_catches_short_and_embedded_forms(citation):
    assert text_trust.is_source_denied(citation)


@pytest.mark.parametrize("citation", [
    "Mishnah Berakhot 1:1",
    "The Torah, Genesis 1",
    "Shulchan Arukh, Orach Chayim 1",
    "chabad.org",
])
def test_source_denied_leaves_classical_refs_alone(citation):
    assert not text_trust.is_source_denied(citation)


def test_short_generic_title_is_not_denied_on_its_own():
    assert not text_trust.is_work_denied("The Torah")
