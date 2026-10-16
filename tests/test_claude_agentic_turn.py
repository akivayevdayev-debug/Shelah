"""
Tests for backend/claude._call_anthropic_agentic_turn() -- the raw
Anthropic Messages API tool-use turn.

Unlike tests/test_agent_loop.py (which stubs this function entirely to test
the orchestration loop), these tests exercise the real function against the
suite's respx-mocked Anthropic endpoint, so a real anthropic-SDK Message
object gets parsed by the block_type == "text" / "tool_use" branches --
catching a shape mismatch that an all-mocked test never could.
"""

from __future__ import annotations

import httpx

from backend import claude

ANTHROPIC_MESSAGES_URL_RE = r"https://api\.anthropic\.com/v1/messages.*"


async def test_plain_text_turn_no_tool_use(mock_outbound_httpx):
    """Uses the suite's DEFAULT Anthropic mock (a plain text content block,
    no tools) — confirms the text-parsing branch and the empty-tool_uses
    shape without any per-test override."""
    result = await claude._call_anthropic_agentic_turn(
        messages=[{"role": "user", "content": "What is Shabbat?"}],
        system_text="You are a halachic assistant.",
        tools=[],
    )

    assert result["error"] is None
    assert result["tool_uses"] == []
    assert result["text"]
    assert result["stop_reason"] == "end_turn"
    assert result["content_blocks"]


async def test_tool_use_turn_parses_tool_use_block(mock_outbound_httpx):
    mock_outbound_httpx.post(url__regex=ANTHROPIC_MESSAGES_URL_RE).mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "msg_mock_tooluse",
                "type": "message",
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "Let me check the sources."},
                    {
                        "type": "tool_use",
                        "id": "toolu_01ABC",
                        "name": "search_judaic_texts",
                        "input": {"query": "Shabbat candle lighting"},
                    },
                ],
                "model": "claude-haiku-4-5",
                "stop_reason": "tool_use",
                "usage": {"input_tokens": 120, "output_tokens": 40},
            },
        )
    )

    result = await claude._call_anthropic_agentic_turn(
        messages=[{"role": "user", "content": "When do I light candles?"}],
        system_text="You are a halachic assistant.",
        tools=[{
            "name": "search_judaic_texts",
            "description": "Search Judaic texts.",
            "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
        }],
    )

    assert result["error"] is None
    assert result["text"] == "Let me check the sources."
    assert result["stop_reason"] == "tool_use"
    assert result["tool_uses"] == [
        {"id": "toolu_01ABC", "name": "search_judaic_texts", "input": {"query": "Shabbat candle lighting"}},
    ]
    # content_blocks must be replayable verbatim as the next assistant turn.
    assert len(result["content_blocks"]) == 2


async def test_multiple_tool_use_blocks_all_parsed(mock_outbound_httpx):
    mock_outbound_httpx.post(url__regex=ANTHROPIC_MESSAGES_URL_RE).mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "msg_mock_multi",
                "type": "message",
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": "toolu_1", "name": "get_hebrew_date", "input": {}},
                    {"type": "tool_use", "id": "toolu_2", "name": "get_parasha", "input": {}},
                ],
                "model": "claude-haiku-4-5",
                "stop_reason": "tool_use",
                "usage": {"input_tokens": 90, "output_tokens": 20},
            },
        )
    )

    result = await claude._call_anthropic_agentic_turn(
        messages=[{"role": "user", "content": "What day is it and what's the parasha?"}],
        system_text="sys",
        tools=[],
    )

    assert [tu["name"] for tu in result["tool_uses"]] == ["get_hebrew_date", "get_parasha"]
    assert result["text"] == ""


async def test_circuit_open_short_circuits_without_calling_the_api(monkeypatch, mock_outbound_httpx):
    import backend.health_check as health_check_module
    monkeypatch.setattr(health_check_module.health, "is_healthy", lambda service: False)

    result = await claude._call_anthropic_agentic_turn(
        messages=[{"role": "user", "content": "hi"}], system_text="sys", tools=[],
    )

    assert result["error"] == "anthropic_circuit_open"
    assert result["tool_uses"] == []
    assert result["text"] == ""
    assert len(mock_outbound_httpx.calls) == 0


async def test_missing_api_key_returns_error_not_raise(monkeypatch):
    monkeypatch.setattr(claude, "_get_async_client", lambda: None)

    result = await claude._call_anthropic_agentic_turn(
        messages=[{"role": "user", "content": "hi"}], system_text="sys", tools=[],
    )

    assert result["error"] == "anthropic_api_key_missing"


