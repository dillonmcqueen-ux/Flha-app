# CLAUDE.md

Project-wide instructions for Claude Code sessions working in this repo.

## Agent delegation

This project uses specialized subagents (`.claude/agents/*.md`) for review
passes that are repetitive, checklist-driven, and high-stakes enough to
want a dedicated set of eyes on every relevant change. Before doing this
class of work yourself, delegate to the matching subagent via the Agent
tool rather than reviewing it inline.

| When a change touches... | Delegate to | Why |
|---|---|---|
| `api/*.js` handlers reading or writing a company-scoped table (`roster`, `sops`, `sites`, `equipment`, `custom_fields`, `custom_forms`, `inspection_forms`, `equipment_reports`, `flhas`, `timeclock_reports`, `company_document_settings`) | `tenant-scope-reviewer` | Multi-tenant isolation bugs here mean one company's data becomes readable or writable by another. See `.claude/agents/tenant-scope-reviewer.md` for the exact checklist. |
| `src/generate*PDF.js` (any of the 11 PDF generators) | `pdf-consistency-reviewer` | Each document type hand-copies the same jsPDF-loader/header/footer boilerplate instead of sharing it, so it drifts silently — see `.claude/agents/pdf-consistency-reviewer.md` for known drift (e.g. `generateInspectionPDF.js` missing the footer entirely). |
| A new file under `api/`, `vercel.json`, or `api/cron-equipment-reports.js` | `vercel-function-budget-guardian` | `api/` is already at 12/12 of Vercel's Hobby-plan serverless function cap — any new file breaks deployment. See `.claude/agents/vercel-function-budget-guardian.md` for the existing workarounds (fold into a dispatcher, or use `server-lib/`). |
| `website/pricing.html`, `terms.html`, `index.html`, or `custom-builds.html` when pricing, plans, or Stripe links are involved | `pricing-legal-consistency-reviewer` | This exact drift (displayed price ↔ actual Stripe amount ↔ fee disclosure ↔ Terms language) took 5 separate follow-up PRs to fully resolve once (PRs #2–#6) — see `.claude/agents/pricing-legal-consistency-reviewer.md`. |

### How to delegate

- Run the matching subagent automatically — no need to ask first. It's
  read-only and reports findings; it never blocks or edits anything.
- Treat its findings as high-signal: resolve them before considering the
  change done, the same way you'd treat a failing test.
- If a change doesn't match any row above, just do the work yourself.
  Don't invent a delegation for a task with no matching subagent.
- **Known limitation:** in some session types (confirmed: Claude Code
  Remote / cloud sessions), the Agent tool's subagent roster is fixed at
  session start and does not pick up `.claude/agents/*.md` files — calling
  the Agent tool with one of these names fails with "Agent type not
  found." If that happens, fall back to reading the matching `.md` file
  yourself and manually applying its checklist/instructions in the main
  session, rather than silently skipping the review. This has been
  verified to work as a substitute (see the tenant-scope-reviewer test
  against commit `55e6224`).

### Adding a new subagent

1. Scope it against the actual code in this repo (file names, line
   counts, the real pattern being checked) — not generic advice that
   would apply to any codebase.
2. Write it to `.claude/agents/<name>.md` with `name`, a `description`
   that states its trigger condition (so it can self-document and, where
   appropriate, be invoked proactively), and the narrowest `tools:` list
   it needs — default to read-only (`Read, Grep, Glob`) unless it
   genuinely needs to edit.
3. Add a row to the table above.

## Continuous UI/UX development agents

Separate from the read-only reviewers above, `.claude/agents/` also has
five agents that actively build UI/UX changes (`tools:` includes `Edit`,
`Write`, `Bash`):

| Agent | Scope |
|---|---|
| `design-token-builder` | Consolidates the hand-copied hex colors duplicated across every component's inline `styles` object into a shared token module. |
| `onboarding-automation-builder` | Automates FORA's company onboarding/setup flow (`Onboarding.jsx` → `submit_onboarding_intake` → `approve_onboarding_request`) up to — but not past — the admin's human approval checkpoint on creating a new tenant. |
| `field-usability-builder` | Improves mobile/field usability of worker-facing forms (touch targets, input types, connectivity resilience) — the components actually used on a jobsite. |
| `accessibility-builder` | Color contrast, form labeling, and keyboard navigation across the dark-themed frontend. |
| `ui-backlog-builder` | Reads `TODO.md` and picks the next tractable UI/UX item to build, deferring items the backlog itself says aren't scoped yet. This is the driver for open-ended "keep developing the UI" work. |

**Hard rule for all five: never commit to `main` directly.** Every change
is a branch → commit → push → **draft PR**, same as every other change in
this repo — these touch a live app with paying customers, so a human
reviews before merge. "Continuous development" means continuously
producing reviewable PRs, not continuously deploying unreviewed changes.

`onboarding-automation-builder` in particular should automate everything
up to the admin's approve/reject decision on a new company, not remove
that decision — see the agent file for why that boundary is deliberate,
not a gap to be closed.

## Recurring security audits

Five more agents run a privacy/exposure sweep. The stated bar: **nothing
but the `company-logos` Supabase Storage bucket should ever be public,
anywhere** — no company's data, and nothing in this codebase or any
connected service, should be reachable without authentication.

| Agent | Scope |
|---|---|
| `storage-exposure-auditor` | Confirms only `company-logos` is a public Supabase Storage bucket; everything else must be private. |
| `rls-coverage-auditor` | Confirms RLS is enabled (deny-by-default, no policies) on every table, per README's documented access-control model. |
| `secret-hygiene-scanner` | Scans tracked files for hardcoded credentials and confirms `.gitignore` covers env files. |
| `public-url-discipline-auditor` | Confirms code never builds an unsigned public URL for a private bucket — this exact bug class has recurred twice in this repo's history (commits `9553f19`, `378b826`). |
| `external-surface-auditor` | Checks Vercel preview-deployment protection and Stripe webhook signature verification — exposure that lives in connected services, not source files. |

**Each agent's file states exactly what it may fix itself vs. what needs a
human.** The dividing line is whether the fix can only ever *tighten*
access and is easily reversible (enabling RLS with no policies, flipping
a bucket back to private after confirming no code depends on it being
public, re-enabling Vercel preview protection) vs. anything that's a real
access-control judgment call, touches production availability, or means a
secret needs rotating — those get reported, not silently fixed.

**Runs every 3 days** via a recurring trigger: a fresh session applies all
five checklists (manually, per the Agent-tool limitation noted above),
fixes what's safe to fix, and re-runs the checks once after fixing to
confirm clean before stopping — it doesn't loop indefinitely. Code-level
fixes still go through branch → draft PR, same as everywhere else in this
repo; only live-infrastructure toggles that meet the "only tightens
access, easily reversible" bar happen directly.

**Verified clean as of this writing:** storage buckets (only
`company-logos` public), RLS coverage (all 30 tables correctly enabled
with no policies), no hardcoded secrets in tracked files. **Found and
fixed as of this writing:** Vercel preview-deployment protection was off
on `flha-app`, meaning every PR's preview URL — posted openly in GitHub
comments — was publicly reachable running the live app; enabled
`ssoProtection` on preview deployments only (production left untouched,
since that's the actual customer-facing app).
