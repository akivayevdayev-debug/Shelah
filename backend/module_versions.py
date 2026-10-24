"""
Content-hashed URLs for the ES modules under static/js (audit L-10).

There is no bundler to rename a module when it changes: main.js's
``import ... from "./router.js"`` asks for /static/js/router.js before and
after a deploy, so a cache on the way (the browser's, the CDN's, the service
worker's) can hand the new main.js an old router.js. The shell's import map
(templates/index.html) sends each of those imports to
``/static/js/router.js?v=<hash of its bytes>`` instead: a changed module is a
new URL, an unchanged one keeps its cached copy. The entry modules' <script>
tags use the same URLs, so a module that is both an entry and imported still
runs once.

Hashes are keyed by each file's mtime and size, so an edit in development
shows on the next page load without a restart. static/js ships inside the
Vercel function (Flask serves /static), so production hashes the deployed
files.

The stylesheets and classic scripts get the same treatment from ``asset_url``
(a ``?v=<hash of its bytes>`` the templates ask for by file name, in place of
a version string someone had to remember to bump). A URL carrying such a hash
names exactly one set of bytes, so ``is_content_hash`` lets the static-file
cache policy (app.py) call it immutable: cached for a year, never revalidated.

static/min/ (scripts/build_assets.mjs) holds the minified stylesheet bundle, the
minified classic scripts and the bundled module entries. It is committed, and
used only while its manifest still describes the files on disk: edit a
stylesheet or script under static/ and the page goes back to serving the
original until ``npm run build:assets`` runs again, so a stale build can never
ship an old copy of a file. ``SHELAH_SOURCE_ASSETS=1`` forces the originals
(build_critical_css.mjs reads the page that way, and so do the tests that look
at the source files).
"""

import hashlib
import json
import os
import re
from functools import lru_cache
from pathlib import Path

from markupsafe import Markup

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
JS_DIR = STATIC_DIR / "js"
_URL_PREFIX = "/static/js/"
_HASH_LENGTH = 12
_HASH_RE = re.compile(rf"^[0-9a-f]{{{_HASH_LENGTH}}}$")
# A top-level static import or export: classic scripts (window globals,
# module.exports) have neither and aren't in the map.
_ES_MODULE_RE = re.compile(rb"^(?:import|export)\s", re.MULTILINE)
# Real module names only, not an editor backup or an iCloud "main 2.js" copy.
_NAME_RE = re.compile(r"^[\w.-]+\.js$")


@lru_cache(maxsize=256)
def _digest(path, mtime_ns, size):  # noqa: ARG001 -- mtime/size are the cache key
    data = path.read_bytes()
    if not _ES_MODULE_RE.search(data):
        return None
    return hashlib.sha256(data).hexdigest()[:_HASH_LENGTH]


def _module_urls():
    urls = {}
    for path in sorted(JS_DIR.glob("*.js")):
        if not _NAME_RE.match(path.name):
            continue
        try:
            stat = path.stat()
            digest = _digest(path, stat.st_mtime_ns, stat.st_size)
        except OSError:
            continue
        if digest:
            urls[path.name] = f"{_URL_PREFIX}{path.name}?v={digest}"
    return urls


def module_url(name):
    """The versioned URL of one module, for its <script type="module"> tag."""
    manifest = _manifest()
    if manifest and name in manifest["js"]["modules"]["entries"] and _modules_fresh(manifest):
        return asset_url(f"min/js/{name}")
    return _module_urls().get(name) or f"{_URL_PREFIX}{name}"


def import_map():
    """The shell's import map: each module's plain URL to its versioned one.
    Empty while static/min/ is serving the modules: its entries import their
    chunks by content-hashed file names, so there is nothing left to map."""
    manifest = _manifest()
    if manifest and _modules_fresh(manifest):
        return {"imports": {}}
    return {"imports": {f"{_URL_PREFIX}{name}": url for name, url in _module_urls().items()}}


@lru_cache(maxsize=256)
def _file_digest(path, mtime_ns, size):  # noqa: ARG001 -- mtime/size are the cache key
    return hashlib.sha256(path.read_bytes()).hexdigest()[:_HASH_LENGTH]


def asset_url(name):
    """The content-hashed URL of a file under static/ ("css/reader.css",
    "style.css", "js/actions.js"), for a template's <link> or <script src>.
    A name that is not a file there gets its plain URL, so a typo is a 404 in
    the browser rather than a render error."""
    name = _min_name(name)
    plain = f"/static/{name}"
    path = (STATIC_DIR / name).resolve()
    try:
        path.relative_to(STATIC_DIR.resolve())
        stat = path.stat()
        return f"{plain}?v={_file_digest(path, stat.st_mtime_ns, stat.st_size)}"
    except (ValueError, OSError):
        return plain


def is_content_hash(version):
    """True for a ``v`` that is one of this module's hashes (and so names one
    set of bytes), False for a hand-written version string or nothing."""
    return bool(version) and bool(_HASH_RE.match(version))


