# FORA Access Review Process

**Effective date:** 2026-09-25
**Owner:** Dillon McQueen (founder)
**Review cadence:** Every 90 days, and immediately after any personnel change.

This document tracks who currently holds access to FORA's production
infrastructure and credentials, and sets the process for reviewing that
access on a recurring basis. This is the evidence a SOC 2 auditor expects
for personnel access control — separate from the technical tenant-isolation
controls documented elsewhere.

## Current access holders (as of 2026-09-25)

| System | Access level | Holder | Notes |
|---|---|---|---|
| Vercel org/project (`flha-app`) | Owner | Dillon McQueen | Controls all environment variables, deployment settings, domain config |
| Supabase project | Owner | Dillon McQueen | Controls `SUPABASE_SERVICE_ROLE_KEY`, database, storage buckets, RLS policies |
| Stripe account | Owner | Dillon McQueen | Billing, webhook config, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` |
| Anthropic API console | Owner | Dillon McQueen | `ANTHROPIC_API_KEY` |
| Resend account | Owner | Dillon McQueen | `RESEND_API_KEY`, transactional email |
| GitHub repository (`dillonmcqueen-ux/flha-app`) | Owner/Admin | Dillon McQueen | Source control, branch protection, secrets |
| In-app admin master code | Holder | Dillon McQueen | Logs into any company; every use logged in Admin Panel |

FORA is currently a single-founder operation. There are no other
individuals, contractors, or automated service accounts holding
standing access to production credentials or infrastructure at this
time. AI coding assistants (Claude Code sessions) operate within scoped,
ephemeral containers per session, authenticated via the founder's own
GitHub App installation and environment secrets — they do not hold
independent, persistent credentials of their own.

## Review process

Every 90 days (or sooner, on any personnel or vendor change):

1. Re-confirm the table above is still accurate — no access should exist
   that isn't listed here.
2. Check each system's own access-log/member list (Vercel team members,
   Supabase project members, GitHub collaborators, Stripe team) against
   this table to catch anything granted outside this process.
3. Rotate `SESSION_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` if there is
   any reason to suspect exposure (see
   `docs/security/incident-response-plan.md`); otherwise these are
   long-lived by design and not rotated on a fixed schedule.
4. Record the review date and outcome in the log below.

## Onboarding / offboarding

When FORA adds a second person with any production access:

- Grant only the narrowest access that role needs (e.g., a support role
  should get Admin Panel access, not the Supabase service-role key).
- Record the grant in the table above at the time it's made, not at the
  next scheduled review.
- On offboarding, revoke access the same day, across every system listed
  above, and rotate any shared secret (master code, `SESSION_SECRET`)
  that person could have viewed or logged.

## Review log

| Date | Reviewed by | Outcome |
|---|---|---|
| 2026-09-25 | Dillon McQueen | Initial baseline established (this document) |
