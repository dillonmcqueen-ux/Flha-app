-- Makes the roster PIN lockout counter atomic.
--
-- Closes finding 1 of the 2026-09-14 pentest-mindset-auditor sweep. The
-- lockout in api/login.js's `roster_login` was a read-modify-write: the
-- roster row was SELECTed, `failed_pin_attempts + 1` computed in Node,
-- then written back. Under N concurrent requests for the same roster id,
-- every request read the same starting count and every request wrote back
-- that same value + 1, so the counter never reached
-- PIN_LOCKOUT_AFTER_ATTEMPTS and `pin_locked_until` was never set. A
-- 4-digit PIN space could therefore be exhausted in one parallel burst,
-- with the lockout present but never tripping.
--
-- The UPDATE below takes a row lock for the duration of the statement, so
-- concurrent callers serialize on it and each one sees the previous
-- increment. The threshold then holds regardless of request concurrency.
--
-- Safe to apply ahead of the code that uses it: nothing calls this
-- function until the matching api/login.js deploy lands, and that code
-- falls back to the old non-atomic path if the function is missing, so
-- the two can be deployed in either order without locking anyone out.
--
-- NOT YET APPLIED to the live FORA Supabase project (wzyvbtzxxdcxgvbkcqmt)
-- — apply it before or alongside merging this branch.

create or replace function record_failed_pin_attempt(
  p_roster_id bigint,
  p_lockout_after int,
  p_lockout_seconds int
)
returns table (failed_pin_attempts int, pin_locked_until timestamptz)
language sql
security definer
set search_path = public
as $$
  update roster
     set failed_pin_attempts = coalesce(roster.failed_pin_attempts, 0) + 1,
         pin_locked_until = case
           when coalesce(roster.failed_pin_attempts, 0) + 1 >= p_lockout_after
             then now() + make_interval(secs => p_lockout_seconds)
           else roster.pin_locked_until
         end
   where roster.id = p_roster_id
  returning roster.failed_pin_attempts, roster.pin_locked_until;
$$;

-- Callable only by the service role (api/*.js). RLS is deny-by-default on
-- every table and no anon/authenticated client should ever reach this.
revoke all on function record_failed_pin_attempt(bigint, int, int) from public;
revoke all on function record_failed_pin_attempt(bigint, int, int) from anon;
revoke all on function record_failed_pin_attempt(bigint, int, int) from authenticated;
