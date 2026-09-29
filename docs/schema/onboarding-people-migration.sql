-- Company Portal follow-up, step 2: structured onboarding roster.
--
-- onboarding_requests.people_encrypted holds the roster rows the intake form
-- collects ([{ name, role, email }] as JSON), encrypted with
-- server-lib/fieldCrypto.js (AES-256-GCM, key in FIELD_ENCRYPTION_KEY) so the
-- email addresses are never stored in plain text. users_list stays as the
-- derived "Name - role" text the rest of the pipeline already reads.
--
-- On approval, provisionCompanyFromRequest copies each email onto the new
-- roster row (encrypted again). Nullable: requests from before this change
-- simply have none. RLS is already on for this table (deny-by-default).
alter table onboarding_requests
  add column if not exists people_encrypted text;
