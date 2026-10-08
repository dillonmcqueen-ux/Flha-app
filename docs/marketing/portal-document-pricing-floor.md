# Portal Document Pricing: Floor Draft

**Status:** v1, rate and structure confirmed by Dillon 2026-10-08. The 20 documents are made-up references, not real customer forms. Purpose: a floor so a real document can be scored against it and priced. Wired into `server-lib/portalScopePricing.js` (`quotePortalBuild`) and the `ted` and `portal-pricing-scoper` agents.

Applies to documents that are NOT in FORA's official library (the Big 5 and other shipped forms) and get built into a company's Documentation Portal.

## What the engine does today (so prices match reality)

Source: `server-lib/portalFieldTypes.js`.

- 8 field types: yes/no + note, short text, number, date, dropdown, multi-select, signature, file upload.
- Escalation (route a flagged answer to a department) works on yes/no, dropdown and multi-select only.
- No conditional logic, no repeating rows or tables, no calculated fields, no multi-stage (open then close) flow.

That gives the main pricing rule:

- **Fits the engine as-is:** the work is typing questions in, setting options and escalations, matching the paper layout, and testing. Cheap, priced by question count.
- **Needs something the engine lacks:** real development. Priced like a Custom Build (see `custom-builds-pricing-guide.md`), and the new capability can be reused on later documents.

## Rate basis

- **Floor rate: $150 per billable hour** (confirmed by Dillon).
- Cross-check: the Custom Builds guide works out to roughly $180 to $225 per hour effective. $150 sits under that on purpose, as the minimum before discounting is even discussed.
- Price = estimated hours x $150, rounded to the nearest $50, never below $150 (matches Tier 0 Custom Form). This is exactly what `documentPriceFor()` does, and the Est. hrs column below was set so every price follows from it.

## Complexity tiers

| Tier | Fits engine? | Typical size | Hours | Price |
|---|---|---|---|---|
| **A: Simple** | Yes | Up to 20 questions, 1 signature at most | ~1 | $150 |
| **B: Standard** | Yes | 21 to 40 questions, signatures, dropdowns, 1 to 3 escalations, optional photos | ~2 to 2.25 | $300 to $350 |
| **C: Long form** | Yes | 41 to 80 questions, many sections, several escalations, photos, multiple signatures | ~3.25 to 3.75 | $500 to $600 |
| **D: Engine work** | No | Repeating rows, calculations, two-stage open/close, roster or equipment pickers | ~5 to 11 | $750 to $1,600 |
| **E: Workflow** | No | Assign, due date, track, close-out across documents | Custom Builds Tier 2 or 3 | $1,400 and up, scoped by call |

## 20 reference documents

