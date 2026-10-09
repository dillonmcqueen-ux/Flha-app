# Unified Document Engine: Spec (DRAFT for Dillon's review)

Status: draft, no code written. Nothing here is approved until Dillon says so.
Date: 2026-10-08. Audit basis: repo HEAD `cec56d5`, three read-only audits (document systems, gating and onboarding, special modules and PDFs). Items marked "not verified" were not confirmed in code.

## 1. Goal

One document engine. FORA's built-in documents become pre-made templates inside it. Company Portal documents are the same thing, built per company. A company can be all FORA, all Portal, or any mix, controlled by a per-document on/off toggle.

The founder builds each company's exact documents from the Admin Panel, with attachments, signatures, routing and notifications, and previews the form, the PDF and the routing for the selected company before publishing.

## 2. Decisions locked (from Dillon, 2026-10-08 and 2026-10-09)

| Topic | Decision |
|---|---|
| Structure | One document engine, built-ins become seeded templates |
| Builder users | Founder only (stays behind ADMIN_CODE) |
| Phase 1 features | Attachments and photos, signatures, routing and approvals, notifications |
| Preview | Form, PDF, and routing view for the selected company |
| PDF fidelity | Match the company's paper layout. AI reads their form and lays it out |
| Migration | No live clients, so replace the old code outright |
| Gating | Per-document toggle per company |
| Onboarding | One setup flow for all paths |
| Signatures | Worker signs on submit, multiple named signers, signer logs in later |
| Notification channels | Email, in-app inbox and badge |
| Routing | Fixed reviewer chain, route by answer, route by department or site, reject and send back |
| Attachments | Photos on any field, documents (PDF, Word, Excel), required or optional per field, reference files shown to the worker |
| Special modules | Equipment inspection, fuel log and corrective actions move into the engine |
| Time clock | Stays a standalone module for now (2026-10-09) |
| Roster | Stays the people directory the engine reads from (2026-10-09) |
| Layout editor | Full drag and drop editor (2026-10-09) |
| First document | FLHA, as the end to end proof on ABC Earthworks (2026-10-09) |
| Versioning | New version on every edit, old records keep their old layout |
| Brain and Analytics | Per-document opt-in |
| Process | Full spec before any code |

## 3. What exists today

Four overlapping systems, not three.

| System | Definition | Field types | Notes |
|---|---|---|---|
| Built-ins (FLHA, toolbox, near miss, incident, daily, inspection, fuel log, certifications, time clock) | Code (JSX + a PDF generator each) | Fixed per form | Deepest behavior: sign-afterwards, FLHA approval, corrective actions, equipment readings, crew-lead entry |
| Monthly Inspection | Admin-built question list (`inspection_forms`) | Yes/No only | A built-in with a builder |
| Custom Forms (`api/customforms.js`) | Admin-built | Yes/No plus note only | Only one fully inside gating and notifications |
| Company Portal (`api/portal.js`) | Admin-built, AI-assisted | 8 types | Per-question files and signatures, escalations, scheduled reports. Outside module gating and outside the shared notification system |

Also separate: `custom_fields` (extra text/dropdown fields an admin adds to a built-in document by type, `api/companydata.js:2290`).

Key facts from the audits:
- Portal has the best base engine (8 field types, files, signatures, escalation, AI drafting). It lacks gating, versioning, shared notifications, sign-later, approvals and every FORA entity link.
- The 13 built-in document keys are hardcoded in about 25 server and client places (full list in section 11).
- Portal has no module key. Its tab rides `companies.roster_enabled`, which only the onboarding-approval path ever sets.
- Final signatures on Custom Forms and Portal go into the PDF only. They are not stored as data.
- Two assignment systems overlap for Portal (`portal_assignment_rules` and shared `document_assignments`).
- 14 PDF render paths exist. Five documents are drivable by one generic layout, two are complex (FLHA, equipment inspection), four are not documents (analytics x2, roster PIN sheet, Brain snapshot).

