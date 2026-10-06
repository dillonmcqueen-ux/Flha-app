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
throughout except the FORA logo itself (`public/fora-logo-dark.png` — the
near-black-wordmark variant made for light backgrounds, embedded in full
color), confident headline treatment ("Discovery Sheet"), and a "what
happens next" section written as client-facing value copy (searchable
records, automatic routing, a proposal built around what they just
described) rather than internal notes.

**Logo asset note**: `website/images/fora-logo.png` (used on the dark
website) has a *white* wordmark that disappears on a white page, leaving
only the orange mark visible — the first render of this sheet had exactly
that bug. `public/fora-logo-dark.png` is the correct asset for any
light-background use: same orange mark, near-black wordmark instead of
white.

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
`public/fora-logo-dark.png` as the only color element on the page — if
that asset moves or is replaced, the render script needs updating to
match.

## Digital / iPad version

For a meeting where paper isn't practical, the same content exists as a
fillable Google Doc: real tables Dillon can tap into and type on directly,
same fields as the paper version (contact info, the 15-row document/
department table, escalation notes, "what happens next"), minus the
employee-count circle (pricing-adjacent, kept off both discovery variants).

Canonical source: `docs/marketing/portal-discovery-sheet-digital.html`.
Created by uploading that HTML to Google Drive (`create_file` with
`contentMimeType: "text/html"`, which Drive auto-converts to a Doc) — the
current copy lives at
`https://docs.google.com/document/d/1pRWGikP9icZ5Yr5MZHqZOg2N1maXU08QgYV1knW-sGM/edit`,
owned by the FORA Google account.

Two things this HTML version can't do, both from the same root cause (no
Google Docs editor connector was on when it was built, only Drive):
- **The FORA wordmark is styled orange text, not the actual logo image.**
  Drive/Docs can only pull an image from a URL it can fetch — it can't
  take a local file from a chat session. Embedding the real
  `fora-logo-dark.png` would need that asset hosted somewhere Google can
  reach.
- **Regenerating creates a new file with a new link**, rather than
  updating the existing Doc in place. If the Google Docs editor connector
  is enabled in a future session, edits can land in the same file instead
  — see `references/docs.md` in the `google-workspace` skill for the
  correct read-then-guarded-write pattern.
