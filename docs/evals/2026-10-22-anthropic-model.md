# Check: every Anthropic call uses claude-haiku-5-5 (2026-10-22)

**The question.** Is every request to Anthropic made with `claude-haiku-5-5`, does the cost meter price that model, and does each request carry only options Haiku 5.5 accepts?

## Result: yes, no change needed

| Check | Where | Result |
|---|---|---|
| Places that send a request to Anthropic | `git grep` for `.messages.create/stream/parse` in the app code | Two, both in `backend/claude.py`: the answer call `_call_anthropic_httpx_model` and the agentic turn `_call_anthropic_agentic_turn`. The health probe calls `GET /v1/models`, which names no model |
| Model on each | `model_name = _CLAUDE_FALLBACK_MODEL` in both | `claude-haiku-5-5` (`backend/claude.py:73`). The agentic path's result dicts in `ask_pipeline` read the same constant |
| Priced | `backend/cost_meter.py` `_PRICE_PER_M` and `_RESERVATION_PRICE_MODEL` | `claude-haiku-5-5` at $0.10 input / $0.50 output per million tokens, the rate Anthropic publishes for it; the budget reservation is priced at the same model (a test already ties it to the constant). Cache reads and writes are billed at 0.1x and 1.25x |
| Options Haiku 5.5 rejects | request kwargs of both calls | None sent: no `temperature`, `top_p`, `top_k`, `budget_tokens`, prefill (the last message is always the reader's turn) or beta header |
| Options it needs | `_anthropic_request_options` | `output_config: {"effort": "low"}`, `"medium"` for a study ceiling. Adaptive thinking is on by default and billed as output. A short answer sends `thinking: {"type": "disabled"}` (accepted by Haiku 5.5; about three times faster, see [latency](2026-10-22-latency.md)); a long or study answer keeps thinking, so its `max_tokens` carries `CLAUDE_THINKING_HEADROOM_TOKENS` (1,536) above the answer ceiling. The agentic turn keeps adaptive thinking |
| Live | the item 16-21 eval runs | About 770 Claude calls (answers, long answers, second looks, judging excluded) with no Anthropic error in any log |

## Tests

`tests/test_anthropic_model_pin.py` (4): there are exactly two request sites (a third needs the same pin and options, or the test says so); each of the two sends `claude-haiku-5-5`, `output_config.effort`, a final user turn and none of the rejected fields (the answer call sends `thinking` disabled, the agentic turn none); the cost meter prices the model the fallback uses. The older `tests/test_answer_pipeline_upgrade.py` already covers history, effort, ceilings and cache billing for the answer call.

## Known limits

- The agentic turn sets no per-call timeout; it relies on the client default (`MODEL_REQUEST_TIMEOUT_SECONDS`) and the 45-second synthesis budget around it. The agentic path is off by default (`AI_AGENTIC_TOOLS`).
- The price is in code; if Anthropic changes it, `cost_meter` and `.env.example` are the two places to edit.

## Not verified

The live site after deploy.
