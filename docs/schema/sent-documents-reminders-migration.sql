-- docs/schema/sent-documents-reminders-migration.sql
--
-- Send & Sign, overdue reminders. APPLIED to the live FORA Supabase project
-- (wzyvbtzxxdcxgvbkcqmt) via mcp__Supabase__apply_migration, migration name
-- "sent_documents_reminders", 2026-10-21. Additive and nullable:
-- nothing existing changes, and server-lib/sentDocumentsSweep.js does nothing
-- (and logs once) until the column exists, so the code can ship ahead of this.
--
--   reminded_at   when the one overdue reminder for this document was claimed.
--                 Claimed before the email is sent, by a conditional update, so
--                 two overlapping cron runs cannot remind twice. Handed back
--                 (set to null) when the send fails so the next hourly run
--                 tries again. One reminder per document, ever.

alter table public.sent_documents
  add column if not exists reminded_at timestamptz;

-- The sweep reads documents that are open and past due and not yet reminded.
create index if not exists sent_documents_overdue_idx
  on public.sent_documents (due_at)
  where status in ('sent', 'opened') and reminded_at is null and due_at is not null;
