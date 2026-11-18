"""templates/components/site_footer.html is the one footer of the home page,
the About, Help, Glossary and Tanakh pages, the seven legal pages
(components/legal_footer.html includes it) and the 404 page.

Each page sets `current` via {% with current='<page>' %}. Jinja treats an
unset or mistyped `current` as an ordinary falsy value, so a page that
forgets it would silently lose its "you are here" mark; these tests make
that loud. The link set is the same on every page, so the columns never
change shape between pages.
"""

from __future__ import annotations

import re

import pytest

SIBLING_PAGES = ["about", "help", "glossary"]
LEGAL_PAGES = ["terms", "privacy", "ai-disclosure", "acceptable-use", "dmca", "accessibility", "licenses"]
FOOTER_PAGES = SIBLING_PAGES + LEGAL_PAGES

EVERY_LINK = [
    "/",
    "/siddur",
    "/glossary",
    "/about",
    "/help",
    "/accessibility",
    "/terms",
    "/privacy",
    "/ai-disclosure",
    "/acceptable-use",
    "/dmca",
    "/licenses",
]

_LINK = re.compile(r'<a href="(?P<href>[^"]*)"(?P<attrs>[^>]*)>', re.DOTALL)


def _footer(test_client, path: str) -> str:
    html = test_client.get(path).get_data(as_text=True)
    footer = re.search(r'<footer class="site-footer">.*?</footer>', html, re.DOTALL)
    assert footer, f"{path} has no site footer"
    return footer.group(0)


def _links(footer: str):
    return [(m.group("href"), m.group("attrs")) for m in _LINK.finditer(footer)]


@pytest.mark.parametrize("page", FOOTER_PAGES)
def test_footer_carries_the_same_links_on_every_page(test_client, page):
    assert [href for href, _ in _links(_footer(test_client, f"/{page}"))] == EVERY_LINK


@pytest.mark.parametrize("page", FOOTER_PAGES)
def test_footer_marks_only_the_page_on_screen(test_client, page):
    marked = [href for href, attrs in _links(_footer(test_client, f"/{page}")) if 'aria-current="page"' in attrs]
    assert marked == [f"/{page}"]


@pytest.mark.parametrize("page", FOOTER_PAGES)
def test_footer_shows_the_copyright_line(test_client, page):
    assert "All rights reserved" in _footer(test_client, f"/{page}")


def test_the_404_page_uses_the_site_footer(test_client):
    footer = _footer(test_client, "/no-such-page-for-the-footer-test")
    assert [href for href, _ in _links(footer)] == EVERY_LINK


def test_the_404_footer_marks_no_page(test_client):
    assert 'aria-current="page"' not in _footer(test_client, "/no-such-page-for-the-footer-test")


@pytest.mark.parametrize("path", ["/tanakh", "/"])
def test_pages_without_a_footer_link_carry_it_unmarked(test_client, path):
    """The Tanakh hub and the home page have no link of their own in the
    footer (the brand mark already goes home), so nothing is marked."""
    footer = _footer(test_client, path)
    assert [href for href, _ in _links(footer)] == EVERY_LINK
    assert 'aria-current="page"' not in footer
    assert "All rights reserved" in footer


def test_the_home_footer_closes_the_main_pane_with_the_notice(test_client):
    """Last child of #mainContainer, behind every view, with the
    educational-not-p'sak notice the other pages do not carry."""
    html = test_client.get("/").get_data(as_text=True)
    footer = html.index('<footer class="site-footer">')
    assert html.index('id="reader"') < footer < html.index("</main>")
    assert html.count('<footer class="site-footer">') == 1
    assert "not a binding halachic ruling" in _footer(test_client, "/")
    assert "not a binding halachic ruling" not in _footer(test_client, "/about")