async def test_sdk_exception_degrades_to_error_result_never_raises(mock_outbound_httpx):
    mock_outbound_httpx.post(url__regex=ANTHROPIC_MESSAGES_URL_RE).mock(
        return_value=httpx.Response(500, json={"error": {"message": "internal error"}})
    )

    result = await claude._call_anthropic_agentic_turn(
        messages=[{"role": "user", "content": "hi"}], system_text="sys", tools=[],
    )

    assert result["error"] is not None
    assert result["error"].startswith("anthropic_sdk_error")
    assert result["tool_uses"] == []


async def test_empty_tools_list_omits_tools_param_from_the_api_call(mock_outbound_httpx):
    """The forced final round passes tools=[] -- confirms the function omits
    the `tools` key entirely from the request body rather than sending an
    empty array (see the inline rationale in _call_anthropic_agentic_turn)."""
    route = mock_outbound_httpx.post(url__regex=ANTHROPIC_MESSAGES_URL_RE)

    await claude._call_anthropic_agentic_turn(
        messages=[{"role": "user", "content": "hi"}], system_text="sys", tools=[],
    )

    assert route.called
    sent_body = route.calls.last.request.content
    import json as _json
    payload = _json.loads(sent_body)
    assert "tools" not in payload


# ─── Prompt caching across the rounds of the loop ───────────────────────────

_MARK = {"type": "ephemeral"}
_TOOLS = [{"name": "get_hebrew_date", "description": "d", "input_schema": {"type": "object", "properties": {}}}]


def _sent_messages(route):
    import json
    return json.loads(route.calls.last.request.content)["messages"]


class TestTrailingCacheBreakpoint:
    def test_a_plain_prompt_becomes_a_marked_text_block(self):
        marked = claude._with_trailing_cache_breakpoint([{"role": "user", "content": "hi"}])

        assert marked == [{"role": "user", "content": [
            {"type": "text", "text": "hi", "cache_control": _MARK}]}]

    def test_only_the_last_block_of_the_last_message_is_marked(self):
        messages = [
            {"role": "user", "content": "question"},
            {"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "x", "input": {}}]},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "t1", "content": "a"},
                {"type": "tool_result", "tool_use_id": "t2", "content": "b"},
            ]},
        ]

        marked = claude._with_trailing_cache_breakpoint(messages)

        assert marked[:2] == messages[:2]
        assert "cache_control" not in marked[2]["content"][0]
        assert marked[2]["content"][1] == {
            "type": "tool_result", "tool_use_id": "t2", "content": "b", "cache_control": _MARK}

    def test_the_callers_messages_are_not_modified(self):
        messages = [{"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t", "content": "a"}]}]

        claude._with_trailing_cache_breakpoint(messages)

        assert messages == [{"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "t", "content": "a"}]}]

    def test_nothing_to_anchor_on_leaves_the_messages_alone(self):
        sdk_block = object()  # a block replayed from the SDK is not a plain dict
        for messages in (
            [],
            [{"role": "user", "content": "   "}],
            [{"role": "user", "content": []}],
            [{"role": "assistant", "content": [sdk_block]}],
            [{"role": "user", "content": [{"type": "text", "text": ""}]}],
        ):
            assert claude._with_trailing_cache_breakpoint(messages) is messages


async def test_a_round_that_can_continue_sends_the_trailing_breakpoint(mock_outbound_httpx):
    route = mock_outbound_httpx.post(url__regex=ANTHROPIC_MESSAGES_URL_RE)
    messages = [{"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t", "content": "a"}]}]

    await claude._call_anthropic_agentic_turn(messages=messages, system_text="sys", tools=_TOOLS)

    assert _sent_messages(route)[-1]["content"][-1]["cache_control"] == _MARK
    assert "cache_control" not in messages[-1]["content"][-1]


async def test_the_forced_final_round_does_not_pay_for_a_breakpoint(mock_outbound_httpx):
    route = mock_outbound_httpx.post(url__regex=ANTHROPIC_MESSAGES_URL_RE)

    await claude._call_anthropic_agentic_turn(
        messages=[{"role": "user", "content": "hi"}], system_text="sys", tools=[])

    assert _sent_messages(route) == [{"role": "user", "content": "hi"}]
