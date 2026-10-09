# Unified Document Engine: Phase 1 Build Plan (FLHA first)

Status: plan only. No code written. Spec approved by Dillon on 2026-10-09 (`docs/unified-document-engine-spec.md`). Each work package below needs Dillon's go before it starts.

## Goal of phase 1

FLHA works end to end through the new engine on ABC Earthworks (`abcworker`), with the same behavior as today's FLHA, a box-for-box PDF built in the new drag and drop editor, and the old FLHA code still in place until the new one is verified.

## What "same behavior as today" means (from the FLHA audit)

| Area | Today | Source |
|---|---|---|
| Form | `src/App.jsx` (1684 lines) | worker form, crew, hazards, PPE, notes |
| API | `api/flhas.js` (810 lines) | actions: create_upload_url, resume, submit, my_unsigned, sign_now, list, update, delete, approve, count |
| PDF | `src/generatePDF.js` (491 lines) | header, info box, task summary, SOP alerts, hazard table, PPE, notes, crew signatures, approval stamps |
| AI | `api/generate-flha.js` (387 lines) | AI help for FLHA content |
| Approval | extreme-risk hazard sets `pending_approval`; supervisor or non-author crew lead signs off | `api/flhas.js:210`, `:725` |
| Sign-afterwards | FLHA is in `SIGN_LATER_TABLES` | `server-lib/signLater.js` |
| Notifications | `notifyAudience` | `api/flhas.js:412,525,583` |
| Brain | writes `flha_edit` signals | `api/flhas.js:513` |
| Offline | queue plus autosave | `WorkerMenu.jsx` RESUBMIT_HANDLERS |
| Tests | `tests/flha.spec.js` (e2e) plus unit tests | existing |

Acceptance rule: every row above has a passing equivalent on the engine before the old FLHA is deleted.

## Work packages (in order)

### WP0. Prep and decisions (no code)
- Confirm where DB migrations get applied (see Questions).
- Capture a baseline: run `npm run test:unit` and the FLHA e2e on the current code, record the result.
- Snapshot today's FLHA PDF output for ABC Earthworks as the visual target.
- Read `docs/feature-interaction-map.md` sections for FLHA, notifications, Brain, assignments.

### WP1. Schema (new tables, RLS on, no policies)
New migration file in `docs/schema/`: `document_definitions`, `document_versions`, `document_fields`, `document_layouts`, `document_rules`, `company_documents`, `document_records`, `document_answers`, `document_signatures`, `document_attachments`.
- Every table has RLS enabled with no policies (repo standard).
- Records point at a version. Answers snapshot question text.
- Reviews: `rls-coverage-auditor`, `interaction-map-keeper`.
- Done when: migration applies cleanly on a Supabase branch, tables show RLS on, unit test confirms the migration file lists every table.

### WP2. Engine API
- One new handler, `api/documents.js`, for definitions, versions, records, signatures, attachments. Reuses `requireDocKey` style gating but reads `company_documents`.
- Admin-only actions: create/clone definition, edit draft, publish version, toggle, preview data.
- Worker actions: list assigned, get published version, submit (idempotent on `client_submission_id`), resume, return-to-worker fix, sign later.
- Reviewer actions: approve, reject with reason, escalate.
- Reviews: `tenant-scope-reviewer` (every query company-scoped, `company_id` from session), `vercel-function-budget-guardian` (one new file).
- Done when: unit tests cover tenant isolation, version immutability, idempotent submit, role checks.

### WP3. Rules and services
- Routing: reviewer chain, route by answer, route by department or site, escalate to next role up when a reviewer is inactive.
- Notifications: one service for email plus in-app inbox rows, builder-defined, Owner mute per document, digest compatible with `cron-notification-digest`.
- Sign-later: generalize `signLater.js` and the unsigned sweep to engine records.
- Brain: generic emitter, on by default, opt-out per document.
- Done when: unit tests for each rule type and a notification test through the digest path.

### WP4. Layout renderer and PDF
- Renderer takes a version's `document_layouts` JSON plus a record and produces the PDF with jsPDF via `src/loadJsPDF.js`.
- Block types for FLHA: header block, info box, text, table, hazard table, PPE list, notes, crew signature grid, reviewer approval stamps, image (photo and signature embeds).
- Output must match the snapshot from WP0 within agreed tolerance.
- Reviews: `pdf-consistency-reviewer`.
- Done when: golden file comparison on ABC Earthworks FLHA sample records.

### WP5. Drag and drop editor
- Page canvas, block palette, drag, resize, align, delete, background reference layer (uploaded paper form), save to `document_layouts`.
- Phase 1 scope: only what FLHA needs. Snap guides and undo history are staged after.
- Lives in the Admin Panel under a unified Documents area.
- Done when: Dillon can rebuild the FLHA PDF layout from the template in the editor and the preview matches.

### WP6. Builder UI and previews
- Company picker, document list with toggles, clone template, field editor, signature and routing and notification editors, attachment rules, Brain toggle.
- Three previews: worker form at phone width, PDF, routing view.
- Reviews: accessibility basics, `admin-access-copy-guard` if any `website/*.html` copy changes.
- Done when: a published FLHA version appears in the ABC Earthworks worker menu.

### WP7. Worker form and dashboard wiring
- Engine-driven mobile form renderer (clean mobile layout, field order), offline queue and autosave, reference files, attachments, crew and signatures.
- Supervisor Dashboard: engine documents appear in the tab system, inbox and badge for supervisors, Owner and workers.
- Done when: submit, resume, return, sign later, approve all work from a phone-sized browser.

### WP8. FLHA template and parity tests
- Seed FLHA as a template with all fields, rules and layout.
- Run the full parity table above on ABC Earthworks: submit, extreme-risk approval, sign-afterwards, notifications, Brain signal, offline, PDF match, assignments, list and amend.
- Update or port `tests/flha.spec.js`.
- Done when: every parity row passes and Dillon signs off on the PDF.

### WP9. Cutover (separate approval)
- Remove old FLHA form, `api/flhas.js` paths and `generatePDF.js` only after Dillon approves the parity results.
- Update `docs/feature-interaction-map.md` and CLAUDE.md as needed.

## Branch and PR strategy

One branch per work package, each a draft PR into `main`, never directly to `main`. WP1 and WP2 can land as separate PRs because new tables and an unused handler change nothing for existing users. WP9 is its own PR.

## Risks specific to phase 1

- FLHA is the largest bespoke document, so WP4 and WP5 carry most of the risk.
- Old and new FLHA coexist during build. The worker menu must show only one of them per company, controlled by the `company_documents` toggle on ABC Earthworks only.
- New tables go to the production Supabase project. Only ABC Earthworks data may be written during testing.
- AI box placement from a scanned form is not in phase 1. Phase 1 uses the FLHA template layout and manual editor placement. AI placement is a follow-up work package.

## Questions before WP1 starts

1. Merge PR #205 (spec) into `main` now, or keep it as a draft?
2. Where should migrations be applied? The repo keeps SQL in `docs/schema/`. Do you want me to apply WP1 to a Supabase branch first, or hand you the SQL to run yourself?
3. Should phase 1 include the AI-from-scanned-form step, or stage it after FLHA works?
4. Go on WP0 (baseline, no code changes)?
