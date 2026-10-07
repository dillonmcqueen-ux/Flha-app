-- docs/schema/roster-lead-migration.sql
--
-- Step 5 PR 3 (crew lead). NOT YET APPLIED: run it in the Supabase dashboard
-- SQL editor, after the two earlier step 5 migrations.
--
-- roster.is_lead: the Account Owner's flag on a WORKER row. A lead is not a
-- new role (roughly 160 places test role === 'worker' or 'supervisor' and a
-- new value would have to be taught to every one). A lead keeps every worker
-- gate and gains a few explicit abilities, checked live from this column:
-- see server-lib/leadAccess.js. The Owner and supervisors never carry it.
--
-- entered_by_roster_id: set only when a lead fills in a Daily Report or Fuel
-- Log for a crew member. The crew member stays the author
-- (submitted_by_roster_id); this records who typed it in. Null on every
-- ordinary submission, and the application never writes it unless a lead is
-- filling in for someone, so a database without the column is unaffected
-- until someone does.

alter table public.roster
  add column if not exists is_lead boolean not null default false;

-- by_lead: set on a task a crew lead created. A lead's task puts a document
-- on someone's list but never overrides the Owner's "hide everything not
-- assigned to me" switch. Needs document_assignments (the first step 5
-- migration) to exist.
alter table public.document_assignments
  add column if not exists by_lead boolean not null default false;

alter table public.daily_reports
  add column if not exists entered_by_roster_id bigint references public.roster(id) on delete set null;

alter table public.fuel_logs
  add column if not exists entered_by_roster_id bigint references public.roster(id) on delete set null;

-- ── Verification ─────────────────────────────────────────────────────────
-- select table_name, column_name from information_schema.columns
--   where table_schema = 'public'
--     and ((table_name = 'roster' and column_name = 'is_lead')
--       or (table_name = 'document_assignments' and column_name = 'by_lead')
--       or (table_name in ('daily_reports', 'fuel_logs') and column_name = 'entered_by_roster_id'));
--
-- ── Rollback ─────────────────────────────────────────────────────────────
-- alter table public.fuel_logs drop column if exists entered_by_roster_id;
-- alter table public.daily_reports drop column if exists entered_by_roster_id;
-- alter table public.roster drop column if exists is_lead;
-- alter table public.document_assignments drop column if exists by_lead;
