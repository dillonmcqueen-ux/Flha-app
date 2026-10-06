# Portal Field Scope Sheet

Canonical content for `FORA_Portal_Field_Scope_Sheet.pdf` — the one-page,
print-and-fill-out-by-hand sheet Dillon carries into a shop to scope a new
Company Portal engagement on the spot: what they're running on paper today,
which of the fixed 6 departments each document touches, any escalation
needs, and a self-serve pricing reference so he can give a ballpark without
opening a laptop.

This is the field-collection companion to Ted's intake step (see
CLAUDE.md's "Client scoping pipeline" section) — Dillon fills this out
walking the floor, then reads it off to Ted afterward ("Hey Ted, I scoped a
new customer") to run pricing → proposal → invoice.

## Why a physical sheet instead of a phone/laptop form

Portal prospects are shop floors, not offices — Dillon is walking through
with someone showing him binders and clipboards, not sitting at a desk.
Paper survives that environment better than a device: no screen to unlock
mid-conversation, no connectivity dependency, and it reads exactly like the
clipboard he's asking them to replace.

## Sections

1. **Company & contact** — company name, visit date, contact name/phone/
   email, employee count (circled: <10 / 11-50 / 50+, matching
   `server-lib/portalScopePricing.js`'s `tierFor` basic/advanced split).
2. **Document inventory** — 15 numbered rows (matching the setup-fee bands'
   top end before a real scoping call is required), each with a document
   name field and a tick box per department: HR, Payroll, Safety,
   Maintenance, Operations Manager, Admin — the fixed 6-department list
   from the "FORA Company Portal — Build Spec" doc.
3. **Escalation** — two free-form lines for "does anything need to spin off
   a second record when flagged" (the phase-5 concept, noted here as a
   future roadmap item, never promised as delivered — see CLAUDE.md's v1
   cut line).
4. **Quick pricing reference** — the exact numbers from
   `server-lib/portalScopePricing.js`, printed for Dillon's own reference
   only (not meant to be shown to the prospect): setup fee bands ($900 /
   $1,800 / $2,800 for 1-5 / 6-10 / 11-15 documents), an explicit "don't
   quote 16+ on the spot" warning, and the $45/$100 monthly fee split.
   These numbers must stay in sync with `portalScopePricing.js` by hand —
   there's no code path connecting the two, so if the Boardroom-decision
   pricing ever changes, both this doc and the sheet need updating
   together.

## Regenerating the PDF

Rendered via a `reportlab` script, same pattern as the Custom Builds
pricing guide — ask a fresh session (or `prospect-pitch-builder`, since it
already owns the FORA-branded PDF rendering pattern) to "regenerate the
Portal field scope sheet PDF from
`docs/marketing/portal-field-scope-sheet.md`." The PDF isn't checked into
the repo since it's a rendered, printable artifact, not source — regenerate
and reprint after any pricing change.

Print-friendly by design: white background, FORA orange used only for the
header bar and section rules, everything else is black text and gray
gridlines, so it holds up fine on a black-and-white office printer or
photocopier.