## 4. Target architecture

### 4.1 Core tables (proposed, names not final)

| Table | Purpose |
|---|---|
| `document_definitions` | One row per document per company (or a global template). Key, title, icon, category, origin (`template` or `custom`), template_id it was cloned from |
| `document_versions` | Immutable snapshot of fields, layout, rules. A publish creates a new version. Records point to a version |
| `document_fields` | Fields in a version: type, label, options, required, attachment rules, escalation, entity binding, item_key |
| `document_layouts` | Per-version layout JSON for the PDF (sections, columns, tables, header block, background) |
| `document_rules` | Routing, approval chain, notification, side-effect rules per version |
| `company_documents` | Per-company toggle: which definitions are on, who they are assigned to. Replaces `company_document_settings` document keys and Portal's `is_active` |
| `document_records` | One submission: version, company, site, author, status, client_submission_id, pdf_url |
| `document_answers` | Per field answer, with question text snapshotted so a version change never orphans an answer |
| `document_signatures` | Stored signature per signer step: signer, role, image path, signed_at. Fixes today's PDF-only signatures |
| `document_attachments` | File metadata per record or per field |

Tenant scope: every table carries `company_id` (or reaches it through the definition) and every handler goes through the existing session and `requireDocKey` pattern. `tenant-scope-reviewer` runs on every handler change.

### 4.2 Field type catalog

Existing Portal types kept: yesno, short_text, number, date, dropdown, multiselect, signature, file_upload.

New types needed to absorb the built-ins (from the module audit):

| Type | Needed for | Behavior |
|---|---|---|
| condition3 | Equipment inspection | Good / Monitor / Defective / N/A, mandatory note when flagged, stable `item_key` |
| equipment_picker | Inspection, fuel, daily | Fleet list, free text, rental auto-add. Stores `equipment_id` plus label snapshot. `equipment_id` is null for free text on purpose |
| attachment_picker | Inspection | Multi-pick of tow-capable attachments, each appends its own checklist |
| reading | Inspection, fuel | Hours or KM value plus unit, previous-reading prefill, feeds the PM clock |
| site_picker | Most documents | Stores `site_id`, vetted server-side |
| person_picker | Certifications, on-behalf-of | Stores `roster_id`. Workers locked to self |
| quantity_unit | Fuel | Quantity, unit, cost |
| expiry_date | Certifications | Date plus valid / expiring soon / expired status |
| section_table | Paper forms, checklists | Repeating rows and grouped checklists |
| linked_document | Post-trip to pre-trip | Parent pointer, carried-forward items with fixed / still open / worse |
| template_checklist | Inspection | Checklist chosen by equipment type (about 24 templates today) |

### 4.3 Behaviors (rules, not code per document)

| Behavior | Today | In the engine |
|---|---|---|
| Signatures | Final canvas sig; sign-afterwards only on 4 built-ins | Per-document signer steps: worker on submit, named signers, later signer from their dashboard. Stored in `document_signatures`. Unsigned sweep (24h alert, 10 day close) generalized |
| Approval chain | FLHA extreme-risk approval; incident/near miss "mark reviewed" | Ordered reviewer steps, reject and send back to the worker |
| Route by answer | Portal escalations; FLHA extreme risk | Rule: field equals X routes to department or role |
| Route by department or site | Portal departments; supervisor scope tags | Rule: roster department or site assignment resolves the reviewer |
| Notifications | `notifyAudience` for 7 built-ins plus custom forms; Portal sends its own emails | One notification service for every document. Email plus in-app inbox and badge. Same Owner switch and digest |
| Corrective actions | Created in handler code from failed answers | Rule: "answer equals X opens an action". Matching resolve rule from a later document. `source_type` allow-list becomes data driven |
| Readings and PM | Inspection and fuel readings feed `maintenance.js` | `reading` field type feeds the same `readings.js` |
| Brain signals | 8 hardcoded source types | Per-document opt-in toggle, one generic emitter |
| Offline | Queue plus autosave on most documents | Engine-level, keyed by `client_submission_id` |

