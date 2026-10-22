# Eval: follow-ups keep their context (2026-10-22)

**The report.** In the flagged conversation a follow-up such as "now explain pasuk vav to the end" lost the subject of the thread. This note checks every link that carries the thread to the model, runs three-turn threads on both providers, and records what was changed.

## How the thread reaches the model

1. **Guests:** the browser sends `history_ids`; the server rebuilds the thread from its own saved rows (`guest_cap.GuestThread`), so a client cannot forge an earlier answer. The thread's row ids are part of the answer-cache key (`cache_scope`), so the same words in two different threads never share a cached answer.
2. **Signed-in readers:** `routes_conversations._fetch_conversation_history` reads the last 20 complete, non-superseded messages of the conversation. Follow-ups in a conversation are not served from the answer cache.
3. **`build_history_turns`** turns the rows into real alternating turns (assistant turns carry the earlier answer as JSON), keeps at most `HISTORY_MAX_TURNS = 12`, cuts each answer at `HISTORY_ASSISTANT_TURN_CHARS = 4500` and the whole thread at `HISTORY_MAX_TOTAL_CHARS = 16000`, dropping the oldest turns first.
4. **Both providers get the same turns.** `_gemini_contents` builds Gemini's `contents`; `_anthropic_messages` builds Claude's `messages` and marks the last earlier turn with `cache_control`, so the thread's prefix is a prompt-cache hit on the next turn. The Gemini → Claude fallback passes the same `history_turns`, so a provider switch in the middle of a thread loses nothing.
5. **The prompt's follow-up instruction** says the question is about the subject of the last answer, to answer only what is new, and (added with the long-answer work) that a request for a different length or form is never an empty question.

## What was found

| Finding | Status |
|---|---|
| Earlier answers were cut at 2,400 characters, so a long answer reached its follow-up without its second half | Fixed with the long-answer work: 4,500 characters per answer, 16,000 per thread |
| A refused turn (the scope refusal) stayed in the thread and could teach the model to refuse the next short question | Fixed: `build_history_turns` drops a scope refusal and the question it answered (`_is_scope_refusal`) |
| The keyword gate judged a short follow-up ("and a poem?") alone, outside its thread | Fixed with item 21: the gate, the guardrail and the pipeline know when a question is inside a thread (`in_thread`) |
| Cache scope, trimming, agentic path | Checked, no defect: `asgi` adds `|thread:<cache_scope>` to the answer-cache key of a guest follow-up, trimming drops the oldest pairs first, and the agentic path (`AI_AGENTIC_TOOLS`, off by default) passes the same history through `build_history_turns` and has no answer cache of its own |

## Method

`scripts/eval_ai_quality.py context` runs four three-turn threads through the same steps `/ask` runs, carrying each answer into the next turn's history. Thread 1: wine → grape juice → "the second one"; thread 2: Aaron → his sister → what she did at the sea; thread 3: the four sons → what the wise son asks → "how do we answer him?"; thread 4: bread → an off-topic question (Hamlet) → "and what do I do with my hands first?", which tests that a refusal in the middle does not poison the next turn. The check is lexical (does the answer contain a word the right answer must), so a correct answer in other words counts as a miss; every miss below was read by hand.

## Results (12 turns per provider)

| | Gemini before | Gemini after | Claude before | Claude after |
|---|---|---|---|---|
| Turns refused that should be answered | **3** (all of thread 2) | 0 | 0 | 0 |
| Right subject carried to the next turn | 8 of 9 | 9 of 9 | 9 of 9 | 9 of 9 |
| Off-topic turn refused (Hamlet) | yes | yes | yes | yes |
| Turn after the refusal answered with the thread's subject | yes | yes | yes | yes |

The four lexical misses (Gemini before "grape juice", Gemini after and Claude before "what she did at the sea", Claude after "grape juice") were all correct answers in other words. The only real defect was Gemini refusing the whole Aaron → Miriam thread because a bare "who was his sister?" read as off-topic.

A caution on the Gemini rows: in the parallel runs Gemini failed twice quickly (heavy parallel load), the in-process circuit opened, and the rest of thread 3 and all of thread 4 were answered by Claude (the `model` column in the result files shows it). A single-process rerun of thread 3 stayed on Gemini on every turn with no error, so the failure was load, not the history. The rows above therefore compare both providers on the whole suite, with thread 3's third turn and thread 4 coming from Claude in the Gemini columns.

## Tests

`tests/test_followup_context.py` (6): the third turn reaches both providers with the first two turns; a refused question leaves the thread with its refusal (English and Hebrew); a thread that opens with a refusal is just empty; the Claude messages keep their roles and cache the thread; the same words asked in two threads do not share an answer.

## Known limits

- A thread older than 12 turns or 16,000 characters loses its oldest turns; a reader who returns to the first question after a long thread has to name it.
- A signed-in conversation reads its last 20 messages and a guest thread its saved answers (`MAX_HISTORY_IDS`); the model sees at most 12 turns of either.
- The lexical check cannot tell a good answer from a plausible one; the nine turns per provider were read by hand.

## Not verified

The live site after deploy; Safari/iOS.
