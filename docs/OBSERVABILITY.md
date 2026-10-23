# Observability: logging, cost metering and health

**Status (2026-10-02):** structured JSON logging with request ID propagation, Sentry (backend and browser), per-call cost metering, an atomic per-user daily budget, a global daily budget alert and cost breaker, and circuit breakers on every upstream are implemented and tested. Uptime monitoring is the one piece not yet configured (see [`docs/RUNBOOKS.md`](RUNBOOKS.md), "Uptime monitoring").

## Structured JSON Logging

Every log line is a compact, single-line JSON object. Vercel log drains, Datadog, Papertrail, or any JSON-aware aggregator can parse it.

### Log fields (always present)

| Field | Type | Description |
|---|---|---|
| `timestamp` | ISO 8601 | UTC time, millisecond precision |
| `level` | string | `DEBUG` / `INFO` / `WARNING` / `ERROR` |
| `logger` | string | Logger name (e.g. `backend.claude`) |
| `message` | string | Human-readable message |
| `module` | string | Python module name |
| `function` | string | Function name |
| `line` | int | Source line number |
| `request_id` | string | Per-request trace ID (empty if not set) |
| `exception` | string | Formatted traceback (only on exc_info records) |

### How to use

```python
from backend.logging_setup import get_logger, bind_request_id

logger = get_logger(__name__)

# At request entry — accepts X-Request-ID header or generates a UUID fragment:
request_id = bind_request_id(request.headers.get("X-Request-ID"))

logger.info("Processing question", extra={"question_len": len(q)})
```

### Setup (called once at startup)

```python
from backend.logging_setup import setup_logging
setup_logging()   # reads LOG_LEVEL env var (default: INFO)
```

The noisy third-party loggers (`httpx`, `hpack`, `anthropic`) are suppressed to WARNING automatically.

---

## request_id Propagation

`request_id` lives in a `contextvars.ContextVar`. It therefore flows automatically across Flask threads and `asyncio` tasks started with `asyncio.to_thread`. To read the current ID from any layer:

```python
from backend.logging_setup import get_request_id
rid = get_request_id()  # "" if not set
```

---

## Cost Metering (`backend/cost_meter.py`)

Records token usage and estimated USD cost for every outbound AI call. It then writes to Supabase `ai_usage_log` via `asyncio.to_thread`, fire-and-forget, so it never blocks the event loop.

### Record a call

```python
from backend.cost_meter import record_llm_call
from backend.logging_setup import get_request_id

await record_llm_call(
    provider="anthropic",
    model="claude-sonnet-4-6",
    input_tokens=response.usage.input_tokens,
    output_tokens=response.usage.output_tokens,
    route="/ask",
    request_id=get_request_id(),
)
```

### `ai_usage_log` table schema

| Column | Type | Description |
|---|---|---|
| `provider` | text | `anthropic`, `gemini`, `google-translate`, `mymemory` |
| `model` | text | Full model ID |
| `input_tokens` | int | Input token count from API response `usage` block |
| `output_tokens` | int | Output token count |
| `cost_usd` | numeric(12,8) | Estimated USD cost |
| `route` | text | Request path that triggered this call |
| `request_id` | text | Trace ID from logging context |
| `created_at` | timestamptz | UTC insertion time |

The caller-attribution and budget-reservation columns were added later. The per-user daily budget runs on them:

| Column | Type | Description |
|---|---|---|
| `user_id` | text | Authenticated Clerk subject (null for anonymous callers) |
| `client_key` | text | `ip:<addr>` fallback key for anonymous callers |
| `reserved` | boolean | `true` on a placeholder row written by `check_and_reserve_user_budget()` before the model call |
| `reservation_id` | uuid | Handle used to settle the placeholder row with the real cost |
| `reservation_expires_at` | timestamptz | A reservation never settled (crashed request) is swept after 10 minutes |

Reserve-then-settle is what makes the per-user ceiling atomic under concurrency. The reservation is inserted in the same statement that computes the day's running total (`scripts/sql/check_and_reserve_user_budget.sql`). Rows older than 90 days are deleted by the `retention-enforce` cron.

Prices are defined in `cost_meter._PRICE_PER_M` (USD per 1M tokens). Update them when providers change pricing.

### Daily budget alert and global cost breaker

- `check_daily_budget_and_alert()` sums the current UTC day's `ai_usage_log` cost. Once the sum reaches `DAILY_BUDGET_USD`, it raises through `_capture_backend_error` (Sentry, structured log, optional webhook). It runs from the `budget-check` Vercel cron at 13:00 UTC and from `GET /api/devtools/budget-check`.
- `is_global_cost_breaker_tripped()` is consulted on the live `/ask` path. When the breaker is tripped, the app serves a cached answer or a calm paused-state payload instead of calling a model.
- `DAILY_BUDGET_USD` is `10.00` in production (live since 2026-09-01). If it is unset, `cost_meter` logs a warning, and `/api/stack/health` reports `security.cost_breaker.configured: false` rather than failing silently.
- `budget-check` fails closed. It returns `503` when `CRON_SECRET` is unset and `401` when the bearer token does not match (`hmac.compare_digest`).

