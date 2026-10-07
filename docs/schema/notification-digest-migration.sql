-- docs/schema/notification-digest-migration.sql
--
-- Notification routing, held-notice digest. Functions only: no table changes.
-- APPLIED LIVE 2026-10-07 (project FORA) as migration notification_digest_functions.
-- Verified on ABC Earthworks: claim returns the held count and resets it, a second
-- claim returns nothing, refund restores slots and count; anon and authenticated
-- cannot execute either function.
--
-- Past the burst limit (3 emails per person per document per 10 minutes) a
-- notice is only counted (document_notification_state.suppressed_count). Before
-- this file, that count surfaced only if another notice arrived after the window.
-- Two functions close the gap:
--
--   claim_held_notices   hands the cron every row whose window has ended and that
--                        still holds notices, resetting each count to zero in the
--                        same transaction. FOR UPDATE SKIP LOCKED, so two cron runs
--                        (or a run overlapping a retry) never take the same row.
--   refund_notification_slot
--                        puts back what a failed email spent: slots (so the person
--                        is not locked out of the window by a send that never went)
--                        and held notices (so a failed digest or a failed rollover
--                        email does not lose the count).
--
-- Both are security invoker, search_path pinned, executable by service_role only.

create or replace function public.claim_held_notices(p_window_seconds integer, p_limit integer)
returns table (company_id bigint, document_key text, roster_id bigint, held integer)
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select s.company_id, s.document_key, s.roster_id, s.suppressed_count
      from public.document_notification_state s
     where s.suppressed_count > 0
       and now() - s.window_started_at >= make_interval(secs => p_window_seconds)
     order by s.window_started_at
     limit greatest(p_limit, 0)
     for update skip locked
  ), upd as (
    update public.document_notification_state t
       set suppressed_count = 0
      from due
     where t.company_id = due.company_id
       and t.document_key = due.document_key
       and t.roster_id = due.roster_id
    returning due.company_id, due.document_key, due.roster_id, due.suppressed_count
  )
  select upd.company_id, upd.document_key, upd.roster_id, upd.suppressed_count from upd;
end;
$$;

create or replace function public.refund_notification_slot(
  p_company bigint, p_key text, p_roster bigint, p_slots integer, p_held integer
) returns void
language sql
set search_path = public, pg_temp
as $$
  update public.document_notification_state
     set sent_in_window = greatest(sent_in_window - greatest(p_slots, 0), 0),
         suppressed_count = least(suppressed_count + greatest(p_held, 0), 999)
   where company_id = p_company and document_key = p_key and roster_id = p_roster;
$$;

revoke all on function public.claim_held_notices(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_held_notices(integer, integer) to service_role;
revoke all on function public.refund_notification_slot(bigint, text, bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.refund_notification_slot(bigint, text, bigint, integer, integer) to service_role;

-- ── Verification ─────────────────────────────────────────────────────────
-- select proname, proconfig from pg_proc where proname in ('claim_held_notices', 'refund_notification_slot');
-- select has_function_privilege('anon', 'public.claim_held_notices(integer,integer)', 'execute');
--
-- ── Rollback ─────────────────────────────────────────────────────────────
-- drop function if exists public.refund_notification_slot(bigint, text, bigint, integer, integer);
-- drop function if exists public.claim_held_notices(integer, integer);
