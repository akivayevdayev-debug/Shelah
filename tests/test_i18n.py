"""The interface-text catalogs (locales/) and their template helpers."""

import json
import re
import unicodedata
from pathlib import Path

import pytest

from backend import i18n

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_KEY = re.compile(r"""(?:\b_|lang_attrs)\(\s*['"]([\w.]+)['"]""")
PLACEHOLDER = re.compile(r"\{(\w+)\}")


def _template_keys():
    keys = set()
    for path in (ROOT / "templates").rglob("*.html"):
        if " 2." in path.name:
            continue
        keys.update(TEMPLATE_KEY.findall(path.read_text(encoding="utf-8")))
    return keys


@pytest.fixture
def three_languages(tmp_path):
    """en, he and a switched-off ru that falls back to English."""
    (tmp_path / "meta.json").write_text(json.dumps({
        "default": "en",
        "locales": [
            {"code": "en", "name": "English", "dir": "ltr", "script": "Latin", "fallback": None},
            {"code": "he", "name": "עברית", "dir": "rtl", "script": "Hebrew", "fallback": "en"},
            {"code": "ru", "name": "Русский", "dir": "ltr", "script": "Cyrillic", "fallback": "en",
             "enabled": False},
        ],
    }), encoding="utf-8")
    for code, strings in {
        "en": {"hello": "Hello, {name}", "only_en": "English only"},
        "he": {"hello": "שלום, {name}"},
        "ru": {"hello": "Привет, {name}"},
    }.items():
        (tmp_path / code).mkdir()
        (tmp_path / code / "page.json").write_text(json.dumps(strings), encoding="utf-8")
    return tmp_path


@pytest.fixture
def strict_catalogs(three_languages):
    return i18n.load(three_languages, strict=True)


@pytest.fixture
def production_catalogs(three_languages):
    return i18n.load(three_languages, strict=False)


def _share_in_script(text, script):
    """The share of ``text``'s letters that belong to ``script``, ignoring
    placeholders and the names kept in every language."""
    text = PLACEHOLDER.sub("", text)
    for name in KEPT_NAMES:
        text = text.replace(name, "")
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return 1.0
    return sum(script.upper() in unicodedata.name(ch, "") for ch in letters) / len(letters)


META = json.loads((ROOT / "locales" / "meta.json").read_text(encoding="utf-8"))
# Written the same in every language (locales/meta.json), so they don't count
# against the script check. Longest first, so "Google Fonts" goes before "Google".
KEPT_NAMES = sorted(META["keep_names"], key=len, reverse=True)
SCRIPT_EXEMPT = set(META["script_exempt"])


def test_every_english_string_has_a_hebrew_one():
    strings = i18n.CATALOGS.strings
    assert sorted(set(strings["en"]) - set(strings["he"])) == []


def test_no_hebrew_string_lacks_an_english_source():
    strings = i18n.CATALOGS.strings
    assert sorted(set(strings["he"]) - set(strings["en"])) == []


def test_every_key_a_template_uses_is_in_the_english_catalog():
    assert sorted(_template_keys() - set(i18n.CATALOGS.strings["en"])) == []


def test_translations_keep_the_english_placeholders():
    strings = i18n.CATALOGS.strings
    mismatched = [
        key for key, text in strings["he"].items()
        if set(PLACEHOLDER.findall(text)) != set(PLACEHOLDER.findall(strings["en"].get(key, "")))
    ]
    assert mismatched == []


def test_no_string_is_empty():
    empty = [
        f"{code}:{key}" for code, table in i18n.CATALOGS.strings.items()
        for key, text in table.items() if not text.strip()
    ]
    assert empty == []


def test_every_string_is_written_in_its_languages_script():
    wrong = [
        f"{code}:{key}" for code, table in i18n.CATALOGS.strings.items()
        for key, text in table.items()
        if key not in SCRIPT_EXEMPT
        and _share_in_script(text, i18n.CATALOGS.locales[code].script) < 0.5
    ]
    assert wrong == []


def test_the_script_check_catches_untranslated_hebrew():
    assert _share_in_script("Page Not Found", "Hebrew") < 0.5


def test_a_regional_code_maps_to_its_language():
    assert i18n.CATALOGS.normalize("he-IL") == "he"


def test_an_unknown_language_maps_to_english():
    assert i18n.CATALOGS.normalize("xx") == "en"


def test_hebrew_reads_right_to_left():
    assert i18n.CATALOGS.direction("he") == "rtl"


def test_placeholders_are_filled(strict_catalogs):
    assert strict_catalogs.translate("he", "page.hello", name="דוד") == "שלום, דוד"


def test_a_missing_string_falls_back_to_english(strict_catalogs):
    assert strict_catalogs.translate("he", "page.only_en") == "English only"


def test_an_unknown_key_raises_outside_production(strict_catalogs):
    with pytest.raises(KeyError):
        strict_catalogs.translate("en", "page.nope")


def test_an_unknown_key_renders_nothing_in_production(production_catalogs):
    assert production_catalogs.translate("en", "page.nope") == ""


def test_a_switched_off_language_is_not_offered(strict_catalogs):
    assert strict_catalogs.enabled == ("en", "he")


def test_a_switched_off_language_normalizes_to_the_default(strict_catalogs):
    assert strict_catalogs.normalize("ru") == "en"


def test_lang_attrs_escapes_the_text():
    assert "Sh&#39;elah" in str(i18n.lang_attrs("common.back_to_shelah"))


def test_the_404_page_carries_its_hebrew_text_for_the_switch():
    import app as flask_app

    body = flask_app.app.test_client().get("/__no_such_page__").get_data(as_text=True)
    assert 'data-he="העמוד לא נמצא"' in body
