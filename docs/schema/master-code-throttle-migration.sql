-- Backs a per-IP throttle on long (master-code-shaped) login attempts in
-- api/login.js. Closes finding 5 of the pentest-mindset-auditor security
-- audit (see .claude/agents/pentest-mindset-auditor.md): the master code
-- was checked on every worker/supervisor login with zero rate limiting of
-- any kind, unlike every other credential in the app.
--
-- Deliberately NOT a lockout on the shared login endpoint itself — that
-- endpoint also carries ordinary worker/supervisor code traffic for every
-- company, and a lockout there would eventually catch normal typos, per
-- api/login.js's own existing comment on verifyMasterCode. Instead this
-- only counts attempts whose entered code is long enough to plausibly be
-- a master-code guess (real company/worker/supervisor codes observed live
-- top out at 13 characters — see MASTER_CODE_THROTTLE_MIN_LENGTH in
-- api/login.js), so ordinary login traffic never touches this counter at
-- all. Fixed-window counter, same non-atomic discipline as the existing
-- PIN lockout and ai_rate_limits.
--
-- APPLIED to the live FORA Supabase project (wzyvbtzxxdcxgvbkcqmt) via
-- mcp__Supabase__apply_migration, migration name "master_code_ip_throttle".
create table if not exists master_code_ip_limits (
  ip text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

-- ── RLS: deny-by-default backstop, matching every other table in this
-- project (see README's Architecture section) — api/login.js's
-- service-role key is the real access-control boundary, this policy is
-- the safety net if the anon key were ever queried directly.
alter table master_code_ip_limits enable row level security;
