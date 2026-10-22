"""Every Anthropic request names claude-haiku-5-5 and sends only what it accepts
(docs/evals/2026-10-22-anthropic-model.md).

Haiku 5.5 rejects ``temperature``/``top_p``/``top_k``, ``budget_tokens`` and a
prefilled assistant turn with a 400, thinks adaptively unless told otherwise, and
bills that thinking as output; a request that carried any of them would fall
through to "AI unavailable" at the one moment Gemini is down.
"""

import re
import types
from pathlib import Path

import pytest

from backend import claude, cost_meter

REJECTED = ("temperature", "top_p", "top_k", "thinking", "betas", "extra_headers")
BACKEND = Path(__file__).resolve().parents[1] / "backend"


class _Messages:
    def __init__(self):
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        usage = types.SimpleNamespace(
            input_tokens=5, output_tokens=7, cache_creation_input_tokens=0, cache_read_input_tokens=0)
        return types.SimpleNamespace(
            content=[types.SimpleNamespace(type="text", text='{"ruling": "Yes."}')], stop_reason="end_turn", usage=usage)


@pytest.fixture
def client(monkeypatch):
    async def _record(**kwargs):
        return None

    fake = types.SimpleNamespace(messages=_Messages())
    monkeypatch.setattr(claude, "record_llm_call", _record)
    monkeypatch.setattr(claude, "_get_async_client", lambda: fake)
    return fake


def test_there_are_exactly_two_places_that_send_a_request_to_anthropic():
    sites = []
    for path in sorted(BACKEND.glob("*.py")):
        sites += [path.name for _ in re.findall(r"\.messages\.(?:create|stream|parse)\(", path.read_text(encoding="utf-8"))]
    assert sites == ["claude.py", "claude.py"], "a new Anthropic call site needs the same pin and options"


@pytest.mark.asyncio
async def test_the_answer_call_uses_haiku_5_5_and_nothing_it_rejects(client):
    await claude._call_anthropic_httpx_model("question")
    [call] = client.messages.calls
    assert call["model"] == "claude-haiku-5-5"
    assert call["output_config"] == {"effort": "low"}
    assert call["messages"][-1]["role"] == "user"  # a trailing assistant turn is a prefill, which Haiku 5.5 rejects
    assert not [key for key in REJECTED if key in call]


@pytest.mark.asyncio
async def test_the_agentic_turn_uses_haiku_5_5_and_nothing_it_rejects(client):
    await claude._call_anthropic_agentic_turn([{"role": "user", "content": "question"}], "system", [])
    [call] = client.messages.calls
    assert call["model"] == "claude-haiku-5-5"
    assert call["output_config"] == {"effort": "low"}
    assert call["messages"][-1]["role"] == "user"
    assert not [key for key in REJECTED if key in call]


def test_the_cost_meter_prices_the_model_the_fallback_uses():
    prices = cost_meter._PRICE_PER_M[claude._CLAUDE_FALLBACK_MODEL]
    assert prices == {"input": 0.10, "output": 0.50}
    assert cost_meter.estimate_cost_usd(claude._CLAUDE_FALLBACK_MODEL, 2_000_000, 1_000_000) == pytest.approx(0.70)
