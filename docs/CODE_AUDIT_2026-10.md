# Code audit, October 2026

> **Scope.** Backend, tests, CI and SonarCloud. Visual/UX and security findings were left to their own passes; the security pass is [`SECURITY_AUDIT_2026-10.md`](SECURITY_AUDIT_2026-10.md) (its commit `bd7be17` landed while this audit ran).
>
> **Method.** Everything below was reproduced, not guessed. A change that alters behaviour carries a regression test that fails on the old code.

## 1. Summary

The audit ran in two passes: the first on 2026-10-16, the follow-up on 2026-10-17. Every commit cited in this report is on `origin/main` (checked against `20c8d3f`).

| | First pass | Follow-up pass | Total |
|---|---:|---:|---:|
| Findings fixed | 8 | 7 | 15 |
| Findings open | 8 | 6 | 14 |

| Severity | Fixed | Open |
|----------|------:|-----:|
| HIGH | 1 | 0 |
| MEDIUM | 3 | 3 |
| LOW | 11 | 11 |

**Severity scale** (the auditor's judgement of the impact if the finding were left alone):

- **HIGH:** blocks delivery or takes a user-facing feature down.
- **MEDIUM:** a reachable path returns an error, stalls, or leaves a safety mechanism weaker than it should be.
- **LOW:** latent, cosmetic, or a maintenance cost.

**SonarCloud quality gate: red when last read, two conditions block it** (section 3). Coverage is now met with tests, not an exclusion. The reliability rating should clear once the analysis of `bd7be17` or later finishes; I could not confirm it from here because `SONAR_TOKEN` is not set in this shell.

**Decisions only you can make:** the eight open items in section 5 (O1 to O8) and the not-fixed items in section 7.

## 2. Findings

"Fixed in commit" lists every commit that carries the fix. "none" means open.

### 2.1 First pass (2026-10-16): fixed

| ID | Severity | Title | Status | Location (file:line) | Fixed in commit |
|----|----------|-------|--------|----------------------|-----------------|
| C1 | HIGH | CI red for every PR: a test opened the Gemini circuit outside the frozen clock | Fixed | `tests/test_gemini_cooldown.py` (`TestOpeningTheCircuit`) | `106c8d9` |
| C2 | MEDIUM | 14 routes answered 500 and paged the error bot on a JSON body that is not an object | Fixed | `backend/helpers.py:326` and 13 route modules | `c00e2c3` |
| C3 | LOW | Conversations list 500s on `?limit=abc`; a huge or non-numeric citation `ordinal` broke the insert | Fixed | `backend/helpers.py:318` (`_coerce_int`), `backend/routes_conversations.py:387` (`_citation_ordinal`) | `aca8f34` |
| C4 | MEDIUM | Event loop stalled when Gemini failed: the cooldown write to Redis ran on the loop | Fixed | `backend/claude.py:3264` (`_call_gemini_httpx_model`), `backend/health_check.py:361` | `ec28776` |
| C5 | LOW | Calendar test pinned the year 2026 (time bomb, fires 2027-01-01) | Fixed | `tests/test_routes_calendar_extra.py` | `7a70d54` |
| C6 | LOW | Per-ask budget reservation kept its own copy of the Haiku prices | Fixed | `backend/cost_meter.py` | `074a6ed` |
| C7 | LOW | Two unreferenced definitions; four env vars the code reads were missing from the docs | Fixed | `backend/claude.py`, `docs/ENVIRONMENT.md` | `6492a27` |
| C8 | MEDIUM | SonarCloud: 23 BUGs, 74 `S9073` and 9 `S5778` test smells, most cheap Python smells, seven `S8786` regexes, two `S2699` BLOCKERs | Fixed | `tests_js/answer_link.test.js`, `tests_js/answer_share.test.js`, many others | `d7416a3`, `3710669`, `b325aad`, `0b882c3` |

### 2.2 Follow-up pass (2026-10-17): fixed

| ID | Severity | Title | Status | Location (file:line) | Fixed in commit |
|----|----------|-------|--------|----------------------|-----------------|
| S1 | LOW | Quadratic regexes and mechanical JavaScript smells (`S8786`, `S5843`, `S5869`, `S2486`, `S3358`, `S7781`, `S7761`, `S6594`, `S4624`) | Fixed | `static/js/shell.js`, other `static/js/*.js` | `9c91086`, `7c3df01`, `106a5b1`, `f28bdbe`, `cd48d26` |
| S2 | LOW | `javascript:S3776` x53: long functions in `shell.js`, the router, siddur reminders, conversation, ask and zmanim modules, both build scripts | Fixed | `static/js/shell.js`, `scripts/build_assets.mjs`, `scripts/build_critical_css.mjs` | `fd2e5c9`, `884a372`, `a708ad8`, `c857d56` |
| S3 | LOW | Quadratic Python patterns (`S8786`, `S5843`, `S5869`, `S1110`, `S5958`, `S3415`) | Fixed | `tests/test_linear_regex_equivalence.py` (oracle tests) | `e58fc3e`, `ee7114f` |
| S4 | LOW | `python:S3776` x22: `siddur_day`, `siddur_lines`, `build_siddur`, `sidebar_bundle`, `routes_spa_paths`, `app.py`, `claude.py`, `ai_tools`, `customs`, `rag`, `routes_community`, `routes_conversations`, `sefaria_library`, `crawl_library_leaves`, `verify_conversations_migration` | Fixed | listed in the commit messages | `b00b65f`, `f454d23`, `38a94ba`, `d078009`, `30c0600` |
| S5 | LOW | `css:S4666` x2 (duplicate selectors), `plsql:S125` (commented-out SQL) | Fixed | `static/css/`, `scripts/sql/` | `6b17fd0`, `2f6752a` |
| S6 | LOW | `Web:S7927` x13: icon-only conversation buttons read the icon markup as visible text | Fixed (markup hint only) | `templates/index.html` | `81269b0` (builds on `756e3fb`) |
| S7 | LOW | Coverage: build scripts and home-page scripts had no tests | Fixed | `tests_js/`, `tests/test_shell_dom_fixture.py` | `17b12fa`, `30dc878`, `312ad8b`, `77f1ab5`, `7155d3b`, `63c2c49` and the other `test(js)` commits of 2026-10-17 |

### 2.3 Open

| ID | Severity | Title | Status | Location (file:line) | Fixed in commit |
|----|----------|-------|--------|----------------------|-----------------|
| O1 | MEDIUM | Agent loop's forced final round may be rejected by the Anthropic API | Open: needs one live call to confirm | `backend/ask_pipeline.py:148`, `backend/claude.py:3191` | none |
| O2 | MEDIUM | Rate limiter `INCR` then `EXPIRE` can leave a counter with no TTL | Open: needs a live Redis check | `backend/rate_limit.py:416-422` | none |
| O3 | MEDIUM | Global cost breaker reads a failed Supabase call as `$0`; the page fetch has no `.order()` | Open: design call | `backend/cost_meter.py:257-290`, `:374-430` | none |
| O4 | LOW | `TTLCache` back-fills a Redis hit with the default TTL; `delete()`/`clear()` skip Redis | Open (latent) | `backend/cache.py:174-186`, `:218-224` | none |
| O5 | LOW | Conversation message and its citations are two inserts; racing retries can store two replies | Open: needs an RPC or idempotency key | `backend/routes_conversations.py:287-299`, `:398-419` | none |
| O6 | LOW | Dead code that still has tests (nine definitions) | Open: deleting means deleting tests | see section 5 | none |
| O7 | LOW | Sonar leftovers from the first pass | Mostly fixed in the follow-up (S1 to S7); the rest are N1 to N6 below | see section 7 | see S1 to S7 |
| O8 | LOW | Build hygiene: `npm run build:css` changes `:where(.space-y-*)` specificity; critical CSS drifts from source at a pristine HEAD | Open: needs the frontend owner | `static/css/tailwind.css`, `static/min/` | none |
| N1 | LOW | `css:S9423` x701 (`!important`), 573 of them in `static/style.css` | Not fixed: visual work | `static/style.css` | none |
| N2 | LOW | `Web:S6819` x18 (`role=` where Sonar wants a native element) | Not fixed: changes focus and top-layer behaviour | templates, `static/js/` | none |
| N3 | LOW | `javascript:S9382` x14 (await in a loop) | Not fixed: sequential on purpose | `static/service-worker.js`, `static/js/commentary-preload.js`, build scripts | none |
| N4 | LOW | `text_ssr` footnote regexes still quadratic-shaped | Not fixed: must mirror the browser | `backend/text_ssr.py:57-58` | none |
| N5 | LOW | Design or security calls noted for their owners (see section 7) | Not fixed | several | none |
| N6 | LOW | `reader-ui.js` (83.7 %) and the `shell.js` long tail uncovered | Not fixed: not needed for the gate | `static/js/reader-ui.js`, `static/js/shell.js` | none |

## 3. SonarCloud quality gate

Values below were read from SonarCloud's public API when this audit was written. The server still showed the pre-fix state.

| Condition | Server value (last analysis) | Needed | Status |
|---|---|---|---|
| New reliability rating | 4 (23 open BUGs) | 1 | Red; should clear after the `bd7be17` analysis |
| New coverage | 72.8 % (70.8 % by line count); about 86 % projected with the jsdom tests | 80 % | Red on the server; met locally (see below) |
| Duplication, maintainability, security, hotspots | OK | OK | Green |

- **Why the server is stale.** SonarCloud's last analysis was `e7fb5c1` (run on 2026-10-14), and the `f2a63d5` CI run failed before reaching the scanner (the Gemini time bomb, C1, fixed in `106c8d9`). The run for `bd7be17`, the first that carries the BUG fixes (`d7416a3`), was still in progress when this was written. I could not confirm the result from here.
- **No scanner run.** `SONAR_TOKEN` is not set in this shell (checked in a login shell too), so I could not run `sonarqube-scanner` with `-Dsonar.qualitygate.wait=true`. Everything about the gate was read from the API. The first CI scan after a push is the real answer.
- **Coverage is met with tests, not an exclusion.** 27,008 lines counted as new code and 7,874 were uncovered. Four files held most of the gap, all at 0 %: `static/js/shell.js` (5,584 executable lines), `conversation-ui.js` (1,332), the two `scripts/build_*.mjs` (382) and `citation-popover.js` (134).

### jsdom harness

A jsdom harness runs the real scripts on the real home page.

- `tests_js/helpers/shell_page.js` boots `GET /` (stored in `tests_js/fixtures/index_page.txt`, regenerated with `python scripts/build_shell_dom_fixture.py`) and runs the classic scripts in it with a routed `fetch`. `tests/test_shell_dom_fixture.py` fails, naming that command, when the template and the fixture drift.
- `conversation_page.js` installs the Ask panel on it with a manual clock and a recording conversation API.
- The first round added 128 tests in six files (`shell_*.test.js`, `conversation_ui.test.js`); `jsdom` is the only new dev dependency. The follow-up pass grew the suite to 1,470 `node --test` tests.
- Measured in the lcov that `npm run test:coverage` writes, at the end of the follow-up pass: `shell.js` 97.1 % lines (84.1 % branches), `conversation-ui.js` 99.7 %, `citation-popover.js` 98.8 %, `scripts/build_assets.mjs` and `build_critical_css.mjs` 100 %. The first-round figures were 61 % and 86 %. The margin over 80 % is now wide.

### Found while writing the tests

- **Dead UI.** `shell.js` had handlers for a verse-compare strip, the community-timeline modal and the source-graph modal whose markup is not in `templates/index.html`. Removed in `f9d1462`.
- **`maybeShowTip`.** It skipped the discovery tip for the rest of the page's life if a menu was open when its timer fired. Fixed in `5b61a38` (the tip now waits for the menu to close), with a test.

## 4. Details of the fixed findings

### First pass

| ID | What was wrong | Fix |
|----|----------------|-----|
| C1 | `test_checking_gemini_never_touches_the_network` opened the breaker on the real clock and then froze time at 12:00 UTC, so once the real time passed 14:00 UTC the cooldown had not elapsed and `is_healthy('gemini')` returned False. CI was red for every PR from 15:35 UTC on 2026-10-16. | Open the circuit inside the frozen clock (`106c8d9`). This is the test the security audit saw fail once and pass later. |
| C2 | `request.get_json(silent=True) or {}` followed by `.get()` on a body of `[1]`, `"x"` or `5` raised `AttributeError`, answered 500 and fired an alert. Routes: `/ask`, `/set_location`, four conversation routes, client-errors, devtools segment-report, feedback, export, delete-account, accept-legal, preferences, semantic bookmarks. | New `helpers._json_object_body()`. A non-object body now gets the same answer as `{}`. Tests: `tests/test_non_object_json_body.py`. |
| C3 | `?limit=abc` raised `ValueError`; a citation `ordinal` that is huge or non-numeric broke the insert. | Both fall back safely (`routes_conversations.py`, `_coerce_int`, `_citation_ordinal`). |
| C4 | The error that opens the Gemini cooldown also writes it to Redis (`health_check._publish_cooldown`, 2 s connect and 2 s socket timeout). The async Gemini call recorded it with a bare call on the loop (`claude.py`, `_call_gemini_httpx_model`). | Now `asyncio.to_thread`, like `is_healthy`. The regression test fails on the old code. |
| C5 | A calendar test pinned the year 2026; it would fail on 2027-01-01. | Stop pinning the year. |
| C6 | The per-ask budget reservation had its own copy of the Haiku prices and could drift from the price table. | It reads the price table (`cost_meter.py`); a test ties it to the fallback model. |
| C7 | Two unreferenced definitions; four env vars the code reads were missing from `docs/ENVIRONMENT.md`. | Removed and documented. |
| C8 | 23 BUGs; 74 `S9073` and 9 `S5778` test smells; most cheap Python smells; seven `S8786` regexes (each with a differential test); two `S2699` BLOCKERs (`tests_js/answer_link.test.js`, `answer_share.test.js`). | `d7416a3`, `3710669`, `b325aad`, `0b882c3`. |

### Follow-up pass (2026-10-17)

| ID | What changed |
|----|--------------|
| S1 | Quadratic regexes replaced by linear ones or by string scans, nested ternaries and empty catches rewritten, `replaceAll`/`at()`/`Number.isNaN` and similar. Each regex change was compared against the old pattern on several hundred thousand generated strings (a throw-away fuzz script, not checked in). |
| S2 | Long functions split into named helpers; the jsdom suites pin the behaviour. |
| S3 | Quadratic patterns replaced by linear code with oracle tests: `tests/test_linear_regex_equivalence.py` keeps the old patterns and checks the new code against them on thousands of generated strings. |
| S4 | `siddur_day`: tachanun exceptions are one month-keyed table and occasions come from per-holiday helpers, compared against the old code for every day of 1900 to 2099. `build_siddur`: `_check_curation`, `_build_section`, `_check_slugs`, `_build_service`, `_content_version`, with the same output and the same `SystemExit` messages on eleven cases. The others were split into small helpers with their existing tests. |
| S5 | Two duplicate selectors merged (minified assets and critical CSS rebuilt); a commented-out SQL read described in prose. |
| S6 | The `{{ phosphor(...) }}` call in icon-only conversation buttons is wrapped in the `aria-hidden` `display: contents` span the reader buttons already use. The button's `aria-label` is unchanged. The scanner reads the template call as visible text, so this is a markup hint, not a change in what screen readers announce. |
| S7 | Two build scripts and the home-page scripts now run under test; see section 3. |

### Behaviour differences the regex rewrites accept

Each is a deliberate trade for linear time; none is reachable from normal text.

- Reference patterns in `shell.js` need the book title to start with a non-whitespace character and no longer treat a line terminator specially.
- The tag strippers leave the `<a` of a malformed `<a<b>` in place; the markdown gap between a marker and its text is bounded at 64 whitespace characters; a tag name containing a quote differs in the citation-marker TAG pattern.
- The Yiddish verb suffix in `customs.py` is bounded at 30 characters.
- A Mishneh Torah name (`ref_aliases`) can no longer start or end with a space inside the pattern.

## 5. Open items that need your decision

These are not fixed because they are unprovable from here or are a design call.

### O1 (MEDIUM): agent loop's forced final round

`ask_pipeline.py:148`, `claude.py:3191`. The last round sends no `tools` while `messages` still carries `tool_use` and `tool_result` blocks. As far as I know the Anthropic API rejects that shape, which would turn every answer that used all three tool rounds into the provider-unavailable fallback. I could not confirm it without a live call (no AI budget spent), and `AI_AGENTIC_TOOLS` defaults to off. If you turn it on, make one live call first; the fix is to keep `tools` and send `tool_choice: {"type": "none"}`.

### O2 (MEDIUM): rate limiter `INCR` then `EXPIRE`

`rate_limit.py:416-422`. If the process dies, or `EXPIRE` fails, between the two calls, the counter has no TTL and that client is blocked for good. The fix is one atomic step (`SET NX EX` then `INCR`, or `EXPIRE ... NX`); it needs a live Redis/Upstash check, so I left it.

### O3 (MEDIUM): global cost breaker

`cost_meter.py:374-430`. A failed Supabase read is cached as `$0` for 30 s, so a database blip briefly disables the breaker. The page fetch (`:257-290`) uses `.range()` with no `.order()`, so rows can be skipped or double-counted under concurrent inserts, and it scans O(rows) per refresh. A SQL `SUM` RPC fixes all three.

### O4 (LOW): `TTLCache`

`cache.py:174-186`, `:218-224`. A Redis hit is back-filled with the default TTL rather than the remaining one, and `delete()`/`clear()` leave the Redis tier alone. Latent today: no caller relies on either.

### O5 (LOW): conversation writes

`routes_conversations.py:287-299`, `:398-419`. The message and its citations are two inserts, not one, and two racing retries of the same ask can store two replies. It needs an RPC or a client idempotency key.

### O6 (LOW): dead code that has tests

Production never calls these; deleting each means deleting its tests, so I left them:

- `ask_pipeline._build_agentic_system_text`
- `claude.get_dispatchable_models`, `claude._get_client`
- `device_identity.is_device_owner`
- `siddur_data.find_by_ref`
- `siddur_lines.build_lines`, `siddur_lines.english_is_aligned`
- `search_provider._match_corpus`, `search_provider._build_last_resort_web_sources`
- `text_engine._format_ui_answer`
- `app._gather_ask_question_context_futures`

### O7 (LOW): Sonar leftovers from the first pass

About 390 JavaScript smells, 22 Python `S3776`, `S8786`/`S5843`, `Web:S6819` x17, `Web:S7927` x22 and `css:S9423` x701 were left after the first pass. Section 4 (S1 to S7) says which were fixed afterwards; section 7 lists what is still open.

### O8 (LOW): build hygiene

`npm run build:css` changes `:where(.space-y-*)` specificity (a stale `.capitalize` rule in `tailwind.css` goes with it), and the critical CSS drifts from source at a pristine HEAD. Both need the frontend owner; I reverted my rebuild attempts.

## 6. Ruled out

Checked, nothing to fix.

- **Unused dependencies:** none. **Orphan modules:** none (`ask_pipeline` is live behind the flag; `rag._env_int` is used).
- **Blocking calls on the event loop:** I ran the whole suite with `redis_cache_*`, `time.sleep`, `httpx.Client.send`, `requests` and `urlopen` instrumented to flag any call made from a running loop. The only hit in production code was C4 (the Flask sync pipeline blocks by design and is unreachable behind the ASGI mount).
- **Input handling:** 2,196 hostile requests over every Flask rule, 46 hostile `/ask` bodies over ASGI, and 204 calendar requests at the poles and date extremes produced no unhandled exception and no input-driven 5xx.
- **Missing HTTP timeouts, swallowed exceptions, N+1 queries, timezone-dependent tests, iCloud conflict copies:** none found. The Gemini cooldown (`health_check.py`, `claude.py`) has no provable defect; share routes are sound.
- **Production `/docs`, `/redoc`, `/openapi.json`:** answer 404.

## 7. Not fixed in the follow-up pass, and why

| ID | Item | Reason |
|----|------|--------|
| N1 | `css:S9423` x701 (`!important`) | Mostly in `static/style.css` (573). Removing them is visual work that has to be measured per component in light and dark, Hebrew and English; a separate session was proposed for it. |
| N2 | `Web:S6819` x18 | Sonar wants `role="status"` replaced by `<output>`, `role="dialog"` by `<dialog>`, `role="radio"` by `<input>` and `role="group"` by `<fieldset>` and friends. Those swaps change focus, styling and (for `<dialog>`) top-layer behaviour, so they belong with the frontend owner. An earlier pass (`756e3fb`) already converted the status regions where `<output>` was safe. |
| N3 | `javascript:S9382` x14 (await in a loop) | Sequential on purpose. The service worker's precache walk goes "one at a time: the reader's own requests go first" (its own comment), `commentary-preload.js` re-checks staleness between neighbour fetches, and the build scripts run their steps in order. `Promise.all` would change load and ordering for a style hint. |
| N4 | `text_ssr` footnote regexes (`backend/text_ssr.py:57-58`) | They mirror `normalizeDisplayText` in the browser (the module's own comment says "in the same order"). Making only the server side linear would risk server- and client-rendered text differing. |
| N5 | `loadNextTextChunk` speculative loop, `display_name` city-search edge, `renderAnswerMarkdown` without DOMPurify, the legacy `showSidebars` migration | Design or security calls, noted for their owners. |
| N6 | `reader-ui.js` (83.7 %) and the `shell.js` long tail | Not needed for the gate. |

## 8. State of the test suites

| Point in time | Python | JavaScript | Other |
|---------------|--------|------------|-------|
| End of the first pass (after rebasing onto `2eb2a08`) | `pytest` 5,529 passed at 99.51 % backend coverage (gate 85 %); `ruff check .` clean | `node --test` 837/837 (709 before the jsdom tests) | `tests/test_shell_dom_fixture.py` passes |
| End of the follow-up pass (from `f3861a1`) | not re-recorded here | 1,470 `node --test` tests | Python cognitive-complexity counts checked with a local approximation of the rule, which cannot confirm them |

`SONAR_TOKEN` is still not set in this shell, so I have not seen the quality gate after the follow-up commits. The first CI scan after a push is the check.
