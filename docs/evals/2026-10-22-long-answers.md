# Eval: long answers when asked (2026-10-22)

**The report.** A reader who writes "go deeper", "in extreme detail with commentary" or "answer in a long answer" got a paragraph back (110, 55 and 37 words in the flagged conversation), on both providers, and a request for length was sometimes refused.

**What was wrong.** Three controls disagreed:

1. `question_profile` called any request of twelve words or fewer "simple": a 768-token ceiling and the instruction "2-5 sentences, no headings". Follow-ups such as "go deeper" are five words long, so they always lost.
2. `_model_call_extras` handed the model only the *study* ceiling. A bigger ceiling for any other question never reached Gemini or Claude, so even a long prompt would have been cut at the default.
3. Nothing told the model that an explicit request for length outweighs "answer at the size it was asked". The model also read a bare "answer in a long answer" as an empty question and refused it (item 21).

## Method

`scripts/eval_ai_quality.py long` runs the same steps `/ask` runs (off-topic gate, Sefaria retrieval, AI synthesis) in-process with the real models, ten prompts: seven first questions in English and Hebrew, three follow-ups with an earlier answer in the thread. "Before" is commit `4972344` (detached worktree), "after" is this change. Words are counted in the answer text without the Sources list. Run once each, Gemini first and then with `--provider claude` (Gemini skipped, Claude answers). The harness turns off Supabase, Sentry and the shared Redis, so a run never reads or writes production state.

## Before and after (words per answer)

| # | Prompt | Gemini before | Gemini after | Claude before | Claude after |
|---|---|---|---|---|---|
| 1 | Explain in depth the laws of lighting Shabbat candles | 107 | 347 | 323 | 522 |
| 2 | Give me a long answer: why do we dip the bread in salt on Shabbat? | 205 | 429 | 244 | 469 |
| 3 | Elaborate in detail on the meaning of Yom Kippur | 89 | 532 | 299 | 568 |
| 4 | Explain Bereishit chapter 1 in detail, verse by verse | refused | 777 | 625 | 670 |
| 5 | תסביר בהרחבה את הלכות ברכת המזון | 62 | 409 | 208 | 373 |
| 6 | Describe the Pesach seder in great detail | refused | 605 | 362 | 489 |
| 7 | In extreme detail, what are the laws of meat and milk? | 81 | 386 | 371 | 546 |
| 8 | Elaborate: what does the Rambam teach about teshuvah? | 93 | 599 | 387 | 549 |
| 9 | *(follow-up)* explain in more depth | 88 | 489 | 330 | 520 |
| 10 | *(follow-up)* answer in a long answer | 53 | 509 | 454 | 552 |
| | **Median** | **88** | **509** | **362** | **546** |

Gemini before: 8 of 10 answered, two refused as off-topic ("Bereishit chapter 1 in detail", "the Pesach seder in great detail"). After: 10 of 10 answered on both providers, none refused. Five answers still fall under the 450-word target (Gemini #1, #2, #5, #7 at 347-429 words, Claude #5 at 373): the target is a floor the prompt asks for, not one the models always reach.

Time to a finished answer, same runs: Gemini 3-6 s, Claude 12-25 s. Long answers cost more output tokens but the Gemini median did not leave single-digit seconds.

## The fix (`backend/claude.py`)

- `wants_long_answer()` recognises an explicit request for length or depth in English and Hebrew: "in depth", "in detail", "elaborate", "a long/detailed/full answer", "at length", "go deeper", "tell me more", "more", "pasuk-by-pasuk / verse-by-verse / line-by-line", "whole commentary", "everything about", "בהרחבה", "לעומק", "תשובה ארוכה". Plain "explain", "why" and "how" are not requests for length, and neither are "How deep is a mikveh?" or "Which verse is the Shema?".
- `question_profile` never calls such a question simple and gives it a new `LONG_ANSWER_MAX_TOKENS = 4096` ceiling (a study request keeps its 6144).
- `_model_call_extras` now passes the study and long ceilings to both providers, so the ceiling reaches the model.
- `build_prompt` has a "LONG ANSWER FORMAT" (at least `LONG_ANSWER_MIN_WORDS = 450` words: the direct answer first, then short headed sections, what each authority says, where they differ, what follows) and a follow-up instruction: a question that only asks for a different length or form is about the subject of the last answer and is never "empty" or off-topic.
- The core system prompt says an explicit request for length outweighs the default of answering at the size asked.
- A long answer is now kept whole for its follow-up: `HISTORY_ASSISTANT_TURN_CHARS` 2400 → 4500 and `HISTORY_MAX_TOTAL_CHARS` 9000 → 16000 (older turns are still dropped first).
- `PROMPT_VERSION` is `2026-10-22-long-answers-v9`.

## Tests

`tests/test_long_answers.py` (59): 19 requests for length are recognised and 11 ordinary questions are not; a long request is never simple and gets the long ceiling; a study request keeps the study ceiling and gets the word floor; the prompt for a long request, an everyday question and a bare follow-up; the ceiling reaches both model calls (Gemini first, then the Claude fallback, each with the thread's earlier turns); a 4,000-character answer is still whole in the next turn's history.

## Known limits

- The model decides how long "long" is: 347-777 words on Gemini, 373-670 on Claude. A reader who wants more can ask again ("go deeper" keeps working), and a study request has the 6144 ceiling.
- The evals are single runs on live models, so a word count moves by roughly ±15% between runs; the before/after gap is more than five times that.

## Not verified

The live site after deploy; Safari/iOS.
