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
