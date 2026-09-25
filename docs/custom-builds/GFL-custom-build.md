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

**Enablon access:** unconfirmed as of this writing. Nobody has verified
whether the client's Enablon plan includes API/integration access. Dillon
does not currently have a direct contact on the client's side who manages
their Enablon account; the client would need to make that introduction.
This is the single biggest unknown driving the whole project's risk profile,
and should be resolved before Option 2 (below) is ever priced as a fixed
quote.

## What FORA infrastructure is directly reusable

- Multi-tenant auth/session model and role-based access (worker/supervisor
  pattern already exists, though a portal for GFL would be a separate,
  standalone deployment, not a FORA tenant).
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

## Two proposed options

### Option 1 — Digital Portal only (no Enablon integration)

Employees log in, pick a form, fill it out, sign it, a supervisor
countersigns, and it lands in a dashboard for the safety clerk to review and
manually upload to Enablon — same manual upload step as today, but starting
from a clean, fully-signed digital submission instead of paper/email.

- Eliminates: printing, handwritten forms, scanning/emailing, lost or
  illegible submissions, chasing missing signatures, and the clerk manually
  re-typing data from a PDF into Enablon.
- Does not eliminate: the clerk's final upload step into Enablon.
- Timeline: 6–8 weeks.
- Rough price: $12,000–$18,000.
- Lower risk, faster, and this is the recommended starting point regardless
  of whether Option 2 is ever pursued.

### Option 2 — Digital Portal + direct Enablon integration

Everything in Option 1, plus an automatic push into Enablon on submission
(or on a scheduled batch), removing the clerk's manual step entirely.

- Entirely dependent on confirming real API/integration access on the
  client's Enablon plan. Must open with a short, separately-priced discovery
  phase before the full integration price is locked in.
- If the API path turns out not to exist, this option collapses back to
  Option 1 plus, at most, an auto-formatted "ready to upload" export.
- Discovery phase: 1–2 weeks, ~$1,500–$2,500.
- Timeline if confirmed: 3–4 months total (Option 1's build plus 5–9
  additional weeks for API mapping, the push mechanism, and testing against
  a real Enablon environment).
- Rough price if confirmed: $30,000–$48,000 total.
- Field-by-field mapping is expected to be the slow part, since the six form
  types likely mean six different mappings into whatever schema Enablon's
  API expects, not one generic mapping.

### Recommendation given to the client

Start with Option 1. Layer Option 2 on afterward as a second phase, once a
discovery pass confirms what's actually possible on their Enablon account.
This was framed honestly against the alternative of buying an off-the-shelf
digital-forms tool: cheaper/lower-risk on paper, but unlikely to solve the
Enablon-specific upload problem at all, since most off-the-shelf tools don't
integrate with Enablon out of the box.

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

## Process/roadmap if Option 1 is greenlit

Full "how a custom build actually runs" writeup, given to the client when
they asked what the end-to-end process looks like:

1. **Contract and deposit.** SOW covering scope (six forms, dual-signature,
   clerk dashboard), explicit out-of-scope items (Enablon auto-upload is
   Option 2), price, payment schedule, IP ownership (client owns the
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
- Actual form documents (the real Google Docs) not yet in hand — only
  descriptions so far.
- Client's decision on Option 1 vs. Option 2 not yet made.
- Budget range not yet given by the client.
- Firm deadline/trigger for this project not yet given by the client.

## Deliverables produced so far

- `FORA_Digital_Portal_Proposal.pdf` — client-facing proposal (generated as
  a one-off deliverable, not committed to this repo, per the same pattern as
  other prospect/sales deliverables in `.claude/agents/prospect-pitch-builder.md`).
  Sent under FORA Field Solutions branding, contact: forafieldsolutions@gmail.com.
  Client company name was left as a placeholder for Dillon to fill in before
  sending.
