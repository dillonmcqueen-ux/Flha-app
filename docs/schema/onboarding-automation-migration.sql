-- Schema changes required for the onboarding-automation work in this PR.
--
-- This session has no Supabase credentials / migration tooling available
-- (no MCP DB access, no SUPABASE_* env vars, no supabase/ CLI project in
-- this repo), so these statements were written but NOT applied. A human
-- with project access needs to run this against the Supabase project
-- before deploying the corresponding code (api/login.js's claim_* actions
-- and get_onboarding_intake, and api/admin.js's approve_onboarding_request
-- / list_onboarding_requests / get_claim_link changes all read/write these
-- columns).
--
-- Deliberately scoped to onboarding_requests only — no columns were added
-- to roster, equipment, sops, or companies beyond what's here, to keep
-- this change out of the tenant-scope-reviewer's core company-scoped
-- tables as much as possible. See the PR description for the reasoning.

alter table onboarding_requests
  add column if not exists edit_token text,
  add column if not exists admin_note text,
  add column if not exists claim_token text,
  add column if not exists claim_token_expires_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists equipment_draft jsonb,
  add column if not exists sop_drafts jsonb,
  add column if not exists draft_status text; -- 'pending' | 'ready' | 'failed' | 'none'

-- Both tokens are looked up directly (not HMAC-verified), so they need to
-- be unique and indexed the same way any other "magic link" identifier
-- would be.
create unique index if not exists onboarding_requests_edit_token_idx
  on onboarding_requests (edit_token) where edit_token is not null;
create unique index if not exists onboarding_requests_claim_token_idx
  on onboarding_requests (claim_token) where claim_token is not null;

-- api/admin.js's get_claim_link action looks a request up by the company
-- it created, to resend/refresh a claim link after the fact.
create index if not exists onboarding_requests_created_company_id_idx
  on onboarding_requests (created_company_id) where created_company_id is not null;

-- The 'needs_info' status value (used by update_onboarding_status) is only
-- ever written by application code, not enforced by a check constraint —
-- consistent with how 'new'/'in_progress'/'done' aren't enforced today
-- either. No schema change needed for it beyond the admin_note column
-- above.
