-- Step 3 of the login rework: Account Owner, richer roster profile, and
-- per-company departments and divisions. APPLIED live as
-- "owner_profile_structure".
--
-- roster.is_owner: a flag on a supervisor-role row, deliberately NOT a new
-- roster.role value. Roughly 160 places test role === 'supervisor'; an Owner
-- passes every one of them unchanged, and Owner-only actions check the flag.
-- roster.title: free text (the UI suggests common titles).
-- roster.divisions: ids from company_divisions. A person can hold several.
-- roster.default_site_id: the site forms preselect for that person.
-- roster.departments (already existed): keys. The five built-in keys live in
-- server-lib/portalDepartments.js, company-defined ones in company_departments.

alter table roster
  add column if not exists is_owner boolean not null default false,
  add column if not exists title text,
  add column if not exists divisions bigint[] not null default '{}',
  add column if not exists default_site_id bigint references sites(id) on delete set null;

create table if not exists company_departments (
  id bigserial primary key,
  company_id bigint not null references companies(id) on delete cascade,
  key text not null,
  label text not null,
  created_at timestamptz not null default now(),
  unique (company_id, key)
);

create table if not exists company_divisions (
  id bigserial primary key,
  company_id bigint not null references companies(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists company_divisions_company_name_uq on company_divisions (company_id, lower(name));

-- Deny-by-default backstop, same as every other table (README access model).
alter table company_departments enable row level security;
alter table company_divisions enable row level security;

create index if not exists roster_company_owner_idx on roster (company_id) where is_owner;
