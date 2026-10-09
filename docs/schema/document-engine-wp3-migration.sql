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
--   unsigned_alerted_at the 24 hour "still unsigned" heads-up has been sent
--                       (same meaning as on flhas, incidents and so on).
--   review_alerted_at   the "waiting more than 48 hours for review" escalation
--                       has been sent.
--
-- document_escalations: one row each time an answer trips a route_by_answer
-- rule (the engine's version of portal_escalations). One per field per record.
-- Holds the question text as filed, never the answer value.

alter table public.document_records
  add column if not exists review_step integer not null default 0,
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
