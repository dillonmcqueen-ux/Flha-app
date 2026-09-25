# GFL Custom Build — Digital Documentation Portal → Enablon SEMS

Reference document for a prospective custom build, not a FORA product feature.
Captures the scoping conversation in full so it can be picked up again without
re-deriving context. Nothing here is committed to the client; no contract has
been signed as of this writing.

## Client and background

Client refers to their operation as "GFL." They currently use Enablon
(Wolters Kluwer) as their SEMS (Safety & Environmental Management System).
Believed to be on Enablon's Enterprise tier, but this is unconfirmed.

**Current process (as described by the client):** an employee prints a form
from a Google Doc, fills it out by hand, and either emails it or sends it as
a PDF to the client's safety clerk. The safety clerk manually uploads/enters
it into Enablon. This manual step is the actual pain point driving interest
in a custom build.

**Forms in scope**, all currently stored as Google Docs:
- Monthly inspections
- PPE inspections
- OBAs (Observational Behaviour Analysis — tracks operator safety practices,
  done once per quarter for new hires)
- Contractor orientations
- Incident and near miss reports
- Corrective action sheets

**Form structure:** confirmed mostly checklist-style with a free-text notes
section. This matters because it maps cleanly onto FORA's existing custom
form builder (`custom_forms`/`custom_fields`) rather than needing a new form
engine built from scratch.

**Signatures:** supervisor/witness countersignature is required in addition
to the employee's own signature. This means the portal needs a two-step
approval/routing flow (employee signs → routes to supervisor → supervisor
signs), not a single-submitter flow. FORA already has e-signature capture
built for FLHA submissions, but that flow is single-signer, so the dual-sign
step is new work, not pure reuse.

**Scale:** large — 100+ staff, multi-site.

**Not in scope:** equipment inspections. GFL would not use FORA's equipment
inspection feature, so it's excluded from every option below and from any
tenant setup.

**Document format is non-negotiable:** GFL's EHS managers have to approve
every safety document template before it can be used. That approval is on
the exact paper form as it exists today, not on whatever a generic digital
form would produce. This means the PDF a submission generates has to be
built to look exactly like their existing document, not just capture the
same fields. Dillon can share the client's real documents directly so each
PDF is built to match, field for field and layout for layout, rather than
being redesigned or standardized. As long as the output format matches what
EHS already approved, the actual submission and signature capture can
happen digitally, it lands as a completed submission in the supervisor's
dashboard queue for manual upload to Enablon.

**Enablon access:** unconfirmed as of this writing. Nobody has verified
whether the client's Enablon plan includes API/integration access. Dillon
does not currently have a direct contact on the client's side who manages
their Enablon account; the client would need to make that introduction.
This is the single biggest unknown driving the whole project's risk profile,
and should be resolved before Option 2 (below) is ever priced as a fixed
quote.

## What FORA infrastructure is directly reusable

- Multi-tenant auth/session model and role-based access (worker/supervisor
  pattern already exists). Under Option A this is used directly, GFL becomes
  a tenant. Under Options B/C, a standalone portal would still borrow this
  pattern rather than building auth from scratch, but as a separate
  deployment, not a FORA tenant.
- The custom form builder (`custom_forms`/`custom_fields`) — the right tool
  for these checklist-style forms.
- E-signature capture flow from the FLHA submission pipeline (needs
  extending to support a second signer).
- PDF generation/branding pipeline (`src/generate*PDF.js` pattern) as a
  starting template for producing documents that match what a clerk expects
  to upload, or eventually what an API integration would submit.
- Vercel + Supabase hosting pattern, and the existing subdomain-on-own-domain
  hosting approach FORA already uses, for a GFL portal on its own subdomain.
- The cron-job pattern (`api/cron-equipment-reports.js`) as a template for a
  scheduled batch-push mechanism if Enablon integration turns out to be
  batch-based rather than real-time.

## Three proposed options

### Option A — Onboard GFL as a FORA tenant, custom documents built to match their exact templates

Instead of a standalone build, GFL becomes a FORA customer. Their forms are
built out using FORA's existing custom form builder (`custom_forms`/
`custom_fields`), and each one's generated PDF is built pixel-for-pixel to
match GFL's real, EHS-approved document, since that approval only covers
the document as it already exists. Equipment inspections excluded, since
GFL doesn't use that feature. Employees fill the form and sign digitally, a
supervisor countersigns, and it lands in the supervisor's dashboard as a
completed submission ready for manual upload to Enablon.

- Fastest, cheapest path to get GFL off paper. Almost all of the underlying
  platform (auth, roster, company setup, the form builder, hosting) already
  exists and is already live for other customers, so this is mostly
  configuration and PDF-template matching, not new engineering.
