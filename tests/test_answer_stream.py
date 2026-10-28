"""The answer's opening reaches a streamed ask as the model writes it
(backend/claude.py _RulingDraft / _stream_with_draft, ask_progress.draft)."""

import asyncio

import pytest

from backend import ask_progress, claude


@pytest.fixture
def events():
    sent = []
    token = ask_progress.bind(sent.append)
    yield sent
    ask_progress.unbind(token)


@pytest.fixture
def no_wait(monkeypatch):
    monkeypatch.setattr(claude._RulingDraft, "DRAFT_INTERVAL_SECONDS", 0)


def _drafts(events):
    return [e["text"] for e in events if e["type"] == "draft"]


def _steps(events):
    return [e["detail"]["step"] for e in events if e["type"] == "detail" and (e.get("detail") or {}).get("kind") == "step"]


@pytest.mark.usefixtures("no_wait")
class TestRulingDraft:
    def test_the_ruling_is_reported_as_it_grows(self, events):
        draft = claude._RulingDraft()
        for chunk in ('{"rul', 'ing": "Two can', 'dles are lit', ' for zachor."', ', "sources": []}'):
            draft.feed(chunk)
        assert _drafts(events) == ["Two can", "Two candles are lit", "Two candles are lit for zachor."]

    def test_the_finished_ruling_is_followed_by_the_details_step(self, events):
        draft = claude._RulingDraft()
        draft.feed('{"ruling": "Done."')
        assert _steps(events) == ["details"]

    def test_nothing_after_the_ruling_is_reported(self, events):
        draft = claude._RulingDraft()
        draft.feed('{"ruling": "Done.", "summary": "')
        draft.feed('more text"}')
        assert _drafts(events) == ["Done."]

    def test_text_before_the_ruling_key_is_not_reported(self, events):
        draft = claude._RulingDraft()
        draft.feed('```json\n{"sources": ["Exodus 20:8"], ')
        assert _drafts(events) == []

    def test_escapes_are_decoded(self, events):
        draft = claude._RulingDraft()
        draft.feed('{"ruling": "Say \\"Shabbat Shalom\\"\\nthen eat."')
        assert _drafts(events) == ['Say "Shabbat Shalom"\nthen eat.']

    def test_source_markers_are_left_out_until_they_are_final(self, events):
        draft = claude._RulingDraft()
        draft.feed('{"ruling": "Light two candles.[1][2] Then bless.[3]"')
        assert _drafts(events) == ["Light two candles. Then bless."]


def test_drafts_wait_out_the_interval(events):
    draft = claude._RulingDraft()
    draft.feed('{"ruling": "Two')
    draft.feed(' candles')
    assert _drafts(events) == ["Two"]


def test_the_closed_ruling_is_reported_even_within_the_interval(events):
    draft = claude._RulingDraft()
    draft.feed('{"ruling": "Two')
    draft.feed(' candles."')
    assert _drafts(events) == ["Two", "Two candles."]


def test_a_draft_with_no_listener_goes_nowhere():
    ask_progress.draft("text")  # no reporter bound: nothing to fail
    assert ask_progress.listening() is False


class _FakeStream:
    def __init__(self, chunks, final):
        self._chunks, self._final = chunks, final

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    @property
    def text_stream(self):
        async def gen():
            for chunk in self._chunks:
                yield chunk
        return gen()

    async def get_final_message(self):
        return self._final


class _FakeMessages:
    def __init__(self, chunks, final):
        self.calls = []
        self._chunks, self._final = chunks, final

    def stream(self, **request):
        self.calls.append(("stream", request))
        return _FakeStream(self._chunks, self._final)

    async def create(self, **request):
        self.calls.append(("create", request))
        return self._final


class _FakeClient:
    def __init__(self, chunks=(), final="final"):
        self.messages = _FakeMessages(list(chunks), final)


@pytest.mark.usefixtures("no_wait")
def test_stream_with_draft_returns_the_final_message(events):
    client = _FakeClient(['{"ruling": "Hi."}'], final="the message")
    assert asyncio.run(claude._stream_with_draft(client, {"model": "m"})) == "the message"


@pytest.mark.usefixtures("no_wait")
def test_stream_with_draft_clears_the_last_answers_draft_first(events):
    client = _FakeClient(['{"ruling": "Hi."}'])
    asyncio.run(claude._stream_with_draft(client, {"model": "m"}))
    assert _drafts(events) == ["", "Hi."]


def test_a_second_model_taking_over_clears_the_draft(events):
    async def failing():
        return {"answer": "", "error": "anthropic_sdk_error: x"}

    async def backup():
        return {"answer": "y"}

    asyncio.run(claude._claude_then_gemini(failing, backup))
    assert _drafts(events) == [""]
