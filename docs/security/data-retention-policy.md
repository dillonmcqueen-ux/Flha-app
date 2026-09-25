# FORA Data Retention and Deletion Policy

**Effective date:** 2026-09-25
**Owner:** Dillon McQueen (founder)
**Review cadence:** Annually, and whenever applicable OHS/regulatory retention requirements change.

This policy defines how long FORA retains the safety and operational
records it generates, and how deletion is handled at contract end. FORA
customers operate primarily in jurisdictions with occupational health and
safety recordkeeping expectations (Alberta and other Canadian
provinces); this policy sets a retention baseline and flags where a given
customer's specific regulatory obligations may require a longer period,
which FORA supports but does not independently track per customer.

**Note:** this document sets FORA's default operational policy. It is not
legal advice, and a customer with jurisdiction-specific retention
requirements longer than what's stated here should be told to request an
extended retention arrangement rather than assume the default applies.

## What FORA retains

| Record type | Examples | Default retention |
|---|---|---|
| Safety documentation | FLHAs, toolbox talks, incident/near-miss reports, monthly site inspections, equipment inspections, custom documents | Retained for the life of the customer's active subscription, plus **3 years** after contract termination |
| Equipment records | Equipment reports, maintenance/service records, fuel logs | Same as above — 3 years post-termination |
| Time clock reports | Worker time-clock records | Same as above — 3 years post-termination |
| Roster / personnel data | Worker/supervisor names, PINs (hashed) | Deleted or deactivated when a company removes the person from their roster; fully purged within **90 days** of contract termination |
| Company configuration | SOPs, sites, custom fields/forms, document settings | Retained for the life of the subscription; deleted within 90 days of contract termination |
| Uploaded files | Signatures, incident photos, onboarding uploads, generated PDFs | Same lifecycle as the record they're attached to |
| Authentication/audit logs | Master-code login history | Retained 1 year on a rolling basis |

Where a customer's own applicable OHS regulation requires records be
kept longer than 3 years post-termination (this varies by jurisdiction
and record type), FORA will retain that customer's data for the longer
period on request, made before contract termination.

## Deletion process

On contract termination:

1. The company's login access is disabled immediately.
2. Safety documentation, equipment records, and time-clock reports are
   retained per the table above (not deleted immediately), since these
   are the records most likely to be needed for a post-termination OHS
   inquiry or audit.
3. Roster/personnel data and company configuration not needed for that
   retained record set are purged within 90 days.
4. At the end of the applicable retention period, all remaining company
   data — database rows and Supabase Storage files — is permanently
   deleted, not just archived or soft-deleted.
5. A company can request earlier deletion of non-safety-critical data
   (roster, configuration) at any time; safety documentation subject to
   the retention table above is not deleted early on request, since that
   would undermine the recordkeeping purpose it exists for.

## Backups

Database backups (managed by Supabase) follow Supabase's own backup
retention schedule, which is shorter than FORA's stated record retention
period and is not a substitute for it. Backup copies age out and are
overwritten on Supabase's own cycle; they are not separately tracked or
purged by FORA on a per-company basis.

## Known gap

This policy is new as of its effective date. There is currently no
automated enforcement (a scheduled job that purges data past its
retention window) — deletion at contract end is presently a manual
process. Automating this is tracked as a follow-up item, not yet built.
