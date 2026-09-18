-- docs/schema/equipment-fleet-management-migration.sql
--
-- Supervisor-editable fleet, attachments as a real flag, per-machine
-- compliance expiries, and joinable equipment on daily reports.
--
-- Decision from Dillon, 2026-09-17: "the supervisor should be able to edit
-- their fleet including the asset id if needed, so that list becomes
-- available anywhere that uses a piece of equipment, daily reports should
-- be able to pick multiple while inspections can only pick one unless it's
-- an attachment."
--
-- Four separate problems, one migration:
--
--   1. There was no way to CHANGE a machine. api/companydata.js had
--      add/delete and nothing between them, so correcting a mistyped unit
--      number meant deleting the row -- which detaches every inspection
--      ever filed against it and hard-deletes its maintenance log. That is
--      why `retired_at` exists below: a machine that left the fleet needs
--      to stop appearing in worker dropdowns WITHOUT destroying the history
--      hanging off its id. Hard delete stays admin-only and unchanged.
--
--   2. "Is this an attachment?" was inferred from the make/model text
--      (isTrailerTemplate in src/equipmentInspectionTemplates.js). That
--      works for something with the word "trailer" in it and fails silently
--      for a bucket, a hammer, a mulcher or a plate tamper. It is a fact
--      about the machine, so it belongs on the machine.
--
--   3. CVIP / registration / insurance expiries had nowhere to live, so a
--      plated unit's out-of-date inspection sticker was not something the
--      product could ever warn about.
--
--   4. daily_reports.equipment is a comma-joined TEXT summary. Every other
--      form that names a machine carries a real equipment_id beside the
--      label (inspections, fuel_logs, corrective_actions); the daily report
--      does not, so "which machines were on site last Tuesday" cannot be
--      answered by a join. equipment_ids below is the joinable half, with
--      the same producer/consumer discipline as site_id in
--      docs/schema/site-id-on-field-forms-migration.sql: the text stays
--      authoritative for display, the ids are additive.
--
-- ── Backward compatibility ───────────────────────────────────────────────
--
-- Every column added here is nullable or carries a default, and nothing
-- existing is made NOT NULL. Both existing equipment writers
-- (api/companydata.js add_equipment, src/Inspection.jsx's rental auto-save
-- via the same action) keep working untouched. The new table is additive.
--
-- ── APPLIED ──────────────────────────────────────────────────────────────
--
-- Applied to the production project (FORA, wzyvbtzxxdcxgvbkcqmt) on
-- 2026-09-18 as migration `equipment_fleet_management`, and verified against
-- the live database immediately after:
--
--   * all five new `equipment` columns present; `is_attachment` NOT NULL
--     DEFAULT false, the other four nullable, nothing forced NOT NULL;
--   * 11 existing machines, 0 retired, 0 flagged as attachments — every
--     existing row untouched, which is what the defaults exist to guarantee;
--   * `equipment_compliance` created with RLS enabled and 0 policies, the
--     deny-by-default backstop every other table in this schema uses;
--   * `daily_reports.equipment_ids` present;
--   * the exact column list `list_equipment` selects, with its
--     `retired_at is null` filter, returns live rows.
--
-- Kept here rather than deleted: this file is the record of what the schema
-- is, and the rollback block at the bottom is only useful while it exists.

-- ── 1. Fleet rows: editable identity, attachments, retirement ────────────

alter table public.equipment
  add column if not exists is_attachment  boolean not null default false,
  add column if not exists serial_number  text,
  add column if not exists notes          text,
  add column if not exists retired_at     timestamptz,
  add column if not exists retired_by     text;

-- Worker-facing pickers filter on this; the supervisor fleet view does not.
create index if not exists equipment_company_active_idx
  on public.equipment (company_id, retired_at);

-- ── 2. Compliance expiries (CVIP, registration, insurance, anything) ─────
--
-- A separate table rather than three date columns on `equipment`, because
-- the list is open-ended by industry: a gravel truck has a CVIP and a
-- registration, a crane has a third-party certification, a pressure vessel
-- has a re-test date. Three columns would have needed a fourth within a
-- month. doc_type is free text with a UI-suggested list rather than a check
-- constraint for the same reason.
--
-- on delete cascade is correct HERE and wrong for inspections: an expiry
-- date is a fact about a machine that is meaningless once the machine row
-- is gone, whereas a submitted inspection is a signed safety record that
-- must outlive the fleet row (see delete_equipment's detach in
-- api/companydata.js).
create table if not exists public.equipment_compliance (
  id           bigint generated by default as identity primary key,
  company_id   bigint      not null references public.companies(id),
  equipment_id bigint      not null references public.equipment(id) on delete cascade,
  doc_type     text        not null,
  label        text,
  expiry_date  date        not null,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists equipment_compliance_company_expiry_idx
  on public.equipment_compliance (company_id, expiry_date);
create index if not exists equipment_compliance_equipment_idx
  on public.equipment_compliance (equipment_id);

-- Deny-by-default backstop, matching every other table in this schema:
-- RLS on, no policies, so the anon key that ships in the client bundle
-- reaches nothing. All access goes through the service role in api/.
alter table public.equipment_compliance enable row level security;

-- ── 3. Daily reports: the joinable half of the equipment list ────────────
--
-- jsonb rather than bigint[] to match how this codebase already stores
-- client-supplied arrays (results_json, attendees_json, report_json) and
-- because api/logs.js's pickAllowed passes the value through untouched --
-- a jsonb column accepts what the client sends without a driver-level
-- array coercion step that has no equivalent anywhere else here.
--
-- Contents are vetted server-side against the caller's own fleet before the
-- insert (server-lib/equipmentScope.js), the same as inspections.equipment_id.
alter table public.daily_reports
  add column if not exists equipment_ids jsonb;

-- ── Verification ─────────────────────────────────────────────────────────
--
-- -- new columns present, nothing forced NOT NULL:
-- select column_name, is_nullable, column_default
-- from information_schema.columns
-- where table_name = 'equipment' and column_name in
--   ('is_attachment', 'serial_number', 'notes', 'retired_at', 'retired_by');
--
-- -- every existing machine is active and not an attachment:
-- select count(*) filter (where retired_at is not null) as retired,
--        count(*) filter (where is_attachment)          as attachments,
--        count(*)                                       as total
-- from public.equipment;
--
-- -- RLS enabled with no policies on the new table:
-- select relrowsecurity from pg_class where relname = 'equipment_compliance';
-- select count(*) from pg_policies where tablename = 'equipment_compliance';
--
-- ── Rollback ─────────────────────────────────────────────────────────────
-- drop table if exists public.equipment_compliance;
-- alter table public.daily_reports drop column if exists equipment_ids;
-- alter table public.equipment
--   drop column if exists is_attachment,
--   drop column if exists serial_number,
--   drop column if exists notes,
--   drop column if exists retired_at,
--   drop column if exists retired_by;