### 4.4 Gating

`company_documents` is the single source of truth. A document is on for a company or it is not. `pricing.js` MODULES maps to bundles of templates for billing, but access checks read `company_documents`, not a hardcoded key list. Portal stops depending on `roster_enabled`.

## 5. Admin builder and preview

Location: Admin Panel, one "Documents" area replacing today's separate Document Builder, Custom Form builder and Monthly Inspection builder.

Flow for a selected company:
1. List of the company's documents with on/off toggle, origin (template or custom), version, and last edited.
2. Add: clone a FORA template, or start from their paper form (upload, AI drafts fields and layout), or blank.
3. Edit: fields, attachments, signature steps, routing, notifications, Brain opt-in, assignments.
4. Preview panel with three views: worker form at phone width, PDF with the company's logo and layout, routing view (who receives it, who signs, which notifications fire, in order).
5. Publish creates a new immutable version. Old records keep rendering with their own version.

Built entirely behind the existing admin session. No customer-facing builder.

## 6. PDF and layout engine

- One layout renderer driven by `document_layouts` JSON, replacing the per-document generators for form-style documents.
- Layout supports header block, sections, columns, tables, repeating rows, images (photos and signatures embedded, not just "Attached"), per-document accent color, optional uploaded form as background.
- AI step: upload the company's paper form, AI proposes fields and layout, founder adjusts in the builder. Extends `ai_draft_document` (today it returns a flat question list and no layout).
- Editor: a full drag and drop layout editor (decided 2026-10-09). The founder places and resizes header blocks, sections, columns, tables, repeating rows, signature blocks and attachment slots on a page canvas, with the AI proposal as the starting point. The editor reads and writes the same `document_layouts` JSON the renderer consumes, so preview and PDF can never disagree. The worker form is a separate responsive rendering of the same fields.
- Editor scope for the FLHA proof: it must at least place the specialised FLHA blocks (hazard table, PPE list, crew signature grid, approval stamps) and the standard blocks. Features beyond that (background image overlay, snap guides, undo history) are staged after FLHA works.
- Stay separate: Safety Analytics PDF, Equipment Analytics PDF, Roster PIN sheet, Brain snapshot, server-rendered weekly equipment report (`server-lib/reportPdfs.js`).
- FLHA and equipment inspection need specialised block types (hazard table, approval stamps, carried-forward lists). FLHA is the first document (decided 2026-10-09), so its blocks are built in phase 1. Equipment inspection blocks come later.

## 7. Unified setup flow

One wizard for every company, regardless of origin: company, plan and modules, documents (toggle templates, build custom), users and roster, go live.

| Today | In the engine |
|---|---|
| Stripe checkout then onboarding intake then auto or manual approval | Feeds the wizard. Module choice seeds `company_documents` |
| Ted Portal scope (creates no company, no documents) | Payment confirmation creates the company shell and opens the wizard at the documents step |
| Manual `create_company` (creates a bare company, all 13 keys on, no plan, no roster, no Owner, no `roster_enabled`) | Replaced by the wizard |

Preserved: every auto-approve check in `server-lib/onboardingApproval.js` (CLAUDE.md hard rule). Ted's rule stays: nothing is sent to a client automatically and no automation past payment confirmation unless Dillon decides otherwise.

## 8. Migration approach

No live clients, so no data migration risk. Plan: replace outright, staged and verified on ABC Earthworks (company code `abcworker`, the only company allowed for test data).

