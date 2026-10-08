# Portal Document Pricing: Floor Draft

**Status:** DRAFT v0. Made-up reference documents, not real customer forms. Purpose: set a floor so a real document can be scored against it and priced. Dillon and Claude refine the table together before anything goes into `server-lib/portalScopePricing.js` or Ted.

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

- **Floor rate: $150 per billable hour** (proposed, pending Dillon).
- Cross-check: the Custom Builds guide works out to roughly $180 to $225 per hour effective. $150 sits under that on purpose, as the minimum before discounting is even discussed.
- Price = estimated hours x $150, rounded to the nearest $50, never below $150 (matches Tier 0 Custom Form).

## Complexity tiers

| Tier | Fits engine? | Typical size | Hours | Price |
|---|---|---|---|---|
| **A: Simple** | Yes | Up to 20 questions, 1 signature at most | ~1 | $150 |
| **B: Standard** | Yes | 21 to 40 questions, signatures, dropdowns, 1 to 3 escalations, optional photos | ~2 to 2.5 | $300 to $350 |
| **C: Long form** | Yes | 41 to 80 questions, many sections, several escalations, photos, multiple signatures | ~3.5 to 4 | $500 to $600 |
| **D: Engine work** | No | Repeating rows, calculations, two-stage open/close, roster or equipment pickers | ~6 to 11 | $900 to $1,600 |
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
| 9 | Spill / environmental release report | 35 | Dropdowns, photos, regulator-notified fields, 2 escalations | B | 2.5 | $350 |
| 10 | Lockout / tagout permit (single stage) | 28 | Yes/no, 2 signatures, 2 escalations | B | 2.5 | $350 |
| 11 | Hot work permit (single stage) | 32 | Yes/no, 3 signatures, fire watch fields, 3 escalations | B | 2.5 | $350 |
| 12 | Excavation / ground disturbance checklist | 45 | Yes/no, locate numbers, photos, 3 escalations | C | 3.5 | $500 |
| 13 | Crane / rigging pre-use inspection | 60 | Many sections, yes/no, photos, 3 escalations, signature | C | 4 | $550 |
| 14 | Fall protection plan | 50 | Multi-select hazards, anchor points, 3 signatures | C | 4 | $550 |
| 15 | Safety meeting minutes with attendee list | 25 | Repeating attendee rows picked from roster, signatures | D | 5 | $750 |
| 16 | Confined space entry permit (issue, then close out) | 55 | Two-stage flow, gas readings, 4 signatures, escalations | D | 7 | $1,000 |
| 17 | Job hazard analysis (task / hazard / control rows) | 40 | Repeating table rows, risk rating, signatures | D | 8 | $1,200 |
| 18 | Critical lift plan | 45 | Calculations (load vs chart capacity), equipment picker, signatures | D | 10 | $1,500 |
| 19 | Client-branded daily field ticket | 40 | Billable equipment/hours line items, totals, custom PDF layout | D | 11 | $1,600 |
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

## Open issue: how this meets the setup fee

`portalScopePricing.js` currently charges one setup fee banded by document count ($900 for 1 to 5, $1,800 for 6 to 10, $2,800 for 11 to 15). Dillon says that fee is meant to cover onboarding work: equipment, rosters, names, and linking things together. It does not mention building the documents.

If so, the two are separate costs and the bands charge for roster/equipment work using a document count. A typical 10-document job at $2,950 in document builds is already above the $1,800 band before any onboarding work.

Proposed structure, pending Dillon:

1. **Onboarding fee:** roster, equipment, sites, linking. Scaled by headcount and equipment count, not document count. Rough basis: about 2 minutes per person, 5 minutes per machine, plus a fixed setup call, around 2 to 4 hours ($300 to $600 at $150 per hour). Unverified, needs real timing.
2. **Document build fee:** sum of per-document prices from the table above.
3. **Monthly fee:** unchanged.

## Not yet decided

- Final hourly rate.
- Whether the bands are replaced or kept as a cap/discount.
- Onboarding fee numbers.
- Wiring into `server-lib/portalScopePricing.js` and the `ted` and `portal-pricing-scoper` agents.
- Whether tier D and E documents are quoted by Claude alone or always flagged for a scoping call.
