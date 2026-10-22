# Eval: commentary that arrives in several parts (2026-10-21)

**The report.** A commentary Sefaria splits into several parts showed up as separate entries, each with its own duplicated header.

**What was wrong.** Sefaria links a commentary one passage at a time: "Rashi on Genesis 1:1:1", ":2", ":3". Those passages are one comment on the verse, but the sidebar treated each as a commentary of its own:

1. The chooser listed every passage as a button (Rashi 3, Ramban 4, Ibn Ezra 5 on Genesis 1:1).
2. Opening a passage showed a heading naming only that passage, and a numbered card per line.
3. A reader who opened the verse-level ref got three labelled cards ("1", "2", "3") under one heading, and a second heading for the passage.

## Method

Reproduced in headless Chrome against a local server (`commentary_probe.cjs`, service worker bypassed), then pinned in jsdom with real data: the Genesis 1:1 links and the first 260 characters of every line of Rashi, Ramban and Ibn Ezra (`tests_js/fixtures/commentary_genesis_1_1.json`, read from Sefaria, GET only).

## Before and after (Genesis 1:1, real browser)

| | Before | After |
|---|---|---|
| Chooser, Rashi | 3 buttons | 1 |
| Chooser, Ramban | 4 | 1 |
| Chooser, Ibn Ezra | 5 | 1 |
| Rashi view: headings | 2 (commentator + passage) | 1: `Rashi on Genesis 1:1 · רש"י על בראשית א׳:א׳` |
| Rashi view: cards with numeric labels | 3 (`1`, `2`, `3`) | 0; 3 comments in one block |
| Requests to open Rashi | one per passage | one: `/api/text/Rashi on Genesis 1:1` |

## The fix

- `extractCommentaryRefs` collapses a passage ref to its section (`splitCommentaryPassage`): `…Genesis 1:1:2` → `…Genesis 1:1`, `…Berakhot 2a:1:1` → `…2a:1`, `…Mishnah Berakhot 1:1:3` → `…1:1`. A ref that is not a passage of a commentary (`Onkelos Genesis 1:1`, `Zohar 1:15b:3`, `Penei David, Genesis, Bereshit 1:1-2`) is left alone. Sefaria's Hebrew ref for the section comes from the first passage with its passage numbers cut.
- The passage numbers a verse links are remembered per section (`commentaryLinkedPassages`). A section that belongs to other verses too, such as the Kehot Chumash, shows only the linked passages; a section linked whole shows all of it; if none of the linked numbers match, the whole section is shown rather than an empty block.
- `renderInlineCommentaryLines` draws each comment as a `.commentary-part` (Hebrew paragraph, English paragraph), with no per-passage label or card. Hebrew paragraphs carry `lang="he"`. The heading is one line: English title plus Sefaria's Hebrew ref for the verse, the Hebrew half isolated with `<bdi>`.
- Spacing between comments is `var(--sp-4)` (`style.css`), not a rule per card.
- `backend/sidebar_bundle.py::pick_preload_refs` maps to the same section refs (`passage_parent`), so the preloaded texts are the ones the client asks for. Eight linked passages of four commentaries preload as four texts.

## Trade-off

The parent text is bigger than a single passage. On Genesis 1:1 Ramban (about 210 KB) and Ibn Ezra (about 105 KB) are over the 60 KB preload limit, so they are no longer preloaded and load with one request when opened. Or HaChaim (about 590 KB, 63 comments) did not preload before either. Most verses are far smaller.

## Tests

- `tests_js/shell_commentary_merge.test.js`: 23 tests on the real data (chooser counts, section collapse, ranges, Talmud and Mishnah, non-passage refs untouched, Hebrew labels, one heading, no numeric cards, `lang="he"`, one request, linked-passage filtering). 14 failed on the old code.
- `tests_js/shell_commentary_panel.test.js` and `tests/test_sidebar_bundle.py` updated to the new structure.

## Not verified

Real Safari/iOS (no WebKit here). The sidebar's narrow column is unchanged by this work.