Order (revised 2026-10-09: FLHA first as the proof):
1. Foundations: versioning, `company_documents`, notification service, signature storage, layout renderer, drag and drop editor core.
2. FLHA end to end on ABC Earthworks: seeded template, hazard table block, PPE list, crew signatures, extreme-risk approval chain, sign-afterwards, SOP alerts, offline queue, PDF matching today's output. Old `App.jsx` FLHA and `generatePDF.js` stay until the new one is verified, then are deleted.
3. Custom Forms and Monthly Inspection (yes/no, already admin-built).
4. Portal documents (already generic).
5. Near miss, incident, toolbox, daily.
6. Certifications (needs `person_picker`, `expiry_date`). Pending confirmation, see section 12.
7. Fuel log (needs `equipment_picker`, `reading`, `quantity_unit`).
8. Equipment inspection and corrective actions (linked documents, condition3, rules).
9. Delete old code path by path, only after each is verified.

Time clock is not in this list. It stays a standalone module and keeps its own tables, handlers and PDF.

## 9. Required reviews during build

| Agent | Trigger |
|---|---|
| `tenant-scope-reviewer` | Any `api/*.js` handler touching company-scoped tables |
| `pdf-consistency-reviewer` | Any `src/generate*PDF.js` change or removal |
| `interaction-map-keeper` | New tables and join columns (`equipment_id`, `site_id`, `roster_id`, `reading_unit`, `source_type`, `document_key`) |
| `vercel-function-budget-guardian` | Any new file under `api/` |
| `rls-coverage-auditor` | Every new table must have RLS on, no policies |
| `admin-access-copy-guard` | Any wording change to `website/*.html` (pricing and product copy will need updates) |

## 10. Risks and pushback

- Size. This replaces the core of the product: about 25 hardcoded locations, 13 PDF generators, 9 handlers with `requireDocKey`. Staged delivery is the only safe way.
- Equipment and corrective actions are the highest risk. They feed PM status, fuel burn rate, weekly reports, Brain and analytics. A missing link fails silently. The interaction map must be checked after each step.
- Time clock stays standalone (confirmed 2026-10-09). The engine still reads from its data where needed, but it owns none of it.
- The roster stays the people directory the engine reads from: reviewers, departments, signers, `roster_id` (confirmed 2026-10-09). Whether certifications become an engine document type is still open, see section 12.
- FLHA first is the hardest possible proof. It has the largest bespoke PDF (491 lines), a hazard table, SOP lookups, crew signatures, an extreme-risk approval state, sign-afterwards and amend flow. The upside is that if the engine can express FLHA, the simpler documents follow. The cost is that phase 1 is larger and slower before anything else migrates. Accepted by Dillon.
- A full drag and drop editor is a large build on its own (canvas, resize, snap, block palette, undo). It is on the critical path for the FLHA proof only for the blocks FLHA uses. Everything else in the editor is staged after.
- Matching exact paper layouts is the largest single feature. AI layout extraction will be imperfect and needs the founder to adjust. Budget for iteration.
- Versioning plus "old records keep their layout" means the PDF renderer must stay backward compatible with old layout JSON forever.

## 11. Bugs and drift found during the audit

Not part of this spec, but real:

1. `corrective_actions.equipment_id` references `equipment(id)` with no ON DELETE clause, and `delete_equipment` (`api/companydata.js:1993`) never touches those rows. Deleting a machine with a corrective action should hit an FK error. Not tested live.
2. `ai_draft_document` labels `.webp` uploads as `image/jpeg` (`api/portal.js`, media type mapping). HEIC is not accepted, and phone photos of paper forms are often HEIC.
3. Portal `publish_document` deletes and reinserts all questions (`api/portal.js:423`). How old answers resolve their question text afterward was not verified.
4. Reading lookups in `fuellogs.js` and `logs.js` `check_equipment` match by `equipment_label`, not `equipment_id`. A renamed machine splits its history.
5. Three separate expiry classifiers (`certifications.js`, `server-lib/compliance.js`, `src/certificationStatus.js`).
6. A paid onboarding request with null `modules` gets every document on, flagged only by `console.warn` (`onboardingApproval.js:265`).
7. Browser and server disagree on defaults: `get_worker_documents` treats a missing row as off, the Dashboard and WorkerMenu treat it as on.
8. The Ted invoice description still says "(N documents, band)", the deprecated pricing wording (`api/scope-approval.js:126`).
9. Nothing visibly tests `ENFORCED_BUILTIN_KEYS`, `DOCUMENT_LABELS`, `BUILTIN_DOCUMENT_LABELS` or `bySourceType` against `MODULES`.
10. Base `CREATE TABLE` for `inspections`, `fuel_logs`, `equipment`, `roster`, `corrective_actions` is not in the repo.

