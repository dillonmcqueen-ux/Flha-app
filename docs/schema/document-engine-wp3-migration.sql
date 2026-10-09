-- docs/schema/document-engine-wp3-migration.sql
--
-- Unified document engine, work package 3: the rules that DO things. Builds on
-- docs/schema/document-engine-wp1-migration.sql. Idempotent and safe to re-run.
-- NOT YET APPLIED to production: it is applied only after Dillon says so.
-- Until it is, the engine runs without it: an escalation that cannot be
-- written is logged and skipped (it never fails a submit), and the sweeps
-- skip the columns they need.
--
-- document_records:
--   review_step         which step of the reviewer chain the record is on
--                       (0 = the first). Reset to 0 when a returned record is
--                       fixed and sent back for review.
--   review_round        1 more each time a returned record is fixed and sent
--                       back. Approvals are stamped with the round they were
--                       given in, so an approval from an earlier round does not
--                       count against the "different person each step" rule.
--   unsigned_alerted_at the 24 hour "still unsigned" heads-up has been sent
--                       (same meaning as on flhas, incidents and so on).
--   review_alerted_at   the "waiting more than 48 hours for review" escalation
--                       has been sent.
--
-- document_escalations: one row each time an answer trips a route_by_answer
-- rule (the engine's version of portal_escalations). One per field per record.
-- Holds the question text as filed and the option that tripped the rule
-- (trigger_value). Only a field with a fixed set of answers can route, so this
-- is never free text, and never the worker.
--
-- document_notification_state: its document_key CHECK only allowed the
-- built-in keys and custom_<n>, so claim_notification_slot failed for an
-- engine document (engine_<definitionId>) and no engine email was ever sent.
-- The CHECK is widened to allow engine_<n>. The document_notifications table
-- keeps its CHECK: engine documents are switched on by company_documents, not
-- by the Owner's row there.

alter table public.document_records
  add column if not exists review_step integer not null default 0,
  add column if not exists review_round integer not null default 0,
  add column if not exists unsigned_alerted_at timestamptz,
  add column if not exists review_alerted_at timestamptz;

-- The sweeps look at these rows only.
create index if not exists document_records_unsigned_sweep_idx
  on public.document_records (signature_requested_at)
  where awaiting_signature and unsigned_closed_at is null;
create index if not exists document_records_review_sweep_idx
  on public.document_records (submitted_at)
  where status = 'pending_approval' and review_alerted_at is null;

create table if not exists public.document_escalations (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  record_id bigint not null references public.document_records(id) on delete cascade,
  field_key text not null,
  question_text text not null,
  trigger_value text not null,
  target_department text,
  status text not null default 'open' check (status in ('open', 'actioned')),
  actioned_by_roster_id bigint references public.roster(id) on delete set null,
  actioned_at timestamptz,
  created_at timestamptz not null default now(),
  unique (record_id, field_key)
);
create index if not exists document_escalations_company_status_idx
  on public.document_escalations (company_id, status, created_at desc);

alter table public.document_escalations enable row level security;

-- One approval per step per round, enforced by the database: two requests
-- approving the same step at once cannot both be recorded.
create unique index if not exists document_signatures_review_once_uidx
  on public.document_signatures (record_id, step_key, ((meta ->> 'round')))
  where kind = 'approval';

alter table public.document_notification_state
  drop constraint if exists document_notification_state_document_key_check;
alter table public.document_notification_state
  add constraint document_notification_state_document_key_check
  check (document_key ~ '^(flha|inspection|toolbox|nearmiss|incident|daily|monthly|custom_[0-9]+|engine_[0-9]+)$');
