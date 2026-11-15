"""The site's interface text, one catalog per language.

``locales/meta.json`` lists the languages (code, own name, direction, which
language fills its gaps, whether it is switched on). Each language has a
folder of JSON files, ``locales/<code>/<namespace>.json``, holding flat
``"key": "text"`` pairs; a string's full key is ``<namespace>.<key>``
("notfound.title"). A namespace per page or area keeps edits to one page
out of every other page's file.

Everything is read once, at import, so a request never touches the disk.

Templates get three helpers (see ``register``):

* ``_('ns.key', name=...)``: the text in the language the page is rendered
  in (English for now; the browser swaps to Hebrew), with ``{name}``
  placeholders filled.
* ``lang_attrs('ns.key')``: the ``data-en="..." data-he="..."`` pair the
  existing client-side switch (static/js/topbar_shared.js) reads, so pages
  moved onto catalogs behave exactly as before.
* ``locales``: the switched-on languages, for a language menu.
* ``i18n_client_catalog()``: the text the browser scripts look up
  (static/js/i18n.js), written into the page as a JSON data block.

Namespaces listed under ``client_namespaces`` in meta.json belong to the
browser scripts; only those are sent to the page.

A key whose English meaning changes gets a new key, so every other language
is forced to be looked at again; typo fixes keep the key.

A key missing from every language raises outside production, so a gap shows
up in development and tests; in production it logs and renders nothing.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from markupsafe import Markup, escape

logger = logging.getLogger(__name__)

LOCALES_DIR = Path(__file__).resolve().parent.parent / "locales"

_PLACEHOLDER = re.compile(r"\{(\w+)\}")


@dataclass(frozen=True)
class Locale:
    code: str
    name: str
    dir: str
    script: str
    fallback: str | None
    enabled: bool


@dataclass(frozen=True)
class Catalogs:
    default: str
    locales: Mapping[str, Locale]
    strings: Mapping[str, Mapping[str, str]]
    strict: bool = True
    client_namespaces: tuple[str, ...] = ()

    @property
    def enabled(self) -> tuple[str, ...]:
        return tuple(code for code, loc in self.locales.items() if loc.enabled)

    def normalize(self, value: Any) -> str:
        """A switched-on language code for ``value`` ("he-IL" -> "he"),
        else the default."""
        code = str(value or "").strip().lower().replace("_", "-").split("-")[0]
        return code if code in self.enabled else self.default

    def direction(self, code: str) -> str:
        return self.locales[self.normalize(code)].dir

    def chain(self, code: str) -> tuple[str, ...]:
        """The languages to look in, in order: ``code``, its fallbacks, then
        the default."""
        order: list[str] = []
        current: str | None = code if code in self.locales else self.default
        while current and current not in order:
            order.append(current)
            current = self.locales[current].fallback
        if self.default not in order:
            order.append(self.default)
        return tuple(order)

    def lookup(self, code: str, key: str) -> str | None:
        """``key``'s own text in ``code`` only, with no fallback."""
        return self.strings.get(code, {}).get(key)

    def translate(self, code: str, key: str, **values: Any) -> str:
        for lang in self.chain(code):
            text = self.lookup(lang, key)
            if text is not None:
                return _fill(text, values)
        if self.strict:
            raise KeyError(f"no text for {key!r} in any language")
        logger.error("i18n_missing_key", extra={"key": key, "locale": code})
        return ""

    def client_catalog(self) -> dict[str, Any]:
        """What static/js/i18n.js needs: the switched-on languages and their
        client-namespace strings."""
        prefixes = tuple(f"{ns}." for ns in self.client_namespaces)
        return {
            "default": self.default,
            "strict": self.strict,
            "locales": [
                {"code": code, "name": self.locales[code].name,
                 "dir": self.locales[code].dir, "fallback": self.locales[code].fallback}
                for code in self.enabled
            ],
            "strings": {
                code: {k: v for k, v in self.strings.get(code, {}).items() if k.startswith(prefixes)}
                for code in self.enabled
            },
        }


def _fill(text: str, values: Mapping[str, Any]) -> str:
    if not values:
        return text
    return _PLACEHOLDER.sub(lambda m: str(values.get(m.group(1), m.group(0))), text)


def _is_production() -> bool:
    return (
        os.environ.get("VERCEL") == "1"
        or os.environ.get("FLASK_ENV", "").strip().lower() == "production"
    )


def load(directory: Path = LOCALES_DIR, strict: bool | None = None) -> Catalogs:
    meta = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
    locales = {
        entry["code"]: Locale(
            code=entry["code"],
            name=entry["name"],
            dir=entry.get("dir", "ltr"),
            script=entry["script"],
            fallback=entry.get("fallback"),
            enabled=bool(entry.get("enabled", True)),
        )
        for entry in meta["locales"]
    }
    strings: dict[str, dict[str, str]] = {}
    for code in locales:
        table: dict[str, str] = {}
        folder = directory / code
        for path in sorted(folder.glob("*.json")) if folder.is_dir() else ():
            namespace = path.stem
            for key, text in json.loads(path.read_text(encoding="utf-8")).items():
                table[f"{namespace}.{key}"] = text
        strings[code] = table
    return Catalogs(
        default=meta.get("default", "en"),
        locales=locales,
        strings=strings,
        strict=(not _is_production()) if strict is None else strict,
        client_namespaces=tuple(meta.get("client_namespaces", ())),
    )


CATALOGS = load()
_CLIENT_CATALOG = CATALOGS.client_catalog()


def translate(code: str, key: str, **values: Any) -> str:
    return CATALOGS.translate(code, key, **values)


def lang_attrs(key: str, **values: Any) -> Markup:
    """``data-en="..." data-he="..."`` for the client-side language switch."""
    pair = Markup('data-{}="{}"')
    return Markup(" ").join(
        pair.format(code, translate(code, key, **values))
        for code in ("en", "he") if code in CATALOGS.enabled
    )


def register(app: Any) -> None:
    """Expose the template helpers on a Flask app's Jinja environment."""

    def page_text(key: str, **values: Any) -> Markup:
        # Pages render in English and the browser swaps the language
        # (static/js/topbar_shared.js); a per-request language comes later.
        return escape(translate(CATALOGS.default, key, **values))

    app.jinja_env.globals.update(
        _=page_text,
        lang_attrs=lang_attrs,
        i18n_client_catalog=lambda: _CLIENT_CATALOG,
        locales=[CATALOGS.locales[code] for code in CATALOGS.enabled],
    )
