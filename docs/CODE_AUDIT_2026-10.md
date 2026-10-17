# Code audit, October 2026

Scope: backend, tests, CI and SonarCloud. Visual/UX and security findings were left to their own passes
(one security commit, `bd7be17`, landed from that pass while this one ran).

Everything below was reproduced, not guessed. A change that alters behaviour carries a regression test that
fails on the old code. Eleven fix commits came out of this pass: nine are already on `origin/main` (up to
`bd7be17`), two (`ec28776`, `0b882c3`), this report and the jsdom test commits (section 1) are local and unpushed.

## 1. SonarCloud quality gate: still red, and two things block it

| Condition | Server value (last analysis) | Needed |
|---|---|---|
| new reliability rating | 4 (23 open BUGs) | 1 |
| new coverage | 72.8 % (70.8 % by line count); about 86 % projected with the jsdom tests, see below | 80 % |
| duplication, maintainability, security, hotspots | OK | OK |

- **The server still shows the pre-fix state.** SonarCloud's last analysis is `e7fb5c1` (2026-10-14), and the
  `f2a63d5` CI run failed before reaching the scanner (the Gemini time bomb, fixed in `106c8d9`). The run for
  `bd7be17`, the first that carries the BUG fixes (`d7416a3`), was still in progress when I wrote this. When it
  finishes, the reliability rating should go to 1; I could not confirm that from here.
- **`SONAR_TOKEN` is not set in this shell** (checked in a login shell too), so I could not run
  `sonarqube-scanner` with `-Dsonar.qualitygate.wait=true`. Everything about the gate was read from the public API.
- **Coverage is met with tests, not an exclusion.** 27,008 lines counted as new code and 7,874 were uncovered; four
  files held most of the gap, all at 0 %: `static/js/shell.js` (5,584 executable lines), `conversation-ui.js`
  (1,332), the two `scripts/build_*.mjs` (382) and `citation-popover.js` (134). A jsdom harness now runs the real
  scripts on the real home page:

  - `tests_js/helpers/shell_page.js` boots `GET /` (stored in `tests_js/fixtures/index_page.txt`, regenerated with
    `python scripts/build_shell_dom_fixture.py`; `tests/test_shell_dom_fixture.py` fails, naming that command, when the
    template and the fixture drift) and runs the classic scripts in it with a routed `fetch`;
    `conversation_page.js` installs the Ask panel on it with a manual clock and a recording conversation API.
  - 128 tests in six files (`shell_*.test.js`, `conversation_ui.test.js`) in the first round; `jsdom` is the only new
    dev dependency. The follow-up pass (section 6) grew the suite to 1,470 `node --test` tests.
  - Measured in the lcov that `npm run test:coverage` writes, at the end of the follow-up pass: `shell.js` 97.1 % lines
    (84.1 % branches), `conversation-ui.js` 99.7 %, `citation-popover.js` 98.8 %, `scripts/build_assets.mjs` and
    `build_critical_css.mjs` 100 %. The first-round figures were 61 % and 86 %. Without `SONAR_TOKEN` I still cannot run
    the scanner, so the first CI scan after a push is the real answer, but the margin over 80 % is now wide.
  - Left uncovered in `shell.js` (the long tail, mostly one-line guards and error branches): the lines listed in the
    lcov, plus `reader-ui.js` at 83.7 %. Nothing in the gate depends on them.
  - **Dead UI found while writing them:** `shell.js` had handlers for a verse-compare strip, the community-timeline modal
    and the source-graph modal whose markup is not in `templates/index.html`. Removed in `f9d1462`.
  - **`maybeShowTip`** skipped the discovery tip for the rest of the page's life if a menu was open when its timer fired.
    Fixed in `5b61a38` (the tip now waits for the menu to close), with a test.

## 2. Fixed (small commits, each with its test)

| # | Impact | Finding | Commit |
|---|---|---|---|
| 1 | CI red for every PR | A test opened the Gemini circuit outside the frozen clock, so it failed once the real clock crossed a boundary (red since 15:35 UTC). | `106c8d9` |
| 2 | 14 routes 500 + error-bot page | `request.get_json(silent=True) or {}` then `.get()` on a body of `[1]`, `"x"` or `5`: AttributeError, 500, alert. Routes: `/ask`, `/set_location`, four conversation routes, client-errors, devtools segment-report, feedback, export, delete-account, accept-legal, preferences, semantic bookmarks. Now `helpers._json_object_body()`; a non-object body gets the same answer as `{}`. | `c00e2c3` |
| 3 | Conversations list 500s | `?limit=abc` raised ValueError; a citation `ordinal` that is huge or non-numeric broke the insert. Both now fall back safely (`routes_conversations.py`, `_coerce_int`, `_citation_ordinal`). | `aca8f34` |
| 4 | Event loop stalls when Gemini fails | The error that opens the cooldown also writes it to Redis (`health_check._publish_cooldown`, 2 s connect + 2 s socket timeout). The async Gemini call recorded it with a bare call on the loop (`claude.py`, `_call_gemini_httpx_model`). Now `asyncio.to_thread`, like `is_healthy`. Regression test fails on the old code. | `ec28776` |
| 5 | Time bomb, fires 2027-01-01 | A calendar test pinned the year 2026. | `7a70d54` |
| 6 | Price drift | The per-ask budget reservation had its own copy of the Haiku prices; it now reads the price table (`cost_meter.py`), with a test tying it to the fallback model. | `074a6ed` |
| 7 | Redundancy | Two unreferenced definitions removed; four env vars that code reads were missing from `docs/ENVIRONMENT.md`. | `6492a27` |
| 8 | Sonar | 23 BUGs; 74 `S9073` + 9 `S5778` test smells; most cheap Python smells; seven `S8786` regexes (each with a differential test); two `S2699` BLOCKERs (`tests_js/answer_link.test.js`, `answer_share.test.js`). | `d7416a3`, `3710669`, `b325aad`, `0b882c3` |

