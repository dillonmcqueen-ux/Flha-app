# Portal Discovery Sheet

Canonical content for `FORA_Portal_Discovery_Sheet.pdf` — the meeting-safe
companion to `FORA_Portal_Field_Scope_Sheet.pdf`
(`docs/marketing/portal-field-scope-sheet.md`). Same document inventory and
department tick-box capture, but designed to sit on a clipboard across the
table from the client during a discovery conversation, not walked in
after the fact.

## Why a separate version

The field scope sheet's pricing reference box is deliberately for Dillon's
own use, but "for Dillon's own use" isn't the same as "safe for a client
to glance at upside-down mid-meeting." This version drops pricing
entirely and is designed to read well if that happens: black and white
throughout except the FORA logo itself (`website/images/fora-logo.png`,
embedded in full color), confident headline treatment ("Discovery Sheet"),
and a "what happens next" section written as client-facing value copy
(searchable records, automatic routing, a proposal built around what they
just described) rather than internal notes.

## Sections

1. **Who we talked to** — company, date, contact name/role/phone/email.
   No employee-count circle here (that's pricing-adjacent and belongs on
   the field sheet, not this one).
2. **What's running on paper right now** — same 15-row document inventory
   and 6-department tick-box grid as the field scope sheet
   (`portal-field-scope-sheet.md` section 2), so the two feed identically
   into Ted's intake step regardless of which one Dillon filled out.
3. **Anything that should flag elsewhere?** — same escalation capture as
   the field sheet.
4. **What happens next** — three bullets of plain value copy, no pricing,
   no internal process detail. This is the section doing the "look
   exciting if glanced at" work.
5. **Footer** — the brand tagline ("NO SUITS. NO BS. JUST RESULTS.",
   `brand.md`) in black, centered.

## What's deliberately NOT on this version

No pricing reference box, no dollar figures, no internal-only notes of any
kind. If Dillon needs the pricing cheat sheet in the room, that's what
`FORA_Portal_Field_Scope_Sheet.pdf` is for — the two are meant to be
choosable per situation, not merged into one document with something
hidden or covered up.

## Feeding into Ted

Same as the field scope sheet: Dillon reads a filled-out copy off to `ted`
afterward. Ted's intake step (`.claude/agents/ted.md`) already accepts
either sheet as given input — it doesn't need to know which one Dillon
used.

## Regenerating the PDF

Same `reportlab` pattern as the field scope sheet and the Custom Builds
pricing guide — ask a fresh session to "regenerate the Portal discovery
sheet PDF from `docs/marketing/portal-discovery-sheet.md`." Not committed
to the repo (rendered print artifact, not source). Uses
`website/images/fora-logo.png` as the only color element on the page —
if that asset moves or is replaced, the render script needs updating to
match.
