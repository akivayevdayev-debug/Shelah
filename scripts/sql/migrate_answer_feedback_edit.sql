-- Migration: let a reader edit the rating or comment they left.
-- Run this once in the Supabase SQL Editor, after
-- scripts/sql/migrate_answer_feedback.sql (the table).
--
--   device_owner -- for feedback left while signed out: 'device:<sha256 of the
--                   shelah_device cookie>' (backend/device_identity.py), the
--                   same owner id ask_history uses for a guest's answers. Only
--                   the hash is stored, never the cookie. NULL for signed-in
--                   feedback (user_id identifies the writer) and for the
--                   server's own notes.
--
-- PATCH /api/feedback/<id> (backend/routes_feedback.py) changes a row only
-- when user_id matches the signed-in caller or, signed out, device_owner
-- matches the caller's device. The route uses the service-role client, so
-- there are no policy or grant changes: answer_feedback keeps its insert-only
-- RLS policy and no SELECT/UPDATE policy for anon or authenticated.
--
-- Until this runs: ratings and comments save exactly as before (the insert
-- falls back to leaving device_owner out); signed-in readers can already
-- edit theirs, guests can't.
--
-- Idempotent.

ALTER TABLE public.answer_feedback
    ADD COLUMN IF NOT EXISTS device_owner TEXT;

CREATE INDEX IF NOT EXISTS answer_feedback_device_owner_idx
    ON public.answer_feedback (device_owner)
    WHERE device_owner IS NOT NULL;
