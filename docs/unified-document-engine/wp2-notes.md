# WP2 notes: engine API

Date: 2026-10-09. Code: `api/documents.js`, `server-lib/documentEngine/` (`fieldTypes.js`, `validate.js`, `service.js`). Dormant: nothing in the app calls it yet.

## What WP2 does

| Area | Actions |
|---|---|
| Builder (founder only) | `engine_info`, `list_company_documents`, `create_definition`, `clone_template`, `get_definition`, `save_draft`, `publish`, `set_company_document` |
| Worker and supervisor | `list_worker_documents`, `get_document`, `create_upload_url`, `submit`, `resubmit`, `sign_now`, `list_records`, `get_record`, `review` |

Rules that are enforced and tested:
- Published versions never change. Editing starts a new draft. Publishing retires the old version but keeps it.
- Every read and write is scoped to a company. Another company's ids answer 404, the same as a missing id.
- A body `companyId` is honoured only for a founder session.
- A FORA template is edited only with `scope: "template"` and no company. A missing company is never read as "template".
- Submits are idempotent per author and `clientSubmissionId`, and a failed save leaves no half-saved record.
- Crew signatures take the name from the roster, and the signer must be on this company's active roster.
- Approve, sign now and resubmit use guarded updates, so a double submit changes nothing the second time.
- A supervisor sees records through the existing scope rule (`scopeRecords`), a worker only their own.

## Review results

`tenant-scope-reviewer`: no cross-company read or write. Fixes applied from its findings: upload kind lookup uses an own-property check, duplicate-submit check scoped to the author, double approve and double sign guarded, archived documents refused, defence in depth on the worker list, explicit template scope, and answers that carry ids refused (see below).
`vercel-function-budget-guardian`: no blocking findings. 24 function files now.

## Open items carried to later work packages

| Item | Why it is open | Lands in |
|---|---|---|
| Rules are stored, not executed | Only `reviewer_step` (record starts pending approval) and `signature_step` with signer `worker` (signature required) are read. Routing, notifications, corrective actions, Brain signals do nothing yet | WP3 |
| Crew lead approval rule | A worker who is a crew lead cannot review engine records. The general reviewer rule (not own, crew only, no lead on lead, still pending) is not built | WP3 |
| Id-bearing answers refused | `equipment_picker`, `attachment_picker`, `site_picker`, `person_picker`, `linked_document` and `crew_signatures` cannot be answered. Storing them unchecked would let a later reader follow another company's id | WP7 (validators per picker) |
| Crew signature authenticity | The server proves the crew member exists and is active, and uses their real name. It cannot prove that person signed. A client can attach any signature image to a coworker | Decision needed, see below |
| Assignments | Submit checks only that the document is switched on. `document_assignments` does not know engine documents, so narrowing and `hide_unassigned` do not apply | WP7 |
| Word and Excel attachments | Attachment uploads reuse the `portal-attachments` bucket (png, jpg, jpeg, webp, pdf). Word and Excel need a new private bucket | WP7 |
| Raw storage paths in responses | `get_record` and `get_document` return stored paths, not signed links. Signing must be added from these scoped rows only | WP7 |
| Auditor view and crew list | Engine records are not in `DIRECT_SOURCES`, so auditors and crew leads cannot see them yet | WP7 |

## Decision needed

Crew signatures: to make them unforgeable, each crew member has to sign themselves (a co-sign step on their own device, like a reviewer step), instead of the author attaching their image. That is a bigger flow than FLHA has today. Options: keep parity with FLHA for now (roster validated, name from roster), or build co-signing in WP3.