Hardcoded document lists that become data driven: `server-lib/pricing.js` MODULES and ALL_DOC_KEYS, `api/customforms.js` BUILTIN_DOC_KEYS and BUILTIN_LABELS, `assignmentAdmin.js`, `documentAccess.js`, `documentSources.js`, `notifyRouting.js`, `platformOverview.js`, `api/logs.js`, `api/reports.js`, `correctiveActionScope.js`, `companydata.js` (worker profile and Brain `bySourceType`), `companyBrainSummary.js`, `audit.js`, `WorkerMenu.jsx` (BUILTIN_TYPES, CATEGORIES, render chain), `Dashboard.jsx` (TAB_ICON, TAB_LABEL, TAB_VISIBLE, CATEGORIES, EQUIPMENT_SUBTABS), and `website/pricing.html`.

## 12. Open questions (need Dillon's answer, no guessing)

Answered 2026-10-09: 1 (time clock stays standalone), 2 (roster stays the directory), 5 (full drag and drop editor), 22 (FLHA first), 23 (commit to a branch, done). Still open: all others, plus the new question A below.

A. Certifications: should they become an engine document type (per-person upload with expiry), or stay in their own module like time clock? You confirmed the roster stays the directory but did not say either way on certifications.

Scope
1. Time clock: stays a standalone module?
2. Roster: confirm it stays the people directory, with certifications as the engine document type.
3. Daily reports reference equipment (`equipment_ids`). Keep as a multi-equipment picker?
4. FLHA is the most regulated document. Do any customers need it frozen to its current format regardless of layout editing?

Builder and layout
5. How much of the layout editor do you want by hand versus AI only? A visual drag editor is a large build. AI plus a field-by-field adjust panel is much smaller.
6. When a paper form has a background logo and boxes, is a clean re-drawn version acceptable, or must it match visually box for box?
7. Should the form shown to workers also follow the paper layout, or only the PDF?
8. Should templates (the FORA built-ins) be editable per company, or locked and cloned to customize?

Signatures and routing
9. Reviewer signatures: do they appear in the PDF as additional signature blocks with date and name?
10. Can a signer be someone outside the company (client rep, inspector) with a link and no login? Not selected in phase 1. Confirm it is out.
11. Reject and send back: does the worker edit the same record, or file a new linked one?
12. Routing chain edge cases: what happens if a reviewer in the chain is inactive or on leave? Skip, escalate, or block?

Notifications
13. In-app inbox: reuse the Dashboard Inbox, or a new one? Do workers get an inbox, or supervisors only?
14. Should the Owner's notification on/off switch still apply per document, or move into the builder?

Attachments
15. Max file size and allowed file types for Word and Excel. Embed images in the PDF, link the rest?
16. Reference files shown to the worker: one set per document, or per field?

Gating and billing
17. Do per-document toggles change what the customer is billed, or is billing still by module bundle?
18. How is a mixed company billed (FORA modules plus Portal monthly fee)? `PORTAL_MONTHLY_FEE` is not in MODULES today.
19. Should Portal fees and per-document build prices still come from `server-lib/portalScopePricing.js`?

Analytics and Brain
20. Per-document opt-in: what is the default for a new custom document, on or off?
21. Analytics for custom documents: automatic counts only, or the builder defines which fields chart?

Process
22. Which document do you want working end to end first for the proof on ABC Earthworks?
23. Do you want this spec committed to a branch with a draft PR, or kept local until you approve it?
