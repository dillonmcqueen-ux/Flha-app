-- Links a Portal scope engagement to the company built for it, and records the
-- monthly subscription started when the setup invoice is paid.
--
-- company_id: set by the Admin Panel's "Set up Portal company" action
-- (api/admin.js create_portal_company). ON DELETE SET NULL so deleting a test
-- company never fails on, or takes down, the scope row that paid for it.
-- stripe_subscription_id: set by api/stripe-webhook.js when the setup invoice
-- is paid and the engagement has a monthly fee.
--
-- Apply to the live database only with Dillon's yes. RLS on this table is
-- already enabled with no policies, so nothing about access changes.

alter table portal_scope_requests
  add column if not exists company_id bigint references companies(id) on delete set null,
  add column if not exists stripe_subscription_id text;

create unique index if not exists portal_scope_requests_company_id_idx
  on portal_scope_requests (company_id) where company_id is not null;

create unique index if not exists portal_scope_requests_stripe_subscription_id_idx
  on portal_scope_requests (stripe_subscription_id) where stripe_subscription_id is not null;