| # | Document | Questions | Features | Tier | Est. hrs | Price |
|---|---|---|---|---|---|---|
| 1 | Visitor / contractor sign-in | 8 | Text, date, 1 signature | A | 0.75 | $150 |
| 2 | Housekeeping walkthrough | 15 | Yes/no with notes | A | 1 | $150 |
| 3 | Fitness-for-duty declaration | 10 | Yes/no, 1 signature | A | 1 | $150 |
| 4 | Fire extinguisher monthly check | 14 | Yes/no, dates, 1 escalation | A | 1 | $150 |
| 5 | First aid kit monthly check | 18 | Yes/no, numbers (counts), date | A | 1 | $150 |
| 6 | Vehicle damage / collision report | 30 | Text, dropdowns, photo upload, 1 signature | B | 2 | $300 |
| 7 | Scaffold inspection tag form | 30 | Yes/no, dropdowns, 2 escalations, signature | B | 2 | $300 |
| 8 | New hire orientation acknowledgement | 35 | Yes/no, dates, signature | B | 2 | $300 |
| 9 | Spill / environmental release report | 35 | Dropdowns, photos, regulator-notified fields, 2 escalations | B | 2.25 | $350 |
| 10 | Lockout / tagout permit (single stage) | 28 | Yes/no, 2 signatures, 2 escalations | B | 2.25 | $350 |
| 11 | Hot work permit (single stage) | 32 | Yes/no, 3 signatures, fire watch fields, 3 escalations | B | 2.25 | $350 |
| 12 | Excavation / ground disturbance checklist | 45 | Yes/no, locate numbers, photos, 3 escalations | C | 3.25 | $500 |
| 13 | Crane / rigging pre-use inspection | 60 | Many sections, yes/no, photos, 3 escalations, signature | C | 3.75 | $550 |
| 14 | Fall protection plan | 50 | Multi-select hazards, anchor points, 3 signatures | C | 3.75 | $550 |
| 15 | Safety meeting minutes with attendee list | 25 | Repeating attendee rows picked from roster, signatures | D | 5 | $750 |
| 16 | Confined space entry permit (issue, then close out) | 55 | Two-stage flow, gas readings, 4 signatures, escalations | D | 6.75 | $1,000 |
| 17 | Job hazard analysis (task / hazard / control rows) | 40 | Repeating table rows, risk rating, signatures | D | 8 | $1,200 |
| 18 | Critical lift plan | 45 | Calculations (load vs chart capacity), equipment picker, signatures | D | 10 | $1,500 |
| 19 | Client-branded daily field ticket | 40 | Billable equipment/hours line items, totals, custom PDF layout | D | 10.75 | $1,600 |
| 20 | Corrective action request | 20 | Assign owner, due date, reminders, close-out, links to incident | E | n/a | $1,400 |

## Modifiers (added to the tier price)

| Modifier | Adjustment |
|---|---|
| Match client's exact paper layout in the PDF | +$150 to $300 depending on layout |
| Each escalation route beyond 3 | +$25 each |
| Rush, under 48 hours | +25% |
| Revision rounds beyond the first | $150 per hour |
| Client supplies only a photo or scan of the paper form | +$50 (retyping) |
| Same document type built before for another client | Tier price, but D and E can drop up to 30% since the engine work is done |

## How a quote adds up (examples)

| Job | Documents | Document total |
|---|---|---|
| Small shop | 3 A, 2 B | $450 + $600 = $1,050 |
| Typical 10 documents | 4 A, 4 B, 2 C | $600 + $1,250 + $1,100 = $2,950 |
| Heavy equipment contractor, 10 documents | 2 A, 3 B, 3 C, 2 D | $300 + $950 + $1,600 + $2,200 = $5,050 |

## Setup fee structure (decided: replace the bands)

Dillon confirmed the old document-count bands ($900 / $1,800 / $2,800) are replaced. A Portal setup fee is now:

1. **Onboarding fee: $300 flat.** Roster, equipment, sites, linking. About 2 hours at $150 per hour with all the information in hand, helped by the onboarding form (Dillon's own estimate).
2. **Document build fee:** the sum of per-document prices from the table above, plus modifiers.
3. **Monthly fee:** unchanged ($45 basic, $100 advanced).

The total of 1 and 2 is what goes into `portal_scope_requests.setup_fee_cents`.

## How a document gets scored

1. Compare it to the closest reference document in the table (question count, signatures, photos, escalations).
2. Check whether it needs anything the engine lacks. If yes it is Tier D (estimate hours from the D examples) or Tier E (workflow, never priced here).
3. Estimate build hours. Price = hours x $150, rounded and floored as above, plus any flat add-ons.
4. Anything unpriceable returns no number and a "needs a scoping call" flag.

## Assumptions to revisit with real data

- Onboarding is flat $300 regardless of headcount. A 50 person company with 30 machines likely takes longer than 2 hours. Not yet decided whether it should scale.
- Tier D hours are estimates. Time the first real D build and correct the table.
- The printed Field Scope Sheet still shows the old bands in its pricing reference box and needs regenerating.
- `api/scope-approval.js` builds the invoice description from `doc_band`, which new quotes should fill with a plain label rather than a count band.