---

## Circuit Breaker (`backend/health_check.py`)

| Constant | Default | Meaning |
|---|---|---|
| `FAIL_THRESHOLD` | 3 | Consecutive failures before circuit opens |
| `RECOVERY_INTERVAL` | 120s | Seconds before half-open probe |
| `REQUEST_TIMEOUT` | 5s | Per-probe timeout |

**Services tracked.** Actively probed: `sefaria`, `hebcal`, `claude` (Gemini has its own policy, below). Passively tracked from real call outcomes: `translate_google`, `translate_mymemory`, `web`, `nominatim`, `community_knowledge`. Both AI providers are gated before every call. An open circuit sends `/ask` down the fallback ladder, ultimately to the local-corpus answer, without dialing the dead provider.

**Gemini cooldown.** Gemini is the primary model and Claude is its fallback, so Gemini has its own rule instead of the three-failures-and-two-minutes default:

| Setting | Value | Meaning |
|---|---|---|
| `GEMINI_FAIL_THRESHOLD` | 2 | Consecutive real errors before Gemini is switched off |
| `GEMINI_COOLDOWN_SECONDS` (env) | 2700 (45 min), clamped to 1800 to 3600 | How long every answer comes from Claude alone |

- **What counts as a real error:** a provider outage, a rate limit or quota response (429), a bad or expired key, a 5xx, a timeout, a dropped connection. **What does not:** a request-specific rejection (a 400/413/422 that is not about the key), an empty answer (a safety block or the token ceiling on one prompt), a missing key or SDK, and our own AI budget running out. These neither count toward the two nor reset them. A success does reset them.
- **During the cooldown,** no Gemini call is made (`_call_gemini_model`, `_call_gemini_httpx_model` and the bookmark summary all check first). `/ask` goes straight to Claude, and the answer is marked as a fallback, exactly as for any failed Gemini call.
- **After the cooldown,** the next real request is the probe. The circuit turns `half-open`, and that one request calls Gemini. Every other request keeps using Claude until the probe reports back. A probe that never reports gives up its slot after 90 s. A good answer closes the circuit. An error starts another full cooldown. There is no models-list ping on this path, because a provider can list its models while every generate call fails.
- **Across instances:** when `RATE_LIMIT_REDIS_URL` is set, the instance that opens the cooldown publishes its end time (`health:cooldown:gemini`). The other instances adopt it within 20 s, so a Vercel deploy does not need every instance to fail twice. Without Redis, each instance keeps its own cooldown. Redis trouble never affects a request.
- `GET /api/stack/health` shows `gemini` as `down` during the cooldown, and as `half-open` while the probe is out.

```python
from backend.health_check import health

if not health.is_healthy("sefaria"):
    return {"error": "Sefaria temporarily unavailable."}, 503
health.record_success("sefaria")
```

**Serverless note.** State is per-instance. The Gemini cooldown is also shared through Redis when Redis is configured, as described above. Each cold start re-probes failing services on its first request. This is an intentional trade-off against adding Supabase latency to every request.

---

## Devtools Endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/devtools/heartbeat` | None (public) | Low-noise diagnostics for the in-app devtools-inspector panel; deliberately omits configuration-presence detail |
| `GET /api/devtools/reliability` | Clerk | In-process `DEVTOOLS_STATS` counters |
| `GET /api/stack/health` (alias `/api/health`) | Clerk | Circuit-breaker states plus rate-limit policy, limiter-store and cost-breaker status (`401` to an anonymous caller means "up and protected") |
| `GET /api/devtools/rls-audit` | Clerk | Which user-scoped tables an owner-scoped RLS policy governs |
| `GET /api/devtools/budget-check` | `CRON_SECRET` bearer | Daily AI-spend alert (cron) |
| `GET /api/devtools/retention-enforce` | `CRON_SECRET` bearer | 90-day retention deletes (cron) |
| `GET /api/async/health` | None | FastAPI liveness: `{"status":"ok","async":true}` |

---

## Sentry Project Setup

There are two Sentry projects in one org (`o4511830797975553`). This section is the durable operational record of how they are set up, and why.

### The two projects

