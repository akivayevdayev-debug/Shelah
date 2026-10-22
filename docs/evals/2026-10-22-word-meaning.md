# Eval: word meaning (2026-10-22)

**The report.** Selecting a Hebrew word in the reader showed Hebrew prose with footnote markers, a machine translation ("and the country"), or nothing.

**What was wrong.** `/api/word/meaning` asked Sefaria's lexicon endpoint, which returns every lexicon at once, and took the first definition it could find:

1. It was often Ben Yehuda: a paragraph of Hebrew prose with footnote markers, shown as the meaning (7 of 18 words).
2. When no lexicon text survived, the word was sent to Google Translate. That gave a literal rendering of the form, not the word: `וַיֹּאמֶר` "and said", `אֱלֹהִים` "god", `וְהָאָרֶץ` "and the country", `לכל` "per", `ויהי` "it came to pass" (5 of 18).
3. A prefixed or inflected form (`ושמרו`) was looked up as written and not found.
4. Homographs were mixed: BDB lists `כִּי` as "burning, branding" before "that".

## Method

Reproduced against a local server with 18 real words from Genesis 1 and the Shema (`/api/word/meaning`, GET), then read Sefaria's lexicon answers for them (GET, one second apart) and saved the entries the code uses as `tests/fixtures/sefaria_lexicon_words.json`.

## Before and after (live Sefaria, 18 words)

| Word | Before | After | From |
|---|---|---|---|
| בראשית | Hebrew prose: `['* 1מן ראשית, עם ב השמוש, ש…` | Genesis — name of the first book of the Pentateuch | Klein |
| וַיֹּאמֶר | and said *(machine translation)* | And he said | glossary |
| אֱלֹהִים | god *(machine translation)* | gods | Klein |
| הַשָּׁמַיִם | Hebrew prose: `['1[המלה משֻתפת לכל להגי השפ…` | visible heavens, sky | Klein |
| וְהָאָרֶץ | and the country *(machine translation)* | earth | Klein |
| בָּרָא | create | create | BDB (pointed match) |
| שלום | well-being, or greeting | well-being, or greeting | glossary |
| מלך | Hebrew prose: `['2שרש משֻתף בכל הלשונות השמ…` | king, sovereign | Klein |
| תורה | the Five Books of Moses and Torah teaching | same | glossary |
| שבת | the seventh day of rest | same | glossary |
| לכל | per *(machine translation)* | all, whole, the whole of | Klein |
| ושמרו | not found | to keep, to heed, watch over, guard, to observe | Klein |
| מצוה | a divine commandment | same | glossary |
| כי | Hebrew prose: `['1מלה קדומה בהלשון השמית הכ…` | that | Klein |
| אשר | Hebrew prose: `['2נחלקו החכמים במהות שרש זה…` | who, which, that, that which | Klein |
| ויהי | it came to pass *(machine translation)* | And it was | glossary |
| ברית | Hebrew prose: `['1מלה עברית ואין אחות לה בש…` | covenant, treaty, alliance | Klein |
| אדון | Hebrew prose: `['1זו מלה כנענית ועברית, כי …` | lord, master, possessor | Klein |

Before: 7 prose, 5 machine translations, 1 not found, 5 correct. After: 18 short English glosses, none of them prose or machine-translated. Eight more words from the first chapters and the Shema (`אֵת`, `וְאֵת`, `אוֹר`, `אֶחָד`, `יִשְׂרָאֵל`, `שְׁמַע`, `וְאָהַבְתָּ`, `מְאֹדֶךָ`) all answered; the last two were "not found" until the verb and possessive endings were added.

## The fix (`backend/helpers.py`)

- **Where a meaning comes from.** The curated glossary, then Sefaria's Klein, BDB Augmented Strong, Jastrow or BDB lexicon, in that order. Ben Yehuda's prose and the Aramaic BDB are never shown, a machine translation is never used, and commentary is never consulted. A word none of them knows is "not found" (the panel says "No definition found"). These four lexicons are the allow-list; `_PREFERRED_LEXICONS` is where it is kept.
- **A short gloss.** HTML tags and entities, parenthetical notes, part-of-speech labels and cross-references ("= שמר", "see…", "prefix…") come out. A dense BDB or Jastrow sense is cut at its first clause. At most three distinct senses, at most 90 characters, cut at a word boundary. A sense that is mostly Hebrew is not a gloss.
- **Base forms.** The word is tried as written (marks and cantillation stripped), then with its prefix letters ו ה ב כ ל מ ש taken off one at a time, each also without its plural, possessive or verb ending (ים ות תי תם נו כם הם ו ה ך ת י), and a future-tense verb without its י ת נ א (`ויאמר` → `אמר`). The written form always goes first, so a word the lexicon knows is never replaced by a shorter one. A plural noun keeps its first letter (`ימים` is not `מים`).
- **Pointed words.** A word selected with its vowel points is matched to the lexicon entries pointed the same way, so `בָּרָא` ("he created") is not answered with its homograph `בְּרָא` ("son"). The matching entries come first and the rest of the lexicon follows as other options.
- **Homographs** are other options, not the meaning: `ברית` is "covenant, treaty, alliance", with "lye; soap" as another option.
- **No false transliteration filter on lexicon text.** The check that screens glossary and machine output for transliterations (`ee`, `sh`, …) dropped real English glosses ("week", "sheep", "three"); lexicon glosses skip it.
- Three narrative words the lexicon cannot resolve (`ויאמר`, `ויאמרו`, `ויהי`) are in the curated glossary, which is what the machine translation was standing in for.
- **Client.** A 404 for a word is a result: when the panel is open for commentary, the Word Meaning card reads "No definition found" (Hebrew: לא נמצאה הגדרה). With no commentary it stays closed as before.

## Tests

- `tests/test_word_meaning_lexicon.py` (46): the 11 fixture words with their pointed forms through the route, plain short English, pointed-entry matching, fallback to the letters, no machine translation, 404 for an unknown word, `_clean_lexicon_gloss` cases, base forms and the glossary words.
- `tests_js/shell_selection_insights.test.js`: "No definition found" beside the commentators, and no card on its own.
- `tests/test_helpers.py`, `test_helpers_extra.py`, `test_cov_search_helpers_misc.py`, `test_search_provider.py`: the tests of the removed prose and machine-translation path are replaced by tests of the new one (including that no translation is ever requested).

## Known limits

- A selected word with a possessive or other ending is looked up by its base, so the first sense shown is the lexicon's first, not necessarily the one in context: `מְאֹדֶךָ` ("your might") shows "to increase" first and "strength, might, power; very, greatly, exceedingly" as the second option.
- `שְׁמַע` matches Klein's entry for "Shema" (the prayer) and shows "to hear" as the second option.
- Aramaic and Talmudic words fall to Jastrow's dense text when Klein lacks them; the cut-at-first-clause rule keeps these short but they are less polished than Klein's.
- Sefaria's lexicon endpoint is called per base form, up to eight, with bounded parallelism and stopping at the first hit; answers are cached per word in the bounded in-process cache.

## Not verified

The live site after deploy; Safari/iOS.
