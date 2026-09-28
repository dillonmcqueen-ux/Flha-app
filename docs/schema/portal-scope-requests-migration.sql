-- Backs the Ted / portal-pricing-scoper / portal-proposal-builder /
-- portal-invoice-handoff scoping pipeline (see CLAUDE.md's "Client scoping
-- pipeline" section). One row per prospective Company Portal engagement,
-- from Dillon's first rough description through payment confirmation.
--
-- Not a company-scoped table (no company_id): these rows exist before a
-- company does. RLS is enabled with no policies, same deny-by-default
-- backstop as every other table — only the service role (api/scope-approval.js,
-- api/stripe-webhook.js, and this session's Supabase MCP access) ever
-- touches it.
--
-- approval_token follows the same convention as onboarding_requests'
-- edit_token/claim_token: looked up directly, not HMAC-verified, unique
-- and indexed. It's a private one-off link shared only with the one client
-- it names, same trust model as those existing tokens.

create table if not exists portal_scope_requests (
  id uuid primary key default gen_random_uuid(),

  client_name text not null,
  contact_name text,
  contact_email text,
  company_summary text, -- Dillon's rough description of what the client wants

  employee_count integer,
  tier text, -- 'basic' | 'advanced', derived from employee_count (server-lib/portalScopePricing.js)
  document_count integer,
  doc_band text, -- '1-5' | '6-10' | '11-15' | '16+'

  setup_fee_cents integer,
  monthly_fee_cents integer,
  timeline_weeks text,
  scope_summary text, -- markdown: what's included, built by portal-proposal-builder

  status text not null default 'draft', -- 'draft' | 'sent' | 'approved' | 'invoiced' | 'paid' | 'cancelled'

  approval_token text,
  stripe_customer_id text,
  stripe_invoice_id text,

  created_at timestamptz not null default now(),
  sent_at timestamptz,
  approved_at timestamptz,
  invoiced_at timestamptz,
  paid_at timestamptz
);

create unique index if not exists portal_scope_requests_approval_token_idx
  on portal_scope_requests (approval_token) where approval_token is not null;

create unique index if not exists portal_scope_requests_stripe_invoice_id_idx
  on portal_scope_requests (stripe_invoice_id) where stripe_invoice_id is not null;

alter table portal_scope_requests enable row level security;
