"""tests_js/fixtures/index_page.txt is the markup the shell.js tests boot against.

It is a snapshot of ``GET /`` (scripts/build_shell_dom_fixture.py), so it has to
move with templates/index.html: a stale copy would keep the JavaScript tests
green against a page that no longer exists.
"""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_SPEC = importlib.util.spec_from_file_location(
    "build_shell_dom_fixture", ROOT / "scripts" / "build_shell_dom_fixture.py"
)
build_shell_dom_fixture = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(build_shell_dom_fixture)

normalize = build_shell_dom_fixture.normalize


def test_fixture_is_the_page_the_server_renders(test_client):
    rendered = normalize(test_client.get("/").get_data(as_text=True))
    committed = build_shell_dom_fixture.FIXTURE_PATH.read_text(encoding="utf-8")
    # No assert message on the long strings: pytest would print both.
    assert committed == rendered, (
        "tests_js/fixtures/index_page.txt is stale -- run: python scripts/build_shell_dom_fixture.py"
    )


def test_normalize_drops_what_a_browser_would_run_or_fetch():
    html = (
        '<link rel="stylesheet" href="/a.css?v=0123456789ab">'
        "<style>p{color:red}</style>"
        '<script src="/a.js?v=0123456789ab"></script>'
        "<script>alert(1)</script>"
        '<script type="application/ld+json">{}</script>'
        "<noscript><p>enable js</p></noscript>"
        '<img src="/logo.png?v=0123456789ab">'
    )

    assert normalize(html) == '<img src="/logo.png">'


def test_normalize_keeps_the_json_data_blocks_shell_js_reads():
    block = '<script type="application/json" id="phosphorPaths">{"x":"M0"}</script>'

    assert normalize(f"<body>{block}<script>run()</script></body>") == f"<body>{block}</body>"