## 3. Needs your decision (not fixed: unprovable here, or a design call)

1. **Agent loop's forced final round** (`ask_pipeline.py:148`, `claude.py:3108-3112`). The last round sends no `tools`
   while `messages` still carries `tool_use`/`tool_result` blocks. As far as I know the Anthropic API rejects that
   shape, which would turn every answer that used all three tool rounds into the provider-unavailable fallback.
   I could not confirm it without a live call (no AI budget spent), and `AI_AGENTIC_TOOLS` defaults to off. If you
   turn it on, make one live call first; the fix is to keep `tools` and send `tool_choice: {"type": "none"}`.
2. **Rate limiter `INCR` then `EXPIRE`** (`rate_limit.py:416-422`). If the process dies, or `EXPIRE` fails, between the
   two calls the counter has no TTL and that client is blocked for good. Fix is one atomic step (`SET NX EX` then
   `INCR`, or `EXPIRE ... NX`); it needs a live Redis/Upstash check, so I left it.
3. **Global cost breaker** (`cost_meter.py:374-430`). A failed Supabase read is cached as `$0` for 30 s, so a DB blip
   briefly disables the breaker. The page fetch (`:268-290`) uses `.range()` with no `.order()`, so rows can be
   skipped or double-counted under concurrent inserts, and it scans O(rows) per refresh. A SQL `SUM` RPC fixes all three.
4. **`TTLCache`** (`cache.py:174-186`, `:218-224`). A Redis hit is back-filled with the default TTL rather than the
   remaining one, and `delete()`/`clear()` leave the Redis tier alone. Latent today (no caller relies on either).
5. **Conversation writes** (`routes_conversations.py:444-464`): the message and its citations are two inserts, not
   one; and two racing retries of the same ask can store two replies. Needs an RPC or a client idempotency key.
6. **Dead code that has tests** (production never calls them): `ask_pipeline._build_agentic_system_text`,
   `claude.get_dispatchable_models`, `claude._get_client`, `device_identity.is_device_owner`,
   `siddur_data.find_by_ref`, `siddur_lines.build_lines`/`english_is_aligned`, `search_provider._match_corpus`/
   `_build_last_resort_web_sources`, `text_engine._format_ui_answer`, `app._gather_ask_question_context_futures`.
   Deleting each means deleting its tests, so I left them.
7. **Sonar leftovers:** the first pass left about 390 JavaScript smells, 22 Python `S3776`, `S8786`/`S5843`, `Web:S6819` x17,
   `Web:S7927` x22 and `css:S9423` x701. Section 6 says which of these were fixed afterwards and which are still open.
8. **Build hygiene:** `npm run build:css` changes `:where(.space-y-*)` specificity (a stale `.capitalize` rule in
   `tailwind.css` goes with it), and the critical CSS drifts from source at a pristine HEAD. Both need the frontend
   owner; I reverted my rebuild attempts.

## 4. Ruled out (checked, nothing to fix)

- Unused dependencies: none. Orphan modules: none (`ask_pipeline` is live behind the flag; `rag._env_int` is used).
- Blocking calls on the event loop: ran the whole suite with `redis_cache_*`, `time.sleep`, `httpx.Client.send`,
  `requests` and `urlopen` instrumented to flag any call made from a running loop. Only hit in production code: #4 above
  (the Flask sync pipeline blocks by design and is unreachable behind the ASGI mount).
- Input handling: 2,196 hostile requests over every Flask rule, 46 hostile `/ask` bodies over ASGI, and 204 calendar
  requests at the poles and date extremes produced no unhandled exception and no input-driven 5xx.
- Missing HTTP timeouts, swallowed exceptions, N+1 queries, timezone-dependent tests, iCloud conflict copies:
  none found. The Gemini cooldown (`health_check.py`, `claude.py`) has no provable defect; share routes are sound.
- Prod `/docs`, `/redoc`, `/openapi.json` answer 404.

## 5. State at the end of the first pass

`pytest` 5,529 passed at 99.51 % backend coverage (gate 85 %), run after rebasing onto `2eb2a08`; `ruff check .`
clean; `node --test` 837/837 (709 before the jsdom tests); `tests/test_shell_dom_fixture.py` passes. The follow-up
pass below starts from `f3861a1`, which was pushed.

