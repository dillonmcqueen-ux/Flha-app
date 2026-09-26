-- docs/schema/roster-phone-migration.sql
--
-- A phone number on a roster row, editable by a supervisor from the new
-- worker-profile drawer (src/WorkerProfileDrawer.jsx) alongside email and
-- role. Same shape as roster.email (docs/schema/worker-certifications-migration.sql):
-- nullable, no uniqueness constraint (unlike employee_id, a phone number is
-- not a join key to anything), no existing writer touches it, so every
-- existing roster row keeps working unchanged.

alter table public.roster
  add column if not exists phone text;

-- ── Verification ─────────────────────────────────────────────────────────
--
-- select column_name, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'roster'
--   and column_name = 'phone';
--
-- ── Rollback ─────────────────────────────────────────────────────────────
-- alter table public.roster drop column if exists phone;
