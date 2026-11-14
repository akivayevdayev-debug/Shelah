-- Security and performance fixes from the Supabase advisors (2026-11-14).
-- One transaction: if any statement fails, nothing changes.

begin;

-- 1. get_schema_snapshot(): only service_role calls it
--    (scripts/verify_conversations_migration.py, scripts/generate_database_doc.py).
--    Its body names information_schema.columns and pg_catalog views only,
--    so an empty search_path is safe.
revoke execute on function public.get_schema_snapshot() from public, anon, authenticated;
alter function public.get_schema_snapshot() set search_path = '';

-- 2. answer_feedback: every write goes through /api/feedback, which uses the
--    service-role client (bypasses RLS). No code inserts with the anon key.
drop policy if exists "anyone_can_submit_feedback" on public.answer_feedback;
revoke insert on public.answer_feedback from anon, authenticated;

-- 3. check_and_reserve_user_budget(): the body already writes public.ai_usage_log;
--    everything else is pg_catalog, so an empty search_path is safe.
alter function public.check_and_reserve_user_budget(text, text, numeric, numeric) set search_path = '';

-- 4. RLS: evaluate auth.jwt() once per query instead of once per row.
--    Same logic, only auth.jwt() -> (select auth.jwt()).
alter policy conversations_select_own on public.conversations
    using (((select auth.jwt()) ->> 'sub') = user_id);
alter policy conversations_insert_own on public.conversations
    with check (((select auth.jwt()) ->> 'sub') = user_id);
alter policy conversations_update_own on public.conversations
    using (((select auth.jwt()) ->> 'sub') = user_id)
    with check (((select auth.jwt()) ->> 'sub') = user_id);
alter policy conversations_delete_own on public.conversations
    using (((select auth.jwt()) ->> 'sub') = user_id);

alter policy messages_select_own on public.messages
    using (exists (select 1 from public.conversations c
                   where c.id = messages.conversation_id
                     and ((select auth.jwt()) ->> 'sub') = c.user_id));
alter policy messages_insert_own on public.messages
    with check (exists (select 1 from public.conversations c
                        where c.id = messages.conversation_id
                          and ((select auth.jwt()) ->> 'sub') = c.user_id));
alter policy messages_update_own on public.messages
    using (exists (select 1 from public.conversations c
                   where c.id = messages.conversation_id
                     and ((select auth.jwt()) ->> 'sub') = c.user_id))
    with check (exists (select 1 from public.conversations c
                        where c.id = messages.conversation_id
                          and ((select auth.jwt()) ->> 'sub') = c.user_id));
alter policy messages_delete_own on public.messages
    using (exists (select 1 from public.conversations c
                   where c.id = messages.conversation_id
                     and ((select auth.jwt()) ->> 'sub') = c.user_id));

alter policy citations_select_own on public.citations
    using (exists (select 1 from public.messages m
                   join public.conversations c on c.id = m.conversation_id
                   where m.id = citations.message_id
                     and ((select auth.jwt()) ->> 'sub') = c.user_id));
alter policy citations_insert_own on public.citations
    with check (exists (select 1 from public.messages m
                        join public.conversations c on c.id = m.conversation_id
                        where m.id = citations.message_id
                          and ((select auth.jwt()) ->> 'sub') = c.user_id));
alter policy citations_delete_own on public.citations
    using (exists (select 1 from public.messages m
                   join public.conversations c on c.id = m.conversation_id
                   where m.id = citations.message_id
                     and ((select auth.jwt()) ->> 'sub') = c.user_id));

-- 5. Index the superseded_by foreign key (only rows that have one).
create index if not exists messages_superseded_by_idx
    on public.messages (superseded_by)
    where superseded_by is not null;

-- 6. GraphQL is never called.
--    Applied 2026-11-14 but had no effect: supabase_admin granted this usage,
--    and only the grantor can revoke it (this runs as postgres). Disabling
--    the pg_graphql extension removes it, which step 7 does.
revoke usage on schema graphql from anon, authenticated;

commit;

-- 7. Applied afterwards on 2026-11-14 as its own migration
--    (disable_pg_graphql_2026_11_14): turn GraphQL off. Nothing in the app
--    calls it (supabase-js and the backend use PostgREST), and it cleared the
--    pg_graphql_*_table_exposed advisor warnings. Re-enable from
--    Dashboard > Database > Extensions if GraphQL is ever needed.
drop extension if exists pg_graphql;
