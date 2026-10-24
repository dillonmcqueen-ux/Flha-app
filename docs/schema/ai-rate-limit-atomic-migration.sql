-- Makes the api/generate-flha.js rate limit atomic. checkRateLimit used to
-- read the row, then write count + 1 back from Node, so N simultaneous
-- requests all read the same count and all passed: the "20 per 10 minutes"
-- cap did not hold under concurrency (finding F2 of the 2026-10-24 sweep).
-- Same fix as bump_ip_throttle (ip-throttle-atomic-migration.sql): one
-- INSERT ... ON CONFLICT DO UPDATE, and the caller decides on the value the
-- statement returns.
--
-- NOT YET APPLIED to the live FORA project. api/generate-flha.js falls back
-- to the old non-atomic path while this function is missing, so deploy order
-- does not matter. Verify after applying: prosecdef true, EXECUTE held by
-- service_role only, and three calls on a throwaway key return 1, 2, 3
-- (delete that row afterwards).

create or replace function bump_ai_rate_limit(p_key text, p_window_seconds int)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into ai_rate_limits as t (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
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

revoke all on function bump_ai_rate_limit(text, int) from public;
revoke all on function bump_ai_rate_limit(text, int) from anon;
revoke all on function bump_ai_rate_limit(text, int) from authenticated;
grant execute on function bump_ai_rate_limit(text, int) to service_role;
