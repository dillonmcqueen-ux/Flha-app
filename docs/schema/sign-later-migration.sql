-- docs/schema/sign-later-migration.sql
--
-- "Worker signs afterwards". NOT YET APPLIED: run it in the Supabase
-- dashboard SQL editor. Idempotent and safe to re-run.
--
-- awaiting_signature: true while the author has not yet signed the record.
-- A record in that state shows to supervisors as "Awaiting <name>'s
-- signature" and cannot be approved. Only the roster member it is stamped to
-- (submitted_by_roster_id) can clear it.
-- signature_requested_at: when the record was saved unsigned. Drives the
-- 24 hour note on a crew lead's crew screen.
-- worker_signed_at: when the author signed afterwards. Null for a record
-- signed at submit time (its created_at is its signing time).
--
-- Nothing is backfilled: every existing record keeps awaiting_signature
-- false. The application refuses a sign-later save until this has run, so a
-- database without the columns never holds an unsigned record that nothing
-- blocks.

alter table public.flhas
  add column if not exists awaiting_signature boolean not null default false,
  add column if not exists signature_requested_at timestamptz,
  add column if not exists worker_signed_at timestamptz;

alter table public.incidents
  add column if not exists awaiting_signature boolean not null default false,
  add column if not exists signature_requested_at timestamptz,
  add column if not exists worker_signed_at timestamptz;

alter table public.inspections
  add column if not exists awaiting_signature boolean not null default false,
  add column if not exists signature_requested_at timestamptz,
  add column if not exists worker_signed_at timestamptz;

alter table public.near_misses
  add column if not exists awaiting_signature boolean not null default false,
  add column if not exists signature_requested_at timestamptz,
  add column if not exists worker_signed_at timestamptz;

-- The lead's crew screen and a worker's own "needs your signature" list both
-- look up open rows only.
create index if not exists flhas_awaiting_signature_idx
  on public.flhas (company_id, submitted_by_roster_id) where awaiting_signature;
create index if not exists incidents_awaiting_signature_idx
  on public.incidents (company_id, submitted_by_roster_id) where awaiting_signature;
create index if not exists inspections_awaiting_signature_idx
  on public.inspections (company_id, submitted_by_roster_id) where awaiting_signature;
create index if not exists near_misses_awaiting_signature_idx
  on public.near_misses (company_id, submitted_by_roster_id) where awaiting_signature;

-- A near miss filed anonymously carries no author, so nobody could ever sign
-- it afterwards. The anonymous option and sign-later never combine: the
-- application refuses it, and the database says so too.
alter table public.near_misses
  drop constraint if exists near_misses_anonymous_not_awaiting_signature;
alter table public.near_misses
  add constraint near_misses_anonymous_not_awaiting_signature
  check (not (awaiting_signature and is_anonymous));
