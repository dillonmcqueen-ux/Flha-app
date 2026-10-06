-- docs/schema/roster-hide-unassigned-migration.sql
--
-- Step 5 PR 2. NOT YET APPLIED: run it in the Supabase dashboard SQL editor
-- AFTER docs/schema/document-assignments-migration.sql.
--
-- roster.hide_unassigned: the Account Owner's switch for "show this person
-- only the documents assigned to them". With it on, a document is off for
-- that person unless an active submit assignment names them, enforced in
-- every submit handler and the worker menu (server-lib/documentAccess.js),
-- not just hidden on screen. The Owner and the founder are never affected.
-- A database without the column behaves as if everyone is false.

alter table public.roster
  add column if not exists hide_unassigned boolean not null default false;

-- ── Verification ─────────────────────────────────────────────────────────
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'roster' and column_name = 'hide_unassigned';
--
-- ── Rollback ─────────────────────────────────────────────────────────────
-- alter table public.roster drop column if exists hide_unassigned;