## 6. Follow-up pass (2026-10-17): the Sonar leftovers

All of it is in small commits on top of `f3861a1`; nothing here is pushed yet.

**Fixed**

| Rule | What changed | Commits |
|---|---|---|
| `javascript:S8786`, `S5843`, `S5869`, `S2486`, `S3358`, `S7781`, `S7761`, `S6594`, `S4624` and the other mechanical JavaScript findings | Quadratic regexes replaced by linear ones or by string scans, nested ternaries and empty catches rewritten, `replaceAll`/`at()`/`Number.isNaN` and similar. Each regex change was compared against the old pattern on several hundred thousand generated strings (a throw-away fuzz script, not checked in). | `9c91086`, `7c3df01`, `106a5b1`, `f28bdbe`, `cd48d26` |
| `javascript:S3776` x53 | Long functions in `shell.js`, the router, the siddur reminders, the conversation, ask and zmanim modules and both build scripts split into named helpers; the jsdom suites pin the behaviour. | `fd2e5c9`, `884a372`, `a708ad8`, `c857d56` |
| `python:S8786`, `S5843`, `S5869`, `S1110`, `S5958`, `S3415` | Quadratic patterns replaced by linear code with oracle tests (`tests/test_linear_regex_equivalence.py` keeps the old patterns and checks the new code against them on thousands of generated strings). | `e58fc3e`, `ee7114f` |
| `python:S3776` x22 | `siddur_day` (tachanun exceptions are one month-keyed table; occasions come from per-holiday helpers, compared against the old code for every day of 1900-2099), `siddur_lines`, `build_siddur` (`_check_curation` / `_build_section` / `_check_slugs` / `_build_service` / `_content_version`; same output and the same `SystemExit` messages on eleven cases), `sidebar_bundle`, `routes_spa_paths`, `app.py` (cache tiers, primary-source collection), `claude.py` (history, Gemini fallback, prompt lines), `ai_tools`, `customs`, `rag`, `routes_community`, `routes_conversations`, `sefaria_library`, `crawl_library_leaves`, `verify_conversations_migration`. | `b00b65f`, `f454d23`, `38a94ba`, `d078009`, `30c0600` |
| `css:S4666` x2, `plsql:S125` | Two duplicate selectors merged (minified assets and critical CSS rebuilt); a commented-out SQL read described in prose. | `6b17fd0`, `2f6752a` |
| `Web:S7927` x13 | Icon-only conversation buttons: the `{{ phosphor(...) }}` call is wrapped in the `aria-hidden` `display: contents` span the reader buttons already use (`756e3fb`). The button's `aria-label` is unchanged. The scanner reads the template call as visible text, so this is a markup hint, not a change in what screen readers announce. | `81269b0` |
| Coverage | Two build scripts and the home-page scripts now run under test; see section 1. | many |

**Behaviour differences the regex rewrites accept** (each is a deliberate trade for linear time; none is reachable from
normal text):

- Reference patterns in `shell.js` need the book title to start with a non-whitespace character and no longer treat a
  line terminator specially.
- The tag strippers leave the `<a` of a malformed `<a<b>` in place; the markdown gap between a marker and its text is
  bounded at 64 whitespace characters; a tag name containing a quote differs in the citation-marker TAG pattern.
- The Yiddish verb suffix in `customs.py` is bounded at 30 characters.
- A Mishneh Torah name (`ref_aliases`) can no longer start or end with a space inside the pattern.

**Not fixed, and why**

| Item | Reason |
|---|---|
| `css:S9423` x701 (`!important`) | Mostly in `static/style.css` (573). Removing them is visual work that has to be measured per component in light and dark, Hebrew and English; a separate session was proposed for it. |
| `Web:S6819` x18 | Sonar wants `role="status"` replaced by `<output>`, `role="dialog"` by `<dialog>`, `role="radio"` by `<input>` and `role="group"` by `<fieldset>` and friends. Those swaps change focus, styling and (for `<dialog>`) top-layer behaviour, so they belong with the frontend owner; an earlier pass (`756e3fb`) already converted the status regions where `<output>` was safe. |
| `javascript:S9382` x14 (await in a loop) | Sequential on purpose: the service worker's precache walk goes "one at a time: the reader's own requests go first" (its own comment), `commentary-preload.js` re-checks staleness between neighbour fetches, and the build scripts run their steps in order. `Promise.all` would change load and ordering for a style hint. |
| `text_ssr` footnote regexes (lines 57-58) | They are written to mirror `normalizeDisplayText` in the browser (the module's own comment says "in the same order"); making only the server side linear would risk server- and client-rendered text differing. |
| `loadNextTextChunk` speculative loop, `display_name` city-search edge, `renderAnswerMarkdown` without DOMPurify, the legacy `showSidebars` migration | Design or security calls, noted for their owners. |
| `reader-ui.js` (83.7 %) and the `shell.js` long tail | Not needed for the gate. |

`SONAR_TOKEN` is still not set in this shell, so I have not seen the quality gate after these commits; the Python
cognitive-complexity counts were checked with a local approximation of the rule, which cannot confirm them. The first CI scan
after a push is the check.
