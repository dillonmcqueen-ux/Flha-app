-- docs/schema/equipment-compliance-module-backfill.sql
--
-- Data statement, not DDL. Kept here because docs/schema/ is this repo's
-- record of what the schema and its contents actually are, and a one-off SQL
-- run against production that nobody wrote down is one nobody can re-verify.
--
-- ── Why ──────────────────────────────────────────────────────────────────
--
-- Break #19: Equipment Compliance shipped to every company free because no
-- pricing module sold it. It is a module now (`compliance`, $20/$45), which
-- adds the document key `equipment_compliance`.
--
-- Two things already make the new key default to OFF without this file:
-- `api/customforms.js` now resolves a missing company_document_settings row
-- as inactive for built-in keys, and `documentSettingsFor` writes an
-- explicit row for every key in ALL_DOC_KEYS at provisioning, so every
-- company signing up from now on gets an explicit true or false.
--
-- This exists for the companies that already exist. Relying on the default
-- would leave their state inferred rather than recorded, which is the exact
-- shape of the bug being closed.
--
-- ── The one that is true, and why ────────────────────────────────────────
--
-- Company 1 is the populated demo company and is the only one holding any
-- equipment_compliance rows. Setting it false would make data Dillon has
-- already entered vanish from the screen he entered it on. The other two
-- companies have no compliance data and did not buy the module.
--
-- All three are test companies (confirmed by Dillon, 2026-09-18). There are
-- no paying customers, so nothing here is a billing event.

insert into public.company_document_settings (company_id, document_key, is_active)
select c.id,
       'equipment_compliance',
       c.id = 1   -- the demo company keeps what it has; nobody else bought it
from public.companies c
on conflict (company_id, document_key) do nothing;

-- ── Verification ─────────────────────────────────────────────────────────
--
-- -- every company has an explicit answer, and only company 1 is on:
-- select company_id, is_active
-- from public.company_document_settings
-- where document_key = 'equipment_compliance'
-- order by company_id;
--
-- -- nothing is left resolving by default: 13 built-in keys per company
-- select company_id, count(*) filter (where document_key not like 'custom_%') as builtin_rows
-- from public.company_document_settings group by company_id order by company_id;
--
-- ── Rollback ─────────────────────────────────────────────────────────────
-- delete from public.company_document_settings where document_key = 'equipment_compliance';
