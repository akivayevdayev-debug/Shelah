# Eval: Orthodox-only texts and the version picker (2026-10-21)

**What changed.**

- `backend/text_trust.py` decides which Sefaria versions and works may be shown. The list is in `data/text_versions.json`. Every entry has a reason. The full list is in [2026-10-21-text-trust-lists.md](2026-10-21-text-trust-lists.md).
- Each book defaults to the Orthodox version closest to the reader's community. Sephardi is the default.
- The reader settings menu has a version picker. It remembers a pick for each book.
- Denied content is filtered on every route that reads from Sefaria. Those routes are the reader, links/graph, sidebar, search, verse search, category lists, the AI's retrieval and the AI's web lookup.
- A version that isn't on the list is hidden. This fails closed. The one exception is a work's own Hebrew original (`isSource`), which shows as "Original text".

## Method

1. **Fixture.** `tests/fixtures/sefaria_versions.json` holds the real version lists of 15 books, taken from Sefaria on 2026-10-21. The books cover each category: Tanakh, Mishnah, Bavli, Yerushalmi, halacha, Rambam, commentary, siddur, musar.
2. **Live sample.** I sampled 35 more books live. These were GET requests only, spaced 1.5s apart.
3. **Route tests.** `tests/test_text_trust_routes.py` mocks every Sefaria endpoint so it returns allowed items mixed with denied ones. It then asserts that no denied marker reaches any route or the AI context.
   - Turning the filter off makes 12 of these tests fail.

## Defaults per book (fixture)

P/L/D/U = preferred / listed / denied / unknown versions.

| Book | Versions | P/L/D/U | Sephardi Hebrew | Sephardi English | Ashkenazi English |
|---|---|---|---|---|---|
| Genesis | 55 | 7/8/40/0 | Aleppo Codex (Masorah) | Orthodox (Koren) | Ashkenazi Orthodox (Metsudah) |
| Isaiah | 19 | 5/4/10/0 | Aleppo | Koren | Koren |
| Psalms | 24 | 5/5/14/0 | Aleppo | Koren | Koren |
| Mishnah Berakhot | 14 | 4/4/6/0 | Torat Emet | Steinsaltz (Koren) | Steinsaltz (Koren) |
| Berakhot | 12 | 4/3/5/0 | Vocalized (Koren) | Steinsaltz (Koren) | Steinsaltz (Koren) |
| Yerushalmi Berakhot | 7 | 4/1/1/1 | Guggenheimer | Guggenheimer | Guggenheimer |
| Shulchan Arukh OC | 21 | 4/4/10/3 | Torat Emet | Feldheim | Feldheim |
| Mishneh Torah, Prayer | 12 | 7/2/3/0 | Torat Emet | Hyamson | Hyamson |
| Rashi on Genesis | 15 | 6/2/5/2 | On Your Way | Silbermann | Metsudah |
| Ramban on Genesis | 11 | 6/4/1/0 | Vocalized text | Chavel | Metsudah |
| Siddur Edot HaMizrach | 11 | 5/4/1/1 | Edot HaMizrach siddur | Sephardi siddur | Koren |
| Kitzur Shulchan Aruch | 11 | 6/3/2/0 | Torat Emet | Metsudah | Metsudah |
| Mishnah Berurah | 12 | 3/4/3/2 | On Your Way | Feldheim | Feldheim |
| Pirkei Avot | 19 | 3/4/12/0 | Torat Emet | after Bartenura | after Bartenura |
| Esther | 29 | 6/6/17/0 | Aleppo | Koren | Metsudah |

**Totals:** 75 preferred, 58 listed, 130 denied, 9 unknown (hidden).

**Why versions were denied.**

- **Language (98).** Most denials are versions in a language the site doesn't show: French, German, Portuguese, Spanish, Russian, Finnish, Yiddish, Esperanto, Polish, Persian, Italian, Ladino and others.
- **The rest:**
  - gender-sensitive renderings (5);
  - Conservative Yeshiva (2);
  - placeholder or test uploads (3);
  - novelty versions (2);
  - one each: Buber-Rosenzweig, Open Siddur experimental, a personal blog, a Renewal excerpt, an HUC thesis, a Rabbinical Assembly responsum, Hadar, Google Translate, Gorfinkle.

**Unknown English, so hidden:**

- Wikisource Shulchan Aruch
- Wiki Translation
- Natan Waingortin
- Corrected Rashi
- Wikisource Mikraot Gedolot
- "Wikipedia, by Musashiaharon"
- Mishnah Berurah 625:1 English
- a Finnish Yerushalmi

## Live sample (35 books)

Every Tanakh book got Aleppo + Koren. Every Mishnah and Bavli tractate got Torat Emet or Koren Vocalized, with Steinsaltz (Koren). No book that has English ended up without an English default.

**Gaps:**

- **Kuzari has no Hebrew.** Its Hebrew editions are translations from Arabic, such as Even Shmuel and Project Ben-Yehuda, and none of them are on the list. To fix it, add Even Shmuel as listed.
- **Some unknown English is hidden, and a few of these might be worth listing:**
  - Kehot's Tanya
  - Sebag's Mesillat Yesharim
  - Friedlander's Pirkei DeRabbi Eliezer
  - Cohen's Orchot Tzadikim
  - En Jacob (Glick)
  - Nataf's Mishneh Torah
- **Two books gave no result:** Daniel timed out, and "Ben Ish Chai" isn't a Sefaria title. Neither is a problem with the filter.

## Caveats

- If our server is down, the client falls back to Sefaria directly and shows Hebrew only. That fallback can't check the deny-list.
- The sidebar bundle uses the default community, because its cache isn't keyed by community.
- The word-lookup lexicons (BDB, Jastrow, Klein) stay allowed.
- When the v2 fallback hits a denied English, it blanks it. It doesn't ask for another version.
- Cassuto, Mishnat Eretz Yisrael, Philo, Josephus and the Apocrypha are left allowed. They are academic or historical, not movement works.
