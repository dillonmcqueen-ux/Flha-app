# SOC 2 Readiness Gaps — Tracking

**Source:** FORA SOC 2 Security Posture Report, 2026-09-25 (Claude artifact,
owned by Dillon McQueen). This document tracks remediation status for the
10 ranked gaps that report identified; it is the working checklist, the
artifact is the point-in-time report.

| # | Gap | Fix type | Status |
|---|---|---|---|
| 1 | No MFA anywhere, including the master code | Technical | **Open** — design proposal in progress |
| 2 | No written information security policy | Policy/documentation | **Done** — `docs/security/information-security-policy.md` |
| 3 | No documented incident response plan | Policy/documentation | **Done** — `docs/security/incident-response-plan.md` |
| 4 | No formal access review process | Policy/documentation | **Done** — `docs/security/access-review-process.md` |
| 5 | No formal vendor risk management process | Policy/documentation | **Done** — `docs/security/vendor-risk-management.md` |
| 6 | Encryption at rest is entirely vendor-inherited, undocumented | Documentation | **Done** — documented in `docs/security/vendor-risk-management.md` ("Encryption — vendor-inherited control"); vendor SOC 2 report requests still outstanding, tracked there |
| 7 | Storage objects not namespaced by company (flat shared buckets) | Technical | **Open** |
| 8 | 4-digit PIN as the only per-person credential | Technical | **Open** |
| 9 | No formal data retention/deletion policy | Policy/documentation | **Done** — `docs/security/data-retention-policy.md` |
| 10 | No application-level audit log beyond auth events | Technical | **Open** |

**Lower-urgency item from the report's "do when there's room" list:** drop
the remaining public INSERT policy on the `company-logos` Supabase Storage
bucket — **Done**, applied directly as a live-infrastructure tightening
toggle per the recurring security-audit rules in `CLAUDE.md` (only
tightens access, easily reversible, nothing depends on it being
writable).

## Next up

Items 1 (MFA), 7 (storage namespacing), 8 (PIN strength), and 10 (audit
log) are real engineering changes, sequenced one at a time as separate
branches/PRs rather than bundled together, per Dillon's direction. MFA is
first: a design proposal (method, scope, UX) is being written up before
any code is changed, since it touches the login path for every
admin/master-code use.
