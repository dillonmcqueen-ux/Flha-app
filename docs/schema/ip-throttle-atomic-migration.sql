-- Makes the per-IP throttle counter atomic.
--
-- Closes finding 2 of the 2026-09-23 pentest-mindset-auditor sweep.
-- checkIpThrottle (api/login.js, api/checkout.js) read master_code_ip_limits
-- and wrote count + 1 back from Node, so N concurrent requests all read the
-- same count and all wrote the same value: a burst advanced the counter by
-- one. Every ceiling built on it (master code, company code, PIN per IP,
-- onboarding intake/upload, checkout) collapsed under concurrency.
--
-- One INSERT ... ON CONFLICT DO UPDATE bumps the counter (or starts a fresh
-- window) and returns the new count; server-lib/ipThrottle.js allows the
-- request only when that count is <= the cap. Rejected requests still
-- count, which is harmless: the window start does not move until it expires.
--
-- Safe to apply ahead of the code: nothing calls it until the matching
-- deploy, and that code falls back to the old path if it is missing.
--
-- APPLIED to the live FORA Supabase project (wzyvbtzxxdcxgvbkcqmt) via
-- mcp__Supabase__apply_migration, migration name "ip_throttle_atomic", 2026-09-23.
-- Verified after applying: prosecdef true, EXECUTE held by service_role
-- only (anon and authenticated have none), and three calls on a
-- throwaway key returned 1, 2, 3 (row deleted afterwards).

create or replace function bump_ip_throttle(p_key text, p_window_seconds int)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into master_code_ip_limits as t (ip, window_start, count)
  values (p_key, now(), 1)
  on conflict (ip) do update
    set window_start = case
          when t.window_start < now() - make_interval(secs => p_window_seconds) then now()
          else t.window_start
        end,
        count = case
          when t.window_start < now() - make_interval(secs => p_window_seconds) then 1
          else t.count + 1
        end
  returning t.count;
$$;

revoke all on function bump_ip_throttle(text, int) from public;
revoke all on function bump_ip_throttle(text, int) from anon;
revoke all on function bump_ip_throttle(text, int) from authenticated;
grant execute on function bump_ip_throttle(text, int) to service_role;
