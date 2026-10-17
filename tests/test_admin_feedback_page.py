"""/admin/feedback: the restyled feedback digest page.

The page is a static shell plus static/js/admin-feedback.js. These tests pin the
contract between the two (every id the script reaches for exists in the HTML),
the safety rules the script lives by (no innerHTML: a comment is free text from
a reader), and the style rules the page was restyled to (tokens only, no inline
handlers or styles).
"""

import re
from pathlib import Path

import pytest

from backend import csp

ROOT = Path(__file__).resolve().parent.parent
JS = (ROOT / "static/js/admin-feedback.js").read_text()
CSS = (ROOT / "static/css/admin.css").read_text()
TEMPLATE = (ROOT / "templates/admin_feedback.html").read_text()

def _without_comments(source: str) -> str:
    """CSS block comments and whole-line JS comments (the script's only kind of
    comment on its own line); notes about what a file avoids must not trip the
    checks that it avoids them."""
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$", "", source)


HEX_COLOUR = re.compile(r"(?<![\w-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b")


@pytest.fixture
def page(test_client):
    response = test_client.get("/admin/feedback")
    assert response.status_code == 200
    return response.get_data(as_text=True)


def test_every_id_the_script_reads_is_in_the_page(page):
    wanted = set(re.findall(r"\$\('([A-Za-z0-9]+)'\)", JS))
    assert len(wanted) > 30  # the pattern still finds the script's lookups
    missing = sorted(name for name in wanted if f'id="{name}"' not in page)
    assert not missing, f"admin-feedback.js looks up ids the template does not render: {missing}"


def test_every_radio_group_the_script_reads_is_in_the_page(page):
    for name in set(re.findall(r'input\[name="(\w+)"\]', JS)):
        assert f'name="{name}"' in page


def test_the_filters_start_disabled_and_the_page_starts_as_a_skeleton(page):
    assert 'data-view="loading"' in page
    assert re.search(r'<fieldset id="adminControls"[^>]*\bdisabled\b', page)
    assert 'aria-busy="true"' in page


def test_the_page_is_noindex_in_markup_and_headers(test_client, page):
    assert '<meta name="robots" content="noindex, nofollow">' in page
    assert "canonical" not in page
    response = test_client.get("/admin/feedback")
    assert "noindex" in response.headers["X-Robots-Tag"]
    assert "no-store" in response.headers["Cache-Control"]


def test_the_page_carries_no_feedback_data(page):
    assert "question_hash" not in page
    assert "user_id" not in page
    assert "not_helpful" in page  # only as the filter's radio value
    body = page.split('id="adminRows"', 1)[1].split("</tbody>", 1)[0]
    assert body.count("<tr") == body.count('class="admin-skel-row"') == 6  # placeholders, no data rows


def test_the_script_never_writes_html_from_data():
    code = _without_comments(JS)
    for sink in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"):
        assert sink not in code, f"admin-feedback.js uses {sink}; comments are free text and must go in as text"


def test_the_template_has_no_inline_handlers_or_styles():
    assert not re.search(r"\son[a-z]+\s*=", TEMPLATE)
    assert 'style="' not in TEMPLATE
    assert "javascript:" not in TEMPLATE


def test_the_old_inline_clerk_loader_is_gone(page):
    # legal_scripts.html loads the pinned, SRI-checked Clerk build once.
    assert page.count("clerk.browser.js") <= 1


def test_the_page_script_is_an_external_file_so_csp_needs_no_new_hash(page):
    assert 'src="/static/js/admin-feedback.js' in page or "min/js/admin-feedback.js" in page
    inline = csp.inline_script_hashes(page)
    assert all("Authorization" not in script for script in re.findall(r"<script>(.*?)</script>", page, re.S))
    assert len(inline) == len(re.findall(r"<script>(?!\s*</script>)", page))


def test_the_stylesheet_uses_tokens_only():
    css = _without_comments(CSS)
    assert not HEX_COLOUR.findall(css)
    assert not re.search(r"\b(?:rgb|rgba|hsl|hsla)\(", css)
    assert "@keyframes" not in css  # every keyframe lives in tokens.css


def test_the_page_stylesheet_and_script_are_linked(page):
    assert "admin.css" in page
    assert "admin-feedback.js" in page
    assert "legal.css" in page


def test_the_chart_colours_are_defined_for_both_themes():
    tokens = (ROOT / "static/css/tokens.css").read_text()
    assert len(re.findall(r"--viz-series-1:", tokens)) == 3  # light, dark, prefers-color-scheme fallback
    assert len(re.findall(r"--viz-series-2:", tokens)) == 3
    for name in ("thumbs-up", "thumbs-down", "lock-simple", "warning-circle", "chat-text"):
        assert f"--icon-{name}:" in tokens
