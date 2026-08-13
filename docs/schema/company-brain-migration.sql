-- Schema changes required for Phase 1 of the "company brain" work
-- (docs/scope-company-brain.md).
--
-- This session has no Supabase credentials / migration tooling available
-- (no MCP DB access, no SUPABASE_* env vars, no supabase/ CLI project in
-- this repo), so these statements were written but NOT applied. A human
-- with project access needs to run this against the Supabase project
-- before deploying the corresponding code (api/companydata.js's
-- get_company_profile / update_company_profile actions read/write
-- company_profiles; api/flhas.js, api/logs.js, and api/reports.js write
-- to company_signals as part of Phase 3's signal capture).
--
-- Two new tables, both company-scoped exactly like every other
-- company-scoped table in this schema (roster, sops, sites, equipment,
-- etc.) — company_id FK, RLS enabled with zero policies (deny-by-default
-- backstop per README.md), all real access-control done in api/*.js
-- against the session-verified company_id, not at the DB layer.

create table if not exists company_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  status text not null default 'draft', -- 'draft' | 'confirmed' — draft until an admin reviews it, same pattern as onboarding's equipment_draft/sop_drafts
  industry_inference text, -- e.g. "earthworks / heavy civil" — inferred at onboarding from units_list, uploaded SOPs, and company name only (no external/web lookups)
  equipment_summary text,
  terminology_notes text,
  hazard_emphasis jsonb not null default '[]'::jsonb, -- [{ category, note }] — company-specific emphasis learned from signals over time. NEVER read as a risk-rating override — generation-time code must only use this to bias which hazards/terminology get surfaced, never to lower a risk level or skip a required baseline category (docs/scope-company-brain.md "Safety floor").
  last_summarized_at timestamptz, -- set by the Phase 4 batch job when it last rolled signals into hazard_emphasis/terminology_notes
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One profile per company.
create unique index if not exists company_profiles_company_id_idx
  on company_profiles (company_id);

alter table company_profiles enable row level security;

create table if not exists company_signals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  source_type text not null, -- 'flha_edit' | 'toolbox_talk' | 'incident' | 'near_miss'
  source_id text, -- id of the originating row (flhas.id, etc.), stringified — text rather than uuid since source tables use mixed PK types (this repo has no single convention) and this column has no FK constraint, only informational
  signal_json jsonb not null, -- structured payload: for flha_edit, a diff of hazards added/removed/risk-changed between AI output and what was submitted; for toolbox_talk/incident/near_miss, topic/category
  created_at timestamptz not null default now()
);

-- Append-only by design (Phase 3 note in docs/scope-company-brain.md) —
-- no updated_at, rows are never mutated after insert.

create index if not exists company_signals_company_id_created_at_idx
  on company_signals (company_id, created_at desc);

alter table company_signals enable row level security;
