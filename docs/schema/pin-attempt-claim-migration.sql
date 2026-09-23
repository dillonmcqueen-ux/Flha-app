-- Counts a PIN attempt BEFORE it is checked, and refuses it if the account
-- is already locked, in one statement.
--
-- Closes finding 1 of the 2026-09-23 pentest-mindset-auditor sweep.
-- pin-lockout-atomic-migration.sql made the failure counter atomic, but
-- api/login.js still decided "is this account locked?" from a roster row
-- read before any in-flight guess had been counted. N simultaneous guesses
-- all saw "not locked", all reached verifyPin, and the lock only landed
-- after every one had been tried, so one parallel burst could still cover
-- the 4-digit PIN space.
--
-- The UPDATE below only matches an unlocked row. It takes the row lock, so
-- a concurrent caller waits, re-evaluates the WHERE against the row the
-- previous caller wrote, and gets zero rows once the lock is set. A burst
-- therefore gets exactly p_lockout_after guesses. A correct PIN resets the
-- counter in api/login.js, so claiming before checking costs a real user
-- nothing.
--
-- Safe to apply ahead of the code; the code falls back to
-- record_failed_pin_attempt if this function is missing.
--
-- APPLIED to the live FORA Supabase project (wzyvbtzxxdcxgvbkcqmt) via
-- mcp__Supabase__apply_migration, migration name "pin_attempt_claim", 2026-09-23.
-- Verified after applying: prosecdef true, EXECUTE held by service_role
-- only (anon and authenticated have none), and a call with a
-- non-existent roster id returned zero rows without error.

create or replace function claim_pin_attempt(
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
     and (roster.pin_locked_until is null or roster.pin_locked_until <= now())
  returning roster.failed_pin_attempts, roster.pin_locked_until;
$$;

revoke all on function claim_pin_attempt(bigint, int, int) from public;
revoke all on function claim_pin_attempt(bigint, int, int) from anon;
revoke all on function claim_pin_attempt(bigint, int, int) from authenticated;
grant execute on function claim_pin_attempt(bigint, int, int) to service_role;

