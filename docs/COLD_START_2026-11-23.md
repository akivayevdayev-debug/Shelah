# Cold-start check, 2026-11-23

Asked for: 48 hours of production `cold_start` lines, grouped by deployment,
judged on every deployment since a3681a5, plus whether `import_ms` moved once
the language catalogs (b4f9a11) went live.

## What the data allows

The 48-hour pull is not possible on the Hobby plan:

- `vercel logs --since 48h` (and 24h, 12h, 3h, 1h) fails with "The hobby
  plan does not retain runtime logs for the requested time range". About
  59 minutes is the limit.
- `vercel metrics vercel.function_invocation.*` grouped by
  `functionStartType` needs Observability Plus for anything older than
  30 minutes, which Hobby can't buy.

So the sample is every `cold_start` line that still exists anywhere: one in
today's retained hour, and four that an earlier session pulled into its
transcript on 2026-11-14.

| Deployment (commit) | Lines | process_age_ms | import_ms | first_request_after_ms |
|---|---|---|---|---|
| Before a3681a5, pulled 2026-11-14 17:02 UTC | 3 | 465, 324, 905 (median 465) | 7175, 6435, 7532 (median 7175) | 159, 2648, 167 (median 167) |
| Unclear, pulled 17:56 UTC, two minutes after a3681a5 was committed, so probably still the old build | 1 | 245 | 6613 | 10728 |
| dpl_2D27bLJT… (30f887e), 2026-11-23 17:02 UTC | 1 | 827 | 7943 | 23933 |

Deployments since a3681a5 with a surviving line: one (30f887e). No line from
between a3681a5 and b4f9a11 survives, so the two commits can't be told apart.

## First request vs later requests (30f887e, 17:02–18:00 UTC)

The cold instance's own `request_complete` line had already aged out of the
retention window by the time it was read. What's left:

- Vercel's request id shows the request reached the function at
  17:02:47.569. The `cold_start` line was written 0.17 s later, and the app
  had finished loading 23.9 s before that. This visitor did not wait for the
  import: the instance was already up.
- 61 later requests on the same deployment: median 357 ms, p90 1123 ms,
  max 2865 ms. `/text/` pages alone: median 549 ms, p90 1622 ms. The slow
  ones are Sefaria fetches; 13 Sefaria connection resets show up in the
  same hour.

## Where the ~9 s first load goes

On the 2026-11-14 instances where the visitor did wait
(first_request_after_ms ≈ 160 ms):

- Vercel starting the Python process: 0.3–0.9 s (process_age_ms)
- The app loading: 6.4–7.5 s (import_ms), about 80–85% of the wait
- The request itself: about 0.5 s for a text page once warm

The app load is the large part. On this Mac the same import takes 1.4 s, or
1.7 s with no bytecode cache, so the Vercel instance is 4–5× slower than
local. Missing `.pyc` files explain only about 0.3 s of that.

## Verdict

- `import_ms` did not drop after a3681a5. The one later line (7.9 s) is
  at the top of the earlier range (6.4–7.5 s).
- With one line after b4f9a11 and none between, no change can be credited
  to or blamed on the language catalogs. A 0.4–1.5 s rise is within the
  spread of the four earlier lines.

## Recommended fix (not applied)

Keep one instance warm with an outside uptime check, such as a free uptime
monitor, that requests `https://shelah.org/api/async/health` every 5 minutes. The
7–8 s import is most of the first load, and nothing tried so far has shrunk
it. Fluid compute sends all of this traffic to one warm instance, and a ping
every 5 minutes costs almost no active CPU. Visitors would then mostly get
an instance that is already loaded. Today's 30f887e line shows that case:
the load finished 24 s before the request arrived.

To check it afterwards, the cold-start numbers need somewhere to live past
one hour. Hobby has no log drains, so a later step could send `cold_start`
to the existing error-bot channel or a small Supabase table.

## Follow-up, same day

- Sentry's auto-enabled integrations imported the Anthropic and Google GenAI
  SDKs on every start-up, which undid a3681a5's deferral of them. With
  production settings the local import went from 1.55 s to 0.6 s once
  start-up enabled only the integrations it needs
  (`backend/logging_setup.py`). The AI ones attach when `claude.py` loads the
  SDKs.
- `.github/workflows/keep-warm.yml` requests `/api/async/health` every
  5 minutes. That's the uptime ping recommended above, run by GitHub Actions
  (free for this public repo) because Hobby crons can run only once a day.
