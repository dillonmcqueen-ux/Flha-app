# SOC 2 Readiness Gaps — Tracking

**Source:** FORA SOC 2 Security Posture Report, 2026-09-25 (Claude artifact,
owned by Dillon McQueen). This document tracks remediation status for the
10 ranked gaps that report identified; it is the working checklist, the
artifact is the point-in-time report.

| # | Gap | Fix type | Status |
|---|---|---|---|
| 1 | No MFA anywhere, including the master code | Technical | **Done** — TOTP + backup codes added to the admin role and master code login paths (`api/login.js`, `api/admin.js`, `server-lib/totp.js`); enrollment from the Admin Panel's Codes tab |
| 2 | No written information security policy | Policy/documentation | **Done** — `docs/security/information-security-policy.md` |
| 3 | No documented incident response plan | Policy/documentation | **Done** — `docs/security/incident-response-plan.md` |
| 4 | No formal access review process | Policy/documentation | **Done** — `docs/security/access-review-process.md` |
| 5 | No formal vendor risk management process | Policy/documentation | **Done** — `docs/security/vendor-risk-management.md` |
| 6 | Encryption at rest is entirely vendor-inherited, undocumented | Documentation | **Done** — documented in `docs/security/vendor-risk-management.md` ("Encryption — vendor-inherited control"); vendor SOC 2 report requests still outstanding, tracked there |
| 7 | Storage objects not namespaced by company (flat shared buckets) | Technical | **Done** — `createUploadUrl` (`server-lib/uploadUrls.js`) prefixes new paths with `<companyId>/`; no migration needed for existing rows (see `TODO.md`) |
| 8 | 4-digit PIN as the only per-person credential | Technical | **Done** — PINs are 6 digits (1,000,000 combinations, was 10,000) for anything newly set; existing shorter PINs keep working (login compares against the stored hash, not a fixed length) until reset |
| 9 | No formal data retention/deletion policy | Policy/documentation | **Done** — `docs/security/data-retention-policy.md` |
| 10 | No application-level audit log beyond auth events | Technical | **Done** — `audit_log` table + `server-lib/auditLog.js`, instrumented on `api/admin.js`'s config/access mutations (plan tier, master code, MFA, company create/suspend/delete/codes, onboarding approval/deletion); viewable from the Admin Panel's Codes tab |

**Lower-urgency item from the report's "do when there's room" list:** drop
the remaining public INSERT policy on the `company-logos` Supabase Storage
bucket — **Done**, applied directly as a live-infrastructure tightening
toggle per the recurring security-audit rules in `CLAUDE.md` (only
tightens access, easily reversible, nothing depends on it being
writable).

## Status

All 10 gaps from the 2026-09-25 SOC 2 Security Posture Report are closed
as of this writing. Each technical item shipped as its own commit on
`claude/fora-soc2-report-issues-oc54j3` (PR #135): MFA first (the
report's top-priority finding), then storage namespacing, PIN strength,
and the audit log. A fresh SOC 2 report should be generated once this
PR merges to confirm the posture holds against the live deployment.
