# `scripts/` index

Operational one-offs and setup utilities. None embed credentials. All auth and DB access goes through environment variables (`.env`). See [`DEVELOPER_NOTES.md`](DEVELOPER_NOTES.md) for what each Python script does. This file only classifies how often you would run them.

## Repeatable (safe to re-run anytime)

- `verify_integrations.py`: health-checks the full stack (env vars, customs JSON, Supabase, Sefaria/Hebcal, local Flask, Vercel). Run it when triaging a deployment or integration issue.
- `verify_answer_feedback_migration.py`: live acceptance check for the `answer_feedback` RLS migration (`sql/migrate_answer_feedback.sql`). It confirms against the real database that anon and authenticated can insert but cannot select, both structurally (via the `get_schema_snapshot()` RPC) and empirically (insert a probe row, then try to read it back with the anon client). Run it after applying that migration in the Supabase SQL editor, or any time you want to confirm the policy is still in effect.
- `verify_rls.py`: live Row Level Security acceptance check, run as two dedicated test users against the real Supabase project. It is driven by the manual `rls-verify` workflow and needs fresh Clerk session ids each time.
- `verify_conversations_migration.py`: live acceptance check for `sql/conversations_setup.sql` (tables, RLS enabled and forced, owner-only policies, and one round trip through the service-role client). Run it after applying that file in the SQL editor.
- `generate_database_doc.py`: regenerates `docs/DATABASE.md` from the live schema once `sql/introspect_schema.sql` has been applied. `--check` diffs the committed file against the live schema.
- `generate_glossary_json.py`: rebuilds `static/data/glossary.json` from the lexicon lookup the AI and the reader share. Re-run it when the curated term list changes.
- `redteam_retrieved_context.py`: opt-in live red-team of the retrieved-context defences (indirect prompt injection). It spends model credits, so run it on purpose and never in CI.
- `crawl_library_leaves.py`: re-crawls the Sefaria library tree and regenerates the leaf remove/fix report. Re-run it only when that report (`reports/library_leaf_remove_fix_report.full.json`, read at runtime by `backend/sefaria_library.py`) needs refreshing. It is slow (it probes every leaf) and the output is committed, so this is not part of any normal workflow. It needs www.sefaria.org. Complex-schema works (siddur, machzor, haggadah) are probed at the first leaf of their schema, the ref the library opens them at. The April 2026 report predates that and removed 441 such works on bare-title 400s.
- `verify_library_removals.py`: re-checks that report's removals against the public Sefaria-Export bucket (no sefaria.org access needed) and writes `reports/library_leaf_reinstated.json`: the removed works that have a complex schema and real text there. The backend takes those back out of the removals for that report run only, so re-running the crawler supersedes it. Re-run after regenerating the report only if the new crawl cannot reach sefaria.org's per-title index.

## CI and tooling helpers

- `a11y_dark_scan.js`: the dark-theme half of the WCAG 2.1 AA gate (`npm run test:a11y:dark`; `pa11y-ci` covers light).
- `merge_lcov.py`: merges duplicate per-file records in the JS lcov output so SonarCloud reads coverage correctly (part of `npm run test:coverage`).
- `check_prompt_doc_sync.py`: advisory pre-commit report comparing status claims in `claude_code_prompts.md` with `plan.md`. It never blocks a commit.

## One-time (setup / migration)

- `migrate_customs_to_supabase.py`: seeds `community_knowledge` from the `customs/*.json` files. It supports `--dry-run`, `--community <lens key>`, `--prune` (delete rows the JSON no longer has) and `--emit-sql` (writes SQL files to `build/customs_sql/` for the Supabase SQL Editor instead of connecting). Run it once per environment, or after a customs-data change you want pushed.
- `build_siddur.py`: rebuilds the checked-in siddur (`data/siddur/edot-hamizrach/`) from the public Sefaria-Export bucket: curated table of contents plus typed lines per service. It refuses any text version not licensed CC0 or Public Domain. Re-run it when Sefaria's export or the curation in the script changes, and commit the output.
- `recompute_ai_usage_log_cost.py`: one-off backfill of historical `ai_usage_log.cost_usd` under the current price table. It mutates ledger rows, so review the dry run first. It is not wired into anything.
- `sql/`: the Supabase schema, policies and dated migrations. Apply them by hand in the SQL editor (the CLI's pooler connection times out), then run the matching `verify_*` script. `sql/SUPABASE_RLS_POLICIES.sql`, `sql/bookmarks_and_preferences_setup.sql`, `sql/conversations_setup.sql`, `sql/ai_usage_log_setup.sql`, `sql/check_and_reserve_user_budget.sql` and `sql/rag_identity_cache_setup.sql` (which, despite its name, creates `community_knowledge` and `user_memories`) provision a new environment. `sql/migrate_*.sql` are the incremental changes. Schema reference: [`docs/DATABASE.md`](../docs/DATABASE.md).
