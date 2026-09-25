-- Adds an application-level audit log for administrative/access-control
-- actions, beyond the master-code login log that already existed. Backs
-- SOC 2 readiness gap #10 (docs/security/soc2-readiness-gaps.md): "no
-- application-level audit log (who viewed which record, when)".
--
-- Deliberately scoped to WHO CHANGED WHAT about access/configuration, not
-- every read or every worker form submission — those records already
-- self-document (a submitted FLHA row already carries who submitted it and
-- when; see server-lib/authorStamp.js). What was missing was a record of
-- administrative actions: who changed a company's plan tier, who reset the
-- master code, who suspended or deleted a company, who enabled/disabled
-- MFA, who approved an onboarding request. Instrumented in api/admin.js —
-- see server-lib/auditLog.js.
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_role text not null,          -- 'admin' today; room for other privileged roles later
  action text not null,              -- e.g. 'set_plan_tier', 'delete_company'
  company_id integer,                -- the company acted on/within, if any
  target_type text,                  -- e.g. 'company', 'onboarding_request'
  target_id text,                    -- stringified id of the target row
  details jsonb                      -- small, non-sensitive context (e.g. {"tier": "advanced"}) — never a credential or PIN
);

create index if not exists audit_log_company_id_idx on audit_log (company_id);
create index if not exists audit_log_created_at_idx on audit_log (created_at desc);

-- RLS: deny-by-default backstop, matching every other table in this
-- project (see README's Architecture section) — api/admin.js's
-- service-role key is the real access-control boundary, this policy is
-- the safety net if the anon key were ever queried directly.
alter table audit_log enable row level security;

-- APPLIED to the live FORA Supabase project (wzyvbtzxxdcxgvbkcqmt) via
-- mcp__Supabase__apply_migration, migration name "audit_log", on 2026-09-25.