# An inline element ends at the first "</script" (or "</style") the HTML parser
# sees, so a file that contains one cannot be inlined as it is.
_CLOSE_RE = {
    "script": re.compile(r"</script", re.IGNORECASE),
    "style": re.compile(r"</style", re.IGNORECASE),
}


@lru_cache(maxsize=32)
def _inline_text(path, mtime_ns, size, tag):  # noqa: ARG001 -- mtime/size are the cache key
    text = path.read_text(encoding="utf-8")
    if _CLOSE_RE[tag].search(text):
        raise ValueError(f"{path.name} contains '</{tag}' and cannot be inlined")
    return text


def inline_asset(name, tag="script"):
    """The text of a file under static/ ("js/hebrew-ref.js"), for a template to
    put between ``<script>`` (or, with ``tag="style"``, ``<style>``) tags. For
    the few classic scripts the page's own inline scripts call while the parser
    is still in the head, and for the critical CSS, where an external file would
    cost a blocking request ahead of the first paint. The response's
    Content-Security-Policy admits an inline script by hash (backend/csp.py),
    so this needs nothing beyond being called from a template."""
    name = _min_name(name)
    path = (STATIC_DIR / name).resolve()
    path.relative_to(STATIC_DIR.resolve())
    stat = path.stat()
    # Our own file under static/, checked above for a closing tag.
    return Markup(_inline_text(path, stat.st_mtime_ns, stat.st_size, tag))  # nosec B704


# ── static/min/ (scripts/build_assets.mjs) ──────────────────────────────────


@lru_cache(maxsize=256)
def _full_sha(path, mtime_ns, size):  # noqa: ARG001 -- mtime/size are the cache key
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _source_sha(path):
    """The manifest's spelling of a source file's digest: "sha256:<hex>"."""
    try:
        stat = path.stat()
        return f"sha256:{_full_sha(path, stat.st_mtime_ns, stat.st_size)}"
    except OSError:
        return None


@lru_cache(maxsize=4)
def _read_manifest(path, mtime_ns, size):  # noqa: ARG001 -- mtime/size are the cache key
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("version") == 1 else None


def _manifest():
    """static/min/manifest.json, or None when there is none (or the originals
    are forced, or the file is not one this code reads)."""
    if os.environ.get("SHELAH_SOURCE_ASSETS", "").strip() == "1":
        return None
    path = STATIC_DIR / "min" / "manifest.json"
    try:
        stat = path.stat()
    except OSError:
        return None
    return _read_manifest(path, stat.st_mtime_ns, stat.st_size)


def _min_file_exists(rel):
    return (STATIC_DIR / "min" / rel).is_file()


def _css_fresh(manifest):
    css = manifest["css"]
    return _min_file_exists(css["bundle"]) and all(
        _source_sha(STATIC_DIR / rel) == sha for rel, sha in css["sources"].items()
    )


def _classic_fresh(manifest, name):
    entry = manifest["js"]["classic"].get(name)
    return bool(entry) and _min_file_exists(f"js/{name}") and _source_sha(JS_DIR / name) == entry["source"]


def _modules_fresh(manifest):
    modules = manifest["js"]["modules"]
    return all(_min_file_exists(rel) for rel in modules["outputs"]) and all(
        _source_sha(JS_DIR / name) == sha for name, sha in modules["sources"].items()
    )


def _min_name(name):
    """The static/ path of the minified copy of a classic script or module
    entry ("js/shell.js" -> "min/js/shell.js") while that copy is current;
    the name itself otherwise."""
    if not (name.startswith("js/") and "/" not in name[3:]):
        return name
    manifest = _manifest()
    if not manifest:
        return name
    base = name[3:]
    if _classic_fresh(manifest, base):
        return f"min/{name}"
    if base in manifest["js"]["modules"]["entries"] and _modules_fresh(manifest):
        return f"min/{name}"
    return name


def page_css(kind):
    """What the shell's <head> loads for styles, or None to link the
    originals one by one.

    ``bundle`` is the URL of the minified stylesheet bundle. ``critical`` is
    the static/ path of the CSS the first paint of this kind of page needs
    (``kind``: "home", "text" for a server-rendered /text/ page, "app" for any
    other deep link), to be inlined; None when no current copy of it exists, in
    which case the bundle is linked as an ordinary stylesheet. The critical CSS
    counts as current only while it was extracted from the stylesheets now on
    disk (scripts/build_critical_css.mjs)."""
    manifest = _manifest()
    if not manifest or not _css_fresh(manifest):
        return None
    css = manifest["css"]
    critical = None
    entry = (css.get("critical") or {}).get(kind)
    if entry and entry.get("sourcesHash") == css["sourcesHash"] and _min_file_exists(entry["file"]):
        critical = f"min/{entry['file']}"
    return {"bundle": asset_url(f"min/{css['bundle']}"), "critical": critical}