- Changes the business model: this becomes a recurring FORA subscription
  (per-seat/per-company, like every other FORA customer) instead of a
  one-time custom-build project fee. Cheaper for GFL, but revenue shape for
  Dillon shifts from a project payout to SaaS revenue, worth deciding
  deliberately rather than defaulting into it.
- Still does not solve direct Enablon upload. Whether GFL is a FORA tenant
  or a standalone portal, nobody has built an Enablon API push yet; that's
  identical additional work layered on top of either path (see Option C).
- Still needs the dual-signature (employee + supervisor countersign)
  workflow, which FORA doesn't have today either. Same work required
  regardless of which option this rides on.
- GFL logs into the shared FORA app (with their own logo/branding via the
  existing company-branding support) rather than a fully separate portal on
  its own subdomain, which is a tradeoff against the original "hosted on
  your domain like FORA" framing, worth flagging to the client directly.
- Because the PDF must match GFL's existing approved templates exactly,
  this still requires the client's real documents up front, same as Options
  B and C, the pixel-matching requirement doesn't go away just because it's
  built on FORA's platform.
- Rough price: subscription-based (FORA's existing pricing), plus a smaller
  one-time setup/template-matching fee rather than a full project fee.
  Needs its own pricing pass once FORA's standard tenant pricing is applied
  here, not estimated yet.
- Timeline: likely the fastest of the three, since it's template-building on
  top of a live platform rather than building a platform. Rough estimate
  2–4 weeks for form/PDF template matching plus the dual-signature addition,
  pending real documents in hand.

### Option B — Standalone Digital Portal only (no Enablon integration)

Employees log in, pick a form, fill it out, sign it, a supervisor
countersigns, and it lands in a dashboard for the safety clerk to review and
manually upload to Enablon — same manual upload step as today, but starting
from a clean, fully-signed digital submission instead of paper/email. Built
as its own standalone application on its own subdomain, not a FORA tenant.

- Eliminates: printing, handwritten forms, scanning/emailing, lost or
  illegible submissions, chasing missing signatures, and the clerk manually
  re-typing data from a PDF into Enablon.
- Does not eliminate: the clerk's final upload step into Enablon.
- Same pixel-matching requirement as Option A applies here: PDFs must be
  built to match GFL's EHS-approved templates exactly, not a redesigned or
  standardized version.
- Timeline: 6–8 weeks.
- Rough price: $12,000–$18,000.
- Slower and pricier than Option A since it's a new standalone build rather
  than configuration on an existing platform, but gives GFL a fully separate
  product with its own subdomain and no shared-platform dependency.

### Option C — Standalone Digital Portal + direct Enablon integration

Everything in Option B, plus an automatic push into Enablon on submission
(or on a scheduled batch), removing the clerk's manual step entirely.

- Entirely dependent on confirming real API/integration access on the
  client's Enablon plan. Must open with a short, separately-priced discovery
  phase before the full integration price is locked in.
- If the API path turns out not to exist, this option collapses back to
  Option B plus, at most, an auto-formatted "ready to upload" export.
- Discovery phase: 1–2 weeks, ~$1,500–$2,500.
- Timeline if confirmed: 3–4 months total (Option B's build plus 5–9
  additional weeks for API mapping, the push mechanism, and testing against
  a real Enablon environment).
- Rough price if confirmed: $30,000–$48,000 total.
- Field-by-field mapping is expected to be the slow part, since the six form
  types likely mean six different mappings into whatever schema Enablon's
  API expects, not one generic mapping.
- This same integration work could equally be layered onto Option A instead
  of a standalone portal; the Enablon API problem is identical either way.

### Recommendation given to the client (as of the original proposal, before Option A existed)

Start with Option B (the standalone portal, previously "Option 1"). Layer
Option C on afterward as a second phase, once a discovery pass confirms
what's actually possible on their Enablon account. This was framed honestly
against the alternative of buying an off-the-shelf digital-forms tool:
cheaper/lower-risk on paper, but unlikely to solve the Enablon-specific
upload problem at all, since most off-the-shelf tools don't integrate with
Enablon out of the box. **This recommendation predates Option A and should
be revisited**: given GFL doesn't need equipment inspections and every
option requires pixel-matched PDFs regardless of platform, Option A is
worth presenting first now, since it likely gets GFL off paper fastest and
cheapest, with Option C's Enablon integration still available as a later
phase on top of it.

## Security considerations flagged

This portal would hold and transmit a client's own compliance/safety data.
Minimum bar discussed: encrypted Enablon credentials stored server-side only
(never in the client bundle), tenant isolation if this is ever extended past
one client, signed/short-lived tokens for any file handling, full audit
logging of every submission and every upload attempt, and clarity on data
retention if the client's auditors require tamper-evident originals to be
preserved even after a document is pushed into Enablon.

## Discovery questions prepared for the client

Sent as a follow-up after the initial scope conversation, organized by who
on the client's side should answer them:

**Enablon platform and access** — confirm licensed module/tier, whether the
contract includes API access, who their Wolters Kluwer contact or internal
Enablon admin is, what authentication and payload format an API would use,
and where in their Enablon hierarchy these six document types get filed
today.

**The forms themselves** — get the actual Google Docs for all six form
types (not just descriptions), clarify whether GFL wants them tightened
into structured fields or must visually match the originals, confirm OBA
cadence/criteria, confirm whether contractor orientation is once-per-contractor
or once-per-site-visit, and confirm whether incident/near-miss reports need
any real-time urgency handling.

**Signatures and approval routing** — confirm whether supervisors need their
own login to review/sign digitally, whether all six form types require a
second signature or only some, what counts as a valid signature for their
compliance purposes, and what happens if a supervisor isn't available to
sign right away.

**Volume and roles** — approximate submission volume per form type per
month, whether a supervisor tier needs its own portal access, and whether
different sites use different versions of these forms.

**Routing preference** — whether they actually want a choice between
routing to the clerk vs. Enablon directly, or would rather everything pass
through the clerk for a final human check, at least initially.

## Process/roadmap if Option B is greenlit

Full "how a custom build actually runs" writeup, given to the client when
they asked what the end-to-end process looks like:

1. **Contract and deposit.** SOW covering scope (six forms, dual-signature,
   clerk dashboard), explicit out-of-scope items (Enablon auto-upload is
   Option C), price, payment schedule, IP ownership (client owns the
   finished product; FORA/Dillon owns the underlying reusable platform), and
   a change-order clause. Deposit of 30–50% to start, remainder tied to
   milestones/delivery, not a flat 50/50 split.
2. **Requirements sign-off.** The informal discovery above gets turned into
   a short, client-signed requirements document: exact field layout per
   form, signature flow, roles (employee/supervisor/clerk), and a definition
   of done. ~3–5 business days, run in parallel with the contract.
3. **Design/mockup pass.** Quick mockup or working prototype of one form and
   the clerk dashboard, approved by the client before real development
   starts.
4. **Development, in stages, each checked in with the client before moving
   on:**
   - Stage A: the six form templates, no signatures/routing yet.
   - Stage B: dual-signature workflow (employee → supervisor).
   - Stage C: clerk dashboard (queue, filtering, PDF export).
   - Stage D: accounts/permissions for employees, supervisors, and the
     clerk, tied to real staff data.
5. **Internal QA.** Every form tested mobile and desktop, signature flow
   end to end, permission boundaries checked, basic security review given
   this handles compliance data.
6. **User acceptance testing (UAT).** Real staff (including the actual
   safety clerk) test on a staging environment, 1–2 week window, bug list
   worked through before sign-off.
7. **Pilot rollout.** One site or crew first, 1–2 weeks, to catch real-world
   issues before full rollout.
8. **Training and handoff materials.** Separate short walkthroughs for
   employees, supervisors, and the clerk, plus written quick-reference docs.
9. **Full rollout.** All sites, all staff onboarded — this is the go-live
   milestone, typically tied to final payment.
10. **Post-launch support window.** ~30 days of free bug fixes for genuine
    defects (not new feature requests); ongoing support after that is a
    separate retainer/hourly arrangement.
11. **Final delivery and documentation.** Credentials handed over, a short
    doc on what was built and how to request future changes, clear
    ownership boundaries.

Recommended addition: a contractual mid-project checkpoint (around the
Stage B/C boundary) where the client explicitly confirms the build still
matches what was discussed, specifically because the dual-signature
requirement is more complex than a typical single-submitter form and is the
most likely place for scope drift to appear once real development starts.

## Open items / not yet resolved

- Enablon API/integration access on the client's actual plan — unconfirmed.
- No direct contact yet with whoever manages the client's Enablon account.
- Actual form documents (the real Google Docs/originals) not yet in hand —
  needed for pixel-matching under any option, not just descriptions.
- Client's decision between Option A, B, and C not yet made.
- Option A's actual pricing not yet worked out — needs FORA's standard
  tenant/subscription pricing applied plus a one-time setup fee estimate.
- Budget range not yet given by the client.
- Firm deadline/trigger for this project not yet given by the client.
- Whether GFL would accept being on a shared multi-tenant platform (Option
  A) versus wanting a fully separate, dedicated portal (Options B/C) has not
  been asked directly.

## Deliverables produced so far

- `FORA_Digital_Portal_Proposal.pdf` — client-facing proposal (generated as
  a one-off deliverable, not committed to this repo, per the same pattern as
  other prospect/sales deliverables in `.claude/agents/prospect-pitch-builder.md`).
  Sent under FORA Field Solutions branding, contact: forafieldsolutions@gmail.com.
  Client company name was left as a placeholder for Dillon to fill in before
  sending.
