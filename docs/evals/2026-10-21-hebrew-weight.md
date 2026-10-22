# Eval: Hebrew text set too bold (2026-10-21)

**The report.** Hebrew looks too bold next to the English.

**What was wrong.** Three things stacked, each measured:

1. **Fake bold on Ezra SIL.** Ezra SIL, the face for Hebrew text and prayers, ships one weight. Anything the page set to bold in it (a prayer heading, a commentary's opening words, a bolded term in a source) got a bold smeared on by the browser: about 40% more ink on a face that already sets darker than Cardo, the English face.
2. **A stroke on top of the fake bold.** `style.css` added `-webkit-text-stroke: 0.05em` to Hebrew emphasis *and* asked for `font-weight: 700`. The comment above it assumed the browser's bold was nearly invisible, so the stroke alone was meant to give the weight. It isn't invisible, so the two added up.
3. **Cardo's partial Hebrew bold.** Hebrew titles set in Cardo (home topic and library titles, the AI tip and empty-state titles, `.prose` headings) asked for bold, and Cardo Bold covers only part of the Hebrew block. A title came out with a few heavy letters among regular ones.

The conversation panel had its own `0.05em` stroke on Hebrew answers and titles, about 1.6 times the ink of the text beside it.

## Method

A throwaway puppeteer probe (headless Chrome, a local dev server, the service worker bypassed) rendered each pattern and measured **typographic colour**: the ink in a per-element screenshot divided by the element's box, normalised by the span between its text and background luminance, so light and dark are comparable. It also read the computed font family, weight and stroke, and `CSS.getPlatformFontsForNode` for the face actually used.

The target is English bold on regular in Cardo: **about 1.30 to 1.40 times the ink**. Each row below is the Hebrew emphasis against the Hebrew text beside it (reader, AI source, conversation) or the Hebrew heading against the English heading beside it (prayers). Light and dark came out identical.

## Results

| Pattern | Before | After | Target |
|---|---|---|---|
| Reader `<b>` in Hebrew text | 2.20× | 1.39× | English bold: 1.35× |
| AI source box `<b>` | 2.08× | 1.34× | 1.30–1.40× |
| Conversation answer `<strong>` | 1.61× | 1.30× | 1.30–1.40× |
| Prayer heading, Hebrew against the English heading beside it | 1.56× | 1.07× | 1.0× |
| Computed stroke, reader `<b>` | 0.95px | 0.475px | |

Home topic and library titles in Hebrew now set at weight 400 with a thin stroke instead of Cardo bold. Their ink went up about 25% (0.028 to 0.035, 0.064 to 0.084, 0.019 to 0.025 on the probe's scale), which is the point: every letter now has the same weight, where before some had a real bold and some did not.

## The fix (CSS only)

- `html { font-synthesis-weight: none; }`: the browser never invents a bold. Every other face the page uses has a real bold, so only Ezra SIL is affected.
- `--he-emphasis-stroke: 0.025em` in `tokens.css`: Hebrew emphasis is a thin stroke in the text colour over the regular face. One token, used by `style.css` and `conversation.css`.
- Under `html.rtl`, the Cardo titles use weight 400 plus that stroke.
- `tests_js/hebrew_weight_css.test.js` pins the three decisions (no synthesized bold, one token, no literal stroke, no bold on top of a stroke). All six checks fail on the old CSS and pass on the new.

## Left alone, on purpose

- **Hebrew inside the Inter stacks** (buttons, labels, menus). Inter has no Hebrew, so the system face draws it, and its bold is a real one. A stroke on small labels would blur them.
- **Mixed Latin and Hebrew titles in the English UI**, such as "Lech-Lecha · לך לך". The Cardo rule is under `html.rtl` only, so the partial Hebrew bold remains there. Switching them would change the English half too.
- **Ezra SIL itself is darker than Cardo** (about 1.47× the ink of the same line in regular). That is the face's design, so plain Hebrew text is unchanged.
- **`.siddur-section-title` and `.siddur-label`** asked for bold in Ezra. They now render in the regular face, because of the global rule. Regular Ezra already sets about as dark as the English bold beside it (the prayer headings above, 1.07×), so they were not given a stroke. Not measured on its own.

## Not verified

Real Safari/WebKit and real iOS: Playwright WebKit is not installed here, so neither `font-synthesis-weight` nor the stroke was measured there, and those engines draw Hebrew in their own system faces. If an engine ignores `font-synthesis-weight`, Ezra emphasis falls back to the old synthesized bold plus the thinner stroke, which is still lighter than before.
