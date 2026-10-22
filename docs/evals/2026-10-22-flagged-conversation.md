# Eval: the flagged conversation (2026-10-22)

**The report.** A reader shared a conversation about Numbers 12 (Miriam and Aaron speaking against Moses) that went wrong in several ways. This note reads it (GET only, nothing written), lists what went wrong, names the cause of each problem and points to the fix and the regression test.

## What the conversation did

Eight reader turns on one subject, Bamidbar 12.

| Turn | Reader asked | Answer |
|---|---|---|
| 1 | an overview of the chapter | 554 words, grouped by verse ranges, not verse by verse |
| 2 | "go deeper into pesukim 1-3" | 110 words |
| 3 | what do Rashi, Unkelus and Ibn Ezra say "in their whole commentary" | 87 words |
| 4 | "now explain pasuk vav to the end" | answered as 12:6-8 (the reader meant the sixth verse to the end) |
| 5 | "in extreme detail with commentary" | 55 words |
| 6 | the Sefer ha-Yashar question | cited "Chapter 23" and a source called "Sefer ha-Yashar, Moses" that does not exist; said Ibn Ezra cites it as an alternative tradition (doubtful) |
| 7 | "answer in a long answer" | refused as an "empty question input" |
| 8 | a plain follow-up | answered, short |

## Problems, causes and fixes

| # | Problem | Cause | Fix | Regression test | Eval note |
|---|---|---|---|---|---|
| 1 | Answers far too short when the reader asks for length (110, 87, 55 words) | A request of twelve words or fewer was "simple" (768 tokens, "2-5 sentences"); the larger ceiling never reached either provider | `wants_long_answer()`, `LONG_ANSWER_MAX_TOKENS`, a long-answer format in the prompt, ceiling passed to both providers | `tests/test_long_answers.py` (59) | [long answers](2026-10-22-long-answers.md): median 88 → 509 words on Gemini, 362 → 546 on Claude |
| 2 | "answer in a long answer" refused as an empty question | The model read a bare request for length as no question; the keyword gate and the out-of-scope flag did not look at the thread | The follow-up instruction says a request for a different length or form is about the last answer; the gate and the guardrail know they are inside a thread | `tests/test_scope_gate.py` (32), `tests/test_long_answers.py` | [refusals](2026-10-22-refusals.md): 7 of 53 → 0 of 53 false refusals |
| 3 | Lost context between turns ("now explain pasuk vav" answered as 12:6-8) | The earlier answers reached the model cut at 2,400 characters and a refused turn stayed in the thread, so a bare follow-up had little to anchor to | 4,500 characters per earlier answer, refusal turns dropped from the thread (the thread already reached both providers as real turns) | `tests/test_followup_context.py` (6) | [follow-up context](2026-10-22-followup-context.md) |
| 4 | Fancy wording ("noble concern", "perpetually purified", "structurally between…") | Nothing asked for plain language; the prompt called the model a "scholarly halakhic synthesis engine" | A Style paragraph in the core prompt and a Style line in the simple format | `tests/test_plain_language.py` (4) | [plain language](2026-10-22-plain-language.md) |
| 5 | Inconsistent spelling ("Unkelus" echoed from the reader, then "Targum Onkelos") | The model repeated the reader's spelling | The Style paragraph asks for the common English name of a source, once | `tests/test_plain_language.py` | [plain language](2026-10-22-plain-language.md) |
| 6 | Wrong or doubtful facts in the Sefer ha-Yashar answer (an invented source, a chapter number) | The answer cited from memory what retrieval did not return | The existing rule "cite only what the sources show" stays; this turn is the sort of case the source-relevance work in item 21 covers | see Known limits | n/a |
| 7 | Ashkenazi pronunciation | None found in the answers (only the "Unkelus" spelling above) | none needed | n/a | n/a |

## Known limits

- Problem 6 is a model error on a rare source. The fix for it is retrieval (a Sefer ha-Yashar passage in the sources) and a reader's report, not a prompt rule; no model pass can promise that a claim about a lesser-known book is true.
- A run of the same eight turns on the live models after the fixes was not repeated; the evidence is the per-problem evals linked above.

## Not verified

The live site after deploy; Safari/iOS.
