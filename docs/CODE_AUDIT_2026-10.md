# Code audit, October 2026

Scope: backend, tests, CI and SonarCloud. Visual/UX and security findings were left to their own passes
(one security commit, `bd7be17`, landed from that pass while this one ran).

Everything below was reproduced, not guessed. A change that alters behaviour carries a regression test that
fails on the old code. Eleven fix commits came out of this pass: nine are already on `origin/main` (up to
`bd7be17`), two (`ec28776`, `0b882c3`) and this report are local and unpushed.

## 1. SonarCloud quality gate: still red, and two things block it

| Condition | Server value (last analysis) | Needed |
|---|---|---|
| new reliability rating | 4 (23 open BUGs) | 1 |
| new coverage | 72.8 % (70.8 % by line count) | 80 % |
| duplication, maintainability, security, hotspots | OK | OK |

- **The server still shows the pre-fix state.** SonarCloud's last analysis is `e7fb5c1` (2026-10-14), and the
  `f2a63d5` CI run failed before reaching the scanner (the Gemini time bomb, fixed in `106c8d9`). The run for
  `bd7be17`, the first that carries the BUG fixes (`d7416a3`), was still in progress when I wrote this. When it
  finishes, the reliability rating should go to 1; I could not confirm that from here.
- **`SONAR_TOKEN` is not set in this shell** (checked in a login shell too), so I could not run
  `sonarqube-scanner` with `-Dsonar.qualitygate.wait=true`. Everything about the gate was read from the public API.
- **Coverage needs a decision.** 27,008 lines count as new code and 7,874 are uncovered. Reaching 80 % means
  covering about 2,470 more lines. Four files hold most of the gap, all at 0 %:

  | File | Uncovered lines |
  |---|---|
  | `static/js/shell.js` (12,340 lines, DOM-bound) | 5,584 |
  | `static/js/conversation-ui.js` | 1,332 |
  | `scripts/build_critical_css.mjs` + `scripts/build_assets.mjs` | 382 |
  | `static/js/citation-popover.js` | 134 |

  Honest options, your call: (a) a jsdom harness that boots `shell.js` and drives the main flows (large, and adds a
  dev dependency); (b) unit tests for the three small files above (about 650 lines, not enough alone);
  (c) `sonar.coverage.exclusions` for `static/js/shell.js`, which takes the figure to about 89 %. I did **not** add
  an exclusion, as instructed. Bumping `sonar.projectVersion` would also reset "new code", but that dodges the gate
  rather than meeting it, so I left it.

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
7. **Sonar leftovers I did not touch:** Python `S3776` x21, `S5843` x3, a few `S8786`; about 390 JavaScript smells,
   almost all in `shell.js` (0 % covered, so a refactor there cannot be verified); `Web:S6819` x17 and `Web:S7927` x22
   (accessibility markup, another lane); CSS `S4666` x3; `plsql:S125` x1. None of these feed the gate.
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

## 5. State at the end of this pass

`pytest` 5,520 passed at 99.51 % backend coverage (gate 85 %), run after rebasing onto `bd7be17`; `ruff check .`
clean; `node --test` 709/709; JavaScript line coverage 96.75 % on the files that have tests. Nothing was pushed by
me. To land the two local commits and this report: `git push origin main`.
