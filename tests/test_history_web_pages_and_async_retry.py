"""Web pages kept with a stored answer, and the async Gemini retry."""

import asyncio
import time
from types import SimpleNamespace

import pytest
from tenacity import wait_none

from backend import claude
from backend.rag import WEB_PAGE_SOURCE_KIND, _web_page_entries, split_web_pages

PAGE = {"ref": "Web: OU Kosher", "title": "OU Kosher", "url": "https://oukosher.org/x"}


def test_web_page_entries_are_tagged():
    assert _web_page_entries([PAGE])[0]["kind"] == WEB_PAGE_SOURCE_KIND


def test_web_page_entries_skip_pages_without_a_url():
    assert _web_page_entries([{"ref": "Web: X"}]) == []


def test_split_moves_pages_to_meta():
    row = {"sources": [{"ref": "Genesis 1:1"}, *_web_page_entries([PAGE])], "meta": {"mode": "balanced"}}
    assert split_web_pages(row)["meta"]["web_sources"] == [PAGE]


def test_split_leaves_the_text_sources():
    row = {"sources": [{"ref": "Genesis 1:1"}, *_web_page_entries([PAGE])]}
    assert split_web_pages(row)["sources"] == [{"ref": "Genesis 1:1"}]


def test_split_keeps_existing_meta():
    row = {"sources": _web_page_entries([PAGE]), "meta": {"mode": "balanced"}}
    assert split_web_pages(row)["meta"]["mode"] == "balanced"


def test_split_without_pages_returns_the_row_unchanged():
    row = {"sources": [{"ref": "Genesis 1:1"}]}
    assert split_web_pages(row) is row


class _Overloaded(Exception):
    code = 503


def _client(outcomes):
    calls = []

    async def generate_content(**kwargs):
        calls.append(kwargs)
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    return SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))), calls


@pytest.fixture
def no_retry_wait(monkeypatch):
    claude._ensure_genai_loaded()
    monkeypatch.setattr(claude._generate_gemini_content_async_with_retry.retry, "wait", wait_none())


def test_async_gemini_retries_an_overloaded_response(no_retry_wait):
    client, calls = _client([_Overloaded(), "ok"])
    result = asyncio.run(claude._generate_gemini_content_async_with_retry(client, "m", "c", "s", 100))
    assert result == "ok"
    assert len(calls) == 2


def test_async_gemini_refuses_to_start_without_budget(no_retry_wait):
    client, calls = _client(["ok"])
    token = claude._model_deadline.set(time.monotonic() + 1)
    try:
        with pytest.raises(TimeoutError):
            asyncio.run(claude._generate_gemini_content_async_with_retry(client, "m", "c", "s", 100))
    finally:
        claude._model_deadline.reset(token)
    assert calls == []
