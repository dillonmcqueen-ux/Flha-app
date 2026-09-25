# FORA Vendor / Sub-Processor Risk Management

**Effective date:** 2026-09-25
**Owner:** Dillon McQueen (founder)
**Review cadence:** At onboarding of any new vendor, and every 6 months thereafter.

This document is FORA's maintained sub-processor list and vendor risk
process, formalizing the vendor table from the 2026-09-25 SOC 2 Security
Posture Report into an ongoing record rather than a one-time snapshot.

## Sub-processor list

| Vendor | Role | Data handled | Relevant control | Compliance status |
|---|---|---|---|---|
| Vercel | Hosting, serverless functions (`api/`) | All application traffic; environment secrets | Preview-deployment SSO protection enabled; HTTPS/TLS enforced platform-wide | Vercel maintains its own SOC 2 report — **not yet on file, needs to be requested** (see below) |
| Supabase | Postgres database, file storage | All customer data: roster, forms, FLHAs, equipment records, uploaded files | RLS deny-by-default on all 43 tables; AES-256 encryption at rest by default | Supabase maintains its own SOC 2 report — **not yet on file, needs to be requested** |
| Stripe | Billing | Payment/subscription data (FORA does not store card numbers) | Webhook signature verification confirmed intact (`Stripe-Signature` checked against `STRIPE_WEBHOOK_SECRET`) | Stripe publishes compliance info publicly, including PCI DSS Level 1 — no request needed |
| Anthropic | AI-assisted document generation | Submitted task descriptions and SOP text, processed to generate hazard/control content | Data sent per-request via API; not used to train models under Anthropic's commercial API terms | Anthropic publishes trust/compliance information; confirm current SOC 2 status if required as evidence |
| Resend | Transactional email | Onboarding and certification-expiry email content (names, emails, company info) | — | Confirm current compliance status if required as evidence |

## Encryption — vendor-inherited control

FORA does not manage its own encryption keys or add field-level
encryption. Encryption is inherited entirely from Supabase (AES-256 at
rest, on by default for every Supabase project) and Vercel (TLS in
transit, enforced platform-wide). This is documented here explicitly, as
a SOC 2 auditor expects an inherited control to be named and backed by
the vendor's own attestation rather than assumed. See "Action items"
below for collecting that attestation.

## Risk assessment approach

For each vendor above:

- **Data exposure**: what customer data does this vendor see or store,
  and could a vendor-side breach expose FORA customer data directly?
  (Supabase and Vercel: yes, directly — they hold or transmit the data
  itself. Stripe: no card data held by FORA or seen in transit through
  FORA's own servers. Anthropic: only the text submitted per-request for
  AI generation, not the full record. Resend: only email
  addresses/names/company info needed to send transactional email.)
- **Criticality**: could losing this vendor take the product down?
  (Vercel and Supabase: yes, both are single points of failure today.
  Stripe: billing only, app remains usable. Anthropic: AI generation
  feature degrades, rest of app unaffected. Resend: email delivery only.)
- New vendors are added to this table at onboarding time, with the same
  three questions answered before integration.

## Action items

- [ ] Request Vercel's current SOC 2 report (via their sales/trust page,
      typically under mutual NDA).
- [ ] Request Supabase's current SOC 2 report (same process).
- [ ] Note Stripe's PCI DSS Level 1 status and SOC 2 report link from
      their public trust page.
- [ ] Confirm Anthropic's and Resend's current compliance documentation
      if a formal SOC 2 evidence package requires it.

## Review log

| Date | Reviewed by | Outcome |
|---|---|---|
| 2026-09-25 | Dillon McQueen | Initial baseline established from the 2026-09-25 SOC 2 Security Posture Report |
