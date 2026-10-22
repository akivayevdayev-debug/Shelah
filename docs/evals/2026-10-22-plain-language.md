# Eval: plain language (2026-10-22)

**The report.** Answers in the flagged conversation used fancy wording ("noble concern", "perpetually purified", "structurally between…") and spelled one source two ways ("Unkelus" echoed from the reader, then "Targum Onkelos"). The goal is plain language for an adult who has never studied the subject, without losing the content.

## What was wrong

Nothing in the prompt asked for plain language, and the core prompt called the model a "scholarly halakhic synthesis engine". The model matched that register and repeated the reader's spelling of a name.

## The fix

- **Core prompt: a "Style (plain language)" paragraph.** Write for an adult who has never studied the subject; one idea per sentence, mostly under 25 words, a full stop instead of a semicolon, a dash or a second "which"; everyday words ("forbidden", not "proscribed"); a short list of words not to use; explain each Hebrew or Aramaic word the first time, then keep that word; spell each name one way (Onkelos, Rashi, Ibn Ezra, Shabbat, Hashem); say what the source says before what it means.
- **Simple-question format:** a Style line, "2-5 sentences, each under 25 words", and no section headings inside the ruling.
- `PROMPT_VERSION` is `2026-10-22-plain-language-v14`.

## Method

`scripts/eval_ai_quality.py style` asks 10 ordinary questions plus the eight turns of the flagged conversation, in process, on the real models (the harness turns off Supabase, Sentry and the shared Redis). Gemini and Claude were run separately, each before (commit `4972344`) and after.

Two measurements:

1. **Counts** from the answer text: average sentence length in words, share of words of nine letters or more, a list of fancy words. They are crude: a list or heading with no full stop counts as one very long sentence.
2. **Blind, criteria-based judging** (`scripts/judge_readability.py`). For each question the before and after answers are shown to `claude-haiku-5-5` as A and B in a seeded random order, with no hint of which is which. The judge scores each from 1 to 5 on five criteria (plain words, short sentences, terms explained, consistent spelling, no padding) and says which an adult who has never studied the subject would find easier to read. A refused answer or an error is left out of the pair.

## Results

| | Gemini before | Gemini after | Claude before | Claude after |
|---|---|---|---|---|
| Average sentence, 10 questions (words) | 54.6 | 34.5 | 39.3 | 30.0 |
| Average sentence, flagged conversation (words) | 52.9 | 72.2 (see below) | 32.2 | 20.0 |
| Words of 9+ letters, questions | 13.0% | 11.3% | 7.7% | 5.4% |
| Words of 9+ letters, conversation | 14.1% | 14.2% | 6.3% | 4.4% |
| Refused although in scope | 3 | 0 | 0 | 0 |

Blind judging (mean of 1-5, before → after):

| Criterion | Gemini (15 pairs) | Claude (17 pairs) |
|---|---|---|
| Plain words | 2.40 → 2.93 | 2.47 → 3.53 |
| Short sentences | 2.33 → 3.00 | 2.29 → 3.71 |
| Terms explained | 1.73 → 1.87 | 1.82 → 2.12 |
| Consistent spelling | 3.67 → 4.33 | 3.71 → 4.06 |
| No padding | 2.60 → 3.40 | 2.65 → 3.18 |
| Judged easier to read | after 10, before 5 | after 14, before 3 |

Gemini's three "before" refusals ("Explain the story of Korach" and two length requests in the conversation) are the false refusals fixed under [refusals](2026-10-22-refusals.md); their pairs are not in the judging.

## Reading the numbers

- Claude improved clearly on every measure, and the blind judge preferred the new answers 14 times out of 17.
- Gemini improved less. The judge preferred the new answer 10 times out of 15 and scored every criterion higher, but the gain in "terms explained" is small. The 72-word "sentence" in Gemini's conversation row is a measurement artefact: its long answers use lists and headings without full stops, and the counter reads each as one sentence. Across the three Gemini runs of the final prompt the figure ranged 39 to 72 for that reason, so do not read it as a real worsening; the judge's "short sentences" score (2.33 → 3.00) is the better evidence.
- "Terms explained" is the weakest criterion for both models (about 2 of 5 after). The prompt asks for it and the models do it for the first Hebrew word but not for every one.

## Tests

`tests/test_plain_language.py` (4): both system prompts ask for plain language; the core Style paragraph names the words to avoid, the sentence size and the spellings; the Style paragraph comes before the answer shapes. Wording quality cannot be unit-tested; the evals above are the evidence.

## Known limits

- The judge is `claude-haiku-5-5`, the same model family as the Claude answers, so it may like Claude's style a little more than Gemini's. The order was random and the judge was told nothing about which answer was which.
- Single runs on live models, 10 questions and 8 conversation turns per provider. They show the direction and size of the change, not a guarantee for every question.
- A reader who asks for a scholarly register ("answer like a rosh yeshiva") is not prompted to get one; the style paragraph is the default.

## Not verified

The live site after deploy; Safari/iOS.
