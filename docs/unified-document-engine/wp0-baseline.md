# WP0: Baseline and FLHA parity checklist

Date: 2026-10-09. Base: `main` at `fe3272a` (spec and plan merged). No application code changed in WP0.

## Baseline results

| Check | Result |
|---|---|
| `npm run test:unit` | 852 tests, 852 pass, 0 fail |
| `npx playwright test tests/flha.spec.js` | 2 passed |
| FLHA PDF visual target | `baseline/flha-today-1.png` (one page, A4, 70 dpi) |

How the PDF was captured: `baseline/capture-flha-pdf.spec.js.txt` is a throwaway Playwright spec. Copy it to `tests/zz-capture.spec.js`, run `npx playwright test tests/zz-capture.spec.js`, then delete it. It runs the real FLHA form with the shared e2e mocks, answers the signed upload call with a fake token, and saves the PDF bytes from the storage upload. The 2 MB PDF itself is not committed.

Limits of this baseline:
- It uses the e2e mock data (Test Co, Jamie Worker, Test Site), not ABC Earthworks rows.
- It shows the plain submitted state only. It does not show crew signatures, supervisor approval stamps, the awaiting-signature banner or SOP alerts. Those states need their own captures before WP4 starts.
- The existing e2e FLHA coverage is only two tests (happy path, and the "saved without its PDF" warning).

## Today's FLHA, everything it touches

The WP8 parity list in the phase 1 plan was too short. Reading the interaction map and the code shows FLHA has more consumers than the plan listed. Each row below must have an engine equivalent before the old FLHA is deleted.

| Area | Today | Where |
|---|---|---|
| Worker form, AI hazard generation, sign-off | `src/App.jsx`, `api/generate-flha.js` | `App.jsx:46,63,400,866` |
| Actions | create_upload_url, resume, submit, my_unsigned, sign_now, list, update, delete, approve, count | `api/flhas.js` |
| Extreme risk goes to `pending_approval` | submit | `api/flhas.js:210` area |
| Supervisor approve, with PDF regeneration carrying the approval stamp | `approve`, `Dashboard.jsx` FLHACard | `flhas.js` approve, `Dashboard.jsx:2526,2584` |
| Crew lead approve rules: not own FLHA, author on lead's crew, author not another lead, must still be pending and unsigned | `approve` | `flhas.js` lead block, `server-lib/leadAccess.js` |
| Crew lead list is crew-authored only | `list`, `crewIdSet` | `flhas.js`, `leadAccess.js:78-88` |
| Crew screen | `src/CrewScreen.jsx` loads FLHAs, crew documents, lead tasks | `CrewScreen.jsx:54-56,70` |
| Crew signatures (additional crew, client-asserted) | `flhas.crew_signatures` | `flhas.js:148`, `App.jsx` |
| Sign-afterwards: save unsigned, sign later, 24 hour alert, 10 day close | `sign_later`, `my_unsigned`, `sign_now`, `signLater.js`, `unsignedSweep.js`, `SignAfterwards.jsx` | `signLater.js:21`, `flhas.js` |
| Approve blocked while awaiting signature | approve | `flhas.js` approve |
| Amend flow reverts to `pending_approval` | update | `flhas.js:~394` |
| Assignments (submit and view rows) and 48 hour `queuedAt` reach-back | `documentAccess.js`, `DocumentAssignmentsManager.jsx` | `flhas.js:283` |
| Module gate | `requireDocKey('flha')` | `docKeyGate.js` |
| Notifications | `notifyAudience` | `flhas.js:412,525,583` |
| Brain signal `flha_edit` | | `flhas.js:513` |
| Auditor view | `DIRECT_SOURCES` | `documentSources.js`, `api/audit.js:102` |
| Site, worker and company stamping | `submitted_by_roster_id` server-side, site vetting | `flhas.js:428` |
| Offline queue, draft autosave, client submission id | RESUBMIT_HANDLERS | `WorkerMenu.jsx:29-41`, `offlineQueue.js` |
| Upload namespacing and receipts | PDF and signature paths | `uploadUrls.js`, `upload-receipts.test.js` |
| Analytics and platform overview | FLHA counts, unsigned analytics | `analyticsUtils.js`, `platformOverview.js` |
| SOP alerts and SOP reference per hazard | `sops` table lookups | `generatePDF.js`, `App.jsx` |
| Dashboard FLHA tab, list row labels, counters | | `Dashboard.jsx:342,556,4264,5718` |

## Existing unit tests that touch FLHA (must keep passing or be ported)

`flha-status`, `sign-later`, `sign-later-reports`, `sign-later-inspection`, `unsigned-sweep`, `unsigned-analytics`, `document-access`, `assignment-admin`, `lead-role`, `auditor-role`, `notify-settings`, `notify-wiring`, `notify-wiring-forms`, `notify-wiring-logs`, `brain-signal-capture`, `module-gate`, `author-certifications`, `offline-queue-drain`, `upload-receipts`, `upload-namespacing`, `site-activity-keying`, `platform-overview`.

## Findings that change the plan

1. **Crew lead behavior is a hard requirement, not an extra.** The approve rules for leads are security rules (own FLHA refused, crew only, no lead-on-lead, must be pending). The engine's reviewer rule type must express them, or FLHA keeps a special approval step. Decision needed before WP3.
2. **The auditor view and crew list read FLHA through `DIRECT_SOURCES`.** The engine must be added to that source list, or the auditor and crew lead will not see engine FLHAs.
3. **Crew signatures are client-asserted today** (interaction map break noted for toolbox and FLHA secondary signers). The engine stores every signature as data, so this is a chance to validate crew members server-side. Decide whether to tighten it or keep parity.
4. **Cutover needs a data decision.** Existing FLHA rows live in `flhas`. With no live clients, only ABC Earthworks test rows exist, so they can be discarded. Confirm before WP9.
5. **Baseline PDF is incomplete** (see limits above). Add captures for approved, awaiting-signature, crew-signed and SOP-alert states before WP4.

## Open questions from WP0

1. Crew lead approval: express as a general reviewer rule ("author must be on reviewer's crew, not self, not another lead"), or keep a built-in FLHA-only rule?
2. Crew signatures: keep parity (client-asserted) or validate crew members server-side in the engine?
3. May ABC Earthworks FLHA test rows be discarded at cutover?
