# Eval: web search on trusted sites (2026-10-22)

**The brief.** When the Sefaria, commentary and customs context cannot settle a real-world fact ("is this gum kosher?"), the AI may look it up on the web, but only on a short list of Orthodox sites, with the pages shown to the reader as "From the web". The owner approved the list on 2026-10-22 and the lookup stays on.

## What changed

The last-resort lookup (`backend/web_lookup.py`) used Gemini with Google Search grounding. That could not be limited to a list of sites, and Gemini returns redirect addresses from `vertexaisearch.cloud.google.com` instead of the real pages. It now uses Claude (`claude-haiku-5-5`) with Anthropic's `web_search` tool, which takes `allowed_domains` and returns the real page addresses. The answering model is unchanged: Gemini or Claude writes the answer; Claude only does the lookup, the same way for both.

| Part | How |
|---|---|
| Allow-list | `web_lookup.ALLOWED_DOMAINS`: sefaria.org, chabad.org, ou.org, oukosher.org, star-k.org, crcweb.org, kashrut.com, yeshiva.co, din.org.il, halachayomit.co.il, dailyhalacha.com, torahanytime.com, aish.com, yutorah.org, hebcal.com. Sent to the tool as `allowed_domains` |
| Server-side filter | `page_allowed(url, title)` runs on every page the tool returns and every page the answer cites: https only, no credentials in the address, port 443, host equal to or under a listed domain (after dropping `www.`), and not denied by `text_trust.is_source_denied`. If any single page fails, the whole lookup is dropped and the answer is written without the web (fail closed) |
| Cost and time | thinking off, at most two searches, 900 output tokens, a 20-second limit, and the lookup is skipped when under 25 seconds of the 45-second AI budget remain. Cost is tokens plus $0.01 per search, recorded through `record_llm_call(extra_cost_usd=...)` |
| What the model sees | page text as `<retrieved_context source="web_lookup_last_resort">`: untrusted, run through the retrieval guard (`withhold_injected`), titles only, no links in the prompt |
| What the reader sees | each cited `Web: <page> — <note>` source becomes a row with a "From the web" badge, a link (`target="_blank" rel="noopener noreferrer"`) to the page, and the line "From the web, not from a Jewish text. Check it with the certifying agency or your rabbi." (Hebrew too). The row opens no source reader. The answer still starts with the web-last-resort warning |
| Where the addresses travel | `meta.web_sources` (`[{ref, title, url}]`) for the search bar; the citation `url` for a conversation turn |
| Client check | `static/js/source-cards.js` shows a link only for an https address on its own copy of the list (`WEB_SOURCE_DOMAINS`), so a wrong address from the server is shown as plain text. A test keeps the two lists equal |

Only the pages the answer cites are shown. A page the search merely returned is not listed as a source.

## Method

Live calls to `web_lookup.lookup_async` on this computer with Sentry, Supabase, Redis and Discord turned off:

| Query | Time | Result |
|---|---|---|
| Is Trident gum kosher | 5.5 s | Reported that no approved page confirms Trident itself; cited general gum guidance from oukosher.org, crcweb.org and star-k.org |
| Does Oreo have an OU hechsher | 5.2 s | "Yes, usually OU-D, varies by variety"; cited an oukosher.org FAQ on Oreo and a kashrut.com alert |
| Is Impossible Burger kosher | 4.5 s | Certified OU, parve; cited oukosher.org |
| Is the XJ-9000 snack bar certified kosher by the Star-K (invented product) | 3.9 s | "I found no evidence"; no invented certification |
| What is the best pizza place in Brooklyn (off-topic) | 5.8 s | Said the sources cannot rank restaurants; cited an OU article and kashrut.com |

Every address was an `https` page on the list. Earlier runs in the same session gave 5.5 to 13 seconds and a "cannot find it" report with no cited pages.

## Tests

`tests/test_web_lookup.py` (75): `page_allowed` for each rule (http, userinfo, port, look-alike hosts such as `oukosher.org.evil.example` and `notoukosher.org`, an allowed address inside another site's query string, subdomains, `www.`, denied publishers, the JS list equal to `ALLOWED_DOMAINS`); the search response parsers; fail-closed when one returned or cited page is off-list; only cited pages become sources; the request carries `allowed_domains`, thinking off and the cost extra; a timeout, an API error, a missing key and an empty result each return nothing; `cited_pages` matches `Web:` citations by title, site name or sole page. `tests/test_text_trust_routes.py` (a denied publisher is dropped, an allowed one kept), `tests/test_anthropic_model_pin.py` (the lookup is the third Anthropic call site and sends nothing Haiku 5.5 rejects), `tests/test_ask_payloads.py` and `tests/test_ask_transport_parity.py` (`meta.web_sources` on both transports). Client: `tests_js/source_cards.test.js`, `tests_js/conversation_store.test.js`, `tests_js/conversation_ui_answers.test.js` (badge, link attributes, notice, unsafe address shown as plain text, address matched from `meta.web_sources`).

## Known limits

- The model decides which pages to cite. A cited page can be general guidance rather than proof (the Trident and the invented-product probes each cite a general article). The "From the web" note says to check with the certifying agency or a rabbi.
- Search quality is Anthropic's. A site on the list can return old pages (the Brooklyn pizza answer says its information is dated).
- A search-bar answer reloaded from history shows its `Web:` rows without a link: the address is not stored with the saved answer. A conversation turn stores it.
- Web search must be enabled for the Anthropic organisation. If it is not, every lookup fails and the answer is written without the web, with no visible error.
- The lookup sends Anthropic only the short phrase the model wrote (links, emails and 7+ digit numbers are refused). The privacy page and `docs/PRIVACY_OPERATIONS.md` now name Anthropic, not Google, for it.
- Five probes, one run each; they show the shape, not a quality guarantee.

## Not verified

The live site after deploy; Safari/iOS; an answer rendered end to end in a browser with a real web lookup (the rows are covered by jsdom tests and the lookup by the probes above).
