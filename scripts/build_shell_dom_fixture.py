#!/usr/bin/env python3
"""Write the page markup the shell.js tests boot against.

static/js/shell.js is the app's main script: it looks up several hundred
elements of templates/index.html by id the moment it runs, so a test of it needs
that markup, not a hand-made stand-in that drifts from the real one. The Node
tests (tests_js/helpers/shell_page.js) load this file into jsdom and run the
page's classic scripts from static/js/ against it.

What is kept: everything the server renders for ``GET /`` except what the
browser would execute or fetch (``<script>``, ``<style>``, ``<link>``,
``<noscript>``) and the JSON data blocks shell.js reads (``<script
type="application/json">``). The ``?v=<hash>`` cache-busters are dropped so the
file does not change with every edit of a script.

tests/test_shell_dom_fixture.py renders the page again and fails when it no
longer matches the committed file; rerun this script to refresh it:

    python scripts/build_shell_dom_fixture.py

Takes no arguments: the output path is fixed, never built from the command line.
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_PATH = REPO_ROOT / "tests_js" / "fixtures" / "index_page.txt"

_SCRIPT = re.compile(r"<script\b([^>]*)>.*?</script>", re.DOTALL)
_STYLE = re.compile(r"<style\b[^>]*>.*?</style>", re.DOTALL)
_NOSCRIPT = re.compile(r"<noscript\b[^>]*>.*?</noscript>", re.DOTALL)
_LINK = re.compile(r"<link\b[^>]*>")
_CACHE_BUSTER = re.compile(r"\?v=[0-9a-f]{12}")


def _keep_data_block(match: re.Match) -> str:
    """Keep a JSON data block (shell.js reads it); drop every executable script."""
    return match.group(0) if 'type="application/json"' in match.group(1) else ""


def normalize(html: str) -> str:
    """The rendered home page, minus what a browser would run or fetch."""
    html = _SCRIPT.sub(_keep_data_block, html)
    for pattern in (_STYLE, _NOSCRIPT, _LINK):
        html = pattern.sub("", html)
    return _CACHE_BUSTER.sub("", html)


def render_home_page() -> str:
    """``GET /`` through the Flask test client, normalized."""
    sys.path.insert(0, str(REPO_ROOT))
    from app import app  # noqa: PLC0415 -- importing it configures logging and reads .env

    response = app.test_client().get("/")
    if response.status_code != 200:
        raise SystemExit(f"GET / answered {response.status_code}")
    return normalize(response.get_data(as_text=True))


def main() -> None:
    markup = render_home_page()
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(markup, encoding="utf-8")
    print(f"wrote {FIXTURE_PATH.relative_to(REPO_ROOT)} ({len(markup):,} characters)")


if __name__ == "__main__":
    main()
