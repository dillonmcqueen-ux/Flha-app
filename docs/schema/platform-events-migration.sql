-- Platform health telemetry for the founder dashboard (Admin Panel).
--
-- One row per cron run, outbound email attempt, or AI call. It answers
-- "is the platform healthy and what does it cost" from data FORA holds,
-- instead of from Vercel logs that expire.
--
-- Deliberately NOT stored: prompts, model outputs, email addresses, email
-- subjects, document content, worker names. `metrics` carries counts,
-- token numbers, latency and short enum-like strings only (server-lib/
-- platformEvents.js drops anything else before insert). company_id is set
-- where the writer knows it (AI calls do; cron runs are platform-wide).
--
-- Cost is derived at read time from token counts, not stored, so a price
-- change never leaves stale dollar figures in old rows.
--
-- Retention: no cleanup job yet. Volume is one row per AI call plus a few
-- per day, which is small; add a delete-older-than-N-days job if it ever
-- matters.
create table if not exists public.platform_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event_type text not null,          -- 'cron_run' | 'email_send' | 'ai_generation'
  status text not null,              -- 'ok' | 'error' | 'skipped' | 'refused' | 'rate_limited' | 'truncated'
  subtype text,                      -- cron name, document type, or AI call site
  company_id bigint,                 -- nullable on purpose; not an FK so a deleted company keeps its history
  metrics jsonb                      -- counts / tokens / latency only
);

create index if not exists platform_events_type_created_idx on public.platform_events (event_type, created_at desc);
create index if not exists platform_events_company_created_idx on public.platform_events (company_id, created_at desc);

-- RLS: deny-by-default backstop, same as every other table. The service-role
-- key in api/*.js is the real access boundary; there are no policies.
alter table public.platform_events enable row level security;

-- NOT YET APPLIED to the live FORA Supabase project. Apply only on Dillon's
-- explicit yes, via mcp__Supabase__apply_migration.
