-- Schema for Gatehouse: the transfer-station receipt module built for the
-- Red Deer County demo (see the proposal artifact from this planning
-- session). Runs on the same companies/session/auth backbone as FORA's
-- safety-document product, but with its own tables — a Gatehouse company
-- never touches flhas/sops/roster/equipment etc., and a safety company
-- never touches these.
--
-- This session has no Supabase credentials / migration tooling available
-- (same situation as docs/schema/onboarding-automation-migration.sql), so
-- these statements were written but NOT applied. A human with project
-- access needs to run this against the Supabase project before deploying
-- api/gatehouse.js and the Gatehouse frontend.

-- ── companies: which product a company is on ────────────────────────────
-- Existing FLHA-safety companies are unaffected (default keeps them on
-- 'safety'). Login/session code branches on this to route a company's
-- workers/supervisors to the Gatehouse UI instead of WorkerMenu/Dashboard.
alter table companies
  add column if not exists app_type text not null default 'safety';
-- values: 'safety' | 'gatehouse'

-- ── gatehouse_stations ───────────────────────────────────────────────────
-- One row per physical transfer station (e.g. Yankee Flats, Gaetz Creek).
-- next_receipt_number is the single source of truth for sequential,
-- gap-free receipt numbering — incremented transactionally by
-- log_transaction in api/gatehouse.js, never chosen by the client.
create table if not exists gatehouse_stations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  next_receipt_number integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists gatehouse_stations_company_id_idx
  on gatehouse_stations (company_id);

-- ── gatehouse_price_tiers ────────────────────────────────────────────────
-- The county's preset load-size price list. sort_order controls button
-- order on the booth screen.
create table if not exists gatehouse_price_tiers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  label text not null,
  price numeric(10,2) not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists gatehouse_price_tiers_company_id_idx
  on gatehouse_price_tiers (company_id);

-- ── gatehouse_vehicles ───────────────────────────────────────────────────
-- Plate/email memory — looked up by plate at the booth so a returning
-- vehicle's email autofills instead of being re-typed.
create table if not exists gatehouse_vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  plate text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, plate)
);

-- ── gatehouse_transactions ───────────────────────────────────────────────
-- One row per load: a priced tip, or a redirect (tier_id/amount/
-- payment_method all null, redirected = true). tier_label and price are
-- snapshotted onto the row at write time so a later price-list edit never
-- rewrites history. business_date is the operating day this belongs to
-- (set client-side from the booth's local clock at entry time, since a
-- transaction may sync hours after it was actually made offline) — daily
-- reports group on this, not created_at.
create table if not exists gatehouse_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  station_id uuid not null references gatehouse_stations(id) on delete cascade,
  receipt_number integer not null,
  business_date date not null,
  tier_id uuid references gatehouse_price_tiers(id),
  tier_label text,
  amount numeric(10,2),
  payment_method text, -- 'cash' | 'cheque' | null (redirected loads)
  cheque_photo_url text,
  plate text,
  vehicle_email text,
  redirected boolean not null default false,
  operator_name text,
  client_submission_id text not null,
  created_at timestamptz not null default now(),
  unique (company_id, station_id, receipt_number),
  unique (company_id, client_submission_id)
);
create index if not exists gatehouse_transactions_company_station_date_idx
  on gatehouse_transactions (company_id, station_id, business_date);

-- ── gatehouse_reconciliations ────────────────────────────────────────────
-- One row per station per business day: what Gatehouse expected in the
-- till from that day's cash transactions vs. what was actually counted.
create table if not exists gatehouse_reconciliations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  station_id uuid not null references gatehouse_stations(id) on delete cascade,
  business_date date not null,
  expected_cash numeric(10,2) not null,
  cash_counted numeric(10,2) not null,
  variance numeric(10,2) not null,
  submitted_by text,
  created_at timestamptz not null default now(),
  unique (company_id, station_id, business_date)
);

-- ── gatehouse_trailer_counts ─────────────────────────────────────────────
-- Manually entered for the demo (see the proposal's TRUX callout) — the
-- receiving facility's trailer count for a station/period, checked against
-- reported load volume for the same window. A live TRUX pull is a
-- phase-2 replacement for manual entry, not a schema change.
create table if not exists gatehouse_trailer_counts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  station_id uuid not null references gatehouse_stations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  trailers_out integer not null,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);
create index if not exists gatehouse_trailer_counts_company_station_idx
  on gatehouse_trailer_counts (company_id, station_id);

-- ── RLS: deny-by-default backstop, matching every other table in this
-- project (see README's Architecture section) — api/gatehouse.js's
-- service-role key is the real access-control boundary, these policies
-- are the safety net if the anon key were ever queried directly.
alter table gatehouse_stations enable row level security;
alter table gatehouse_price_tiers enable row level security;
alter table gatehouse_vehicles enable row level security;
alter table gatehouse_transactions enable row level security;
alter table gatehouse_reconciliations enable row level security;
alter table gatehouse_trailer_counts enable row level security;

-- ── Demo seed: Red Deer County ───────────────────────────────────────────
-- Uncomment and run after confirming the target company_code is free.
-- Update supervisor/worker codes as needed before running.
--
-- insert into companies (name, company_code, app_type)
--   values ('Red Deer County', 'REDDEER-DEMO', 'gatehouse')
--   returning id;
--
-- -- then, using the returned id as :company_id:
-- insert into gatehouse_stations (company_id, name) values
--   (:company_id, 'Yankee Flats'),
--   (:company_id, 'Gaetz Creek');
--
-- insert into gatehouse_price_tiers (company_id, label, price, sort_order) values
--   (:company_id, 'Car / small trailer', 15.00, 1),
--   (:company_id, 'Pickup truck', 25.00, 2),
--   (:company_id, 'Single-axle trailer', 40.00, 3),
--   (:company_id, 'Tandem-axle trailer', 65.00, 4);
