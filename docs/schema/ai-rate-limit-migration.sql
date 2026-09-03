-- Backs a per-user/per-company rate limit on api/generate-flha.js. Closes
-- finding 3 of the pentest-mindset-auditor security audit (see
-- .claude/agents/pentest-mindset-auditor.md): any valid session — even one
-- obtained via a brute-forced 4-digit PIN — could call this endpoint an
-- unlimited number of times with an arbitrary prompt string, running up
-- real Anthropic API cost and exhausting rate-limit headroom for the
-- whole app. Fixed-window counter, reset whenever a request arrives after
-- the window has elapsed. Not a queue or a precise sliding window — just
-- enough to make a tight-loop abuse script hit a wall instead of running
-- unbounded, same non-atomic-read-then-write discipline api/login.js's
-- PIN lockout already uses.
--
-- APPLIED to the live FORA Supabase project (wzyvbtzxxdcxgvbkcqmt) via
-- mcp__Supabase__apply_migration, migration name "ai_generation_rate_limits".
create table if not exists ai_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

-- ── RLS: deny-by-default backstop, matching every other table in this
-- project (see README's Architecture section) — api/generate-flha.js's
-- service-role key is the real access-control boundary, this policy is
-- the safety net if the anon key were ever queried directly.
alter table ai_rate_limits enable row level security;