| Project | Sentry platform | Env var | Where it's read | Secrecy |
|---|---|---|---|---|
| Backend | **Python → FastAPI** (FastAPI is *under* Python in Sentry's picker, not a separate platform) | `SENTRY_DSN` | `backend/logging_setup.py` | Server secret. Never commit it, never log it. |
| Frontend | **Browser JavaScript** (React is not used, and no React surfaces exist yet) | `SENTRY_DSN_BROWSER` | `app.py` → `templates/index.html` → `static/js/sentry-init.js` | Public by design, since a browser DSN can only *send* events. It is still env-only and never hardcoded in a template or committed file. |

**Why FastAPI, not Flask, for the backend project.** `asgi.py`'s `fastapi_app` is the actual process entrypoint that Vercel invokes in production. The Flask app is mounted *inside* it via `WSGIMiddleware`. Sentry's FastAPI/Starlette integration sits at that outer ASGI boundary, so it observes every request, including those later routed to the WSGI-mounted Flask app. A "Flask" project would only see requests that end in Flask's own WSGI handling. `python3 app.py` (bare Flask, with no ASGI layer and so no shared rate limiter) is a local-only run mode. Production runs FastAPI.

### Environment → env var matrix

| Vercel environment | `SENTRY_DSN` | `SENTRY_DSN_BROWSER` |
|---|---|---|
| Production | Set | Set |
| Preview | Set (same project; the `environment` tag tells preview from production via `VERCEL_ENV`) | Set |
| Development (local) | unset by default | unset by default |

Both are true no-ops when unset: no SDK init, no CDN script tag, no network call, no console warning. `environment` and `release` are read identically on both sides (`VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA`). A browser error and a backend error from the same deploy therefore carry matching tags. That is why there are two projects rather than one.

### The 5,000 events/month quota: why filtering is a prerequisite

Sentry's free Developer plan caps at **5,000 events/month across both projects**, roughly 170 a day. It is easy to exhaust:

- One looping component emitting an unbounded stream of the same client error.
- `POST /api/client-errors` (`backend/routes_devtools.py`). Before hardening, this route was unauthenticated and had no rate limit. It forwarded an 8 KB attacker-controlled `stack` straight into a Sentry `capture_exception` call. Around 5,000 forged requests would have blinded error monitoring for the rest of the month, without touching real application logic. The route is now same-origin-gated and rate-limited (the `telemetry` class). It caps `stack` at 2,000 chars and never forwards the client IP into the Sentry context.
- A backend DSN leak. Unlike the browser DSN, a leaked `SENTRY_DSN` lets an attacker POST forged events straight to Sentry's ingest, with no application involved. That is why it is a server secret, never written into the README, the docs or any committed file.

Client-side mitigations (`static/js/sentry-init.js`) are defense in depth, not the main control. They reduce volume before an event is sent. The dashboard settings below are what enforce the ceiling.

### Required dashboard settings (manual, not code; the operator's to confirm)

1. **Per-key rate limits** (Settings → Client Keys → Rate Limits) on both projects. 5K/month ≈ 170/day, so set both keys well under that. One bad deploy must not burn the whole month. The browser key should be tighter, because it is public.
2. **Spike Protection:** enabled on both projects, as a backstop for whatever the rate limits miss.
3. **Inbound filters** (the browser project especially): browser-extension errors, localhost, known crawlers, legacy browsers. These drop server-side *before* they count against quota. The client-side noise filtering in `sentry-init.js` still costs an event if it doesn't run (for example, if a bug bypasses `beforeSend`), so both layers matter.
4. **Data scrubbing:** Data Scrubber, the default scrubbers, and **Scrub IP Addresses** enabled. This matters more here. `send_default_pii=False` and `sendDefaultPii: false` are set in both SDK inits, but Data Scrubber is the server-side backstop, and IP scrubbing is a privacy backstop on top of that. (Client-IP resolution no longer trusts the spoofable `CF-Connecting-IP`. `backend/helpers.py` reads `X-Vercel-Forwarded-For`, which Vercel sets and overwrites at the edge.)
5. **One alert rule:** volume spike, sent by email. At this quota, per-issue alerts teach you to ignore Sentry instead of acting on it.
6. **Source maps: deferred.** The only build step for the frontend is the Tailwind CSS build. Source maps are not produced. The JavaScript in `static/js/` is plain ES modules, so raw stack traces from the sources stay readable. The production page may serve the minified `static/min/` build instead. Revisit this if a JS bundler is ever added. Do not treat it as configured before then.

### What's intentionally off

Profiling is off. So are Sentry Logs (they duplicate the structured JSON logging above), and Session Replay, for privacy: halachic questions are often medical, marital, mental-health or abuse-adjacent. The User Feedback widget is off too, because the app has its own feedback flow, which writes to Supabase and uses no third-party quota. Cron Monitoring is off as well, because the two Vercel crons report through `_capture_backend_error` instead. Uptime Monitoring is the intended use of Sentry's uptime product, at a 5-minute interval, but it is **not yet configured** (see [`docs/RUNBOOKS.md`](RUNBOOKS.md)). A check against a function-backed URL costs a real invocation, so the interval should not be shortened.

---

## Vercel Log Drain

1. Vercel dashboard → Project → Storage → Log Drain → Add
2. Set the drain URL to your aggregator's ingest endpoint
3. Select **JSON** format. The output maps directly, with no parser needed.

The `request_id` field supports tracing across requests when you correlate drain events with deployment logs.
