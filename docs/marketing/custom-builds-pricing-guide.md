# Custom Builds Pricing Guide

Internal reference for scoping and quoting Custom Builds — the parts of
FORA built on top of the Big 5, one company at a time. **Not for client
distribution** — this is the source doc `prospect-pitch-builder` (or a
human) renders to `FORA_Custom_Builds_Pricing_Guide.pdf` when a real quote
is needed.

## The pricing philosophy

The whole pitch to prospects is that Custom Builds don't carry a
six-figure custom-software price tag, because they aren't built from
scratch — auth, the database, multi-tenant security, PDF export, and the
dashboard already exist. A Custom Build is the part that's actually new.
That's true, and it's the reason small and mid-size companies can afford
one at all. This guide exists so pricing stays consistent with that
promise instead of drifting toward "normal software consulting" rates as
builds get asked for more often.

Quote a flat number before work starts, always — never hourly. The hours
in the table below are for sanity-checking an estimate, not something a
client ever sees. If a build runs long mid-project, that's a lesson for
the next estimate, not a reason to go back and bill more on this one.

Rule of thumb for the number itself: price to the value of solving the
problem for a small-mid company (usually 10–150 people), not to the raw
hours. A build that takes 3 hours because a similar one's been built
before is still worth more than $150 to the company that's been running
it on a clipboard for a decade — but it should still land well under what
a software agency would quote, or the whole differentiator disappears.

## Tier structure

| Tier | Price | Est. hours | What it covers |
|---|---|---|---|
| **Tier 0 — Custom Form** | $150 flat | ~0.5–1 hr | A single new field-fillable document (like a Big 5 doc) — reuses the form engine entirely. Already published pricing on `pricing.html`. |
| **Tier 1 — Quick Add-on** | $300–$650 | ~1.5–3 hrs | A focused feature bolted onto an existing pattern: a log, a link, a scheduled email, a small checklist variant. |
| **Tier 2 — Small Workflow** | $650–$1,500 | ~3–8 hrs | A multi-step process with its own state: sign-in flows, tracking with alerts, permit-style issue/sign/close. |
| **Tier 3 — Integrated System** | $1,400–$2,200 | ~8–13 hrs | Cross-references other data, has real reporting or rollup logic, feels like a genuine new module. |
| **Tier 4 — Flagship Module** | $3,500–$7,500+ | ~20–40+ hrs | New UI surface, external integration, or admin-facing tooling. Always scope this one in a real conversation, never off a one-line email. |

## When to add a monthly fee

Most Custom Builds are a one-time fee, same as a Custom Form. Only add a
small monthly add-on ($25–$75/mo) when the build carries real ongoing
cost on FORA's end — an external API being paid for, a scheduled job
doing meaningful compute, or a feature that needs occasional upkeep as
the client's data grows. A static tracker or form variant should never
carry a monthly fee just because it's "custom."

## 20 Custom Build examples, priced

Real examples spanning the range — several of these have already been
built for companies without a formal quote. Use this as a starting point
and adjust for actual scope; a company with unusually complex equipment
lists or multiple sites can reasonably land at the top of a tier's range.

