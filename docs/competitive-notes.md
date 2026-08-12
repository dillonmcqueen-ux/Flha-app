# Competitive notes: FORA vs. SiteDocs-style safety software

Living reference doc, not a one-time analysis — update this as FORA's feature
set, pricing, and market position change. Pull it up whenever a roadmap or
pricing decision needs grounding in "how does this compare to the
category," rather than re-deriving the comparison from scratch each time.

Last reviewed: 2026-08-12.

**Positioning today**: FORA is not trying to win at the enterprise tier yet.
The advantage right now is being one person who can move fast and tailor the
product tightly for small-to-mid contractors (the existing Basic/Advanced
tiers top out at 50 seats — see `README.md`), not a company trying to out-
enterprise SiteDocs/HammerTech/Cor on feature-parity or sales headcount.
Compete on speed, price, and fit; don't compete on breadth yet.

## The category

SiteDocs and similar tools (HammerTech, Cor, Raken, SafetyCulture/iAuditor)
are digital-forms-and-compliance platforms for construction/field safety:
paperless FLHAs, inspections, incident reports, training records, sold on
per-seat/month contracts, usually gated behind a sales-demo onboarding
motion.

## Pros / cons vs. FORA's current status

Pulled from a review of common SiteDocs-category complaints and praise,
mapped against what's actually built in this repo as of the last review
date above. Re-check the "FORA today" column after any major feature or
pricing change — it will go stale.

### What the category does well (bar FORA needs to clear)

| # | Strength | FORA today |
|---|---|---|
| 1 | Digital forms replace paper — huge time savings, e-signatures | **Have it** — signature capture across every worker form, `src/CustomFormBuilder.jsx` for company-defined forms |
| 2 | Offline-capable mobile app for jobsites with poor signal | **Gap** — no offline handling exists at all right now; see `docs/scope-offline-capability.md` |
| 3 | Centralized document repository (SOPs, certs, training records) | **Have it** — SOP management + 8 document types + custom docs, all company-scoped |
| 4 | Automated cert/license expiry alerts | **Gap** — not built; no expiry-tracking table or cron exists yet |
| 5 | Real-time visibility for admins/supervisors | **Have it** — Supervisor Dashboard reviews every submission type live |
| 6 | Custom, flexible form builder | **Have it** — `src/CustomFormBuilder.jsx` |
| 7 | Audit trail / compliance reporting for regulators | **Have it** — PDF generation per document type (11 generators), full submission history |
| 8 | Photo attachments on inspections/incidents | **Have it** — signed-upload flow in `src/uploadViaSignedUrl.js` |
| 9 | Reduces liability exposure via documented compliance history | **Have it**, same mechanism as #7 |
| 10 | Trend/analytics dashboards | **Have it, tiered** — `src/Analytics.jsx`, Basic vs. Advanced |

### What the category gets complained about (FORA's opening)

| # | Pain point | FORA today |
|---|---|---|
| 1 | Pricing scales badly per-seat, expensive at any real headcount | **Already better** — flat Basic/Advanced tiers, no demo-call sales gate (`website/pricing.html`: "no demo calls, no sales team, just one email") |
| 2 | Steep learning curve for less tech-savvy field workers | Untested at scale — worth field-checking with a real crew, not assumed |
| 3 | Offline sync unreliable, data loss on spotty signal | **Currently worse, not better** — zero offline handling exists; this is the single highest-leverage gap to close (see scope doc) |
| 4 | Dated, clunky UI | Subjective — worth revisiting once `design-token-builder`/`accessibility-builder` agent work matures |
| 5 | Rigid form builders, can't handle conditional logic | Current `CustomFormBuilder.jsx` also has no conditional/branching logic — parity gap, not an advantage, yet |
| 6 | Slow, ticket-based support | **Structural advantage** — one person directly reachable, no support-ticket queue, by construction |
| 7 | Aggressive sales tactics, hard-to-cancel contracts | **Already avoided** — direct email-based onboarding, no sales team to be aggressive |
| 8 | Mobile app performance issues on older field devices | Untested — no dedicated mobile app; FORA is a responsive web app, worth checking on low-end Android in the field |
| 9 | Weak integrations with payroll/HR/ERP | **Parity gap, not an advantage** — FORA has no outbound integrations either (only inbound Stripe billing webhook) |
| 10 | Reporting/export limited without paying more | Partial gap — no dashboard-level PDF export yet (open `TODO.md` item), per-document PDFs are unrestricted by tier |

## Five key differences FORA is betting on

These are the actual points of differentiation to build toward and to keep
messaging around — not a feature checklist, a strategic bet.

1. **AI-generated hazard assessments are the core loop, not a bolt-on
   feature.** A worker describes a task by voice or text and FORA cross-
   references it against the company's own uploaded SOPs to generate
   hazards, controls, and required PPE (`README.md`, `api/generate-flha.js`).
   SiteDocs-category tools are static digital paper — you still write the
   hazard analysis yourself, just on a screen instead of a clipboard. FORA
   changes what the worker actually has to do.

2. **No sales funnel between "interested" and "using it."** One email,
   Stripe Payment Link, live in the app — no demo call, no seat-count
   negotiation, no contract to get out of (`website/pricing.html`,
   `README.md`'s Stripe billing section). This isn't just a pricing choice,
   it's the whole go-to-market: the category's biggest complaints (#6 and #7
   above) are structurally impossible when there's no sales org to generate
   them.

3. **Solo-operator speed on fixes and fit.** A bug reported today can ship
   today; a feature a specific customer actually needs can get built for
   them instead of queued behind an enterprise roadmap committee. This is
   the actual advantage of being one person right now — it's temporary in
   the sense that it won't scale past a certain customer count, but it's
   real today and worth leaning on while it lasts.

4. **Deliberately scoped for small/mid contractors, not enterprise.** Plan
   tiers cap at 50 seats by design (`README.md`). No module marketplace, no
   enterprise SSO/procurement dance, no features built for a 500-person
   general contractor that a 15-person crew will never touch. Every screen
   stays simple because the target customer stays simple.

5. **Fixing the category's best-known failure modes by design, not by
   retrofit.** Offline reliability (category pain point #3) and cert/expiry
   alerts (category strength #4, currently a FORA gap) are both still
   open — see `docs/scope-offline-capability.md` for the first one — but the
   plan is to build them right the first time, informed by what already
   goes wrong in the incumbents, rather than shipping something and
   patching sync bugs for three years the way the established players have.
   This is a bet on sequencing, not a claim of a finished advantage yet —
   update this doc once offline ships and it becomes real.

## How to keep this useful

- Re-run the "FORA today" columns after any feature ships that closes a gap
  above (offline capability, expiry alerts, conditional form logic, etc.) —
  a stale comparison is worse than no comparison.
- If a genuinely new competitor pain point or strength surfaces (a customer
  complaint about SiteDocs, a review read, a lost-deal reason), add it to
  the tables rather than starting a new doc.
- Revisit the "five differentiators" section if FORA's positioning changes
  (e.g. if/when it does start chasing larger accounts) — bet #4 in
  particular is explicitly a *current* strategic choice, not a permanent
  ceiling.
