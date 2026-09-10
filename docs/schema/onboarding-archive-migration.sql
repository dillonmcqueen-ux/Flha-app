-- Schema changes required for archive/delete onboarding requests + the
-- duplicate-company flag (api/admin.js's archive_onboarding_request,
-- delete_onboarding_request, and list_onboarding_requests changes).
--
-- Apply this against the Supabase project before deploying the
-- corresponding code — this session's direct-DDL attempt against the live
-- database was blocked by the auto-mode classifier, so it wasn't applied
-- automatically. Run it by hand (Supabase SQL editor, or `supabase db
-- push` with this as a migration file).

-- Archiving is a pure "hide from the default list" toggle, separate from
-- the new/in_progress/needs_info/done workflow status column below — an
-- archived request keeps whatever status it had, and can always be
-- brought back (delete_onboarding_request is a hard delete; archive is
-- not).
alter table onboarding_requests
  add column if not exists archived boolean not null default false;

-- Also found while touching this table: the status check constraint only
-- ever allowed 'new'/'in_progress'/'done', but application code has been
-- writing 'needs_info' (api/admin.js's update_onboarding_status) and
-- 'auto_approved' (server-lib/onboardingApproval.js's auto-approve path)
-- for a while — those writes would fail against this constraint as
-- written. Widening it to match what the app actually writes.
alter table onboarding_requests drop constraint if exists onboarding_requests_status_check;
alter table onboarding_requests add constraint onboarding_requests_status_check
  check (status = ANY (ARRAY['new'::text, 'in_progress'::text, 'needs_info'::text, 'done'::text, 'auto_approved'::text]));