| # | Build | Tier | Price | Est. hrs | What it is |
|---|---|---|---|---|---|
| 1 | Preventative Maintenance Tracker | Tier 3 | $1,800 | ~10 hrs | Service intervals by hours or mileage, per machine, with due-soon flags. |
| 2 | Time Clock System | Tier 3 | $2,000 | ~12 hrs | Clock-in/out tied to roster, hours flow into reporting. |
| 3 | Monthly Site Inspection | Tier 1 | $450 | ~2 hrs | Structured recurring checklist, reuses the inspection engine. |
| 4 | Permit-to-Work | Tier 2 | $900 | ~5 hrs | Hot work / confined space / heights — issue-sign-close flow, same pattern as FLHA. |
| 5 | Certification & Ticket Tracking | Tier 2 | $700 | ~4 hrs | Expiry alerts per worker, roster-linked. |
| 6 | Client-Facing Report Link | Tier 1 | $500 | ~3 hrs | Read-only shareable record for a GC or client, no login required. |
| 7 | Custom Analytics Dashboard | Tier 3 | $1,600 | ~9 hrs | Bespoke KPI view — price scales with number of distinct metrics. |
| 8 | Subcontractor / Visitor Sign-In | Tier 2 | $650 | ~4 hrs | Orientation and access log for anyone off the core roster. |
| 9 | Fuel & Consumables Log | Tier 1 | $350 | ~2 hrs | Simple structured log replacing a clipboard or spreadsheet. |
| 10 | Vehicle / Fleet Inspection Log | Tier 2 | $750 | ~4 hrs | Equipment-inspection pattern, fleet-specific fields. |
| 11 | Toolbox Talk Auto-Scheduler | Tier 1 | $500 | ~3 hrs | Rotation and reminders layered on the existing TBT engine. |
| 12 | Incident → Corrective Action Tracker | Tier 3 | $1,400 | ~8 hrs | Assign, due date, close-out — layered on incident reports. |
| 13 | Multi-Site Rollup Dashboard | Tier 3 | $1,800 | ~10 hrs | Compare sites and crews in one view; real aggregation logic. |
| 14 | Custom-Branded Export Package | Tier 1 | $400 | ~2 hrs | Client-specific PDF export template. |
| 15 | Automated Management Digest Email | Tier 1 | $550 | ~3 hrs | Scheduled weekly/monthly summary email job. |
| 16 | Self-Serve Checklist Builder | Tier 4 | $4,500 | ~24 hrs | Admin-facing template editor — a genuinely new UI surface. |
| 17 | Document Expiry Command Center | Tier 3 | $2,200 | ~13 hrs | SOPs, insurance, certifications, and contracts unified with renewal alerts. |
| 18 | Custom New-Hire Onboarding Flow | Tier 2 | $950 | ~5 hrs | Structured orientation with sign-off, tied to the roster. |
| 19 | GPS / Site Check-In Verification | Tier 3 | $1,500 | ~9 hrs | Confirms a submission actually happened on site. |
| 20 | External System Integration | Tier 4 | $5,000+ | 20–40+ hrs | Push data to accounting or a client's own system. Highest variance — always a real scoping call. |

## Notes for quoting

- **Always a fixed number before work starts.** That's the entire pitch
  to prospects — don't undercut it with an hourly estimate in the same
  email.
- **Round to a clean number.** $1,800, not $1,847. It reads as a real
  decision, not a spreadsheet output.
- **Bundle discount for multiple builds at once.** If a company wants 3+
  builds in one onboarding push, price the set ~10–15% below the sum of
  individual quotes — it's genuinely less overhead per build when the
  SOPs and roster are already loaded.
- **Company size shifts the number within a tier, not across tiers.** A
  100-person company and a 12-person company asking for the same
  Preventative Maintenance Tracker land in the same tier — but the
  100-person one can reasonably land at the top of the range.
- **Don't retroactively bill for builds already shipped for free.** If
  something's already live for a customer without a quote, it's a sunk
  cost — use it as a reference build for future pricing, not a bill to
  send.
- **The scariest-sounding requests are often Tier 1 or 2.** "Can you
  build us an app for X" usually means one new workflow layered on
  existing patterns — don't let the client's framing inflate the quote.
- **Tier 4 always gets a real conversation first.** Never quote a
  flagship build or integration off a one-line email. A short call to
  understand the actual system on the other end is worth it.

## Regenerating the PDF

The formatted internal PDF (dark cover, FORA orange/black branding) is
built from this doc's content via a reportlab script. Ask
`prospect-pitch-builder` (or a fresh session) to "regenerate the custom
builds pricing PDF from `docs/marketing/custom-builds-pricing-guide.md`"
whenever this file changes — the PDF isn't checked into the repo since
it's a rendered artifact, not source.
