# FORA Incident Response Plan

**Effective date:** 2026-09-25
**Owner:** Dillon McQueen (founder)
**Review cadence:** Annually, and after any real incident (as a post-mortem update).

This plan defines what counts as a security incident, who is notified,
and the sequence and timeframe for response. It is written to match
FORA's actual current size (single-founder operation with contracted/AI
tooling assistance) — it will be expanded as the team grows.

## What counts as an incident

Any of the following:

- Suspected or confirmed unauthorized access to customer data (a company
  reading, or able to read, another company's data).
- A leaked or compromised credential: `SUPABASE_SERVICE_ROLE_KEY`,
  `SESSION_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `ANTHROPIC_API_KEY`, the admin master code, or the Vercel/Supabase/
  Stripe account credentials themselves.
- A vulnerability discovered in production (by internal audit, a
  customer report, or a third party) that could expose customer data,
  whether or not it was exploited.
- A Supabase Storage bucket found public that should be private, with
  evidence of unauthorized reads/writes.
- A vendor (Vercel, Supabase, Stripe, Anthropic, Resend) reporting a
  breach that could affect FORA customer data.
- Unusual master-code usage patterns identified from the Admin Panel's
  logged master-code login history.

## Severity levels

| Level | Definition | Example |
|---|---|---|
| **Critical** | Active exploitation, confirmed cross-tenant data exposure, or a leaked credential with production access | Service-role key found in a public repo; live signed-URL oracle being exploited |
| **High** | A real vulnerability confirmed but not known to be actively exploited | A bucket found public with no evidence of unauthorized access yet |
| **Medium** | A control gap found during routine audit, no evidence of exposure | RLS policy misconfiguration caught before any request could exploit it |
| **Low** | Hardening opportunity, no immediate risk | A dependency with a low-severity advisory and no known exploit path |

## Response sequence

1. **Contain.** For a leaked credential: rotate it immediately in Vercel's
   environment variable store and redeploy. For a public bucket or
   storage policy: flip it back to private/deny immediately if that does
   not break a live customer workflow that depends on it. For an
   application-layer vulnerability: ship the narrowest fix that closes
   the hole, even before a full root-cause writeup.
2. **Assess scope.** Determine which companies' data, if any, was
   actually reachable, and over what window. Use Supabase logs
   (`query_logs`) and the master-code usage log where relevant.
3. **Notify affected customers.** For any incident assessed at High or
   Critical severity where customer data was actually exposed (not just
   potentially exposable), notify the affected company's admin contact
   within **72 hours** of confirming the exposure. State what happened,
   what data was involved, what was done to contain it, and what's being
   done to prevent recurrence. For Medium/Low severity with no confirmed
   exposure, no customer notification is required, but the incident is
   still logged internally.
4. **Fix root cause.** Every incident gets a code fix (branch → draft PR,
   same as normal change management) unless the fix is a live
   infrastructure toggle, in which case it happens directly and is noted
   here.
5. **Document.** Record the incident below: date, severity, what
   happened, what was affected, containment/fix, and notification status.
6. **Review.** Add a check to the recurring internal audit (the ~3-day
   security sweep described in `README.md` and
   `docs/security/information-security-policy.md`) if the incident
   reveals a class of bug the sweep doesn't already catch.

## Notification order

Given FORA's current single-founder structure, there is no internal
escalation chain — the founder is both the first responder and the
decision-maker for customer notification. As the team grows, this
section will be updated with a named on-call owner and an internal
escalation order before external notification.

## Incident log

No incidents have been logged under this plan as of its effective date.
(Note: prior vulnerabilities found and fixed by the recurring internal
audit process before this plan existed — the code-enumeration/PIN-race
chain, mass-assignment bug, signed-URL oracle, and public storage-bucket
INSERT policies — were caught pre-exploitation with no evidence of
customer impact, and are documented in the SOC 2 report and
`TODO.md`/agent files rather than retroactively logged here.)

| Date | Severity | Summary | Affected companies | Resolution | Customer notified? |
|---|---|---|---|---|---|
| — | — | — | — | — | — |
