-- docs/schema/auditor-migration.sql
--
-- Step 5 PR 4 (auditor). NOT YET APPLIED: run it in the Supabase dashboard SQL
-- editor, after the earlier step 5 migrations.
--
-- An auditor is a roster row with role = 'auditor' (roster.role has no check
-- constraint, so no change to it). Every endpoint other than api/audit.js
-- treats an auditor session as no session, so the role is read-only by
-- default and nothing can be reached by forgetting a role check.
--
-- roster.auditor_access_expires_at: access ends at this instant. Set to 14
-- days out each time the Account Owner sends (or resends) access, and to now
-- to revoke. Checked at sign-in and on every request to api/audit.js.
--
-- auditor_scopes: what one auditor may read, set by the Owner. They see the
-- documents of the chosen types filed at the chosen sites (plus every site of
-- the chosen divisions). Empty means nothing: access is granted, never
-- assumed. Read only; an auditor never writes anything.

alter table public.roster
  add column if not exists auditor_access_expires_at timestamptz;

create table if not exists public.auditor_scopes (
  roster_id bigint primary key references public.roster(id) on delete cascade,
  company_id bigint not null references public.companies(id) on delete cascade,
  division_ids bigint[] not null default '{}',
  site_ids bigint[] not null default '{}',
  document_keys text[] not null default '{}',
  updated_by bigint references public.roster(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists auditor_scopes_company_idx on public.auditor_scopes (company_id);

-- Deny-by-default backstop, same as every other table (README access model).
alter table public.auditor_scopes enable row level security;

-- ── Verification ─────────────────────────────────────────────────────────
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'roster' and column_name = 'auditor_access_expires_at';
-- select relrowsecurity from pg_class where oid = 'public.auditor_scopes'::regclass;
--
-- ── Rollback ─────────────────────────────────────────────────────────────
-- drop table if exists public.auditor_scopes;
-- alter table public.roster drop column if exists auditor_access_expires_at;

-- roster.role is checked against ('worker', 'supervisor'). Without 'auditor'
-- here, create_auditor's insert is rejected by the database. Applied live on
-- 2026-10-07 (migration roster_role_allows_auditor); kept here so a fresh
-- install matches.
alter table public.roster drop constraint if exists roster_role_check;
alter table public.roster
  add constraint roster_role_check check (role = any (array['worker'::text, 'supervisor'::text, 'auditor'::text]));
