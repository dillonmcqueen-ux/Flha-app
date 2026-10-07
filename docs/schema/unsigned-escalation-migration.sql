-- docs/schema/unsigned-escalation-migration.sql
--
-- A record saved to be signed later (docs/schema/sign-later-migration.sql) that
-- nobody signs. Dillon's rule (2026-10-07):
--   - after 24 hours unsigned, the people who would normally be told about the
--     document get one heads-up that it is still unsigned (no content);
--   - after 10 days it is closed unsigned: it stays readable, is marked closed,
--     never reaches the Brain, corrective actions or notifications as a counted
--     record, and can no longer be signed.
--
-- unsigned_alerted_at  set once, atomically, when the 24 hour heads-up is claimed.
-- unsigned_closed_at   set when the record is closed unsigned. awaiting_signature
--                      stays true on purpose, so every read that excludes unsigned
--                      records (maintenance and fuel readings, follow-ups) keeps
--                      excluding it.
-- Nothing is backfilled: existing records keep both columns null.

alter table public.flhas
  add column if not exists unsigned_alerted_at timestamptz,
  add column if not exists unsigned_closed_at timestamptz;
alter table public.incidents
  add column if not exists unsigned_alerted_at timestamptz,
  add column if not exists unsigned_closed_at timestamptz;
alter table public.inspections
  add column if not exists unsigned_alerted_at timestamptz,
  add column if not exists unsigned_closed_at timestamptz;
alter table public.near_misses
  add column if not exists unsigned_alerted_at timestamptz,
  add column if not exists unsigned_closed_at timestamptz;
