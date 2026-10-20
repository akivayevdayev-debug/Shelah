-- Migration: comment-only feedback and the AI's own note on an answer.
-- Run this once in the Supabase SQL Editor, after
-- scripts/sql/migrate_answer_feedback.sql (the table).
--
-- Two additions to answer_feedback:
--
--   verdict 'comment'  -- a reader wrote a comment without rating the answer
--                         (the "Add a comment" control under every answer).
--   verdict 'ai_note'  -- a short, fixed-wording note the SERVER writes for an
--                         answer it just produced: what the AI did (answered
--                         from sources, searched the web as a last resort,
--                         fell back to the sources alone). It never contains
--                         the question, the answer or any source title.
--
--   source             -- 'reader' for anything a person submitted, 'ai' for the
--                         server's own note. backend/routes_feedback.py sets it;
--                         a client-supplied value is ignored. /admin/feedback
--                         shows an "AI" badge for source = 'ai' and keeps those
--                         rows out of the helpful / not helpful counts.
--
-- Until this runs: ratings keep working exactly as before; AI notes are
-- skipped quietly and a comment-only submission answers with an error the
-- reader can retry (its verdict is not allowed by the old CHECK).
--
-- Idempotent. No policy or grant changes -- answer_feedback keeps its existing
-- insert-only RLS policy and no SELECT policy.

ALTER TABLE public.answer_feedback
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'reader';

ALTER TABLE public.answer_feedback
    DROP CONSTRAINT IF EXISTS answer_feedback_source_check;
ALTER TABLE public.answer_feedback
    ADD CONSTRAINT answer_feedback_source_check
    CHECK (source IN ('reader', 'ai'));

-- The original table definition named this constraint implicitly
-- (answer_feedback_verdict_check); widen it.
ALTER TABLE public.answer_feedback
    DROP CONSTRAINT IF EXISTS answer_feedback_verdict_check;
ALTER TABLE public.answer_feedback
    ADD CONSTRAINT answer_feedback_verdict_check
    CHECK (verdict IN ('helpful', 'not_helpful', 'comment', 'ai_note'));

-- The digest filters by source.
CREATE INDEX IF NOT EXISTS answer_feedback_source_created_idx
    ON public.answer_feedback (source, created_at DESC);
