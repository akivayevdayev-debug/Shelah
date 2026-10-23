# Content QA: religious accuracy

**Status:** engineering documentation of the content-QA approach for religious accuracy. It describes what the codebase actually does today, not an aspirational editorial process. A rabbinic advisor should review it before public launch, along with the legal and compliance items tracked in `docs/LAUNCH_CHECKLIST.md`.

## Sh'elah is not rabbinically supervised

There is no rabbinic advisor, rabbinical board, hashgacha, or hechsher-equivalent endorsement behind Sh'elah today. A repo-wide search for that language (`rabbinic advisor`, `rabbinical board/supervision`, `hechsher`, `hashgacha`, `rabbinic approval/endorsement/oversight`) finds nothing. The only hits are this plan item itself and an unrelated "endorsement" disclaimer in `templates/terms.html`. That disclaimer covers outbound links to third-party sites, not Sh'elah's own content.

This should be stated plainly to users, and it already is. `templates/ai-disclosure.html` §4 ("What Sh'elah's AI Does NOT Do") says the app does not issue binding halachic rulings (p'sak halacha) and does not replace a rabbi, posek, or other rabbinic authority. §5 tells users to always consult their rabbi before acting on an answer. If a rabbinic advisor or hechsher-equivalent endorsement is obtained later, its scope must be documented precisely here and on the AI Disclosure page. Overclaiming authority is itself a liability.

## What is NOT reviewed: individual AI answers

`docs/DPIA.md` §2 already states the position for the `/ask` request path: **"No human reviews individual questions or answers in the normal path."** This document does not contradict it. A user's question is retrieved against source text (Sefaria, the local customs corpus, Halachipedia). An LLM then synthesizes it into an answer (Google Gemini primary, Anthropic Claude fallback, per `docs/DPIA.md` §2 and `templates/ai-disclosure.html` §1). No human editorial step sits between generation and delivery. Whatever QA exists today is upstream: it covers the *source data* the retrieval step draws from, and the *schema* of the customs corpus. It does not cover individual synthesized answers.

## What IS reviewed today: the customs corpus pipeline

The community-customs data under `customs/*.json` (`ashkenaz.json`, `sefardic.json`, `yemenite.json`, etc.) is not scraped. It is also **not hand-authored or rabbinically reviewed**. The current thirteen files (format 3.0) were compiled from one AI-assisted research run per community. Each run pointed at primary and scholarly sources, and the results were then converted into the JSON schema. Each entry carries its own `source`, `source_url` or `references`, and a `confidence` label (`well-attested`, `disputed`, `regional`, `needs-review`). The stored and displayed text says so for anything weaker than well-attested. For those entries (disputed, regional, needs-review), it tells the reader to ask their own rabbi. A disputed entry lists each position as its own variant instead of picking one. The Hebrew shown in the Hebrew UI (`topic_he`, `summary_he`, `name_he`, `description_he`) was written by hand from the English entries. It was not machine-translated at request time, and it has had no separate review. Topics with no community-specific source are listed under `gaps` instead of being filled in. Each file keeps a reviewer-only `needs_rabbinic_review` list and per-entry `review_notes` (what was and was not opened). Neither reaches users or the model. Per `customs/DEVELOPER_NOTES.md`, the editing guidance is to preserve valid JSON/UTF-8, keep topic and category fields consistent for matcher quality, and cite a source and confidence for every entry. This is data curation and engineering discipline, not a rabbinic review process. No halakhic authority signs off anywhere in the repo, and the `needs_rabbinic_review` lists are the worklist for one.

Two automated checks sit around that data:

1. **Schema validation at startup:** `validate_all_customs_at_startup()` in `backend/customs.py` walks every `customs/*.json` file (skipping the aggregated `customs_db.json` and `schema.json`). It checks two things only. The file must parse as valid JSON, and, for structured (v2.x and 3.0) files, the required top-level fields `heritage_id`, `name`, and `halacha_index` must be present and non-empty. A separate test, `tests/test_customs.py::TestRealCustomsFiles`, keeps every file's `runtime.lens_key` in step with the lens keys in `backend/helpers.COMMUNITIES`. That test runs in CI, not at startup. The validator logs an error per bad file and carries on. It never raises, so one bad file cannot crash the app. **This is a structural and schema check, not a content-accuracy or halakhic-accuracy check.** It cannot detect a wrong citation, a misattributed ruling, or a factually incorrect summary. It catches only a malformed or incomplete file. Per `docs/RUNBOOKS.md` ("Startup-cost gating"), it is a developer and CI safety net. It is skipped by default on production cold starts (Vercel or `FLASK_ENV=production`), to avoid billing Active CPU on every request. `VALIDATE_CUSTOMS_AT_STARTUP=1` or `=0` overrides that default. It always runs in CI.

2. **Migration to Supabase:** `scripts/migrate_customs_to_supabase.py` reads the same `customs/*.json` files. It supports both the modern `halacha_index` shape and a legacy flat `{community: {topic: entry}}` shape. It normalizes each entry's text and derives a deterministic id via `sha256(community|topic|source)`. It then upserts rows into Supabase's `community_knowledge` table, keyed by each file's `runtime.lens_key`. The flags `--dry-run`, `--community <lens key>`, `--prune` and `--emit-sql` are supported. Reviewer-only fields are left out of the rows. This is an ETL step with a deterministic upsert, not a content review. It does not check whether a ruling is correct. It only reshapes and loads what is already in the JSON files.

A related but separate tool, `scripts/crawl_library_leaves.py`, crawls the Sefaria API's library index. It does not touch the customs corpus. It probes each leaf title to confirm that its ref is loadable, and it produces a machine-generated JSON report with suggested "fix" refs or "remove" recommendations for broken or renamed Sefaria references. `scripts/verify_library_removals.py` re-checks those removals against Sefaria's bulk export (see `scripts/README.md`). The tool checks that the *links into* Sefaria's library resolve. It says nothing about whether Sefaria's text, or Sh'elah's use of it, is halakhically accurate.

## Summary: what exists vs. what does not

| | Exists today | Does not exist today |
|---|---|---|
| Per-answer human review | None | No human reviews individual AI-synthesized answers before they reach users (`docs/DPIA.md` §2) |
| Rabbinic endorsement | None | No rabbinic advisor, board, or hechsher-equivalent endorsement of the app or its content |
| Customs JSON schema check | `validate_all_customs_at_startup()`: a required-fields and valid-JSON check at startup and in CI | Does not check halakhic accuracy of the content |
| Customs data authorship | AI-assisted research compiled into JSON files, each entry with a source and a confidence label, gaps listed rather than filled (`customs/DEVELOPER_NOTES.md`) | No recorded halakhic sign-off step; the `needs_rabbinic_review` lists are unreviewed |
| Sefaria library link health | `scripts/crawl_library_leaves.py`: a machine-generated remove/fix report on ref loadability | Does not validate the substantive accuracy of Sefaria's text or Sh'elah's use of it |
| User-facing disclosure | `templates/ai-disclosure.html` §3/§4/§5 covers hallucination risks, what the AI does not do, and "always consult your rabbi" | None |

## Related documents

- `docs/DPIA.md` §2: the data-processing description of the `/ask` path, including the "no human review" statement this document defers to.
- `docs/RUNBOOKS.md`: the "Startup-cost gating" section, which covers the production skip and override behavior of `validate_all_customs_at_startup()`.
- `templates/ai-disclosure.html`: the user-facing AI disclosure page (limitations, hallucination risk, what the AI does not do, and the human-in-the-loop expectation).
- `customs/DEVELOPER_NOTES.md`: file-format and editing conventions for the customs corpus.
