# FORA Feature Interaction Map

The living record of **what FORA has, and how each piece connects to every
other piece**. Owned by `interaction-map-keeper` (`.claude/agents/`).

This file exists because FORA is no longer a set of forms — it's a set of
products that are supposed to feed each other. Equipment inspections are
supposed to drive hour tracking, preventative maintenance *and* fuel-log
readings. Incidents are supposed to teach the Brain. Findings are supposed
to become corrective actions. When one of those links quietly doesn't
exist, nothing errors — the customer just never gets the thing they're
paying for, and nobody finds out.

**How to use it:** read this before adding a feature, and before assuming
two features already talk. Every claim below is annotated with the file and
line that proves it, so it can be re-verified rather than trusted.

**Weak points W-S1 to W-S12 closed or resolved 2026-10-07 (PR #196, branch `claude/weak-points-ws`, `2f78e24`); W-S9 stays a recorded decision. One defect found in that PR while re-verifying, W-S13 (`src/Dashboard.jsx:5902,6043` referenced an undefined `rec`), is FIXED on main (re-read 2026-10-08: those badges use `f.` and `insp.`). Break #49 RESOLVED by Dillon's decision A (2026-10-07): closed-unsigned records stay read-only, no supervisor acknowledge path, counts exclude them (shipped in #195).**

**#48 closed in PR #200 and #49 resolved, 2026-10-07 (branch `claude/corrective-scope`, `61044ae`): corrective actions now follow the record they were raised on; the machine repeat-offender cards are built from the visible actions only (`0cacb6f`), so there is no open weak point on the corrective-action read side. Dillon's decision the same day: Portal escalations, scheduled Portal digests and `email_portal_record` recipients stay department-routed on purpose (section 5).**

**Unsigned escalation placed 2026-10-07 (branch `claude/unsigned-escalation`, `2a90e83`, PR #195): the "a record nobody signs is never announced" limitation is CLOSED, a 24 hour heads-up and a 10 day close now exist (new subsection at the end of the sign-afterwards section). One new break, #49 (a record closed unsigned can never be reviewed or approved and still counts as outstanding), plus weak points U-1 to U-5. No new cron: the sweep rides `api/cron-notification-digest.js`.**

**Near Miss follow-ups closed 2026-10-07 (`0a1d7db`): NM-1 to NM-7 and W-S3/W-S4 re-verified in code, see the sign-afterwards section; one new weak point NM-8 (the new `awaiting_signature` selects have no missing-column fallback). NM-8 is low risk: the live database was checked on 2026-10-07 and all four tables (`flhas`, `inspections`, `incidents`, `near_misses`) carry the three sign-later columns, so the unguarded selects work; it only matters for an environment without the migration. The "NM-1 to NM-7 open" wording elsewhere is history.**

**Near Miss sign-afterwards placed 2026-10-07 (`baa69e9`): NM-1 to NM-7 in the sign-afterwards section; the FLHA-only wording there is stale (Incident, Inspection and Near Miss write the state too).**

**Update, PR #194 (final): W-N7 and W-N11 are closed: the digest now checks that the document is still offered to the company (a built-in needs an active `company_document_settings` row; a custom form must exist, be active and not be switched off under its own key) and drops the held count otherwise (`notifyDigest.js`, `stillOffered`). W-N10 is handled by wording: the Always-tell help now says named people are emailed only if they are allowed to see the document, which `pickRecipients` enforces at send time.** **Update, same day (PR #193): Fuel Log was removed from the notify list (`DOCUMENT_LABELS`, the migration file and both live CHECK constraints, no rows existed), so the Fuel Log "watch" in P4 and the "Fuel Log has no caller" notes below are closed: nothing offers a Notify switch for it. The digest now names a custom document by its form title (looked up from `custom_forms` scoped to the claimed companies in `notifyDigest.js`), so W-N3 is closed.** **Latest pass, 2026-10-07 on branch `claude/notify-wire-monthly-custom` (`c9d0049`, PR #193): notification routing PR 4 (Monthly Inspection and custom documents wired through `server-lib/notifyAudience.js`); P4 and the §2 notification section updated; W-N2 holds for both new callers; Fuel Log is now the only document in `DOCUMENT_LABELS` with no caller (P4 watch, not a break until the toggle ships); no numbered break opened or closed; see the changelog.**

**Earlier pass, 2026-10-07 on branch `claude/sign-afterwards` (`c74082b`, PR #183): worker signs afterwards (new §2 section before `source_type`), twelve weak points W-S1 to W-S12, no numbered break opened; migration not applied live; see the changelog.**

**Most recent pass, 2026-10-06 on branch `claude/auditor-role` (`6ad7e0a`): the Auditor role (surface #26, new section in section 2 before `source_type`) and the crew lead's review follow-ups (W-L4, W-L5, W-L6 closed); no numbered break opened or closed; see the changelog.**

**Status:** seeded 2026-09-16 against commit `0bd289c`; **latest addition 2026-09-29, `platform_events` telemetry (uncommitted, branch `platform-events-instrumentation`): surface #23, a §2 section, and pending link P1 (no reader yet, by design), see the changelog;** the paragraph after this describes the last full pass. **Also 2026-09-29 on branch `portal-brain-signals` (`23bad5b`): Company Portal now
feeds the Brain.** Flagged answers write a `portal_escalation` signal
(`api/portal.js:608`, metadata only) and per-department assignment completion
and overdue counts are read fresh at summary time
(`server-lib/companyBrainSummary.js:226`). That is 8 `source_type` values;
custom documents stay excluded on purpose. **#4 stays closed; no new break
filed.** **Most recent pass before those
2026-09-29 on branch `portal-parity-analytics` (`23aad0b`), closing out #40**
after the Company Portal parity sweep (branch `fix-portal-p3`, `b97b231`).
**#35, #36 and #33 are CLOSED** (PR #158 for the first two; #33's Unfinished
list was only truly fixed by #37 below). Four breaks filed by the sweep,
numbered **#37-#40**: **#37 (Resume on a Portal draft) and #38 (a submitted
Portal record could not be edited or deleted) are FIXED and merged, PR #159;
#39 (site and company delete ignored Portal) is approved and FIXED, closes
when its PR merges; #40 (Portal missing from Overview Recent Activity, Site
Activity and Analytics) is now fully built: Recent Activity merged in PR #161,
Site Activity and Portal Analytics on `portal-parity-analytics`, closes when
that PR merges.** One residual gap under #40: workforce-category custom
documents appear in no Analytics panel (open, low, see #40). The Overview
"Company Portal" panel (PR #157) is read and mapped. Known and unchanged:
Portal is still not in `server-lib/pricing.js`. (At the parity pass Portal
answers emitted no Brain signals; that changed the same day on
`portal-brain-signals`.) The paragraph that follows
describes the pass before this one: **2026-09-29 on branch
`portal-pdf-email` (`ba5f6ab`)** — Company Portal
"email documents to a department" placed on the map (§2's
`portal_report_schedules` section, breaks #35 and #36, changelog); the
paragraph that follows describes the pass before it. Earlier extension:
**2026-09-29 on branch `company-portal-phase-5-escalation`, PR #150** —
Company Portal phase 5 (question-level escalation), the last of the 5
build-order phases, placed on the map: new columns
`portal_questions.escalation_department`/`.escalation_trigger_value` and a
new `portal_escalations` table
(`docs/schema/company-portal-phase5-migration.sql`, applied live),
`server-lib/portalFieldTypes.js`'s `ESCALATABLE_FIELD_TYPES`/
`fieldTypeCanEscalate` (escalation restricted to `yesno`/`dropdown`/
`multiselect`), `submit_portal`'s new escalation-insert block and two new
supervisor/admin actions (`list_escalations`/`action_escalation`) in
`api/portal.js`, per-question escalation controls in
`src/PortalDocumentBuilder.jsx`, and a new "Escalations" sub-tab in
`src/Dashboard.jsx`'s Portal tab. `escalation_department` is a new
consumer of the same `PORTAL_DEPARTMENTS` list `roster.departments`/
`portal_documents.departments` already validate against, but for a
different semantic (an escalation's target, not a document's own
routing) — confirmed `list_escalations` scopes by
`portal_escalations.target_department`, never the source document's
`departments`. New §2 join-key section; closed out the phase-2/phase-4
"escalation deferred to phase 5" notes in §5. **Break #34 filed:** an
escalation never notifies the department it's routed to — no email, no
push, unlike phase 3's document-submission email — it just sits in
`portal_escalations` until someone opens the new tab. Not fixed, awaiting
a yes. Before that, last extended
**2026-09-29 on branch `fix-break-32-portal-my-documents`, PR #149**
(commit `6b2fc3a`) — **break #32 CLOSED**: `api/customforms.js`'s
`get_my_documents` now also queries `portal_records` (scoped through
`portal_documents.company_id`, matched on `submitted_by`) so a worker's
Portal submissions show up in `src/MyDocuments.jsx`'s "My Forms" Submitted
section as `type: 'portalform'` — no client-side change needed, since that
section's existing `TYPE_META[doc.type] || { label: doc.title, icon:
FileText }` fallback (`MyDocuments.jsx:196`) already renders an
unrecognized type correctly. New §2 join-key row under
`portal_documents.id`. **Break #33 filed, found while building the fix,
not fixed by it:** the *separate* Unfinished-drafts section of the same
screen (`scanDrafts`, `MyDocuments.jsx:41-70`) has no such fallback — its
`TYPE_META[type]` check at `:54` is a strict allowlist that still excludes
`portalform`, so an in-progress (unsubmitted) Portal draft is silently
skipped even though `PortalDocumentForm.jsx` genuinely autosaves one under
the same `fora_draft_` namespace `scanDrafts` reads. See the changelog and
§4's #32/#33 entries. Before that, last extended
**2026-09-29 on branch `company-portal-phase-4-assignment-compliance`** for
Company Portal phase 4 (assignment + compliance) — new tables
`portal_assignment_rules`/`portal_assignments`
(`docs/schema/company-portal-phase4-migration.sql`, applied live),
`server-lib/portalAssignments.js` (materializes a rule against the current
roster and auto-applies rules to new hires), three new admin-only
`api/portal.js` actions (`create_assignment_rule`/`list_assignment_rules`/
`delete_assignment_rule`) and a new supervisor/admin `get_assignment_rollup`
action that computes not_started/submitted/overdue at read time by
cross-referencing `portal_records` rather than storing a status column;
two new call sites in `api/companydata.js`'s `add_roster_member`/
`onboard_new_employee`; a new assignment-rules section in
`src/PortalDocumentBuilder.jsx` and a new "Assignments" sub-tab in
`src/Dashboard.jsx`'s Portal tab. **This closes the sellable-v1 cut line —
phases 1-4 are now complete; phase 5 (escalation) remains completely
unbuilt, confirmed by grep.** New join-key section in §2
(`portal_assignment_rules`/`portal_assignments`); the phase-2/3 deferrals
bullet in §5 updated to mark assignment rules built; a new §5 bullet
records a deliberate spec deviation — the build spec's "role/group/
individual/everyone" targeting was built as `everyone | role | individual`
only, no department-based ("group") targeting, because `roster.departments`
exists only on supervisor-tier rows and a department-targeted rule could
therefore never reach a worker. No new break filed. Break #32 (Portal
submissions missing from My Forms) is unaffected by this phase — it
doesn't touch `MyDocuments.jsx` or `get_my_documents` — and stays exactly
as recorded at the phase-3 pass; not re-verified as new. See the
changelog. Same-day, before that, extended
**against branch `company-portal-phase-3-routing-notification`** for
Company Portal phase 3 (document-level routing + notification) —
`api/portal.js`'s `list_portal_records`/`get_portal_record_detail` now
filter an individually-identified supervisor by matching their own
`roster.departments` against a document's `portal_documents.departments`;
`submit_portal` now emails every active, on-department supervisor a
best-effort notification via `server-lib/email.js`; a new company-scoped
`list_portal_documents_for_dashboard` action and a new "Portal" tab in
`src/Dashboard.jsx` (Inbox + Document Library) give supervisors the UI
phase 2 shipped with no consumer for. **This is `roster.departments` and
`portal_documents.departments` finally getting their first real reader** —
both join-key sections in §2 updated from "no consumer yet" to consumed,
with file:line evidence. No new break filed; break #32 (Portal submissions
missing from My Forms) is unaffected by this phase and re-confirmed still
open. Recorded as a deliberate role-model resolution, not a gap: the build
spec's "Company Admin" persona was **not** built — Dillon's 2026-09-29
decision was no new role, since a supervisor row with every department
checked already sees everything under this phase's intersection logic. See
the changelog and the new §5 bullet. Same-day, before that, extended
against commit `1654231` for Company Portal phase 2 (Document engine v2) —
`portal_documents`/`portal_questions`/`portal_records`/`portal_answers`
(migration applied live), `server-lib/portalFieldTypes.js`, new file
`api/portal.js`, `src/generatePortalDocumentPDF.js`,
`src/PortalDocumentForm.jsx` and `src/PortalDocumentBuilder.jsx`. Placed as
a new join-key section in §2; **break #32 filed** (a worker's Portal
submissions never show up in My Forms) and the phase-3/4/5 deferrals
recorded as deliberate, not breaks — see the changelog. Same-day, before
that, extended against commit `1eddbb0` for Company Portal phase 1
(Departments) — `roster.departments` (migration applied live),
`server-lib/portalDepartments.js`, `api/companydata.js`'s
`update_worker_profile` validation, and `src/WorkerProfileDrawer.jsx`'s
chip picker. Placed as a new join key in §2 with its own note; producer
side only at the time, no consumer yet, no break filed — see the
changelog. Before that, extended 2026-09-28 against the uncommitted working tree that added the Ted
client-scoping pipeline (`.claude/agents/ted.md` + three specialists,
`portal_scope_requests`, `server-lib/portalScopePricing.js`,
`api/scope-approval.js`, and a `stripe-webhook.js` `invoice.paid` handler)
— placed as sales-ops plumbing outside §1/§3 with its own join-key note in
§2 and a deliberate-non-connection entry in §5; no break filed, no
application code touched. Before that, extended 2026-09-23 against `42ed3c7`, re-anchored the same day against **`e7bd475`**
(`afc4b93` tightened two company scopes; `e7bd475` moved `fleet_activity` in
`api/companydata.js`), on `claude/modular-pricing-enforcement-rzdib2` (six
commits on top of `main` `363da23`): **#13, #17, #18, #24 and #25 are
built, not closed** — each closes when that branch's PR merges. #18 was
**rescoped by Dillon** before it was built (non-trailer attachments get no PM
clock at all, by design — see §5). This pass also opened **#28, #29 and #30**,
three verified residuals of that work (**#28 since approved and built in
`1301c76`**, closes when PR #129 merges; #29 and #30 still open), and marked **#15, #16,
#19–#23, #26 and #27 CLOSED** — their PRs are all merged into `main`
(`d91fcb6`, `18645f0`, `57efbeb`, `d4b8aa3`, `363da23`); the history below
saying "closes when … merges" is the record of the time. Every live
`src/Dashboard.jsx` anchor in §1–§5 was re-read against the 7274-line file at
`42ed3c7`; the changelog and the "as found" tables keep the numbers of the
commit they were written against. Before that, extended
2026-09-22 against the **uncommitted** working tree on `f561f42`
(`claude/modular-pricing-enforcement-rzdib2`, PR #128) — #27's week paging,
which closes the current-week-only residual; the #27/§2/§5 time-clock anchors
below are read against that tree. Before that, against `98f9d70` on the same
branch (break #27 built, UI only; `main` is at `d4b8aa3`, the squash of PR #127, which
carries #23). Before that, against `ac80f96` (break #23 built; #27 opened); before that, against `48d5889` on
`claude/equipment-tab-fleet-mgmt-9g0xra` (breaks #20, #21 and #22 all built, closing when PR #124 merges — **module
gating is now enforced server-side**, both non-checkout provisioning paths
write explicit all-on rows, and the one warning that path can raise now
reaches the founder; Equipment Compliance sold as a module in `2560819`;
built-in document keys flipped to deny-by-default in `edd7a41`;
`roster.employee_id` in `8916156`). **#23** (the time-clock and PM-interval
handlers #21's scope did not reach) is **built, not closed** as of `ac80f96` on
`claude/modular-pricing-enforcement-rzdib2` — six new guards, with `clock_out`,
`my_time_status` and the three time-clock reads left open by Dillon's decision
(§5). Two breaks were then still awaiting a decision (both built 2026-09-23, above): **#24** (`WalletInvite.jsx` still
offers a ticket upload a gated company cannot use) and **#25** (custom
documents ignore their own `custom_<id>` setting server-side). **#27** (those
#23 carve-outs were open on the server and unreachable from the product) is
**built, not closed** as of `98f9d70` — approved by Dillon ("readable in the
app"); the worker's card and the supervisor's tab now reach them read-only,
and (`b0411b1`) the tab pages back through every past week.
**#26** was split out of #23 the same day
and is built, not open: `api/equipmentreports.js`'s own four actions were
ungated until `89ca755`. Every ❌ and ⚠️ in "Known breaks" was read in the
code, not inferred.

**Read §2's `document_key` section before anything else on this page.** As of
`edd7a41` a built-in document type is OFF unless a `company_document_settings`
row says otherwise, so every ✅ in the matrix below that runs through a gated
surface is conditional on that company having an explicit row. That changed the
shape of "is this gated like its neighbours" for all 13 built-in keys at once.
As of `c30d995` every provisioning path **writes** those rows, so the row exists
for a company created by hand and for an approval with no module list, not only
for one that came through a checkout (break #20 — built, closes when PR #124
merges). And as of `48d5889` the rows are **enforced by the server**, not only
read by the browser: 41 handler actions across eight files call
`requireDocKey` (51 as of `ac80f96` — four more in `89ca755`, six in #23's fix) (`server-lib/docKeyGate.js:111`) before doing anything, so a
company that never bought a module can no longer reach it through a saved URL,
a stale tab, or a client whose settings fetch failed (break #21 — built, closes
when PR #124 merges).

---

## 1. Product surfaces

| # | Surface | Entry point | API | Doc key |
|---|---|---|---|---|
| 1 | FLHA | `src/App.jsx` | `api/flhas.js` | `flha` |
| 2 | Equipment Inspection | `src/Inspection.jsx` | `api/logs.js` | `inspection` |
| 3 | Toolbox Talk | `src/ToolboxTalk.jsx` | `api/logs.js` | `toolbox` |
| 4 | Near Miss | `src/NearMiss.jsx` | `api/reports.js` | `nearmiss` |
| 5 | Incident | `src/Incident.jsx` | `api/reports.js` | `incident` |
| 6 | Daily Report | `src/DailyReport.jsx` | `api/logs.js` | `daily` |
| 7 | Monthly Site Inspection | `src/MonthlyInspection.jsx` | `api/monthly.js` | `monthly` |
| 8 | Custom Documents | `src/CustomForm.jsx` | `api/customforms.js` | `custom_<id>` |
| 9 | Preventative Maintenance | `src/Dashboard.jsx` — Equipment ▸ Maintenance | `api/maintenance.js` | `maintenance` |
| 10 | Fuel & Consumables | `src/FuelLog.jsx`; Equipment ▸ Fuel Logs | `api/fuellogs.js` | `fuellog` |
| 11 | Time Clock + GPS | `src/TimeClock.jsx` | `api/companydata.js` | `timeclock` |
| 12 | Weekly Equipment Reports | `src/Dashboard.jsx` | `api/equipmentreports.js` | `equipment_reports` |
| 13 | Weekly Time Clock Reports | `src/Dashboard.jsx` | `api/timeclockreports.js` | `timeclock` |
| 14 | Certifications | `src/WorkerCertifications.jsx` | `api/certifications.js` | `certifications` |
| 15 | Corrective Actions | `src/Dashboard.jsx` — Maintenance tab (equipment) + its own Safety tab (everything else) | `api/monthly.js` | *(none — gated per source, see #10)* |
| 16 | Company Brain | `AdminPanel.jsx` Brain tab | `api/cron-company-brain-summary.js` | *(none — always on)* |
| 17 | Analytics | `src/Analytics.jsx` | `api/companydata.js` | *(none — tier-gated)* |
| 18 | *(removed 2026-09-30, Gatehouse left the product, see §6. Number kept so the other surface numbers still match their references.)* | none | none | none |
| 19 | Fleet Management | Equipment ▸ Fleet Overview (`Dashboard.jsx:5990`) | `api/companydata.js:941` update, `:990` retire/restore; `:857` `fleet_activity` (read-only, #13/#18) | *(none — BASE by decision, see #19)* |
| 20 | Equipment Compliance | Equipment ▸ Compliance (`Dashboard.jsx:6208`) | `api/companydata.js:1063-1241` | `equipment_compliance` — module `compliance` (`pricing.js:98-103`), added `2560819` |
| 21 | Weekly Hours | Equipment ▸ Weekly Hours (`Dashboard.jsx:6147`) | `api/equipmentreports.js` (`foldWeeklyUsage`, `:302`) | `inspection` |
| 22 | Maintenance Records | Equipment ▸ Maintenance Records (`Dashboard.jsx:6089`) | `api/maintenance.js:415` | `maintenance` |
| 23 | Platform events (founder telemetry; **migration written, NOT applied live**, branch `platform-events-instrumentation`) | none yet (Admin Panel, planned phase 3c) | writer `server-lib/platformEvents.js:47` (`recordPlatformEvent`); table `docs/schema/platform-events-migration.sql:19` | *(none, platform-wide, not a company feature)* |
| 24 | Founder Dashboard (Platform tab), slices 3a, 3b and 3c | `src/PlatformDashboard.jsx`, Admin Panel > Platform (`AdminPanel.jsx:32,1408-1409`); 3b adds Revenue, Company health and Seats cards (`PlatformDashboard.jsx:67-113`, mounted `:159`) | `api/admin.js:127-134` → `server-lib/platformOverview.js:221`; 3b is `server-lib/platformBusiness.js` `buildBusinessMetrics`, called at `platformOverview.js:190`; 3c is `server-lib/platformHealth.js` `buildPlatformHealth` (`platformOverview.js:19,194`), fed by the `platform_events` read at `platformOverview.js:258-268`, rendered by `HealthSection` (`PlatformDashboard.jsx:69`). *`loadPlatformOverview` is now at `:234`; the `:221` above and the 3b card anchors were not re-swept after 3c.* | *(none on purpose, admin-only, see §5)* |
| 25 | Set-your-own-PIN link (roster onboarding; branch `claude/step-pin-setup-links`, `624ef31`, **migration `docs/schema/roster-pin-setup-link-migration.sql` written, not verified applied live**) | `src/WalletInvite.jsx` (route `/wallet`, `src/main.jsx:12`), `src/ClaimAccount.jsx`, roster rows in `src/Dashboard.jsx:7903-7909` and `src/AdminPanel.jsx:2366-2370` | producers `server-lib/onboardingApproval.js:140-167` (at company creation), `api/companydata.js:451` (`onboard_new_employee`), `:720` (`send_pin_setup_link`); consumer `api/login.js:795` (`pin_link_open` / `pin_link_set_pin`); lib `server-lib/setupLinks.js` | *(none, roster is platform base)* |
| 26 | Auditor access (outside reader; branch `claude/auditor-role`, `46553fb` + `6ad7e0a`, **migration `docs/schema/auditor-migration.sql` written, NOT applied live**, `?`) | `src/AuditorView.jsx` (routed in `src/Login.jsx:383-388` before the supervisor fall-through); Owner screen `src/AuditorsManager.jsx`, mounted `src/Dashboard.jsx:7883` | `api/audit.js` (`get_audit_scope`, `list_audit_documents`); Owner actions in `api/companydata.js:1473-1590` (`list_auditors`, `create_auditor`, `set_auditor_scope`, `send_auditor_access`, `revoke_auditor_access`); `server-lib/auditorAccess.js`, `server-lib/documentSources.js` | none of its own: reads the six `DIRECT_SOURCES` keys, `monthly` and `custom_<id>` through each key's own gate (`api/audit.js:104,113`; custom forms are not gated, A-W6). Section 2: `roster.role = 'auditor'` + `auditor_scopes` |
| 27 | Unified Document Engine (WP1 to WP7c-1 on main, #215; WP7c-2 assignments, auditor view and id-bearing pickers on `claude/document-engine-wp7c-access` `2da835a` and `42ad499`, not merged; WP3 migration applied live; re-placed 2026-10-09) | Worker menu cards and form (`WorkerMenu.jsx:521,853`, `EngineDocumentForm.jsx`, `PickerControl.jsx`), Dashboard tab `enginedocs` (`Dashboard.jsx:6581`), worker inbox (`WorkerMenu.jsx:297`), outside auditors (`api/audit.js:149-165`, branch only) | `api/documents.js` + `server-lib/documentEngine/` | **No doc key.** Gated by `company_documents.is_enabled` (`service.js:569`), see the engine section in §2. Assignable as `engine_<id>` (`documentAccess.js:61`) |

**The Equipment hub, 2026-09-17, corrected 2026-09-18.** Maintenance and Fuel
Logs stopped being top-level tabs and became sub-tabs of Equipment, and the hub
itself went from module-gated to always-visible: `TAB_VISIBLE.equipment` was
`equipmentReportsEnabled` (`git show c68f57d:src/Dashboard.jsx`, line 2505) and
is now `true` (`src/Dashboard.jsx:2826`). Per-sub-tab gating moved to
`EQUIPMENT_SUBTABS` (`src/Dashboard.jsx:2863-2872`), where each entry carries
its own `on:`. **One of the eight is now `on: true`** — Fleet Overview
(`:2864`), BASE by decision. Compliance was the other, which was break #19; it
gates on `complianceEnabled` (`:2784` → `:2869`) as of `2560819`.

Which sub-tab is gated on what, verified 2026-09-18 against `2560819`;
re-anchored 2026-09-23 against `42ed3c7` (gates unchanged, lines moved):

| Sub-tab | `on:` | Doc key |
|---|---|---|
| Fleet Overview (`:2864`) | `true` | none — BASE, see #19 |
| Maintenance / Maintenance Records / Corrective Actions (`:2865-2867`) | `maintenanceEnabled` | `maintenance` |
| Weekly Hours (`:2868`) | `inspectionsEnabled` | `inspection` |
| Compliance (`:2869`) | `complianceEnabled` | `equipment_compliance` |
| Fuel Logs (`:2870`) | `fuelEnabled` | `fuellog` |
| Weekly Reports (`:2871`) | `equipmentReportsEnabled` | `equipment_reports` |

One asymmetry, recorded but not filed, re-verified 2026-09-23 against
`42ed3c7`: the Compliance panel's own render condition is
`activeTab === "equipment" && equipmentSubTab === "compliance"`
(`Dashboard.jsx:6208`) with no module flag, while Maintenance Records
(`:6089`), Weekly Hours (`:6147`), Weekly Reports (`:6299`), Corrective
Actions (`:6392`), Maintenance (`:6403`) and Fuel Logs (`:6597`) each repeat
their flag in the render condition too. It is
still unreachable today — `equipmentSubTab` is only ever set from the filtered
tab list (`:5981`), from three `maintenanceEnabled`/`fuelEnabled`-gated
shortcuts (`:5017,5020,5027`), from the overview compliance banner's
"View Compliance" action (`:4931`, added by #126), or bounced to a visible tab
(`:2880`) — so this is defence in depth that Compliance alone doesn't have, not
a live hole.

**The setter that needed checking is the new one.** `:4931` is gated on
`TAB_VISIBLE.equipment`, which is unconditionally `true` (`:2826`). On its own
that would be the first setter able to select Compliance for a company that did
not buy it. It cannot, because the whole banner it lives in sits inside
`complianceEnabled && …` (`:4917`) — the gate is on the banner, fourteen lines
above, rather than on the button itself. If that banner is ever refactored
so the action outlives the guard, this asymmetry stops being theoretical.

Supporting surfaces: Onboarding → Claim (`Onboarding.jsx` → `ClaimAccount.jsx`),
Admin Panel, SOPs, Sites, Equipment fleet, Roster, Custom Fields, Billing
(`api/checkout.js` + `api/stripe-webhook.js`).

**Client scoping pipeline (Ted) — deliberately off this map's surfaces/matrix,
recorded 2026-09-28 against the uncommitted working tree.** `ted` +
`portal-pricing-scoper` / `portal-proposal-builder` / `portal-invoice-handoff`
(`.claude/agents/`) price and invoice a **Company Portal** engagement before
any company account exists — `portal_scope_requests`
(`docs/schema/portal-scope-requests-migration.sql`) has no `company_id` on
purpose, and every row above lives against a company, a doc key, or a
module a company already bought. It doesn't belong in §1's surface table or
§3's matrix for the same reason Billing's Stripe checkout flow isn't in
either: it's plumbing that runs *before* a tenant exists, not a feature a
logged-in company uses. Its one join key (`approval_token`) and its
deliberate non-join to `onboarding_requests`/`companies` are recorded in §2
and §5 instead, so this doesn't get silently re-scoped into "a product
surface with no matrix row" by a later pass.

**Every doc-key column above is now enforced, not just displayed.**
`server-lib/docKeyGate.js` (`48d5889`) is the one gate every handler asks; see
§2's `document_key` section for the 51 guards (as of `ac80f96`), the
deliberate exemptions — including the five time-clock actions left open by
decision in #23 — and the custom-form guard that closed the last ungated surface (#25, built `f955ad9`).

---

## 2. The join keys — the spine of the map

Almost every real or missing connection in FORA comes down to whether two
features agree on a key. These are the keys, and who honours them.

### `equipment_id` → `equipment.id` (the fleet FK)
The single most load-bearing link in the product. Set **only** when a
worker picks a machine from the registered-fleet dropdown; null when they
type a free-text label (`Inspection.jsx:380`, `FuelLog.jsx:158`).

| Feature | Writes `equipment_id`? | Reads it? |
|---|---|---|
| Equipment Inspection | ✅ `Inspection.jsx:45,51` | — |
| Fuel Log | ✅ `FuelLog.jsx:21` | — |
| Preventative Maintenance | ✅ `maintenance.js:321,384` | ✅ `maintenance.js:86,92,180-215` |
| Weekly Equipment Report | — | ✅ *(#7, PR #119)* `equipmentreports.js:190-213,247` |
| Weekly Hours | — | ✅ `equipmentreports.js:300` (`foldWeeklyUsage`) |
| Maintenance Records | — | ✅ `maintenance.js:376-390` |
| Corrective Actions | ✅ *(#11, PR #121)* host machine; ✅ *(#17, built `bb13340`)* an attachment's own id for its own items — `logs.js:512-527` via `groupFindingsByMachine` (`correctiveActions.js:489`) | ✅ `recurrence.js:51`, `correctiveActions.js:328` |
| Equipment Compliance | ✅ `companydata.js:1027` (`upsert_equipment_compliance`) | ✅ `companydata.js:914`, `:960` (`compliance_summary`), `equipmentreports.js:595` — **#14** closed in PR #122; all three now drop retired machines (**#15**, PR #123) |
| Unified Document Engine (WP7c-2 branch, not merged) | ✅ an equipment or attachment picker answer stores the fleet id only after it is looked up in the caller's company, not retired, and (for attachments) flagged `is_attachment` (`idAnswers.js:56-78`); stored in `document_answers.value_json` as `equipment_id` / `equipment_ids` with a database label. A free-text machine stores `equipment_id: null` and the typed text (`:60-63`), on purpose | ❌ **no reader.** `maintenance.js:175-210` and `fuellogs.js` read `inspections` / `fuel_logs`; `grep -rln document_answers api server-lib` lists engine files only. A checked id that moves no PM clock, usage reading or Equipment Analytics |
| Daily Report | ✅ array form `equipment_ids` (`DailyReport.jsx:44,297`) | — |
| Fleet Overview — last on site | — | ✅ *(#13, built `42ed3c7`)* `daily_reports.equipment_ids` → `companydata.js:864` (`fleet_activity`) → `lastOnSiteByEquipment` (`fleetActivity.js:36`) → `Dashboard.jsx:6057-6068` |
| Analytics | — | ⚠️ groups by `equipment_label` (`analyticsUtils.js:68,217`) — except the two attachment cards added by #18, which key on the fleet id (`attachmentStats`, `fleetActivity.js:126`, rendered `Analytics.jsx:362-370`) |

**Consequence:** anything that groups by `equipment_label` silently splits
one machine into several when the label is typed differently, and can't
join to the fleet at all. `maintenance.js:5-7` documents this decision
explicitly and is the correct reference. Analytics is the last consumer
still keyed this way.

**Ownership validation.** Now that this column is read rather than merely
stored, an id arriving from a client is a tenancy question, exactly as
`site_id` is. `server-lib/equipmentScope.js` is the companion to
`server-lib/siteScope.js` and carries the same three-way contract: the
fleet row's own id when it belongs to the caller, `false` (→ 403) when it
belongs to another company, and `null` when it simply doesn't exist —
**never `false` for a missing id**, because both callers are offline-queued.
Same failure mode recorded for `site_id` under break #2's follow-up.

**What a 403 costs there changed on 2026-09-22 (`48d5889`), and the rule did
not.** `drainQueue` (`src/offlineQueue.js:235-272`) used to catch every failure
the same way — `markAttempt`, then `break` — with no attempt cap **and no drop
path**, so a permanent 403 wedged that worker's whole queue for that form type
forever. It now **drops** a permanent 4xx and reports it (`:252-263`,
`isPermanentRejection` at `:194`), so the same 403 would instead delete that
worker's inspection outright rather than stalling the queue behind it. Losing
one signed document is better than losing the queue and still not something a
retired machine should cause, which is why both helpers still return `null`
— the reasoning is now carried in the code
(`server-lib/equipmentScope.js:32-39`, `server-lib/siteScope.js:35-38`).

**There is still no attempt cap, deliberately.** A cap counts attempts, and a
worker offline for a week racks up attempts on submissions that are perfectly
good; only the server saying "never" drops anything
(`src/offlineQueue.js:215-218`).

| Caller | Validates `equipment_id` | Since |
|---|---|---|
| `api/logs.js` inspection submit | ✅ `logs.js:280-283` | PR #119 (`afee546`) — had **no** check before, though `equipment_id` was in `SUBMITTABLE_FIELDS.inspection` all along |
| `api/fuellogs.js` submit | ✅ `fuellogs.js:165-168` | had an inline guard; migrated onto the shared helper in `afee546` |
| `api/equipmentreports.js` report build | ✅ `equipmentreports.js:175-188` (`vetEquipmentIds`), called at `:227-229` | PR #119 (`afee546`) |
| `api/logs.js` daily-report submit (`equipment_ids`) | ✅ `logs.js:399-402` → `resolveEquipmentIds` (`equipmentScope.js:119-152`) | 2026-09-17 fleet branch |
| `api/logs.js` inspection submit — attachment ids from `results_json`, before a corrective action is keyed on them | ✅ `logs.js:513-515` → `resolveEquipmentIds`; an id not in the vetted set is dropped to label-only in `groupFindingsByMachine` (`correctiveActions.js:489-500`), never stored | `bb13340` (#17) |
| `api/companydata.js` compliance upsert | ✅ `companydata.js:1181-1227` (row re-read, `company_id` compared at `:1199`) | 2026-09-17 fleet branch |

`results_json` attachment ids are the ones that can't be guarded on
submit: `results_json` is a free-form jsonb blob and `pickAllowed`
(`logs.js:122`) whitelists the **column**, never its contents. They are
therefore vetted on the read side instead — `vetEquipmentIds`
(`equipmentreports.js:196-215`) drops any id not in the company's fleet before
anything keys on it, falling back to the label the way a free-text machine
already does. It vets **both** shapes; see below.

### `results_json.attachments` → the machines hooked onto a machine
Two spellings are live at once and both are read through one normaliser,
`server-lib/inspectionAttachments.js`:

| Shape | Written by | Meaning |
|---|---|---|
| `attachedTrailer` — `{id,label}` or null | every inspection before 2026-09-17 | one trailer |
| `attachments` — `[{id,label}]` | `src/Inspection.jsx:511` | any number of attachments |

Legacy records are signed safety documents that get re-rendered for years, so
this is not a shape that can be migrated away by rewriting rows — which is why
`inspectionAttachments()` exists rather than a backfill. An empty
`attachments: []` deliberately **wins** over a legacy `attachedTrailer`
(`inspectionAttachments.js:33-38`).

Items carry the routing tag: `unit: 'truck'` for the machine itself,
`unit: 'attachment'` + `attachmentId` on new records
(`src/Inspection.jsx:465-469`), `unit: 'trailer'` with no id on legacy ones.
`attachmentForItem()` matches by id first, label second.

| Consumer | Reads it | Routes defects to the right machine? |
|---|---|---|
| Weekly Equipment Report — defect routing | `equipmentreports.js:519,531` | ✅ pre-trip only |
| Weekly Equipment Report — towed distance | `equipmentreports.js:552-575` | ✅ |
| Weekly Hours | `equipmentreports.js:345` | ✅ |
| Inspection PDF — header | `generateInspectionPDF.js:223` | ✅ |
| Inspection PDF — checklist + deficiency banners | `generateInspectionPDF.js:69,141` | ✅ *(was **#16**, fixed on this branch)* — groups by `unitKey()` (`:16`), which keys on `attachmentId` and falls back to `unitLabel`. Keying on `unit` alone printed an attachment's defect under a "TRUCK / TOW VEHICLE" banner and merged two attachments into one group named after whichever came first |
| Corrective actions | `correctiveActions.js:419,449` (`itemAttachment`, `:471`) → `groupFindingsByMachine` (`:489`) | ✅ *(#17, built `bb13340`)* — opened, resolved and repair-logged per machine (`logs.js:517-527,543-579`); id first (`item.attachmentId`), then `attachmentForItem` |
| Brain signal (`inspectionFindingSignal`) | `logs.js:179-217` — item names only, machine = host `equipment_label` (`:214-215`) | ❌ **#30** — an attachment's defect reaches the Brain under the carrier's name |
| Preventative Maintenance — towed distance | `maintenance.js:163` selects `linked_inspection_id, results_json` → `towedDistanceSince` (`fleetActivity.js:99`) | ✅ *(#18 as rescoped, built `42ed3c7`)* — **trailers only**; a non-trailer attachment has no clock by design (§5). Gaps: **#28** built `1301c76`, closes with PR #129 (a trailer not flagged `is_attachment` is now towed by type, `fleetActivity.js:79-82`), **#29** (towed by a free-text machine) |
| Fleet Overview — last mounted on | `mountedOnByAttachment` (`fleetActivity.js:56`), pre-trips only; ids not in the company's fleet dropped at `companydata.js:877-880` (`afc4b93`) | ✅ *(#18, built `42ed3c7`)* — `Dashboard.jsx:6060-6062` |
| Equipment Analytics — most used attachment | `attachmentStats` (`fleetActivity.js:126`), pre-trips only | ✅ *(#18, built `42ed3c7`)* — `Analytics.jsx:365` |

### `equipment.is_attachment` (is this thing hooked onto something else?)
A fact about the machine, replacing `isTrailerTemplate`'s guess from the
make/model text — which worked for anything with "trailer" in the name and
silently failed for a bucket, a hammer, a mulcher or a plate tamper.

| Consumer | Reads it |
|---|---|
| Inspection — no-readings path, attachment picker | `Inspection.jsx:275,283,291` |
| Daily Report picker label | `DailyReport.jsx:403` |
| Fleet Overview / Admin Panel badges | `Dashboard.jsx:6007,6042,6046`, `AdminPanel.jsx:1962` |
| Preventative Maintenance | ✅ *(#18, built `42ed3c7`)* — `pmAllowedFor` (`fleetActivity.js:88`): an attachment may carry a PM clock only if `isTrailerTemplate` says it is a trailer. Read by `maintenance.js:216-219` (status) and `companydata.js:1273` (refuses an interval), plus `:1277` (a trailer's interval must be KM). **#28** built `1301c76` (closes with PR #129) — "towed" is now `isTowedUnit` (`fleetActivity.js:79-82`), by type alone, matching the inspection's `is_attachment \|\| trailer` (`Inspection.jsx:277,284-287`); was `is_attachment && trailer` |
| Analytics — attachment cards | ✅ *(#18)* `attachmentStats` filters the fleet on it (`fleetActivity.js:129`) |
| Fuel Log picker | ❌ nothing — an attachment with no tank is still offered (`FuelLog.jsx:84`). Cosmetic, not filed. |

### `equipment.retired_at` (out of the fleet, still in the history)
Set by `retire_equipment` (`companydata.js:990-1021`). `list_equipment` filters
`retired_at is null` unless `includeRetired: true` is passed
(`companydata.js:897`; the reasoning is the comment directly above `list_equipment`, `:885-892`, back in place since `e7bd475`), so every worker-facing picker drops the machine with
no change on its side — `Inspection.jsx:169`, `DailyReport.jsx:130`,
`FuelLog.jsx:84`, `FieldService.jsx:86`. Only `Dashboard.jsx:2457` and
`AdminPanel.jsx:675,1007` ask for retired rows.

Everything that reads the `equipment` table **directly** bypasses that filter,
which is right for some and wrong for one:

| Direct reader | Includes retired? | Correct? |
|---|---|---|
| `maintenance.js:148-153` (`list_status`) | **no** — `.is('retired_at', null)` | ✅ **#15** fixed, PR #123 (draft) |
| `maintenance.js:384-387` (`list_records`) | yes | ✅ deliberate; a history that drops the machines you no longer own is not a history |
| `equipmentScope.js:80-88` (`companyEquipmentIndex`) | yes | ✅ historical ids must still vet |
| `equipmentScope.js:42,119` (`resolveEquipmentId(s)`) | yes | ✅ deliberate — see §5 |
| `companydata.js:1063-1094` (compliance list) | **no** — `withoutRetiredEquipment` (`:1092-1093`) | ✅ **#15** fixed, PR #123, merged `18645f0`; same for `compliance_summary` (`:1133-1134`) and the weekly report's snapshot (`equipmentreports.js:645,657`) |

### `daily_reports.equipment_ids` (jsonb array → `equipment.id`)
The joinable half of the free-text `daily_reports.equipment`, the same
producer/consumer split `site_id` has. Written by `src/DailyReport.jsx:297`
(live) and `:44` (offline drain), vetted by `resolveEquipmentIds`
(`logs.js:399-402`), present in the list payload (`logs.js:134`), deliberately
absent from `EDITABLE_FIELDS.daily` (comment at `logs.js:656`).

**Read as of `42ed3c7` — break #13, built, not closed.** Its first consumer is
Fleet Overview's "last on site" line, Dillon's pick of the three candidates:

| Step | Where |
|---|---|
| Query | `api/companydata.js:864` (`fleet_activity`, `:857`) — `daily_reports.equipment_ids, site, report_date, created_at`, `.eq('company_id')`, rows with no ids skipped in SQL |
| Fold | `lastOnSiteByEquipment` (`server-lib/fleetActivity.js:36-49`) — latest `report_date` (else `created_at` day) per id, with that report's site |
| Screen | `src/Dashboard.jsx:2470-2478` loads it with the fleet (`:2463`); `:6057-6068` renders "Last on site YYYY-MM-DD at …" on each Fleet Overview row |

*Re-check:* `grep -rn "equipment_ids\|equipmentIds" api/ src/ server-lib/` →
the old producer/allowlist/validator/payload hits (`logs.js:134,161,164,399-402,656`,
`DailyReport.jsx:25,44,213,297`) **plus** `companydata.js:864` and
`fleetActivity.js:4,39,42`. Run 2026-09-23 against `42ed3c7`.

**Not module-gated, on purpose** (`companydata.js:849-856`): Fleet Overview is
BASE (#19), and a company without Daily Reports simply has no last-on-site
lines rather than being refused the screen. The ids themselves were vetted on
write, so this read needs no second vet.

**Weak link, recorded, not filed.** The site shown is the free-text
`daily_reports.site`, not `site_id` → `sites.name`, although the column is
there (`logs.js:134`). A renamed site therefore reads under its old name on
Fleet Overview and its new one in Analytics (`siteBucketKey`,
`analyticsUtils.js:110-114`) — break #2's read-half shape, on a display line.
Cosmetic today; worth fixing if this line ever becomes a filter or a join.

### `roster.employee_id` — the employer's own number for a person
New in `8916156` (2026-09-18). A join key for a future HRIS sync (Workday,
BambooHR, ADP all key on an employee number), not a label: the roster
de-duplicates on `name_normalized`, so a name is exactly what cannot be matched
on across systems.

| Side | Where |
|---|---|
| Written on hire | `companydata.js:409` (`add_roster_member`), `:471` (`onboard_new_employee`) |
| Written after the fact | `companydata.js:510-541` (`set_roster_employee_id`) → `Dashboard.jsx:3114,3122` |
| Uniqueness | per company, case-insensitive, **across active and inactive rows** — handler `companydata.js:275-291`, index `docs/schema/roster-employee-id-migration.sql:58-60` |
| Read by | `Dashboard.jsx:7091-7093,7123` — displayed on the roster row. Nothing else |

**The opposite rule to `equipment.unit_number` on purpose.** A unit number may
be reused after a machine is scrapped (`activeUnitNumberClash` skips retired
rows, `companydata.js:110`); an employee number is not reused when somebody
leaves, and two rows answering to one would make a sync ambiguous — the exact
failure the column exists to prevent.

**Written and read by nothing but a badge — §4b's shape, deliberately, and not
filed as a break.** Every other §4b instance names a consumer that already
exists and should have been reading the key. This one does not: FORA has no
HRIS surface, so there is nothing in the product that *should* consume it
today. Recorded here so the next session does not mistake the column's
existence for a working sync. If an integration is ever built, the check is
§4b's four questions, not "the column is already there".

### `roster.departments` — Company Portal phase 1 (producer side only)
New `text[]` column (`docs/schema/roster-departments-migration.sql`, applied
live), recorded 2026-09-29. Fixed v1 list lives in
`server-lib/portalDepartments.js` (`PORTAL_DEPARTMENTS`: `hr`, `payroll`,
`safety`, `maintenance`, `operations_manager` — **not** `company_admin`,
since that access already comes unconditionally from `roster.role ===
'admin'`, the same reasoning `docKeyGate.js` uses to exempt admin sessions
from every doc-key gate). Same producer/consumer split break #2
(`site_id`) and `roster.employee_id` already established on this map: a
column can ship correct and fully write-side-validated with zero
consumers, because the consumer is a later phase of the same build, not a
missing wire-up in this one.

| Side | Where |
|---|---|
| Written | `api/companydata.js:862-876` (`update_worker_profile`) — only on a row whose **resulting** role is `supervisor`; a worker row is always forced to `[]` (`:864-865`), and switching a supervisor row to `worker` in the same request clears it too, so a departments array can never survive under a role that no longer justifies it |
| Validated | `api/companydata.js:867` — every element must be in `PORTAL_DEPARTMENTS`; anything else 400s. Deduped via `[...new Set(...)]` (`:870`) |
| Read back (list/detail only, not gated on anything) | `api/companydata.js:349` (roster list select), `:735` (single-member select), `:819` (mapped onto the worker-profile payload) |
| UI | `src/WorkerProfileDrawer.jsx:31,38,42,51,105,116-137` — chip multi-select, shown only when the **drafted** role is `supervisor` (`:105`); clearing the draft's role away from supervisor clears `departments` in the same setter |

**Phase 3 (2026-09-29, branch `company-portal-phase-3-routing-notification`)
is the first real consumer.** Read directly:

| Side | Where |
|---|---|
| Consumed — dashboard scoping | `api/portal.js:587-590` (`list_portal_records`) and `:634-637` (`get_portal_record_detail`) — only for an **individually-identified** supervisor session (`session.role === 'supervisor' && session.userId`); each looks up that caller's own `roster.departments` and keeps only `portal_documents` rows whose `departments` array intersects it (`.some(dep => myDepartments.includes(dep))`) |
| Consumed — submission email | `api/portal.js`'s `submit_portal` — queries `roster` for `company_id`-scoped, active, `role: 'supervisor'` rows with an email on file, then filters to those whose `departments` intersect the submitted document's `departments`, and emails only that set |
| Fallback (not a bug) | **Updated 2026-10-06 (`b2044ee`):** the shared company-code login is deleted, so the only supervisor session without `session.userId` left is the founder's `master_login` company-entry session (`api/login.js:888-921`, role picked by the founder, stored per tab, `src/Login.jsx:19`). It has no individual roster row to scope by, so both read actions fall back to unfiltered-within-company, same as before. Real customer supervisors always carry `userId` (`mintRosterSession`, `api/login.js:441-452`) |

This closes the "no consumer yet" note phase 1 recorded above. The two
re-check items flagged at that time are now answered:
- **Department-value validation:** confirmed safe by construction, not by
  an explicit check — the read side never takes a client-supplied
  department value at all; it always reads the caller's own
  `roster.departments` row server-side (`api/portal.js:588,635`) and
  intersects it against `portal_documents.departments`, which was already
  validated against `PORTAL_DEPARTMENTS` at write time (phase 1,
  `api/companydata.js:867`, and phase 2, `api/portal.js:309`). There is no
  bare foreign id on this join for a caller to forge.
- **`document_key`-style gating:** still not applied. Company Portal is
  still absent from `server-lib/pricing.js`'s `MODULES` (confirmed:
  `grep -n "portal" server-lib/pricing.js` → no hits), and the new
  `src/Dashboard.jsx` Portal tab is gated on the same `roster_enabled`
  boolean the Roster tab uses (`Dashboard.jsx`'s `TAB_VISIBLE.portal`), not
  on a doc key or a `MODULES` entry. This is the same open flag carried
  from the phase-1 and phase-2 entries, not a new break — filed once, not
  refiled with each phase that touches it.

**Update 2026-09-30 (branch `claude/step3-owner-profile`): the list is no
longer fixed, onboarding now writes the column, and the phase-1 "Written"
and "Validated" rows above are stale.**

| Side | Where |
|---|---|
| Valid keys | the five built-ins (`server-lib/portalDepartments.js`) plus the company's own `c_...` keys from the new `company_departments` table (`server-lib/companyStructure.js:38-52`, `validDepartmentKeys`). Keys are prefixed `c_` (`:30-33`) so they cannot collide with a built-in |
| Written, profile | `api/companydata.js:999-1002` via `sanitizeDepartments` (`companyStructure.js:55-60`). Owner-only (`:953-955`). The old "a worker row is forced to `[]`" rule is **gone**; a worker can now hold departments. Harmless today because every consumer below also requires `role='supervisor'` (`portal.js:737`, `portalReports.js:57`), but the phase-1 invariant no longer holds |
| Written, onboarding | `server-lib/onboardingApproval.js:313` from `planRoster` (`server-lib/onboardingRoster.js:20-31`). **Closes the gap where approval wrote no `departments` at all** (`git show origin/main:server-lib/onboardingApproval.js` has no `departments` hit), so a new Company Portal customer's supervisors matched no document routing until someone edited each by hand |
| Consumed (Portal) | `api/portal.js` validates document departments, escalation department and schedule/email departments against the per-company set (`deptSetFor`, `:95-100`; uses at `:280,289,385,1215,1295`). Dashboard scoping and email routing unchanged (`portal.js:737-739,788-790,934-936`, `portalReports.js:54-67`) |
| Labels | `portalReports.js:21` falls back to `prettifyDepartmentKey` (`portalDepartments.js:31`) for a custom key |
| Removal | deleting a custom department strips the key from every roster row (`companydata.js:1164-1166`). It does **not** strip it from `portal_documents.departments`, `portal_questions.escalation_department` or `portal_report_schedules.department`: see weak link W1 below |

Weak links found in this pass (read in code, not yet numbered as breaks, listed
for Dillon to decide; none loses data today):
- **W1. Deleting a custom department orphans its Portal routing.** `companydata.js:1160-1169` cleans `roster` only. A document routed to `c_yard` keeps the key in `portal_documents.departments`; nobody holds it, so `submit_portal` emails nobody (`portal.js:682-693`) and a question escalating to it notifies nobody (`portal.js:645-652`, the same silence as break #34/#35). Re-check: `grep -n "portal_documents\|portal_questions\|portal_report_schedules" api/companydata.js` around `:1157-1169` returns nothing.
- **W2. Onboarding keeps its own copy of the five-key list.** `server-lib/onboardingHelpers.js:59` (`ONBOARDING_DEPARTMENTS`) duplicates `PORTAL_DEPARTMENTS`; add a sixth built-in and onboarding drops it silently (`:89`). Onboarding cannot offer custom keys because the company does not exist yet (comment at `:84`), which is correct.
- **W3. The AI document drafter only knows the five built-ins.** Prompt lists them at `api/portal.js:217,228`, so a custom department is never suggested; the sanitizer (`:280`) would accept one.
- **W4. Onboarding sets departments on workers.** `onboardingHelpers.js:88-90` does not gate on role; same harmless-today caveat as above.

**`roster.divisions` (`bigint[]` of `company_divisions.id`), 2026-09-30.**
Written at profile edit (`companydata.js:1004-1007`, `sanitizeDivisionIds`,
`companyStructure.js:75-84`, rejects another company's id) and onboarding
(`onboardingApproval.js:294-302,311`, creates one `company_divisions` row per distinct
division name, one division per person). Read back only on the profile/list payloads
(`companydata.js:357,834,920,1216-1228`). Deleting a division strips it from roster
(`:1202-1204`). **No consumer**: nothing in `portal.js`, `maintenance.js`, analytics or any
report reads `divisions`. Intentional per `companyStructure.js:5-9` (tags for routing,
filtering and reporting that never grant access) and the same producer-side-first shape as
`roster.departments` phase 1. Filed as pending link **P2** (§4 pending links), not a break.
Because it is an array of bare ids, there is no FK: Postgres will not cascade a division
delete, which is why the handler cleans `roster` by hand at `:1202-1204`; any future
table holding division ids needs the same cleanup.

**Role-model note, Dillon's 2026-09-29 decision, mid-build:** the build
spec's "Company Admin" persona — a customer-facing admin role distinct
from worker/supervisor — was **not** built here, and should not be assumed
to exist by a future pass. This codebase has exactly two customer-facing
roster roles, `worker` and `supervisor` (`server-lib/docKeyGate.js`'s
`admin`-exemption comment already establishes founder-only `admin` is
never a customer role). The spec's "Company Admin sees everything"
requirement is satisfied instead by a supervisor-tier roster row with
every one of the 5 `PORTAL_DEPARTMENTS` checked — under the intersection
logic above, that row's departments superset any document's routing, so it
sees every document unfiltered. No `company_admin` role, column, or check
exists anywhere in `api/portal.js` or `roster` — do not go looking for one.

**Phase 4 (2026-09-29, branch `company-portal-phase-4-assignment-compliance`)
is now built — but deliberately does NOT use `roster.departments` as a
targeting dimension.** See the new `portal_assignment_rules`/
`portal_assignments` join-key section in §2 below for why: this column's
only real-world use as a targeting concept ("assign to everyone in
Safety") is undercut by the same producer-side-only fact recorded above —
it exists solely on supervisor-tier rows, so a department-targeted rule
could never reach a worker, which is the wrong default for a feature about
assigning paperwork to the people doing the work. `target_type` is
`everyone | role | individual` instead; see §5.

### `equipment_compliance.equipment_id` → `equipment.id`
Per-machine CVIP / registration / insurance expiry dates. Written and read by
`api/companydata.js:1025-1203`. Until **#14** the only consumer was Equipment ▸
Compliance (`Dashboard.jsx:6208-6297`) — not the weekly equipment report, not
the cron, not the overview banner, not the Brain. PR #122 (merged)
added two: the overview banner via `compliance_summary` (`companydata.js:1071` →
`Dashboard.jsx:4917`) and the weekly equipment report's compliance section
(`equipmentreports.js:607-657` → `reportPdfs.js:142`). The Brain still never
sees an expiry date — that was never in #14's approved scope. All three drop a
retired machine's rows as of **#15** (PR #123, merged as `18645f0`), through one
shared rule (`withoutRetiredEquipment`, `equipmentScope.js`) so the counts and
the lists cannot disagree.

**Gated as of `2560819` (#19 closed).** All three surfaces now hang off the
`equipment_compliance` doc key: the sub-tab (`Dashboard.jsx:2784,2869`), the
overview banner (`:4917`), and the weekly report's compliance section, where
the query is **skipped entirely** rather than filtered afterwards
(`equipmentreports.js:618-625`). The weekly report is the Equipment Inspections
module's artifact, so ungated it would have delivered a paid module's output
inside another module's document every Monday. **As of `48d5889` the four
`api/companydata.js` handlers consult the doc key too** — `requireDocKey` at
`:1065`, `:1114`, `:1183`, `:1231` (re-anchored at `42ed3c7`), so the data is refused and not merely
hidden (break #21, built).

### `linked_inspection_id` → `inspections.id` (the trip pair)
Set on a post-trip to point back at its pre-trip (`Inspection.jsx:53`;
always `null` on a pre-trip, `:47`). This is what makes a *trip* a unit
rather than two loose rows: usage for the week is `posttrip.end_reading −
pretrip.start_reading`, and "checked out, not returned" is the absence of a
post-trip carrying this id.

| Consumer | Reads it |
|---|---|
| Weekly Equipment Report — open-trip count | `equipmentreports.js:316` |
| Weekly Equipment Report — towed distance | `equipmentreports.js:331` |
| `api/logs.js` open-pretrip list | `logs.js:223` |
| Dashboard inspection detail | `src/Dashboard.jsx:3989` |
| PM towed distance *(#18, `42ed3c7`)* | `fleetActivity.js:111-112` — pairs each post-trip with its pre-trip by this id, inside a company-scoped set (`maintenance.js:161-166`) |

**Weak link, recorded 2026-09-17, not being worked.** This is the last
client-supplied foreign id in `SUBMITTABLE_FIELDS.inspection`
(`logs.js:132`) with no ownership check — the same shape as the
`equipment_id` gap `afee546` closed, found by `tenant-scope-reviewer` while
verifying that fix.

**It is inert today, and the reason is worth writing down:** all five
consumers above compare `linked_inspection_id` against rows from a set that
is *already* company-scoped (`logs.js:210`, `equipmentreports.js:216`,
`maintenance.js:164` for #18's towed distance — re-checked 2026-09-23 — and
the supervisor's own filtered list), so a foreign id matches nothing and is
dropped. Nothing fetches by that id directly. The trap is the same one
`equipment_id` had: the first consumer that does a direct lookup without
re-checking `company_id` hands one company's readings to another.

**Do not fix this by copying `equipmentScope.js`.** The semantics differ.
A missing `equipment_id` degrades to a label-only record, which is a shape
the product already has; a missing `linked_inspection_id` would silently
drop the trip pairing and with it the week's usage hours. There is also an
offline question to answer first — a post-trip queued offline needs its
pre-trip's server-assigned id, so what that column holds mid-drain needs
reading before any guard is written. Needs a decision, not a mechanical
copy.

### `(machine, item_key)` — the recurrence key
Added by PR #121 (migration `corrective-actions-equipment-recurrence-migration.sql`,
**written, not yet applied**). The pair that answers "has this unit had this
fault before?", which nothing in the product could answer until now:
`corrective_actions` knew *what* was wrong and *which finding* it came from,
but its only pointer to a machine was `source_id` → one single inspection row.

The machine half deliberately reuses the two-key space break #7 settled on:
the fleet id when the row has one, otherwise the normalized label
(`server-lib/recurrence.js:49-65`). The item half is the checklist line,
lower-cased and whitespace-collapsed (`recurrence.js:38-42`) — **not** the
description, which carries the machine label and the operator's note and
therefore differs on every report of the same fault.

| Consumer | Reads it |
|---|---|
| Recurrence count on each action | `api/monthly.js:850` (`annotateRecurrence`) |
| Per-machine repeat-offender list | `api/monthly.js:860` (`patternsByEquipment`) → `src/Dashboard.jsx:2381,3559,6486` |
| Post-trip resolution | `server-lib/correctiveActions.js:328` (`machineKey` match; read `:314-319`, update `:336-346`) |
| Open-defect dedupe on submit | `server-lib/correctiveActions.js:153-199` |

**Two things about this key are load-bearing and easy to get wrong.**

*A label key must carry `company_id`; an id key must not.* `equipment.id` is
a global sequence, so an id already names one company's machine. A label is a
string two tenants can both type, and `list_corrective_actions` returns every
company at once for an admin session (`monthly.js:644`) — so an
unnamespaced label key merges two tenants' machines into one recurrence group
(`recurrence.js:54-64`, pinned by `tests/unit/defect-recurrence.test.js`).

*Closing and counting must use the same definition of "same machine".* The
first version of `resolveCorrectiveActionsForItems` filtered the machine in
the query with `.eq('equipment_label', …)` while the count used the
normalized key. Two consequences, both found by `tenant-scope-reviewer`: a
free-text label closed a **fleet-registered** machine's defects (and wrote no
repair line, since that path needs an `equipment_id`), and a label differing
only in case counted toward a group it could never close. Both sides now call
`machineKey()`.

### `reading` / `reading_unit` (the usage clock)
Hours or kilometres on a machine. Written by inspections
(`start_reading`/`end_reading`) and fuel logs (`hour_reading`).

| Consumer | Reads inspections | Reads fuel logs |
|---|---|---|
| `api/fuellogs.js` `get_last_reading` | ✅ `:106` | ✅ `:99` |
| `api/fuellogs.js` consumption calc | ✅ `:211` | ✅ `:229` |
| `api/maintenance.js` PM status | ✅ `:129` | ✅ *(#1, PR #118)* |
| `api/maintenance.js` PM status — **a trailer** (by type since #28, `1301c76`) *(#18, `42ed3c7`)* | ✅ towed distance: the tow unit's completed-trip deltas, KM only (`maintenance.js:223-242` → `towedDistanceSince`, `fleetActivity.js:99-119`) | — *(a trailer has no tank; deliberate)* |
| `api/equipmentreports.js` weekly — ending reading | ✅ | ✅ *(#1, PR #120)* |
| `api/equipmentreports.js` weekly — "Used" | ✅ | — *(by definition; see #1)* |

**This was break #1 below.** Both consumers now share one reducer in
`server-lib/readings.js`, so neither can drift from the other again.

**#18 added a third reader, deliberately outside `readings.js`.** The old
#18 entry proposed a third reading-point source in `server-lib/readings.js`;
what was built sums towed distance in `server-lib/fleetActivity.js` instead,
because a trailer has no odometer for a reading *point* to be on
(`fleetActivity.js:12-16`). It is the same arithmetic as `foldWeeklyUsage`
(`equipmentreports.js:302`) — post-trip end minus its own start, credited to
every attachment on the linked pre-trip — with two filters Weekly Hours does
not have: distance units only (`fleetActivity.js:108`) and, through the
`list_status` query, a tow unit with a fleet id (`maintenance.js:166`). The
first is by design; the second is **#29**.

### `site_id` → `sites.id` vs `site` vs `job_site`
One concept, **three column shapes across ten features**:

| Shape | Features |
|---|---|
| `site_id` FK → `sites` | Fuel Log, Custom Documents, Monthly Inspection |
| `site` free text | Toolbox Talk, Daily Report, Incident, Near Miss |
| `job_site` free text | FLHA (`flhas.js:126`) |
| nothing at all | Equipment Inspection, Time Clock |

(**The Unified Document Engine is a fifth `site_id` FK user** (`document_records.site_id`, `service.js:610,620`, vetted by `resolveSiteId` `documents.js:134`; and a `site_picker` answer, `idAnswers.js:79-86`, which goes through the same `resolveSiteId` then re-reads the name from `sites`); its auditor view filters on it, `audit.js:154`. A record with no site is invisible to an auditor.) (Company Portal is a fourth `site_id` FK user: `api/portal.js:476-479,515-525` check `siteId` against `sites`; it was missing from this table.)

**This is break #2 below.**

**`roster.default_site_id` -> `sites.id` (2026-09-30, branch `claude/step3-owner-profile`).**
A person's default site. Written by `api/companydata.js:1009-1012` (`sanitizeDefaultSite`,
`server-lib/companyStructure.js:88`, same contract as `resolveSiteId`: false for another
company's site) and at onboarding approval, `server-lib/onboardingApproval.js:308,316`
(name matched case-insensitively against the `sites` rows inserted at `:266-269`; a name
that matches no site silently becomes `null`, no error). Read by `list_sites`,
`api/companydata.js:1102-1107` (returns `defaultSiteId`), and preselected, never overriding
a draft or a choice, by nine forms. Matching the table above, it is stored as an id but
lands in two shapes:

| Form | Preselect | Shape it lands in |
|---|---|---|
| Fuel, Monthly, Custom, Portal | `src/FuelLog.jsx:97`, `MonthlyInspection.jsx:94`, `CustomForm.jsx:91`, `PortalDocumentForm.jsx:126` | `siteId` (id, survives a site rename) |
| FLHA, Incident, Near Miss, Toolbox, Daily | `src/App.jsx:400`, `Incident.jsx:237`, `NearMiss.jsx:142`, `ToolboxTalk.jsx:124`, `DailyReport.jsx:121` | the site's **name** copied into the free-text `site`/`job_site` state |

So the new FK does not close break #2; for five forms it is one more id-to-string
conversion at the client. Not a new break (nothing is lost today); #2's scope is unchanged.
Also `list_sites` returns `defaultSiteId` only to a session with `session.userId`
(`:1102`; line now `companydata.js:1179`, `b2044ee`); a no-userId session (today only the founder's `master_login` entry, `api/login.js:888-921`) gets `null` and no preselect, which is expected.

### `roster_id` → `roster.id` (the person)
| Feature | Link |
|---|---|
| Time Clock | ✅ FK `roster_id` |
| Certifications | ✅ FK, path-namespaced `certifications.js:130` |
| Every document form (primary signer) | ✅ `submitted_by_roster_id`, stamped server-side from the session (#3, fixed PR #118; **FLHA only from branch `claude/step1-autofill-name-stamp`, `api/flhas.js:428`**, it was missing before) |
| Unified Document Engine | ✅ author `document_records.submitted_by_roster_id` (`service.js:621`), signers `document_signatures.signer_roster_id` (crew resolved from the roster, `:555`), and a `person_picker` answer `{ roster_id, label }` checked against the caller's company, active and not an auditor, label from the roster row (`idAnswers.js:87-93`, WP7c-2 branch). The secondary-signer gap of #31 does not repeat here: crew ids are validated server-side |
| Toolbox Talk attendee / FLHA crew (secondary signer) | ⚠️ **new as of this branch — client-asserted, not server-validated.** See below. |

**The primary-signer link is break #3, closed.** The new secondary-signer link
is a narrower, weaker version of the same idea, and is **not** a re-file of
#3 — it's genuinely new surface, tracked as **#31** below.

**What shipped:** a new worker-facing action, `list_roster_names`
(`api/companydata.js:761-770`, added this branch) — company-scoped, `id,
name, role` only, `active = true`, any logged-in session (no role check,
same pattern as `list_sites`/`list_equipment`). `src/ToolboxTalk.jsx` (a
second signer/"attendee") and `src/App.jsx` (FLHA "additional crew") both
call it and let the signer pick a real roster row instead of typing a name.
Each picked entry gets a `rosterId` field:
- Toolbox Talk attendee: `{ name, rosterId, guest, signature, signedAt }` —
  `rosterId: null, guest: true` is a deliberate escape hatch for a genuine
  non-employee signer (`src/ToolboxTalk.jsx:275-280`).
- FLHA crew: `{ name, rosterId, signature, signedAt }` — no guest option;
  `src/App.jsx:502-504`'s comment states additional crew is always assumed
  to be an actual employee.
- Both flows block adding a second signer entirely (not falling back to
  free text) if `list_roster_names` returns zero active members
  (`ToolboxTalk.jsx:612`, `App.jsx:1495`).

**Where it agrees with #3, and where it doesn't:** #3's `submitted_by_roster_id`
is a real column, a real FK, and stamped **server-side from the session** —
a client cannot forge it. This new `rosterId` is a plain field inside a
jsonb blob (`toolbox_talks.attendees_json`, `flhas.crew_signatures`), and
those columns are on the client-submittable allowlist on both sides
(`api/logs.js:159` `attendees_json`; `api/flhas.js:148` `crew_signatures`).
Nothing in `api/logs.js`'s toolbox submit path or `api/flhas.js`'s FLHA
submit path re-reads `rosterId` out of the JSON and checks it against the
caller's own roster (confirmed absent — see #31). Compare to `site_id` and
`equipment_id`, which travel the same "text stays authoritative, an id
rides along" pattern but **are** validated against the caller's company on
submit (`equipmentScope.js`, comments at `logs.js:154-157,161-163`). The
attendee/crew `rosterId` skips that step entirely.

### `portal_documents.id` → `portal_questions`/`portal_records`/`portal_answers` (Company Portal phase 2 — Document engine v2)
New tables, recorded 2026-09-29 against the uncommitted working tree that
added `docs/schema/company-portal-phase2-migration.sql` (applied live),
`server-lib/portalFieldTypes.js` (the 8 field types: `yesno`, `short_text`,
`number`, `date`, `dropdown`, `multiselect`, `signature`, `file_upload` —
generalizing `custom_form_questions`' yes/no-only shape), `api/portal.js`
(new file, admin builder + worker submit + supervisor/admin view actions),
`src/generatePortalDocumentPDF.js`, `src/PortalDocumentForm.jsx` (worker
submission, registered in `WorkerMenu.jsx:38`'s `RESUBMIT_HANDLERS` as
`portalform`), and `src/PortalDocumentBuilder.jsx` (admin builder, wired
into `AdminPanel.jsx:1407` as a founder-only "Document Builder" tab,
`:31`). This is phase 1's `roster.departments` finally getting a table on
the other side of it — but that table isn't the consumer yet either; see
below.

| Table | Join | Where |
|---|---|---|
| `portal_documents.id` | → `portal_questions.document_id` (cascade delete) | `api/portal.js:293-294` (read), `:305-353` (`publish_document` — wholesale question replace on edit, insert on create) |
| `portal_documents.id` | → `portal_records.document_id` | `api/portal.js:448-470` (submit, company-scope-checked at `:449`) |
| `portal_records.id` | → `portal_answers.record_id` (cascade delete) | `api/portal.js:485-497` — only an answer whose `question_id` belongs to the submitted document is accepted (`questionById` map, `:482-487`), same guard shape as `api/customforms.js`'s `submit_custom` |
| `portal_records.site_id` → `sites.id` | validated against caller's company | `api/portal.js:444-447`, `:401-404` (`get_active_portal_document`) |
| `portal_records.submitted_by_roster_id` | stamped server-side via `authorRosterId(session)` | `api/portal.js:466` — same unforgeable pattern as break #3's `submitted_by_roster_id` on the nine original document tables, not the client-asserted shape break #31 found on toolbox/FLHA secondary signers |
| `portal_records.client_submission_id` | idempotency key for the offline-drain retry path | `api/portal.js:456-460,472-476` — same shape as `custom_form_records.client_submission_id` |
| `portal_records.document_id` → `portal_documents.id`/`.company_id` | consumed by a worker's own document history | `api/customforms.js:451-462` (`get_my_documents`, fixed for break #32, PR #149, commit `6b2fc3a`) — `portal_records` has no `company_id` column of its own, so the query scopes through `portal_documents.company_id` first (same shape `custom_form_records` already used via `custom_forms`, `:441-446`), then matches the worker by `submitted_by` (name-string match, same as every other row in this handler except break #3's `roster_id` carve-outs — not upgraded to `submitted_by_roster_id` even though the column exists and is trustworthy, per PR #149's description) and renders in `src/MyDocuments.jsx`'s Submitted section as `type: 'portalform'` via the existing unrecognized-type fallback (`MyDocuments.jsx:196`, `TYPE_META[doc.type] \|\| { label: doc.title, icon: FileText }`) — no client-side change needed. **Submitted history only — see break #33 for the separate Unfinished-drafts gap this fix does not touch.** |

**Read every file listed above.** Two new private Supabase Storage buckets
back this: `portal-sources` (admin-uploaded source documents for
`ai_draft_document`'s vision/document call — a real Anthropic vision block,
`api/portal.js:179-182`, not a stub) and `portal-attachments` (worker
per-question signature/file_upload answers, `api/portal.js:492`). Both go
through the same signed-upload-receipt model as every other bucket in this
app (`server-lib/uploadUrls.js`), never a client-supplied path taken at
face value.

**Deliberately not built in this phase (per the spec, confirmed by grep —
not assumed), and updated by the phase-3 pass below:**
- **`portal_documents.departments`/`.category` had no reader as of phase
  2 — now consumed by phase 3.** Written and validated
  (`api/portal.js:124-126,309`); as of the `company-portal-phase-3-routing-notification`
  branch, `departments` gates a supervisor's dashboard (see §2's
  `roster.departments` entry above for the file:line evidence) and gates
  the submission-notification email. **`category` still has no reader** —
  nothing rolls it into Platform Analytics or groups the new Document
  Library by it (`src/Dashboard.jsx`'s Portal tab shows `category` as a
  label only, `d.category || "No category"`, not as a filter or grouping
  key). Worker-side, `get_worker_portal_documents` (`api/portal.js:384-394`)
  is unchanged by phase 3 and still shows every active document in the
  company to every worker regardless of department — department scoping
  landed for the supervisor dashboard only, not the worker's own document
  list. Not a break: the build spec scopes phase 3 to supervisor/admin
  dashboards, and a worker has no `roster.departments` value to scope by
  in the first place (phase 1 only ever populates it on a supervisor-tier
  row, `api/companydata.js:864-865`).
- **`list_portal_records`/`get_portal_record_detail` had no UI as of phase
  2 — now wired.** `api/portal.js:508-563` (original code, lines shifted by
  phase 3's edits) is called from `src/Dashboard.jsx`'s new Portal tab
  (`loadPortalRecords`/`openPortalRecord`, wired to `activeTab === "portal"`)
  as of the phase-3 branch. Confirmed: `grep -n "list_portal_records\|get_portal_record_detail" src/Dashboard.jsx`
  now returns hits, where the phase-2 pass's grep returned none.
- **Escalation (phase 5) — built.** `escalation_department`/
  `escalation_trigger_value` on `portal_questions`, and a
  `portal_escalations` table, landed 2026-09-29 on branch
  `company-portal-phase-5-escalation` (PR #150) — see the new
  `portal_questions.escalation_department`/`portal_escalations` §2 entry
  above for the full producer/consumer evidence. This closes the last item
  on the phase-2 deferrals list. **One genuine gap found placing it on the
  map, not a deferral: see break #34** — an escalation has no notification
  path to the department it's routed to, unlike a document submission's
  phase-3 email.
- **Assignment rules (phase 4) — built.** See the new
  `portal_assignment_rules`/`portal_assignments` §2 entry below. This
  closes the last of the phase-2 deferrals list.
- **Company Portal is still not in `server-lib/pricing.js`'s `MODULES`.**
  Confirmed: `grep -n "portal" server-lib/pricing.js` → no hits. `api/portal.js`
  calls neither `requireDocKey` nor `docKeyGate` anywhere (confirmed by
  grep — no hits in the file). `portal_documents.is_active` is the only gate
  a submission or a worker's document list passes through
  (`api/portal.js:390,407,452-454`); a document's mere existence as an
  active row is what currently gates a company having Portal at all — same
  shape break #19 was before Fleet Overview/Compliance got sorted into BASE
  vs. a real module. Flagged already at the phase-1 entry above; **still
  true as of phase 3** — the new `src/Dashboard.jsx` Portal tab is gated on
  `roster_enabled`, not a doc key or a `MODULES` entry (see the
  `roster.departments` section above) — not refiled as a new break, since
  it is the same open item, not a new one.

**Break #32, filed at the phase-2 pass: CLOSED, PR #149 (branch
`fix-break-32-portal-my-documents`, commit `6b2fc3a`).** Portal submissions
now show up in a worker's own document history — see below for the fixed
entry. **Break #33 filed while building that fix:** a *separate* screen,
`src/MyDocuments.jsx`'s Unfinished-drafts section, still silently drops an
in-progress Portal draft. See below; distinct from #32 and not fixed by
PR #149.

### `portal_assignment_rules.id` → `portal_assignments` (Company Portal phase 4 — assignment + compliance)
New tables, recorded 2026-09-29 against branch
`company-portal-phase-4-assignment-compliance`
(`docs/schema/company-portal-phase4-migration.sql`, applied live). This is
the phase-1/2 deferral — "no rule-based targeting yet" — finally getting
built, and it closes the sellable-v1 cut line: phases 1-4 are now the
complete v1 per the Boardroom decision. Phase 5 (escalation) is confirmed
still absent: `grep -rln "portal_escalations\|escalation_department\|escalation_condition" api/ src/ server-lib/ docs/schema/company-portal-phase4-migration.sql` finds nothing new added by this phase.

| Table | Join | Where |
|---|---|---|
| `portal_assignment_rules.document_id` → `portal_documents.id` (cascade delete) | write | `api/portal.js`'s `create_assignment_rule` action, admin-only |
| `portal_assignments.rule_id` → `portal_assignment_rules.id` (`on delete set null`) | materialization | `server-lib/portalAssignments.js`'s `applyRuleToExistingRoster` (called right after a rule is created, `api/portal.js`'s `create_assignment_rule`) and `applyRulesToNewRosterMember` (called right after a roster insert in `api/companydata.js`'s `add_roster_member` and `onboard_new_employee`) |
| `portal_assignments.roster_id` → `roster.id` | scoped by `roster.company_id` and `roster.active` in `applyRuleToExistingRoster`'s query; by the company's own `portal_documents` set in `applyRulesToNewRosterMember` | `server-lib/portalAssignments.js` |
| `(portal_assignments.document_id, portal_assignments.roster_id)` unique | idempotency for re-running a rule | `upsert(..., { onConflict: 'document_id,roster_id', ignoreDuplicates: true })`, `server-lib/portalAssignments.js`'s `insertAssignmentsIgnoringConflicts` |
| Rollup consumer | reads `portal_assignments` + `portal_records` together, computing status **at read time**, not stored | `api/portal.js`'s `get_assignment_rollup` — a submission satisfies an assignment when it's the same `document_id`/`submitted_by_roster_id` (a trustworthy server-stamped column, not free text — same join `portal_records` already uses per its phase-2 entry above) with `created_at >= portal_assignments.created_at`; `status` is `submitted` / `overdue` (`due_at` in the past, no matching submission) / `not_started` |
| UI | `src/PortalDocumentBuilder.jsx`'s new "Who needs to complete this" section (rule create/delete, roster picker for `individual`), `src/Dashboard.jsx`'s new "Assignments" sub-tab on the Portal tab (rollup rows, overdue in red) |

**Both `server-lib/portalAssignments.js` entry points are best-effort and
non-blocking, matching this app's existing posture on side effects that
must never undo the write that triggered them** (same reasoning already
used for the phase-3 submission-notification email and the onboarding
email): `api/companydata.js`'s two call sites wrap the call in
`try/catch` and only `console.error` on failure, so a roster add or
onboard never fails because assignment materialization did.

**Deliberate deviation from the build spec's literal targeting wording,
already resolved and recorded in the migration's own header comment.**
The spec names "role/group/individual/everyone" as the four target types.
This codebase's only sub-roster grouping concept is `roster.departments`
(phase 1), and that column exists ONLY on supervisor-tier rows (§2's
`roster.departments` entry above; `api/companydata.js:864-865` forces it
to `[]` on any worker row) — a worker holds no department value at all,
so a department-targeted assignment rule could never reach the very
people this feature is supposed to put paperwork in front of. Built as
`target_type` in `('everyone', 'role', 'individual')` instead, with no
department-based option — `'role'` (worker | supervisor) is the closest
built primitive to the spec's "group". See §5. Flagged in the migration's
header comment as worth reopening if a real customer needs
department-scoped assignment once workers get some equivalent grouping —
not filed as a break, since nothing today can silently fail to reach a
department that was never offered as a target in the first place.

**`get_assignment_rollup`'s scoping matches its `list_portal_records`
sibling, not a new pattern:** for an admin session, `docsQuery` carries no
`company_id` filter at all (only a supervisor session adds
`.eq('company_id', session.companyId)`, `api/portal.js:729`) — same shape
as `list_portal_records` (`api/portal.js:572`), where `src/Dashboard.jsx`
filters the admin's multi-company view down to `selectedCompany`
client-side (`loadPortalAssignments`'s `.filter(r => !isAdmin ||
r.company_id === selectedCompany)`). Read both actions side by side before
assuming this is new: it's the pre-existing admin-dashboard shape, not a
gating disagreement introduced by phase 4.

### `portal_questions.escalation_department`/`portal_escalations` (Company Portal phase 5 — question-level escalation)
New columns and a new table, recorded 2026-09-29 against branch
`company-portal-phase-5-escalation`, PR #150
(`docs/schema/company-portal-phase5-migration.sql`, applied live). This is
the last of the 5 build-order phases; phases 1-4 are the sellable v1
(2026-09-28 Boardroom decision), phase 5 is a roadmap item layered on top,
not sold as included until now. `portal_questions` gets
`escalation_department`/`escalation_trigger_value`; a new
`portal_escalations` table carries only the flagged question/answer +
status, never the whole document, on purpose (migration header comment).

`escalation_department` is a **new consumer of the same `PORTAL_DEPARTMENTS`
list** `roster.departments`/`portal_documents.departments` already validate
against (`api/portal.js:125` `PORTAL_DEPARTMENTS.includes(q.escalationDepartment)`;
`src/PortalDocumentBuilder.jsx`'s target-department `<select>` maps
`PORTAL_DEPARTMENTS`) — but for a **different semantic**: it's the target of
an escalation, not a document's own routing. Confirmed by reading
`list_escalations` (`api/portal.js:858-903`): it scopes by
`portal_escalations.target_department` directly, never by the source
document's `departments` array, so an escalation can (and per the spec's own
example, is meant to) reach a department that never saw the document itself
— e.g. a Safety inspection escalating a defect to Maintenance.

| Table | Join | Where |
|---|---|---|
| `portal_questions.escalation_department`/`.escalation_trigger_value` | write, admin builder | `api/portal.js:124-131` (`validateQuestions` — department must be in `PORTAL_DEPARTMENTS`, field type must pass `fieldTypeCanEscalate`, trigger value must be a real option or `yes`/`no`); `:397-404` (`publish_document` insert) |
| Escalation is restricted to 3 field types | `yesno`, `dropdown`, `multiselect` only — the only types with a fixed, pre-configurable "flagged" value | `server-lib/portalFieldTypes.js`'s `ESCALATABLE_FIELD_TYPES`/`fieldTypeCanEscalate`, consumed by both `api/portal.js` (`validateQuestions`, `ai_draft_document`'s sanitizer) and `src/PortalDocumentBuilder.jsx` (escalation controls only render when `fieldTypeCanEscalate(q.fieldType)`) — one shared source, can't drift |
| `submit_portal` → `portal_escalations` insert | producer | `api/portal.js:552-578` — each answer is compared against its own question's trigger (`String(a.value) === escalation_trigger_value` for yesno/dropdown, `a.value.includes(...)` for multiselect) and a row inserted on match. `question_text`/`answer_value` are snapshotted at insert time, not joined live, because `publish_document` does a wholesale delete-and-reinsert of `portal_questions` on republish (§2's `portal_documents.id` entry) — an escalation raised against an earlier version of a document must keep reading correctly after the question row is gone. `question_id` is kept for traceability, `on delete set null` rather than cascaded (migration). Best-effort/non-blocking, same posture as the phase-3 submission email right below it in the same file — a failure here never undoes the already-saved submission. |
| `portal_escalations.record_id`/`.document_id` | cascade delete from `portal_records`/`portal_documents` | migration |
| `list_escalations`/`action_escalation` | consumer, supervisor/admin | `api/portal.js:858-931` — scoped by `target_department` (not the document's `departments`, see above); an individually-identified supervisor (`session.userId` set) is further filtered to escalations whose `target_department` is in their own `roster.departments` (`:878-882`, `:919-922`), same shape `list_portal_records`/`get_assignment_rollup` already use. `action_escalation` stamps `actioned_by_roster_id`/`actioned_at` via `authorRosterId(session)`, the same unforgeable pattern as `portal_records.submitted_by_roster_id` |
| UI | `src/PortalDocumentBuilder.jsx`'s per-question "Escalate if answer is / send to" controls (shown only for escalatable field types); `src/Dashboard.jsx`'s new fourth "Escalations" sub-tab on the Portal tab (`loadPortalEscalations`, `actionEscalation`) |

**Admin-session scoping matches every other phase 5 action's siblings, not a
new gap:** `list_escalations` has no `company_id` filter for an admin
session, same shape already recorded for `list_portal_records`/
`get_assignment_rollup` above — read `api/portal.js:872-875` next to those
before assuming phase 5 introduced a new gating shape; it didn't.

**Genuine interaction break found while placing this phase on the map, not
fixed — see §4's new break #34.** The escalation is a producer
(`portal_escalations` row) with a real consumer (`list_escalations`/the
Escalations tab), but nothing notifies the target department the way phase
3's submission email notifies a document's own departments — an escalation
sits silent until someone in the target department happens to open the
Escalations tab.

### `portal_report_schedules` / department email (Company Portal follow-up, step 5)
Recorded 2026-09-29 against branch `portal-pdf-email` (`ba5f6ab`). New table
`portal_report_schedules` (`docs/schema/portal-report-schedules-migration.sql`,
**NOT applied live** as of the `ba5f6ab` pass. **Update 2026-09-29: applied
live now, per Dillon; that is a database fact this pass could not check from
code, so it is taken from him, not re-verified.** Before it was, the actions
returned 500 and the daily cron 500'd (`api/cron-portal-reports.js:32-34,49-50`).
A deploy-order dependency, not a break). This feature is a pure **consumer** of four existing keys and adds
no new key of its own.

| Consumed | Producer side | Consumer side | Key agrees? |
|---|---|---|---|
| Department a schedule/email targets | `PORTAL_DEPARTMENTS` (`server-lib/portalDepartments.js`) | validated `api/portal.js:1058` (schedule), `:1138` (one-off) | yes, same list as `roster.departments` (`companydata.js:867`) and `portal_documents.departments` (`portal.js:309`) |
| Which documents count as "the department's" | `portal_documents.departments` | `server-lib/portalReports.js:88-91` (`(d.departments).includes(department)`, current routing at send time, not submit time) | yes |
| Records to send | `portal_records.pdf_url`, `created_at` (`portal.js:520-524`) | `portalReports.js:94-100` (`created_at > last_sent_at`), signed 7 days via `signRows` on `flha-reports` (`:100`) | yes; same bucket the dashboard signs (`portal.js:704`) |
| Who receives it | `roster.email` (encrypted, written `companydata.js:483,860`, `certifications.js:396`, `onboardingApproval.js:293`), `roster.role`, `roster.departments`, `roster.active` | `portalReports.js:54-73` (`role='supervisor'`, `active`, departments intersect, `decryptField`) | yes; legacy plaintext passes through `decryptField` (`fieldCrypto.js:55`) |
| Hand-added extras | `portal.js:1065-1077` (`encryptField(JSON.stringify(list))` into `recipients_encrypted`) | `portalReports.js:26-35` (`readRecipients`), and `presentSchedule` `portal.js:1039` | yes |

Manager scoping matches the neighbouring Portal actions: an
individually-identified supervisor only manages schedules for departments on
their own roster row (`portal.js:1017-1034`, `:1072-1073`), missing and foreign
ids get the same 403, no-userId supervisors have no department limit (since `b2044ee` that is only the founder's `master_login` session, `api/login.js:888-921`; the shared company-code login is gone).
Surfaces: `src/PortalReports.jsx` (Portal "Reports" sub-tab,
`Dashboard.jsx:6271,6380-6381`) and the "Email to department" button in
`PortalRecordCard` (`Dashboard.jsx:1610,1651`, department picker limited to
the document's own `departments` (`:1603` in the working tree, `:1602` in `ba5f6ab` with an all-five fallback), **client-side only in `ba5f6ab`**, see #36).
Cron registered `vercel.json:9` (`0 13 * * *`); gated only by `CRON_SECRET`
(`cron-portal-reports.js:27`). Company Portal has no doc key or `MODULES`
entry, so `isDocKeyActive` does not apply, same open flag as phases 1-5, not
refiled. **Update (PR #158, read 2026-09-29):** this cron now gates like its
sibling `cron-equipment-reports.js:88`. It selects `companies.roster_enabled,
suspended` and only runs schedules for companies where `roster_enabled &&
!suspended` (`api/cron-portal-reports.js:36-39`, applied at `:43`), and
`runSchedule` returns `marked: false, reason: 'email_not_configured'` without
`RESEND_API_KEY` (`server-lib/portalReports.js:128`). The gate is on
`roster_enabled` because that is what the Portal UI tab rides, not a Portal
doc key; still no `MODULES` entry.

**Encryption spine this rides on** (earlier merged steps, recorded so the
next pass doesn't re-derive it): `roster.email` is AES-256-GCM via
`server-lib/fieldCrypto.js`, so it can't be `.eq()`-searched
(`fieldCrypto.js:19-21`); every reader must call `withDecryptedEmail`/
`decryptField` (`certifications.js:285`, `companydata.js:751,894`,
`login.js:825`, `portal.js:603,644`, `portalReports.js:66`).
`onboarding_requests.people_encrypted` is written `login.js:949,965` and
consumed `login.js:1142-1152` (edit link, blanked once approved) and
`onboardingApproval.js:276-293` (approval writes the encrypted roster
emails). Supervisors creating assignment rules: `portal.js:797-798`
(`admin` or `supervisor`). The Overview "Company Portal" panel: **read
2026-09-29, no longer `?`.** See the next section.

### Overview "Company Portal" panel (PR #157)
Consumer only, no new key. `src/Dashboard.jsx:5502-5508` builds four tiles
from `portalRecords` (`:2378`, new this week by `created_at`),
`portalLibraryDocs` (`:2380`, `is_active`), `portalAssignmentRows` (`:2385`,
`status === "overdue"`) and `portalEscalations` (`:2393`, `status ===
"open"`), the same four lists the Portal tab uses. It returns `null` when the
company has no documents and no records (`:5508`). The loader effect fires on
the Overview too, only when `TAB_VISIBLE.portal` is on (`:3460-3468`, effect
calls `loadPortalRecords/Library/Assignments/Escalations`). It is not
included in `recentActivityList` (`:4268-4270`) and Site Activity
(`:4278-4282`) since #40, and the Portal tab has its own Analytics sub-tab
(`:6567-6575`).

### `portal_scope_requests.approval_token` (the Ted pipeline's one join key)
Recorded 2026-09-28 against the uncommitted working tree that added
`api/scope-approval.js`, `server-lib/portalScopePricing.js`,
`docs/schema/portal-scope-requests-migration.sql`, and the `invoice.paid`
handler in `api/stripe-webhook.js`. Pre-company, sales-ops — not a customer
join key, but it's the same "unguessable link, looked up directly, not
HMAC-verified" pattern `onboarding_requests.edit_token`/`claim_token`
already use, so it's tracked here rather than invented fresh.

| Side | Where |
|---|---|
| Written | `portal-invoice-handoff` (off-repo, via Supabase MCP) before the client link is sent |
| Read | `api/scope-approval.js:94-98` — `.eq('approval_token', token).maybeSingle()`, GET renders the proposal, POST (gated on `status === 'sent'`, `:111-113`) creates the Stripe customer + invoice |
| Rate-limited | `checkIpThrottle` (`scope-approval.js:91`) — 30/hour/IP, same reasoning as `api/checkout.js`: token secrecy alone isn't the only guard |

**A second key rides along once the client approves: `stripe_invoice_id`.**
Written at `scope-approval.js:146` when the invoice is created and sent;
read back by `api/stripe-webhook.js`'s `notifyPortalScopePaid` — but *not*
by matching on `stripe_invoice_id`. The webhook instead reads
`invoice.metadata.portal_scope_request_id` (set at `scope-approval.js:133`,
read at `stripe-webhook.js:54`) and looks the row up by `id`
(`stripe-webhook.js:57-61`). `stripe_invoice_id` is stored and uniquely
indexed (`portal-scope-requests-migration.sql:53-54`) but nothing reads it
back — the same "written, never read" shape §4b calls out elsewhere on this
page, except here it's not a gap: the metadata id is the more direct key for
a webhook that only ever needs "find this one row," and `stripe_invoice_id`
exists for a human looking the row up from the Stripe side, not for code.
Not filed as a break; noted so the next session doesn't assume the webhook
joins on it.

**Confirmed: `status = 'paid'` does not join to `onboarding_requests` or
`companies`.** `notifyPortalScopePaid` (`stripe-webhook.js:53-78`) only
updates `portal_scope_requests` and sends a Slack/email notification — it
never inserts or touches `onboarding_requests`. CLAUDE.md's own description
of the pipeline says this is deliberate ("Nothing in this pipeline
automates past payment confirmation... document collection and the actual
build stay Dillon's manual work"). See §5 — do not file the missing
`portal_scope_requests` → `onboarding_requests` join as a break; it is a
considered design decision, not a silent gap, at least for now (Company
Portal isn't a checkout-purchasable module yet — `portalScopePricing.js:11-13`
says the monthly fee "would be entered into MODULES... when Portal ships as
a real subscribable module," which is the trigger to re-open this question).

### `platform_events` (founder telemetry; producer side only, by design)
Recorded 2026-09-29 against the **uncommitted** working tree on branch
`platform-events-instrumentation`. Table `platform_events`
(`docs/schema/platform-events-migration.sql:19-27`) is **written and NOT yet
applied to the live DB** (`:36-37`). It is a platform-health log for the
founder dashboard, not a company feature, so it has no doc key and is not
gated (`server-lib/platformEvents.js` has no `requireDocKey`/
`isDocKeyActive` call, and should not; a company must not be able to switch
off the founder's view of the platform).

| Column | Meaning | Join |
|---|---|---|
| `event_type` | `cron_run` / `email_send` / `ai_generation` (`platformEvents.js:17`) | Enforced in the writer, not by a CHECK (`migration:22`, comment only) |
| `status` | `ok`/`error`/`skipped`/`refused`/`rate_limited`/`truncated` (`platformEvents.js:18`) | Same |
| `subtype` | cron name, document type, or AI call site | free text, capped at 60 chars (`platformEvents.js:60`) |
| `company_id` | set only where the writer knows it | **nullable, deliberately not an FK** (`migration:25`), so deleting a company keeps its history. Coerced to an integer or null (`platformEvents.js:61`) |
| `metrics` | counts, tokens, latency only | `sanitizeMetrics` drops objects, arrays and long text (`platformEvents.js:34-45`) |

**Producers (all read in the code, 2026-09-29):**

| Producer | `event_type` | Call site |
|---|---|---|
| `api/cron-equipment-reports.js` | `cron_run` | `:57`, `:120`, `:139` |
| `api/cron-company-brain-summary.js` | `cron_run` | `:41`, `:54` |
| `api/cron-portal-reports.js` | `cron_run` | `:55`, `:62` |
| `server-lib/email.js` `sendEmail` | `email_send` | `:27`, `:45`, `:50`, `:53` (passes `null` client, uses the writer's own service-role fallback, `platformEvents.js:24-29`) |
| `api/generate-flha.js` | `ai_generation` | `:290` (rate limited), `:297` (`record` helper) |
| `api/portal.js` `ai_draft_document` | `ai_generation` | `:244`, `:248` |
| `server-lib/companyBrainSummary.js` | `ai_generation` | `:66`, `:70` |
| `server-lib/onboardingDrafting.js` | `ai_generation` | `:57`, `:61` |

Those are the 4 Anthropic call sites named for this change; the map has not
searched for a fifth (`grep -rn "api.anthropic.com" api/ server-lib/` is the
re-check, and any hit not in the table above is an unmetered AI call).

**Consumer: none yet, on purpose.** Confirmed 2026-09-29:
`grep -rn "platform_events" src/ api/` returns no reader (the only
`from('platform_events')` is the writer's insert, `platformEvents.js:57`).
The Admin Panel reader is planned as phase 3c. This is recorded as a **known
pending link, not a break**; see §4's "Known pending links".

**Privacy contract to keep:** no prompts, outputs, email addresses, subjects,
document content or worker names (`migration:7-11`, `platformEvents.js:8-10`).
A future producer that passes any of those in `metrics` breaks the contract;
`sanitizeMetrics` only stops objects and long strings, not a short name.

### `company_id` (tenancy)
Honoured everywhere. Governed by `tenant-scope-reviewer`, not this map.

### `document_key` → `company_document_settings`
`BUILTIN_DOC_KEYS` (`customforms.js:120`, one line down since #25's import) must exactly equal `ALL_DOC_KEYS`
(`pricing.js:124`). `pricing.js:50-56` states the invariant in a comment;
`tests/unit/doc-key-module-invariant.test.js` enforces it. **This was break #6.**

*Re-check run 2026-09-18 against `2560819`* — both sides **13 keys**, in
agreement:

```
ALL_DOC_KEYS 13  flha,toolbox,incident,nearmiss,inspection,equipment_reports,
                 maintenance,timeclock,daily,certifications,equipment_compliance,
                 fuellog,monthly
BUILTIN      13  flha,inspection,toolbox,nearmiss,incident,daily,monthly,
                 equipment_reports,maintenance,timeclock,fuellog,certifications,
                 equipment_compliance
```

**Deny-by-default, since `edd7a41` (2026-09-18). This is the single most
load-bearing change on this page.** A built-in key with no
`company_document_settings` row used to resolve **active**; it now resolves
**off**:

| Resolution | Where | Rule |
|---|---|---|
| Built-in, supervisor's settings screen | `customforms.js:324` | `settingsMap[key] === true` |
| Built-in, worker's menu | `customforms.js:384` | `settingsMap[key] === true` |
| Custom form, both list handlers | `customforms.js:342,387` | `settingsMap[...] !== false` — still **allow**-by-default |
| Custom form, open + submit *(#25, built `f955ad9`)* | `requireCustomDocKey` (`server-lib/docKeyGate.js:152-167`), called at `customforms.js:483` (`get_active_form`) and `:525` (`submit_custom`) | only an explicit `is_active: false` refuses (403); no row → **allowed**, same as the two list handlers above; lookup error → 503 |
| Weekly equipment report builder | `equipmentreports.js:163-171` | `!!(rows[0].is_active)` |
| Sunday-night cron | `readDocKeySetting`, `server-lib/docKeyGate.js:66-75` (imported `cron-equipment-reports.js:20`) | same, used at `cron-equipment-reports.js:66` (`equipment_reports`) and `:93` (`timeclock`) — re-anchored 2026-09-22; the cron's own resolver at `:40-48` is gone since `89ca755` |

The two defaults are opposite **on purpose** and
`tests/unit/doc-setting-defaults.test.js` (9 cases, all passing 2026-09-18)
exists to stop a later pass "making them consistent": a built-in key is
something a company *buys*, so no decision means not bought; a custom form is
something this company's own admin *built here*, so no decision means they just
made it.

**Who writes a row at all — this is now the reachability question for every
gated surface:**

| Writer | Where | Covers |
|---|---|---|
| Purchase approval, modules bought | `onboardingApproval.js:239-244` → `documentSettingsFor` (`pricing.js:233-240`) | all 13 keys, true for what was bought, explicitly false for the rest |
| Approval with **no** module list (`request.modules` NULL or `[]`) | same ternary, `onboardingApproval.js:239-241` → `allDocumentSettingsOn` (`pricing.js:255-257`) | all 13 keys, all **true** — #20's fix (`c30d995`); wrote nothing at all before |
| Founder creating a company by hand | `api/admin.js:422-424` (`create_company`) → `allDocumentSettingsOn` | all 13 keys, all **true** — #20's fix (`c30d995`); wrote nothing at all before |
| Admin toggle | `customforms.js:348-358` (`set_document_setting`, admin only) | one key at a time |
| Custom form creation | `customforms.js:178-181` | that form's `custom_<id>` key |

`allDocumentSettingsOn` (`pricing.js:255-257`) is `documentSettingsFor(companyId,
MODULE_KEYS)` — derived from the module list rather than a second copy of the
key list, so a module added later is covered without anyone coming back to it.
Verified 2026-09-22 against `c30d995` by calling it: **13 rows, every one
`is_active: true`**, matching `ALL_DOC_KEYS` and `BUILTIN_DOC_KEYS` exactly.

Existing companies were backfilled to their exact effective state before the
default flipped (`docs/schema/equipment-compliance-module-backfill.sql` for the
new key; the three companies' pre-existing gaps in `edd7a41`'s message), so the
flip changed nobody's experience — but that was a one-off data fix, not a code
path. The code path is now the five writers above.

**Two ways a company can still end up with no row**, both narrower than #20 was:
an upsert that fails, and any company provisioned between `edd7a41` and
`c30d995`, which on this branch is none, because `edd7a41` never reached `main`.

The failing-upsert case is told to somebody on one of the two paths and nobody
on the other. `admin.js:425-434` returns a warning and `AdminPanel.jsx:634`
now displays it (break #22, built in `965d812`);
`onboardingApproval.js:245-255` writes `console.error` and carries on, which
reaches a server log and no human — deliberately non-fatal, because failing an
approval would leave a paid customer with no account at all.

**The rows exist for every company today, and deny-by-default is only safe
because they do.** Queried live against the FORA Supabase project on
2026-09-22, before `48d5889` was pushed, **by the session that built it** (not
by Dillon — who ran a check is part of being able to re-run it): **all three
companies carry an explicit `company_document_settings` row for every one of
the 13 built-in keys — none missing, none with zero rows.** That check is the
precondition for the server-side gate below; a company with a gap would now be
refused by the API, not merely shown fewer tabs. This map pass did not re-run
the query itself — it has no database access — so it is recorded with its date
and its author, for the next session to re-run rather than assume.

**The client's default is still the old one, and it no longer decides
anything.** `isDocActive` (`Dashboard.jsx:2776-2779`) returns `true` when the
key is not in the loaded payload — *"not loaded yet / unknown key → default to
shown"*. Harmless for a known key, because `get_document_settings` returns an
entry for all 13 built-ins whether or not a row exists
(`customforms.js:320-325`); it means a failed or pending settings load still
shows every tab. Until `48d5889` that fail-open browser check **was** the whole
gate (break #21). It is now presentation only: the handler behind the tab
refuses independently.

#### Server-side enforcement — `server-lib/docKeyGate.js` (`48d5889`)

One shared, deny-by-default gate, and **both** previous copies of
`isDocKeyActive` were deleted rather than left beside it — the duplicate-helper
shape break #1 exists to warn about is resolved here, not made worse.
`api/equipmentreports.js:17` and `api/cron-equipment-reports.js:20` now import
it; neither defines its own.

| Piece | Where | Rule |
|---|---|---|
| Key → module | `docKeyGate.js:33-35` | `MODULE_BY_DOC_KEY`, derived by flattening `MODULES[k].docKeys` from `pricing.js`, so a module added there is covered without anyone coming back |
| Customer-facing name | `docKeyGate.js:43-46` | `moduleLabelForDocKey` — the 403 says "Fuel & Consumables", not `fuellog` |
| The raw read | `docKeyGate.js:66-76` | missing row → off; `is_active: false` → off; read error → off **and** flagged `unavailable` |
| Report/cron use | `docKeyGate.js:84-87` | `isDocKeyActive` — denies on a read error too; skipping a company's weekly PDF is the cheap failure. Its one remaining caller is `equipmentreports.js:600` (the compliance section); the cron moved onto `readDocKeySetting` in `89ca755` so it can tell "not bought" from "couldn't check" in its own log — `reason: 'deactivated'` vs `'settings_unavailable'` (`cron-equipment-reports.js:67,94`) |
| The handler guard | `docKeyGate.js:111-135` | `requireDocKey` → `null` to proceed, `{status, error}` to return verbatim |
| The custom-form guard *(#25, `f955ad9`)* | `docKeyGate.js:152-167` | `requireCustomDocKey` — **allow**-by-default, the deliberate opposite of `requireDocKey`; same 401 / admin-exempt / 403-vs-503 contract. Not built on `MODULE_BY_DOC_KEY`, because a `custom_<id>` key belongs to no module |
| No session / no company | `docKeyGate.js:112,123` | **401**, not 403 — an auth failure is not a billing one, and 403 now means DROP to a queued submit. Added in `89ca755`; not reachable today, a guard against the shape |

**403 vs 503 is the load-bearing distinction, and it is why step 1 had to land
first.** A hard no is `403`; a *failed lookup* is `503`
(`docKeyGate.js:126-133`, renumbered by `89ca755`). To a queued submit a 403
now means DROP
(`src/offlineQueue.js:194`), so answering a five-second database blip with 403
would delete a worker's shift. Pinned by
`tests/unit/module-gate.test.js:94` and `tests/unit/offline-queue-drain.test.js:126`.

**Admin is exempt** (`docKeyGate.js:113`), on purpose: that session is the
founder, not a customer — there is no customer admin role — and the Admin Panel
reads across every company at once. The boundary this closes is the customer's
own supervisor and worker sessions, which is exactly who break #21 named.

**Where the 51 guards are** — 41 in `48d5889`, four more in `89ca755`, six
more in `ac80f96` (break #23), all verified 2026-09-22
(`grep -rn "await requireDocKey(" api/ | wc -l` → **51** at `ac80f96`; the
same count via `git grep` at `57efbeb` → **45**):

| File | Guards | Doc key | Actions |
|---|---|---|---|
| `api/logs.js` | 8 (`:311,340,586,599,624,679,697,713`) | `table.docKey` — `inspection` `:120`, `toolbox` `:126`, `daily` `:132` | `check_equipment`, `submit`, `list`, `delete`, `update`, `list_open_toolbox`, `get_toolbox_detail`, `sign_late_toolbox` |
| `api/certifications.js` | 6 (`:143,160,197,247,299,351`) | `certifications` | upload url, add, list, `list_employee_directory`, `certification_summary`, delete |
| `api/flhas.js` | 6 (`:244,273,439,462,523,542`) | `flha` | `resume`, `submit`, `list`, `update`, `delete`, `approve` |
| `api/monthly.js` | 5 (`:240,283,488,540,587`) | `monthly` | `get_active_form`, `submit_monthly`, `list_records`, `get_record_detail`, `update_record` |
| `api/reports.js` | 5 (`:208,339,356,398,442`) | `table.docKey` — `incident` `:116`, `nearmiss` `:122` | `submit`, `list`, `review`, `update`, `delete` |
| `api/companydata.js` | 10 — 4 (`:1065,1114,1183,1231`) + 6 added in `ac80f96` (re-anchored at `42ed3c7`) | `equipment_compliance` ×4; `maintenance` ×1 (`:1253`); `timeclock` ×5 (`:1486,1578,1610,1638,1698`) | the four compliance actions (the ones #19 gated in the UI only); `set_equipment_pm_interval`; `clock_in`, `edit_time_entry`, `add_time_entry`, `delete_time_entry`, `generate_time_report_now` |
| `api/maintenance.js` | 4 (`:130,247,327,396`) | `maintenance` | `list_status`, `log_field_service`, `log_service`, `list_records` |
| `api/fuellogs.js` | 3 (`:116,156,240`) | `fuellog` | `check_equipment`, `submit`, `list` — every action in the file |
| `api/equipmentreports.js` | 4 (`:666,683,714,763`), added in `89ca755` | `equipment_reports`; **`inspection`** for `list_weekly_hours` | `list_reports`, `get_report`, `generate_now`, `list_weekly_hours` |

**Deliberately NOT gated, so a later sweep does not read these as misses:**

| Left open | Where | Why |
|---|---|---|
| The five wallet self-service actions | `api/certifications.js:390,400,414,423,434` (`update_own_profile`, `set_own_pin`, `create_photo_upload_url`, `set_profile_photo`, `complete_onboarding`); reasoning at `:382-389` | These are the **roster**, not Certification Tracking — name, PIN, photo, "I'm done". The roster is platform base every company pays for, so gating them would stop a company without cert tracking from onboarding anyone. The cert-upload half of the same screen **is** gated (`:143`) |
| `list_corrective_actions` / `update_corrective_action` | `api/monthly.js:681,865`; reasoning at `:661-667` (immediately above `list_corrective_actions`) | Polymorphic since break #5 — an action can come from an incident, a near miss or a failed inspection. Gating them on `monthly` would hide a company's incident follow-ups behind a module it may never have bought. Still scoped by company and role |
| Admin-only actions | `docKeyGate.js:113` | The founder is on the other side of the paid boundary; gating them would break the console that decides what a company is sold |
| `create_upload_url` | `api/logs.js:288-293`, `api/reports.js:187`, `api/flhas.js:235`, `api/monthly.js:122`, `api/customforms.js:138` | It mints a signed upload slot inside the caller's own company namespace and runs **before the record type is known**, so there is no doc key to check. The submit that would use the file is gated, which is where a company without the module is stopped |
| `clock_out`, `my_time_status` | `api/companydata.js:1504,1525`; reasoning at `:1474-1484` (re-anchored at `1301c76`) | **Dillon's decision on #23 (2026-09-22, `ac80f96`).** A shift that was open when the company dropped Time Clock + GPS must always be closable, and the clock-out screen needs `my_time_status` to find the open shift. Gating `clock_out` would leave that entry open forever. Pinned by `tests/unit/timeclock-gate.test.js:156,161`. *Reached from the UI as of `98f9d70` (#27, built): the worker's Time Clock card stays while `my_time_status` reports an open shift (`src/WorkerMenu.jsx:137-150,272-273`) and opens a clock-out-only screen (`src/TimeClock.jsx:157`); a supervisor's own open shift keeps its Clock Out button on the read-only tab (`src/Dashboard.jsx:6720`, re-anchored at `42ed3c7`).* |
| `list_time_entries`, `list_time_reports`, `get_time_report` | `api/companydata.js:1544,1652,1677`; same reasoning block | **Dillon's decision on #23.** Recorded hours are payroll records and stay readable after a company cancels the module. Reads only — every write and `generate_time_report_now` are gated. Pinned by `tests/unit/timeclock-gate.test.js:170,176`; `list_time_reports` now also returns `latestEntryAt`, the newest `time_clock_entries.clock_in` for the resolved company (`companydata.js:1662-1673`), pinned company-scoped by `:206`. *Reached from the UI as of `98f9d70` (#27, built): the Time Clock tab stays, read-only, for a company without the module that has any report, any recorded entry in any week (`latestEntryAt`), or the viewer's own open shift (`src/Dashboard.jsx:2830,3299-3324`). Since `b0411b1` the tab pages through past weeks — `list_time_entries` sends `weekStart` (`:3045`), Previous / Next / This week at `:6679-6696` — so a week that never became a report stays readable; the current-week-only residual is closed. See #27.* |

**`custom_<id>` documents are gated as of `f955ad9` — #25, built, not closed.**
Two `requireCustomDocKey` calls (`customforms.js:483,525`), **not** counted in
the 51 above, which counts `requireDocKey` only (`grep -rn "await requireDocKey(" api/ | wc -l`
→ 51 at `42ed3c7`; `grep -rn "requireCustomDocKey(" api/ | wc -l` → 2). The
time-clock and PM-interval half (#23) is built as of `ac80f96`; see the table
above for the six guards and the carve-outs.

**Weekly Hours gates on `inspection`, not `equipment_reports`, and that is not a
slip** (`equipmentreports.js:763`): it is folded from inspection readings
(`foldWeeklyUsage`, `:300`) and the Dashboard sub-tab gates it on
`inspectionsEnabled` (`Dashboard.jsx:2868`), so `equipment_reports` there would
lock out a company that bought Equipment Inspections and not the weekly report.
The surface table in §1 has said `inspection` for Weekly Hours since it was
added; the server now agrees with it.

**Engine documents carry a third key shape, `engine_<definitionId>` (WP7c-2 branch, 2026-10-09).** It is a document key in four places and they must agree: `engineKey` (`notify.js:30`) for notifications (CHECK widened by the WP3 migration, live, break #51), `engineDocKey` / `ENGINE_KEY_RE` (`companyDocs.js:8-9`) for the assignment and auditor pickers, `isAssignableKey` (`documentAccess.js:61`) for assignments (**table CHECK not widened, break #53**), and `audit.js:149` for the auditor's scope. It has no `company_document_settings` row and no `BUILTIN_DOC_KEYS` / `pricing.js` entry: the switch is `company_documents.is_enabled` (`service.js:569`), by design (§5 and the engine section).

### `document_assignments.document_key` + `sites.division_id` + `roster.hide_unassigned` (who may submit or view which document; branches `claude/assignments-enforcement` `ae9aee4`, then `claude/assignments-ui` `e8ccde0`, placed 2026-10-06)

**Tasks versus restrictions, 2026-10-06 (`17b85e6`, branch `claude/assignments-ui`; the Crew lead section below is on `claude/lead-role`, `507c7cc`, which sits on top of it).** An assignment row now carries `restricts boolean not null default false` (`docs/schema/document-assignments-migration.sql:50`). **A TASK (`restricts = false`, the default) puts the document on the person's "Assigned to you" list with a due date and narrows nothing for anyone.** Only a restricting row narrows: `evaluateAccess` keeps `active.filter(isRestricting)` and returns `narrowed: false, allowed: true` when none are left (`server-lib/documentAccess.js:223`; `isRestricting` is `row.restricts !== false` at `:228-230`, so a row with no `restricts` field, from before the switch, still restricts). **`view` rows always restrict**: the writer forces `restricts = true` for a view (`server-lib/assignmentAdmin.js:125`) and the migration CHECK refuses a non-restricting view (now the named constraint `document_assignments_view_restricts`, `migration.sql:79-80`, `check (action = 'submit' or restricts)`). A submit row is a task unless the request carries `restricts === true` exactly (`assignmentAdmin.js:125`); the Owner screen sends it from a "Just a task / Only these people can use it" select, default task (`src/DocumentAssignmentsManager.jsx`, `useState(false)` for `restricts`, sent in the create call; a view always sends `true`). The Owner list returns `restricts` per row (`api/companydata.js:1387`, `assignmentAdmin.js:149`) and "Reaches nobody" turns red only for a restricting row (screen-side). Two knock-ons, both read in code: (1) **the hide-unassigned path counts an Owner's task, not a lead's** (changed 2026-10-06 on `claude/auditor-role`, replaces the earlier "task names a flagged person just as a restriction does"): `evaluateAccess` now runs the restricting check FIRST (`documentAccess.js:210-213`) and only then the hide switch, which lets a flagged person through on an active submit row that names them **and is not `by_lead`** (`:220-222`, `r.by_lead !== true`); `by_lead` is read by `readAssignmentRows` with a retry without the column on `42703` (`:232-240`); (2) **`menuAccessFor` builds the "Assigned to you" entry from every submit row naming the person, tasks and restrictions alike** (`:298-306`, no `isRestricting` filter), so a restricting assignment also lists first, with its due date. **The delete refusals count restricting rows only**: `assignmentsNamingAudience` selects `restricts` and returns `(data || []).filter((r) => r.restricts !== false)` (`assignmentAdmin.js:168,179`), so deleting a department, division or site that only a task names goes through (the task then reaches nobody and costs nothing, comment `:176-178`). `delete_department` / `delete_division` / `delete_site` are unchanged and still call it (see the "Audience deleted" row below).

**Hazard CLOSED in the migration file, 2026-10-06 (`claude/auditor-role`): the `restricts` column used to be added by editing `create table if not exists` in place.** `docs/schema/document-assignments-migration.sql` now carries a catch-up `alter table public.document_assignments add column if not exists restricts boolean not null default false` (`:71-72`) and adds the view-restricts check as a named constraint, created only when `pg_constraint` has no `document_assignments_view_restricts` (`:73-82`; the inline `check (action = 'submit' or restricts)` was removed from the `create table`, comment `:63-64`), so a fresh install and a catch-up end identical and re-running the file is safe. `grep -n "restricts\|view_restricts\|alter table" docs/schema/document-assignments-migration.sql` returns `:50` (column in the create), `:71-72`, `:77-80`, plus the RLS and `sites` alters. **The silent shape is still real for a database that skipped the re-run**: every read selects `restricts` (`documentAccess.js:238`), `42703` is a missing-schema code (`isMissingSchema`, `:71-74`), so `readAssignmentRows` returns no rows after its by_lead retry also fails, and every assignment silently stops narrowing; create and `lead_assign_task` would 500. Check on any live database before trusting an assignment: `select column_name from information_schema.columns where table_schema='public' and table_name='document_assignments' and column_name in ('restricts','by_lead');` (two rows expected once both migrations have run). Live state of the table is `?` (the map has recorded the migration as not applied). Not a numbered break: nothing is known to be live.

**Re-anchored 2026-10-06 against `507c7cc` (shift table).** `17b85e6` and `507c7cc` moved lines in the files cited below; the citations in the rest of this section, in the matrix block after it, and in the #45-#48 text were written against `e8ccde0` / `c8499af`. New line = old line plus: `server-lib/documentAccess.js` old 1-120 +0, 121-159 +1 to +3, 160-204 +6 to +7, 205-239 +17, 241-455 +20, 456 and later +36 (check: `allowedKeys` unconditional `:269` is now `:289`, `recordInScope` `:294-307` is now `:315-328`, `withCompletion` `:434-454` is now `:455-475`); `api/companydata.js` old 1-1015 +0, 1016-1126 +1, 1127-1445 +12, 1446-1462 +93, 1463 and later +94 (check: `delete_department` and `delete_division` call `assignmentsNamingAudience` at `:1310` and `:1354`, `delete_site` at `:1615`; the assignment handlers are one block from `:1375`, `list_document_assignments` `:1383`, `end_document_assignment` `:1427`, `set_site_division` `:1438`); `api/flhas.js` +1 to old 464, +5 for old 465-572 (edit `:507` is now `:512`, delete `:563` is now `:568`, list `listVisibleRecords` `:474` is now `:479`), +9 after (approve `requireRecordsAccess` `:584` is now `:593`); `api/logs.js` +1 for old 17-368, +13 for old 369-457 (submit `requireAssignment` `:369` is now `:382`), +14 after (insert `:458` is now `:471`); `api/fuellogs.js` +1 to old 165, +12 after (submit `requireAssignment` `:166` is now `:178`, insert `:234` is now `:246`); `server-lib/assignmentAdmin.js` old 122+ +4 to +6 (`assignmentsNamingAudience` `:160-173` is now `:165-180`); `api/customforms.js` +1 for old 11-423 (the `assigned` return `:407` is now `:408`), +83 after `:424`. Where this section is touched in the 2026-10-06 `17b85e6` / `507c7cc` pass the line is the current one; otherwise apply the table.

**Re-anchored 2026-10-06 against `e8ccde0`.** That commit added 79 lines to `server-lib/documentAccess.js`, so every `documentAccess.js:N` below is the current line; older entries elsewhere in the map that cite `documentAccess.js` lines (the #45-#48 text, P2, P3, §5) are re-anchored where they are touched and otherwise may be off by 5 to 54 lines. It also added 110 lines to `api/companydata.js` (all after `:1013`), so `companydata.js` citations below `:1013` elsewhere in the map may be off by up to 99.

**Migration NOT applied to the live DB** (`docs/schema/document-assignments-migration.sql:3`, Dillon runs it by hand). **? Live state not verified by this pass.** Until it is applied, every read tolerates the missing table or column and behaves as before (`server-lib/documentAccess.js:71-74` the missing-schema codes, `:215` the assignments read, `:145` the `sites.division_id` read), so shipping the code ahead of the SQL narrows nothing. **The Owner screens added in `e8ccde0` tolerate it too, and say so:** `list_document_assignments` returns `needsSetup: true` when the table is missing (`api/companydata.js:1379,1386`), create / end return a "not switched on for this database yet" message (`:1369,1398,1409,1420`), `set_site_division` does the same on a missing `division_id` column (`:1440`). (Re-anchored 2026-10-06 against the committed head after `c8499af`, which moved `companydata.js` lines by +7 to +17.) `roster.hide_unassigned` is a second migration, also **not applied live** (`docs/schema/roster-hide-unassigned-migration.sql:14`, `?` live state); `loadActor` retries without the column when it is missing (`documentAccess.js:120-131`).

**The table.** One row = "this audience may `submit` or `view` this document". `document_key` is the same key space as `company_document_settings` plus the `portal_<id>` prefix (`migration.sql:13-15,36-49`); `audience_type` is `everyone|role|department|division|site|individual` with `audience_value` text (NULL only for `everyone`, check at `:48`); `due_at`; soft end `ended_at`. A row can only narrow, never widen past `requireDocKey` (`documentAccess.js:6-12`); no active RESTRICTING rows for a document and action means unchanged behaviour (re-read 2026-10-06 against `507c7cc`: `documentAccess.js:216-218`; a task row does not count, see "Tasks versus restrictions" above), **except** for a person the Owner flagged `hide_unassigned`, below. Departments and divisions are tags, not locks, until a row names them.

**Who is exempt.** Founder session (admin, or master code, no `userId`) at `documentAccess.js:42-44,115-116,238`; Account Owner is `roster.is_owner === true && role === 'supervisor'`, read from the roster row on every call (`:151`), not the token. The assignment writers are Owner or founder only: `canManageCompany(session)` at `api/companydata.js:1365` (departments and divisions: `:1261`).

**Audience match** (`documentAccess.js:166-176`, `matchesAudience`, now exported and reused by the Owner screen's "reaches N people" count at `server-lib/assignmentAdmin.js:147`): `role` against `roster.role`; `department` against `roster.departments`; `division` against `roster.divisions`; `site` against the actor's site set; `individual` against `roster.id`. The actor's site set is `roster.default_site_id` plus every `sites.id` whose `division_id` is in the person's `roster.divisions` (`:136-147`).

**Hide-unassigned (`roster.hide_unassigned`, new in `e8ccde0`).** Read by `loadActor` into `actor.hideUnassigned` (`documentAccess.js:127,160`). In `evaluateAccess`, a flagged person on a `submit` is allowed only if an active row names them **that a crew lead did not create**, even when the document has no rows at all (`documentAccess.js:220-222`, after the restricting check at `:210-213`; re-read 2026-10-06, the earlier cites `:202-206` are stale); `view` is untouched (the branch is `action === SUBMIT` only). Because every submit handler, `check_equipment` and `get_active_form` lookup, and the worker menu already go through `requireAssignment` / `menuAccessFor`, the switch is enforced everywhere those are. Set by `update_worker_profile` `hideUnassigned` (boolean only, `api/companydata.js:1123-1126`), which sits in the `structural` list, so a non-Owner gets 403 (`:1047-1051`); **cleared automatically when someone becomes an Owner**, because the switch does nothing on an Owner and a later demotion would otherwise silently hide every document from them: `update_worker_profile` writes `hide_unassigned = false` when `makeOwner` is true, the request did not itself carry `hideUnassigned`, and `readHideUnassigned` says it is currently on (`:1104-1110`; the read-first keeps a database without the column from being asked to write it); read back for the profile screen by `readHideUnassigned` (`:1015`, `documentAccess.js:406-411`, false when the column is missing); toggled in `src/WorkerProfileDrawer.jsx:168` and sent only when changed (`src/Dashboard.jsx:3567-3569`). **Limit, verified:** it covers only the eight enforced built-ins plus custom and Portal documents. `menuAccessFor` puts every non-assignable key in `allowedKeys` unconditionally (`documentAccess.js:269`), so a flagged person still sees Time Clock, Certifications, Equipment Reports, Maintenance and Equipment Compliance cards, and those handlers are not wrapped (§5). "Hide everything I haven't assigned" is therefore not literally everything. Also: with the assignments table missing the read returns no rows (`:215`), so a flagged person sees **no** assignable documents rather than all of them.

| Join | Producer | Consumer | State |
|---|---|---|---|
| `document_assignments` rows | **(`restricts` is written on every row: Owner screen `src/DocumentAssignmentsManager.jsx:95`, validator `assignmentAdmin.js:125`, insert `companydata.js:1418-1419` via `{ ...r }`, audit detail `:1423`; and `lead_assign_task` writes `restricts: false` rows with `created_by` = the lead, see the Crew lead section below.)** `create_document_assignment` insert (`api/companydata.js:1405-1406`), validated by `validateAssignment` (`server-lib/assignmentAdmin.js:75-123`: assignable key and action `:79`, document belongs to the company `:86-88`, department / division / site / person checked against the company `:95-115`, due date only on submit `:120`); soft end by `end_document_assignment` (`companydata.js:1418-1419`, company-scoped, `:1419`); **no cascade end: deleting a department, division or site that an active row names is refused, below**; listed with a live "reaches N" count by `list_document_assignments` (`:1371-1389`) | `readAssignmentRows` (`documentAccess.js:208-219`); screen `src/DocumentAssignmentsManager.jsx:50,89,103`, mounted for Owners in `src/Dashboard.jsx:7881` (`canManageCompany`) | ✅ **#45 CLOSED in code on `e8ccde0`** (branch, not merged; migration not applied, `?`) |
| `sites.division_id` -> `company_divisions.id` | `set_site_division` (`api/companydata.js:1426-1444`): site checked against the company `:1429`, division through `sanitizeDivisionIds` `:1433` (null clears), written at `:1437`; "Sites by division" in `src/CompanyStructureManager.jsx:88-104` (`:99` sends the action); listed back as `divisionId` (`companydata.js:1217,1229`) | `loadActor` (`documentAccess.js:139-147`), `describeAssignments` (`assignmentAdmin.js:136`) | ✅ **#46 CLOSED in code on `e8ccde0`**. Site **creation** still writes no division (`companydata.js:1483`, onboarding `server-lib/onboardingApproval.js:293`); a new site starts with none until the Owner sets one, by design of the screen |
| Audience deleted while an assignment names it -> delete REFUSED | `assignmentsNamingAudience` (`server-lib/assignmentAdmin.js:160-173`: active rows, `ended_at` null, for one audience type and value; a missing table returns no rows `:169`, any other read error returns `error: true` `:170`), called from `delete_department` (`api/companydata.js:1298-1302`, 409), `delete_division` (`:1342-1346`, 409) and `delete_site` (`:1521-1523`, folded into the 400 blockers list at `:1537-1541` with the filed-records blockers); a failed check returns 500 and nothing is deleted (`:1299,1343,1522`). **Nothing is ended automatically**: ending the rows would leave the document with no rows, which means not narrowed, so it would silently open to everyone (comment `assignmentAdmin.js:151-158`). `endAssignmentsForAudience` no longer exists (`grep -rn endAssignmentsForAudience api server-lib src` is empty) | the Owner, who must end the assignment first through `end_document_assignment` (`companydata.js:1415-1424`); `delete_department` / `delete_division` also run their own existing blockers first (`:1294-1297`) | ✅ as committed after `c8499af`, **narrowed by `17b85e6` to restricting rows only** (`assignmentAdmin.js:168,179`; a task never blocks a delete, see "Tasks versus restrictions" above) (replaces the `e8ccde0` cascade end, which this map recorded on 2026-10-06 and which no longer exists). Weak link, not a break: the 409 text sends the Owner to Document assignments, so it depends on that screen being mounted (`src/Dashboard.jsx:7881`). **No cascade and no block for `individual`**: a person who is deactivated (`companydata.js:585`) keeps their `individual` rows, but they cannot log in, so nothing is narrowed for anyone else; an `individual` row for a person the Owner reactivates simply applies again |
| `roster.divisions` | `companydata.js:1004-1007` (P2) | `documentAccess.js:105,138,260` | ✅ the "no consumer" note in P2 is stale as of this branch |
| `roster.departments` | §2 `roster.departments` | `documentAccess.js:124,137,259` | ✅ |
| `roster.default_site_id` | `companydata.js:1009-1012` | `documentAccess.js:107` | ✅ |
| `submitted_by_roster_id` (author) | break #3 stamp | `recordInScope` author rule (`documentAccess.js:251-263`, default `authorKey`) | ✅ for the seven handlers below; null on pre-stamp rows (only a site or a shared tag can place them) |
| `site_id` on the record | break #2 FK users | `recordInScope` site rule (`documentAccess.js:254-255`) | ✅ where the column exists; **`inspections` has none** and is placed by author only (`api/logs.js:125-131`) |
| `body.queuedAt` | `queuedAtFor(clientSubmissionId)` (`src/offlineQueue.js:209-211`) reads the replay time set per queued entry (`:257-263`, `createdAt` of the queue item), and every form's request builder sends it: `src/App.jsx:46`, `CustomForm.jsx:34`, `DailyReport.jsx:40`, `FuelLog.jsx:36`, `Incident.jsx:126`, `Inspection.jsx:87`, `MonthlyInspection.jsx:35`, `NearMiss.jsx:54`, `PortalDocumentForm.jsx:70`, `ToolboxTalk.jsx:37` (`undefined` on a live submit) | `queuedAsOf` (`documentAccess.js:84-87`, needs a `clientSubmissionId` too) then `clampAsOf` (`:90-97`, 48h), passed at `flhas.js:283`, `logs.js:365`, `reports.js:216`, `monthly.js:291`, `customforms.js:566`, `fuellogs.js:164`, `portal.js:558` | ✅ client side sent (**P3 closed**); the 48h reach-back on a handcrafted request remains, see the weak link under #48 |
| Worker menu `assigned` entries (`dueAt`, `completedAt`) | **(`17b85e6`: tasks and restrictions both land here, `documentAccess.js:298-306`; a task is the only thing that does so without narrowing.)** `menuAccessFor` builds `{ documentKey, dueAt (earliest), since }` from the submit rows naming the person (`documentAccess.js:277-285`); `withCompletion` adds `completedAt` (`:434-454`) | `get_worker_documents` returns `assigned` (`api/customforms.js:407`; `[]` on a read failure `:409`), `get_worker_portal_documents` returns it (`api/portal.js:489`; `[]` on failure `:486`); rendered first as "Assigned to you" in `src/WorkerMenu.jsx:328-370,622-640` (state set from `data.assigned` at `:116,137`) | ✅ |
| `completedAt` (derived, never stored) | latest row by `submitted_by_roster_id = session.userId` created at or after the assignment began (`documentAccess.js:441-448`), per document table (`:416-425`; custom `custom_form_records` `:441`, Portal `portal_records` `:442`) | same function | ✅ for the 8 built-ins, custom and Portal. **An anonymous near miss can never show as done:** `authorRosterId` returns null for an anonymous report (`server-lib/authorStamp.js:35-36`, used at `api/reports.js:294`) so the `eq('submitted_by_roster_id', ...)` at `documentAccess.js:448` never matches it. Same for any pre-stamp row. Errors leave `completedAt` null (`:450-452`). Completion is by author stamp, so a record filed by someone else for the assignee does not count, **with one exception added on `507c7cc`:** a Daily Report or Fuel Log a crew lead fills in for the assignee carries the assignee as author (`submitted_by_roster_id` is the derived session's `userId`, `api/logs.js:471`, `api/fuellogs.js:246`, derived at `server-lib/leadAccess.js:81`), so it does complete their task (`withCompletion` filters on that column, `documentAccess.js:469` after the shift; the lead's `entered_by_roster_id` is not consulted) |

**Where it is enforced** (submit = `requireAssignment(..., SUBMIT)`; the rest = `view` rows then supervisor rule A through `requireRecordsAccess` / `listVisibleRecords*`):

| Surface | Submit | List | Detail / edit / delete / review / approve |
|---|---|---|---|
| FLHA | `flhas.js:283` | `:474` | edit `:507`, delete `:563`, approve `:584` |
| Equipment Inspection, Toolbox, Daily (`logs.js`, `docKey` at `:136,142,148`) | `:369`; pre-trip lookup `check_equipment` `:338`; `list_open_toolbox` `:755`; worker late-sign `:858-859` | `:648`; `list_open_toolbox` supervisor branch `:770-774` | detail `:793-795` (worker held to submit, supervisor to record scope; `supervisor_notes_json` dropped for a worker `:799`), late-sign supervisor `:860`, notes `:827`, delete / edit via `requireRecordsAccess` |
| Incident, Near Miss (`reports.js`, `docKey` `:122,128`) | `:216` | `:356` | review `:379`, edit `:423`, delete `:469` |
| Monthly Inspection | `:293`; `get_active_form` `:248` | `:517` | detail `:567`, edit `:618` |
| Custom Documents | `:519` (get_active_form), `:566` (submit) | `:658` (per-form `custom_<id>` view rows) | detail `:693`, edit `:735` |
| Fuel Log | `:166`; `check_equipment` `:124` | `:307` (burn rates computed from every row first, `:300-303`) | no edit or delete action exists (`fuellogs.js:120,160,247` are the only actions) |
| Corrective Actions (`monthly.js`) | none (an action is raised, not submitted) | `list_corrective_actions` `:713`, `listVisibleRecordsMulti` `:900-903` by the source record's document key, site and author (**#48, PR #200, not merged**) | `update_corrective_action` `:915`, `requireActionAccess` `:931` (supervisors; Owner and founder bypass; an orphan action is Owner-only) |
| Company Portal | `:557` (submit_portal); `:507` (get_active_portal_document) | department routing, then rule A: `scopeRecords` `portal.js:779` (**#47, closed in PR #199**; no `view` row consulted, deliberate) | department check, then `requireRecordScope`: detail `:831`, update / delete via `loadManageableRecord` `:1125` (used `:1135,1182`), email `:1353` |

**Supervisor scope, rule A** (`documentAccess.js:13-17`, `recordInScope` `:294-307`): a non-Owner supervisor's record is in scope if they authored it, it sits at one of their sites, or its author shares a department or a division with them. A supervisor with no tags set sees only their own submissions (`:16-17`). `scopeRecords` is applied to supervisor-tier handlers only; a worker is never narrowed by a `view` row (`:239`). Read errors fail closed with 503 so the offline queue retries (`:39-40,241,245,335`).

**Which keys may carry a row** (`documentAccess.js:50-62`, re-read 2026-10-09 on the WP7c-2 branch): `ENFORCED_BUILTIN_KEYS` (8 of the 13 `BUILTIN_DOC_KEYS`, `customforms.js:126`) plus `custom_<n>` and `portal_<n>` (`documentAccess.js:59-61`) and, on the WP7c-2 branch, `engine_<n>` (`documentAccess.js:61`, with both submit and view allowed, `:67-71`; **but the table CHECK has not been widened, break #53**); a `portal_<n>` **view** row is refused by `isAssignableAction` (`:65-69`) and by the migration CHECK (`document-assignments-migration.sql:55`), and `document_key` itself is now CHECK-limited to the enforced set (`:53`). `isAssignableAction` is now called by `validateAssignment` (`server-lib/assignmentAdmin.js:79`), so for built-ins, custom and Portal keys the Owner screen cannot create a row the CHECK would refuse (**not true for `engine_<n>` on the WP7c-2 branch, break #53**); the screen's document list is built from the company's switched-on built-ins, active custom forms, active Portal documents and (WP7c-2) switched-on published engine documents (`assignmentAdmin.js:42-62`, Portal marked submit-only `:60`, engine `:62`). The five left out (`equipment_reports`, `maintenance`, `timeclock`, `certifications`, `equipment_compliance`) are in §5 as a deliberate non-connection, because a row on them would hide a menu card while the handler still answered (the break #21 shape).

### `roster.is_lead` + `entered_by_roster_id` (the crew lead; branch `claude/lead-role`, `507c7cc`, on top of `claude/assignments-ui`; placed 2026-10-06)

**Re-placed 2026-10-06 against branch `claude/auditor-role` (head `46553fb`), which carries the review follow-ups this section's first version (`507c7cc`) listed as uncommitted:** a crew-only filter (`crewIdSet`, `server-lib/leadAccess.js:78-88`) on the FLHA list and `get_crew_documents`, a stricter FLHA approve, `document_assignments.by_lead` and the hide-unassigned fix, and a target-access check in `lead_assign_task`. Weak points W-L4, W-L5 and W-L6 below are rewritten as CLOSED accordingly. Line numbers in the paragraphs and table below that this pass did not touch were written against `507c7cc`; `api/companydata.js` has since gained the auditor block (`:1473-1590`) and small seat-count edits, so treat those cites as off by up to about 130 lines (anchors now: `get_my_crew` `:1596`, the three `lead_*` task actions `:1609`, `lead_assign_task` `:1629`, `list_document_assignments` `:1392`, `end_document_assignment` `:1436`, `update_worker_profile` structural list `:1055`, `isLead` write `:1137-1146`).

**Migration NOT applied live** (`docs/schema/roster-lead-migration.sql:3`, `?` live state). Adds `roster.is_lead boolean not null default false` (`:19-20`), **`document_assignments.by_lead boolean not null default false` (`:22-27`, new 2026-10-06; it needs the assignments migration to have run first, since it alters that table)**, `daily_reports.entered_by_roster_id` and `fuel_logs.entered_by_roster_id`, each `bigint references roster(id) on delete set null`. Every reader tolerates the columns missing: `loadActor` retries its roster read without `is_lead` (`server-lib/documentAccess.js:125-135`, three attempts, `42703` handled by `isMissingSchema` `:71-74`), `get_crew_documents` retries without `entered_by_roster_id` (`api/customforms.js:453-457`), and the on-behalf insert only adds `entered_by_roster_id` when `session.enteredBy` is set (`api/logs.js:471`, `api/fuellogs.js:246`), so ordinary submits never name the column. **`by_lead` is tolerated on read** (`documentAccess.js:232-240`, retry on `42703`) **but not on write**: `lead_assign_task` inserts `by_lead: true` (`api/companydata.js:1655`), so with `is_lead` present and `by_lead` missing the insert fails with the generic "Couldn't save the task." 500 (`missingTable` covers only `42P01` / `PGRST205`, `:1651-1654`). Reachable only if the lead migration was run in a version before `by_lead` was added; re-running the file adds it. **With the column missing nobody is a lead**, so the whole feature is invisible rather than broken; the one write that fails is the Owner ticking the box (`update_worker_profile` writes `is_lead`, `companydata.js:1133`, answered as the generic 500 "Couldn't save those changes."). Small seam: the `loadActor` fallback order is `hide_unassigned, is_lead` then `hide_unassigned` alone then neither (`documentAccess.js:128`), so a database that has `is_lead` but not `hide_unassigned` loses the lead flag in enforcement while `readRosterFlags` (`:482-491`, one column at a time) still shows it on the profile screen. Not reachable if the migrations are run in the stated order (`migration.sql:3-4`).

**What a lead is.** Not a new role: a `worker` row with `is_lead = true`, read live from the roster on every call, never from the token (`documentAccess.js:166`, `isLead: r.is_lead === true && r.role === 'worker'`; `leadAccess.js:27-33`, `requireLead` needs a `userId`, answers 503 on a failed read and 403 "Only a crew lead can do that." otherwise). Every `role === 'worker'` test elsewhere is untouched (header comment `leadAccess.js:3-5`). A lead is a worker for the seat cap and signs in as one (`:13`; the seat cap itself was not re-read by this pass, `?`).

**Crew** (`server-lib/leadAccess.js:36-58`): `inCrew` is true for a person who shares a department with the lead (`:38`), shares a division (`:39`), or whose `default_site_id` is in the lead's site set (`:40`; that set is the lead's default site plus every site in their divisions, `documentAccess.js:140-151`). `loadCrew` takes active `role = 'worker'` roster rows of the company only, so an Owner or a supervisor is never on a crew (`:52-55`) and the lead is never on their own (`:37`). The same `loadCrew` backs every lead action below, so the picker, the task writer and on-behalf all agree on who the crew is.

| Join | Producer | Consumer | State |
|---|---|---|---|
| `roster.is_lead` | Owner only: `update_worker_profile` `isLead` is in the `structural` list (`api/companydata.js:1049`), so a non-Owner gets 403 (`:1050-1052`); boolean only (`:1129`); **workers only**, a request that makes a supervisor a lead is 400 "Only a worker can be a crew lead." (`:1132`, tested against the role the person will have after this request, `effectiveRole` `:1077`); **cleared when the lead is promoted to supervisor** (`:1134-1138`, only when the request did not itself carry `isLead`, read first through `readRosterFlags` so a missing column is never written); audited with the field list (`:1152-1155`, the existing `structural` audit). Screen: "Crew lead" checkbox `src/WorkerProfileDrawer.jsx:169` (cleared when the role select leaves worker, `:122`), shown read-only on the profile (`:203`), sent only when changed (`src/Dashboard.jsx:3570`) | `loadActor` (`documentAccess.js:128,166`); `get_my_profile` returns `isLead` for the person's own screen (`companydata.js:1557`); `get_my_crew` | ✅ (migration `?`). Promotion clears it, but **demoting an Owner or supervisor never sets it**, which is right |
| Lead's crew list | `get_my_crew` (`companydata.js:1464-1475`): no `userId` or not a lead answers **200** `{ isLead: false, crew: [] }` on purpose, because every Daily Report and Fuel Log asks on load (`:1467-1470`); a failed check is a real error; returns `{ id, name }` only, sorted | `src/FillingInFor.jsx:21` (the "Filling in for" picker, renders nothing unless a lead with a non-empty crew, `:30`), `src/WorkerMenu.jsx:152-155` (decides whether the "My crew" card shows, `:616`) | ✅ |
| Tasks a lead gives | `lead_assign_task` (`companydata.js:1629-1662`): the person must be on the lead's own crew (`:1630-1633`, 403 otherwise); the row is built by the Owner's own `validateAssignment` as `submit`, `individual`, that person, `restricts: false` (`:1636-1639`) and forced `restricts: false` again (`:1640`), so **a lead can only create a task, never a restriction, and only for one named crew member**; **new 2026-10-06: the target must already be able to submit the document**, `requireAssignment` is run as the target (`{ role: 'worker', userId: personId, companyId }`, `:1645`) and a refusal is a 403 "That person can't use this document right now. Ask your account owner." (503 passes through) (`:1646`), so a lead cannot hand a task for a document the Owner restricted away from the person or hid from them; the insert carries **`by_lead: true`** (`:1655`) next to `created_by` = the lead; one task per lead, document and person (`:1651-1653`), 200-task cap per lead (`:1650`), audited as `lead_assign_task` (`:1660`). `lead_end_task` ends only `id` + company + `created_by = lead` + `restricts = false` + still active (`:1664-1675`), so a lead can never end an Owner's assignment. `lead_list_tasks` lists only the lead's own active tasks (`:1616-1627`) | the assignee's menu through `menuAccessFor` `assigned` (`documentAccess.js:298-306`; **a lead's task lands there, but on a person flagged `hide_unassigned` it no longer counts as "assigned"**, `:220-222`) and `withCompletion` (done state); `src/CrewScreen.jsx:56,93,105` | ✅ (migration `?`; needs `restricts` and `by_lead`, see the hazard above and the migration paragraph) |
| The Owner's view of a lead's tasks | `list_document_assignments` selects every active row of the company (`companydata.js:1384-1388`, columns `id, document_key, audience_type, audience_value, action, restricts, due_at, created_at`, **no `created_by`**) | `src/DocumentAssignmentsManager.jsx` | ⚠️ weak link, see W-L5 below: a lead's task is indistinguishable from the Owner's own task on that screen, and counts toward the 500-row cap (`companydata.js:1411` counts every active row) |
| `entered_by_roster_id` | `api/logs.js:471` (Daily only) and `api/fuellogs.js:246`, only when `session.enteredBy` is set, which only `resolveOnBehalf` sets (`leadAccess.js:81`) | `get_crew_documents` (`api/customforms.js:453,502`, `enteredBy` name) and the crew screen label "(entered by X)" (`src/CrewScreen.jsx:178`). **Nothing else reads it** (`grep -rn "entered_by\|enteredBy" api src server-lib` returns the writers above, `customforms.js:443,446,453-455,489,502`, `CrewScreen.jsx:178` and comments) | ⚠️ producer with one consumer, W-L2 below |
| On-behalf author stamp | `resolveOnBehalf` (`leadAccess.js:71-84`): caller must be a lead (`:72`), the id must be an integer (`:74-75`, 400), must be in the lead's own `loadCrew` (`:76-79`, 403 "That person is not on your crew."), and a failed crew read is 503 (`:77`); returns a derived session `{ ...session, userId: member.id, name: member.name, userName: member.name, isOwner: false, enteredBy: lead.rosterId }` (`:81`). `api/logs.js:376-381` (**daily only**: any other type answers 400 "Filling in for someone isn't available for this document.", `:377`) and `api/fuellogs.js:173-177` swap the session for the derived one **before** `requireAssignment`, the company-suspended check and the stamps | everything after the swap sees the member: the assignment check runs as the member (`logs.js:382`, `fuellogs.js:178`), `stampAuthorName` writes the member's name (`logs.js:413`, `fuellogs.js:238`), `authorRosterId` writes the member's id (`logs.js:471`, `fuellogs.js:246`). Only filled in when the field is present and non-empty (`logs.js:376`, `fuellogs.js:173`), so an ordinary submit is byte-for-byte as before | ✅ (a request can name anybody; only a crew member is accepted, `:78-79`). The lead's own assignment state is not consulted: the lead need not be assigned the document, only the member |
| Daily and Fuel Log client | `src/DailyReport.jsx:304` (payload `reporter` = the member's name, `onBehalfOfRosterId`), request builder `:42`; `src/FuelLog.jsx:167-169`, request `:37`; picker `FillingInFor` at `DailyReport.jsx:355`, `FuelLog.jsx:244` (copy "{name} stays the author. You are recorded as having entered it.", `FillingInFor.jsx:45`) | the two submit handlers above; both also reach the offline queue with the field in the payload | ✅ |

**FLHA sign-off by a lead** (`api/flhas.js`, re-read 2026-10-06 on `claude/auditor-role`). **List** (`:468-495`): a `worker` is let through when `requireLead` passes (`:472-473`), then `requireDocKey`, then the same `listVisibleRecords` a supervisor gets (`:483`), so a lead is held to the FLHA `view` rows (`documentAccess.js:279`, a worker is exempt from `view` rows only when not a lead) and to rule A; **then narrowed to the crew**: `shown.filter(f => crewIds.ids.has(Number(f.submitted_by_roster_id)))` (`:488-492`, 503 if the crew read fails at `:490`), so a supervisor's, an Owner's, another site-mate's-outside-the-crew or an unstamped FLHA never reaches a lead even when rule A would place it by site. **Approve** (`:588-632`): same lead gate (`:593-594`), `requireDocKey`, the record must be in the lead's company (`:602-604`) and pass `requireRecordsAccess` (`:605-606`); then, for a lead only (`:610-625`): **own FLHA refused** (`:611-613`, 403 "You can't approve your own FLHA. Ask a supervisor."); **author must be on the lead's crew** (`crewIds.ids.has(...)`, `:619`, 403 "Not allowed to approve this record.", which refuses a supervisor's, an Owner's and an unstamped FLHA; a failed crew read is 503, `:618`); **author must not be another lead** (`crewIds.leadIds.has(...)`, `:620`, 403 "A crew lead's FLHA needs a supervisor to sign it off."); **the FLHA must still be waiting**: `status !== 'pending_approval' || supervisor_signed_at` is a 409 "This FLHA is not waiting for sign-off." (`:621-623`), so a lead never replaces an existing sign-off. The sign-off name is the roster name: `signedBy = isLeadApproval ? session.name : supName` (`:631`), with a lead whose roster row has no name refused (`:630`), so a lead cannot sign as someone else; admins and supervisors keep `supName`. **A lead gets nothing else on FLHAs:** `update` and `delete` still require `role` admin or supervisor. Screen: `src/CrewScreen.jsx` lazy-loads `FLHACard` (`:19`) from `src/Dashboard.jsx` (an `export function`); the crew screen loads the list (`:54`), regenerates the PDF client side with `supervisorApproval` and posts `approve`; "waiting" is `status === "pending_approval"` and not the lead's own record (`CrewScreen.jsx:70`).

**What a lead can read** (`api/customforms.js:437-515`, `get_crew_documents`, re-read 2026-10-06): lead only (`:438-439`); the seven sources are now the shared `DIRECT_SOURCES` plus `INSPECTION_SOURCE` from `server-lib/documentSources.js` (`:444`; the same list `api/audit.js` reads, see the Auditor section), each only if the document type is switched on (`isDocKeyActive` `:448`), each through `listVisibleRecords` (the document's `view` rows, then rule A, `:456`; a 403 skips that type, `:457`), plus monthly inspection records through their forms (`:463-472`) and custom form records through `listVisibleRecordsMulti` (`:474-482`); **then narrowed to crew-authored records only** (`crewIdSet`, `:487`; `collected.filter(r => crewIds.ids.has(Number(r.submitted_by_roster_id)))`, `:489`; 503 if the crew read fails, `:488`), newest 150 (`:491`), names resolved for author and entered-by, PDF links signed. Read only: no edit, delete or review action is opened. Because the filter is on the author stamp, **an anonymous near miss and any pre-stamp record never reach a lead** (a null author is not in the crew set).

**Worker menu**: the "My crew" card shows only when `get_my_crew` says lead (`src/WorkerMenu.jsx:152-155,616-635`, opens `CrewScreen` `:239-240`, which takes `crew` from the same call). `src/CrewScreen.jsx` loads `get_crew_documents`, `list` FLHAs and `lead_list_tasks` together (`:54-56`).

#### Weak points on the lead role (verified in `507c7cc`; none approved to fix; not numbered, because each is a stated limit or a gap behind an unapplied migration rather than a link that silently fails)

- **W-L1. On-behalf covers only documents with no personal signature.** `type !== 'daily'` is refused in `logs.js:377`; no other handler calls `resolveOnBehalf` (`grep -rn resolveOnBehalf api` returns `logs.js:378` and `fuellogs.js:174` and the import lines only). So a lead cannot file an FLHA, Toolbox Talk, Equipment Inspection, Incident or Near Miss for a crew member, by design (comment `leadAccess.js:66-69`: a signature is a legal act by the person). A crew whose members do not use the app can only be covered for Daily Report and Fuel Log. Deliberate, so also in §5.
- **W-L2. Who typed it in is recorded and then shown to almost no one.** `entered_by_roster_id` is read by the crew screen only (see the join table). The supervisor Daily list is `table.listColumns` (columns at `logs.js:151`, query `:657`) and the Fuel Log list never selects it (`grep -n entered_by api/logs.js api/fuellogs.js` returns the two inserts and the on-behalf comment); no `src/` file outside `CrewScreen.jsx` mentions it. **The Daily Report PDF is generated in the browser from the payload**, with `reporter` set to the member's name (`src/DailyReport.jsx:304`) and printed as "Prepared by: {reporter}" and in the header block (`src/generateDailyPDF.js:49,77`); it has no entered-by line and cannot, because the PDF is built before the server stamps anything. Result: a supervisor opening the report or its PDF sees the member as sole author and nothing says the lead typed it. The audit trail exists in the table and is invisible in every document view. Fuel Log has no PDF (`ls src | grep -i generate.*fuel` is empty). This is the "key written, one reader" shape in §4b. A fix would touch the Daily and Fuel Log supervisor lists (and, for the Daily PDF, a client-side pass-through of the lead's name). **Could be numbered on Dillon's yes.**
- **W-L3. `get_crew_documents` leaves out Portal documents and corrective actions.** The `SOURCES` list (`documentSources.js:11-23` (via `customforms.js:444`)) plus monthly (`customforms.js:463`) and custom (`:473`) has no `portal_records` query and no `corrective_actions` query; `grep -n "portal_records\|corrective_actions" api/customforms.js` finds none inside the action. A lead sees none of a crew's Portal submissions and none of the actions raised from their findings. Portal supervisor reads now go through rule A (#47, closed in PR #199) and so do corrective actions (#48, PR #200, not merged); the Portal omission here is deliberate to leave as is until Dillon decides whether a lead should see crew Portal records (they would have to pass `crewIdSet` like the other sources), so a lead is simply not on either path.
- **W-L4. CLOSED 2026-10-06 (`claude/auditor-role`, `crewIdSet`, `leadAccess.js:78-88`): a lead's crew list is crew-authored only.** Before, rule A was the only filter, so a lead could see a supervisor's or an Owner's record, or an unstamped one, at their site. Now the FLHA list (`flhas.js:488-492`) and `get_crew_documents` (`customforms.js:487-489`) both keep only records whose `submitted_by_roster_id` is in the crew set. Cost, verified: an **anonymous near miss no longer reaches a lead at all** (null author, `authorStamp.js:35-36`), where it used to reach one by site. Intended by the filter's own comment (`:484-486`); recorded here so it is not rediscovered as a break. A lead also never sees their own submissions in the crew list (the lead is not on their own crew, `leadAccess.js:37`).
- **W-L5. CLOSED 2026-10-06 (`claude/auditor-role`): a lead's task is marked and no longer undoes "hide everything not assigned to me".** `lead_assign_task` writes `by_lead: true` (`companydata.js:1655`; column from `roster-lead-migration.sql:22-27`); `evaluateAccess` runs the restricting check before the hide switch and the hide branch ignores `by_lead` rows (`documentAccess.js:210-222`); and `lead_assign_task` refuses a document the target cannot already submit (`companydata.js:1645-1646`). **Still true, weak link only:** `list_document_assignments` selects no `created_by` or `by_lead` (`companydata.js:1396`, columns unchanged), so the Owner's assignment screen still cannot tell a lead's task from their own, and `end_document_assignment` still ends any row of the company (`:1436`); a lead's tasks also count toward the 500-row cap. Not re-read line by line in this pass beyond the grep: `grep -n "created_by\|by_lead" api/companydata.js` should show the lead handlers only.
- **W-L6. CLOSED 2026-10-06 (`claude/auditor-role`): approve refuses a supervisor's, another lead's, an unstamped and an already-signed FLHA.** See the FLHA paragraph above (`flhas.js:610-625`). The author must be in `crewIdSet` (workers on the lead's crew only), not a lead (`leadIds`), and the FLHA must be `pending_approval` and unsigned.
- **W-L7. Live migration state is unknown (`?`).** Three migrations now gate the assignment and lead work on a database Dillon updates by hand: `document-assignments-migration.sql` (now idempotent for `restricts`, see the hazard paragraph), `roster-hide-unassigned-migration.sql`, `roster-lead-migration.sql` (now also adds `document_assignments.by_lead`, and so must run after the assignments migration). Each degrades to "nothing narrowed / nobody is a lead", which hides rather than breaks, except a missing `restricts` or `by_lead` on the write path.

Re-check: `grep -rn "resolveOnBehalf\|requireLead" api server-lib | grep -v "^server-lib/leadAccess.js"`; `grep -rn "entered_by_roster_id" api src`; `grep -n "isLead" api/companydata.js`.

### `roster.role = 'auditor'` + `auditor_scopes` (the outside auditor; branch `claude/auditor-role`, `46553fb` and review fixes `6ad7e0a`, placed 2026-10-06)

**Anchored against `6ad7e0a`** (the head after the review fixes; `46553fb` was the first commit). Everything below was read in code on this pass, not taken from commit messages.

**What it is.** An outside reader the Account Owner gives time-limited, read-only access to documents of chosen types filed at chosen sites. Not a new product: no write path exists for the role, no Brain, no Analytics, no roster. **Migration NOT applied live** (`docs/schema/auditor-migration.sql:3`, `?` live state): adds `roster.auditor_access_expires_at timestamptz` (`:20-21`) and `auditor_scopes` (`roster_id` PK, `division_ids`, `site_ids`, `document_keys`, `updated_by`, `updated_at`, `:23-31`; index `:33`; RLS on with no policies `:36`, same deny-by-default as every other table). `roster.role` has no check constraint, so `'auditor'` needs no schema change. Unapplied is tolerated by the Owner screens (`missingTable` in the auditor block includes `42703` and `PGRST204`, `api/companydata.js:1478`, so they answer "isn't switched on for this database yet"); `loadAuditor` is the one place that does not tolerate it, and it only matters once an auditor exists (a failed roster read is a 503, `auditorAccess.js:51`; a missing `auditor_scopes` table reads as an empty scope, `:65-68`, so they would see nothing).

**An auditor reaches nothing but `api/audit.js`.** Every one of the 13 handlers that defines `verifySession` returns `null` for `role === 'auditor'` right after the live roster read, so every action answers "not logged in": `admin.js:114`, `certifications.js:109`, `companydata.js:113`, `customforms.js:89`, `equipmentreports.js:92`, `flhas.js:94`, `fuellogs.js:83`, `generate-flha.js:127`, `logs.js:95`, `maintenance.js:91`, `monthly.js:89`, `portal.js:96`, `reports.js:89`. Re-check: `grep -L "SESSION_SECRET" api/*.js` lists the files with no session path at all (`checkout`, the three crons, `scope-approval`, `stripe-webhook`, `timeclockreports`), and `grep -l "role === 'auditor'" api/*.js` must list the 13 above plus `login.js` (`audit.js` tests `payload.role !== 'auditor'` at `:48` instead). **A new handler with its own `verifySession` copy that forgets the line would answer an auditor; nothing enforces it** (the §4b shape: one convention, thirteen copies).

| Join | Producer | Consumer | State |
|---|---|---|---|
| `roster.role = 'auditor'` row | `create_auditor` (`api/companydata.js:1516-1535`): name and a valid email required, name must not clash with an active roster name, throttle 20 per hour per company (`:1526`), insert with `wallet_enabled: false` and a **random PIN nobody is told** (`hashPin(genPin(), salt)`, `:1530`), email encrypted | `list_auditors` (`:1490`); every login path (below) | ✅ (migration `?`) |
| `roster.auditor_access_expires_at` | `send_auditor_access` writes now + `AUDITOR_ACCESS_MS` (14 days, `auditorAccess.js:24-25`) before the email goes (`companydata.js:1569`); `revoke_auditor_access` writes now and clears the PIN link (`:1579-1588`) | `auditorAccessLive` (`auditorAccess.js:30-34`, false for null or past) at three login points, `login.js:446` (`mintRosterSession`, covers all three session mints `:738,:785,:898`) and `login.js:694` (`roster_login`, right after the PIN passes and **before** any authenticator prompt or enrollment email), and on **every** `api/audit.js` request through `loadAuditor` (`auditorAccess.js:56-58`, 401 "Your audit access has ended") | ✅ revoke and expiry take effect on the next call, so a stolen token dies with the access |
| `auditor_scopes` (division, site, document key) | `set_auditor_scope` (`companydata.js:1537-1549`): `validateAuditorScope` (`auditorAccess.js:142-`) type-checks the three arrays (`:143-145`, added `6ad7e0a`), checks every division through `sanitizeDivisionIds`, every site against `company_id`, every key against `listAuditableDocuments` (built-ins by site plus this company's custom forms); upsert on `roster_id`; audited | `loadAuditor` (`auditorAccess.js:60-85`): site ids = the row's sites plus every `sites.id` whose `division_id` is in the row's divisions (`:71-78`) | ✅ nothing is the default; empty means nothing. `send_auditor_access` refuses an auditor with no document keys or no sites or divisions (`companydata.js:1555-1561`) |
| `DIRECT_SOURCES` | `server-lib/documentSources.js:11-18` (FLHA, Toolbox, Daily, Incident, Near Miss, Fuel Log) with `INSPECTION_SOURCE` `:23` and `AUDITABLE_BUILTIN_KEYS` `:26` (the six plus `monthly`, **not** `inspection`) | `api/audit.js:102` (the auditor's list) and `api/customforms.js:444` (`get_crew_documents`, the crew lead's list, see above): one list, so the two cannot drift on tables or columns | ✅ shared by design |
| Scope applied in the query | `api/audit.js:105-106` (`.eq('company_id', ...).in('site_id', sites)` per built-in), `:117-118` (monthly, through this company's `inspection_forms`, `.in('site_id', sites)`), `:127-128` (custom forms, `.in('site_id', sites)`, only forms of this company, `:124-125`); a requested `documentKey` or `siteId` can only narrow (`:95-97`); built-ins also need `isDocKeyActive` (`:104,113`) | `list_audit_documents` (`:91-145`), newest first, 150 per source and 300 in total (`:52-53,135`); PDF links signed for **300 seconds** (`:136`, `signRows(..., 300)`, added `6ad7e0a`) from the `flha-reports` bucket | ✅ scope is a query condition, not a post-filter; `get_audit_scope` (`:82-89`) returns name, expiry, sites and document labels |
| Auditor sign-in | `find_company` then a roster name, PIN, then the authenticator, exactly like everyone else: `MFA_REQUIRED_ROLES = ['supervisor', 'admin', 'auditor']` (`server-lib/rosterMfa.js:27`, `requiresMfa` `:37`), so first sign-in goes to enrollment and no session exists until it succeeds; `sessionTtlMs` gives an auditor the supervisor window, 12 hours (`server-lib/sessionTtl.js:17,23-24`) | `src/Login.jsx:383-388` routes `role === "auditor"` to `AuditorView` **before** the supervisor fall-through; `isPersistable` excludes the role (`:24`) so an auditor session is `sessionStorage` only (`:28`) and ends with the tab | ✅ |
| Owner screen | `src/AuditorsManager.jsx` (`list_auditors` `:114`, `create_auditor` `:123`, `set_auditor_scope` `:85`, `send_auditor_access` `:87`, `revoke_auditor_access` `:92`), mounted in `src/Dashboard.jsx:7883` for `canManageCompany` | the five actions, all behind `canManageCompany(session)` (Owner or founder, `companydata.js:1475`), every id resolved against `companyId` (`loadAuditorRow` `:1481`, `role = 'auditor'` and company) | ✅ |
| Setup link and email | `send_auditor_access` calls `issueAndEmailPinLink(... needsAuthenticator: true, buildEmail: auditorAccessEmail)` (`companydata.js:1571-1574`); `auditorAccessEmail` (`auditorAccess.js:88-115`) states the access end date, the link, and that the company code comes from the Owner; per-company throttle 20 per hour (`:1562`) and **per-auditor 5 per hour** (`:1564`, `6ad7e0a`) | `pin_link_open` / `pin_link_set_pin` (`login.js:811-`), the same single-use link every roster person gets | ✅ |
| Seat counts exclude auditors | `list_roster` seat count (`companydata.js:379`), `add_roster_member` (`:424`), `onboard_new_employee` (`:490`), `reactivate_roster_member` (skips the cap check for an auditor, `:614,621`) | `effectiveSeatCap` | ✅ **and `update_worker_profile` refuses a role change off an auditor** (`:1088`, 400, added `6ad7e0a`), because an auditor turned worker would be an uncounted seat. The Dashboard "Total active" figure also excludes them (`src/Dashboard.jsx:7867`) |
| Bulk setup-link send | `send_pin_setup_links_all` (`companydata.js:769`) skips `role === 'auditor'` (`:786`): an auditor's link goes out with their access, which is what starts the 14 day window | — | ✅ |
| Owner can unlock and reset an auditor | `canResetMfa` now lets an Owner act on `worker`, `supervisor` **and `auditor`** (`server-lib/rosterMfa.js:200`, `6ad7e0a`); that function gates `reset_roster_mfa` (`companydata.js:701-707`), `unlock_roster_pin` (`:729`) and the PIN reset (`:648`) | the Owner's roster screen | ✅ at `6ad7e0a`. **At `46553fb` it was founder-only** (the line stopped at worker and supervisor), so a lost authenticator on an auditor was a call to FORA; recorded because the first version of the weak point list said it was the Owner's |

**Weak points, verified on `6ad7e0a`. None numbered; each is a stated limit, a gap behind an unapplied migration, or a gating inconsistency, not a link that silently fails for a paying customer today.**

- **A-W1. Equipment inspections and any record with no `site_id` can never be shown to an auditor.** The inspection table has no site (the first section's note: `api/logs.js:125-131`), `AUDITABLE_BUILTIN_KEYS` leaves `inspection` out (`documentSources.js:26`), and every query is `.in('site_id', sites)` (`api/audit.js:106,118,128`), which a null never satisfies; the pure helper says the same (`auditorAccess.js:118-120`, `site_id != null`). The same applies to a record filed before sites were linked (break #2's free-text `site` / `job_site` shape). An Owner who picks "all documents" at a site gets no equipment inspections and no unlinked history, and nothing on the screen says so. Deliberate in the comment (`auditorAccess.js:15-16`), so also in section 5.
- **A-W2. The access email carries a 24 hour single-use setup link, not a typed temporary password.** `auditorAccessEmail` text (`auditorAccess.js:100-102,110`: "The link works once and expires in 24 hours"); the 24 hours is `PIN_LINK_MFA_TTL_MS` (`server-lib/setupLinks.js:21`), chosen because `needsAuthenticator` is true. The initial PIN is random and never shown (`companydata.js:1530`). The 14 day access window starts when the Owner sends access, not at first login, so an auditor who misses the 24 hour window burns days until the Owner resends (`send_auditor_access` resets the window to 14 days from the new send, `:1568-1569`).
- **A-W3. `AccountSecurity` (session based MFA change) is unavailable to an auditor.** It calls `get_my_mfa_status`, `mfa_self_enroll_start`, `mfa_self_enroll_confirm` and `mfa_self_disable` (`src/AccountSecurity.jsx:32-71`), served by `api/companydata.js:665`, whose `verifySession` returns null for the role (`:113`); and `AuditorView` mounts no such screen (`grep -n AccountSecurity src/AuditorView.jsx` is empty; the only mount is `src/WorkerMenu.jsx:236`). So an auditor cannot change or disable their own authenticator; first-time enrollment still works because it runs on the login enroll ticket, not a session (`login.js:744`). A lost authenticator is the Owner's to reset (`reset_roster_mfa`, row above), and as of `6ad7e0a` the Owner can.
- **A-W4. Portal documents and corrective actions are not auditable.** `listAuditableDocuments` offers only the six `DIRECT_SOURCES` keys, `monthly` and `custom_<id>` (`auditorAccess.js:127-133`), and `api/audit.js` has no `portal_records` or `corrective_actions` query (`grep -n "portal_records\|corrective_actions" api/audit.js` is empty). Same gap as the crew lead's list (W-L3 above); an auditor reviewing a Portal company sees none of it.
- **A-W5. The migration is not applied live (`?`).** See the first paragraph. Until it is, `create_auditor` works (its insert names no new column, `companydata.js:1530`), `list_auditors` answers the setup message (`:1494`, `missingTable` includes `42703`), and **`set_auditor_scope`, `send_auditor_access` and `revoke_auditor_access` answer a misleading 404 "Auditor not found."**, because `loadAuditorRow` ignores the read error and returns null when the `auditor_access_expires_at` column is missing (`:1484-1487`, `data` only, `error` dropped). No one can sign in as an auditor either way.
- **A-W6. Custom documents are not held to their own on/off setting, unlike the built-ins.** Built-ins skip a document type that is switched off (`isDocKeyActive`, `api/audit.js:104,113`); custom forms are read with no such check (`:124-132`; `grep -n "CustomDocKey\|is_active" api/audit.js server-lib/auditorAccess.js` is empty), so an Owner who deactivated a custom form (`customforms.js:216`) still shows its history to an auditor whose scope names it. Arguably right for history, and the crew lead's `get_crew_documents` does the same (`customforms.js:473-482`), so recorded as a gating inconsistency (the break #25 shape), not filed. **Could be numbered on Dillon's yes.**
- **A-W7. Small, verified.** (a) The login name list has no role filter (`api/login.js:549-553`, `.eq('active', true)` only), so anyone holding the company code sees an active auditor's name, including one whose access has ended (the row stays active). (b) `recordInAuditScope` (`auditorAccess.js:118`) has no caller anywhere (`grep -rn recordInAuditScope api server-lib src tests`), because the scope is applied in the query; dead export, harmless. (c) An auditor's list is summaries and a signed PDF link only; there is no detail, edit or review action (`audit.js:147` answers 400 for anything but the two actions).

Re-check: `grep -n "role === 'auditor'" api/*.js` (13 handlers plus login); `grep -n "site_id" api/audit.js` (three scope conditions); `grep -rn "MFA_REQUIRED_ROLES" server-lib`; `grep -n "auditor" api/companydata.js | head -50`.

### `awaiting_signature` / `signature_requested_at` / `worker_signed_at` (worker signs afterwards; branch `claude/sign-afterwards`, PR #183, head `c74082b`, base `claude/auditor-role`; placed 2026-10-07)

**Anchored against `c74082b`.** Line numbers in `api/flhas.js` below are this branch's; the older FLHA anchors elsewhere in this file (the lead section's `flhas.js:468-495`, `:610-625`, the join table at the top of the assignments section) were taken before this branch moved the file and are now off by up to ~100 lines. Re-anchor them when those sections are next touched.

**What it is.** A worker can save an FLHA before signing it, and sign it later from the worker menu. While unsigned the row carries `awaiting_signature = true`; supervisors see "Awaiting <name>'s signature" and cannot approve it. **Migration NOT applied live** (`docs/schema/sign-later-migration.sql`, `?` live state): adds the three columns to **four** tables, `flhas`, `incidents`, `inspections`, `near_misses` (`:21-38`), partial indexes on `(company_id, submitted_by_roster_id) where awaiting_signature` (`:42-49`), and a CHECK that an anonymous near miss cannot await a signature (`:55-58`). **STALE as of 2026-10-07 (re-read against the working tree on `baa69e9`): this paragraph said only FLHA uses the columns. That is no longer true.** `grep -rln "awaiting_signature" api server-lib src docs/schema` now lists `api/audit.js`, `api/customforms.js`, `api/flhas.js`, `api/logs.js`, `api/reports.js`, `server-lib/signLater.js`, `src/CrewScreen.jsx`, `src/Dashboard.jsx` and the migration. Incident (`api/reports.js:315`), Equipment Inspection (`api/logs.js:622`) and Near Miss (`api/reports.js:315`, uncommitted edit) all write the state now. The Weak points section below (W-S1 to W-S12) was anchored against `c74082b` and **was not re-verified for FLHA by this pass**; W-S1 (auditor list) and W-S2 (crew lead list) are already fixed in code for every signable source (see the Near Miss subsection). Re-verify the rest in the next full sweep.

**Fail-closed without the migration.** A sign-later save on a database without the columns answers 503 "Signing afterwards isn't switched on yet" (`flhas.js:489-491`, `missingSignColumns` `signLater.js:31-35`); `my_unsigned` answers an empty list (`flhas.js:533`); `list` retries without the three columns (`:581-582`); `loadSignState` falls back to a narrow select (`signLater.js:56-66`) and reports nothing awaiting. So before the migration the feature is off, not broken.

| Join | Producer | Consumer | State |
|---|---|---|---|
| Sign-later flag on a new FLHA | `submit` (`flhas.js:470-481`): `sign_later: true` from the client, **or** a missing/invalid drawn PNG with an individual sign-in, becomes sign-later; a shared-code session (no `userId`) gets 400 (`:473,478`); `worker_signature` is forced null and `unsignedFields` stamps the three columns (`:479-480`, `signLater.js:38-40`). Client: `src/App.jsx:63` (`sign_later`), `:35` (PDF gets `awaitingSignature`), `saveFLHA(signLater)` `:866-871` | the row; PDF banner "AWAITING WORKER SIGNATURE" (`src/generatePDF.js:332-337`) | ✅ (migration `?`) |
| Author stamp is the gate | `submitted_by_roster_id` from the session (`flhas.js` insert, `authorRosterId`) | `completeSignature` requires the row's author to equal `session.userId` (`signLater.js:87-89`), matches on `.eq('awaiting_signature', true)` so a double sign writes nothing (`:97-101`) | ✅ |
| `my_unsigned` | the caller's own `awaiting_signature = true` rows (`flhas.js:519-536`; worker or supervisor with a `userId`, `requireDocKey 'flha'` `:521`) | `src/SignAfterwards.jsx:158` (the "Needs your signature" screen) and the count on `src/WorkerMenu.jsx:166-172`, card `:638-653` | ✅ |
| `sign_now` | `flhas.js:544-560`: needs a drawn PNG and an uploaded PDF receipt (`:554`, refuses otherwise), then `completeSignature` writes `worker_signature`, `pdf_url`, `awaiting_signature = false`, `worker_signed_at` (`signLater.js:91-98`). Client `src/SignAfterwards.jsx:104` | the FLHA list and every document list (see weak points) | ✅ |
| Approve block | `approve` reads `loadSignState` first and answers 409 "The worker hasn't signed this FLHA yet." for anyone, an admin included (`flhas.js:703-708`); the lead's crew check follows (`:722-735`) | `src/Dashboard.jsx:2526` (alert before calling), `src/CrewScreen.jsx:79` | ✅ |
| Supervisor and lead views | `list` returns the three columns (`flhas.js:581`) | `FLHACard` banner and disabled approve (`src/Dashboard.jsx:342,556`), the row label "Awaiting worker signature" (`:5718-5719`), the sign-off counter excludes awaiting rows (`:4264`), PDF regeneration passes `awaitingSignature` (`:2584`); `CrewScreen` "needs signature" list, `waiting` excludes awaiting rows, overdue note after 24 hours (`src/CrewScreen.jsx:72-74,133`) | ✅ for the FLHA card and crew screen; ⚠️ everywhere else, see W-S1 to W-S8 |
| 24 hour overdue rule | **(UPDATED 2026-10-07, `2a90e83`: `SIGN_LATER_OVERDUE_MS` is now imported by `server-lib/unsignedSweep.js:23,77`; `signatureOverdue` itself still has no caller.)** Original: `signatureOverdue` and `SIGN_LATER_OVERDUE_MS` (`signLater.js:15,113-117`) | **nothing imports either** (`grep -rn "signatureOverdue\|SIGN_LATER_OVERDUE_MS" api src server-lib` finds only the definitions). `CrewScreen.jsx:73` re-types 24 hours inline | ⚠️ two copies of one number, W-S9 |
| Amend of an unsigned record | `submit` with `amendingId`: author-only while awaiting, and an amendment can never write a signature (`flhas.js:340-352`, `loadSignState` `:348`) | — | ✅ |

#### Weak points on sign-afterwards (verified on `c74082b`; none approved to fix; not numbered, because the state is unreachable until Dillon applies the migration and turns on the feature; each becomes a real break the day the first customer saves an FLHA unsigned)

*(Historical framing as found on `c74082b`; W-S1 to W-S8 and W-S10 to W-S12 are closed or superseded as of 2026-10-07, see each entry. W-S13 was found and is fixed on main (2026-10-08). W-S9 is a recorded decision.)* The shape: **the flag is read by the FLHA tab and nothing else.** Every other reader of `flhas` selects its own columns and none selects `awaiting_signature`, so an unsigned FLHA looks finished everywhere except the supervisor's FLHA card and the worker's own menu.

- **W-S1. (CLOSED 2026-10-07, PR #196 branch `claude/weak-points-ws`, `2f78e24`.) The auditor was handed unsigned FLHAs as evidence.** Now `DIRECT_SOURCES` and `INSPECTION_SOURCE` carry `signable: true` for FLHA, Incident, Near Miss and Inspection (`server-lib/documentSources.js:16,19,20,27`) and `api/audit.js:111` reads `src.signable ? readSource().eq('awaiting_signature', false) : readSource()`, retrying unfiltered only when the columns are missing (`:112`, `missingSignColumns`). An auditor sees signed records only. Re-check: `grep -n "awaiting_signature" api/audit.js`.
- **W-S2. (CLOSED 2026-10-07, `2f78e24`.) The crew lead's document list showed them as ordinary documents.** `get_crew_documents` now selects `awaiting_signature, signature_requested_at, unsigned_closed_at` for every `signable` source (`api/customforms.js:453-456`) and returns `awaitingSignature`, `unsignedClosed`, `signatureRequestedAt` per row (`:514-517`); `src/CrewScreen.jsx:200` labels the row "not signed by the worker yet" or "closed unsigned". Lead sees the same state in both views. Labelled rather than hidden, on purpose.
- **W-S3. (CLOSED 2026-10-07, `0a1d7db`.) A worker's own "My documents" lists the unsigned FLHA with its AWAITING PDF as done.** Now `get_my_documents` selects `awaiting_signature` for FLHAs (`api/customforms.js:531`) and maps `awaitingSignature` (`:578`); `src/MyDocuments.jsx:213` shows "Not signed yet". Inspection, Incident and Near Miss rows the same (`:533,539,541`; `:579,582,583`). Risk of the unguarded select: NM-8.
- **W-S4. (CLOSED 2026-10-07, `0a1d7db`.) The worker profile's document list.** `get_worker_profile` now selects `awaiting_signature` (`api/companydata.js:929`) and maps `awaitingSignature` (`:990-995`); `src/WorkerProfileDrawer.jsx:264` shows "Awaiting signature". Risk of the unguarded select: NM-8.
- **W-S5. (CLOSED 2026-10-07, `2f78e24`, PR #196.) Analytics counted unsigned FLHAs as submitted FLHAs.** `signedOnly` (`src/analyticsUtils.js:50`, `awaiting_signature !== true`) is now applied in `highRiskFlhaRate` (`:53`), `fieldSiteActivity` (`:136`, FLHAs, near misses and incidents) and `reporterLeaderboard` (`:313`, FLHAs and inspections); the "Total FLHAs" tile filters the same way (`src/Analytics.jsx:159`). The Overview review stat no longer treats an awaiting row as signed off: `signedFlhaCount` excludes awaiting rows (`src/Dashboard.jsx:4351`), `flhaReviewStats = { total: signedFlhaCount, signedOff: signedFlhaCount - awaitingSignOff }` (`:4352`), and `awaitingSignOff` counts only non-awaiting `pending_approval` rows (`:4294`). Decision taken in code: an unsigned FLHA is not a submitted FLHA until signed. `reviewBacklog` keeps awaiting rows in "outstanding" and says how many are unsigned (`analyticsUtils.js:41`, `Analytics.jsx:186`), because a near miss or incident awaiting a signature is still a review that has to happen.
- **W-S6. (CLOSED 2026-10-07, `2f78e24`, PR #196, with one defect found: W-S13.) Status colour said "done" for an unsigned low-risk FLHA.** Now `feedTone` returns warning for `doc.status === "pending_approval" || doc.awaiting_signature === true` (`src/Dashboard.jsx:5586-5589`), the label reads "Closed unsigned" / "Awaiting worker signature" (`:5757`), and the FLHA row icon uses warning when awaiting (`:5891`). The three answers agree.
- **W-S7. (CLOSED 2026-10-07, `2f78e24`, PR #196.) Exports and bulk PDF carried the unsigned PDF.** `exportSelected` (`src/Dashboard.jsx:2507`) now exports `picked.filter(f => f.pdf_url && f.awaiting_signature !== true)` (`:2512`) and counts the skipped ones (`:2511`).
- **W-S8. (CLOSED 2026-10-07, re-read on `2f78e24`; the earlier text was wrong about the current code.) The supervisor `update` action refuses an awaiting record.** After the existing-row fetch (`api/flhas.js:644-645`), `loadSignState` runs and `if (signState.found && signState.awaiting) return res.status(409)` "The worker hasn't signed this FLHA yet. Edit it once they have." (`:657-660`). Approve is blocked the same way (`:737-742`, any role including admin). A DB read failure returns 503, not a pass (`:659`, `:741`). The remaining residual (`sign_now` signs what the worker's screen rendered, no content hash) cannot be reached by a supervisor edit any more, because the supervisor edit is refused while the record is awaiting. Re-check: `sed -n 655,661p api/flhas.js`.
- **W-S9. (RECORDED DECISION, not a break; unchanged by PR #196.) The Brain and platform telemetry count an unsigned FLHA the day it is saved.** The `flha_edit` signal is inserted at save time (`flhas.js:501-508`), before any signature, and `companyBrainSummary.js:95-100` reads it with no regard to sign state; `platformOverview.js:215` counts the `flhas` table row. Probably right for the Brain (the edit pattern is real whether or not the worker ever signs), but a record that is never signed still teaches it. Not a break; recorded so nobody files it later. Re-read 2026-10-07: `flha_edit` insert is still at save time (`api/flhas.js:501-508`).
- **W-S10. (SUPERSEDED 2026-10-07, `2a90e83`, PR #195: the supervisor/lead/Owner audience gets a 24 hour email and the record closes at 10 days; see U-1 to U-5.)** The server-side 24 hour rule is now consumed by the sweep: `SIGN_LATER_OVERDUE_MS` is imported at `server-lib/unsignedSweep.js:24` and used at `:92`. Still true: `signatureOverdue` (`server-lib/signLater.js:124`) has no caller (`grep -rn signatureOverdue api src server-lib` finds only the definition), and `src/CrewScreen.jsx:72-73` keeps its own inline 24 hours. Two copies of one number remain, harmless while both are 24 hours; no longer a silent gap.
- **W-S11. (SUPERSEDED 2026-10-07.) Incident, Inspection and Near Miss now have sign-later,** so the "shared helpers invite a copy" worry is moot: `SIGN_LATER_TABLES = ['flhas', 'incidents', 'inspections', 'near_misses']` (`server-lib/signLater.js:21`) matches four tables that each write and read the state (`api/flhas.js:548`, `api/reports.js:414`, `api/logs.js:713`), and the W-S1 to W-S7 walk was repeated per table in the sign-afterwards section (Near Miss NM-1 to NM-8). The two cautions it raised are handled: an anonymous near miss has no author to sign (CHECK in `sign-later-migration.sql`), and `readSignedOnly` keeps an unsigned inspection's reading out of PM and fuel.
- **W-S12. (RESOLVED 2026-10-07, `2f78e24`; (a) stays open.)** (a) Live migration state: unchanged. The live database was checked 2026-10-07 and carries the three sign-later columns on all four tables (see NM-8), but this pass did not re-query it, so it is not re-verified here (`?`). (b) VERIFIED: an FLHA saved sign-later offline replays with the flag intact. `saveFLHA(signLater)` builds `payload` with `signLater` (`src/App.jsx:963`) and queues the whole object (`enqueueSubmission("flha", ..., payload)`, `:966,986`; `src/offlineQueue.js:72-80` stores `payload` unmodified). Replay goes through `resubmitFLHA` (`src/WorkerMenu.jsx:35`), which destructures `signLater = false` (`src/App.jsx:28`), sends `worker_signature: null` (`:61`) and `sign_later: true` (`:63`). (c) FIXED: Overview Recent Activity and Site Activity rows now take the flag through `overviewAllDocs`, which filters `awaiting_signature !== true` (`src/Dashboard.jsx:4355-4358`), and `fieldSiteActivity` filters via `signedOnly` (`analyticsUtils.js:136`).
- **W-S13. (FIXED on main, re-read 2026-10-08: `src/Dashboard.jsx` now has `f.unsigned_closed_at` / `insp.unsigned_closed_at` in both badges, and `rec.unsigned_closed_at` appears only inside `ReportRow`, `:983`. The text below is the defect as found.)** Was introduced by PR #196 (`2f78e24`). The FLHA tab and the Inspection tab reference an undefined variable `rec` in the new awaiting badge.** `src/Dashboard.jsx:5902` (FLHA row, loop variable is `f`) and `:6043` (inspection row, loop variable is `insp`) render `{rec.unsigned_closed_at ? "CLOSED UNSIGNED" : "AWAITING SIGNATURE"}`. `rec` is only a parameter of `ReportRow` (`:959`) and `sevRank` (`:4841`), so at these lines it is not in scope (`grep -n "\brec\b" src/Dashboard.jsx` shows no binding in `:5700-6100`). The `title=` on the same elements correctly uses `f.` / `insp.`. The expression only evaluates when `awaiting_signature === true`, so it throws a ReferenceError the first time a company has an unsigned FLHA or inspection in the list, which would blank the tab (or the whole dashboard if no error boundary catches it; not read). Nothing fails before the first sign-later save, which is why no test or build catches it. Fix would touch: two tokens, `rec.` to `f.` at `:5902` and `rec.` to `insp.` at `:6043`. Re-check: `grep -n "rec.unsigned_closed_at" src/Dashboard.jsx` (only `:983`, inside `ReportRow`, is correct).

Re-check: `grep -rn "awaiting_signature" api server-lib src docs/schema | grep -v "^api/flhas.js\|^server-lib/signLater.js"` (expect `src/Dashboard.jsx`, `src/CrewScreen.jsx`, the migration; every other reader of `flhas` is a weak point above); `grep -n "cols:" server-lib/documentSources.js` (FLHA line carries no flag); `grep -rn "from('flhas')" api server-lib` (`companydata.js:928`, `customforms.js:522` select no flag); `grep -rn "signatureOverdue" api src server-lib`.

#### Near Miss sign-afterwards (working tree on `baa69e9`, uncommitted diff; placed 2026-10-07)

**Producer.** `api/reports.js:311-320`: `sign_later: true` from the client, or **a named near miss with no signature** (`type === 'nearmiss'`, `:315`), becomes sign-later; `signature_url` forced null and `unsignedFields` stamps `awaiting_signature`, `signature_requested_at`, `worker_signed_at` (`:316-320`). An anonymous near miss is refused with 400 if it asks (`:312`) and is never flagged by the automatic rule (`:315`, `!anonymous`); the database agrees (CHECK `docs/schema/sign-later-migration.sql:54-58`). Needs an individual sign-in (`:317`, shared-code session gets 400). Fail-closed without the migration: 503 (`:335-337`). Client: `src/NearMiss.jsx` `submit(signLater)` and the "I'll sign afterwards" button (hidden for anonymous and for shared-code sessions, `token && !anonymous`), offline replay carries `signLater` in the queued payload (`resubmitNearMiss`, destructured at `:26`), PDF stamp "AWAITING REPORTER SIGNATURE" (`src/generateNearMissPDF.js:121-125`).

| Join | Producer | Consumer | State |
|---|---|---|---|
| `my_unsigned` | `reports.js:391-` (own rows by `submitted_by_roster_id`, `.eq('awaiting_signature', true)`, `requireDocKey 'nearmiss'`) | `src/SignAfterwards.jsx` `UnsignedNearMiss` (`post type: "nearmiss"`) and the count in `src/WorkerMenu.jsx` (`loadUnsigned`) | ✅ (migration `?`) |
| `sign_now` | `reports.js:419-`: needs a signature receipt and a PDF receipt, `completeSignature` (author-only, `.eq('awaiting_signature', true)`) | `UnsignedNearMiss.sign`; list and PDF | ✅ |
| Supervisor `list` | `reports.js:453` returns the three columns, retry without them if missing | `Dashboard.jsx` `ReportRow` badge (`:982`), `NearMissCard` banner and edit hidden (`:1081,1139`), feed label (`:5745`) | ✅ |
| `review` and `update` blocks | `reports.js:479-483` (review) and `:535-539` (edit) read `loadSignState`, 409 while awaiting, admin included | `Dashboard.jsx:4398,4674` alert before calling | ✅ |
| Auditor list | `DIRECT_SOURCES` near miss has `signable: true` (`documentSources.js:20`) | `api/audit.js:111` `.eq('awaiting_signature', false)`, retried without on a missing column (`:112`) | ✅ hidden from an auditor |
| Crew lead document list | same source, flag selected (`customforms.js:453`) | returned as `awaitingSignature` (`:511`), shown "not signed by the worker yet" (`src/CrewScreen.jsx:200`). An anonymous near miss never reaches a lead (see lead section) | ✅ labelled |

**Consumers of `near_misses` that still treat an unsigned row as a finished one (verified in code; none approved, none numbered; same family as the FLHA weak points, and the same state is already reachable for Incident, so these are shared by both):**

- **NM-1. (CLOSED 2026-10-07, `0a1d7db`.) My Documents (worker).** `api/customforms.js:541` (near miss) and `:539` (incident) now select `awaiting_signature`; `:582-583` map it as `awaitingSignature`; `src/MyDocuments.jsx:213` renders "Not signed yet. Sign it from 'Needs your signature' on your menu." Unguarded select: NM-8.
- **NM-2. (CLOSED 2026-10-07, `0a1d7db`.) Worker profile (supervisor view).** `api/companydata.js:937,939` select `awaiting_signature`; `:994-995` map `awaitingSignature` after `keepVisible`; `src/WorkerProfileDrawer.jsx:264` labels it. Unguarded select: NM-8.
- **NM-3. (CLOSED 2026-10-07, `0a1d7db`, by holding rather than labelling alone.) Corrective actions wait for the signature.** `api/reports.js:381` runs `runReportFollowUps` (`:102-129`, which calls `openCorrectiveActions` at `:123`) only `if (newId && !signLater)`; a sign-later report opens none. `sign_now` runs it after `completeSignature` succeeds (`:438`, reading `pdf_url, incident_type|involved, report_json` company-scoped at `:434-436`). Idempotent: `openCorrectiveActions` skips descriptions it already holds (`server-lib/correctiveActions.js:138-151`). Belt and braces for a row that has actions anyway (a report signed late, then flagged): `api/monthly.js:776,783` select `awaiting_signature`, `:832,859` return it, `src/Dashboard.jsx:1943` shows "Report awaiting signature" on `CorrectiveActionRow`. Equipment inspections: the follow-ups were already held (`runInspectionFollowUps`, `api/logs.js:310`, called at `:680` only when `!signLater`); `monthly.js:793,859` labels that source too.
- **NM-4. (CLOSED 2026-10-07, `0a1d7db`; reverses the earlier "probably right" reading.) The Brain signal waits for the signature.** The `incident` / `near_miss` `company_signals` insert moved into `runReportFollowUps` (`api/reports.js:102-122`), with a select-first guard so a repeat run writes one row (`:111-113`). An unsigned report teaches the Brain nothing until signed. Still open by design: the FLHA `flha_edit` signal is written at save (`api/flhas.js:502`, W-S9) and is unchanged. The equipment-inspection signal is held the same way: the insert (`api/logs.js:326-335`) is inside `runInspectionFollowUps` (`:313`), called at `:680` only when `!signLater`.
- **NM-5. (CLOSED as a reconciliation, 2026-10-07, `0a1d7db`; the decision to count is unchanged.)** `reviewBacklog` (`src/analyticsUtils.js:31-39`) still counts an unsigned report in `total` and `outstanding` (so the numbers match the review tabs), and now returns `awaitingSignature`, the outstanding rows with `awaiting_signature === true` (`:38`). `src/Analytics.jsx:186` appends ", N of them not signed yet". Other analytics (`severityBreakdown`, `nearMissIncidentRatio`, `monthlyTrend`, `fieldSiteActivity`) still count unsigned near misses; that is the intended reading. W-S5 (FLHA analytics, `signedOff` stat) is NOT touched by this change and stays open.
- **NM-6. Platform telemetry.** `server-lib/platformOverview.js:218` counts the `near_misses` row. Not a break, unchanged (re-read in this pass: not re-opened).
- **NM-7. Site delete detaches it like any near miss** (`api/companydata.js:1786`); no sign-state concern. Unchanged, listed so it is not hunted again.
- **NM-8. (NEW 2026-10-07, open, not numbered.) The new `awaiting_signature` selects have no missing-column fallback.** `get_my_documents` (`api/customforms.js:531-541`), `get_worker_profile` (`api/companydata.js:929-939`) and the corrective-action source lookups (`api/monthly.js:776,783,793`) now put `awaiting_signature` in a plain `.select(...)`. If the column does not exist, PostgREST errors, `data` is null, and every consumer does `data || []` / `rows || []` (`customforms.js:578-583`, `companydata.js:990-995`, `monthly.js:780,787,797`), so the failure is silent: My Documents empties for FLHA, inspection, incident and near miss, the worker profile loses the same four, and corrective actions from incidents, near misses and inspections read "Unknown source". Contrast `api/reports.js:456` and `api/flhas.js:581`, which retry without the columns. The sign-later migration is recorded as not applied live (`docs/schema/sign-later-migration.sql`; live state `?`). Customer impact if the migration is missing: worker documents and corrective-action source labels go blank with no error. Fix would touch the three handlers (retry without the column, as `reports.js:456` does) or confirm the migration is live first. Needs Dillon's yes.
- **Not a consumer:** `readSignedOnly` (maintenance, fuel logs, equipment reports, `companydata.js:1817`) reads `inspections` only; a near miss feeds no reading. Bulk export (`Dashboard.jsx:2507-2512`) is FLHA-only, so W-S7 has no near miss case.

Re-check: `grep -n "from('near_misses')" api/*.js` (expect `customforms.js:541`, `companydata.js:939`, `monthly.js:783` selecting no flag; `reports.js` list selects it); `grep -n "awaiting_signature" api/audit.js api/customforms.js api/reports.js`; `grep -n "nearmiss" server-lib/documentSources.js` (`signable: true`); `node --test tests/unit/sign-later-reports.test.js` (12 pass at this pass).

#### Unsigned escalation (branch `claude/unsigned-escalation`, `2a90e83`, PR #195; placed 2026-10-07)

**What it is.** Two timers on a sign-later record. **24 hours unsigned:** the people who would be told of a new record of that type get one email "N Incident Reports still unsigned" (`server-lib/unsignedSweep.js:60-150`, text `:138-143`, no content, no author, no site). **10 days unsigned:** the row is stamped `unsigned_closed_at` (`closeStaleUnsigned`, `unsignedSweep.js:37-54`, constant `UNSIGNED_CLOSE_MS` `signLater.js:17`). A closed record keeps `awaiting_signature = true` on purpose (header comment `unsignedSweep.js:12-15`), which is what keeps it out of every reader that already filters on that flag. Migration `docs/schema/unsigned-escalation-migration.sql:19-29` adds `unsigned_alerted_at` and `unsigned_closed_at` to the same four tables (`flhas`, `incidents`, `inspections`, `near_misses`); reported applied live by the PR author, **not re-queried by this pass (`?`)**. Weak spot on the unguarded selects: same shape as NM-8, see U-5.

**Anchors.** Line numbers in this subsection were read on the working tree over `2a90e83`, which also carries uncommitted hardening (list/`loadSignState` missing-column fallbacks, `ALERT_SCAN = 50` / `SEND_BUDGET_MS`, closed FLHA amend refusal), so cites into `unsignedSweep.js`, `signLater.js` and the three handlers can sit a few lines off the commit. Re-read after that lands.

**New join columns.**

| Column | Written by | Read by |
|---|---|---|
| `unsigned_alerted_at` | claimed (conditional update) before the email, handed back to null if nobody could be told (`unsignedSweep.js:94-102,113-118,153-158`) | only the sweep (`:76`, `:101`); no UI reads it |
| `unsigned_closed_at` | `closeStaleUnsigned` (`unsignedSweep.js:42-46`); filtered `awaiting_signature = true`, `unsigned_closed_at is null`, `signature_requested_at` older than 10 days | `completeSignature` refuses (`signLater.js:55,76,95`, and the write itself is guarded `.is('unsigned_closed_at', null)` `:104`); `my_unsigned` hides it (`flhas.js:548`, `reports.js:415`, `logs.js:714`), so the worker menu count (`WorkerMenu.jsx:173-176`) drops it; list returns it (`flhas.js:606`, `reports.js:476`, `logs.js:776`); My Documents and worker profile map it as `unsignedClosed` (`customforms.js:536-546,583-588`; `companydata.js:930-940,991-996`); crew lead list (`customforms.js:455,516`) and `CrewScreen.jsx:72,200`; labels `Dashboard.jsx:555,654,1142,1342,5748,5751`, `MyDocuments.jsx`, `WorkerProfileDrawer.jsx` |

**Interaction rows (sign-later x the other features). A closed record is still `awaiting_signature = true`, so every row below is "excluded, same as an open unsigned record".**

| Feature | Open unsigned | Closed unsigned | Evidence |
|---|---|---|---|
| Notifications | no notice at save, one at `sign_now` | never announced at sign_now (cannot be signed); the 24 hour email goes out once to the audience, **no email at close** | `reports.js:390`, `flhas.js:523`, `logs.js:688`; `unsignedSweep.js:108-119`; nothing in `closeStaleUnsigned` sends |
| Brain | no signal until signed | none, ever | signals held behind `!signLater` (`logs.js:681`) and fired in `sign_now`; a closed row never reaches `sign_now` (`signLater.js:95`) |
| Corrective actions | none opened until signed | none, ever | `reports.js:390` (`runReportFollowUps`), `logs.js:681` (`runInspectionFollowUps`); `monthly.js:839,866` still labels a CA whose source is unsigned "Report awaiting signature" (`Dashboard.jsx:1944`), **and does not select `unsigned_closed_at` (`monthly.js:783,790,800`)**, so a closed source reads as merely awaiting (U-4) |
| Maintenance, fuel, equipment reports (inspection readings) | excluded by `readSignedOnly` | excluded the same way, no code change needed | `signLater.js:126-129`; callers `maintenance.js:173,391`, `fuellogs.js:145,283`, `equipmentreports.js:431,786`, `companydata.js:1835`. A reading on an inspection that closes unsigned is lost for good, by design |
| Auditor | hidden | hidden | `audit.js:111` (`.eq('awaiting_signature', false)`) |
| Crew lead list / CrewScreen | shown, labelled unsigned; CrewScreen "overdue" note | labelled "closed unsigned"; dropped from the CrewScreen unsigned note | `customforms.js:515-516`, `CrewScreen.jsx:72,200` |
| Supervisor review / approve / update | blocked 409 "hasn't signed yet" | **still blocked, forever, with the same wording** | `reports.js:506,562`, `flhas.js:660,742`, `logs.js:843` (re-anchored 2026-10-07); see #49 |
| Sign | author signs | refused 409 "closed unsigned after 10 days" | `signLater.js:95` |
| Amend (FLHA resubmit with `amendingId`) | author only, never changes the signature | at `2a90e83` the author could still amend a closed FLHA (`flhas.js:349-353` checked `awaiting` and author only). **The uncommitted working tree now refuses it: 403 "closed unsigned and can no longer be changed" (`flhas.js`, new line right after the `awaiting` check, `?` exact line).** Re-check: `grep -n "amendSignState.closed" api/flhas.js` | |
| PDF | stamped "AWAITING ... SIGNATURE", regeneration refused client-side | the stored PDF keeps that banner permanently; regeneration refused with the same "hasn't signed yet" alert | `generatePDF.js:332-337`; `Dashboard.jsx:2549,4404,4448,4680` |

**Every reader of `awaiting_signature` re-grepped on `2a90e83` (`grep -rn "awaiting_signature" api server-lib src`), and whether it needs `unsigned_closed_at` and lacks it:**

| Reader | Knows closed? | Needs to? |
|---|---|---|
| `server-lib/signLater.js` (`loadSignState`, `completeSignature`) | yes | |
| `api/flhas.js` list / `my_unsigned`; `api/reports.js`, `api/logs.js` the same | yes | |
| `api/flhas.js` approve and update, `reports.js` review and update, `logs.js` update | no, they read `awaiting` only | **no for safety** (a closed record stays blocked, which is wanted) **but yes for wording and for a way out**: see #49 |
| `api/audit.js:111` | no | no (hidden either way) |
| `api/customforms.js` crew documents, My Documents; `api/companydata.js` worker profile | yes | |
| `api/monthly.js:783-866` (corrective action source label) | **no** | yes, wording only (U-4) |
| `server-lib/documentSources.js` | no flag in `cols` | no (the callers add it) |
| `src/analyticsUtils.js:34-35` (`reviewBacklog`) and `src/Analytics.jsx:186` | no (awaiting rows stay outstanding, with a count) | **excluded (#49 resolved, `closedUnsigned` count returned `:42`)** |
| `src/Dashboard.jsx`: FLHA card `:343,555`, inspection card `:652-655`, near miss `:1140-1143`, incident `:1340-1343`, lists `:5748-5752` | yes | |
| `src/Dashboard.jsx` incident/near-miss row badge `:983`, FLHA list badge `:5893`, inspection list badge `:6034` | **no**, they print "AWAITING SIGNATURE" on a closed record | yes, wording (U-4) |
| `src/Dashboard.jsx` review counts `:4876,4911,5392-5393`, `awaitingSignOff` `:4294` | no | **excluded** (`!n.unsigned_closed_at`, #49 resolved); `:4294` is right as is |
| `src/Dashboard.jsx` PDF / regenerate guards `:2549,4404,4448,4680` | no | wording only |
| `src/CrewScreen.jsx:72` | yes (excludes closed), but `:74,79` do not | no |
| `src/SignAfterwards.jsx`, `src/WorkerMenu.jsx` | via `my_unsigned`, which excludes closed | no |
| Brain, `companyBrainSummary`, bulk export (`Dashboard.jsx:2507-2512`), monthly report, weekly reports | bulk export now skips awaiting FLHAs (`:2512`); the rest do not read the flag | not reachable: nothing is written for an unsigned record, so nothing to exclude (Brain / CA); bulk export re-read 2026-10-07, closed (W-S7) |

**New break.**

### #49 — A record closed unsigned can never be reviewed or approved, and still counts as outstanding (RESOLVED by decision A, 2026-10-07; the counting half is in code)
- **Resolution (Dillon, 2026-10-07, decision A: a record closed unsigned does not count as outstanding).** Read in code: `reviewBacklog` drops closed rows from the backlog and reports them separately as `closedUnsigned` (`src/analyticsUtils.js:34-35,41`); the Review tab and Overview "needs review" counts filter them out (`src/Dashboard.jsx:4876,4911,5392-5393`); the badge says "CLOSED UNSIGNED" (`:983,5902,6043`). What decision A does not change, on purpose: `review` / `approve` still refuse a closed record (`reports.js:502-504`, `flhas.js:737-739`), so a closed high-risk FLHA stays `pending_approval` and can only be deleted. The original text below is kept for history and its counts are no longer true. U-4 wording drift (`reports.js:560`, `flhas.js:657`, `logs.js:842`) is separate and still stands. (`?` the exact wording of decision A came from the instruction that opened this edit; the code matches "exclude from counts".)
- **What a customer loses.** After 10 days an unsigned incident or near miss is closed, nobody can sign it, and the supervisor's review button still answers "The author hasn't signed this report yet", for ever. The Review tab and the Overview "needs review" badge keep counting it, and Analytics adds it to "outstanding", so a company's review backlog never reaches "caught up" because of reports the product itself has told everyone are dead. The close email text and the FLHA card both say a closed record "is not counted" (`Dashboard.jsx:557`, `unsignedSweep.js:141`); the review numbers do count it. A closed FLHA that was high risk stays `pending_approval` and `approve` refuses it (`flhas.js:737-739`), with no way to dispose of it except delete (`flhas.js:701`).
- **Evidence (absence).** Review gate reads `awaiting` only: `reports.js:502-504`. Counts: `Dashboard.jsx:4867,4902` (`!n.reviewed`), `:5383-5384`, `analyticsUtils.js:31-39` (`outstanding: total - reviewed`, `awaitingSignature` counts closed rows, `:38`) printed as ", N of them not signed yet" (`Analytics.jsx:186`). None of them test `unsigned_closed_at`.
- **Fix would touch.** Either exclude closed rows from the review counts and Analytics backlog (`Dashboard.jsx`, `analyticsUtils.js`), or let a supervisor mark a closed record reviewed with an explicit "closed unsigned" acknowledgment (`reports.js` review, `flhas.js` approve), or both. A decision for Dillon: should a closed-unsigned report count as outstanding or not. The FLHA analytics question (W-S5) is the same family and is still open.
- **Re-check.** `grep -n "unsigned_closed_at" src/analyticsUtils.js` (empty = still open); `grep -n "unsigned_closed_at\|closed" api/reports.js | grep -n "review"`; `sed -n 500,505p api/reports.js`.

**Weak points on the escalation (verified on `2a90e83`, none approved to fix, not numbered).**
- **U-1. The heads-up bypasses the per-person email cooldown.** `unsignedSweep.js` never calls `claimSlot`/`refundSlot` (`grep -n claimSlot server-lib/unsignedSweep.js` is empty; the cooldown exists "to keep a flood off the shared sender", `notifyRouting.js:55`, `claimSlot` `:308`). Bound: one email per person per document type per run, at most `ALERT_BATCH = 10` records per table per run (`unsignedSweep.js:25`; the uncommitted tree scans `ALERT_SCAN = 50` rows and counts only routed ones against the 10), every 10 minutes. A person can get up to four such mails per run and, as records tip over 24 hours at different times, a steady trickle instead of one digest. Low to medium.
- **U-2. A record the sweep cannot tell anyone about is marked alerted for good if the Notify switch is off or the audience is empty.** `if (!routed.enabled || routed.recipients.length === 0) continue;` (`unsignedSweep.js:119`) comes after the claim (`:94-102`) and before the claimed list (`:121`), so the hand-back at `:153-158` never sees it. (A suspended company's rows are also stamped alerted without a send, deliberately, in the uncommitted tree.) Only an error (`reason === 'error'`, `:113-118`) or a failed send (`:153-158`) hands the claim back. Turn Notify on a week later and nobody hears about the already-claimed records. Intended or not is Dillon's call; it means the 24 hour mail is "once if anyone was set up to hear it that day".
- **U-3. Nobody is told when a record closes, and the author is never emailed at 24 hours.** The close step sends nothing (`unsignedSweep.js:37-54`), and the author is skipped by `pickRecipients` (`notifyRouting.js` `add`: `Number(person.id) !== authorId`), so the worker who owes the signature relies on the menu badge. The email wording says "the worker's signature" (`:141`), which is what a supervisor reads, correct for them.
- **U-4. Wording drift on closed records.** Three Dashboard badges print "AWAITING SIGNATURE" on a closed record (`Dashboard.jsx:983,5893,6034`), the corrective-action chip says "Report awaiting signature" (`:1944`, source `monthly.js:839,866`), and the supervisor, PDF and amend guards say "hasn't signed yet. Edit it once they have" (`reports.js:560`, `flhas.js:657`, `logs.js:842`) although they never can. Customer-visible, harmless to data.
- **U-5. (partly addressed in the uncommitted working tree.) Missing-column risk is the same family as NM-8.** `get_my_documents`/`get_worker_profile` selects now also include `unsigned_closed_at` in plain `.select()` (`customforms.js:536-546`, `companydata.js:930-940`): on a database without the escalation migration they error to empty lists, silently. The `list` and crew-documents paths retry without the column (`customforms.js:455-456`, `reports.js:476`), and the uncommitted tree adds a retry that keeps `awaiting_signature` when only `unsigned_closed_at` is missing (`flhas.js`, `reports.js`, `logs.js` lists, and a `mid` select in `loadSignState`). `get_my_documents` and `get_worker_profile` are still unguarded. The migration is reported applied live (`?`).
- **Not a break, recorded so it is not rediscovered.** The sweep runs in the digest cron and not in its own function (no function-budget change). `closeStaleUnsigned` and the alert both use the service-role client and stay inside the row's own `company_id` for every write (`unsignedSweep.js:97-98,115,156`); the close update filters by the stale rows only and writes the same column on every company's rows, which is intended.
- **Re-check.** `grep -rn "unsigned_closed_at" api server-lib src | grep -v "^server-lib/unsignedSweep.js"`; `grep -n "claimSlot" server-lib/unsignedSweep.js` (empty); `grep -n "alertOverdueUnsigned\|closeStaleUnsigned" api/cron-notification-digest.js`; `node --test tests/unit/unsigned-sweep.test.js`.

### `source_type` → `company_signals` (the Brain's input)
| Writer | source_type |
|---|---|
| `api/flhas.js:436` | `flha_edit` |
| `api/reports.js:303` | `incident`, `near_miss` |
| `api/logs.js:442` | `toolbox_talk` |
| `api/logs.js:466` (PR #118) | `equipment_inspection` |
| `api/monthly.js:470` (PR #118) | `monthly_inspection` |
| `api/logs.js:484` (PR #120) | `daily_report` (working conditions only) |
| `api/portal.js:608` (2026-09-29) | `portal_escalation` |

Re-read 2026-09-29 (`grep -rn "source_type:" api/`): 8 source types.
Custom documents and corrective actions write nothing **on purpose** (see
break #4, closed, and its two documented exclusions). Equipment-inspection
defects **do** reach the Brain (`api/logs.js:466`). Line numbers in this
table were re-anchored 2026-09-29; the earlier values (`:370`, `:231`,
`:244`) had drifted.

**`portal_escalation` carries** `{document, question, department}` and nothing
else (`server-lib/portalSignals.js:29`): never the answer value, never the
worker. Written only after the `portal_escalations` insert actually succeeded
(`api/portal.js:587-600,604`), because that insert's returned `error` is now
checked, which also stops the department email going out for an escalation
that failed to save. **Portal assignment health is not a signal row.**
Completion and overdue counts per department are computed at summary time by
`loadPortalHealthLines` (`portalSignals.js:96`, filtered by the company id
at `:99`, `:106`), called from `runCompanyBrainSummary`
(`companyBrainSummary.js:226`) and passed into the prompt as `extraLines`
(`:151,169`). Because the call sits inside the loop after the
`MIN_NEW_SIGNALS = 5` check (`:37`, `:217`), assignment health only reaches
the profile for a company that also has 5 new signals.

A source type is only half-wired by its writer. `bySourceType` in
`api/companydata.js:1639` drops any type missing from its map, so an
unlisted signal is captured and summarized but invisible in the Brain tab.
`AdminPanel.jsx` and `server-lib/companyBrainSummary.js` are the other two
places that must learn it.

### `source_type` / `source_id` → corrective actions
Since PR #118, `corrective_actions` keys on `(source_type, source_id)` with
a real `company_id`, the same shape `company_signals` uses. `answer_id`
survives, nullable, so the foreign key to `inspection_answers` still holds
for monthly rows; a CHECK keeps it set if and only if
`source_type = 'monthly_answer'`.

| Writer | source_type |
|---|---|
| `api/monthly.js` | `monthly_answer` |
| `api/reports.js` | `incident`, `near_miss` |
| `api/logs.js` | `equipment_inspection` (pre-trip **and**, since #11, post-trip) |

All four go through `server-lib/correctiveActions.js`. **This was break #5
below.**

Since PR #121 the relationship also runs the other way: a post-trip can
**close** an action and record the repair
(`api/logs.js:493`, `server-lib/correctiveActions.js:273-356` as of `afc4b93`), writing a
`field_service` row to `equipment_maintenance_log` (`api/logs.js:513`) —
never `pm_service`, which would reset the machine's PM clock. That made
corrective actions the fourth writer of that table, alongside
`api/maintenance.js:270` (`log_field_service`), `api/maintenance.js:333`
(`log_service`) and `api/companydata.js:748`. **This was break #11 below.**

---

### `document_notifications` + `document_notification_state` + `notifyRouting` (who is emailed about a new record, and how often; branch `claude/notify-routing-core`, `d4487d2` and cooldown `1488a5b`, placed 2026-10-07)

**Pending by design: the module is built and, as of PR 3 (branch `claude/notify-wire-flha-logs`, `1ebc5ec`, 2026-10-07, on top of PR 2 `1475b5e`), six of the eight document types call it through the shared helper `server-lib/notifyAudience.js`: incident, near miss (`api/reports.js:392,456`), FLHA (`api/flhas.js:515,572`), equipment inspection (`api/logs.js:689,755`), toolbox and daily (`api/logs.js:689`). **Update, PR 4 (branch `claude/notify-wire-monthly-custom`, `c9d0049`, 2026-10-07): monthly (`api/monthly.js:500`) and every custom form (`api/customforms.js:733`, key `custom_<formId>`) now call it too. Still unwired: Fuel Log (a key in `DOCUMENT_LABELS`, `notifyRouting.js:93`, and in the table CHECK, with no call in `api/fuellogs.js`), and (superseded) nothing writes the Owner's switch: PR 5 (`6afe46b`, PR #194) added the writer, `server-lib/notifySettings.js:73`. P4 is closed in §4.** PR 1 of 5 built the module; PR 2 wired two of the eight. At PR 1 the only files that mentioned it were the three below (`server-lib/notifyRouting.js`, `docs/schema/document-notifications-migration.sql`, `tests/unit/notify-routing.test.js`); at `1475b5e` `api/reports.js` is the fourth (`:17,160`).

**Two tables, both about to be applied live, NOT confirmed applied (`?` for both).** The migration file still says "NOT YET APPLIED" (`docs/schema/document-notifications-migration.sql:3`) and this pass could not query the live database, so neither is recorded as applied. Re-mark each only after a live check (`:59-63` verification queries). Table 1, `document_notifications`, `:26-36`: `company_id` FK to `companies` (`:28`), `document_key` (`:29`), `enabled boolean default false` (`:30`), `extra_roster_ids bigint[]` (`:31`, a roster id list with no FK, so the application checks membership), `unique (company_id, document_key)` (`:34`), RLS on with no policies (`:39`). The CHECK on `document_key` (`:35`) is the 8 built-ins `flha, inspection, toolbox, nearmiss, incident, daily, monthly, fuellog` plus `custom_<n>`; it matches `DOCUMENT_LABELS` (`notifyRouting.js:70-79`) and is a subset of `BUILTIN_DOC_KEYS` (`api/customforms.js:132`), so it carries none of the 5 non-document keys and no `portal_<n>` (Portal already emails its own departments, migration comment `:13-14`). The module tolerates the table missing: `loadNotifySetting` treats `42P01`/`42703`/`PGRST205`/`PGRST204` as "off" (`notifyRouting.js:58-59,184`), so shipping the code ahead of the SQL changes nothing.

**Table 2, `document_notification_state` (cooldown, `1488a5b`), also `?` live.** `docs/schema/document-notifications-migration.sql:48-55`: primary key `(company_id, document_key, roster_id)` (`:54`), `company_id` FK to `companies` on delete cascade (`:49`), `roster_id` FK to `roster` on delete cascade (`:51`, a real FK, unlike `extra_roster_ids`), `last_sent_at timestamptz` (`:52`), `suppressed_count integer >= 0` (`:53`), RLS on with no policies (`:57`). No CHECK on `document_key` here (the sibling table has one, `:35`); the only writer is `saveState`, which writes the key it was handed. Holds no content and no address (`:47`). Rollback drops it first (`:66-67`). **Cooldown, read in code:** `COOLDOWN_MS` = 10 minutes (`notifyRouting.js:68`); `applyCooldown` splits recipients into send and hold (`:279-289`); `loadState` reads rows for this company, document and the audience's roster ids (`:291-300`); a held person has `suppressed_count + 1` written back with `last_sent_at` unchanged (`:324-327`); a sent person gets `last_sent_at = now`, count reset to 0 (`:342`), and the email says "N more ... submitted since your last notice" (`:336`). **Fail-closed, unlike the settings table:** a state read error returns `reason: 'error'` and sends nothing (`:322`), and `loadState` does NOT use `isMissingSchema` (`:298`). So the two tables differ on purpose: settings table missing means off (`:184`), state table missing while a document is switched on means nobody is emailed. See W-N4.

**Join keys it reads** (all read-only, all company-scoped with `.eq('company_id', ...)`):

| Key | Where read | Agrees with |
|---|---|---|
| `roster.departments`, `roster.divisions`, `roster.default_site_id` | `loadRoster` select (`notifyRouting.js:196`; retried without `is_lead` on a missing column, `:195-201`), folded into an actor by `actorFor` (`:97-109`: site set = default site plus every site of the person's divisions, the same construction as `documentAccess.js:140-151`) | `recordInScope` (`documentAccess.js:331-343`) and `inCrew` (`leadAccess.js:36-41`), both imported (`notifyRouting.js:54-55`) and called with the same actor shape (`:148,150`) |
| `roster.is_lead` | `notifyRouting.js:149` (`role === 'worker' && is_lead === true`, the same test as `documentAccess.js:166`) | a lead is told only when the author is on their crew (`:150`), so an anonymous record (no author) never reaches a lead (`:149`), matching W-L4 |
| `roster.is_owner` | `:145,156` (Owner is skipped in the main pass and used only as the fallback when nobody else was chosen) | the Owner bypass in `loadActor`; the fallback is the one place an Owner is told |
| `roster.email` | `:196,203` through `withDecryptedEmail` (`fieldCrypto.js:90`); a person with no single valid address is counted in `missingEmail` and skipped (`:163-166`) | the encrypted-at-rest email column; nothing here writes it |
| `sites.division_id` | `loadDivisionSites` (`:226-237`): `sites.id, division_id` for the divisions on the roster, company-scoped | the writer is `set_site_division` (`api/companydata.js:1437`, see the assignments section and #46) |
| `submitted_by_roster_id`, `site_id` on the record | `pickRecipients` (`:130,148`) and the author lookup (`:252-260`, falls back to a direct roster read when the author is no longer active) | the author stamp the eight document tables carry (§2 `roster_id`); an unstamped record has a null author and is placed by `site_id` alone |
| `document_notifications.enabled`, `extra_roster_ids` | `loadNotifySetting` (`:176-190`); an extra id is added only if it is in the company's active roster (`:141-142`, `byId` is built from the company-scoped roster) | the Owner's switch. **Writer landed, PR 5 (branch `claude/notify-owner-toggle`, `6afe46b`, PR #194): `saveNotifySetting` upsert on `company_id,document_key` (`server-lib/notifySettings.js:73`; same pair as the unique constraint, migration `:34`)** |
| `document_notification_state.roster_id`, `last_sent_at`, `suppressed_count` | `loadState` (`:291-300`, company and document scoped, `.in('roster_id', ...)`), written by `saveState` upsert on `company_id,document_key,roster_id` (`:302-307`) | `roster_id` is the same id `pickRecipients` returns (`:167`) and the table's PK matches the upsert's `onConflict` (`:305`, migration `:54`); written only by this module, read only by this module |

**Rules checked in code.** Author never told (`:139`); supervisors by `recordInScope` (`:148`); workers who are leads by `inCrew` (`:150`); extras added on top (`:142`); Owner only when nobody else was chosen (`:154-158`); one email per person per cooldown window (`:334-343`, `to: r.email`); capped at `MAX_RECIPIENTS = 25` (`:63,169-172`); a failed send is logged, never thrown (`:344-347,350-353`); body names the document and site only (`:339-340`).

**Consumers: three handler files, six of eight document types, one shared helper (PR 3, re-read at `1ebc5ec`).** `notifyOnSubmit` is now imported by exactly one file, `server-lib/notifyAudience.js` (`:21`, call `:38`). The helper was moved out of `api/reports.js` and `api/reports.js` now imports it (`reports.js:17`). `api/flhas.js` (`:19`) and `api/logs.js` (`:20`) import it too, as do `api/monthly.js` (`:8`) and `api/customforms.js` (`:8`) as of PR 4. `WIRED_DOCUMENT_KEYS` is `incident, nearmiss, flha, inspection, toolbox, daily` (`notifyAudience.js:24`); any other key returns at once (`:28`), so wiring a new document needs its key added there in the same change (comment `:18-19`). `routeNotification` is called only inside `notifyRouting.js`. Done: PR 2 incident and near miss, PR 3 FLHA, inspection, toolbox and daily. **PR 4 (`c9d0049`) added two more: `api/monthly.js:500` and `api/customforms.js:733`; `WIRED_DOCUMENT_KEYS` now also holds `monthly` (`notifyAudience.js:24`) and a `custom_<n>` key is accepted by the pattern `CUSTOM_KEY` (`:26`, tested `:30`), so custom forms need no per-form registration.** Not done: Fuel Log (`api/fuellogs.js` has no call; `grep -n notifyAudience api/fuellogs.js` is empty); PR 5, the Owner toggle, has since landed (`6afe46b`, PR #194): `src/NotificationSettings.jsx` under `DocumentAssignmentsManager`, writing through `set_document_notification` (`companydata.js:1422`). See the PR 5 notes in the weak-points list.

**Call sites (PR 2 and PR 3), join keys read there. `site_id` source per document (read at `1ebc5ec`):**

| Document (`documentKey`) | Call site | `siteId` passed | Where that value comes from | `authorId` passed |
|---|---|---|---|---|
| `incident`, `nearmiss` | submit `reports.js:392`; sign_now `:456` | `recordToInsert.site_id ?? null` (`:393`); stored `row.site_id` (`:456`, selected at `:449`) | `resolveSiteId` rewrites a supplied `site_id` to a validated id or null (`:324-327`) | `authorRosterId(session, { isAnonymous })` (`:394`); stored `submitted_by_roster_id` (`:456`). Anonymous near miss is null |
| `flha` | submit `flhas.js:515`; sign_now `:572` | `recordToInsert.site_id ?? null` (`:516`); stored `after[0].site_id` (`:572`, selected `:568`) | `site_id` is in the FLHA's allowed fields (`:169`) and validated by `resolveSiteId` (`:436-439`). `job_site` free text is never used | `authorRosterId(session)` (`:517`); stored `submitted_by_roster_id` (`:572`) |
| `toolbox`, `daily` | submit `logs.js:689` (one call for all of `logs.js`'s types, key `table.docKey`) | `recordToInsert.site_id ?? null` (`:690`) | `site_id` is submittable for both (`:189,194`) and validated by `resolveSiteId` only when the key is present in the body (`:574-577`). The free-text `site` is never used. No `site_id` sent means null, so the record is placed by author alone | `authorRosterId(session)` (`:691`). No sign_now call: toolbox and daily have no sign-later (`signLater` is true only for inspections, `:623`) |
| `inspection` | submit `logs.js:689`; sign_now `:755` | submit: `recordToInsert.site_id ?? null`, always null because `site_id` is not in the inspection's submittable fields (`:185`); sign_now: literal `null` (`:755`) | **Inspections carry no site** (comment `:131-133`, `scopeColumns` selects no `site_id` for `inspections`, `:134-137`). The machine is the join, not a site | `authorRosterId(session)` (`:691`); stored `row.submitted_by_roster_id` (`:748,755`) |

**Uncommitted working-tree edits on top of `1ebc5ec`, seen and placed by this pass (not in any commit, so `?` until committed; every `flhas.js` anchor after `:406` and every `logs.js` anchor after `:692` in this section is against the working tree and sits 9 and 1 lines later than the commit).** (1) A third FLHA call site, the amend path: `api/flhas.js:407-415` notifies once when an amendment moves the record to `pending_approval` from another status (`amendUpdate.status === 'pending_approval' && existing[0].status !== 'pending_approval'`), with `siteId` taken from `amendUpdate.site_id` if the amendment changed it, else the stored `existing[0].site_id` (select widened to `status, site_id`, `:310`), and `authorId` from `authorRosterId(session)`. Ordinary edits stay quiet. It sits inside the amend branch that already ran `requireDocKey` (`:295`); that this branch's `amendUpdate.site_id` has been through `resolveSiteId` is supported by `:364-367`. (2) A new optional `skipId` on `notifyAudience` (`notifyAudience.js:26,42`) becomes `record.skip_roster_id`, which `pickRecipients` excludes from everyone added (supervisors, leads, named extras, `add` at `notifyRouting.js:165-168`) and from the Owner fallback (`:185`); `logs.js:692` passes `session.enteredBy ?? null`, so a crew lead who typed a Daily Report or Fuel Log in on a worker's behalf is not emailed about their own entry (on-behalf, `logs.js:634`). Join: `skipId` is a `roster.id`, the same id space as `authorId`. Caller count for the break-hunter: FLHA now has three calls (submit, amend-to-pending, sign_now).

Consequence, product terms: an inspection can only reach people by author and crew, never by "everyone at the Hwy 9 site"; a supervisor scoped to a site (`recordInScope`) is not told about an inspection unless the rules place a site-less record in their scope, which this pass did not trace in `documentAccess.js` (`?`). A toolbox or daily filed without choosing a site from the dropdown (so `site_id` absent while `site` text is set) is routed as site-less. Not a break today because nothing can switch the notice on (P4); worth a decision at PR 5.

**Call site in `api/reports.js` (PR 2), join keys read there, re-anchored at `1ebc5ec` (the helper now lives in `server-lib/notifyAudience.js`; the older `reports.js:151-170` helper anchors below no longer exist):**

| Key | Where it comes from | Agrees with |
|---|---|---|
| `companyId` | `session.companyId` (`notifyAudience.js:29,40`), never the request body | the `company_id` the row was inserted with and the `.eq('company_id', ...)` in the module's loaders |
| `site_id` | `recordToInsert.site_id ?? null` on submit (`reports.js:393`), after `resolveSiteId(supabaseAdmin, session.companyId, ...)` rewrote it to a validated id or null (`:324-327`); on sign_now the stored `row.site_id` re-read from the table (`:449-451,456`) | `sites.id` (the record's FK), which `recordInScope` then compares to the supervisor's site set. A record filed with no `site_id` key reaches `notifyAudience` as null (undefined coalesces), so it is placed by author alone |
| author | `authorRosterId(session, { isAnonymous })` on submit (`reports.js:394`); stored `row.submitted_by_roster_id` on sign_now (`:449,456`) | `submitted_by_roster_id` on `incidents` / `near_misses`. Anonymous near miss is null by design (`authorStamp.js` plus the DB CHECK), so it is never routed to a lead |
| `sites.name` | one lookup in `notifyAudience`: `sites.select('name').eq('id', siteId).eq('company_id', session.companyId)` (`notifyAudience.js:35`) | used only as the email's place label (`:43`); looked up from the validated id, never from worker-typed text (comment `:10-12`) |
| `documentKey` | the handler's `type` (`reports.js:392`), `incident` or `nearmiss`; `'flha'` literal (`flhas.js:515,572`); `table.docKey` or literal `'inspection'` (`logs.js:689,755`) | `DOCUMENT_LABELS` (`notifyRouting.js:70-79`) and the table CHECK; all six spellings match `BUILTIN_DOC_KEYS` (`customforms.js:132`) and `pricing.js` `docKeys` (`flha, toolbox, incident, nearmiss` at `:65`; `inspection` at `:71`; `daily` at `:90`) |

**Gate order (W-N2 answered for all six callers).** Every call sits behind `requireDocKey` for the same key: incident and near miss submit `reports.js:272` and sign_now `:435`; FLHA submit `flhas.js:295` and sign_now `:556`; logs submit `logs.js:521` and inspection sign_now `:739` (key `table.docKey`). Each runs before the record is saved or the signature accepted, so `notifyAudience` is only reachable for a document the company has switched on. The helper also returns without sending when `RESEND_API_KEY` is unset (`notifyAudience.js:30`) and for a suspended company (`:31-32`; FLHA and reports submit already refuse a suspended company, `flhas.js:299-301`, `reports.js:276-277`, but sign_now has no such check, which is why the helper has its own). Failure is swallowed and logged (`:45-47`); the record is already saved.

**PR 4 call sites: Monthly Inspection and custom documents (placed 2026-10-07, branch `claude/notify-wire-monthly-custom`, `c9d0049`, PR #193).** Both are single-step submits with no sign-later, so each notifies at save, once per new record.

| Caller | Document key | `site_id` provenance | `authorId` | Label |
|---|---|---|---|---|
| `submit_monthly`, `api/monthly.js:500-503` | literal `'monthly'` (in `WIRED_DOCUMENT_KEYS`, `notifyAudience.js:24`; matches `DOCUMENT_LABELS` and the CHECK) | request `siteId`, required (`monthly.js:312`) and checked against `sites` with `company_id === session.companyId` or 403 (`:316-319`); the same `siteId` is the one inserted on the record (`:385`). So the site is always a real, company-owned `sites.id`, never null and never free text | `authorRosterId(session)` (`:502`), the same value stamped on the row (`:387`) | `DOCUMENT_LABELS.monthly` |
| `submit_custom`, `api/customforms.js:733-737` | `` `custom_${formRows[0].id}` `` (`:733`), accepted by `CUSTOM_KEY = /^custom_[0-9]+$/` (`notifyAudience.js:26,30`); matches the table CHECK `custom_[0-9]+` (`document-notifications-migration.sql:35`) and the key `requireAssignment` and `requireCustomDocKey` use | request `siteId`, required (`customforms.js:642`) and company-checked or 403 (`:646-649`); the same `siteId` is inserted (`:691`). Always a real `sites.id` | `authorRosterId(session)` (`:735`), same as the row (`:693`) | `documentLabel: formRows[0].title` (`:736`), read from `custom_forms.title` in this request's company-checked select (`:650`), then run through `cleanLabel` (`notifyRouting.js:100`, used at `:360`) |

Neither site is the free-text kind: unlike toolbox and daily, which can be filed with no `site_id`, both new callers refuse a submit without a valid `siteId`, so the supervisor's site scope is always applied to a real site.

**Gate order for PR 4 (W-N2 answered for both).** `submit_monthly`: role check `:295`, `requireDocKey(..., 'monthly')` `:296`, `requireAssignment(..., SUBMIT)` `:298`, suspended-company check `:300-303`, site and form company checks `:316-323`, insert, answers and corrective actions, Brain signal, then `notifyAudience` `:500`. `submit_custom`: role check `:629`, suspended check `:630-633`, site check `:646-649`, form company check `:651-653`, `is_active` `:657`, **`requireCustomDocKey` `:660`** (`docKeyGate.js:152`), **`requireAssignment(..., custom_<id>, SUBMIT)` `:662`**, insert, answers, then `notifyAudience` `:733`. Both gates run before the record is saved and before the notify call, so the audience hears only about a document the company has paid for, switched on and assigned to the author. Idempotent retries return before the notify call (`monthly.js:345-347`, `customforms.js:683-685`, and the race branches), so a retried queued submission never emails twice; the cost is that a crash between insert and notify loses that one notice, which is acceptable for a best-effort email. The notify call sits after the answers loop in both, so an answer-insert failure that is not caught would skip it (neither loop throws on a failed insert: `monthly.js:448`, `customforms.js:728` ignore the error).

**Digest cron and custom keys (question 4).** The cron needs nothing new to carry a custom key: `claim_held_notices` is keyed on `document_key` text with no list of known keys, and `runDigest` reads settings for whatever keys the claimed rows hold (`notifyDigest.js:56-57,68`). What it cannot do is name the form: `DOCUMENT_LABELS[row.document_key] || 'Custom document'` (`notifyDigest.js:92`), because the form title is not stored on `document_notification_state`. So the immediate email names the form (`documentLabel`) and the digest says "Custom document", the narrower W-N3 already recorded. `DOCUMENT_LABELS` has no `custom_<n>` entry (`notifyRouting.js:93` region), so `notifyOnSubmit` falls to the passed label (`:360`). The digest's lack of a doc-key gate (W-N7) applies equally to `monthly` and `custom_<n>`.

**Interaction with sign-later (notify when signed, read in code, re-read at `1ebc5ec`).** The rule is the same for all three sign-later documents: no notice at save, one notice at `sign_now`.
- **Incident and near miss.** On `submit`, `notifyAudience` runs only inside `if (newId && !signLater)` (`reports.js:390-396`), the same block as `runReportFollowUps`. A named report with no signature is forced into sign-later (`:361`), so in practice a notice goes out at submit only for a report that arrived already signed. The sign_now notice runs after `completeSignature` succeeds (`:443-448`) and after `runReportFollowUps` (`:454-456`).
- **FLHA.** Submit notifies only inside `if (newId && !signLater)` (`flhas.js:514`); a FLHA with no valid drawn signature and an individual sign-in becomes sign-later (`:472-476`). `sign_now` notifies after `completeSignature` (`:566-567`), from the re-read row (`:568-573`).
- **Equipment inspection.** Submit notifies inside `if (newId && !signLater)` (`logs.js:688`), where `signLater` is `type === 'inspection' && record.sign_later === true` (`:623`). `sign_now` notifies after `completeSignature` (`:745-746`) and after `runInspectionFollowUps` (`:753,755`). Toolbox and daily have no sign-later, so `!signLater` is always true for them and they notify at save.
- **Once per record.** A second `sign_now` on the same record is a 409 "already signed" (`signLater.js:92`) and returns before the notify call, in all three handlers. The audience hears about a record at most once, at the moment it counts, the same moment its Brain signal and corrective actions fire. Consequence to know, not a break: a supervisor is never told that a worker has an unsigned record outstanding, and ~~a record that is never signed is never announced (the 24 hour overdue helper has no caller, `signLater.js:106`, W-S-series)~~ **CLOSED 2026-10-07 (`2a90e83`, PR #195): `alertOverdueUnsigned` (`server-lib/unsignedSweep.js:60`) emails the same audience once at 24 hours, called from `api/cron-notification-digest.js:47`. The first half of this sentence still holds: the audience is told about a record at sign_now, and the author is never in the audience (`notifyRouting.js` `add` skips `authorId`), so the person who owes the signature is not emailed.** The flag is read from the table on sign_now, not from the request. An inspection is also announced only after `runInspectionFollowUps`, so an error inside it that is not caught would skip the notice; that helper was not traced here (`?`).

**Weak points recorded before the first consumer (not numbered; for the PR 2 to PR 5 authors to decide, none approved to fix):**
- **W-N1. (CLOSED in PR 1 by the security review fixes.)** `notifyRouting.js` now reads the document's active `view` rows (`loadViewRows`) and runs `evaluateAccess(..., VIEW)` on every candidate, extras included, so a restricted-out supervisor, lead or named extra is not told; the Owner is never restricted. Tests in `tests/unit/notify-routing.test.js` cover a department-restricted document and an extra with no view right. The original finding follows. **W-N1 (original). The header says the audience is "exactly the people who could open the record" (`notifyRouting.js:4`), but `view` assignment rows are not consulted.** The module imports `recordInScope` and `inCrew` only (`:30-31`); the check a reader runs, `requireAssignment(..., 'view')` / `evaluateAccess` (`documentAccess.js:270-282`), is never called, so a supervisor or lead whom the Owner has restricted away from a document by a `view` row is still emailed that a record exists (the email carries no content, `:25-26`, so what leaks is the fact of a submission and its site). Also not consulted: auditors (never told, which is probably right) and the `author`'s site when the record has none.
- **W-N2. No doc-key gate (question 4).** `routeNotification` does not call `isDocKeyActive` (`grep -n "isDocKeyActive" server-lib/notifyRouting.js` is empty, re-run at `1488a5b`). Harmless while every caller is a submit handler that already passed `requireDocKey`, but a caller that skips it (a cron, a replay) would email for a switched-off document. PR 2 to PR 4 should keep the call after the handler's own gate. **PR 2 and PR 3 do** (see "Gate order" above, all six callers); **PR 4 does too** (monthly `monthly.js:296`, custom `customforms.js:660,662`, both before the notify call, see "PR 4 call sites" above). All eight callers now sit behind their doc-key gate; the exposure remains only for a future cron or replay caller, and for the digest (W-N7).
- **W-N3. (Partly closed.) A custom document's label is generic by default.** `notifyOnSubmit` now takes an optional `documentLabel` (cleaned of line breaks and links); **PR 4 passes it** (`customforms.js:736`, `documentLabel: formRows[0].title`), so the immediate email names the form; only the digest still says "Custom document" (`notifyDigest.js:92`). Original note:  `DOCUMENT_LABELS` has no `custom_<n>` entry, so the email says "Custom document" (`:329`) and not the form's name; PR 4 will want the form name passed in.
- **W-N4. (CLOSED 2026-10-07.)** Both tables and `claim_notification_slot` were applied live together (migration `document_notifications_and_claim_slot`, then `claim_notification_slot_search_path`); RLS on, no policies, function executable by `service_role` only, checked live on ABC Earthworks. A claim that errors sends nothing to that person and is now logged (`claimSlot`).
- **W-N5. (CLOSED 2026-10-07, redesign `75a7ac5`.)** The cooldown is now one atomic database function (`INSERT ... ON CONFLICT DO NOTHING`, then `SELECT ... FOR UPDATE`, database clock), claimed BEFORE the send, with a burst of 3 emails per person per document per 10 minutes. Parallel submits cannot all pass. Verified by reading under READ COMMITTED and by calling the live function on ABC; the unit test stand-in cannot prove locking.
- **W-N6. (CLOSED 2026-10-07, branch `claude/notify-digest-cron`, `f64a993`.) Held notices are now reported by a digest.** Original finding: past the burst a notice was only counted (`suppressed_count`) and told to the person only if another notice arrived after the window, so the delay was unbounded, and a failed send was neither refunded nor counted. Now: `api/cron-notification-digest.js` runs every 10 minutes (`vercel.json:10`, `*/10 * * * *`), calls `runDigest` (`server-lib/notifyDigest.js:64`), which claims every row with `suppressed_count > 0` whose window has ended (`claim_held_notices`, `docs/schema/notification-digest-migration.sql:24-47`, window test `:37`) and sends one "N more were submitted" email per person per document (`notifyDigest.js:108-112`). **Delivery bound: about one window plus one cron interval, so roughly 10 to 20 minutes** (`COOLDOWN_SECONDS` 10 minutes, `notifyRouting.js:80`, plus the 10 minute cron). Not a hard guarantee: a run takes at most `DIGEST_BATCH = 200` rows (`notifyDigest.js:61`), so a backlog larger than that takes further runs. A failed send is refunded (see "Refund and digest" below). Still open and deliberate: a claimed row is dropped, not retried, when the person can no longer be told (`notifyDigest.js:101-104`).

**Refund and digest (placed 2026-10-07, branch `claude/notify-digest-cron`, `f64a993`). Closes W-N6.** Line anchors in the paragraphs above that cite `notifyRouting.js` `:279-354` predate the atomic claim redesign; current anchors are below.
- **Refund (producer side).** `refundSlot` (`server-lib/notifyRouting.js:321-331`) calls the live function `refund_notification_slot` (`notification-digest-migration.sql:50-62`), which subtracts `p_slots` from `sent_in_window` (floored at 0) and adds `p_held` to `suppressed_count` (capped at 999), keyed on `company_id, document_key, roster_id`, the same key `claimSlot` uses (`notifyRouting.js:294-301`). Best effort, logged, never throws (`:327,329`). Callers: `notifyOnSubmit` on a failed send, `{ slots: 1, held: claim.suppressed }` (`:371`), so a failed send neither locks the person out of the window nor loses a rollover count; and the digest, `{ held }` (`notifyDigest.js:87,117`).
- **Digest (consumer of `document_notification_state`).** `claim_held_notices` (`migration:24-47`) selects `suppressed_count > 0` and an ended window, `FOR UPDATE SKIP LOCKED`, and zeroes the count in the same statement, so overlapping runs cannot take the same row. `runDigest` then reads `document_notifications.enabled`, `roster` (`id, company_id, active, email`) and `companies.suspended` (`notifyDigest.js:79-83`), all filtered by the claimed company ids; the person is looked up by `company_id:roster_id` (`:93,99`), so a roster id cannot cross companies. Emails go through `withDecryptedEmail` (`:93`, `fieldCrypto.js:90`) and must pass `SINGLE_ADDRESS` (`:60,101`). Body carries a count and the document label only, no author, site or content (`:110-111`). If any of the three lookups fails, every claimed row is refunded and the run reports an error (`:85-89`).
- **Join keys agree.** `document_key` is read from the state row and mapped through `DOCUMENT_LABELS` (`notifyDigest.js:105`, `notifyRouting.js:84`), the same map `notifyOnSubmit` uses (`:345`); a `custom_<n>` row falls back to "Custom document" (the form title is not stored on the state row, so the digest cannot name it, a narrower form of W-N3). `roster_id` is the PK member the claim writes (`notifyRouting.js:298`).
- **Cron gating (question 4), mechanical check.** Protected by `CRON_SECRET` with a timing-safe compare (`cron-notification-digest.js:26-30`), like its siblings. `grep -n "isDocKeyActive" api/cron-*.js` is empty, and was empty for the three older crons too (their gating lives in the libraries they call, for example `api/equipmentreports.js:612`), so the digest is not an outlier. The digest's own gate is `document_notifications.enabled` (`notifyDigest.js:91,101`), not `isDocKeyActive` (`grep -n "isDocKeyActive" server-lib/notifyDigest.js` is empty). That is **W-N7** below.
- **No new cron for unsigned escalation (2026-10-07, `2a90e83`, PR #195).** `vercel.json:6-11` still lists four crons; the unsigned sweep runs inside this one, every 10 minutes, after `runDigest`: `alertOverdueUnsigned` (`cron-notification-digest.js:47`) then `closeStaleUnsigned` (`:48`). Branch with no `RESEND_API_KEY` or a bad encryption key: the early return still calls `closeStaleUnsigned` (`:41`) but not the alert (`:38-44`), so a mail outage delays heads-ups and never delays closing. The `cron_run` event carries `alerted` and `closed` (`:51`); both names were added to the metrics whitelist (`server-lib/platformEvents.js`, one line in the `2a90e83` diff, `?` for the exact line, not re-read). Gate (question 4): `CRON_SECRET` (`:30`) like its siblings; the alert goes through `routeNotification`, so it needs the document's Notify switch on, and it skips suspended companies (`unsignedSweep.js:87-92`), but it does not call `isDocKeyActive`, same as W-N2. The close step has no company, suspended or doc-key filter at all (`unsignedSweep.js:40-46`): it closes every company's stale rows, which is right (a record is a record). Mechanical check `grep -n "isDocKeyActive" api/cron-*.js` is still empty.
- **Platform health registration.** `CRONS` has `{ subtype: 'notification_digest', cadenceHours: 10 / 60 }` (`server-lib/platformHealth.js:44`). The cron records `eventType: 'cron_run', subtype: 'notification_digest'` (`cron-notification-digest.js:34-37`), status `error` when the claim failed or any send failed, metrics `claimed, sent, dropped, failed, duration_ms`. The subtype strings match exactly; overdue limit is `cadenceHours * 1.5h + 2h` (`platformHealth.js:76`), about 2.25 hours. Mechanical check, all four crons: `vercel.json:7-10` lists equipment-reports, company-brain-summary, portal-reports, notification-digest; `platformHealth.js:41-44` has the matching four subtypes; each cron file records the same subtype (`cron-equipment-reports.js:121`, `cron-company-brain-summary.js:42`, `cron-portal-reports.js:56`, `cron-notification-digest.js:35`). No orphan on either side.
- **Idle today. (SUPERSEDED 2026-10-07 by PR 5, `6afe46b`, PR #194.)** Nothing wrote `document_notifications` at `1ebc5ec`. The first writer is now `saveNotifySetting` (`server-lib/notifySettings.js:73`), reached by `set_document_notification` (`api/companydata.js:1422-1429`). Re-run: `grep -rn "document_notifications\|document_notification_state" api src server-lib | grep -v "^server-lib/notifyRouting.js"` lists `notifySettings.js:27,73` (read, write), `notifyDigest.js:56` (read), `companydata.js:1388,1417` and `NotificationSettings.jsx:31` (action names only, not the table). So a company can now switch a document on; the cron stops being a guaranteed empty run once any switch is on and a person passes 3 emails in 10 minutes. P4 is closed (see §4).
- **W-N7. (open, minor; re-assessed at PR 5, now WORSE: see W-N11) The digest has no doc-key gate.** If a company switches a document type off in `company_document_settings` but leaves its notification switch on, a held row still produces a digest email (`notifyDigest.js:91,101` test only `document_notifications.enabled`). Same shape as W-N2, one step later, and it covers `monthly` and `custom_<n>` as well as the earlier six since PR 4. Low impact: the email carries a count and a label only. A fix would add an `isDocKeyActive` check (`server-lib/docKeyGate.js:84`) per claimed company and key before sending, or have the Owner toggle write `enabled = false` when a key is switched off. Decision for Dillon; not built. **PR 5 did not add the check and did not write `enabled = false` on a switch-off** (`grep -n "isDocKeyActive" server-lib/notifyDigest.js server-lib/notifySettings.js` is empty; the digest still tests only `enabled`, `notifyDigest.js:56,98`).
- **W-N10. (new, PR 5, minor) "Always tell" people are checked against the company and `view` rows only, not against site, division or department scope, though the screen says "they must be able to see this document".** `saveNotifySetting` checks each id is an active person of this company (`notifySettings.js:65-69`) and accepts any role (owner, supervisor, worker, auditor; the screen only offers supervisors and workers, `NotificationSettings.jsx:48`, a client-side narrowing only). At send time `pickRecipients` adds an extra if `mayView(person)` (`notifyRouting.js:166,170`), which is `evaluateAccess(viewRows, ..., VIEW)` and so honours a restricting `view` assignment but never `recordInScope`. A supervisor scoped to another site, named as an extra, is therefore told that a record exists at a site they cannot open. The email carries the document name and a plain site name only. Same shape as the deliberate "named by the Owner" rule, so not numbered; decide whether the screen's wording or the check should change. Not traced: whether an auditor extra is ever emailed (`mayView` is the only gate seen, `?`).
- **W-N11. (new, PR 5, minor to medium) A switch that is on cannot be turned off once its document is switched off for the company.** The list is built from `listAssignableDocuments` (`notifySettings.js:26,37`): a built-in appears only with an explicit `company_document_settings.is_active = true` row (`assignmentAdmin.js:47,50-51`, the same strictness as `requireDocKey`, `docKeyGate.js:75`), and a custom form only if `is_active` and not explicitly off (`assignmentAdmin.js:44,53-55`). `saveNotifySetting` re-runs the same list and refuses a key not on it with 400 "That document cannot send notifications." (`notifySettings.js:53-55`). So when a document is switched off, its `document_notifications` row keeps `enabled = true` (nothing clears it), the row vanishes from the Owner's screen, and the Owner has no way to turn it off. The digest then keeps emailing held counts for it (W-N7: `notifyDigest.js:98` tests `enabled` only). Immediate emails are safe, every caller is behind `requireDocKey` or `requireCustomDocKey` and the form's `is_active` check (`customforms.js:657-660`). Bounded: only the digest leaks, count and label only, and switching the document back on shows the switch again. Same effect for a custom form made inactive (`is_active = false`, `assignmentAdmin.js:44`). Fix shape if approved: have the digest check the doc key (or the settings row), or clear/ignore `enabled` at switch-off. Re-check: `grep -n "isDocKeyActive\|company_document_settings" server-lib/notifyDigest.js` (empty).
- **PR 5 offered list vs what sends (checked, agrees).** Offered = `kind === 'custom'` or `kind === 'builtin' && WIRED_DOCUMENT_KEYS.has(key)` (`notifySettings.js:17`). `WIRED_DOCUMENT_KEYS` is `incident, nearmiss, flha, inspection, toolbox, daily, monthly` (`notifyAudience.js:24`), the same set `notifyAudience` accepts, and custom keys match `CUSTOM_KEY = /^custom_[0-9]+$/` (`:26`) and the key `submit_custom` passes (`customforms.js:733`). `listAssignableDocuments` still lists `fuellog` as assignable (`assignmentAdmin.js:29`), and `isNotifiable` drops it, correct after PR #193. Portal documents are dropped (`kind: 'portal'`), correct, they email their own departments. A key written to the table passes the CHECK (`document-notifications-migration.sql:35`: 7 built-ins plus `custom_[0-9]+`, Fuel Log removed live in #193). One-directional risk for the future: a new document wired into `WIRED_DOCUMENT_KEYS` but absent from `BUILTIN_DOCUMENT_LABELS` would never be offered (`assignmentAdmin.js:50`); both lists are hand-kept.
- **PR 5 call surface (placed).** `list_document_notifications` and `set_document_notification` sit inside the document-assignments block, gated once by `canManageCompany(session)` (founder or Owner, `ownerAccess.js:23`) at `companydata.js:1389`, company from `resolveCompanyId` (`:1390`). Both helpers filter every query by that `companyId` (`notifySettings.js:27,28,66`); `set` writes `company_id` from the resolved id, never the body (`:57`), and `updated_by` from the session (`companydata.js:1424`). Audited: `logAuditEvent` `set_document_notification` (`:1427`). The UI renders under `DocumentAssignmentsManager` behind `canManageCompany` (`Dashboard.jsx:7957`), roster from `rosterList` (`Dashboard.jsx:3436`). Unlike the assignments actions, a missing `document_notifications` table is handled as off with an empty list on read (`notifySettings.js:31-32`), but a write to a missing table returns the generic "Couldn't save that" (`:74-77`), not the `SETUP_MSG`; the table is live (W-N4), so cosmetic. The Owner screen says an Owner is told when nobody else would be (`NotificationSettings.jsx:56`), which matches the fallback at `notifyRouting.js:182-186`.
- **W-N8. Digest hardening after the security review (CLOSED 2026-10-07).** Batch cut to 50 and `maxDuration` 60 so a cut-off run loses little; a run with no `RESEND_API_KEY` or a bad `FIELD_ENCRYPTION_KEY` claims nothing (`api/cron-notification-digest.js`); an address that is stored but will not decrypt is refunded, not dropped (`server-lib/notifyDigest.js`); a permanent mail rejection (4xx other than 408 and 429) is dropped so one bad address cannot starve the queue; the settings lookup is filtered to the keys needed; `claimed`, `sent` and `dropped` are now kept in telemetry (`ALLOWED_METRIC_KEYS`). **Accepted, not built:** the digest does not re-check who may view the document, so a person who lost access in the last window can still get a count-only email, and `refund_notification_slot` is not idempotent (nothing calls it twice).
- **Rows dropped by design (not W-N6).** The digest drops a claimed row when the switch is off, the person is inactive or has no valid address, or the company is suspended (`notifyDigest.js:101-104`); the count was already reset by the claim, so it is not retried. Intended: nobody can be told.
- **Live state.** Both functions applied live and verified on ABC Earthworks per `notification-digest-migration.sql:3-6` (migration `notification_digest_functions`); service_role only (`:68-71`). Not re-queried by this pass (`?` for the live check, taken from the migration header). Re-check: `select proname, proconfig from pg_proc where proname in ('claim_held_notices','refund_notification_slot');`
- Re-check: `grep -n "notification-digest" vercel.json`; `grep -n "notification_digest" server-lib/platformHealth.js api/cron-notification-digest.js`; `grep -rn "refundSlot" server-lib api`.
- **W-N9. Security review of the PR 2 wiring (2026-10-07).** Fixed: a site name typed by whoever creates the site is only put in an email when it is plain (`safeSiteLabel`, `server-lib/notifyRouting.js`), otherwise the email names the document alone; every mail send has an 8 second timeout (`server-lib/email.js`) and a notify run stops starting new sends after 10 seconds; `notifyAudience` skips a suspended company (`sign_now` has no suspended check of its own). **Accepted:** the per-person burst is shared across authors and sites, so an insider can use up a person's three emails ahead of a real incident (bounded: the held count is reported by the digest once PR #190 merges); `site_id` steers who is emailed, within the cap; `sign_now` does not re-check the submit assignment (the record is the signer's own). **Still open:** `add_site` has no length cap or role gate (`api/companydata.js`).

Re-check: `grep -rn "notifyAudience" api server-lib | grep -v "^server-lib/notifyAudience.js"` (at `1ebc5ec` returned `api/reports.js:17,392,456`, `api/flhas.js:19,515,572`, `api/logs.js:20,689,755`; at `c9d0049` it also returns `api/monthly.js:8,500` and `api/customforms.js:8,733`; a new file or line is another consumer landing, re-verify the call-site tables above) and `grep -rn "notifyOnSubmit\|routeNotification" api src server-lib | grep -v "^server-lib/notifyRouting.js"` (at `1ebc5ec` only `server-lib/notifyAudience.js:21,38`); `grep -rn "document_notifications\|document_notification_state" api src server-lib | grep -v "^server-lib/notifyRouting.js"` (PR 5 writer is `notifySettings.js:73`; readers are `notifyRouting.js:206`, `notifySettings.js:27`, `notifyDigest.js:56`; `notifyRouting.js` is still the state table's only writer); `sed -n 26,57p docs/schema/document-notifications-migration.sql`; live check for both tables: `select relname, relrowsecurity from pg_class where oid in ('public.document_notifications'::regclass, 'public.document_notification_state'::regclass);` (an error means not applied).

---

### The set-your-own-PIN link (`roster.pin_link_*`, `624ef31`, placed 2026-09-30)

Replaces the plaintext wallet invite. `create_wallet_invite` and `redeem_wallet_invite` no longer exist (`grep -rn "wallet_invite" api/ server-lib/ src/` returns only `tests/unit/wallet-invite-modules.test.js:10`, a comment). The old `roster.wallet_invite_token` columns stay in the table unused (`docs/schema/roster-pin-setup-link-migration.sql:2`). Re-check: `grep -rn "pin_link_jti_hash" api/ server-lib/ src/`.

**Key:** the link is a signed ticket `{purpose:'pin_setup', jti, rosterId, companyId}` (`server-lib/setupLinks.js:47-49`). The join is `roster.id` + `roster.company_id` **and** `roster.pin_link_jti_hash = sha256(jti)`, checked on open (`api/login.js:802-812`) and again inside the set-PIN UPDATE's WHERE (`:872`), which also clears it, so two parallel submits cannot both win. A worker session never carries this purpose, so `verifySession` rejects it (`setupLinks.js:4-5`).

| Side | Who | Evidence |
|---|---|---|
| Writes the link (`pin_link_jti_hash`, `pin_link_expires_at`, `pin_link_sent_at`) | `issuePinSetupLink` | `server-lib/setupLinks.js:69-78`; 7 day TTL `:15` |
| Producer 1, company creation | everyone with an email, Owner first, cap 25, 3 parallel senders | `server-lib/onboardingApproval.js:148-167` (cap `setupLinks.js:18`), called `:364`; matches people to inserted rows by lower-cased name (`:149,157`) |
| Producer 2, Owner adds a person | email required, link emailed; a worker's URL is also handed back to the caller | `api/companydata.js:451-520` (`:519` hand-back rule) |
| Producer 3, resend | rank check via `canResetMfa` or self, throttled 5 per hour per person; no email on file means URL only, handed back | `api/companydata.js:720-760` |
| Consumer | `pin_link_open` returns name, company, `emailOnFile`, `mfaRequired`, `hasAuthenticator`; `pin_link_set_pin` saves the PIN, sets `pin_set_at`, clears the link | `api/login.js:795-885` (`pin_set_at` `:862`) |
| Feeds authenticator setup | `mfaNeeded = requiresMfa(member) && !totp_enabled` mints `mfa_setup_jti_hash` and returns `stage:'enroll'` + `enrollTicket`; the page redirects to `/?mfa_setup=` | `api/login.js:826,851-868,879-881`; `src/WalletInvite.jsx:114-118`; `src/Login.jsx:100`; consumer `mfa_enroll_start/confirm` `api/login.js:729` |
| Already has an authenticator | PIN reset only, `stage:'signin'`, no session | `api/login.js:878`; `src/WalletInvite.jsx:119` |
| Everyone else | session minted through `mintRosterSession` (writes `last_login_at`) | `api/login.js:882-884`, `:437` |
| Invalidated by | email change, `reset_roster_pin`-type resets, `set_own_pin`, a newer link | `api/companydata.js:633,778,970-971`; `api/certifications.js:411`; `setupLinks.js:70-78` |
| Read by the UI | `pin_set_at`, `pin_link_sent_at` on the roster list | `api/companydata.js:358`; `src/Dashboard.jsx:7903-7909`; `src/AdminPanel.jsx:2366-2370`; `claim_get_details` returns `hasEmail/linkSent/pinSet` (`api/login.js:1210,1223`) which drive `needsTypedPin` (`src/ClaimAccount.jsx:184-185,218-222`) |

**Gating:** roster is platform base, so no `requireDocKey`. `pin_link_*` does not check `wallet_enabled`; that flag only governs the ticket upload (`api/certifications.js:95-100`), same as before. Not re-verified: that the migration is applied to the live project.

**Tenant scope:** every lookup is by `id` **and** `company_id` (`login.js:802-803,869-870`, `setupLinks.js:76-77`). `send_pin_setup_link` fetches by `id` alone (`companydata.js:726`) but then requires either self in the same company (`:729`) or `canResetMfa`, which rejects a different company unless founder (`server-lib/rosterMfa.js:196-198`). Read, so not a break.

### Login and session (`b2044ee` 2026-10-06; step 1 changed to company code on branch `claude/step4b-company-code-login`, anchored against `2724f83`)

**Key:** a customer types the founder-chosen `companies.company_code`, which `find_company` matches exactly (case-insensitive) to `companies.id` and wraps in an HMAC `companyTicket` (`api/login.js:521,529`). Then `roster.id` + `roster.company_id` (`:604-605`) then PIN, plus authenticator where `requiresMfa`. The code opens that company's name list and nothing else; it is not a login by itself, and the old shared worker/supervisor codes stay gone.

| Piece | Where |
|---|---|
| Step 1, `find_company`: code trimmed, upper-cased, shape `[A-Z0-9-]`, 6-32 chars (`:104-105,515-518`), `ilike('company_code', entered)` limit 1 (`:521`); one answer for any miss (401, `:527`). Two throttles: `clookup:` counts every call (`:510`, 60 per 15 min, `:108,112`), `ccode:` counts only misses (`:512,526`, 20 per 15 min, `:106-107`); both keyed by `ipBucket(ip)` (`:509`) | `api/login.js:508-530`; UI `src/Login.jsx:202` |
| `peekIpThrottle`: reads a `master_code_ip_limits` bucket without counting; a read error answers "allowed". `ipBucket`: IPv4 as is, IPv6 collapsed to its /64 so one customer cannot mint a fresh budget per address | `server-lib/ipThrottle.js:52-63` and `:69`; imported `api/login.js:17`; `peekIpThrottle` has one caller (`:512`); `ipBucket` wraps the `clookup:`, `ccode:`, `rnames:`, `unlock:` and `pin:` keys (`:509,539,565,598`) |
| Step 2, active names only, no role returned | `api/login.js:535-550`; UI `src/Login.jsx:213`; same action name reused by `src/App.jsx:461`, `src/Incident.jsx:250`, `src/ToolboxTalk.jsx:150` with a session token, served by `api/companydata.js:1161` (a different handler, not the ticket one) |
| Owner lockout recovery, `request_unlock_link`: ticket-verified, IP throttle `unlock:` (`:565`); answers `{ok:true}` for every case (`:567`); sends only if the roster row is in this company, active, `is_owner === true`, and a PIN or authenticator lock is live (`:570-577`); at most one per hour by `pin_link_sent_at` (`:578`) and 3 per hour per person (`:581`); emails the same single-use link through `issueAndEmailPinLink` (`:584-587`, `server-lib/setupLinks.js:149`, `unlockLinkEmail` `:127`) | `api/login.js:561-589`; UI button `src/Login.jsx:230-244,674` |
| That link clears the lock: `pin_link_set_pin` also writes `totp_failed_attempts: 0, totp_locked_until: null` beside the PIN lock columns | `api/login.js:858-861` (whole block `:795-885`) |
| Step 3, PIN, lockout `pin_locked_until`, session via `mintRosterSession` | `api/login.js:592-726`, `:441-457`; UI `src/Login.jsx:315` |
| Auditor sign-in (branch `claude/auditor-role`, `6ad7e0a`): an auditor whose `auditor_access_expires_at` is null or past is refused after the PIN and before any authenticator prompt (`api/login.js:694-696`) and again at every session mint (`mintRosterSession` `:446-448`, callers `:738,:785,:898`); `MFA_REQUIRED_ROLES` includes `auditor` (`server-lib/rosterMfa.js:27`); 12 hour token (`server-lib/sessionTtl.js:23-24`); the name list shows an auditor like anyone else (`login.js:549-553`, A-W7) | `api/login.js`; see the Auditor section above |
| Founder entry, still no `userId` | `master_login` `api/login.js:888-921` |
| Unlock a locked person | `unlock_roster_pin` `api/companydata.js:715-733` (rank rule via `canResetMfa`, audit-logged); the derived `locked` flag (PIN or authenticator lock, timestamps never sent) `companydata.js:362,374-378`; read by `src/Dashboard.jsx:3523,7961`, `src/AdminPanel.jsx:329,2390` (Dashboard/AdminPanel anchors not re-checked this pass) |
| `companies.company_code`, the login-finding key again | **Reader:** `find_company` `api/login.js:521`. **Writers:** founder-typed `create_company` (`api/admin.js:536-562`) and `update_company_codes` (`:597-614`), both through `normalizeCompanyCode` (upper-case, `[A-Z0-9-]{6,32}`, `:52-55`) and a case-insensitive clash check (`:546,608`, `ilike`, added `9861cc0`); onboarding auto-generation `server-lib/onboardingApproval.js:176-194` (prefix plus 5 random characters, 8 tries, `ilike` clash check `:180`). **Shown to staff:** `src/AdminPanel.jsx:1433`, `src/ClaimAccount.jsx:174,194` ("type it on the login page"). The two founder writers validate the shape the reader requires; the onboarding writer does not: break #44 |
| `worker_code`, `supervisor_code`, `app_type` | dropped by `docs/schema/company-name-login-migration.sql:14-16`, **not verified applied live**; no reader left in `api/`, `src/`, `server-lib/` |
| Browser storage: named non-admin sessions in `localStorage`, admin and no-`userId` in `sessionStorage` | `src/Login.jsx:12-51` (not re-checked this pass) |

`set_roster_cutover` and the legacy no-`userId` worker/supervisor session path are gone. Several api files still carry `!session.userId` guards (e.g. `api/certifications.js:138`, `api/companydata.js:656`); they now only ever catch the founder's `master_login` session, so they are dead-ish but harmless and not filed.

### The Unified Document Engine (`document_definitions` ... `document_records`; WP1 to WP7c-1 merged on main (#215), WP7c-2 committed on `claude/document-engine-wp7c-access` (`2da835a`, review fixes `42ad499`), not merged; re-placed 2026-10-09)

Spec `docs/unified-document-engine-spec.md`, WP2 notes `docs/unified-document-engine/wp2-notes.md`. **No longer dormant.** Three screens call `api/documents.js`: the worker form and menu cards (`src/WorkerMenu.jsx:162-172,174-185,521-522,853`, `src/documentEngine/EngineDocumentForm.jsx`, `engineSubmit.js:81,106,138,151`), the supervisor and Owner inbox as the Dashboard tab `enginedocs` (`Dashboard.jsx:3148,3192,3213,6581`, `EngineInbox.jsx`, `useEngineInbox.js:9-16`), and the worker inbox (`WorkerMenu.jsx:297-299,707-709` to `EngineWorkerInbox.jsx:15`). The tab shows once the company has an engine document switched on or something waits on that supervisor (`Dashboard.jsx:3192`); the worker card list and badge load from `list_worker_documents` and `my_inbox` (`WorkerMenu.jsx:162-185`). Still mostly the engine's own island: it reads the roster, sites, assignments and the shared notification and Brain plumbing, and the only things outside the engine that read its records are the `delete_site` count and, on the WP7c-2 branch, the auditor view (`api/audit.js:152`). The WP3 migration is applied live (breaks #51 and #52 closed below). All claims in this section were re-read on branch `claude/document-engine-wp7c-access` on 2026-10-09 (service.js lines shifted by about 10 to 25 against the earlier placement and are refreshed); WP7c-1 is merged, rows marked WP7c-2 exist only on that unmerged branch and a reader on `main` will not find them. No pull request number was found for the branch (the GitHub lookup returned nothing), so evidence below is the two commits.

**Join keys the engine writes or reads**

| Key | Producer (writes) | Consumer (reads) | Agrees? |
|---|---|---|---|
| `document_key = engine_<definitionId>` | `engineKey` `documentEngine/notify.js:30`, passed as `documentKey` to `notifyOnSubmit` (`notify.js:70-77`) and to `claimSlot` (`notify.js:102`, `notifyRouting.js:373`) | `claim_notification_slot` RPC (`notifyRouting.js:314-321`), the digest (`notifyDigest.js:56-62`, label `:142`, gate `:116`) | Yes since the WP3 migration widened the CHECK (break #51, closed) |
| `source_type = 'engine_document'` in `company_signals` | `writeBrainSignal` `service.js:449-463`, only when `company_documents.brain_enabled` is not false (`service.js:487`) | tally `companydata.js:2435-2438,2456`; prompt line `companyBrainSummary.js:133` | Yes for the prompt. The Admin Panel card list never renders `topEngineFlagged` (`AdminPanel.jsx:2118` lists `topPortalFlagged`; `grep -rn topEngineFlagged src` returns nothing). Weak point E-2 |
| `site_id` on `document_records` | `submitRecord` `service.js:610,620` (vetted by `resolveSiteId`, `documents.js:134`) | rule A through `scopeRecords` (`service.js:674,795`) and `listVisibleRecordsMulti` (`:737,984`), the notification audience (`notify.js:63-76`), and on the WP7c-2 branch the auditor's site filter (`audit.js:154`, `.in('site_id', sites)`) | Yes. FK `on delete set null` (`document-engine-wp1-migration.sql:156`) but `delete_site` now refuses while engine records exist (`companydata.js:1789-1794`). Former weak point E-3, closed |
| `submitted_by_roster_id` on `document_records` | `service.js:621` from `authorRosterId(session)` | author scope in `listRecords` (`:733`), duplicate-submit check (`:583`), inbox (`:972-974`), `resubmit` and `sign_now` author checks (`:864,924`), the assignment screen's "done" tick (`documentAccess.js:473-499`, `withCompletion`, `engine` branch `:484`) | Yes, FK to `roster.id` (`wp1:157`) |
| `signer_roster_id` on `document_signatures` | crew `service.js:555` (name from the roster row), worker `:637,943`, approval `:826` | prior-reviewer rule (`service.js:786`) | Yes, FK to `roster.id` (`wp1:213`). The signature image is still attached by the author (wp2-notes decision, 2026-10-09) |
| `company_documents.(company_id, definition_id)` | `setCompanyDocument` `service.js:282-304` (founder only, `documents.js:136-140`) | submit gate `service.js:569`, worker card list `:394`, assignment and auditor pickers (`companyDocs.js:12-24`, WP7c-2), digest `notifyDigest.js:128`, sweeps `sweeps.js:92,207` | Yes. This replaces `company_document_settings` for engine documents |
| `document_answers.file_path` / `document_records.pdf_path` / `document_signatures.signature_path` (storage paths) | issued by `createUploadUrl`, resolved from a receipt by `deps.resolveFile` (`service.js:603,623,885`); resubmit keeps an unchanged file answer by reusing the stored path (`service.js:873-879`) and accepts a fresh `pdfReceipt` (`:885`, client `engineSubmit.js:138`) | `getRecordLinks` (`service.js:712-720`, action `documents.js:227`) via `links.js` `linkTargets` (`links.js:21-28`) signs `flha-reports`, `signatures`, `portal-attachments` paths for 300 s (`links.js:10,13`), dropping any path not under `<companyId>/` (`links.js:15-19`); the inbox asks for them at `EngineInbox.jsx:37`. WP7c-2: the auditor view signs only `record.pdf_path` through the same `linkTargets` and `signTargets` (`audit.js:159-160`), never answer files or signatures | Yes. Every storage path is both issued and checked under the company folder |
| `document_key = engine_<definitionId>` in `document_assignments` (WP7c-2, E-4) | Owner screen: `listAssignableDocuments` adds one `{ key: engine_<id>, kind: 'engine', actions: [submit, view] }` per switched-on, published, unarchived document (`assignmentAdmin.js:62`, via `listEngineDocuments` `companyDocs.js:12-24`); the key is accepted by `isAssignableKey` (`documentAccess.js:61`) and `isAssignableAction` (`:67-71`, a view row is allowed for engine documents, refused only for `portal_`) | submit: `submitRecord` `requireAssignment(... SUBMIT, { asOf })` (`service.js:574`); view: `requireRecordView` (`:672`), `listRecords` (`:737`), `myInbox` (`:984`), `reviewRecord` (`:793`); menu: `listWorkerDocuments` `menuAccessFor` (`service.js:407`), `withCompletion` engine branch (`documentAccess.js:484`) | **Code agrees, the table does not (break #53).** `document_assignments.document_key` carries a CHECK that lists the built-ins, `custom_<n>` and `portal_<n>` only (`document-assignments-migration.sql:60`), so as written in the repo an insert for `engine_<n>` is refused; the repo has no migration widening it. Live constraint not read by this pass: `?` |
| `queuedAt` / `clientSubmissionId` on an engine submit (WP7c-2, E-4) | client: `engineSubmit.js:81` via `queuedAtFor` | `api/documents.js:210` passes `body.queuedAt` to `submitRecord`, which hands `queuedAsOf({ clientSubmissionId, queuedAt })` to `requireAssignment` (`service.js:574`); `queuedAsOf` ignores `queuedAt` without a `clientSubmissionId` (`documentAccess.js:87-90`) and `requireAssignment` clamps it to `GRACE_MS` = 48 hours (`:272-290`, `clampAsOf` `:93-100`, applied to SUBMIT only) | Yes. Same 48 hour reach-back as the built-ins. Not a proof: a handcrafted request can reach back the full 48 hours (stated at `documentAccess.js:78-86`) |
| Id-bearing answers: `document_answers.value_json` `{ equipment_id, label }`, `{ equipment_ids, labels }`, `{ site_id, label }`, `{ roster_id, label }`, `{ record_id, definition_id, label }` (WP7c-2, E-6) | `resolveIdAnswers` (`idAnswers.js:46-117`) runs in `submitRecord` (`service.js:593`) and `resubmitRecord` (`:880`); every id is looked up against the caller's company and the stored label comes from the database row (equipment `:56-68`, attachments `:69-78`, site `:79-86`, person `:87-93`, linked document `:94-110`); `validateAnswers` stores only a resolved value and refuses any other id-bearing answer (`validate.js:202-207`). The list a worker picks from comes from `get_picker_options` (`documents.js:222-226`, `listPickerOptions` `idAnswers.js:128-161`) via `PickerControl.jsx:30` | **No reader.** Nothing outside the engine reads `document_answers` (`grep -rln document_answers api server-lib` lists only `validate.js`, `fieldTypes.js`, `service.js`). `maintenance.js` and `fuellogs.js` read `inspections`, `fuel_logs` and the other built-in tables, never an engine answer | Write side verified; the link to the fleet is one-way. An equipment answer on an engine document is a checked id and a label in a record, and moves no PM clock, usage reading or Equipment Analytics. A free-text machine is stored `equipment_id: null` with the typed label (`idAnswers.js:60-63`), the same deliberate shape as `inspections` |

**What the engine connects to today (all read from code)**

| Link | Evidence |
|---|---|
| Worker fills and submits an engine document, queued offline | `EngineDocumentForm.jsx`, `engineSubmit.js:78-106`; the card sits beside built-ins, Portal and custom cards (`WorkerMenu.jsx:419,521,853`) |
| Supervisor / Owner works the inbox: review, send back, escalations marked actioned | `EngineInbox.jsx:25,53-55`; `useEngineInbox.js:13` loads `list_worker_documents`, `my_inbox`, `list_escalations` |
| Worker sees records sent back or awaiting their signature, fixes and resubmits, or signs now | `WorkerMenu.jsx:45,297-299`; `engineSubmit.js:138,151`; `service.js:860,920,966-976` |
| Notifications: new record, next review step, sent-back notice, department escalation all go through the shared burst limit and digest | `service.js:479-487,812,851,909-911`; `notify.js:58-83,118-156`; `notifyRouting.js:272-280` (`settingOverride`) |
| Digest: engine rows are looked up through `company_documents` (on and not muted), titled from `document_definitions`, refunded if the lookup fails | `notifyDigest.js:56-79,142` |
| Unsigned sweep: 24 hour heads-up, 10 day close, same constants as the built-ins | `sweeps.js:36-51,70-178`; wired at `api/cron-notification-digest.js:14,53-61` |
| Stale review sweep: 48 hours pending goes once to the Account Owner | `sweeps.js:185-264`, `cron-notification-digest.js:56-57` |
| Brain: an option-answer signal per counted record (a sign-later record only once signed) | `service.js:449-463,487,651,952` |
| Escalation by answer: `document_escalations` rows, notified by department | `service.js:430-447,479-485`, `rules.js:64-104`, `notify.js:135-156` |
| Rule A visibility for supervisors | `service.js:674,737,795,984` |
| Failed follow-ups retried hourly (WP7c-1, merged; E-1 partly handled, see weak point) | `afterRecordCounts` records `meta.followups` per step and `meta.followups_failed` (`service.js:465-500`); `retryFailedFollowUps` re-runs up to 25 records older than 5 minutes (`sweeps.js:267-300`) through `runFollowUpsAgain` (`service.js:508-516`), at most 5 attempts (`service.js:502,492`); fired from `cron-notification-digest.js:59` in the first ten minutes of each hour |
| Assignments narrow who may submit and who may view an engine document, with the 48 hour reach-back (WP7c-2, closes E-4 in code; the Owner's ability to create the row is break #53) | Submit: `service.js:574` (`requireAssignment ... SUBMIT`, `asOf` from `queuedAsOf`, `documentAccess.js:87-90`, clamp `:93-100`). View: `requireRecordView` (`service.js:672`, supervisor tier), `listRecords` (`:737`), `myInbox` review list (`:984`), `reviewRecord` (`:793`, a supervisor who may not view may not approve or return). Worker menu: `listWorkerDocuments` drops documents the person may not submit and returns the `assigned` section with completion (`service.js:405-413`, `withCompletion` `documentAccess.js:473-499`); the cards render in `WorkerMenu.jsx:448-454`. A plain worker is never narrowed by a view row (`requireAssignment`, `documentAccess.js:279-280`). A link-id answer follows the same view rule (`idAnswers.js:94-110`, review fix `42ad499`) |
| Outside auditors see filed engine records (WP7c-2, closes E-5) | Scope picker: `listAuditableDocuments` adds `engine_<id>` (`auditorAccess.js:129-137`, same `listEngineDocuments`, `companyDocs.js:12-24`). Reader: `api/audit.js:84-86` (only documents still switched on), `:149-165`: `status in (submitted, approved)`, `awaiting_signature = false`, `site_id in` the auditor's sites, limit per source; link is the record's `pdf_path` only, signed 300 s (`:159-160`, `:167`). Never answer files, signatures or notes |
| Id-bearing answers (equipment, attachments, site, person, linked document) resolved and stored (WP7c-2, closes E-6) | `idAnswers.js:46-117`; picker lists `get_picker_options` (`documents.js:222-226`); control `PickerControl.jsx:24-31`, mounted at `EngineDocumentForm.jsx:186`; see the join-key row above for what reads the stored value (nothing) |
| Attachment kind enforced server side (WP7c-1) | `fileKindOk` against `ATTACHMENT_EXTENSIONS` image/pdf/word/excel (`validate.js:30-45,196`); `portal-attachments` upload list now includes doc, docx, xls, xlsx (`uploadUrls.js:223`) |

**What it deliberately does not connect to yet (not breaks; each is on the engine's own plan)**

| Not connected | Evidence it is absent | Where it is planned |
|---|---|---|
| Crew lead's document list: `get_crew_documents` | reads `DIRECT_SOURCES` plus `INSPECTION_SOURCE`, six built-ins and inspections (`customforms.js:445`; `documentSources.js:15-22`). An engine record never shows on a lead's crew list. (The auditor view stopped using only that list in WP7c-2: `audit.js:149-165` has its own engine branch) | not scheduled |
| Analytics and Overview Recent Activity / Site Activity | `document_records` appears in no `src/` file; the only handlers outside the engine's own files are the `delete_site` count (`companydata.js:1792`) and the WP7c-2 auditor reader (`audit.js:152`) | not scheduled |
| Founder Platform overview | `VIA_PARENT` and the direct list name every document table, none is an engine table (`platformOverview.js:228-232`) | not scheduled |
| Corrective actions | `corrective_action` is a storable rule type (`fieldTypes.js:70-77`) but nothing in `service.js` or `rules.js` acts on it (`rules.js:24`); `correctiveActionScope.js` knows only the built-in `source_type`s (`:38-49`) | spec step 8 |
| Readings, equipment links, PM clock | The id-bearing types now store a checked id (WP7c-2, `idAnswers.js:46-117`; `validate.js:202-207`), but a `reading` answer is stored as size-capped JSON with no unit or number check (`validate.js:253-259`, the default branch), and every consumer of an equipment id is still absent: no handler outside the engine reads `document_answers` (`grep -rln document_answers api server-lib` lists `validate.js`, `fieldTypes.js`, `service.js` only), and `maintenance.js` and `fuellogs.js` read `inspections` and `fuel_logs` (`maintenance.js:175-210`) | spec steps 7-8 |
| `requireDocKey` / `company_document_settings` gate | `api/documents.js` never calls `requireDocKey`; the gate is the per-document row at `service.js:558`. Not in `pricing.js` `MODULES` (`pricing.js:60`) or `docKeyGate.js`, so there is no billing tie to the switch | spec 4.4; billing undecided (spec section 2) |

**New breaks and weak points from this placement**

### #51 - Every engine email is claimed through a table that refuses the engine's key (CLOSED 2026-10-09: WP3 migration applied to production)
**What a customer loses once the engine is wired to a screen:** the "new document", "next reviewer", "sent back" and "routed to your department" emails are never sent, with no error anywhere a user can see.
**Evidence.** `engine_<id>` keys are handed to `claim_notification_slot` (`notify.js:101`, `notifyRouting.js:373`), which inserts `(company_id, document_key, roster_id)` into `document_notification_state` (`document-notifications-migration.sql:84`). That table carries `check (document_key ~ '^(flha|inspection|toolbox|nearmiss|incident|daily|monthly|custom_[0-9]+)$')` (`:67`; the live copy was re-created with the same regex per `:137-141`). `engine_5` does not match, so the insert raises, `claimSlot` logs `claim_notification_slot failed` and returns `{ allowed: false, error: true }` (`notifyRouting.js:322-327`), and both senders skip the person (`notify.js:102`; `notifyRouting.js:373-374` counts it as failed). `document_notifications` has the same regex (`:38`) but the engine never writes it (`settingOverride`). The WP3 migration does not touch either constraint (`grep -n "notification\|constraint" docs/schema/document-engine-wp3-migration.sql` returns nothing). **Why no test fails:** the unit tests answer `claim_notification_slot` from an in-memory fake (`tests/unit/_fakeDb.js:93`), which has no CHECK. The sweeps' heads-up uses `routeNotification` only (`sweeps.js:122`), so it is not blocked, and the stale-review email uses no slot (`sweeps.js:240`); only the claim-based paths are. **Live constraint confirmed** against the production database the same day (`pg_get_constraintdef` on `document_notification_state_document_key_check` returned the built-in-only regex).
**Fix:** `docs/schema/document-engine-wp3-migration.sql` widens the `document_notification_state` CHECK to also allow `^engine_[0-9]+$`. `document_notifications` is left alone on purpose, because the engine never writes it. `tests/unit/document-engine-wp3-schema.test.js` evaluates the widened regex from the migration text against engine, built-in and malformed keys. **Closed:** applied to production on 2026-10-09 and re-read live (the CHECK on `document_notification_state` now allows `engine_<n>`).
Re-check: `grep -n "document_key ~" docs/schema/document-notifications-migration.sql`; live: `select pg_get_constraintdef(oid) from pg_constraint where conname = 'document_notification_state_document_key_check'`.

### #52 - The engine code depends on columns and a table the repo's applied migration did not have (CLOSED 2026-10-09: WP3 migration applied before the code was deployed)
`reviewRecord` guards its update on `review_step` (`service.js:698`) and `resubmitRecord` writes it (`:760`); both columns, `review_round`, `unsigned_alerted_at` and `review_alerted_at`, the one-approval-per-step index and `document_escalations` exist only in the unapplied WP3 migration (`wp3-migration.sql:24-26,36-51`; WP1 has none, `wp1:149-170`). Without it every `review` answers 500 and escalation writes are skipped (logged, `service.js:430-432`). The sweeps degrade quietly by design (`sweeps.js:46,83,197`, `missingColumn`). Not a break while the engine is dormant; it becomes one the moment the WP3 code is deployed ahead of the migration. Re-check: `grep -n "review_step" docs/schema/document-engine-wp1-migration.sql` returns nothing.

### #53 - The Owner can be offered an engine document to assign, and the table refuses the row (OPEN, found 2026-10-09 on branch `claude/document-engine-wp7c-access`; live constraint not read, `?`)
**What a customer loses:** the Owner opens the assignment screen, picks an engine document and an audience, presses save, and gets "Couldn't save the assignment." Nothing in the engine is ever narrowed or assigned, although the enforcement code is all in place.
**Evidence.** Producer: `listAssignableDocuments` adds `engine_<id>` with `[submit, view]` (`server-lib/assignmentAdmin.js:62`), and `isAssignableKey` accepts the key (`documentAccess.js:61`), so `validateAssignment` passes it (`assignmentAdmin.js:82,89`). Consumer: the insert at `api/companydata.js:1443-1444` hits `document_assignments`, whose `document_key` CHECK is `^(flha|inspection|toolbox|nearmiss|incident|daily|monthly|fuellog|custom_[0-9]+|portal_[0-9]+)$` (`docs/schema/document-assignments-migration.sql:60`). `engine_5` does not match, so the insert errors and the handler answers 500 with the generic message (`companydata.js:1447-1450`). The branch adds no migration (`git show --stat 2da835a 42ad499` touches nothing under `docs/schema`). The Crew lead's `lead_assign_task` writes the same table and has the same limit (`companydata.js:1641` offers it the engine documents, insert at `:1673-1674`). **Why no test fails:** the unit tests answer from an in-memory fake with no CHECK (`tests/unit/_fakeDb.js`), the same reason break #51 was silent. **Unverified:** whether the live table still carries that CHECK (the migration says it is run by hand, `:3`); no database tool was available to this pass. Read it with `select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.document_assignments'::regclass and contype = 'c'`.
**A fix would touch:** one migration widening that CHECK to also allow `engine_[0-9]+` (the same shape as `docs/schema/document-engine-wp3-migration.sql:80` did for notifications), applied before the WP7c-2 branch ships. Needs Dillon's yes.
Re-check: `grep -n "document_key ~" docs/schema/document-assignments-migration.sql` and the live query above.

**Weak points (not numbered breaks)**
- **E-1. Failed follow-ups: partly handled (WP7c-1, merged in #215; re-read 2026-10-09 on the WP7c-2 branch).** A database failure in the escalation insert is retried hourly: `createEscalations` throws (`service.js:430-447`), `step()` marks the run failed (`:475-478`), `retryFailedFollowUps` picks it up (`sweeps.js:275-283`) and gives up after 5 attempts (`service.js:492,502`). **The Brain half is now covered:** `writeBrainSignal` throws on a failed `company_signals` insert (`service.js:460`, `dbFail`), so a lost Brain signal is retried; the earlier note that it only logged is stale. **Residual, still open:** (a) email send failures are not retried: `notifyRecord` catches everything and returns `reason: 'error'` (`notify.js:79-82`), and `notifyPeople`, so `notifyEscalations`, swallow per-person send errors and refund the slot (`notify.js:107-114`), so `step('notify')` and `step('escalation_notify')` (`service.js:480-486`) can never report failure. A lost email is silent. (b) The resubmit follow-ups are not retried: `resubmitRecord` wraps its escalations and re-notify in a `catch` that only logs (`service.js:906-914`) and never writes `meta.followups_failed`. (c) After 5 failed attempts `followups_gave_up` is written (`service.js:492`) and nothing reads it (`grep -rn followups_gave_up api server-lib src` returns only that line), so nobody is told. (d) If the state write itself fails the record is never retried (`service.js:496-498`). Re-check: `grep -n "catch (e)" server-lib/documentEngine/notify.js`; `sed -n 449,463p server-lib/documentEngine/service.js`.
- **E-2. `topEngineFlagged` is returned and never shown** (`companydata.js:2456`; no reader in `src/`, and `AdminPanel.jsx:2118` lists only the Portal count, re-checked 2026-10-09). The Brain prompt does get the line (`companyBrainSummary.js:133`), so the Brain learns it and the founder cannot see the count. Still open.
- **E-3. CLOSED in code before 2026-10-09 (`83a7fc1`).** `delete_site` now counts engine records and refuses (`companydata.js:1789-1794`). Kept here so a sweep does not re-file it. `document_records.site_id` is still `on delete set null` (`wp1:156`) as a backstop.
- **E-4. CLOSED in code on branch `claude/document-engine-wp7c-access` (`2da835a`, review fixes `42ad499`; no PR number found, not merged). Assignments and the 48 hour reach-back now apply to engine documents.** Submit `service.js:574`, view `:672,737,793,984`, menu and assigned section `:405-413`, 48 hour reach-back through `body.queuedAt` (`documents.js:210`, `documentAccess.js:87-100`), Owner screen offers `engine_<id>` (`assignmentAdmin.js:62`). **Not yet usable end to end: break #53** (the table CHECK in the repo refuses an `engine_<n>` row). Stays listed until the PR merges and #53 is settled. Remaining narrower gaps, by design or open: (a) `get_document`, the form definition itself, is not hidden from an unassigned worker (`documents.js:197`, `getDocumentForWorker` `service.js:372-388` calls no `requireAssignment`; only submit and the records are enforced). (b) A crew lead is not narrowed by view rows in `myInbox`: the view filter runs only `if (actor.role !== 'worker')` (`service.js:983-985`), so a lead's review list skips it, although `requireAssignment` itself does hold a lead to view rows (`documentAccess.js:279-280`) and `reviewRecord` does not apply the view check to a worker-role lead (`service.js:790-796`). `requireRecordView` is for supervisor tier only (`service.js:670-672`). Re-check: `sed -n 981,986p server-lib/documentEngine/service.js`.
- **E-5. CLOSED in code on the same branch. Auditors can read filed engine records.** Evidence in the connects table: `auditorAccess.js:129-137`, `audit.js:84-86,149-165`. Filed means `status in (submitted, approved)` and `awaiting_signature = false`, at the auditor's sites (`.in('site_id', sites)`, `audit.js:154-155`); the only file is the signed PDF link (`:159-160`). A record with `site_id` null can never be seen by an auditor (the filter is `in`). Site scoping is done by the query's `site_id in (...)` filter (`audit.js:70,100-105,154`); `recordInAuditScope` (`auditorAccess.js:119-121`) is not called by this branch's engine path (and `grep -rn recordInAuditScope api server-lib` shows no caller at all).
- **E-6. CLOSED in code on the same branch. Id-bearing answers are resolved.** `idAnswers.js:46-117`, `get_picker_options` (`documents.js:222-226`), `PickerControl.jsx`. **Residual:** `crew_signatures` is still flagged id-bearing (`fieldTypes.js:36`) with no resolver, so a definition with one is refused at submit as before (`validate.js:202-207`; the comment at `fieldTypes.js:42-45` says crew sign through the `crew` parameter). And the stored ids have no reader (join-key table above): an engine equipment answer moves no PM clock and no usage reading. Whether the builder warns about `crew_signatures`: not read, `?`.
- **E-7 (new, 2026-10-09). The builder's picker for the assignment screen lists only documents that are switched on, published and unarchived** (`companyDocs.js:12-24`). Not a break: an assignment already made on a document that is later switched off stays in the table and `submitRecord` rejects the submit at the switch first (`service.js:569`). Listed so a sweep does not file it.

Re-check for the whole engine: `grep -rln "document_records" api server-lib src` on the WP7c-2 branch lists `api/audit.js` (the auditor reader, `:152`), `api/companydata.js` (the `delete_site` blocker, `:1792`), `server-lib/documentAccess.js` (the completion tick, `:484`), and `server-lib/documentEngine/` `idAnswers.js` (linked-document lookup), `service.js` and `sweeps.js`. Any other name in that list is a new consumer and belongs in the tables above.

## 3. Interaction matrix

`✅` verified working · `⚠️` partial/lossy · `❌` expected but absent
· `—` no expected relationship

| From ↓ / To → | PM | Fuel | Equip Rpt | Brain | Analytics | Corrective | Certs |
|---|---|---|---|---|---|---|---|
| Equipment Inspection | ✅ `maint:129` | ✅ `fuel:106` | ✅ | ✅ *(#4, PR #118; post-trip too, #10, PR #121)* | ⚠️ label-joined | ✅ *(#5, PR #118; post-trip opens AND closes, #10/#11, PR #121)* | — |
| Fuel Log | ✅ *(#1, PR #118)* | — | ✅ *(#1, PR #120)* | — *(no finding to extract)* | ⚠️ label-joined | — | — |
| FLHA | — | — | — | ✅ `flhas:501` (fires on an unsigned save too, W-S9) | ✅ *(unsigned FLHAs excluded, W-S5 closed)* | — | — |
| Toolbox Talk | — | — | — | ✅ `logs:442` | ✅ | — | — |
| Incident | — | — | — | ✅ `reports:303` | ✅ | ✅ *(#5, PR #118)* | — |
| Near Miss | — | — | — | ✅ `reports:303` | ✅ | ✅ *(#5, PR #118)* | — |
| Monthly Inspection | — | — | — | ✅ *(#4, PR #118)* | ✅ | ✅ `monthly:375` | — |
| Daily Report | — *(candidate for #13, not chosen)* | — | — *(candidate for #13, not chosen)* | ✅ *(#4, PR #120)* | ⚠️ machines still label-only in `analyticsUtils.js` | — | — |
| Custom Document | — | — | — | — *(excluded, #4)* | ✅ safety (`Dashboard.jsx:6646`) and operations (`:6678`) categories; ⚠️ workforce category reaches only Overview Site Activity (`:4280`), no Analytics panel (#40 residual) | — | — |
| Company Portal | — | — | — | ✅ *(#4, 2026-09-29: flagged answers `portal.js:608`; assignment health `companyBrainSummary.js:226`; counted at `companydata.js:1669`, shown at `AdminPanel.jsx:2246`)* | ✅ *(#40, built `23aad0b`)*: Overview Site Activity (`Dashboard.jsx:4278-4282` → `analyticsUtils.js:138`), Portal Analytics sub-tab (`Dashboard.jsx:6567-6575` → `Analytics.jsx:449` → `analyticsUtils.js:165`); deliberately not in Safety Analytics or its PDF (§5) | — | — |
| Time Clock | — | — | — | — | ✅ | — | — |
| Roster | — | — | — | — | ⚠️ #3 | — | ✅ |
| Certifications | — | — | — | — | — | — | ✅ *(#8, PR #120: expiry now reaches document review)* |
| Sites | ⚠️ #2 | ✅ | — | — | ✅ *(#2, PR #120)* | — | — |
| Equipment fleet | ✅ | ✅ | ✅ *(#7, PR #119)* | ✅ *(#4 closed: inspection defects emit at `logs.js:466`)* | ⚠️ label | ✅ *(#11, PR #121)* | — |
| Corrective Actions | ✅ *(#11, PR #121: a post-trip repair writes `field_service`)* | — | — | — *(excluded, #4)* | — | — | — |
| SOPs | — | — | — | ✅ | — | — | — |
| Attachments (`is_attachment`) | ✅ **trailers only**, towed KM *(#18 as rescoped, built `42ed3c7`: `maintenance.js:223-242`)*; non-trailers `—` by design (§5); **#28** built `1301c76` (closes with PR #129); ⚠️ **#29** | — | ✅ `equipmentreports.js:345,552` | ❌ **#30** (host label, `logs.js:214-215`) | ✅ *(#18: most used / most repaired, fleet-id keyed, `Analytics.jsx:362-370`)* | ✅ *(#17, built `bb13340`: `logs.js:517-527`)* | — |
| Equipment Compliance | ❌ #14 | — | ✅ *(#14, PR #122: `reportPdfs.js:142`)*, gated on its own doc key since `2560819` (`equipmentreports.js:618`) | ❌ #14 | ❌ #14 | ❌ #14 | — *(the cert analogue it copies: `Dashboard.jsx:4885`; the overview banner it now matches is `Dashboard.jsx:4917`, and both are now gated the same way — cert on `isDocActive("certifications")`, compliance on `complianceEnabled`)* |
| Fleet retirement (`retired_at`) | ✅ *(#15, PR #123 merged `18645f0`: no PM clock)* | ✅ picker filtered | ✅ *(#15: off the weekly report)* | — | — | — | — |
| Platform events (`platform_events`, telemetry) | — | — | — | — *(its `ai_generation` rows log the Brain summary call, not a Brain input)* | — | — | — |
| Unified Document Engine (live: worker form, inbox tab; WP7c-1 merged, WP7c-2 on its branch) | ❌ *(an equipment answer is now a checked id, `idAnswers.js:56-68`, and a `reading` is stored as unchecked JSON, `validate.js:253-259`; `maintenance.js:175-210` reads `inspections` and `fuel_logs` only, nothing reads `document_answers` outside the engine)* | n/a | n/a | ✅ *(`service.js:449-463` writes, `companyBrainSummary.js:133` reads; admin count never shown, E-2; a failed Brain insert is now retried, `service.js:460,487`; lost emails are not, E-1)* | ❌ *(`document_records` is read by no `src/` file or Analytics handler; the only readers outside the engine are the `delete_site` count and the auditor view, §2 engine section)* | ❌ *(`corrective_action` rule stored, never acted on, `rules.js:24`)* | n/a *(engine reads certifications nowhere; spec keeps them separate)* |

The Platform events row is all `—` on purpose: it is a founder-only health
log, not a product feature a company uses, and it feeds none of the seven
columns. Its only planned consumer is the Admin Panel, which is not a column
here. See §2's `platform_events` section and §4's "Known pending links".

**Document assignments as a consumer, 2026-10-06 (`ae9aee4`, branch `claude/assignments-enforcement`).**
Assignments and supervisor scope sit in front of the document surfaces, not
beside them. Cells say whether the surface's handlers consult
`server-lib/documentAccess.js` (full list with lines in §2's `document_assignments`
section):

| Surface | Submit narrowed | Supervisor list / detail scoped | Worker menu hides unassigned |
|---|---|---|---|
| FLHA, Toolbox, Daily, Incident, Near Miss, Monthly, Custom, Fuel Log | ✅ | ✅ (Fuel Log: list only, it has no other action) | ✅ built-ins and Custom (`customforms.js:403-411`); now also shows them first as "Assigned to you" with due date and done state (`customforms.js:407`, `WorkerMenu.jsx:622`) |
| Equipment Inspection | ✅ `logs.js:365` | ⚠️ author only, no `site_id` (`logs.js:125-131`) | ✅ built-in menu |
| Company Portal | ✅ `portal.js:507,557` | ✅ #47 closed (PR #199): department routing picks the documents (`portal.js:759-763`), then rule A on the records (`scopeRecords` `:779`; detail `requireRecordScope` `:831`; update / delete `loadManageableRecord` `:1125`; email `:1353`). Escalations stay department-routed on purpose (`:1028-1072`) | ✅ `portal.js:485-490` (`menuAccessFor`; fixed, was #47 half 1; read failure shows everything `:486`); `assigned` with `completedAt` at `:489` |
| Corrective Actions | — | ✅ #48 fixed in PR #200 (not merged): list `monthly.js:900-905`, update `:931-932`, placed by the source record (`correctiveActionScope.js:12-17,27-65`); `equipmentPatterns` built from the visible actions (`monthly.js:910`, `0cacb6f`) | — |
| Owner screens (`e8ccde0`): assignments, Sites by division, hide-unassigned switch | ✅ writers exist: `companydata.js:1363-1444`, `:1123-1126` (Owner promotion clears the flag, `:1104-1110`); screens `DocumentAssignmentsManager.jsx`, `CompanyStructureManager.jsx:88-104`, `WorkerProfileDrawer.jsx:168` | — | ⚠️ hide-unassigned hides only the enforced document families; Time Clock, Certifications, Equipment Reports, Maintenance, Equipment Compliance cards stay (`documentAccess.js:269`) |
| Worker profile history (`get_worker_profile`) | — | ✅ `companydata.js:973-985` (view rows plus rule A, fail-to-empty; was #48 half) | — |
| Crew lead: FLHA list and approve | — | ✅ crew-authored only: list filtered by `crewIdSet` (`flhas.js:488-492`); approve refuses own, a non-crew author (supervisor, Owner, unstamped), another lead's and an already-signed FLHA (`:610-625`) and signs with the roster name (`:631`); `update` / `delete` stay supervisor-only | — |
| Crew lead: Daily Report, Fuel Log on behalf of a crew member | ✅ the member's assignment is what is checked (`logs.js:376-382`, `fuellogs.js:173-178`); completes the member's task (author stamp, `documentAccess.js:469`) | ⚠️ `entered_by_roster_id` is on the row but no supervisor list or PDF shows it (W-L2) | — |
| Unified Document Engine (WP7c-2 branch `claude/document-engine-wp7c-access`, not merged) | ✅ in code: `service.js:574` with the 48 hour reach-back; the Owner cannot create the row until break #53 is settled | ✅ supervisor tier: `requireRecordView` `:672`, `listRecords` `:737`, `reviewRecord` `:793`, `myInbox` `:984`; ⚠️ a crew lead is not narrowed in `myInbox` (`:983`, E-4b); a plain worker never is (`documentAccess.js:279-280`) | ✅ `listWorkerDocuments` `service.js:405-413` and the `assigned` cards `WorkerMenu.jsx:448-454`; ⚠️ `get_document` (the form definition) is not hidden (`documents.js:197`, E-4a) |
| Crew lead: `get_crew_documents` | — | ✅ seven sources from `DIRECT_SOURCES` + `INSPECTION_SOURCE` (`customforms.js:444`), monthly and custom, through `listVisibleRecords` / `Multi`, then crew-authored only (`:487-489`); ❌ Portal and corrective actions absent (W-L3, Portal left out on purpose for now); an anonymous near miss never reaches a lead (W-L4, closed) | — |
| Crew lead: tasks | ✅ marked `by_lead` (`companydata.js:1655`); ignored by the hide-unassigned switch (`documentAccess.js:220-222`); refused when the target cannot already submit the document (`companydata.js:1645-1646`) (W-L5 closed); ⚠️ the Owner's screen cannot tell a lead's task from its own | — | ✅ lands in "Assigned to you" (`documentAccess.js:298-306`) |
| Auditor (`46553fb`, `6ad7e0a`): `list_audit_documents` | — | ✅ the six `DIRECT_SOURCES` types, monthly and custom forms, by `site_id` and document key in the query (`api/audit.js:102-132`); ❌ equipment inspections and any record with no site (A-W1), ❌ Portal and corrective actions (A-W4); ⚠️ custom forms ignore their own on/off setting (A-W6); ✅ on the WP7c-2 branch: filed engine records through their own branch (`audit.js:149-165`), unmerged | — |
| Auditor: every other endpoint | — | ✅ 13 `verifySession` copies return null for the role (`admin.js:114`, `certifications.js:109`, `companydata.js:113`, `customforms.js:89`, `equipmentreports.js:92`, `flhas.js:94`, `fuellogs.js:83`, `generate-flha.js:127`, `logs.js:95`, `maintenance.js:91`, `monthly.js:89`, `portal.js:96`, `reports.js:89`) | — |
| Auditor: seat cap and roster counts | — | ✅ excluded in `list_roster`, `add_roster_member`, `onboard_new_employee`, `reactivate_roster_member` (`companydata.js:379,424,490,614-621`); role change off an auditor refused (`:1088`) | — |
| Auditor: Owner lifecycle (create, scope, send, revoke, unlock, MFA reset) | ✅ all five Owner actions `companydata.js:1473-1590`, behind `canManageCompany`; unlock and MFA reset through `canResetMfa` (`rosterMfa.js:200`, Owner may act on `auditor` since `6ad7e0a`) | — | ⚠️ migration not applied live: `set_auditor_scope` / `send_auditor_access` / `revoke_auditor_access` would answer 404 "Auditor not found." (A-W5) |
| Pre-trip / pre-fuel lookups (`check_equipment`) and `get_active_form` | ✅ `logs.js:338`, `fuellogs.js:124`, `monthly.js:248` | — | — |
| Equipment Reports, Maintenance, Time Clock, Certifications, Equipment Compliance | — | — by design (§5) | — |
| Analytics, Overview | — | ✅ verified 2026-10-08: fed by the scoped list actions, so a scoped supervisor's totals shrink with their lists (expected; see the verdict under #48) | — |
| Brain | — | ✅ verified 2026-10-08: company-wide by design, not scoped per viewer (see the verdict under #48) | — |

**Fleet Overview as a consumer — new joins as of `42ed3c7` (#13, #18).**
Fleet Overview has no column above because until now it consumed nothing but
the `equipment` table. It now reads two producers, both through one read-only,
supervisor/admin, company-scoped action (`api/companydata.js:857-883`,
`fleet_activity`), deliberately **not** module-gated (`:849-856`, #19 — BASE):

| From ↓ | Join | Shown as | State |
|---|---|---|---|
| Daily Report | `daily_reports.equipment_ids` → `equipment.id` (`companydata.js:864` → `fleetActivity.js:36`) | "Last on site DATE at SITE" (`Dashboard.jsx:6063-6065`) | ✅ *(#13, built)*; site is the free-text column, not `site_id` — weak link in §2 |
| Equipment Inspection (pre-trip) | `results_json.attachments[].id` → `equipment.id` (`companydata.js:865` → `fleetActivity.js:56`, then **filtered to this company's fleet ids** at `companydata.js:877-880`, `afc4b93`) | "Last mounted on HOST (DATE)" (`Dashboard.jsx:6060-6062`) | ✅ *(#18, built)*. The ids are client jsonb and unvetted on write, so the read drops any id not in the fleet the same query loaded (`:863`) |
| Equipment Inspection + maintenance log | pre-trip attachment ids + `equipment_maintenance_log.equipment_id` (`companydata.js:865-866` → `fleetActivity.js:126`) | Analytics "Most Used / Most Repaired Attachments" (`Dashboard.jsx:5963` → `Analytics.jsx:362-370`) | ✅ *(#18, built)* — "repaired" counts every log entry, `pm_service` included; the card subtitle says so (`Analytics.jsx:367`) |

And one new join into PM: **Equipment Inspection → PM for a trailer**, via
`linked_inspection_id` and the pre-trip's attachment list
(`maintenance.js:163` → `fleetActivity.js:99-119`). See §2's reading table.

**The founder dashboard as a consumer, 2026-09-29 (`cb9908a`, surface #24).**
It produces nothing another feature reads. It consumes:

| From ↓ | Join | Shown as | State |
|---|---|---|---|
| Nine document tables (`flhas`, `toolbox_talks`, `incidents`, `near_misses`, `daily_reports`, `inspections`, `fuel_logs`, `time_clock_entries`, `worker_certifications`) | `company_id`, `created_at` (`platformOverview.js:208-218,244`) | Documents per day and per type, per-company activity | ✅ |
| Monthly, Custom, Portal records | `form_id`/`document_id` → parent's `company_id` (`:222-226,246-251`) | Same | ✅ *(a record whose parent was deleted counts in the daily total but credits no company, `:73-75`)* |
| `company_document_settings` + `pricing.js` `MODULES` | `document_key` (`:126-133,144-155`) | Modules bought vs used | ✅ **#41** built, closes when its PR merges: `UNMEASURED_DOC_KEYS` (`platformOverview.js:46`) plus four guard tests (`tests/unit/platform-overview.test.js:148-173`) keep the doc-type list equal to `ALL_DOC_KEYS` (`pricing.js:124`) |
| `roster.last_login_at` | `login.js:444` | Active workers | ⚠️ PIN logins only, #41 weak point 1 |
| `companies`, `onboarding_requests` | `created_at`, `plan_tier`, `stripe_subscription_status`, `status` (`:225-232`) | Sign-ups, plan mix | ✅ |
| Preventative Maintenance, Equipment Compliance | none, no filing of their own | `not measurable` | n/a, deliberate |
| `platform_events` (last 30 days, `event_type, status, subtype, company_id, metrics, created_at`) | `event_type` + `subtype` to `CRONS` (`platformHealth.js:40-44`); `metrics.model` to `MODEL_PRICES` (`:28-32`, `:54-55`); `company_id` to `companies.name` (`:65,139`) | **3c, Platform health** (`PlatformDashboard.jsx:69`): job state ok / failed / overdue (1.5 cadences plus 2h, `:75`) / not observed yet, email sent / failed / skipped with failure kinds, AI success rate, estimated cost by document type, model and company (unlisted model counted unpriced, `:54-55,132`), recent trouble, and a note that storage growth, Supabase advisors and Vercel errors are not visible from the app (`:174`). Read failure yields `{unavailable:true}`, not a failed dashboard (`platformOverview.js:194,266-268`) | ✅ **P1 CLOSED by 3c**, see §4. Writers (8 producers) are on `main` via PR #162, not on this branch, verified with `git grep origin/main`. Two unguarded couplings recorded in §4, neither a break today |
| `pricing.js` `BASE`, `MODULES`, `MODULE_KEYS`, `TIERS` | `plan_tier` + module `docKeys` (`platformBusiness.js:20,35-43`, `pricing.js:37,60-118`) | Estimated MRR: BASE plus each bought module's price for the tier | ✅ a price change flows straight into the estimate, no second price table |
| `company_document_settings` | `is_active`, `document_key` (`platformBusiness.js:64-69`, read `platformOverview.js:238`) | "Bought" = any of a module's doc keys active (`platformBusiness.js:37`) | ⚠️ a hand-created company gets all 13 keys on (`admin.js:565`, `pricing.js:255`), so it is priced at every module, list price, in "Not billed via Stripe" |
| `companies.stripe_subscription_status` | written `stripe-webhook.js:84` and `onboardingApproval.js:198` | Billed / not billed / payment at risk split (`platformBusiness.js:28-29,100-102,174-182`) | ⚠️ see #42 weak point 1: the webhook suspends `canceled`, `unpaid`, `incomplete_expired` (`stripe-webhook.js:46,86`) and the dashboard drops suspended companies (`platformBusiness.js:62`) |
| `effectiveSeatCap` (`onboardingHelpers.js:101-103`, wraps `planSeatCap` `:92-94`) | `plan_tier` | Seat usage, near cap at 80 percent (`platformBusiness.js:21,33,104-106,160`) | ✅ **#42** built, closes when its PR merges: the dashboard (`platformBusiness.js:105`) and the enforcing handler (`companydata.js:362,392,457,582`) both call `effectiveSeatCap`, one source, an unknown tier is basic in both |
| `roster.last_login_at` | `login.js:444` (same single writer) | Worker logins this week, 30 of the 100 health points (`platformBusiness.js:88-95,138`) | ⚠️ PIN logins only, same weak point as Active workers (#41 weak point 1); a worker on a live session scores as not logged in |
| `companies.created_at` + first document | `created_at` (`platformBusiness.js:73-79,108-110,171`) | Median days to first document, and the under-14-days "new" band (`:32,125`) | ✅ |

**Every ✅ above is conditional on the gate, as of `edd7a41`.** A cell says the
join exists in code; it does not say the company can reach it. A company with no
`company_document_settings` row for the key on either side sees neither surface,
silently. Before 2026-09-18 that same missing row meant both surfaces were *on*.

**And as of `48d5889` the gate is the server's, not the browser's.** A missing
or false row no longer just hides a tab — the handler behind it answers 403
(`server-lib/docKeyGate.js:111-124`), including on the worker submit paths. So
a ✅ now means: the join exists in code **and** both companies' rows say yes.
The two surfaces with no doc key at all (Fleet Overview, Corrective Actions)
are unaffected by design; see §5.

As of `c30d995` every provisioning path writes the rows (break #20 fixed, closes
when PR #124 merges), so "no row" is no longer the normal state for a company
created outside checkout — it is now only a failed upsert
(`admin.js:425-434`, `onboardingApproval.js:245-255`) or a key an admin
switched off on purpose.

---

## 4. Known breaks and weak links

Each carries the evidence that proves it and the check that re-confirms it.
**None of these may be fixed without human approval.**

### #1 — Preventative maintenance ignores fuel-log readings
**Severity: high.** Directly contradicts how the product is sold.
**Status: fixed.** PR #118 closed the preventative-maintenance half; the
weekly-equipment-report half closed after it, and the two now answer the
question with the *same code* rather than the same intention:
`inspectionReadingPoint` / `fuelReadingPoint` / `latestReadingsByEquipment`
moved out of `api/maintenance.js` into `server-lib/readings.js`
(`api/equipmentreports.js:227` calls them via `applyLatestReadings`). The
move is the fix, not a tidy-up — a second copy of that logic is how this
break happened in the first place.

**A deliberate boundary, recorded so it is not mistaken for a remaining
gap:** the report's **"Used"** column stays inspection-only. It is a sum of
trip deltas (a post-trip's end minus its own start); a fuel-up is a
point-in-time odometer, not a trip. Feeding fuel readings into it would
double-count or invent usage that never happened. Only the **ending
reading** is multi-source. The live consequence is worth knowing: a machine
fuelled far more than its inspections account for still under-reports
"Used", and the ending reading is where that discrepancy becomes visible —
which is why a fuel-derived reading is now labelled as such in both
consumers (`server-lib/reportPdfs.js:129`, `src/Dashboard.jsx:1838`) rather
than silently replacing a trip-derived one.

`api/maintenance.js:128-133` builds PM status from the `inspections` table
alone. `api/fuellogs.js:85-120` (`get_last_reading`) reads **both**
`fuel_logs.hour_reading` and inspection readings and returns whichever is
newer, and the consumption calculation at `:190-240` does the same.

So the fuel module already treats a fuel-up as a valid usage reading, and
the maintenance module does not. A company that buys `inspections` +
`maintenance` + `fuel` (a legal combination — `maintenance` requires
`inspections`, `pricing.js:78`) and fuels daily but inspects weekly gets a
PM clock running behind readings FORA already has on file. A service can
come due and never flag.

*Re-check:* `grep -c "fuel_logs" api/maintenance.js` → was 0 before the fix.
`maintenance.js` already had a `unit_mismatch` status, which is where a unit
disagreement between the two sources lands rather than producing bogus
arithmetic.

*The fix:* both tables now feed one reducer
(`latestReadingsByEquipment`), which takes normalized reading points instead
of raw inspection rows. A company that never bought the fuel module has no
`fuel_logs` rows, so its status is byte-for-byte unchanged — covered by a
case in `tests/unit/maintenance-readings.test.js`.

### #2 — Site is three different columns
**Severity: high** for analytics, medium for daily use.
**Status: fixed.** PR #118 did the write half; PR #120 did the read half,
which had been left open in a way worth naming. `site_id` was written on
submit and then **dropped by every list payload** (`api/logs.js:106,111`,
`api/reports.js:97,102`, `api/flhas.js:417` all SELECTed only the text), so
analytics never saw the key the same PR had just added. A producer nothing
consumes — introduced by the fix for the break it belongs to, the same way
the `delete_site` wedge was.

The analytics tables now key on `site_id` when a row has one
(`siteBucketKey`, `src/analyticsUtils.js:110-114`), so one real site spelled
three ways is one row, a renamed site reads under its current name, and the
field and scheduled tables agree on what a site is called. Rows with no id —
the "other / not in the list" path — keep name bucketing, and the two key
spaces are namespaced so free text can never land in a registered site's
bucket.

**Still two tables, deliberately** (Dillon's call, 2026-09-17): field
paperwork and scheduled inspections answer different questions. Merging them
into one eight-column table is a presentation change that can be reviewed on
its own; keying them the same way is the part that was actually broken.

The original write half: `site_id` (nullable FK) added to `flhas`,
`toolbox_talks`, `daily_reports`, `incidents` and `near_misses`, and
backfilled by case-insensitive name match scoped to company. The text
columns stay: the "other / not in the list" path has no id, and the text is
what the PDF showed at the time, which for an incident report is a legal
record that must not change when somebody renames a site.

**What this break actually was, corrected.** The map said workers typed site
names freely. They do not — all five forms already rendered a dropdown of
the company's real sites with an "other" fallback. The forms resolved the
pick to a NAME and threw the id away. Measured before the fix: **55 of 62
existing free-text rows (89%) matched a real site by name**, which is what a
dropdown in use looks like. So this was never a data-entry problem, it was a
key being discarded at the boundary — shape 3, and the most recoverable kind.

**The `delete_site` half was recorded wrong too.** The map said it "just
deletes the row, leaving dangling `site_id`, where `delete_equipment`
detaches first". A dangling reference was never possible: every FK into
`sites` is `NO ACTION`, so Postgres *refused* the delete and the generic
handler turned that into "Couldn't remove site." with no reason given. That
was already happening for any site used by a fuel log, monthly inspection or
custom document. It now detaches what can be detached and refuses with a
real explanation when it cannot (`inspection_records.site_id` and
`custom_form_records.site_id` are NOT NULL — the site is part of those
records' identity).

Original finding: See the join-key
table above. Consequences:
- Per-site breakdowns (TODO.md's "more advanced analytics") can't be built
  across all document types, only the three with `site_id`.
- A supervisor filtering by site sees an incomplete picture with no warning.
- Deleting a site (`companydata.js:582`) just deletes the row. Compare
  `delete_equipment` (`companydata.js:633`), which explicitly nulls
  `inspections.equipment_id` first. So a deleted site leaves dangling
  `site_id` values on `fuel_logs`, `custom_form_records` and monthly
  inspections — and nothing at all to detach on the free-text side, because
  those rows never pointed at the site to begin with.

*Re-check:* `grep -rn "site_id\|'site'\|job_site" api/*.js`

### #3 — Documents identify people by free text, not roster id
**Severity: medium. Status: fixed in PR #118.** `submitted_by_roster_id`
(nullable FK) on all nine document tables, stamped **server-side from the
session** — so unlike break #2 there is no frontend change at all, the value
cannot be forged, and a queued offline submission is attributed at drain
time to whoever is actually logged in. It is deliberately absent from every
`SUBMITTABLE_FIELDS` allowlist: an author a caller can choose is a
suggestion, not attribution.

**The part that mattered most: anonymous near misses.** `is_anonymous` is a
promise made to a worker in the UI — `src/NearMiss.jsx` says the report is
anonymous and takes no signature, and three such reports already exist.
Stamping an author on one would silently break that promise. A CHECK
(`near_misses_anonymous_has_no_author`) makes it structurally impossible,
verified against production in a rolled-back probe covering all three
directions, including flipping an attributed report to anonymous.

**The backfill is deliberately partial.** Operational forms (FLHA,
inspections, toolbox, daily, fuel) were matched by name within company.
Incidents and near misses were **not**: a text name matching a roster name
is an inference, and on an injury report the cost of one wrong attribution
outweighs linking a handful of historical rows. Going forward both are
stamped from the session, which is authoritative rather than inferred.

Two of three companies are on shared logins with no roster rows, so their
records stay text-only — the same graceful degradation as #2's "other site"
path, which is why the column is nullable.
**Stale as of 2026-10-06 (`b2044ee`):** shared logins no longer exist
(`api/login.js:508-726` is the only customer login: company code, name, PIN).
Whether those two companies have roster rows now is live data this map cannot
see, marked `?` in the changelog row. If they have none, nobody at them can
sign in at all.

**Correction, 2026-09-30 (branch `claude/step1-autofill-name-stamp`): the
"all nine document tables" claim above was wrong for FLHA until this branch.**
`api/flhas.js`'s insert wrote `company_id` only and never
`submitted_by_roster_id`; `authorRosterId` was not even imported there (diff
vs `origin/main`: the import at `api/flhas.js:10` and the stamp at `:426` are
both new). So every FLHA filed before this branch is text-only with a NULL
author, and the Team Member page's per-person document list
(`api/companydata.js:765-775`, `.eq('submitted_by_roster_id', id)`) could not
have shown an FLHA authored by that person by id. Now stamped:
`api/flhas.js:428` (`authorRosterId(session)`). Not backfilled in this
branch (unknown whether a migration exists; `?`).

**Name stamp, same branch.** The free-text name columns are now overwritten
server-side with the roster name via `stampAuthorName`
(`server-lib/authorStamp.js:57-63`; it skips when `isAnonymous` or when the
session has no name, i.e. founder/admin): `api/flhas.js:389`
(`worker_name`, `signed_by`), `api/fuellogs.js:216` (`worker_name`),
`api/logs.js:379` via `AUTHOR_NAME_FIELDS` (`:156-160`: inspection, toolbox,
daily), `api/reports.js:243` (`reporter_name`, `signed_by`; anonymous near
miss keeps its label, so the #3 promise holds). Monthly inspection, custom
form and Portal submits use `sessionDisplayName(session) || typed`
(`api/monthly.js:292`, `api/customforms.js:519`, `api/portal.js:508`). This
works because each `verifySession` now selects and returns roster `name`
(e.g. `api/reports.js:75,80`). Effect on joins: the name-string matches
that still exist (see #32) now agree with the roster name for roster
logins. Founder/admin sessions still submit typed names.

Original finding: Roster login exists precisely so a person is a real
record, but every submitted document stores a name string. Per-worker
analytics, "show me everything Rob submitted", and deactivation-aware
history all become string matching. `WalletInvite.jsx` (the session it stores comes from `rosterId`-keyed `mintRosterSession`, `api/login.js:882`) and
`certifications.js` show the correct pattern.

### #4 — The Brain learns from 4 of 9 document types
**Severity: high. Status: closed, with two documented exclusions.** PR #118
took it from 4 to 6 (`equipment_inspection`, `monthly_inspection`); PR #120
added `daily_report`, taking it to 7. **2026-09-29: Company Portal is covered
too** (`portal_escalation`, 8 source types). The paragraph headed "CLAUDE.md
calls the Brain FORA's flagship" further down is the original as-found text
and is out of date.

**What Portal contributes, and what it does not.** A flagged answer
contributes the document title, question label and receiving department
(`server-lib/portalSignals.js:26-32`, written at `api/portal.js:594-601`);
repeats aggregate into one counted prompt line, `x3` style
(`portalSignals.js:68-83`, called at `companyBrainSummary.js:124`). Assignment
completion and overdue counts per department reach the prompt as fresh reads,
not stored signals (`portalSignals.js:39-64,89-110`;
`companyBrainSummary.js:220-221`). The answer value, the worker and free text
stay out. Guarded by `tests/unit/portal-brain-signals.test.js` (26 tests
across it and `brain-signal-capture.test.js` pass at `23bad5b`) and the
writers-vs-counters scan in `brain-signal-capture.test.js:125`.
Custom documents remain excluded (Dillon, 2026-09-17, reconfirmed
2026-09-29).

**What a daily report contributes, and what it does not.** Crew, visitors
and the narrative stay out — free text with no structured finding, which is
the noise concern that kept the whole document type out of PR #118. But two
of its fields are not prose: `weather` is a pick from a fixed seven-value
list (`src/DailyReport.jsx:12`) and `temperature` parses to a number. Those
are the **one thing no other document type tells the Brain** — a company
working at -35 in an Alberta winter should get cold-stress hazards in its
generated FLHAs, and nothing else FORA collects carries that
(`dailyConditionsSignal`, `api/logs.js`). Out-of-vocabulary weather is
dropped rather than tallied, so the field changing shape cannot quietly turn
this back into a prose signal.

**The two remaining exclusions are deliberate, not open work:**
- **Custom documents** — their shape is entirely customer-defined, so there
  is no field that means the same thing across two companies. Dillon's call,
  2026-09-17.
- **Corrective actions** — they derive from findings the Brain already sees
  (monthly answers, inspection defects), so a signal would double-count the
  same event.

**The guard that keeps this closed is now self-maintaining.** The test
asserting writers and `bySourceType` agree used to hardcode its own list of
writers, so it went stale the moment a writer was added — the same failure
it existed to catch, one level up. Adding `daily_report` exposed that. It
now **scans `api/` for writer literals**, and a second test asserts every
counted type also branches in `server-lib/companyBrainSummary.js`, since a
type can be counted in the Admin Panel and still contribute nothing to the
prompt the model actually sees.

Adding a source type means updating four places, not one: the writer,
`bySourceType` in `api/companydata.js` (an unlisted type is silently
dropped), the Brain tab in `AdminPanel.jsx`, and the prompt builder in
`server-lib/companyBrainSummary.js`. `tests/unit/brain-signal-capture.test.js`
asserts the writer list and `bySourceType` agree.

**Original finding, as found 2026-09-16 (historical, superseded by the
closure above; kept so the evidence trail reads):** CLAUDE.md calls the
Brain FORA's flagship. It received signals only from FLHA edits, toolbox
talks, incidents and near misses. It did not see equipment inspection
defects, monthly inspection findings or daily reports. All three now emit
(`api/logs.js:466`, `api/monthly.js:470`, `api/logs.js:484`).

The single richest source of company-specific knowledge — which machines
keep failing which checks — never reaches the profile that
`src/companyProfile.js:38` injects into all eight document prompts.

Sharpest evidence: `api/logs.js` handles inspections, toolbox talks **and**
daily reports, and emits a signal from exactly one of the three
(`logs.js:244`). The other two run through the same file and write nothing.

*Re-check:* `grep -rn "source_type:" api/` → 3 call sites, 4 source types
(`flhas.js:370`, `reports.js:231` covering two, `logs.js:244`).

### #5 — Corrective actions only close the loop for monthly inspections
**Severity: high. Status: fixed in PR #118.** `corrective_actions` gained
`company_id`, `source_type` and `source_id` (migration
`corrective_actions_any_source`, applied 2026-09-17 with approval) and
`answer_id` is now nullable. Incidents, near misses and Defective equipment
inspection items all open tracked actions, written through one helper
(`server-lib/correctiveActions.js`) so the four sources can't drift.

Two things the fix surfaced, both recorded here because they're the general
lesson rather than this break's detail:

- **A NOT NULL column added ahead of its code is a live outage.** The
  migration landed before the code, and `api/monthly.js` on `main` inserts
  without the new columns *and never checks the error* — so monthly
  corrective actions silently stopped being created. A compatibility trigger
  (`corrective_actions_backfill_trigger`) now derives the columns from
  `answer_id` when a caller omits them. Ship the code first, or land the
  compatibility path in the same migration.
- **"Monitor" items deliberately do not open actions.** Only Defective does.
  Tracking every watch-this item would bury the real defects.
- **A read path that assumes an invariant is weaker than one that proves
  it.** The rewritten `list_corrective_actions` first enriched parent rows
  by `source_id` alone, which was safe only because every writer keeps
  `source_id` inside `company_id`. A future writer taking `sourceId` from a
  request body would have turned it into a cross-tenant disclosure of site
  names and incident details. Every enrichment lookup is now constrained to
  the companies whose actions were returned.

Still open, deliberately: nothing here gives a worker a place to record
routine work they did themselves (changed filters, small fixes). Forcing
that into either the PM service log or a corrective action breaks something
real — see `docs/scope-equipment-service-log.md`.

Original finding: An incident, a near miss, and a failed equipment
inspection all produce a finding that someone must action. Only a monthly
inspection answer can become a tracked corrective action
(`monthly.js:375,518`; `corrective_actions.answer_id`).

Incidents/near misses have their own flat `reviewed` / `reviewed_by` /
`review_notes` columns (`reports.js:94`), which is acknowledgement, not
assignment-and-close-out. Equipment inspections have neither.

### #6 — Nothing enforces the doc-key ↔ module invariant
**Severity: medium**, but the failure is a billing one.
**Status: fixed in PR #120.** The invariant is now a test
(`tests/unit/doc-key-module-invariant.test.js`) instead of a sentence in a
comment, which is the entire fix — no application code changed, because
nothing was wrong with it. The lists agreed. Nothing guaranteed they would
keep agreeing.

`server-lib/pricing.js:50-55` says every key in `BUILTIN_DOC_KEYS`
(`api/customforms.js:119`) must appear in exactly one module, "or a company
could be charged for something it cannot see, or see something it was not
charged for."

**The failure has a direction, and it is the expensive one.**
`api/customforms.js` treats a missing `company_document_settings` row as
**active**, so a document key no module sells is not withheld — it ships to
every company free, silently, with no error and nothing in a log. The
reverse (a module selling a key no document uses) bills for a feature that
cannot be switched on.

Four checks, each confirmed to fail against the mistake it describes: a new
doc key with no module, a key sold by two modules, a module billing for a
key that does not exist, and a `requires` naming a module that does not
exist. The last one matters because `resolveModules()` uses it to reject
buying preventative maintenance without equipment inspections — a typo there
either blocks a legitimate purchase or stops enforcing the dependency.

The test needs no database and no session, which is why this should never
have been a comment in the first place.

### #7 — Weekly equipment reports group by label, not fleet id
**Severity: medium. Status: fixed in PR #119.** The report now groups by a
resolved key: the fleet id when the row carries one, otherwise a normalized
label. Trailers route by `attachedTrailer.id` (which
`src/Inspection.jsx` was already storing alongside the label and discarding),
and tow-unit attachment lines group by `towUnitId`.

**The trap worth recording.** Keying purely on `equipment_id` fixes the merge
direction and *breaks* the other one: a machine picked from the fleet on
Monday and typed by hand on Tuesday has an id on one row and null on the
other, and would split into two report lines where it previously merged
correctly. So a free-text row adopts a fleet id when its label maps to
exactly one machine, and keeps its own key when the label is ambiguous —
guessing there would reintroduce the merge bug from the other side, silently.
`tests/unit/equipment-report-grouping.test.js` pins both directions; label-only
keying fails 3 of them and id-only keying fails 2.

**No migration, and stored reports are untouched.** Only `Object.values()` is
persisted into `report_json`, so the key change is invisible to existing
rows; `equipmentId` and `towUnitId` are additive, and both consumers fall
back to the label when they're absent.

**Root cause left in place, deliberately:** `add_equipment` still requires
only one of make/model/type and leaves `unit_number` optional with no
uniqueness check, which is what lets two machines share a label at all.
Fixing that is a separate change and could block legitimate additions.

**Half of that root cause closed 2026-09-17** (fleet branch, unreviewed).
`activeUnitNumberClash` (`api/companydata.js:100-119`) now rejects a second
ACTIVE machine with the same unit number on add (`:733`), edit (`:794`) and
un-retire (`:829`). Retired rows are excluded on purpose — reusing a scrapped
machine's unit number is normal fleet practice. **Still open:** a machine needs
only one of make/model/type and `unit_number` may be blank, so two rows can
still produce a byte-identical label when neither carries a unit number. The
clash check treats blank as "no asset ID" and skips it (`companydata.js:110`).

**Two statements in this entry are now out of date.** "There is no
`update_equipment` action" was true when written and is not any more
(`companydata.js:775-801`). A rename is safe for the *grouping* — fleet-picked
rows key on `eq:<id>` either way — but not for the *display*: `foldWeeklyUsage`
labels a machine from whichever record it meets first, ascending by date
(`equipmentreports.js:312-320`), while `list_records` resolves the label from
the fleet table (`maintenance.js:371-375`). So after a rename, Equipment ▸
Weekly Hours shows the old name and Equipment ▸ Maintenance Records shows the
new one, for the same machine, one sub-tab apart. Cosmetic, recorded rather
than filed.

Original finding: `api/equipmentreports.js:141` doesn't even select
`equipment_id`; `ensure()` at `:149-158` keys on
`r.equipment_label || 'Unknown equipment'`. Same class as the Analytics
grouping at `analyticsUtils.js:54,203`.

*Wording corrected 2026-09-16.* This entry used to say "a machine
relabelled mid-quarter becomes two machines." There is no `update_equipment`
action, and `Inspection.jsx` and `FuelLog.jsx` derive labels with the same
formula, so fleet-picked rows agree. The live failure is the **merge**
direction: `add_equipment` (`companydata.js:601-614`) needs only one of
make/model/type and leaves `unit_number` optional with no uniqueness check,
so two distinct `equipment.id` rows can produce a byte-identical label and
be summed into one report line. The split direction still happens when the
same machine is sometimes picked from the fleet and sometimes typed.

### #8 — Certification expiry doesn't gate anything
**Severity: medium. Status: fixed in PR #120, deliberately NOT as a gate.**

The original finding was right about the disconnection: `worker_certifications`
was referenced by `api/certifications.js` and by **no other file** in `api/`
or `src/`. Expiry was tracked, alerted on, and reached nothing.

**The original wording pointed at the wrong fix, and this is worth
recording.** It said "a worker whose ticket expired yesterday can still
submit an FLHA for the task that ticket covers". Two problems:

1. **The link isn't computable.** `cert_type` is free text — the input
   placeholder is literally "Type (e.g. Fall Protection)" — and nothing
   anywhere maps a ticket to the tasks or hazards it covers. Gating would
   mean inventing a taxonomy, which is a feature, not a break fix.
2. **Gating is the wrong behaviour anyway.** Refusing a submission would
   stop a worker filing safety paperwork on a jobsite because an
   administrative record lapsed. That is worse than the gap it closes.

So the connection runs the other way (Dillon's call, 2026-09-17): a document
carries its author (`submitted_by_roster_id`, break #3), and a supervisor
reviewing it sees that person's ticket status **as of the day they filed
it** — `src/certificationStatus.js`, shown on the document review card.

**As-of, not "now", is the whole point.** A ticket that lapsed last week was
valid when the worker filed an FLHA three months ago; flagging that document
today would tell a supervisor something false about a record they are
reviewing.

**Two boundaries held on purpose:**
- An **unattributed** document returns nothing at all, never a reassuring
  "no expired tickets". Pre-break-#3 documents carry no roster id, and "we
  don't know who filed this" is a different answer from "they were clean".
- **Anonymous near misses carry no author to badge**, and the reason is
  worth recording because the first attempt got it wrong. That attempt
  withheld `submitted_by_roster_id` from the near-miss list payload, arguing
  that a column always null for anonymous rows would make "this one is null"
  readable beside rows where it is set. It protects nothing: `is_anonymous`
  is selected on the same line and `src/Dashboard.jsx:894,1035,3840` renders
  it as the literal word "Anonymous". Anonymity is a *designed, visible*
  property of a near miss, and denying an inference the payload already
  states outright only cost the badge on the non-anonymous ones.
  The promise rests on two structural guarantees instead, both now pinned by
  tests: `authorRosterId()` nulls the column at write time, and a CHECK
  (`roster-attribution-migration.sql:58`) makes an anonymous row carrying an
  author impossible. There is no row where the column could betray an
  identity.

**A third instance of the same pattern found on the way.**
`submitted_by_roster_id` was written by every submit path in PR #118 and
**selected by nothing** — this break could not be built until the column was
readable. That is the same "producer nothing consumes" shape as `site_id`
(break #2) and `equipment_id` (break #7), each introduced by the fix for the
break it belonged to.

### #9 — Post-trip defects never reach Equipment Analytics
**Severity: medium. Status: fixed in PR #118.** Dillon's call: Analytics
counts both trip types and the copy changed to match. `Dashboard.jsx` was
the side that was right, so it is untouched; `analyticsUtils.js` now agrees
with it, and a test asserts the two reconcile on the same input. The
`pretripCount` field is now `inspectionCount`, renamed through
`Analytics.jsx` and `generateEquipmentAnalyticsPDF.js` so the PDF and the
screen still match. Closes when the PR merges.

Original finding: `src/analyticsUtils.js:52` drops every non-pretrip row
(`if (i.trip_type !== "pretrip") return;`) before reading the defect
counters, on the stated premise — `analyticsUtils.js:48-49` — that "posttrip
rows don't have them." That premise is false as shipped:
`src/Inspection.jsx:428-429` writes `defectiveCount`/`monitorCount` on the
post-trip record too.

So the one screen meant to answer "which machine keeps failing" is blind to
damage caught at the *end* of a shift, which is when in-service damage
actually surfaces. Worse, three readers disagree on one number:
`Dashboard.jsx:5352-5353` (and `inspIssueCount`, `:4159-4162`) sums both trip types, `analyticsUtils.js` counts
pretrip only, and `api/equipmentreports.js:172-180` counts post-trip changes
via `has_changes`. The Inspections tab and the Analytics tab are computed
from the same array and will not reconcile.

**The decision:** `Analytics.jsx` labelled the table "Pretrip inspections
flagged Defective or Monitor", so the narrow scoping was at least
intentional in the copy — which is why this went to Dillon rather than
being fixed outright. He chose: count both, change the copy.

---

### #10 — A post-trip defect opened no corrective action, ever

**Severity: high. Status: fixed in PR #121.** Reported by Dillon on
2026-09-17 from a live submission: he flagged a flat tire on a pre-trip, did
the post-trip on the same machine, and the post-trip neither mentioned the
tire nor recorded anything about it.

`server-lib/correctiveActions.js`'s `correctiveActionsFromInspection` has
always read `results.items`. A **pre-trip** stored that array. A **post-trip**
did not: its `results_json` was a single
`{hasChanges, changeCondition, changeNotes}` blob built at
`src/Inspection.jsx:423-429` (pre-PR-#121 line numbers). So the same helper,
the same table, the same `type === 'inspection'` branch in `api/logs.js`
opened an action for a defect found at the START of a shift and silently
nothing for the identical defect found at the END.

**The shape is worth naming because it is not the one 4b describes.** That
section covers a key written and never read. This is the mirror image: a
consumer reading a field **one of its two producers never wrote**. Same
silence, same absence of any error, and the same reason nobody found it — the
feature worked in the case anybody tested.

The post-trip now runs the pre-trip's own stored checklist rather than a
regenerated one (`src/Inspection.jsx`, `buildPosttripItems`), so the trailer's
items come with it and the two halves of a trip are comparable line for line.

Two second-order effects this exposed, both handled:
- **The Brain suddenly had a double-count.** `inspectionFindingSignal`
  (`api/logs.js:152`) also reads `results.items`, so post-trips began feeding
  it — a genuine gain (what breaks DURING a shift was never visible) that
  would have tallied an unchanged carried fault twice. A carried item is
  signal only when its condition changed (`api/logs.js:157-170`).
- **A carried defect must not open a SECOND action.** One open action per
  machine per fault (`server-lib/correctiveActions.js:153-199`), or a fault
  nobody has fixed crosses the recurrence threshold inside a single day.

*Re-check:* `grep -n "results.items\|results_json.items" server-lib/correctiveActions.js api/logs.js`
— every consumer of that array must now be true for both trip types.

### #11 — Nothing could close an equipment corrective action from the field

**Severity: high. Status: fixed in PR #121.** The other half of #10, and the
reason "there was no log for it anywhere that that unit had a flat tire
previously" was true even for faults that *had* been fixed.

An action could be opened by a worker and closed only by a supervisor on the
dashboard, with no record of what was actually done — `status` flipped to
`resolved` and that was the entire audit trail. A repair performed on the
jobsite reached neither `corrective_actions` nor
`equipment_maintenance_log`, so a machine's history showed the fault
appearing and never showed it being fixed.

A post-trip item marked **Fixed** now closes the matching open action
(`server-lib/correctiveActions.js:272`) with the worker's own words in
`resolved_note`, and writes a `field_service` row against the machine
(`api/logs.js:513`).

**Matching on (machine, item) rather than on the linked pre-trip's id is the
part that matters.** Keyed to one pre-trip, Thursday's fix closes Thursday's
action and leaves Tuesday's unfixed-and-still-open one forever — the
supervisor's list slowly fills with defects repaired weeks ago, which is how
a list stops being read.

**`field_service`, never `pm_service`** — see
`docs/scope-equipment-service-log.md`. A worker saying "the tire's fixed"
must not reset a 250-hour service clock;
`latestServiceByEquipment` (`api/maintenance.js:87`) filters on
`entry_type` precisely so this fourth writer is safe.

### #12 — The post-trip PDF's pre-trip half was always blank

**Severity: medium. Status: fixed in PR #121.** Pre-existing on `main`,
confirmed by stashing the branch and re-reading it. Found by
`pdf-consistency-reviewer` while reviewing #10's diff.

`src/generateInspectionPDF.js` reproduces the pre-trip in full inside the
post-trip document, so one PDF is the whole story. It was only ever handed
`{id, start_reading, reading_unit}` — so `linkedPretrip?.results_json?.items`
was always `[]`, and **every post-trip PDF FORA has ever produced** printed
the italic line "Pre-trip checklist not available.", an em dash for PRE-TRIP
INSPECTOR, and, on a truck with a trailer, the single-column MACHINE box
instead of TOW VEHICLE / TRAILER.

A producer whose consumer received nothing — the same family as 4b, one
level further out: the field existed, the reader read it, and the *caller*
never populated it. Nothing on screen was wrong; only the document that goes
in the audit binder.

The pre-trip's results, author and timestamp now ride in the submission
payload rather than being re-fetched, so a post-trip drained from the offline
queue days later renders the document it would have rendered when it was
signed.

*Re-check:* `grep -n "linkedPretrip" src/Inspection.jsx` — the object built
there must carry every field `generateInspectionPDF.js` reads off it.


### #13 — A daily report's machine ids are written and read by nothing

**Severity: medium. Status: BUILT, NOT CLOSED — `42ed3c7` on
`claude/modular-pricing-enforcement-rzdib2`; closes when that branch's PR
merges.** Found 2026-09-17 on the fleet branch; approved by Dillon 2026-09-23,
who picked the first consumer: **Fleet Overview, "last on site"**.

**What was built** (every line re-read 2026-09-23 against `42ed3c7`):

| Piece | Where |
|---|---|
| Read | `api/companydata.js:857-883` (`fleet_activity`) — supervisor/admin only (`:858`), `resolveCompanyId` (`:859`), every query `.eq('company_id', companyId)` (`:863-866`); `daily_reports` read at `:864`; `mountedOn` filtered to the company's fleet ids (`:877-880`, `afc4b93`) |
| Fold | `lastOnSiteByEquipment`, `server-lib/fleetActivity.js:36-49` — pure; latest `report_date` (falls back to the `created_at` day) per id, with that report's `site` |
| Screen | `src/Dashboard.jsx:2470-2478` (`loadFleetActivity`, called from `loadFleet` at `:2463`, so every fleet refresh refreshes it); `:6057-6068` renders the line on each Fleet Overview row |
| Tests | `tests/unit/fleet-activity.test.js:25,34` (the fold); `tests/fleet-activity.spec.js:11` (Playwright: the line appears on the row) |

*Evidence, re-run by this pass:* `node --test tests/unit/fleet-activity.test.js`
→ 8/8 pass; `npx playwright test tests/fleet-activity.spec.js` → 3/3 pass at
`42ed3c7`. The same spec with `tests/helpers.js` copied into a `363da23`
worktree → **3/3 fail** (the Fleet Overview line, the forks/trailer PM set-up,
the analytics cards). The unit file is a pure-function test of a module that
did not exist before, so it has no meaningful "before" run — the spec is the
before/after evidence. `npm run test:unit` → **415 pass, 0 fail**.

**Not built, on purpose:** the other two candidates below (Analytics'
equipment grouping, the weekly equipment report). Dillon chose one consumer,
as this entry recommended. Analytics still groups machines by
`equipment_label` and does not see the daily report.

*As found, 2026-09-17:*
The fourth instance of §4b, and the map is recording it while the column is
still in the working tree rather than after the fact.

`daily_reports.equipment_ids` (jsonb array) is produced by
`src/DailyReport.jsx:296` and `:44`, ownership-vetted by `resolveEquipmentIds`
(`api/logs.js:386-389`, `server-lib/equipmentScope.js:119-152`), and selected
into the list payload (`api/logs.js:130`). Then it stops.

*Re-check:* `grep -rn "equipment_ids\|equipmentIds" api/ src/ server-lib/`
→ producer, allowlist, validator, list payload. No aggregator, no screen, no
report, no analytics function. Run 2026-09-17 against `ea1c9e1`: 10 hits, zero
consumers.

**What the customer doesn't get.** "Which machines were on site last Tuesday",
"what was this excavator doing the week before it broke", and a machine's day
history next to its inspection and fuel history — all still unanswerable by a
join, exactly as they were before the column existed. `src/analyticsUtils.js`
still groups equipment by `equipment_label` (`:68,258`) and the daily report is
not in that grouping at all, and the daily report
does not appear in that grouping at all.

**This was a deliberate scope line on the branch that added it, not an
oversight** — but it is the exact shape this map exists to catch, so it is
filed rather than assumed harmless. §4b's whole point is that the column fills
with correct data nobody looks at, and the next session reads the changelog and
believes the join exists.

**Candidate consumers, none built:** a machine's own screen showing which days
it was on site; utilization compared against the hours the same machine logged
on its inspections; the Brain seeing which machines actually work together.

**A fix would touch:** whichever consumer is chosen first — the Fleet Overview
row (a "last seen on site" line), `analyticsUtils.js`'s equipment grouping, or
the weekly equipment report. Not all three at once. No migration.

### #14 — A machine's compliance expiries reach nothing but their own screen

**Severity: high. Status: CLOSED — PR #122 merged as `d91fcb6`, 2026-09-18.**
Found 2026-09-17 on the fleet branch, approved by Dillon 2026-09-18, both
approved halves built and merged the same day.

**What was built** (only the two halves Dillon approved):

| Half | Where |
|---|---|
| `compliance_summary` action | `companydata.js:941` — same shape as `certification_summary`: `resolveCompanyId` + `company_id` on the row, supervisor/admin only, machine names resolved in a second `company_id`-scoped query and only when there is something to name |
| Overview banner | `Dashboard.jsx:4917` (state `:2009`, loader `:2662-2667`) — red when something is already expired, amber when only coming due; gated on having something to show, the same way the Compliance sub-tab is gated today |
| Weekly report section | `equipmentreports.js:377` (`foldComplianceSnapshot`) + `:593-618` (the company-scoped query, into `report_json.compliance`) → `reportPdfs.js:142-232` (the rendered section). `cron-equipment-reports.js:74` uses the same builder, so the Sunday-night PDF carries it |
| One definition of the vocabulary | `server-lib/compliance.js` — `EXPIRY_WARNING_DAYS` / `expiryStatus` / `expiryText` and `COMPLIANCE_DOC_TYPES` / `complianceDocLabel` moved out of `Dashboard.jsx` unchanged, now imported by the browser bundle and by both handlers. A second 30-day window on the server would have been this map's own §4 shape, one release later |
| Tests | `tests/unit/equipment-compliance-expiry.test.js` — the today/yesterday boundary, the 30-day edge, as-of-week-end classification, an unresolvable machine, and that a report written before this renders byte-identical |

**Deliberate decisions, worth re-reading before changing any of it:**

* Compliance rows are snapshotted into `report_json` **at build time**, not
  read live at render time. The PDF is rendered once and cached on the row
  (`equipmentreports.js:127`), so "live" would really mean "live for whoever
  opened it first" and would freeze from then on. The section prints the date
  it is as of.
* Classification is as of the report's own **week end**, so a report pulled
  for an old week says what was expired *then*. That is what a snapshot is.
* Retired machines still counted, because they still counted on the Compliance
  tab, and three surfaces disagreeing is worse than one being wrong. Shipping
  this gave **#15** two more places to be seen, weekly and in print —
  deliberately, so all three could then be filtered together rather than one at
  a time. **#15 (PR #123, draft) is that follow-up**: all three now drop a
  retired machine, and the comment here saying `compliance_summary` does not
  filter was removed from the code rather than left contradicting it.
* No doc key and no pricing module were added — that is **#19**, open and not
  approved.

`equipment_compliance` is written and read by `api/companydata.js:902-969` and
consumed by exactly one screen, Equipment ▸ Compliance
(`src/Dashboard.jsx:2512,2604,2630` → `:6208-6297`, re-anchored at `42ed3c7`).

*Re-check:* `grep -rn "equipment_compliance" api/ src/ server-lib/` → 6 hits in
`companydata.js`, 3 in `Dashboard.jsx`, nothing anywhere else. Run 2026-09-17.

**What the customer doesn't get.** A CVIP that lapses on Tuesday is invisible
unless somebody opens Equipment ▸ Compliance and looks. It is not on the
dashboard overview, not in the Sunday-night weekly equipment report
(`server-lib/reportPdfs.js` has no reference to it), not emailed by
`api/cron-equipment-reports.js`, not on the machine's own Fleet Overview row,
and not a Brain signal. The truck goes out the gate expired and FORA knew.

**The comparison that makes this a break rather than a wish.** FORA already
solved this exact problem for the other expiry date it tracks: worker
certifications get a dedicated overview banner on every dashboard open
(`src/Dashboard.jsx:4885-4899`, fed by `certification_summary` in
`api/certifications.js:266-300`, with a 30-day `expiring_soon` window at
`:33-40`). Machine compliance uses the same three-state model
(`expiryStatus` → expired / due_soon / ok, `src/Dashboard.jsx:6227-6229`) and
gets none of the reach. Two expiry features, one surfaced, one silent.

A machine whose CVIP expired last week inspects, fuels and reports exactly as
it did the week before. Note the limit of the analogue: break #8 records that
certification expiry still does not *gate* anything — so the bar being set here
is "at least visible", not "handled".

**A fix would touch:** a `compliance_summary` action beside
`certification_summary`, the overview banner, and/or a section in
`server-lib/reportPdfs.js`. The weekly report is the higher-value half — it is
the thing a supervisor reads without opening the dashboard. No migration.

### #15 — Retiring a machine doesn't retire its maintenance clock

**Severity: medium. Status: fix built on
`claude/equipment-tab-fleet-mgmt-9g0xra`. CLOSED — PR #123 merged as
`18645f0` (see §6).** Found 2026-09-17 on the fleet branch, approved by
Dillon 2026-09-18 including the product call below, built the same day.

Retiring is the whole point of the new column: hide a sold or scrapped machine
from every worker picker while keeping every row that references its id
(`api/companydata.js:704-718`). The pickers honour it. Preventative maintenance
does not.

`api/maintenance.js:133-137` selects the fleet with **no `retired_at` filter**
and `:186-207` computes a status for every row returned. A retired machine with
a `pm_interval` and a service baseline keeps its last known reading forever, so
its `usageSinceService` is frozen at whatever it was — and if that was past the
interval, it reports `overdue` permanently (`maintenance.js:201-204`). That
count feeds the Equipment nav badge (`src/Dashboard.jsx:4787-4789`), so the badge shows work outstanding on a
machine the company no longer owns, and there is no way to clear it short of
hard-deleting the row, which destroys the history retirement exists to keep.

Same shape, smaller: a retired machine's compliance rows still count in the
Expired / Due-in-30 stat strip. The **add** dropdown uses `activeFleet`
(`src/Dashboard.jsx:6242`) but the list and the counters use the unfiltered
`compliance` array (`:6227-6229`) — still true of the browser at `42ed3c7`; since
#15 the server filters that array before it arrives.

*Re-check, before the fix:* `grep -n "retired" api/maintenance.js` → four hits,
all inside `list_records`. `list_status` had none. Run 2026-09-17 against
`ea1c9e1`, and re-run 2026-09-18 against `d91fcb6` — still open, which is why
this was built rather than closed on sight.

*Re-check, after:* `npm run test:unit` → 313 pass. Reverting only `api/` to
`d91fcb6` with the tests in place fails 5 of 13 in
`tests/unit/retired-equipment-scope.test.js` — PM status, the Compliance list,
the banner/list agreement and the report snapshot — while the three
must-not-change guards pass both before and after. That before/after pair is
the evidence, not the grep.

**The product call, settled by Dillon 2026-09-18: filter them out.** A retired
machine is *operationally gone* — no PM clock, no expiry counts, not on the
weekly report, not in any stat tile or nav badge — and *historically present* —
every inspection, fuel log, service entry and corrective action kept, and still
in Fleet Overview behind the "Show retired machines" toggle.

**What was built** (PR #123, draft):

| Surface | Where |
|---|---|
| PM status | `maintenance.js:132-153` — `.is('retired_at', null)` on the fleet query, the same filter `list_equipment` already used. The only filter added in that file |
| Compliance tab list | `companydata.js:914-942` (filter at `:941`) — `withoutRetiredEquipment`, asking for the retired set only when there is something to filter |
| Overview banner counts | `companydata.js:960-1021` (filter at `:979-980`) — the same rule, applied *before* anything is counted. #14's comment saying this deliberately did NOT filter is removed rather than left stale |
| Weekly report snapshot | `equipmentreports.js:594-630` (drop at `:619,630`) — dropped before the fold, reading `retired_at` off the fleet rows the builder already fetched, so no extra query |
| The shared rule | `server-lib/equipmentScope.js` — `retiredEquipmentIds` (company-scoped query) and `withoutRetiredEquipment` (pure). One definition, because the counts and the lists have to agree on every screen |
| Tests | `tests/unit/retired-equipment-scope.test.js` — 13 cases against the real handlers via a PostgREST stand-in. Four pin the break closed; three pin `list_records`, `resolveEquipmentId(s)` and `companyEquipmentIndex` *open*, so a later "make it consistent" pass can't wedge an offline queue |

Fails toward showing too much: `retiredEquipmentIds` returns `null` for "I
don't know" on a read error, which leaves every row in place. Emptying a
supervisor's Compliance screen over a transient outage is worse than briefly
showing a machine that has been sold.

Untouched on purpose: `list_records`, `companyEquipmentIndex`,
`resolveEquipmentId`/`resolveEquipmentIds` and Fleet Overview — see §5. No
migration, no `src/` change (the stat tiles are computed in the browser from
these same payloads), no new `api/` file.

### #16 — The inspection PDF grouped checklist items by a tag the form stopped writing

**Severity: medium. Status: FIXED on the branch before merge; CLOSED — PR #122
merged as `d91fcb6`.**
§4b's mirror image: the producer changed the value, one of two consumers never
learned. Found by this map's pass on the pre-fix working tree and independently
by `pdf-consistency-reviewer`, which is what fixed it.

`src/Inspection.jsx:467` tags an attachment's checklist items
`unit: "attachment"` (it used to be `unit: "trailer"`). The on-screen checklist
was updated to match — `it.unit === "truck" ? "MACHINE" : "ATTACHMENT"`
(`src/Inspection.jsx:920,1108`) — and so was the PDF's info box
(`generateInspectionPDF.js:223,242,255`). The PDF's **body** was not: both
banner branches tested `it.unit === "trailer"`, so a bent set of forks would
have printed under a blue "TRUCK / TOW VEHICLE — Forks" banner, on the same
page as an info box saying ATTACHMENT. The document would have contradicted
itself, and the banner exists precisely so a reader cannot mistake an
attachment's defect for one on the machine carrying it.

**The fix went further than the report asked, correctly.** Keying on `unit`
alone would still have merged a truck's pup and its trailer into one group
named after whichever came first. Grouping now runs through `unitKey()`
(`src/generateInspectionPDF.js:16-20`), which keys on `attachmentId` and falls
back to `unitLabel` — the same id-first, label-second rule
`attachmentForItem` uses, so the PDF and the weekly report identify an
attachment the same way.

*Re-check:* `grep -n 'unit === "trailer"' src/generateInspectionPDF.js` → no
hits (run 2026-09-17 against `ea1c9e1`). Consumers now at `:69` (checklist
banner) and `:141` (deficiency grouping).

**Recorded, not closed, until PR #122 merges.** And recorded even though it was
fixed within hours, because the *shape* is the lesson: a data-shape change
broke a consumer nobody thought of as a consumer, and nothing failed.

### #17 — An attachment's defect opens a corrective action against whatever was carrying it

**Severity: high. Status: BUILT, NOT CLOSED — `bb13340` on
`claude/modular-pricing-enforcement-rzdib2`; closes when that branch's PR
merges.** Pre-existing since PR #121 for trailers; widened 2026-09-17 to every
kind of attachment; approved by Dillon and built 2026-09-23.

**What was built** (re-read 2026-09-23 against `42ed3c7`):

| Piece | Where |
|---|---|
| Each finding knows its machine | `server-lib/correctiveActions.js:419` (`correctiveActionsFromInspection`) and `:449` (`resolvedItemsFromPosttrip`) attach `{id, label}` through `itemAttachment` (`:471-478`) — `item.attachmentId` first, then `attachmentForItem`; only on `unit: 'attachment'` / legacy `'trailer'` items, so a carrier-only finding keeps its old shape |
| Split per machine | `groupFindingsByMachine` (`correctiveActions.js:489-504`) — host id/label for the carrier's items, the attachment's for its own |
| Vetted before it is stored | `api/logs.js:513-515` — attachment ids from `results_json` (client jsonb) go through `resolveEquipmentIds`; an id not in the vetted set is dropped to label-only (`correctiveActions.js:495`), never stored |
| Open, close and log per machine | `api/logs.js:517-527` (open), `:543-563` (post-trip resolve), `:575-581` (the `field_service` repair line lands on the **attachment's** id) |
| Resolve is company-filtered on the write too | `resolveCorrectiveActionsForItems`' update now carries `.eq('company_id', companyId)` (`server-lib/correctiveActions.js:345`) beside `.in('id', ids)`, added in `afc4b93` from the tenant-scope review. The ids already came from a company-filtered read (`:314-319`); the filter keeps the write safe if that read ever changes |
| Tests | `tests/unit/attachment-defect-routing.test.js` — 6 cases |

*Evidence, re-run by this pass:* `node --test tests/unit/attachment-defect-routing.test.js`
→ **6/6 pass** at `42ed3c7`; the same file copied into a `363da23` worktree →
**5 fail / 1 pass** (the pass is the carrier-only case, which should be
unchanged). `npm run test:unit` → 415 pass.

**The narrower second half was already closed before this build.**
`buildPosttripItems` now carries `attachmentId` forward
(`src/Inspection.jsx:393`, with its reason at `:385-392`), on `main` before
`363da23` — so the post-trip routing below no longer falls back to label
matching. The §4b mirror-table row for `item.attachmentId` is updated.

**Not in the approved scope, filed separately as #30:** the Brain signal for
the same inspection still names the carrier (`api/logs.js:214-215`). The §3
matrix had pointed the Attachments → Brain cell at #17; that cell now points
at #30 so #17 can close on what was actually approved.

*As found, 2026-09-17 — `api/`/`server-lib/` numbers as of `ea1c9e1`; the `Dashboard.jsx` one re-anchored at `42ed3c7`:*

`api/logs.js:496-497` hands `openCorrectiveActions` the **host record's**
`equipment_id` and `equipment_label` for every Defective item on the checklist,
including the items belonging to an attachment. The attachment's identity
survives only inside the description string
(`server-lib/correctiveActions.js:407-413` prefixes `unitLabel`; the id never
travels with the finding at all).

Two consequences, both silent:

- **Recurrence counts the wrong machine.** `(machine, item_key)`
  (`server-lib/recurrence.js:49-65`) resolves the machine from
  `equipment_id`/`equipment_label`, so the trailer's third flat tire in 90 days
  is filed against whichever truck towed it that day. Towed by three different
  trucks, it never reaches the threshold at all — and each truck accumulates a
  fault it never had.
- **The per-machine repeat-offender list** (`api/monthly.js:860`
  `patternsByEquipment` → `src/Dashboard.jsx:3559,6486`) inherits the same
  wrong attribution.

**What it looks like to a customer.** A bent set of forks flagged on a
loader's pre-trip opens an action against **the loader**. Move the forks to a
second loader and the defect stays filed against the first, the recurrence
counter keys on the wrong machine, and the fault appears to follow whatever
happened to be carrying it.

**The reason this is filed now rather than as a style note:** the weekly
equipment report routes the identical defect **correctly**, to the attachment's
own report line (`api/equipmentreports.js:468`, via `attachmentForItem`). Two
features now disagree about which machine a defect belongs to, from the same
row. That disagreement did not exist before `attachmentForItem` was written.

**A second, narrower half in the same area.** `buildPosttripItems`
(`src/Inspection.jsx:374-393`) copies `unit` and `unitLabel` forward from the
pre-trip but **drops `attachmentId`**. So on a post-trip, even the report's
correct routing falls back to label matching — which the helper's own comment
says is the fallback precisely because "two attachments can share a label and
only one of them is broken" (`server-lib/inspectionAttachments.js:55-59`).

*Re-check:* `grep -n "attachmentId\|unitLabel" server-lib/correctiveActions.js`
→ `unitLabel` at `:411` for the description prefix, `attachmentId` nowhere. Run
2026-09-17 against `ea1c9e1`.

**A fix would touch:** `api/logs.js`'s call site (resolve each finding's machine
through `attachmentForItem` before choosing `equipmentId`),
`server-lib/correctiveActions.js`'s per-finding shape, and one line in
`buildPosttripItems`. Migration: none — the columns are already there.

### #18 — A towed or carried attachment's usage never reaches its PM clock

**Severity: medium. Status: BUILT AS RESCOPED, NOT CLOSED — `42ed3c7` on
`claude/modular-pricing-enforcement-rzdib2`; closes when that branch's PR
merges.** Pre-existing; opened 2026-09-17.

**Dillon rescoped it before it was built (2026-09-23), answering the decision
this entry asked for** (whether towed distance should drive a PM clock at all):

> "Attachments won't get a preventative maintenance log, unless it's a
> trailer. Things like loader forks don't require preventative maintenance."

plus two additions: **track what an attachment is mounted on**, and name the
**most used and most repaired attachment** in analytics. So the build is not
"a third reading-point source for every attachment", which is what the
original "fix would touch" below proposed. It is:

| Piece | Where |
|---|---|
| Who may have a clock | `pmAllowedFor` (`server-lib/fleetActivity.js:88-91`) — every machine, except an `is_attachment` machine that `isTrailerTemplate` (`src/equipmentInspectionTemplates.js:794`) does not call a trailer. Since #28 (`1301c76`) "is it towed" is `isTowedUnit` (`fleetActivity.js:79-82`), by type alone |
| PM status | `api/maintenance.js:216-222` — a non-trailer attachment reads `not_tracked`, **even with a legacy interval**, rather than a clock that never moves; `:223-242` — a trailer's usage is the KM towed since its last service (`towedDistanceSince`, `fleetActivity.js:99-119`), where it used to sit at `ok` forever |
| Setting an interval | `api/companydata.js:1273-1275` refuses one on a non-trailer attachment; `:1276-1279` refuses a trailer (by type since #28)'s interval in anything but KM. Clearing an interval is always allowed, so a legacy one on a set of forks can be removed |
| Maintenance screen | `src/Dashboard.jsx:6446-6447` (towed line), `:6543` (unit locked), `:6548-6552` (no starting-reading box for a trailer), `:6559-6561` ("Attachments don't get a maintenance schedule unless they're a trailer.") |
| Mounted on | `mountedOnByAttachment` (`fleetActivity.js:56-69`), filtered to the company's fleet ids in `fleet_activity` (`api/companydata.js:877-880`, added in `afc4b93` from the tenant-scope review — attachment ids are client jsonb) → `Dashboard.jsx:6060-6062` — from the most recent **pre-trip** only; a post-trip only carries items forward |
| Most used / most repaired | `attachmentStats` (`fleetActivity.js:126-148`) → `Dashboard.jsx:5963` → `Analytics.jsx:362-370`. "Used" = pre-trips it was recorded on; "repaired" = every `equipment_maintenance_log` row against it, `pm_service` included |
| Tests | `tests/unit/fleet-activity.test.js:66,79,84,93`; `tests/unit/timeclock-gate.test.js` cases 21 and 23 (the interval refusals, against the real handler); `tests/fleet-activity.spec.js:27,45` |

*Evidence, re-run by this pass:* `node --test tests/unit/timeclock-gate.test.js`
→ **23/23** at `42ed3c7`; the same file in a `363da23` worktree → **2 fail /
21 pass**, the two being "a set of forks cannot be given a PM interval" and "a
trailer can be given an interval in KM, and not in hours". The Playwright spec
fails 3/3 before and passes 3/3 after (see #13). **One gap in the evidence:**
`list_status`'s towed branch (`maintenance.js:223-242`) is pinned only through
the pure `towedDistanceSince` and a mocked API in the spec — no test runs the
real handler's towed path. `npm run test:unit` → 415 pass.

**The deliberate non-connection this creates** — a non-trailer attachment has
no PM clock — is recorded in §5 so it is never re-filed.

**Three residuals, verified in code by this pass and filed rather than folded
in:** #28 (a trailer the inspection treats as an attachment but the fleet row
does not flag gets the old `ok`-forever clock), #29 (a trip towed by a
free-text machine credits Weekly Hours and not PM), #30 (the Brain half of
#17's matrix cell).

*As found, 2026-09-17 (numbers as of `ea1c9e1`):*

An attachment has no meter, so an inspection of one stores no reading
(`src/Inspection.jsx:71` writes `reading_unit: null` when `isTrailer`). FORA
already compensates for this in two places: the weekly report credits an
attachment the towing unit's distance for the trip
(`api/equipmentreports.js:491-511`) and so does the new Weekly Hours screen
(`:343`), with the reason written down — *"without that, every towed unit on
the hours screen reads zero forever, which is worse than absent because it
looks like an answer"* (`equipmentreports.js:293-296`).

Preventative maintenance does not compensate. `api/maintenance.js:201` computes
`usageSinceService = current ? Math.max(0, current.reading - baseline) : 0` and
`current` is null for a machine with no readings — so a trailer with a
5,000 km bearing interval sits at `usageSinceService: 0`, status **`ok`**,
forever. Not `not_started`, not `unknown`: `ok`.

So a supervisor can open Equipment ▸ Weekly Hours and see the trailer ran
400 km last week, click one sub-tab over to Equipment ▸ Maintenance, and see it
has done nothing since its last service. Same hub, same week, two answers.

**This is break #1's exact shape one level out** — two features answering the
same usage question from different sources — and `server-lib/readings.js` was
created so that couldn't happen again. It takes reading points; a towed-distance
credit is not one yet.

*Re-check:* `grep -n "attach\|trailer" server-lib/readings.js api/maintenance.js`
→ no hits. Run 2026-09-17.

**How narrow this actually is, in fairness to it.** Most attachments are
inspected, not serviced on a clock — the set that matters is a trailer with
wheel bearings, a hammer on an hour-based rebuild. Worth knowing the option
exists rather than worth building on its own. It is also worth stating the
status precisely, because it is easy to get wrong: an attachment with an
interval but no service logged reports `not_started`; one with a service
logged reports **`ok`**, not `not_started` and not `unknown`
(`api/maintenance.js:194-204`).

**A fix would touch:** `server-lib/readings.js` (a third reading-point source,
derived from completed trips carrying attachments) and nothing in
`api/maintenance.js` itself if it is done there, which is the point of that
file existing. Needs a decision first on whether towed distance should reset a
PM clock at all — a trailer's bearings care about distance, a bucket's pins do
not care about the excavator's hours.

### #19 — Fleet Overview and Compliance ship to every company with no module behind them

**Severity: low, but it is a billing question. Status: DECIDED AND BUILT
2026-09-18 (`2560819`). CLOSED — PR #124 merged as `57efbeb` (verified 2026-09-23: `main` carries it).**

**The decision, Dillon's, recorded in `2560819`'s commit message:** Compliance
becomes a paid module; Fleet Overview stays in BASE.

*Compliance half — closed.* Verified 2026-09-18 against `2560819`:

| Piece | Where |
|---|---|
| Module | `server-lib/pricing.js:98-103` — `compliance`, "Equipment Compliance", $20 basic / $45 advanced, sole `docKeys` entry `equipment_compliance`. Placed next to `certifications` (`:92-97`), the closest analogue: same three-state expiry model, same 30-day window, people instead of machines |
| Doc key | `api/customforms.js:119` (13th built-in) + label at `:734` — without the label the Admin Panel renders the raw key (`BUILTIN_LABELS[key] \|\| key`, `:321`) |
| Sub-tab | `src/Dashboard.jsx:2784` (`complianceEnabled`) → `:2869` |
| Overview banner | `src/Dashboard.jsx:4917` — `complianceEnabled &&` prepended to the existing has-something-to-show test |
| Weekly report section | `api/equipmentreports.js:618-625` — `isDocKeyActive` (`:163-171`), query **skipped**, not filtered |
| Cron | `api/cron-equipment-reports.js:40-48` — its copy of `isDocKeyActive` still defaulted a missing row to active, which would have contradicted `edd7a41`; now matches |
| Existing companies | `docs/schema/equipment-compliance-module-backfill.sql`, applied — explicit row per company, company 1 (demo, the only one holding compliance rows) true, the other two false |

The invariant test was made to **fail on purpose** between adding the module and
adding the key (`2560819`'s message: *"these modules bill for document keys no
document uses: equipment_compliance"*), which is the evidence the net from break
#6 is live rather than decorative.

*Fleet half — decided as BASE, not a gap.* `EQUIPMENT_SUBTABS`
(`src/Dashboard.jsx:2864`) still carries `{ key: "fleet", on: true }`, and
`TAB_VISIBLE.equipment` (`:2826`) is still unconditional `true`. The rationale
is now a decision rather than only a code comment: the fleet list is reference
data every other module joins to — `equipment_id` is this map's most
load-bearing key — the same way Analytics and SOPs are always-on. Its write
actions (`companydata.js:903` update, `:952` retire/restore) stay ungated to
match. **Do not re-file this half.** See §5.

*What the Fleet half means in practice, stated so it is not rediscovered as a
break:* a company that bought only the FLHA module still gets the Equipment tab
with Fleet Overview in it and can add, edit and retire machines. That is now
intended.

Original finding: `TAB_VISIBLE.equipment` was `equipmentReportsEnabled`
(`git show c68f57d:src/Dashboard.jsx`, line 2505) and is now unconditionally
`true` (`git show ea1c9e1:src/Dashboard.jsx`, line 2767). Inside it, `EQUIPMENT_SUBTABS`
(`git show ea1c9e1:src/Dashboard.jsx`, lines 2800-2810) marks Fleet Overview and Compliance `on: true`
while the other six are gated on a doc key. Neither has an entry in
`BUILTIN_DOC_KEYS` (`api/customforms.js:119`) or a module in
`server-lib/pricing.js:60-117`.

That is break #6's expensive direction, stated in `pricing.js:50-56`: a feature
no module sells is not withheld, it ships to every company free and silently.
A company that bought only the FLHA module now gets fleet management with
edit/retire/restore, and per-machine CVIP tracking.

**Why this is filed as a decision rather than a defect.** The code states the
rationale — the fleet is reference data every other module joins to, not a
document type (`Dashboard.jsx:2821-2826`) — and that is a defensible product
call; Analytics and SOPs are already always-on the same way. But Compliance is
not reference data, it is a new tracked-record feature with its own table, its
own CRUD and its own expiry model, and nothing in this repo records a decision
to give it away. The doc-key invariant test (`tests/unit/doc-key-module-invariant.test.js`)
cannot catch this, because a feature with no doc key at all is invisible to it.

*Re-check:* `grep -n "BUILTIN_DOC_KEYS = " api/customforms.js` and
`grep -n "docKeys:" server-lib/pricing.js` — run 2026-09-17, 12 keys on both
sides, still in exact agreement. Nothing is mis-sold; two features are simply
outside the system. Re-run 2026-09-18 against `2560819`: **13 keys on both
sides**, still in exact agreement, and Compliance is no longer outside the
system. Fleet Overview still is, deliberately.

### #20 — A company created outside checkout now gets no document types at all

**Severity: high for a new company, zero for an existing one. Status: fix built
on `claude/equipment-tab-fleet-mgmt-9g0xra`. CLOSED — PR #124 merged as `57efbeb` (verified 2026-09-23: `main` carries it).** *(Was "NOT closed — it closes when #124 merges".)* Found 2026-09-18 by this map's pass
against `2560819`, approved by Dillon, built 2026-09-22 in `c30d995`.

**The decision, Dillon's:** a company that did not come through a checkout gets
**everything on, explicitly**. Not everything off. The reasoning, recorded
because the opposite was the obvious-looking choice: everything-on preserves
exactly the pre-`edd7a41` outcome for these companies, while recording that
state as real rows instead of inferring it from an empty table — which is the
whole reason deny-by-default is worth having.

**What was built** (built in `c30d995`; every line below **re-read and
re-verified 2026-09-22 against `965d812`**, the branch head, so these numbers
are current rather than the ones that were current when it landed):

| Half | Where |
|---|---|
| Hand-created company | `api/admin.js:405-409` — the insert now captures the new id (`.select('id').single()`); `:422-424` upserts `allDocumentSettingsOn(created.id)` on `company_id,document_key` |
| Approval with no module list | `server-lib/onboardingApproval.js:239-241` — the old `if (Array.isArray(request.modules) && request.modules.length > 0)` gate is gone; the condition is hoisted to `const bought` (`:214`) and the write is a ternary, `documentSettingsFor` when modules were bought, `allDocumentSettingsOn` when the list is NULL or empty. Both branches reach the same upsert at `:242-244` |
| One definition | `server-lib/pricing.js:255-257` — `allDocumentSettingsOn(companyId)` is `documentSettingsFor(companyId, MODULE_KEYS)`, so it is derived from the module table rather than a second copy of the key list. Ran it: 13 rows, all `is_active: true` |
| Tests | `tests/unit/doc-setting-defaults.test.js:92,101,118,127` — four new cases. `:101` reads `BUILTIN_DOC_KEYS` **out of `api/customforms.js`'s source** and asserts the on-by-default set is exactly those 13 keys, so this cannot drift the way a copied list would; `:127` asserts a purchased request still gets only what it bought, which is the guard against this fix quietly becoming "everyone gets everything". `npm run test:unit` → **333 pass, 0 fail** |

**Deliberate, and worth not undoing:** a failed settings upsert does not roll
back the company. `admin.js:425-434` keeps the company row and returns
`{ ok: true, warning: … }`; the comment's reasoning is that deleting a created
company is a destructive fix for a recoverable problem. Correct as far as the
handler goes, and for one commit nothing displayed the warning — that was break
#22, built in `965d812`, one commit after the warning was written.

`onboardingApproval.js:245-255` keeps its own non-fatal handling for the same
reason, and now carries a note that the failure costs more than it used to: a
failed upsert once left the company with everything on, and now leaves them
with nothing on, on the day they paid.

**The comment that hid this is gone twice over.** The version that asserted the
old everything-on default was rewritten by `551fbfd` (to say plainly that the
`if` was a gap, not a decision) and rewritten again by `c30d995` (to describe
the two-branch write that replaced it). Any quote of the old text is stale —
`onboardingApproval.js:199-213` is the current wording and it matches the code.

**One follow-on sits between the fix and these line numbers.** `6719415` adds
an observational `console.warn` (`onboardingApproval.js:232-237`) for the one
case `tenant-scope-reviewer` flagged: a request carrying `stripe_customer_id`
but **no** module list — a Stripe session made outside `api/checkout.js`, since
`resolveModules` rejects an empty selection — which the all-on fallback would
hand every module free. Logged, not blocked, on the stated grounds that
refusing to provision a company that has already paid is worse than
over-granting it. No behaviour change, but it moved everything below `:214`
down the file, so the numbers in this entry were re-read against the current
file rather than offset from the old ones.

*Re-check:* `grep -rn "company_document_settings" api/ server-lib/ src/` → run
2026-09-22 against `965d812`: writers are now `customforms.js:177,351`,
`onboardingApproval.js:243` **and `admin.js:423`**, plus the delete at
`admin.js:585` and the readers in `customforms.js:288,366`,
`equipmentreports.js:165`, `cron-equipment-reports.js:42`. `admin.js` appearing
as a writer is the fix.

Original finding: `edd7a41` flipped a missing `company_document_settings` row
from **active** to **off** for every built-in key (`customforms.js:323,383`),
the right direction for billing — but nothing wrote rows for a company that
does not come through a purchase. A brand-new company the founder created by
hand got an empty worker menu (`get_worker_documents` returning `builtinActive`
all false, `customforms.js:381-386`) and a Dashboard with nothing but Overview
and the Equipment tab's Fleet Overview (`Dashboard.jsx:2826,2864`), with no
error and nothing on screen saying why. Never reached production: `edd7a41` is
not an ancestor of `main`.

### #21 — Module gating is UI-only; no handler consults the doc key

**Severity: low, pre-existing, cross-cutting. Status: fix built on
`claude/equipment-tab-fleet-mgmt-9g0xra` (head `48d5889`). CLOSED — PR #124 merged as `57efbeb` (verified 2026-09-23: `main` carries it).** Recorded 2026-09-18
because `2560819` made it a paid boundary for the first time on this branch;
approved explicitly by Dillon ("Build #21") and built 2026-09-22 in `48d5889`.

**What was built, in the order it had to be built.** Every line below was read
in the code on 2026-09-22 against `48d5889`, not taken from the commit message.

*Step 1 — the offline queue got a drop path, first, because the gating needed
it.* `drainQueue` caught every failure the same way (`markAttempt`, then
`break`) with no drop path, so one permanently-rejected item wedged that
worker's whole queue **for that form type, forever**. That was survivable only
while nothing on the server rejected a well-formed submit permanently — and a
403 from a module gate is exactly that, stably, for as long as the company
doesn't own the module.

| Piece | Where |
|---|---|
| The rule | `src/offlineQueue.js:194-200` — `isPermanentRejection`: a 4xx is permanent, **except** 401 (stale token on a queue draining days later), 408, 425 and 429 (the server asking to be asked again). No status at all → transient, because a resubmit does several round trips and an inner throw carries no status |
| The drop | `src/offlineQueue.js:252-263` — `removeQueued`, push onto `results.dropped` with `status` and `reason`, then **`continue`** instead of `break`, so everything queued behind it finally sends |
| Still transient | `:265-267` — network failure, 5xx, no status: `markAttempt` and stop, preserving order |
| Reported, not lost | `results.dropped` (`:243`) follows the `pdfUnlinked` precedent — lost work comes back to the caller rather than vanishing |
| The ten producers | `err.status = res.status` in `src/App.jsx:73`, `CustomForm.jsx:47`, `DailyReport.jsx:63`, `FieldService.jsx:55`, `FuelLog.jsx:46`, `Incident.jsx:147`, `Inspection.jsx:97`, `MonthlyInspection.jsx:48`, `NearMiss.jsx:76`, `ToolboxTalk.jsx:58` — §4b's mirror image avoided on purpose: a reader is useless if one producer doesn't write the field |
| Surfaced to the worker | `src/WorkerMenu.jsx:386-407` — a red panel naming each dropped form, its timestamp and the server's own reason, ending "Tell your supervisor" |
| Tests | `tests/unit/offline-queue-drain.test.js` — 10 cases including the wedge itself (`:51`), that the drop is reported (`:71`), that a 401 and a 429 are **not** permanent (`:115,138`), and that a 503 from the gate keeps the submission queued (`:126`) |

**No attempt cap was added, and that is deliberate** (`src/offlineQueue.js:215-218`):
a cap counts attempts, and a worker offline for a week racks up attempts on
submissions that are perfectly good. Only the server saying "never" drops
anything. The map's three previous statements that `drainQueue` "has no attempt
cap **and no drop path**" were correct when written and are half stale now —
corrected in §2, §5 and the changelog rather than deleted, because the
no-attempt-cap half is still true.

*Step 2 — one shared gate, and the duplicate removed rather than tripled.*
`server-lib/docKeyGate.js` is new; **both** previous copies of `isDocKeyActive`
are deleted and migrated onto it (`api/equipmentreports.js:17`,
`api/cron-equipment-reports.js:20`). That matters beyond tidiness: this entry's
own "a fix would touch" note warned that two copies of a gate is break #1's
shape, and the fix resolved it instead of adding a third. `403` for a hard no,
**`503` for a failed lookup** (`docKeyGate.js:126-133` today; `:117-120` as
`48d5889` shipped it, renumbered by `89ca755`), because to a queued
submit a 403 now means "drop this" and a database blip must not delete a
worker's shift. Admin exempt at `:113`. Full table in §2's `document_key`
section.

*Step 3 — 41 guards across eight handler files*, listed with their actions in
§2. `grep -rn "await requireDocKey(" api/ | wc -l` → **41**, run 2026-09-22.
Two more files (`equipmentreports.js`, `cron-equipment-reports.js`) were
already gated and now share the one helper — ten handlers touched in total.
**"Already gated" was true of the report body and not of the four actions a
supervisor can call in `api/equipmentreports.js`** — that gap is break #26,
found by `tenant-scope-reviewer` on this same diff and fixed hours later in
`89ca755`.

*Verification:* `npm run test:unit` → **364 pass, 0 fail**, re-run by this pass
on 2026-09-22 against `48d5889`. `tests/unit/module-gate.test.js` (12 gate
cases + 7 end-to-end handler cases at `:209-261` + 2 offline-queue integration
cases at `:299,313`) exercises the real handlers, including that a denied
worker submit **writes nothing** (`:228`) and that an admin session is not
gated (`:256`).

**The precondition that makes deny-by-default safe here** is live data, not
code: all three companies carry an explicit row for every one of the 13
built-in keys. Verified by Dillon against the FORA Supabase project on
2026-09-22 before this was pushed — see §2. A company with a gap would now be
refused by the API rather than shown fewer tabs, which is a materially worse
failure than the one #20 fixed.

**What did not change:** the browser still fails open (`Dashboard.jsx:2778`).
That is now presentation only and was left alone on purpose — a settings fetch
that fails should still render the app, and the handler behind each tab now
refuses on its own.

---

*Original finding, 2026-09-18, left as written:*

`2560819` gates Equipment Compliance in three places, all of them presentation:
the sub-tab (`Dashboard.jsx:2869`), the banner (`:4917`) and the weekly PDF's
section (`equipmentreports.js:618`). The four handlers that actually hold the
data — `list_equipment_compliance` (`companydata.js:1025`), `compliance_summary`
(`:1071`), `upsert_equipment_compliance` (`:1138`), `delete_equipment_compliance`
(`:1184`) — never read `company_document_settings`. Neither does
`api/certifications.js`, `api/maintenance.js`, `api/fuellogs.js`, `api/logs.js`,
`api/flhas.js`, `api/reports.js`, `api/monthly.js` or `api/timeclockreports.js`.

*Re-check:* `grep -rn "company_document_settings" api/` → 5 files
(`customforms.js`, `equipmentreports.js`, `cron-equipment-reports.js`,
`admin.js`, `login.js` in a comment only). Run 2026-09-18 against `2560819`,
re-run 2026-09-22 against `c30d995`: **still open, unapproved and untouched.**
The only change is that `admin.js` now writes settings rows as well as deleting
them (`:423`, break #20's fix) — it still never *reads* one to decide whether an
action is allowed, which is what this break is about.

So the only server-side enforcement points in the product are
`api/equipmentreports.js:163` and `api/cron-equipment-reports.js:40`. Everywhere
else the gate is the browser's, and the browser fails **open** when the settings
load fails (`Dashboard.jsx:2778`).

**Not a tenancy hole** — every one of those handlers still scopes by
`company_id`, so this is a company's own supervisor reaching their own data.
That is why it is low, and why it is a decision rather than a bug: it is the
same posture all nine modules have always had, and changing it is a choice about
every module at once, not something to tack onto whichever one shipped last.

**A fix would touch:** a shared `isDocKeyActive` in `server-lib/` (there are
already two copies, `equipmentreports.js:163` and `cron-equipment-reports.js:40`,
which is the shape break #1 exists to warn about) and one guard per gated
action. Decide the policy first: 403, or empty payload? A 403 reaching an
offline-queued submit is break #2's follow-up all over again.

*(That last paragraph predicted the fix exactly, including the trap. `48d5889`
did all three: one helper, both copies removed, and the offline queue taught to
drop a 403 before any guard could produce one. The policy chosen was 403 — with
503 carved out for a failed lookup, which the paragraph did not anticipate and
which is the part that keeps a database blip from deleting queued work.)*

### #22 — The one warning the Admin Panel can raise is never shown

**Severity: low, but it was the safety net under #20. Status: fix built on
`claude/equipment-tab-fleet-mgmt-9g0xra`. CLOSED — PR #124 merged as `57efbeb` (verified 2026-09-23: `main` carries it; `src/AdminPanel.jsx:634`).** Found 2026-09-22 by this map's pass against `c30d995`, built the same
day in `965d812`, one commit after the warning it reads was written.

`create_company` deliberately does not roll back when the document-settings
upsert fails — the company row is already in, and deleting it would be a
destructive fix for a recoverable problem. Instead it returns a warning, and
its own comment says why: *"somebody has to be told they are currently all
off"* (`api/admin.js:425-434`). For one commit, nobody was.

| Side | Where |
|---|---|
| Producer | `api/admin.js:433` — `return res.status(200).json({ ok: true, warning: 'Company created, but its document types could not be switched on…' })` |
| Consumer, before | `src/AdminPanel.jsx:624-626` at `c30d995` — `data.error` read only, and only on `!res.ok`. The warning rides a **200**, so the founder got the ordinary success path |
| Consumer, now | `src/AdminPanel.jsx:634` — `if (data.warning) setMsg(data.warning);`, set **after** `await loadAll()` (`:626`) and before `setView("home")` (`:635`), so it is the last word rather than being overwritten by the reload |

**What makes it actually reach the founder, and why it is worth recording.**
The banner's colouring is not a status flag, it is a **regex on the message
text**: `msgIsError = /(could not|couldn't|failed|error|enter)/.test(msg.toLowerCase())`
(`src/AdminPanel.jsx:1215`), consumed at `:1280` to pick
`C.status.danger` over `C.status.success`. The warning string contains *"could
not"*, so it renders in the danger colours rather than as a green success
toast. Verified by running that exact regex against that exact string → `true`.

That coupling is a thin thread — a future reword of the warning to, say, "The
document types were left switched off" would silently turn a red alert green,
with nothing failing. Recorded, not filed as a break: it is one string and one
regex, both in view of each other, and the string is the one the founder needs
to read anyway.

**What the customer got, before.** In the one case this exists for, the founder
created the company, the screen said it worked, and they handed over an account
whose every document type is off — the exact outcome #20 was fixed to prevent,
with the one signal that would have caught it thrown away at the boundary.

*Re-check:* `grep -rn "warning:" api/ server-lib/` → a single hit,
`admin.js:433`. `grep -rn "data.warning" src/` → **`AdminPanel.jsx:634`**,
where before it returned nothing. Run 2026-09-22 against `965d812`.

**This is §4b's shape, one level up from a column** — a field a producer writes
that no consumer reads, so nothing errors. The difference from every other §4b
instance is the clock: this one was **written and read in consecutive commits**,
caught before merge, rather than sitting in the product for months.

**Still open, deliberately, and not filed:** `onboardingApproval.js:245-255`
handles the same failure on the paid path with `console.error` and carries on.
That reaches a server log and no human. Not the same break — there is no
response field being dropped there, the approval genuinely has nowhere to
render to — but it is the same customer outcome on the path where a company
has already paid, and it is the obvious next thing if this class of failure
ever actually happens.

### #23 — Time Clock and the PM interval were gated only in the browser

**Severity: low, same class as #21 was. Status: fix BUILT on
`claude/modular-pricing-enforcement-rzdib2` (`ac80f96`). CLOSED — PR #127
merged as `d4b8aa3` (verified 2026-09-23).** Approved by Dillon 2026-09-22, with two
product decisions that shaped it (below). Opened 2026-09-22 by this map's pass
against `48d5889`. **SPLIT the same day:** this entry originally also covered
`api/equipmentreports.js`'s four supervisor-callable actions, which were fixed
in `89ca755` hours later — that half is **#26**, built and closing with PR #124.

**What was built** (`ac80f96`, every line re-read 2026-09-22 against the
branch head — the action line numbers all moved from the table below, which is
kept as the as-found record at `48d5889`):

| Action | Guard | Doc key |
|---|---|---|
| `set_equipment_pm_interval` (`api/companydata.js:1214`) | `:1216` — after the role check, before the equipment lookup | `maintenance` |
| `clock_in` (`:1436`) | `:1438` — after the `userId` check | `timeclock` |
| `edit_time_entry` (`:1528`) | `:1530` | `timeclock` |
| `add_time_entry` (`:1560`) | `:1562` | `timeclock` |
| `delete_time_entry` (`:1588`) | `:1590` | `timeclock` |
| `generate_time_report_now` (`:1637`) | `:1639` — the one that disagreed with the Sunday cron (`cron-equipment-reports.js:93`) | `timeclock` |

**Deliberately left open, by Dillon's decision — recorded in §2's exemption
table and §5 so they are not re-filed:** `clock_out` (`:1455`) and
`my_time_status` (`:1476`), so a shift open when the module is dropped can
always be closed; `list_time_entries` (`:1495`), `list_time_reports` (`:1603`)
and `get_time_report` (`:1617`), so recorded hours stay readable after
cancelling. The reasoning is in the code at `:1425-1435`.

*Re-check:* `grep -n "requireDocKey" api/companydata.js` → 11 hits: the import
(`:16`), four `equipment_compliance` guards (`:1028,1077,1146,1194`), one
`maintenance` (`:1216`) and five `timeclock` (`:1438,1530,1562,1590,1639`).
Nothing between `:1455` and `:1528` and nothing between `:1603` and `:1637`.
Across `api/`: `grep -rn "await requireDocKey(" api/ | wc -l` → **51** (was 45
at `57efbeb`). Run 2026-09-22. *Re-anchor, uncommitted tree on `f561f42`:*
#27's `latestEntryAt` lookup adds 11 lines inside `list_time_reports`
(`:1614-1625`), so `get_time_report` is now `:1628` and
`generate_time_report_now` `:1648` with its guard at `:1650`; the other hits
are unchanged and there is still nothing between `:1603` and `:1648`. (The
grep actually returns **12** lines, at `ac80f96` too — the eleven above plus a
comment at `:1074`. The guard count is unaffected: 51 across `api/`, re-run.)

*Tests:* `tests/unit/timeclock-gate.test.js`, 19 tests, drives the real
handler. `node --test tests/unit/timeclock-gate.test.js` → 19 pass at
`ac80f96`; the same file run against a `57efbeb` worktree → **12 fail, 7
pass** — the 12 are exactly the gating cases (five actions × OFF/no-row, plus
the two PM-interval cases), the 7 that pass are the carve-outs and the
positive cases, which is what they should do on the pre-fix file.
`npm run test:unit` → **387 pass, 0 fail**. Both re-run by this map's pass,
not taken from the build report.

**What the fix does not reach — filed as #27, not folded in here:** the
carve-outs are open on the server, but both screens that call them hid when
the module was off, so "can always be closed" and "stays readable" held at the
API and not in the product. **The UI now reaches them as of `98f9d70` (#27,
built, closes when its PR merges)** — see #27 for the anchors. Its one
residual limit (current week only) is closed by the uncommitted week-paging
change on `f561f42`.

*As found at `48d5889`:*

`48d5889` put a server-side gate on 41 actions. These were **outside the scope
Dillon approved**, so they are filed rather than folded into #21 — #21 is
marked built, and a break marked built must not carry open work inside it.

| Ungated action(s) | Where | Doc key it maps to |
|---|---|---|
| `clock_in`, `clock_out`, `my_time_status`, `list_time_entries`, `edit_time_entry`, `add_time_entry`, `delete_time_entry`, `list_time_reports`, `get_time_report`, `generate_time_report_now` | `api/companydata.js:1423,1440,1461,1480,1513,1543,1569,1582,1596,1616` | `timeclock` — module "Time Clock + GPS" (`pricing.js:80-84`) |
| `set_equipment_pm_interval` | `api/companydata.js:1214` | `maintenance` — module "Preventative Maintenance" (`pricing.js:73-77`) |

*Re-check:* `grep -n "requireDocKey" api/companydata.js` → 5 hits, four guards
plus the import, **all four on `equipment_compliance`** (`:1028,1077,1146,1194`).
Nothing in the time-clock block and nothing at `:1214`. Run 2026-09-22 against
`48d5889`.

**The sharpest evidence is inside the product itself: two entry points to the
same weekly time-clock report, one gated and one not.** Both call
`buildTimeClockReportForCompanyWeek` (`api/timeclockreports.js:23`). The Sunday
cron checks the key first — `readDocKeySetting(supabaseAdmin, c.id, 'timeclock')`,
`api/cron-equipment-reports.js:93-94`, skipping the company with
`reason: 'deactivated'` (or `'settings_unavailable'` since `89ca755`).
`generate_time_report_now`
(`api/companydata.js:1616`) checks role and company and builds the same report
on demand. So a company without the `timeclock` module gets no report on
Sunday and can still pull one on Tuesday. That is precisely "a feature gated
differently from its neighbours".

**`api/timeclockreports.js` itself is not a gap.** Its HTTP handler returns 404
unconditionally (`:77-78`) — it is a builder module imported by
`api/companydata.js:11` and `api/cron-equipment-reports.js:19`, with no actions
to gate. Recorded because it *looks* like an ungated endpoint in a file listing
and is not.

**What the customer gets that they didn't buy.** A company that never bought
Time Clock + GPS, or dropped it, keeps clocking in and out and pulling weekly
hour reports through a saved URL or a stale tab; the Dashboard tab is hidden
and the data is not. Same for the PM interval: `set_equipment_pm_interval` is
the write that starts a machine's maintenance clock, and `api/maintenance.js`'s
four actions — the ones that *read* that clock — are gated as of `48d5889`. So
a company without the maintenance module can set an interval it cannot then see.

**A fix would touch** (as proposed before approval): `api/companydata.js` only
— eleven `requireDocKey` calls, ten on `timeclock` and one on `maintenance`.
**As built it is six, not eleven** — Dillon's decision kept five time-clock
actions open (above). No migration, no new file, no client change, as
predicted.

**Checked before writing that, because it is the trap #21's step 1 exists for:
time-clock punches are NOT offline-queued.** `src/TimeClock.jsx:62-64` posts
`clock_in`/`clock_out` straight to `/api/companydata` with no `enqueueSubmission`
anywhere in the file, and `timeclock` is not one of the ten form types in
`RESUBMIT_HANDLERS` (`src/WorkerMenu.jsx:26-37`). So a 403 here surfaces as an
on-screen error, not a dropped punch — this guard is safe to write in a way the
document-submit guards were not. Re-checked at `ac80f96`: `src/TimeClock.jsx`
still posts the punch directly (`:62-64`) and has no `enqueueSubmission`.

### #27 — The time-clock carve-outs were open on the server and unreachable in the product

**Severity: low. Status: fix BUILT on `claude/modular-pricing-enforcement-rzdib2`
(`98f9d70`, UI only), plus a week-paging follow-up (`b0411b1` — not an object in this clone; it
went into the squash) that closes the residual limit.
CLOSED — PR #128 merged as `363da23` (verified 2026-09-23: `git show 363da23`
carries `latestEntryAt` and the paging UI).**
Approved by Dillon 2026-09-22 with the answer to the open question below:
"readable in the app", so both halves were built, not just the worker's.
Opened 2026-09-22 by this map's pass against `ac80f96` — found while recording
#23's carve-outs, not handed to this pass.

**What was built** (`98f9d70` plus the paging change `b0411b1`, both in
`363da23`; every anchor in this table re-read **2026-09-23 against `42ed3c7`** —
#13/#18's Dashboard and `companydata.js` additions moved them by 19–48 lines;
the tables further down are the as-found record at `ac80f96`, and their line
numbers are left as found):

| Half | Producer (server, unchanged) | Consumer (UI, now reached) |
|---|---|---|
| Worker closes an open shift | `my_time_status` `companydata.js:1525`, `clock_out` `:1504` | `src/WorkerMenu.jsx:137-150` probes `my_time_status` whenever the menu shows and `builtinActive.timeclock === false` (explicit `false` — `customforms.js:384` writes `settingsMap[key] === true`, so a company with no row counts as off too); `:272-273` falls back to the unfiltered `BUILTIN_TYPES` entry when `openShiftWhileOff`, so the card renders (`:476`) with "You're still clocked in. Tap to clock out." (`:494-495`); `:233` passes `clockOutOnly`, and `src/TimeClock.jsx:157` replaces the button with a "can't clock in" note once `clockedIn` is false. The card goes away on the next menu render after clock-out |
| Supervisor reads recorded hours | `list_time_reports` `:1651` (now also returns `latestEntryAt`, the newest `time_clock_entries.clock_in` for the resolved company, `:1662-1673`), `get_time_report` `:1676`, `list_time_entries` `:1543` (honours `weekStart`, `:1548-1549`), `my_time_status` `:1524` | `src/Dashboard.jsx:3299-3324` — when `timeClockEnabled` (`:2791`, `isDocActive("timeclock")`) is false, probes `list_time_reports` and `my_time_status` (the old current-week `list_time_entries` probe is gone) and sets `timeClockHistory` if any report, a non-null `latestEntryAt` (any week), or the viewer's own open shift exists (`:3315`); `TAB_VISIBLE.timeclock: timeClockEnabled \|\| timeClockHistory` (`:2830`). A failed probe reads as `{}` → no tab (fails closed) |
| Supervisor pages past weeks | `list_time_entries` rounds any date to its Monday (`companydata.js:1549-1550`, `mondayOf` `:241`) | `timeClockWeekStart` / `timeClockShownWeek` (`Dashboard.jsx:2026-2027`); the entries fetch sends `weekStart` when set (`:3045`) and re-runs on it (`:3062`); `showTimeClockWeek` / `timeClockAtCurrentWeek` (`:3066-3073`) step by 7 days and snap back to "" (server default = current week) at the present; Previous / This week / Next card at `:6679-6696`, rendered in both modes. Read-only opens on the week of `latestEntryAt` when that is before the current week (`:3317-3320`); the week resets on company or module change (`:3300`) |
| Read-only, no write reachable | every write gated server-side by #23 (`:1486,1578,1610,1638,1698`) | `timeClockReadOnly = !timeClockEnabled` (`:2792`) — banner (`:6669`); My Time's button only while `myTimeStatus?.open` (`:6720`), so Clock Out and never Clock In; "+ Add Entry" and its form gone (`:6788,6796`); Edit/Delete gone (`:6843,6883`); Manual Pull and "Generate This Week" gone (`:6908`, the button itself at `:6914`) and the manual-pull panel suppressed (`:6927`). Report rows still open and download via `get_time_report` (`:3407`). Paging adds no write path — it only changes the `weekStart` of a read |

*Re-check:* `grep -n "openShiftWhileOff\|clockOutOnly" src/WorkerMenu.jsx src/TimeClock.jsx`
and `grep -n "timeClockHistory\|timeClockReadOnly\|timeClockEnabled\|timeClockWeekStart\|showTimeClockWeek\|latestEntryAt" src/Dashboard.jsx`
plus `grep -n "latestEntryAt" api/companydata.js` → the anchors above.
`git diff d4b8aa3 98f9d70 --stat` → five files, all under `src/` and `tests/`;
no `api/`, no migration. The paging follow-up **does** touch `api/` — one
read added to `list_time_reports`, company-scoped via `resolveCompanyId`
(`:1653` at `42ed3c7`) and `.eq('company_id', companyId)` (`:1670`); still no migration
(`git diff --stat` on `f561f42`: `api/companydata.js`, `src/Dashboard.jsx`,
three test files). Run 2026-09-22.

*Tests:* `tests/time-clock-module-off.spec.js`, 7 Playwright tests (helpers in
`tests/helpers.js`). `npx playwright test tests/time-clock-module-off.spec.js`
→ **7 pass** at `98f9d70` (now 8 — see the paging tests below); the same spec and helpers copied into a `d4b8aa3`
worktree → **4 fail, 3 pass** — the 4 are the behaviour tests (worker clocked
in gets a clock-out, card goes away after, supervisor reads hours with no
write controls, supervisor clocks out and not back in); the 3 that pass are
the negatives (no open shift → no card, never-used company → no tab, module on
→ every control), which is what they should do on the pre-fix code.
`npm run test:unit` → **387 pass, 0 fail**. All re-run by this map's pass, not
taken from the build report. (The full 44/44 e2e run is the builder's figure;
this pass ran only the new spec.)

*Paging tests (`b0411b1`):* `tests/unit/timeclock-gate.test.js:206`
asserts `latestEntryAt` comes back and that the `time_clock_entries` query is
filtered to the **caller's** company even when a supervisor sends another
`companyId`; `tests/time-clock-module-off.spec.js:114` pages a module-off
company from the week of its last entry (two weeks back, never a report) to
the week before, forward again, and to This week with Next disabled; the
spec's mock (`tests/helpers.js:319-331`) does the same Monday rounding as the
handler. Re-run by this pass: `npm run test:unit` → **388 pass, 0 fail**;
`npx playwright test tests/time-clock-module-off.spec.js` → **8 pass**. The
new files copied into a clean `f561f42` worktree → unit **1 fail / 19 pass**
(the fail is `:206`) and spec **1 fail / 7 pass** (the fail is `:114`) — both
new tests fail before and pass after. (45/45 across all specs is the builder's
figure; this pass ran only this spec.)

**Former residual limit — CLOSED by the paging change (`b0411b1`, in
`363da23`)** (Dillon: "let the supervisor page back through past weeks of
entries in the read-only tab"). Both halves are gone: any week's entries are
reachable via Previous / Next (`Dashboard.jsx:6679-6696`, `weekStart` at
`:3045`), and the tab's visibility no longer depends on the current week
(`latestEntryAt`, `companydata.js:1663-1674` → `Dashboard.jsx:3315`), so the
sub-week company keeps its tab after the week rolls over. The cron and
`generate_time_report_now` are still gated, so the final partial week still
never becomes a *report* — its hours are read as entries, which was the ask.
One assumption to keep in view: the browser steps weeks in UTC
(`Dashboard.jsx:3064-3067`) while `mondayOf` (`companydata.js:241-248`) uses
the server's local time; they agree because Vercel functions run in UTC. The
original text, as recorded at `98f9d70`:

> The read-only tab
shows past reports plus the **current week's** entries only: the Dashboard's
entries fetch sends no `weekStart` (`Dashboard.jsx:3020`), although the handler
would honour one (`companydata.js:1500`). Once the module is off the Sunday
cron skips the company (`cron-equipment-reports.js:93-94`, `reason:
'deactivated'`) and `generate_time_report_now` is gated (`companydata.js:1639`),
so the final partial week never becomes a report: its hours are readable in the
app until that week ends, then only from `time_clock_entries`. The data is
retained. The same boundary means a company that used Time Clock for less than
a week, dropped it, and has no report is shown no tab after that week rolls
over (the probe at `Dashboard.jsx:3271-3273` sees no report and no current-week
entry). Not filed because Dillon's decision was about hours already recorded
staying readable, and whether "recorded" includes a week no report was ever
built for is a product call, not a verified gap against it. If it is ever
wanted, the likely shapes are a final report at switch-off or a week picker on
the read-only tab — neither is scoped.

*As found at `ac80f96`:*

Dillon's decisions on #23 were that a shift open when Time Clock + GPS is
dropped can **always** be closed, and that time reports stay **readable** after
cancelling. `ac80f96` honours both at the API. Neither is reachable from a
screen, because both screens hide when the module is off:

| Decision | Server (open) | The only UI that calls it | Hidden by |
|---|---|---|---|
| Close an open shift | `clock_out` `companydata.js:1455`, `my_time_status` `:1476` | `src/TimeClock.jsx:36,64` | `src/WorkerMenu.jsx:247,250` — `visibleBuiltins` drops any built-in whose setting is `false`, and `timeclockItem` is found in that filtered list, so the Time Clock card (`:453`) does not render |
| Read recorded hours / reports | `list_time_entries` `:1495`, `list_time_reports` `:1603`, `get_time_report` `:1617` | `src/Dashboard.jsx:3008,3242,3331` | `TAB_VISIBLE.timeclock: isDocActive("timeclock")` (`Dashboard.jsx:2793`); the entries, the report list (`:6813-6825`) and "Generate This Week" (`:6778`) all render inside `activeTab === "timeclock" && TAB_VISIBLE.timeclock` (`:6567`, block closes at `:6841`) |

*Re-check:* `grep -rn "list_time_reports\|get_time_report\|list_time_entries" src/`
→ only `Dashboard.jsx:3008,3242,3331`; `grep -n "clock_out\|my_time_status" src/TimeClock.jsx`
→ `:36,64`; and the gates at `WorkerMenu.jsx:247` and `Dashboard.jsx:2793`.
Run 2026-09-22.

**What the customer gets.** A worker clocked in when their company drops the
module opens the app and the Time Clock card is gone — the open shift stays
open, and the supervisor cannot fix it either, because `edit_time_entry` is
gated (`:1530`, correctly) and the tab it lives on is hidden. A company that
cancels and wants last month's hours for payroll finds no Time Clock tab. The
data is kept and the API would hand it over; the product offers no way to ask.
Only a screen already open when the module was switched off still works — the
"stale tab" path the rest of #21/#23 exists to close.

**Not filed as a defect in `ac80f96`.** It built exactly the approved server
scope; the UI was never in it. This is the gap between the decision's intent
and its reach, which is a product call rather than a mechanical patch.

**A fix would touch** (as proposed before approval — built as predicted in
`98f9d70`, plus a `clockOutOnly` prop on `src/TimeClock.jsx`): `src/WorkerMenu.jsx` (show the Time Clock card, clock-out
only, when the module is off *and* `my_time_status` reports an open shift) and
`src/Dashboard.jsx` (a read-only Time Clock tab, or its report list, when the
module is off). No server change, no migration. Worth deciding whether
"readable after cancelling" means in the app or on request — if the latter,
this narrows to the worker half.

### #24 — The wallet invite still offers a ticket upload a gated company can't use

**Severity: low, cosmetic-but-confusing. Status: BUILT, NOT CLOSED —
`940efa9` on `claude/modular-pricing-enforcement-rzdib2`; closes when that
branch's PR merges.** Opened 2026-09-22 by this map's pass against `48d5889`.
Dillon took **the honest version** below: the invite payload carries the flag.

**What was built** (re-read 2026-09-23 against `42ed3c7`):

| Piece | Where |
|---|---|
| The flag | **Re-anchored 2026-09-30 against `624ef31`: `redeem_wallet_invite` no longer exists; `pin_link_set_pin` replaced it.** `api/login.js:883-884`, the `pin_link_set_pin` `stage: 'session'` response returns `certificationsEnabled`, read through the shared `readDocKeySetting` (`server-lib/docKeyGate.js:66`, called `login.js:883`): `true` / `false`, or **`null`** when the settings lookup fails. Deny-by-default like every built-in key, so a company with **no** row gets `false` |
| The screen | `src/WalletInvite.jsx:81` (state), `:124-125` (stored; `loadCerts` skipped only on an explicit `false`), `:304` (ticket card) and `:368` (the "No tickets yet?" hint) render unless the flag is exactly `false`. The flag only arrives on the session stage, so a person sent on to authenticator setup or sign-in never sees the card at all (see #43 and the §5 entry) |
| Still gated server-side | unchanged — `api/certifications.js:143,160` `requireDocKey(..., 'certifications')`; a `null` keeps the card and the server still refuses an upload the company has not bought |
| Tests | `tests/unit/wallet-invite-modules.test.js` (4, `redeem()` now drives `pin_link_set_pin`, header `:10`); `tests/wallet-invite.spec.js` (3, Playwright; not re-run by this pass against `624ef31`) |

*Evidence, re-run by this pass:* unit **4/4** at `42ed3c7`, **4/4 fail** in a
`363da23` worktree (the field did not exist); spec **3/3** at `42ed3c7`, and in
the `363da23` worktree **1 fail / 2 pass** — the fail is "a company WITHOUT
Certification Tracking: no ticket card", the two passes are the with-module and
lookup-failed cases, where the card *should* still show. `npm run test:unit` →
415 pass.

*As found, 2026-09-22 (numbers as of `48d5889`):*

*(Historical text below describes the pre-`624ef31` invite link, a wallet token redeemed by `redeem_wallet_invite`. The link is now the emailed set-your-own-PIN link, see §2 "The set-your-own-PIN link". Line numbers below are the old ones.)*

`src/WalletInvite.jsx` is the one-time screen a new hire opens from an invite
link. It renders an **"Add a ticket"** card unconditionally
(`src/WalletInvite.jsx:262-300`) — type, name, issue date, expiry date, file
picker and an "Add ticket" button — with no module check anywhere in the file
and no settings fetch to check against.

As of `48d5889` the server behind that card is gated:
`create_certification_upload_url` (`api/certifications.js:143`) and
`add_certification` (`:160`) both call `requireDocKey(..., 'certifications')`.

**It fails soft in both directions, which is why this is low and not a defect.**
`loadCerts` ignores a non-OK response and leaves the list empty
(`src/WalletInvite.jsx:95-103`), and `addCertification` catches the throw and
shows the server's own message (the upload throw is caught at `:130-132`; a 403
from `add_certification` itself lands at `:126`), so the invite still completes
and the new hire still gets a login. `api/certifications.js:387-389` records
that this was the expected behaviour when the guards were written — "the invite
still completes with the tickets section simply empty", which is true of the
list and not of the *offer*.

**What the customer sees.** A new hire at a company without Certification
Tracking fills in a ticket type, a name, two dates and picks a photo of their
card, taps "Add ticket", and is told their company's plan doesn't include
Certification Tracking — *after* doing the work. Nothing is lost and nothing is
wrong in the data; it is an offer the product cannot honour.

**A fix would touch:** `src/WalletInvite.jsx` only — the invite screen would
need to know whether the module is on, which it currently has no way to ask
(it holds an invite token, not a full session, and never calls
`get_document_settings`). So the cheap version is hiding the card on the first
403 from `loadCerts`; the honest version is the invite payload carrying the
flag. Worth a decision on which, not a mechanical patch. No migration.

### #25 — A custom document's own on/off setting is not enforced server-side

**Severity: low, narrow. Status: BUILT, NOT CLOSED — `f955ad9` on
`claude/modular-pricing-enforcement-rzdib2`; closes when that branch's PR
merges.** Opened 2026-09-22 by this map's pass against `48d5889` — found while
checking whether #21's guards covered every gated surface.

**Dillon's decisions, recorded in `f955ad9`'s message:** allow-by-default (a
custom form with no row stays on, matching `get_worker_documents`), and a
switched-off form **drops** a queued offline entry on purpose — "refuse and
tell them" — rather than holding it.

**What was built** (re-read 2026-09-23 against `42ed3c7`):

| Piece | Where |
|---|---|
| The guard | `requireCustomDocKey`, `server-lib/docKeyGate.js:152-167` — reads `company_document_settings` for `custom_<formId>`; only `is_active === false` refuses (**403**); no row → allowed; lookup error → **503**; admin exempt; no session → 401. Cannot be `requireDocKey`, which is deny-by-default and would switch off every custom form with no row |
| `get_active_form` | `api/customforms.js:483-484`, after the existing `custom_forms.is_active` / company check (`:478-480`) |
| `submit_custom` | `api/customforms.js:522-524` — now also checks `custom_forms.is_active` (it selected only `id, company_id` before, so the supervisor's own `toggle_form` leaked the same way); then `:525-526` the settings guard |
| Offline behaviour | custom documents are queued (`src/CustomForm.jsx:269,287`, `resubmitCustomForm` in `WorkerMenu.jsx:34`). 403 → `drainQueue` drops the entry and reports it to the worker (`src/offlineQueue.js:252-263`, `isPermanentRejection` `:194`); 503 → kept and retried. That drop is the decision above, not a side effect |
| Tests | `tests/unit/custom-form-gate.test.js` — 6 cases against the real handler |

*Evidence, re-run by this pass:* **6/6** at `42ed3c7`; the same file in a
`363da23` worktree → **4 fail / 2 pass** (the two passes are the allow-by-default
cases — a form with no settings row still opens and still accepts a submission —
which should behave the same before and after). `npm run test:unit` → 415 pass.

**Worth knowing, not a break:** the `custom_forms.is_active` half of the fix
reaches further than the Admin Panel case this entry was about. A supervisor
switching a form off with `toggle_form` now also drops any queued offline
submission of it — before `f955ad9` that submission would have been accepted.
Same decision, wider reach; recorded so it is not rediscovered as a surprise.

*As found, 2026-09-22 (numbers as of `48d5889`):*

`48d5889`'s gate is built on `MODULE_BY_DOC_KEY` (`docKeyGate.js:33-35`), which
is derived from `pricing.js` and therefore covers **only the 13 built-in keys**.
A custom form's `custom_<id>` key belongs to no module, so `requireDocKey` was
not applied to `api/customforms.js` at all.

| Side | Where |
|---|---|
| The setting is written | `customforms.js:177-180` on creation (`is_active: true`), `:351-353` by `set_document_setting` |
| The worker's menu honours it | `customforms.js:386` — `settingsMap['custom_<id>'] !== false` filters the card out |
| The supervisor's settings screen honours it | `customforms.js:341` |
| `get_active_form` does **not** | `customforms.js:465-489` — checks `custom_forms.is_active` (`:477`) and the site's company, never `company_document_settings` |
| `submit_custom` does **not** | `customforms.js:491` — same |

*Re-check:* `grep -n "settingsMap" api/customforms.js` → `:292,323,341,369,383,386`,
all inside `get_document_settings` and `get_worker_documents`. Neither
`get_active_form` nor `submit_custom` appears. Run 2026-09-22 against `48d5889`.

**Two things hold the blast radius down, and both are worth stating so this
isn't over-read.** First, custom keys are **allow**-by-default on purpose
(`:341,386`, §5) — the divergence only appears when a row explicitly says
`false`. Second, `set_document_setting` is **admin-only** (`:348`), so a
customer's own supervisor cannot produce that row at all; they use
`toggle_form` (`:199`), which writes `custom_forms.is_active`, which *is*
checked. So the only way to reach the gap today is the founder switching a
company's custom document off in the Admin Panel — after which the card
disappears from the worker menu and the form still opens and still accepts
submissions from a saved URL.

**A fix would touch:** `api/customforms.js:465,491` — a settings lookup for
`custom_${formId}` with **allow**-by-default semantics. It cannot reuse
`requireDocKey` as written: that helper is deny-by-default and would switch off
every custom form that has no row, which is the exact inversion
`tests/unit/doc-setting-defaults.test.js` exists to prevent. No migration.

### #26 — The weekly report's own four actions answered anyone

**Severity: low. Status: fix built on
`claude/equipment-tab-fleet-mgmt-9g0xra` (head `89ca755`). CLOSED — PR #124 merged as `57efbeb` (verified 2026-09-23: `main` carries it).** Split out of **#23** on 2026-09-22, the
day both were opened: found independently by `tenant-scope-reviewer` while
reviewing `48d5889`, fixed hours later in `89ca755`, which is why it is a
built entry and the rest of #23 is still open.

**What it was.** `48d5889` gated ten handlers and skipped
`api/equipmentreports.js` on the reasoning that the file was *already an
enforcement point*. That was true of the compliance **section inside the report
body** (`isDocKeyActive` at `:600`, break #19's gate) and false of the file's
own four actions, which answered anyone with a supervisor session:
`list_reports`, `get_report`, `generate_now`, `list_weekly_hours` — at
`48d5889` they sat at `:657,672,701,745` with no doc-key check
(`git show 48d5889:api/equipmentreports.js | grep -n "requireDocKey"` → nothing).

**The customer-visible shape is this map's own #1, reproduced inside the change
meant to stop it.** `api/cron-equipment-reports.js` refused to build a weekly
report on Sunday for a company without Equipment Inspections
(`:66-67`), and on Monday that company's supervisor could call `generate_now`
and get the same document back, PDF and signed URL included. Two entry points
to one artifact, disagreeing.

**What was built** (`89ca755`, every line re-read 2026-09-22):

| Piece | Where |
|---|---|
| Three report actions | `api/equipmentreports.js:666,683,714` — `requireDocKey(..., 'equipment_reports')` on `list_reports`, `get_report`, `generate_now` |
| Weekly Hours | `api/equipmentreports.js:763` — **`inspection`**, not `equipment_reports` |
| Cron can tell "no" from "don't know" | `api/cron-equipment-reports.js:20,66-67,93-94` — moved onto the exported `readDocKeySetting` and reports `settings_unavailable` separately from `deactivated` |
| Auth failure ≠ billing failure | `server-lib/docKeyGate.js:112,123` — a non-admin session with no `companyId` gets **401** without a query, where it used to get 403 |
| Tests | `tests/unit/module-gate.test.js` — two source-level cases confirmed red against the pre-fix file. `npm run test:unit` → 368 pass |

**The key choice is the part worth keeping.** Weekly Hours gates on
`inspection` because it is folded from inspection readings (`foldWeeklyUsage`,
`equipmentreports.js:300`) and its Dashboard sub-tab gates on
`inspectionsEnabled` (`src/Dashboard.jsx:2868`). Gating the server on
`equipment_reports` — the obvious key, given the file it lives in — would have
locked out a company that bought Equipment Inspections and not the weekly
report. **The file a handler lives in is not the module it belongs to.**

**Two smaller decisions in the same commit, both recorded because their reason
is the offline queue, not the gate:**
- The cron's `reason: 'deactivated'` used to cover a *failed* settings read as
  well as a real "not bought". A transient outage at 11:59pm on a Sunday would
  cost every company that week's report and leave the only trace blaming the
  customer.
- `requireDocKey`'s 401 for a session with no `companyId` is a guard against a
  shape, not a live path (every worker and supervisor token carries one). It
  matters because 403 now means DROP to a queued submit
  (`src/offlineQueue.js:194`), so answering a broken session with "your plan
  doesn't include this" would destroy a worker's queued shift instead of
  sending them to log in again.

**Third instance on this branch of one reasoning error: "this is already
handled" applied at the wrong granularity.** #12 — the generator read
`linkedPretrip.results_json` and the *caller* passed three scalars. #16 — the
form wrote `unit: 'attachment'` and one of two consumers still tested
`'trailer'`. #26 — a file was an enforcement point for one thing inside it and
not for its own endpoints. Each time the sentence "that's already covered" was
true of something adjacent to the thing that wasn't.

### #28 — A trailer the fleet row doesn't flag still gets the old `ok`-forever PM clock

**Severity: medium. Status: BUILT in `1301c76`, not closed — closes when PR
#129 merges. Approved by Dillon 2026-09-23 ("Complete 28, then merge").
Opened 2026-09-23 by this map's pass against `42ed3c7`** — a residual of
#18's build, found while verifying it, not handed to this pass.

*As built (`1301c76`, anchors re-read at that commit):*

| Who asks | Test now | Where |
|---|---|---|
| "Is it towed?" | `isTowedUnit(eq)` — `isTrailerTemplate(type, make, model)`, **no flag required**, the inspection's own keyword test | `server-lib/fleetActivity.js:79-82` (reason in the doc comment `:71-78`) |
| May it carry a PM clock? | `pmAllowedFor` — any unflagged machine yes; a flagged attachment only if `isTowedUnit` | `server-lib/fleetActivity.js:88-91` |
| PM status — towed clock | `isTowed = isTowedUnit(eq)` (was `!!eq.is_attachment && pmAllowed`) → towed branch `:223-242`, `towedDistanceSince` `:237` | `api/maintenance.js:219` |
| PM status — trailer already set up in Hours | new `unit_mismatch` return rather than comparing KM towed to an hours interval; rendered by the existing status pill (`src/Dashboard.jsx:6430`) | `api/maintenance.js:231-236` |
| PM interval — must it be KM? | `isTowedUnit(eqRows[0]) && readingUnit !== 'KM'` → 400 | `api/companydata.js:1276-1279` (select now carries `type, make, model`, `:1258`) |
| Most used / most repaired | `e.is_attachment \|\| isTowedUnit(e)` — the same set the inspection offers as attachments | `server-lib/fleetActivity.js:127-129` |

*Evidence:* 4 new tests — `tests/unit/fleet-activity.test.js:120,126,132`
(unflagged trailer is towed and PM-able; ordinary machine not towed, flagged
forks neither; unflagged trailer counted in attachment stats) and
`tests/unit/timeclock-gate.test.js:242` (an unflagged trailer's interval must
be KM, through the real `companydata.js` handler). Those two files copied into
a `427895e` worktree → **4 fail / 31 pass**, exactly the four new tests; at
`1301c76` → 35/35. `npm run test:unit` → **419/419**. Run 2026-09-23.
**Gap in the evidence:** no test runs `list_status` itself, so the
`maintenance.js:219` switch and the new `unit_mismatch` return at `:234-235`
are verified by reading only — the same gap #18 recorded for the towed branch.
Whether any live company actually has an unflagged trailer was still not
queried.

*Re-check (post-build):* `grep -n "isTowedUnit" api/maintenance.js api/companydata.js server-lib/fleetActivity.js`
→ 7 hits: the two imports (`maintenance.js:13`, `companydata.js:17`),
`maintenance.js:219`, `companydata.js:1277`, `fleetActivity.js:79,90,129`.
If any of the three call sites drops out, #28 has regressed. Run 2026-09-23
against `1301c76`.

*As found at `42ed3c7` (numbers as of that commit):*

The product has two definitions of "this machine is a trailer", and #18's fix
used the narrower one.

| Who asks | Test | Where |
|---|---|---|
| Inspection — no-readings path | `is_attachment` **or** `isTrailerTemplate(type, make, model)` | `src/Inspection.jsx:276-277` |
| Inspection — attachment picker | same **or** — with the reason in the comment: "so a fleet that predates the flag keeps behaving as it did" | `src/Inspection.jsx:280-287` |
| PM — is this a towed clock? | `is_attachment` **and** `isTrailerTemplate(...)` | `api/maintenance.js:216-217` via `pmAllowedFor` (`fleetActivity.js:75-78`, first line returns `true` for any unflagged machine) |
| PM interval — must it be KM? | `is_attachment` only | `api/companydata.js:1276` |
| Most used / most repaired | `is_attachment` only | `fleetActivity.js:114` |

`is_attachment` arrived as `boolean not null default false` with **no
backfill** (`docs/schema/equipment-fleet-management-migration.sql:70`). So a
trailer registered before 2026-09-17 — or since, by a supervisor who did not
tick the box — whose make/model says "flatdeck", "lowboy" or "trailer" is an
attachment to the inspection and a metered machine to PM. It has no readings
of its own (`Inspection.jsx:70-71` writes `start_reading`/`reading_unit` null
for it), so PM takes the metered branch with `current` null, and once a
service is logged `usageSinceService` is `0` (`maintenance.js:242`) and the
status is **`ok`, forever** — exactly the state #18 was opened about. Weekly
Hours credits the same trailer its towed kilometres (`equipmentreports.js:345`),
so the two sub-tabs disagree again. It also accepts an **Hours** interval
(`companydata.js:1276` checks only the flag) and never appears in the new
attachment analytics cards.

*Re-check:* `grep -n "is_attachment" api/maintenance.js server-lib/fleetActivity.js api/companydata.js`
next to `grep -n "is_attachment || isTrailerTemplate" src/Inspection.jsx`.
Run 2026-09-23 against `42ed3c7`.

**Not checked:** whether any live company has such a row. That is a data
question this pass did not query; the code path is verified, the population
is not. *(Still true after the build.)*

**What the customer sees.** A supervisor sets a 5,000 km bearing interval on a
flatdeck that was registered before the attachment checkbox existed, logs its
last service, and it reads "OK" from then on — while Weekly Hours, one tab
over, shows it towed 400 km last week.

**A fix would touch:** one definition shared by all five askers — either
`pmAllowedFor` / `isTowed` / the KM check / `attachmentStats` using
`is_attachment || isTrailerTemplate(...)` like the inspection does, or a
one-time backfill setting `is_attachment` on template-matched trailers. The
backfill is the more honest version (the flag becomes the one truth) but it is
a data change; needs a decision. No new `api/` file either way.

### #29 — A trip towed by a free-text machine credits Weekly Hours and not the trailer's PM clock

**Severity: low. Status: OPEN, awaiting a decision. Opened 2026-09-23 by this
map's pass against `42ed3c7`** — a residual of #18's build.

`list_status` loads inspections with `.not('equipment_id', 'is', null)`
(`api/maintenance.js:161-166`), which was right when the only question was a
fleet machine's own readings. #18 reuses that same set for towed distance:
`towedDistanceSince` pairs each post-trip with its pre-trip **only inside
that set** (`server-lib/fleetActivity.js:101-112`). A trip whose tow unit was
typed in free text (a rental truck, a sub's pickup) has `equipment_id` null on
both halves, so it is never seen, and a **registered** trailer it towed gets
no kilometres for it.

The inspection allows exactly that trip: the attachment picker does not depend
on how the host was chosen (`src/Inspection.jsx:284-287`, `canAttach` at
`:292`), and the pre-trip stores the trailer's fleet id. Weekly Hours
(`foldWeeklyUsage`, query `equipmentreports.js:775-779`, no `equipment_id`
filter) and the weekly report's towed section (`:552-575`) credit it.

*Re-check:* `sed -n 161,166p api/maintenance.js` → the `.not('equipment_id'…)`
filter; `grep -n "equipment_id" api/equipmentreports.js` around `:775` → none on
the Weekly Hours query. Run 2026-09-23 against `42ed3c7`.

**Deliberately not part of this break:** PM also ignores an **hour-metered**
tow unit's trips (`fleetActivity.js:108`, pinned by
`tests/unit/fleet-activity.test.js:79`) — hours are not distance. Weekly Hours
does credit those hours to the trailer; that is a Weekly Hours oddity, not a
PM gap, and not filed.

**A fix would touch:** `api/maintenance.js`'s `list_status` — a second,
company-scoped inspections read without the `equipment_id` filter for the
towed path only (or dropping the filter and keeping it in the metered reducer).
No migration.

### #30 — An attachment's defect reaches the Brain under the carrier's name

**Severity: low. Status: OPEN, awaiting a decision. Opened 2026-09-23 by this
map's pass against `42ed3c7`.** Split out of #17 — the §3 matrix had pointed the
Attachments → Brain cell at #17, but #17's entry and its approved build were
about corrective actions only.

`inspectionFindingSignal` (`api/logs.js:179-217`, written at `:454-460`) sends
the Brain the **names** of Defective/Monitor items (`:199-202`) and one machine:
the record's `equipment_label` (`:214-215`) — the carrier's. An item's
`unitLabel` / `attachmentId` is never read. So bent tines on a set of forks
reach the Brain as "Loader: Tines" — the same misattribution #17 just removed
from corrective actions, one table over, from the same submit.

*Re-check:* `sed -n 179,217p api/logs.js | grep -n "unitLabel\|attachment"` → no
hits. Run 2026-09-23 against `42ed3c7`.

**Why low:** the Brain is summarized per company, not keyed per machine, so
the damage is a skewed "what breaks on our loaders" in the generated profile,
not a wrong count anywhere a supervisor acts on.

**A fix would touch:** `inspectionFindingSignal` only — group the named items by
`itemAttachment`'s machine (already in `correctiveActions.js:471`) and emit the
attachment's label for its own items. Needs a decision on the signal's shape
(one signal with per-machine groups vs one per machine), because
`server-lib/companyBrainSummary.js:106` reads `signal.equipment` as a single string.
No migration.

### #31 — A toolbox-talk attendee's or FLHA crew member's `rosterId` is never checked against the roster

**Severity: low. Status: fixed same-session, 2026-09-25, on
`claude/toolbox-talk-edit-notes-oz5y1u`.** Opened and closed within the same
branch: this map's pass caught the gap while the feature itself was still
being built on this branch (not a dormant break found on an already-shipped
feature), so it was closed immediately rather than filed for a separate
approval round — the same discipline `tenant-scope-reviewer` applies to a
fresh diff, not the "known breaks await a decision" rule this section is
otherwise governed by. `server-lib/rosterSignerScope.js`'s
`sanitizeSignerRosterIds` now runs on both submit paths (`api/logs.js`'s
toolbox insert, `api/flhas.js`'s FLHA insert AND amend paths) and strips
any `rosterId` that doesn't resolve to an *active* row in the caller's own
`roster` table — deliberately by nulling rather than rejecting the
submission, matching `resolveEquipmentIds`' "fail toward the label-only
record" precedent rather than `resolveSiteId`'s 403, since losing an
entire signed toolbox talk or FLHA over one bad id would be worse than
just not trusting that one id.

The original finding, for the record:

`src/ToolboxTalk.jsx` and `src/App.jsx` now let a second signer be picked
from a real roster row (`list_roster_names`, `api/companydata.js:761-770`)
instead of typed free text, and stamp a `rosterId` onto that attendee/crew
entry client-side (`ToolboxTalk.jsx:275-280`, `App.jsx:526-529`). Nothing on
the server re-derives or re-checks it.

`toolbox_talks.attendees_json` and `flhas.crew_signatures` are both plain
jsonb columns on the client-submittable allowlist (`api/logs.js:159`,
`api/flhas.js:148`) and neither submit path opens the array to validate a
member `rosterId` against `roster` — confirmed absent:

```
grep -n "attendees_json\|crew_signatures" api/logs.js api/flhas.js
→ only the allowlist/select/update lines already cited above; no
  per-entry validation, no roster lookup, in either file.
```

So a `rosterId` a client sends can be any value at all — another
company's roster id, an id belonging to someone `active: false`, or a
made-up number — and it saves, prints on the PDF, and is indistinguishable
in storage from a genuine pick. Compare to `site_id`/`equipment_id`, which
travel the exact same "id rides beside authoritative text" shape but *are*
checked against the caller's own company before being trusted (§2,
`site_id`/`equipment_id` entries; `server-lib/equipmentScope.js`).

**Why this is worth a decision rather than an assumed non-issue:** the
whole point of the feature, per its own inline comments, is that a second
signature is "tied to a real roster_id... instead of a typed name nobody
can verify later" (`api/companydata.js:755-757`). An unverified `rosterId` delivers the *look*
of that guarantee (a dropdown, a real name shown) without the substance —
anyone who can reach the submit endpoint directly (not through the picker
UI) can write any `rosterId` they like into the JSON. `tenant-scope-reviewer`
territory as much as this map's — filed here because it's a join-key gap,
not flagging it as exploited.

**Distinct from break #3, not a duplicate.** #3 is the *primary* submitter
(`worker_name`/`presenter_name`), stamped server-side from the session —
already unforgeable. This is the *secondary* signer, asserted by the
client and never checked. Different trust level, same table (`roster`),
which is exactly the situation §2 warns about: a real FK on one side
(`submitted_by_roster_id`) and something that only *looks* like one on the
sibling column right next to it.

**A fix would touch:** the toolbox submit path (`api/logs.js`, wherever
`attendees_json` is written) and the FLHA submit path (`api/flhas.js`,
wherever `crew_signatures` is written) — validate every non-guest
`rosterId` in the array belongs to an active roster row in the caller's own
company before insert, the same shape `equipmentScope.js` already provides
for `equipment_id`. No migration; no schema change (`rosterId` is already
free-form inside jsonb, so tightening is a server-side check, not a column
addition).

### #32 — A worker's own Portal submissions don't show up in My Forms

**Severity: medium. Status: CLOSED — PR #149, branch
`fix-break-32-portal-my-documents`, commit `6b2fc3a`.** Filed at the
phase-2 pass (2026-09-29), re-confirmed open through phases 3 and 4, then
fixed same-day once approved.

`src/MyDocuments.jsx` ("My Forms") is a worker's history of everything
they've submitted, resumed via `api/customforms.js`'s `get_my_documents`
action. Before the fix, that handler queried `flhas`, `inspections`,
`toolbox_talks`, `daily_reports`, `incidents`, `near_misses`,
`inspection_records` (via `inspection_forms`) and `custom_form_records`
(via `custom_forms`) — eight sources — and never `portal_records`.

**The fix (`api/customforms.js:451-462`):** a `portal_records` query,
scoped through `portal_documents.company_id` first — `portal_records` has
no `company_id` column of its own, same indirection `custom_form_records`
already needed via `custom_forms` (`:441-446`) — then matched to the
requesting worker by `submitted_by` (a name-string match, consistent with
every other row this handler already used; **not** upgraded to
`submitted_by_roster_id`, even though that column exists and is
server-stamped/trustworthy per §2's `portal_records.submitted_by_roster_id`
entry — worth another pass, not filed as its own break since the other
seven name-matched rows in this same handler share the identical
weakness, and singling out Portal for it would misrepresent the scope).
Merged into the handler's `documents` array as `type: 'portalform'`.

**No client-side change was needed.** `src/MyDocuments.jsx`'s Submitted
section already renders an unrecognized `doc.type` correctly —
`MyDocuments.jsx:196`, `const meta = TYPE_META[doc.type] || { label:
doc.title, icon: FileText };` — falling back to the record's own `title`
(here, `portalDocMap[r.document_id] || 'Portal Document'` from the API
response) and a generic file icon, rather than crashing or silently
dropping the row. Verified by reading both files after the fix: `grep -n
"portal" api/customforms.js src/MyDocuments.jsx` now returns the new query
in `api/customforms.js` and nothing in `src/MyDocuments.jsx` — correct,
since the fallback needed no Portal-specific code there.

**Re-check:** `grep -n "portal_records\|portalform" api/customforms.js` —
absence means the fix regressed.

**Found while building this fix, deliberately not folded into it — see
break #33 below:** the *other* half of `MyDocuments.jsx`, the Unfinished
drafts section, has its own separate allowlist that still excludes
`portalform` and was untouched by PR #149.

### #33 — An in-progress Portal draft never shows up in Unfinished, unlike every other form type

**Severity: low/medium. Status: CLOSED. PR #151 (`a02612d`) made the draft
appear in Unfinished, but that fix was incomplete: tapping Resume on it went
nowhere. The other half is break #37, fixed in PR #159. Only with both is a
Portal draft findable and resumable.** Filed
2026-09-29 while building the #32 fix (PR #149) — distinct from #32 and
NOT fixed by it. Fixed same-day once approved: `TYPE_META` in
`src/MyDocuments.jsx:37` now carries `portalform: { label: "Portal
Document", icon: FileText }`, so both `:54`'s strict `scanDrafts`
allowlist check and `:147`'s `const meta = TYPE_META[d.type];` (no
fallback) succeed for a Portal draft, matching every other form type.
One-line, client-only change — no schema or API change, as the fix
description below anticipated. Re-verified in code post-merge:
`grep -n "portalform" src/MyDocuments.jsx` now returns the new
`TYPE_META` entry at `:37` (the allowlist checks at `:55`/`:148`/`:198`
reference the `type`/`d.type` variable, not the literal string, so they
don't show up in that grep — read directly and confirmed `TYPE_META`
now resolves for `portalform` at both call sites).

`src/MyDocuments.jsx` has two sections, both keyed off the same
`TYPE_META` allowlist (`MyDocuments.jsx:28-37`) but using it two different
ways:

- **Submitted** (server-side history, break #32's territory): reads
  `TYPE_META[doc.type]` with a fallback —
  `TYPE_META[doc.type] || { label: doc.title, icon: FileText }`
  (`:196`) — so an unlisted type like `portalform` still renders using the
  record's own title. This is exactly why #32's fix needed no client-side
  change.
- **Unfinished** (`scanDrafts`, client-side localStorage scan,
  `:41-70`): has no such fallback. `:54`, `if (!TYPE_META[type])
  continue;` — a draft whose `type` isn't a `TYPE_META` key is skipped
  outright, not rendered generically.

`portalform` is not a `TYPE_META` key (confirmed: the object at `:28-37`
lists `flha`, `inspection`, `toolbox`, `nearmiss`, `incident`, `daily`,
`monthly`, `customform` — eight entries, no `portalform`). And a Portal
draft genuinely gets written to that same `fora_draft_` localStorage
namespace `scanDrafts` reads: `src/PortalDocumentForm.jsx:167-171` calls
`useDraftAutosave("portalform", draftScope, ...)`, which autosaves under
key `fora_draft_portalform_<scope>` — confirmed:
`grep -n "useDraftAutosave\|portalform" src/PortalDocumentForm.jsx` shows
the hook wired with `"portalform"` as its `formType` at `:168`, matching
`DRAFT_PREFIX + type + "_" + scopeId`'s shape in `useDraftAutosave.js`.

**Consequence:** a worker who starts a Portal document, gets interrupted
(shift change, low battery, accidentally navigates away) and comes back
to "My Forms" later sees their in-progress FLHA, inspection, toolbox talk,
etc. sitting in Unfinished, ready to resume — but a half-filled Portal
document is invisible on that screen. It isn't lost (the draft is still in
`localStorage` and `PortalDocumentForm.jsx:143`'s `loadDraft("portalform",
draftScope)` will pick it back up if the worker happens to reopen that
exact document from the menu), but there's no discovery path back to it
from the one screen built specifically to be "a spot where they can find
their unfinished and submitted forms" (`MyDocuments.jsx:4-5`'s own header
comment, quoting the customer feedback that motivated the screen).

**Distinct from #32:** #32 was the *submitted* side (`get_my_documents`,
server-side, post-submit). This is the *draft* side (`scanDrafts`,
client-side, pre-submit) — a different function, a different data source,
and the #32 fix doesn't touch either.

*A fix would touch:* `src/MyDocuments.jsx`'s `TYPE_META` — add a
`portalform` entry (label + icon, matching the "Portal Document" naming
`api/customforms.js`'s fix already uses) so both `:54`'s strict check and
`:147`'s Unfinished render (which, unlike `:196`, also has no fallback —
`const meta = TYPE_META[type];` used directly) succeed. No schema or API
change; this is a client-only, one-object fix — but per CLAUDE.md it still
needs Dillon's explicit yes before it's built.

*Re-check:* `grep -n "portalform" src/MyDocuments.jsx` — no hits means the
gap is still open (as of this filing, the only `portalform` reference in
the whole `src/` tree touching this screen is in
`WorkerMenu.jsx:38`'s `RESUBMIT_HANDLERS`, unrelated to this screen).

### #34 — A question-level escalation never notifies the department it's routed to

**Severity: medium. Status: CLOSED — PR #152, branch
`fix-break-34-escalation-notification`, commit `582ee3d`.** Approved by
Dillon, built same-day, closed on merge. Filed 2026-09-29 while placing
Company Portal phase 5 (question-level escalation, branch
`company-portal-phase-5-escalation`, PR #150) on the map.

**The fix (`api/portal.js:588-611`):** a second, best-effort `sendEmail`
call added inside the escalation-insert block, gated on a local
`escalationInserted` flag so it only fires once the `portal_escalations`
row is actually saved (`:567,574,588`). Same recipient-query shape as the
phase-3 submission email beside it (`role: 'supervisor'`, `active: true`,
non-null `email`, filtered to `company_id`), but filtered on
`r.departments.includes(q.escalation_department)` (`:599`) instead of the
document's `departments` array — so it reaches the escalation's *target*
department rather than repeating the phase-3 recipients. Wrapped in its
own try/catch that only logs on failure, matching every other side effect
in this handler. No schema change. Re-verified in code post-merge:
`grep -n "sendEmail" api/portal.js` now returns the import (`:27`) plus
two call sites (`:603` escalation, `:643` phase-3 submission) — was one
call site before the fix.

Phase 3 built exactly this kind of "get someone's attention" mechanism for
a document's own submission: `submit_portal` emails every active,
on-department supervisor a best-effort notification when a document is
submitted (`api/portal.js:580-611`, "Phase 3: 'email fires on submission'"
comment). Phase 5's escalation is the same idea one level down — a single
flagged answer, not the whole document — but the escalation-insert block
that immediately precedes that email code in the same handler
(`api/portal.js:552-578`) does not call `sendEmail` or anything else. Read
both blocks back to back: the email block only ever reads
`docRows[0].departments` (the document's own routing) — it never reads
`escalation.target_department`, and the escalation-insert block never
attempts a notification of its own.

**Consequence:** the whole stated point of escalation, per the migration's
own header comment and the code comments in `list_escalations`
(`api/portal.js:849-854`), is that a flagged answer can reach a
**different** department than the one that already got a submission email
— the spec's own example is a Safety inspection's defect answer escalating
to Maintenance. Maintenance never received the phase-3 submission email
(it's not in the document's `departments`), and phase 5 gives it nothing
in its place. A defect sits in `portal_escalations` with `status: 'open'`
until someone in the target department happens to open the Portal tab's
new Escalations sub-tab — there is no push. A company selling on "we'll
flag it and someone gets notified" doesn't get that; they get "we'll flag
it and someone might eventually look."

*Evidence of absence:* `grep -n "sendEmail" api/portal.js` returns two
lines — the import (`:27`) and exactly one call site (`:606`, the phase-3
submission email, inside the `submit_portal` handler, below the
escalation-insert block) — none inside or near the escalation-insert block
itself, and none inside `list_escalations`/`action_escalation`.

*Built:* `api/portal.js`'s escalation-insert block now sends a second,
best-effort `sendEmail` call after a successful `portal_escalations`
insert (`:552-608` post-fix) — same query shape as the phase-3 email
(`roster` filtered to `company_id`, `role: 'supervisor'`, `active: true`,
non-null `email`), but the recipient filter checks
`r.departments.includes(q.escalation_department)` instead of the
document's `departments` array, so it reaches the escalation's own target
department rather than repeating the phase-3 recipients. Only fires when
the `portal_escalations` insert itself succeeded (tracked via a local
`escalationInserted` flag), and is wrapped in its own try/catch that only
logs on failure — a notification failure can never affect the
already-saved escalation row, matching the posture of every other side
effect in this handler. No schema change.

*Re-check:* `grep -n "sendEmail" api/portal.js` now returns three lines —
the import and two call sites inside `submit_portal`, the new one inside
the escalation-insert block and the pre-existing phase-3 one below it.

**Not the same as break #32/#33** (those are about a *worker's own* Portal
history UI, unrelated to escalation). Distinct, new item.

### #35 — A department report with nobody to send to is marked "sent" and its documents are never emailed

**Severity: medium. Status: CLOSED. Fixed and merged in PR #158, re-read
2026-09-29.** `runSchedule` now returns `marked: false` whenever `sent === 0`
on a non-empty run (`server-lib/portalReports.js:148`, so zero recipients no
longer advances `last_sent_at`), refuses without `RESEND_API_KEY` (`:128`), and
the cron skips `roster_enabled`-off or `suspended` companies
(`api/cron-portal-reports.js:36-39`). Re-check: `sed -n 144,151p
server-lib/portalReports.js` (the `sent === 0` return must precede the
`update`). Filed 2026-09-29 placing `portal-pdf-email` (`ba5f6ab`).
This is a bug in the feature's own unmerged code, so it was fixed in the same
PR rather than waiting for a sweep decision: `runSchedule` now refuses to mark
a schedule handled whenever `sent === 0` on a non-empty run, refuses to run at
all without `RESEND_API_KEY`, and the cron skips companies with `roster_enabled`
off or `suspended` on (the gate noted at the end of this entry's changelog row).
The text below is the original finding.

A schedule whose department has no active supervisor with a readable email
(and no hand-added addresses) finds records, sends to nobody, and still
advances `last_sent_at`. `runSchedule` only refuses to mark when
`recipientCount > 0 && sent === 0` (`server-lib/portalReports.js:143`); with
`recipientCount === 0` it falls through to the update at `:145`. The next run
starts from `sinceFor` = that timestamp (`:48-51`), so those documents are
never included once someone does add a supervisor or address. Same shape via
`departmentSupervisorEmails` swallowing a decrypt failure (`:66-70`, e.g.
`FIELD_ENCRYPTION_KEY` missing) and via `sendEmail` returning normally when
`RESEND_API_KEY` is unset (`server-lib/email.js:23-26`), which `sendEach`
counts as sent (`portalReports.js:118`). The cron reports counts only in its
HTTP response (`cron-portal-reports.js:40,47`), which nothing reads. The
manual button does surface it ("Sent N documents to 0 addresses",
`PortalReports.jsx` sendNow) but only when a person happens to press it.

*Customer loses:* the weekly Safety digest silently skips a week of
documents because the one Safety supervisor had no email on file.

*Re-check:* `sed -n 140,146p server-lib/portalReports.js` (no branch marks
`marked:false` when `recipientCount === 0`).

*A fix would touch:* `portalReports.js:143` (also treat zero recipients as
not-handled) and, optionally, a "no recipients" warning on the schedule row.
Not run against a live DB; verified by reading only.

### #36 — "Email to department" lets the server send a record to a department the document isn't routed to

**Severity: low-medium. Status: CLOSED. Fix (`e3c49ad`) merged in PR #158,
re-read 2026-09-29: the server check is at `api/portal.js:1260`, `if
(session.role !== 'admin' && !(doc.departments || []).includes(department))
return denied();`. Admin is deliberately unrestricted.** Filed
2026-09-29 against `ba5f6ab`; while this entry was being written someone
else fixed it (first uncommitted, then committed as `e3c49ad`): `api/portal.js:1150-1153` now denies a non-admin whose
target `department` is not in `doc.departments`, and `Dashboard.jsx:1603`
no longer falls back to all five departments (button hidden when the
document has none, `:1644`). Admin is deliberately unrestricted. Not my
edit and not approved through this process; the text below describes
`ba5f6ab`. Re-check:
`grep -n "doc.departments || \[\]).includes(department)" api/portal.js`.

Everywhere else in Portal, who sees a record is decided by the document's
`departments` (`list_portal_records` `api/portal.js:689-693`). The one-off
email lets the caller name any department: the server only checks the value
is in `PORTAL_DEPARTMENTS` (`:1138`) and that the caller's own departments
intersect the document's (`:1148-1149`). It never checks
`doc.departments.includes(department)`. The picker that restricts this is
client-side (`Dashboard.jsx:1602`). A crafted request (or a document with
empty `departments`, where the picker falls back to all five, `:1602`) sends
a 7-day signed PDF link (`portalReports.js:154`) to supervisors of a
department that cannot open that record in their own dashboard. Scheduled
digests do not have this problem, they select by the same
`doc.departments` (`portalReports.js:91`).

*Customer loses:* the routing they configured (HR documents reach HR) has a
side door; a pay or medical document can be pushed to Operations.

*Re-check:* `sed -n 1136,1150p api/portal.js` (no
`doc.departments.includes(department)`).

*A fix would touch:* one condition after `api/portal.js:1146` (that is what the working-tree change is).

### The Company Portal parity sweep (2026-09-29): #37-#40

Method: for each thing a built-in document can do, check whether a Portal
document can. Sweep found four gaps, numbered here in the order it listed them
(P1-P4 in the sweep notes).

### #37 (P1) — Resume on a Portal draft went nowhere

**Severity: medium. Status: CLOSED. Fixed and merged, PR #159.** Second half
of #33. Unfinished (`MyDocuments.jsx`) listed a Portal draft after PR #151,
but `WorkerMenu.jsx`'s `onResume` handler only knew `customform` and the
built-in types, so `portalform` fell into `setDoc(type)` with an id-less type
that opens nothing. Now `src/WorkerMenu.jsx:221`: `else if (type ===
"portalform") { setPortalDocumentId(formId); setDoc("portal"); }`. Re-check:
`grep -n '"portalform"' src/WorkerMenu.jsx` (expect `:38` resubmit map and
`:221`); absence of `:221` means it regressed. Customer loses (before): a
worker sees their unfinished Portal form and can't reopen it.

### #38 (P2) — A submitted Portal record could not be edited, regenerated or deleted

**Severity: medium. Status: CLOSED. Fixed and merged, PR #159.** Built-in
documents have `update_record` and friends in `api/customforms.js`; Portal had
no update or delete in `api/portal.js`, so a wrong answer or a test submission
was permanent. Now: `update_portal_record` (`api/portal.js:1037`) and
`delete_portal_record` (`:1085`), both admin/supervisor, both scoped by
`loadManageableRecord` (`:1021`: own company, an individually-identified
supervisor only for documents routed to their departments, one generic 403).
Edits are checked per field type by `validateEditedPortalAnswer`
(`server-lib/portalFieldTypes.js:48`, called `api/portal.js:1059`), capped at
200 answers (`:1041`), and only answers belonging to that record are touched.
Escalations already raised are left as snapshots (comment at `:1068`). Delete
also removes the stored PDF (`flha-reports`) and attachments
(`portal-attachments`) from storage, best-effort (`:1085-1113`, removal at `:1108-1109`), and cascades
answers and escalations. UI: `PortalRecordCard` edit, regenerate-PDF and
delete (`src/Dashboard.jsx:1601`, `:1653`, `:1663`). Re-check: `grep -n
"update_portal_record\|delete_portal_record" api/portal.js src/Dashboard.jsx`.

Related, same PR: `get_portal_record_detail` now returns one generic 403 for
a missing record and for a foreign one when the caller is not admin
(`api/portal.js:721-723`, and `:729` for a missing document); admin still gets
404. Probing record ids can no longer reveal what exists in another company.

### #39 (P3) — Deleting a site or a company did not know about Company Portal

**Severity: medium. Status: APPROVED by Dillon and FIXED on branch
`fix-portal-p3` (`b97b231`). Not closed until its PR merges.** Found by the
sweep: `portal_records.site_id` is NOT NULL with no cascade, and
`portal_documents.company_id` has no cascade, so both deletes either hit the
foreign key or orphaned Portal rows. Before: `delete_site`
(`api/companydata.js`) returned the generic "Couldn't remove site." with no
reason; `delete_company` (`api/admin.js`) had no Portal step. Now:
`delete_site` counts `portal_records` on the site and adds "N Company Portal
submission(s)" to the blocker list (`api/companydata.js:1027-1032`, the same
blockers message every other document type uses); `delete_company` counts
Portal submissions through `portal_documents.company_id`
(`api/admin.js:685-698`, folded into the existing total-records refusal), and
when there are none deletes the company's `portal_documents` (cascading
questions, rules, assignments, escalations, `:729`) and
`portal_report_schedules` (`:731`, deleted unconditionally) before the roster. Verified by reading only;
not run against a live database. Re-check: `grep -n "portal_records"
api/companydata.js api/admin.js`.

### #40 (P4) — Portal submissions and escalations are absent from Overview Recent Activity, Site Activity and Analytics

**Severity: low-medium. Status: FULLY BUILT, closed pending merge (same
convention as #37-#39).** Recent Activity merged in PR #161 (branch
`fix-portal-p4`); Site Activity and Analytics built on
`portal-parity-analytics` (`23aad0b`), closes when that PR merges. Verified by
reading the code:

- **Recent Activity** (PR #161): Portal submissions (`type: "portal"`) and open
  escalations (`type: "portalescalation"`) join `recentActivityList` only when
  `TAB_VISIBLE.portal` is on (`src/Dashboard.jsx:4268-4270`).
- **Site Activity**: `fieldSiteActivity` takes a 7th `extras` argument
  `{portal, custom}`, default `{}` (`src/analyticsUtils.js:122`), bumped
  through the same `siteBucketKey` id-first bucketing (`:138-139`), so both
  join on the real `site_id`. Overview passes `portalRecords` (only when
  `TAB_VISIBLE.portal`) and `companyCustomDocs` of every category
  (`src/Dashboard.jsx:4278-4281`), and totals include the two new counts
  (`:4282`). Safety Analytics (`src/Analytics.jsx:147`) and its PDF
  (`src/generateSafetyAnalyticsPDF.js:43`) pass no `extras`, so they are
  unchanged and custom safety docs are not double counted (they already show
  in `scheduledSiteActivity`, `Analytics.jsx:247`).
- **Portal Analytics**: `portalSummary()` (`src/analyticsUtils.js:165`) and
  `PortalAnalyticsPanel` (`src/Analytics.jsx:449`), rendered as the
  "Analytics" sub-tab of the Portal tab (`src/Dashboard.jsx:6462`, `:6567-6575`)
  from the already-loaded `portalRecords`, `portalEscalations`,
  `portalAssignmentRows`. Those are server-side department-scoped, so a
  department supervisor sees their slice; the panel subtitle says so
  (`Analytics.jsx:453`). An escalation has no site column, so it borrows its
  record's `site_id` (`analyticsUtils.js:198-201`).
- **Tests**: `tests/unit/portal-analytics.test.js` (six tests, including
  no-extras unchanged, shared site-id bucket, and out-of-scope escalation
  fallback). Not run by me; read only.
- **Deliberately not done**: no Portal column in the Safety Analytics PDF or
  Safety tab (Portal is its own product, `Analytics.jsx:445-448`), no new API.

**Residual gap, OPEN, low, not numbered separately:** workforce-category custom
documents appear in no Analytics panel. `companyWorkforceCustomDocs`
(`src/Dashboard.jsx:4005`) is used only by its own tab (`:6440`); the Safety
panel gets `companySafetyCustomDocs` (`:6646`) and the Equipment panel
`companyOperationsCustomDocs` (`:6678`). They now show in Overview Site Activity
only (`:4280`). Nothing in the code or docs records this as a decision, so it
is open rather than deliberate; it needs a call on whether workforce documents
belong in any Analytics view. Re-check: `grep -n "companyWorkforceCustomDocs"
src/Dashboard.jsx` returns only `:4005` and `:6440`.

The text below is the original finding, written before the fix, so its line
numbers and "returns nothing" checks are historical. `recentActivityList`
(`src/Dashboard.jsx:4248-4257`) merges eight built-in lists plus
`walletActivity` and no Portal source. `siteActivity` (`:4262`) is fed
`fieldSiteActivity(companyFlhas, companyToolbox, companyDaily,
companyNearMisses, companyIncidents, ...)`, no Portal. `grep -in portal
src/Analytics.jsx` returns nothing. The data is already in memory on the
Overview (`portalRecords`, `portalEscalations`, loaded at `:3460-3468`) and
the new Company Portal panel shows counts, but a Portal submission never
appears in the activity feed, never counts toward a site, and never reaches
Analytics. Customer loses: a company whose paperwork is mostly Portal
documents sees a quiet Recent Activity. *A fix would touch:*
`recentActivityList` and its row renderer (`:5596-5622`), `fieldSiteActivity`
(`portal_records.site_id` is a real FK, so this joins cleanly), and
`src/Analytics.jsx`. Re-check: `grep -n "portalRecords" src/Dashboard.jsx`
between `:4248` and `:4270` returns nothing.

### #41: The founder dashboard's document-type list is a second copy nothing checks against the modules
**Severity: low** (founder-facing, no customer loses anything), but it failed silently.
**Status: BUILT and approved by Dillon, closed pending merge of its PR (`8502cb2` on
`founder-dashboard-activity`), same convention as #37-#40.** Opened 2026-09-29
against `cb9908a`. Do not mark merged until the PR is.

The dashboard decides what "used" means from its own hand-written list,
`DOC_TYPES` (`server-lib/platformOverview.js:26-39`), plus a table list
`DOC_SOURCES` (`:208-218`) and `VIA_PARENT` (`:222-226`). It decides what
"bought" means from `company_document_settings` rows (`:126-133`). It joins the
two through `pricing.js` `MODULES[k].docKeys` (`:144-155`, `pricing.js:60-116`).
Before the fix nothing kept `DOC_TYPES` in agreement with `MODULES`
(`tests/unit/platform-overview.test.js` never referenced either), so a new doc
key added to a module, or a key with no module, either undercounted `used` or
vanished from the dashboard with no error.

**What was built (read, not taken from the PR text):**
- `UNMEASURED_DOC_KEYS = ['equipment_reports', 'maintenance', 'equipment_compliance']`
  is exported (`platformOverview.js:46`), the explicit "gates a module, files
  nothing of its own" list, with a comment naming the test (`:41-45`).
- Four guard tests (`tests/unit/platform-overview.test.js:148-173`): every
  `ALL_DOC_KEYS` entry is measured or unmeasured (`:148-153`); the dashboard
  names no key `pricing.js` does not know (`:155-159`); no key is both measured
  and unmeasured (`:161-164`); every module's keys are covered (`:166-173`).
  Together they require `DOC_TYPES` plus `UNMEASURED_DOC_KEYS` to cover
  `ALL_DOC_KEYS` (`pricing.js:124`) exactly.
- Verification reported by the builder, not re-run by this pass: a fake doc key
  added to a module made the first test fail with a clear message, and
  `pricing.js` was restored.

**Second consumer of the doc-key/module invariant, with its own guard.** #6's
test (`tests/unit/doc-key-module-invariant.test.js`) keeps `BUILTIN_DOC_KEYS`
(`api/customforms.js:120`) and `MODULES` in agreement, which protects billing.
The founder dashboard is now the second consumer of the same invariant and has
its own guard, protecting adoption numbers. The two tests are independent: a
key added to `pricing.js` must now satisfy both. Any *third* consumer that
keeps a hand-written doc-key list should get the same kind of test.

Known limit, unchanged and not a break: the guard checks keys only. A key
added to `DOC_TYPES` with a wrong `type`/table pairing in `DOC_SOURCES` is not
caught, and `equipment_reports` stays on the unmeasured list even though its
module is measured through its `inspection` key (`:146`), which is why that
module still reads as measurable.

**Re-check:** `npm run test:unit -- tests/unit/platform-overview.test.js`, and
`grep -n "docKey:" server-lib/platformOverview.js` against
`grep -n "docKeys:" server-lib/pricing.js`.

**Weak points on the same surface, recorded, not filed** (each works as
designed, but the number means less than its label):
1. **"Active workers" is PIN logins in the window, not activity.**
   `roster.last_login_at` is written in exactly one place, `mintRosterSession`
   (`api/login.js:444`, re-checked 2026-09-30 against `624ef31`). The old wallet-invite redemption minted a session
   without it; that path is gone, and `pin_link_set_pin`'s session stage now goes through `mintRosterSession` (`:882`), so a first login via the setup link **does** count. A worker on an existing session who
   never re-enters a PIN does not move it. Read: `platformOverview.js:87`.
2. **Mixed denominators.** `activeCompanies7/30` are built from every
   document including a suspended company's (`:67-79`) while `live` and
   `byTier` exclude suspended companies (`:46,114`) and `bySubscription`
   includes them (`:116`). Small until a suspended company keeps filing.
3. **Truncation drops the oldest.** Each table is read newest-first and
   capped at 20000 rows (`:189-199,221`), so a cap hit makes `total` and the
   older days a floor. The dashboard says so through `truncated` (`:166`).

**Pending link P1, CLOSED by slice 3c (2026-09-29, `26d6d4f`):** `platform_events`
now has a reader. `loadPlatformOverview` selects the last 30 days
(`server-lib/platformOverview.js:258-268`), `buildPlatformHealth` folds them
(`platformHealth.js:63`), and the Platform tab renders them (`PlatformDashboard.jsx:69`).
PR #162 merged into `main` 2026-09-29 and the table is applied live (RLS on, zero
policies, per Dillon). Distinct from the Portal-sweep P1 (#37).

**Slice 3c checks, all read in code 2026-09-29, none a break.** Writers were read on
`origin/main` (`ffbcf45`), because this stacked branch predates PR #162.
1. **Every Anthropic call site is metered.** `grep -rn "api.anthropic.com"` on `origin/main`
   over `api/`, `server-lib/`, `src/` finds four fetches and no SDK use: `api/generate-flha.js:303`
   (records via `record`, `:297`, plus a `rate_limited` row at `:290`), `api/portal.js:227`
   (ok path `:248`, error `:244`), `server-lib/companyBrainSummary.js:29` (`:66,70`) and
   `server-lib/onboardingDrafting.js:30` (`:57,61`). Each records `ai_generation` with the model.
   The other four producers: the three crons (`cron-company-brain-summary.js:41,54`,
   `cron-equipment-reports.js:57,120,139`, `cron-portal-reports.js:55,62`) and `sendEmail`
   (`server-lib/email.js:27,45,50,53`). That is the 8. Nothing is unmetered today.
2. **`CRONS` equals `vercel.json`'s crons.** `vercel.json:7-9` lists `equipment-reports`
   (`59 23 * * 0`), `company-brain-summary` (`0 4 * * *`), `portal-reports` (`0 13 * * *`).
   `platformHealth.js:40-44` has subtypes `equipment_reports` (168h), `company_brain_summary`
   (24h), `portal_reports` (24h), and each cron writes exactly that subtype and cadence.
3. **`MODEL_PRICES` covers every model in code.** Models used: `claude-opus-5` and
   `claude-sonnet-5` (`api/generate-flha.js:153-154`, table `:156-165`, default Opus `:174`),
   `claude-opus-5` (`api/portal.js:225`), `claude-haiku-4-5` (`companyBrainSummary.js:28`,
   `onboardingDrafting.js:29`). All three are in `platformHealth.js:28-32`.

**Former weak point, now #43 (BUILT, closed pending merge of its PR).** Nothing used to tie
`CRONS` or `MODEL_PRICES` to their sources: a fourth cron would never have appeared on the
dashboard (no row, no overdue alert), and a model rename would have shown as "unpriced".
`tests/unit/platform-health-sources.test.js` now pins both, in the shape of #41's guard
(`platform-overview.test.js:148-173`): `vercel.json` crons (`vercel.json:7-9`) against `CRONS`
in both directions plus cadence (`platform-health-sources.test.js:22-53`), and `MODEL_PRICES`
against every `claude-*` literal in `api/` and `server-lib/` in both directions (`:55-67`).
The builder shows it fails on a fake cron and a fake model, reported, not re-run by this pass.
Known limit: the model scan matches quoted `claude-*` literals only, and the cron subtype scan
needs `eventType: 'cron_run'` followed by `subtype:` in the same object. Re-check:
`npm run test:unit -- tests/unit/platform-health-sources.test.js`.

### #43 — "Waiting for PIN" / "No setup link sent" shows on everyone who got a PIN any other way
**Severity: low-medium, misleading rather than lossy. Status: OPEN, not approved.** Opened 2026-09-30 by the pass that placed `624ef31`.

`roster.pin_set_at` is written in exactly one place, `pin_link_set_pin` (`api/login.js:862`). Every other path that sets a PIN leaves it null: the claim-page typed PIN `claim_set_roster_pin` (`api/login.js:1256`), `set_own_pin` (`api/certifications.js:411`), an Owner PIN reset (`api/companydata.js:633,778`), and every roster row that existed before the migration. The roster rows show the label for `active && !pin_set_at` (`src/Dashboard.jsx:7903-7906`, `src/AdminPanel.jsx:2366-2367`), so those people read "No setup link sent" or "Waiting for PIN" while signing in fine every day. The claim page shows the honest state only for the link path (`src/ClaimAccount.jsx:221-222`). Customer loses: an Owner who trusts the label chases people who are already set up, and the label stops meaning anything, which is the wrong outcome for the only roster-wide "who is not onboarded" signal.

*Evidence:* `grep -n "pin_set_at" api/*.js server-lib/*.js` returns the roster select (`companydata.js:358`), the claim select (`login.js:1210,1223`) and the single writer (`login.js:862`). Re-check: same grep; it is fixed when a second writer exists or the label also keys off `last_login_at`.

**A fix would touch:** set `pin_set_at` in the other PIN writers, or show the label only when `!pin_set_at && !last_login_at`; backfill `pin_set_at = last_login_at` for existing rows. Two one-line edits plus a migration statement. Needs a yes.

### The document-assignment pass (2026-10-06, branch `claude/assignments-enforcement`, `ae9aee4`): #45-#48

Four breaks filed by the pass that placed assignments and supervisor scope.
**#45 and #46 ("the reader shipped, the writer did not") are CLOSED in code on
`claude/assignments-ui` (`e8ccde0`), merge and live migration pending.** #47 (Portal) is
CLOSED in PR #199 (see its entry); #48 (corrective actions, the surface the enforcement skipped) is FIXED in PR #200 (draft, not merged, so not marked closed).

### #45 — Nothing in the product can create, list or end an assignment row
**Status: CLOSED in code on branch `claude/assignments-ui` (`e8ccde0`); not marked merged. Re-verified 2026-10-06. Migration not applied live (`?`), so nothing takes effect until Dillon runs it.** Opened 2026-10-06.

*Original finding (kept for history):* every enforcement call read `document_assignments` and nothing wrote it, so an Owner had no way to assign a document to anyone.

*Evidence it is closed (read in code):* the writer is `create_document_assignment` (`api/companydata.js:1391-1413`, insert at `:1405-1406`, audit row `:1411`), the ender is `end_document_assignment` (`:1415-1424`, company-scoped update `:1418-1419`, 404 when nothing matched `:1421`), the lister is `list_document_assignments` (`:1371-1389`). All four assignment actions refuse anyone who fails `canManageCompany(session)` (`:1363-1365`); every client id is checked against the company in `server-lib/assignmentAdmin.js:75-123` and an assignment must pass `isAssignableAction` (`:79`), so `maintenance`, `timeclock` and a portal `view` row cannot be created. Duplicate (`:1401-1404`) and a 500-row cap (`:1399`, `assignmentAdmin.js:34`) are enforced. Screen: `src/DocumentAssignmentsManager.jsx:50,89,103`, mounted only for `canManageCompany` (`src/Dashboard.jsx:7880-7889`). Real check: `grep -rn "document_assignments" api src server-lib | grep -v "^server-lib/documentAccess.js"` now returns the three handler calls plus `assignmentAdmin.js:162` (`assignmentsNamingAudience`'s read, which only refuses a delete and never writes) and comments.

*Update 2026-10-06 (`17b85e6`, `507c7cc`):* the assignments are now tasks by default (`restricts = false`), and a crew lead can write tasks of their own (`companydata.js:1497-1524`); both are in §2's "Tasks versus restrictions" and "`roster.is_lead`" sections. Only a restricting row narrows or blocks a delete.

*New weak point worth knowing, not a break:* an assignment naming an empty audience narrows its document to nobody **if it is restricting** (a task naming an empty audience reaches nobody and costs nothing, `assignmentAdmin.js:176-178`). The screen's "reaches N people" (`assignmentAdmin.js:131-148`) shows that, and deleting a department, division or site that a row names is refused with a 409 (a 400 for a site), so the dead-audience case cannot arise through those deletes (`companydata.js:1298-1302,1342-1346,1521-1523`); an `individual` row for a deactivated person is the one case with no guard (harmless while they are inactive). Also a weak link, not a break: `roster.hide_unassigned` covers only assignable documents, so a flagged person still sees the Time Clock, Certifications, Equipment Reports, Maintenance and Equipment Compliance cards (`documentAccess.js:269`).

Re-check: `grep -n "document_assignments" api/companydata.js`. **Merge-gated:** closed once `claude/assignments-ui` is merged AND `docs/schema/document-assignments-migration.sql` is applied live (verification queries `:65-70`).

### #46 — `sites.division_id` has no writer, so "a division owns sites" never takes effect
**Status: CLOSED in code on branch `claude/assignments-ui` (`e8ccde0`); not marked merged. Re-verified 2026-10-06. Needs `sites.division_id` live (same migration as #45, `?`).** Opened 2026-10-06.

*Original finding (kept for history):* the actor's site set reads `sites.division_id` and no handler wrote it, so tagging a supervisor with a division widened their scope to nothing.

*Evidence it is closed:* `set_site_division` (`api/companydata.js:1426-1444`) is Owner or founder only (`:1365`), checks the site belongs to the company (`:1429`), validates the division with `sanitizeDivisionIds` (`:1433-1435`, `null` clears) and writes `sites.division_id` company-scoped (`:1437`). The "Sites by division" selector is `src/CompanyStructureManager.jsx:88-104`. The reader is unchanged and now has a writer: `documentAccess.js:139-147`. `delete_division` still needs no site cleanup (FK `on delete set null`, `document-assignments-migration.sql:71`), and now also refuses (409) while an active assignment names the division (`companydata.js:1342-1346`). Real check: `grep -n "division_id" api/companydata.js` returns `:1216,1217,1229,1381,1383,1437,1442` (run 2026-10-06 against the committed head; `:1216` is a comment).

*Remaining gap, not a break:* a site created after divisions exist (`add_site`, `companydata.js:1468`) or by onboarding (`server-lib/onboardingApproval.js:293`) has no division until the Owner sets one. The screen only shows the selector when divisions and sites both exist (`CompanyStructureManager.jsx:88`).

Re-check: `grep -n "division_id" api/companydata.js`. **Merge-gated:** closed once `claude/assignments-ui` is merged and the column exists live.

### #47 — Company Portal supervisor reads are department-only; rule A never runs on Portal records
**Severity: medium, silent. Status: FIXED in PR #199 (branch `claude/portal-reads`, commit `d92db3f`), draft, NOT merged, so not marked closed. Approved by Dillon 2026-10-07 (add site and author scoping to Company Portal supervisor reads). Re-verified in code 2026-10-07.** Opened 2026-10-06.

**What changed (read in code on the branch):** `api/portal.js` now imports `scopeRecords, requireRecordScope` (`:38`). `list_portal_records` still picks documents by the supervisor's own departments (`:759-763`) and then runs `scopeRecords` over the records (`:779`, a 503 from a failed read is passed through `:780`). `get_portal_record_detail` keeps the department check (`:818-826`) and then `requireRecordScope` (`:831`) with the same generic "Not allowed." as before. `loadManageableRecord` (`:1109`, now selects `site_id, submitted_by_roster_id` `:1111`) calls `requireRecordScope` after the department check (`:1125`), so `update_portal_record` (`:1135`) and `delete_portal_record` (`:1182`) only touch a record the supervisor could have listed. `email_portal_record` does the same (`:1353`, record select carries `site_id, submitted_by_roster_id` `:1340`). Rule A is `recordInScope` in `server-lib/documentAccess.js`: author, one of the supervisor's sites, or an author sharing a department or division; the Owner and the founder bypass (`scopeRecords` `:368-379`, `requireRecordScope` `:382-388`, `actor.bypass` `:374`). Guard: `tests/unit/portal-supervisor-scope.test.js` through the real handler, run 2026-10-07 with `node --test`: 5 pass, 0 fail.

**Earlier halves, unchanged:** worker menu (`menuAccessFor`, `portal.js:485`), and no Portal `view` row, by prevention: `isAssignableAction` refuses `portal_<n>` view (`documentAccess.js:65-69`, comment reworded in PR #199) and so does the migration CHECK (`docs/schema/document-assignments-migration.sql:55`). Portal stays submit-assignable only. A `view` row is deliberately not consulted for Portal reads.

**Deliberately unchanged by #47 (not breaks):**
- **Dillon's decision, 2026-10-07: Portal escalations, scheduled Portal digests and `email_portal_record` recipients stay department-routed BY DESIGN** (recorded in section 5). The first bullet and the digest paragraph below are that decision, not open questions.
- Portal **escalations** stay department-routed, by `portal_escalations.target_department`, not by the source record's site or author (`list_escalations` `portal.js:1028-1072`; the comment at `:1019-1027` is the reason: an escalation exists to reach a different department than the document it came from). A supervisor with that department sees the flag with `site_name` and `submitted_by` of the record (`:1056-1070`) even if rule A would hide that record. Deliberate.
- `get_crew_documents` still has no Portal source (W-L3).
- Department routing stays as the first narrowing; rule A narrows further. A supervisor with no department tag sees no Portal documents at all; one with no site or division tags sees records they authored (`documentAccess.js:16-17`).

**Still open on the Portal read side, none of them rule A reads of a record body (verified 2026-10-07):**
- **Department digests and one-off email ignore rule A on the recipient side.** `gatherRecords` (`server-lib/portalReports.js:87-103`) picks records only by document department and date, signs a 7-day PDF link, and mails every department supervisor (`portalReports.js:131`, scheduled by `api/cron-portal-reports.js`, or `send_report_schedule_now` `portal.js:1316`). A supervisor scoped to one site therefore receives PDF links for other sites' records in that department. `email_portal_record` gates the *sender* by rule A (`:1353`) but the recipients are department supervisors, not scope-checked. This is routing by department on purpose (the digest is a department's inbox), the same shape as escalations. **DECIDED 2026-10-07 (Dillon): department-routed by design**, scheduled digests and `email_portal_record` recipients included; not narrowed per recipient. Recorded in section 5. Not a break, do not re-raise.
- **Assignment completion is company-wide, not scoped.** `get_assignment_rollup` (`portal.js:964-1027`) reads `portal_records` for the visible documents with no rule A (`:994-995`) and returns assignee name, due date and status, never record content. Not a record read, rule A does not apply. The Brain's assignment-health line does the same company-wide (`server-lib/portalSignals.js:107-109`, aggregate counts per department). Fine.
- **Counts and analytics inherit the fix.** The Overview Portal panel, Site Activity, Recent Activity and Portal Analytics sub-tab all compute from the client's `portalRecords`, which is the `list_portal_records` response (`src/Dashboard.jsx:3461-3464`), so a scoped supervisor's counts and charts are now scoped too and no longer match the Owner's. Expected, not a break. Anything that counts `portal_records` server-side in `companydata.js` / `platformOverview.js:231` is company-wide totals for the Owner or founder, outside supervisor reads.
- **Brain flagged-answer signals** are written at submit (`portal.js:608`), company-wide by design, carry no worker or answer value (see section 2, Brain).
- **`list_portal_documents_for_dashboard`** (`portal.js:359-370`) returns the whole company's document list (title, departments) to any supervisor, not department-filtered. Metadata only, no records. Unchanged, low.

Re-check: `grep -n "scopeRecords\|requireRecordScope" api/portal.js` (expect `:38,779,831,1125,1353`). **Closes when** PR #199 is merged.

### #48 — Rule A has a side door: corrective actions show what the document lists hide
**Severity: medium, silent, and it defeated the narrowing a customer just set. Status: FIXED in PR #200 (branch `claude/corrective-scope`, commit `61044ae`), draft, NOT merged, so not marked closed. Re-verified in code 2026-10-07.** Opened 2026-10-06.

**Fixed earlier:** the `get_worker_profile` half (`api/companydata.js:973-985`, view rows plus rule A, rows stamped with the profiled worker as author `:973`). Verified 2026-10-08: the inspection row set selects no `site_id` (`:932`), so it is placed by author only, same as the list (section 5).

**What changed (read in code on the branch):**
- New `server-lib/correctiveActionScope.js`. `DOC_KEY_BY_SOURCE` (`:12-17`) maps `monthly_answer` to `monthly`, `incident` to `incident`, `near_miss` to `nearmiss`, `equipment_inspection` to `inspection`; anything else is `'unknown'` (`:19`). `resolveActionSource` (`:27-65`) finds the source record's `site_id` and author, always inside the action's own `company_id` (incident / near miss `:38-43`, inspection `:44-48`, monthly answer through its record and a form-company check `:49-63`); a failed read returns `{ error: true }`.
- `list_corrective_actions` (`api/monthly.js:713`) still reads the company's actions and enriches them, now carrying `source_author_id` (monthly `:828`, incident / near miss `:842`, inspection `:870`; `site_id` was already there), then filters through `listVisibleRecordsMulti` keyed by `docKeyForSource` with `siteKey: 'site_id'`, `authorKey: 'source_author_id'` (`:900-903`). A refusal passes through (`:904`); the internal author id is stripped before the response (`:905`). Patterns are built from `visible.records`, not the full set (`:910`). The Owner and founder see everything.
- `update_corrective_action` (`:915`): a supervisor's action is loaded with `source_type, source_id` (`:926`), company-checked, a missing id and another company's both answering 403 "Not allowed." (`:928-929`), then `requireActionAccess` (`:931-932`). An action whose source cannot be found, or whose type is unknown, is placed by neither site nor author, so only the Owner and founder can touch it (`correctiveActionScope.js:67-79`). A 403 answers a generic "Not allowed." (`:78`).
- Guard: `tests/unit/corrective-action-scope.test.js` through the real handler, re-run 2026-10-08 with `node --test`: 7 pass, 0 fail (Owner sees all including an orphan, supervisor sees only openable sources, author id never in the response, update refused / allowed, a missing id reads 403 like a denied one, patterns carry no text from actions the caller cannot see).

**Read side verdicts (checked 2026-10-07, every reader of `corrective_actions` in `api/`; `grep -n "corrective_actions" api/*.js` finds only `monthly.js`, and `maintenance.js` has a comment at `:277` and no query):**
| Reader | Verdict |
|---|---|
| `list_records` `open_actions` / `resolved_actions` (`monthly.js:541,559`) | OK. Counts are keyed to `records`, which already went through `listVisibleRecords` (`:529-530`), so a scoped supervisor only counts actions on records they can see. |
| `get_record_detail` actions (`monthly.js:593`) | OK. Gated first by `requireRecordsAccess` on the record (`:581-582`); the actions returned are that record's own. |
| `maintenance.js` | Does not read corrective actions. The repeat-offender list reaches the maintenance screen through `list_corrective_actions` (`monthly.js:889-910`), not from here. |
| Brain | Not a reader: corrective actions emit no signals, on purpose (section 5). |
| Analytics, Overview "open actions" | Fed by the `list_corrective_actions` response (`src/Dashboard.jsx:2692,2727`) and the scoped `list_records`, so a scoped supervisor's counts shrink with their lists. Expected, as with Portal under #47. |
| `recurrence` object on each shown action (`monthly.js:887`) | Numbers only (`count`, `openCount`, `firstSeen`, `lastSeen`), annotated at `:887` over the whole company history on purpose (comment `:880-883`): a pattern is a property of the machine, not the viewer. **Deliberate residue, counts only:** a supervisor's visible action can show a count that includes actions they cannot see. Carries no text. |
| `equipmentPatterns` (`monthly.js:910`) | OK since `0cacb6f`: `patternsByEquipment(visible.records)`, so `sampleDescription` (`recurrence.js:134`) can only come from an action the caller may see. The Owner and founder see all. Was filed as weak point #50, now closed. |
| Early return when the company has no actions (`monthly.js:~722`) | Returns `{ actions: [] }` with no `equipmentPatterns`; the client defaults it (`Dashboard.jsx:2692`). Harmless. |

**Deliberate residue (not breaks):** (1) recurrence counts on a visible action still count the whole company history (counts only, above). (2) Equipment-inspection actions are placed by author only, because `inspections` carries no `site_id` (`correctiveActionScope.js:44-48` returns `site_id: null`; `api/logs.js:132` comment), so a supervisor sees a failed-inspection action only if they or someone sharing their department or division authored the inspection, never by site. (3) An orphan action (source deleted, unknown type) is Owner and founder only.

Re-check: `grep -n "requireActionAccess\|listVisibleRecordsMulti" api/monthly.js` (expect imports `:15-16`, list `:900`, update `:931`); `node --test tests/unit/corrective-action-scope.test.js`. **Closes when** PR #200 is merged.

### #50 — Machine repeat-offender cards showed finding text from records a supervisor cannot open (CLOSED in code 2026-10-08, `0cacb6f` on PR #200, not merged)
Was built from the full company set (`patternsByEquipment(enriched)`). Now `equipmentPatterns: patternsByEquipment(visible.records)` (`api/monthly.js:910`), the same set as `shownActions`, so a group's `sampleDescription` (`server-lib/recurrence.js:134`) can only be an action the caller may open. Cost, accepted: a scoped supervisor's maintenance screen counts only the repeats they can see. Guard: `tests/unit/corrective-action-scope.test.js` last test, 7 pass. Re-check: `sed -n 908,911p api/monthly.js`. Closes when PR #200 merges.

**Weak link, not numbered (client half fixed in `e8ccde0`; the server half remains): the assignment grace window trusts a client-supplied time.** `queuedAsOf` returns `body.queuedAt` only when a `clientSubmissionId` is also present (`documentAccess.js:84-87`), and `clampAsOf` bounds it to `GRACE_MS = 48h` (`:48,90-97`); it is used on submit only (`:246`; every submit handler passes `queuedAsOf(req.body)`, e.g. `flhas.js:283`, `logs.js:369`, `portal.js:557`). A handcrafted request carrying both fields can therefore be judged as of up to 48 hours ago, so a worker whose assignment ended inside that window can still submit. Reads and the lookups (`check_equipment`, `get_active_form`, `list_open_toolbox`) take no `asOf`. The real client now sends the time (`src/offlineQueue.js:209,257-263`; every form, see the `body.queuedAt` row in §2), so a legitimate offline replay is judged as of when it was filled in. **Stale comments:** the header still says the client side "ships with the worker-menu change; until then asOf is always now" (`documentAccess.js:30-31`) and `queuedAsOf`'s doc says it ships "in PR 2" (`:83`); both are now untrue. Intent, per the file, is a server-signed "opened at" stamp (`:81-82`); not built.

**Verified 2026-10-08 (was `?`), read-only pass, no code change:** (1) **Analytics.** `Dashboard.jsx` `loadAll` (`:2683-2694`) feeds every Analytics input from list actions that all pass through `listVisibleRecords` / `listVisibleRecordsMulti`: FLHA `flhas.js:612`, near miss and incident `reports.js:481`, inspection, toolbox and daily `logs.js:781`, monthly records `monthly.js:529`, corrective actions `monthly.js:900`, custom documents `customforms.js:764`, fuel `fuellogs.js:326`. The client only filters by `company_id` (`Dashboard.jsx:4070-4077`), so the narrowing is server side. A scoped supervisor's Analytics totals shrink with their lists. Expected, same as Portal under #47. (2) **Maintenance status** (`Equipment Analytics` `maintenanceStatus`, `maintenance.js:139`) is the one input that is not narrowed: it reads every inspection and fuel reading for the company to compute due, overdue and current reading (`:195-240`) and returns equipment labels, numbers and the equipment's own service log, never inspection text. Equipment reference data, supervisor and admin only, behind the Maintenance module, so not a break. (3) **Brain.** Not a supervisor view and not scoped per viewer. `runCompanyBrainSummary` is a cron (`api/cron-company-brain-summary.js:39`) that writes one `company_profiles` row per company. The only reads are `get_company_profile` (`companydata.js:2337`, company scoped, returns industry, equipment summary, terminology notes and hazard emphasis, used as prompt context by the forms, `companyProfile.js:15`) and the founder-only Brain tab in `AdminPanel.jsx`. Company-wide by design. **Residual to decide, not filed:** the profile is built from every signal in the company, so a supervisor limited to one site gets prompt context learned partly from sites they cannot open. It is paraphrased emphasis and terminology, not records. Left as is unless Dillon says otherwise.

## Known pending links (intentional, not breaks)

A producer with no consumer **yet**, where the consumer is a scheduled phase
of work. A later sweep must not file these as new breaks. Each has an exit
condition; when it is met, promote the entry to a real break if the consumer
is still absent.

### P1 — `platform_events` has no reader (Admin Panel, planned phase 3c)
**Status: CLOSED by slice 3c (2026-09-29). The reader exists (`server-lib/platformOverview.js` `loadPlatformOverview`, `platformHealth.js` `buildPlatformHealth`, `PlatformDashboard.jsx`), see the "Pending link P1, CLOSED" note under #41.** Original status, kept for history: pending by design, recorded 2026-09-29. Not a break, not approved
for a fix, nothing to build now.** Writers exist at eight call sites (§2,
`platform_events` section); the migration is written and **not applied live**
(`docs/schema/platform-events-migration.sql:36-37`), so until Dillon applies it
every `recordPlatformEvent` insert fails quietly. That is safe: the writer
logs and swallows the error (`server-lib/platformEvents.js:64-67`) and never
fails the cron, email or AI call it measures.

*What a customer loses today:* nothing. Only the founder is affected, and only
in that he cannot yet see platform health.

*Exit condition:* the Admin Panel phase 3c reads the table. If a sweep runs
after that ships and `grep -rn "platform_events" src/ api/` still shows only
the writer, promote this to a break.

*Re-check:*
`grep -rn "platform_events" src/ api/ server-lib/` (reader appears as a
`from('platform_events')` with `.select`), and confirm the table exists live
before trusting any dashboard number.

### P2 - `roster.divisions` has no consumer (owner-profile step 3, 2026-09-30)
**Pending by design, recorded 2026-09-30, branch `claude/step3-owner-profile`. Not a break,
nothing to build now.** Divisions are written (`api/companydata.js:1004-1007`, onboarding
`server-lib/onboardingApproval.js:294-311`) and shown on the profile
(`companydata.js:1216-1228`), and nothing filters, routes or reports by them. The file says
so on purpose (`server-lib/companyStructure.js:5-9`). *What a customer loses today:* nothing
promised; the UI lets an Owner tag people with a division and nothing happens as a result, so
the first customer to ask "what does division do" gets no answer. *Exit condition:* a later
step makes Portal routing, Analytics or reports divisions-aware; if a release ships with
divisions still unread, promote to a break. Re-check:
`grep -rn "divisions" api server-lib src | grep -v "companydata.js\|companyStructure\|onboardingApproval\|WorkerProfileDrawer\|CompanyStructureManager"`
(only `Dashboard.jsx:3551`, the profile save, should appear). Migration
`docs/schema/owner-profile-migration.sql` applied live: **? not verified by this pass.**

**Update 2026-10-06 (branch `claude/assignments-enforcement`): the first consumer exists.**
`server-lib/documentAccess.js:105,138,260` now reads `roster.divisions` (division audience on an
assignment row, and rule A's shared-division test). The re-check grep above will therefore also list
`documentAccess.js`; add it to the exclusions. Division-owned sites are not wired: see #46. This
entry stays open until #46 and #45 are decided, because the consumer reads a table nothing writes.
**Update 2026-10-06 (branch `claude/assignments-ui`, `e8ccde0`): #45 and #46 now have writers, and divisions are consumed in three places: audience match (`documentAccess.js:171`), the site set via `sites.division_id` (`:139-147`, written by `set_site_division`, `companydata.js:1437`), and the Owner screen (`assignmentAdmin.js:101,136`). Treat P2 as CLOSED once that branch merges and the migration is live. Add `assignmentAdmin.js` to the re-check grep exclusions.**

### P3 - the offline queue does not send `queuedAt` yet (document assignments PR 2, 2026-10-06)
**Status: CLOSED on branch `claude/assignments-ui` (`e8ccde0`), 2026-10-06; merge pending.** Exit condition met: the client now sends it. `queuedAtFor` (`src/offlineQueue.js:209-211`) returns the queue entry's `createdAt` while that entry replays (`:257-263`, cleared in a `finally`), and all ten request builders pass it: `src/App.jsx:46`, `CustomForm.jsx:34`, `DailyReport.jsx:40`, `FuelLog.jsx:36`, `Incident.jsx:126`, `Inspection.jsx:87`, `MonthlyInspection.jsx:35`, `NearMiss.jsx:54`, `PortalDocumentForm.jsx:70`, `ToolboxTalk.jsx:37`. Real check: `grep -n "queuedAtFor" src/*.js*` lists all ten plus the definition and imports. The server consumes it at the seven handlers (`flhas.js:283`, `logs.js:365`, `reports.js:216`, `monthly.js:291`, `customforms.js:566`, `fuellogs.js:164`, `portal.js:558`) through `queuedAsOf` and `clampAsOf` (`documentAccess.js:84-97`). Not read by this pass (`?`): whether any component has a second submit path besides the builder line above. Still true: `get_active_form` (`customforms.js:519`) and `get_active_portal_document` (`portal.js:508`) evaluate as of now by design, and a handcrafted request can still reach back 48h (weak link under #48). Original text: the offline queue did not send `queuedAt`; a form filled offline was judged at sync time and a 403 from a row created in between dropped it for good (`documentAccess.js:24-26`).

### P4 - `document_notifications` and `notifyRouting` have eight callers across seven document types plus custom forms, and no writer (notification routing, 2026-10-07)
**STATUS: CLOSED 2026-10-07 by PR 5, branch `claude/notify-owner-toggle`, `6afe46b` (PR #194; closed on the branch, merge pending).** The promote conditions were both checked and neither fired: the toggle shipped, the writer exists (`server-lib/notifySettings.js:73`, `api/companydata.js:1422-1429`, `src/NotificationSettings.jsx:42`), and every key it offers has a caller (offered = `WIRED_DOCUMENT_KEYS` built-ins plus custom forms, `notifySettings.js:17`; those are exactly the keys `notifyAudience` accepts, `notifyAudience.js:24,26`; Fuel Log was removed in #193). Remaining weak points from the toggle are W-N10 and W-N11 in the §2 notification section (W-N11 is the switch that cannot be turned off after its document is switched off). Re-check: `grep -rn "document_notifications" api src server-lib | grep -v "^server-lib/notifyRouting.js"`. The older updates below are history.
**Update 2026-10-07, branch `claude/notify-wire-monthly-custom`, `c9d0049` (PR 4, PR #193): Monthly Inspection (`api/monthly.js:500`) and custom documents (`api/customforms.js:733`, `custom_<formId>`, label from the form title) now call `notifyAudience`.** Both sit behind their doc-key gate and assignment check (W-N2 holds). **One document is now the only unwired key in `DOCUMENT_LABELS`: `fuellog`** (`notifyRouting.js:93`, also in the table CHECK, `document-notifications-migration.sql:35`; `grep -n notifyAudience api/fuellogs.js` is empty). The earlier "six of eight" counts above treated monthly and custom as the remaining two and did not count Fuel Log; that is a miscount in this map, corrected here. Promote condition (unchanged): when PR 5's toggle ships, if Fuel Log still has no caller, this becomes a break, since an Owner could be offered a switch for a document that never notifies. Decide before PR 5 whether Fuel Log is wired or removed from `DOCUMENT_LABELS` and the CHECK. Still pending: the Owner toggle (PR 5).
**Update 2026-10-07, branch `claude/notify-wire-flha-logs`, `1ebc5ec` (PR 3): FLHA, equipment inspection, toolbox and daily now call `notifyOnSubmit`** through the shared `server-lib/notifyAudience.js` (moved out of `api/reports.js`, which now imports it). Callers: `api/flhas.js:515` (submit when not sign-later) and `:572` (sign_now); `api/logs.js:689` (submit for inspection, toolbox, daily; inspection only when not sign-later) and `:755` (inspection sign_now); incident and near miss unchanged in `api/reports.js:392,456`. All six sit behind `requireDocKey`. Inspections are passed no site (they carry none). Still pending: monthly and custom forms (PR 4, no call in `api/monthly.js` or `api/customforms.js`; a custom form will need `documentLabel`, W-N3) and the Owner toggle that writes `document_notifications` (PR 5). Until PR 5 no company can switch it on, so the six callers send nothing. Promote condition unchanged: promote to a break if the toggle ships and `monthly` or `custom_<n>` (both in `DOCUMENT_LABELS`) still has no caller. The older PR 2 update below is superseded where it says "two callers".
**Earlier update (PR 2), 2026-10-07, branch `claude/notify-wire-incident-nearmiss`, `1475b5e` (PR 2): incident and near miss now call `notifyOnSubmit`** through `notifyAudience` in `api/reports.js` (`:151-170`; called after submit when not sign-later, `:422-428`, and after `sign_now`, `:488`; gated by `requireDocKey` first, `:304,467`). Still pending: FLHA, inspection, daily, toolbox (PR 3); monthly and custom forms (PR 4); the Owner toggle that writes `document_notifications` (PR 5). Until PR 5 no company can switch it on, so the two live callers send nothing. Not a break; the promote condition below is unchanged. PR #190 (digest cron, branch `claude/notify-digest-cron`) is not merged and is not described here. The paragraph below is the original PR 1 entry and its "no caller" wording is superseded for incident and near miss only.
**Pending by design, recorded 2026-10-07, branch `claude/notify-routing-core`, `d4487d2`. Not a break, nothing to build now.** The audience rule (`server-lib/notifyRouting.js:129-173`), the loaders (`:176-237`), the cooldown (`:279-307`) and the sender (`:316-354`) exist (re-anchored at `1488a5b`), and nothing calls any of them (`grep -rn "notifyRouting\|notifyOnSubmit\|routeNotification" api src server-lib` outside the file is empty). There are now two tables, `document_notifications` (`:26-36`) and `document_notification_state` (`:48-55`, the cooldown, `1488a5b`). Both are about to be applied live and **neither is confirmed applied** (`docs/schema/document-notifications-migration.sql:3`, `?` live state for both). The module treats a missing settings table as "off" (`notifyRouting.js:184`), so today nothing is emailed and nothing errors; a missing state table with a document switched on sends nothing (`:322`, W-N4). *What a customer loses today:* nothing promised; no screen offers the switch. *Exit condition:* PR 2 (incident, near miss), PR 3 (FLHA, inspection, daily, toolbox) and PR 4 (monthly, custom) call `notifyOnSubmit`, and PR 5 adds the Owner toggle that writes `document_notifications`. Promote to a break if the callers ship and the toggle does not (a company could then never turn it on), or if the toggle ships and a document type in `DOCUMENT_LABELS` (`notifyRouting.js:70-79`) has no caller. Weak points W-N1 to W-N6 are in the §2 section. Re-check: `grep -rn "notifyOnSubmit" api` (callers), `grep -rn "document_notifications\|document_notification_state" api src` (writer), and confirm BOTH tables live before trusting a toggle.

### #42: The dashboard's seat cap is not the copy that enforces the cap
**Severity: low** (founder-facing, no customer loses anything today, values agreed).
**Status: BUILT and approved by Dillon, closed pending merge of its PR (branch
`founder-dashboard-business`, `c1a9266`), same convention as #37-#41.** Opened 2026-09-29
against `d4217e7`. Do not mark merged until the PR is.

**As found:** the Seats card judged "near cap" with `planSeatCap`, while the cap that blocks
a company adding people was a separate `SEAT_CAP_BY_TIER` in `api/companydata.js`. Both said
`basic: 10, advanced: 50`, so nothing was wrong, but change one and the dashboard would
misreport silently. They also disagreed on an unknown tier: enforcement fell back to basic,
the dashboard reported no cap (`planSeatCap` returns null).

**What was built** (read 2026-09-29 at `c1a9266`):
| Piece | Where |
|---|---|
| One source | `server-lib/onboardingHelpers.js:90` `PLAN_SEAT_CAPS`; `:101-103` `effectiveSeatCap` = `planSeatCap(tier) \|\| PLAN_SEAT_CAPS.basic`, never unlimited |
| Enforcement | `api/companydata.js:12` imports it; the local table is gone (comment `:217-219`); called at the four sites `:362,392,457,582` |
| Dashboard | `server-lib/platformBusiness.js:21` import, `:105` `effectiveSeatCap(c.plan_tier)`, so the Seats card reports what enforcement uses |
| Test | `tests/unit/seat-cap-source.test.js` (5 tests): unknown, null and undefined tiers are basic (`:16-22`); no server file defines its own table (`:30`); both consumers call `effectiveSeatCap` and companydata has exactly four `effectiveSeatCap(tier)` sites (`:36-41`); the Admin Panel display copy equals `PLAN_SEAT_CAPS` (`:55-57`) |

*Evidence:* the display-copy test was shown to fail with `PLAN_SEAT_CAPS.advanced` changed to
60, then restored (run by the builder and reported to this map, not re-run by this pass).

**Deliberately left, do not re-file:**
- `api/admin.js:355` still uses `planSeatCap` (import `:11`). The onboarding preview needs to
  know whether a tier is real, which is the null answer `effectiveSeatCap` hides.
- `src/AdminPanel.jsx:56` `SEAT_CAP_BY_TIER` (used `:230,771,1297`) stays a copy, because
  client code cannot import server code. It is now pinned to `PLAN_SEAT_CAPS` by the test
  at `seat-cap-source.test.js:55-57`, so a drift fails a test instead of showing a wrong count.

**Re-check:** `grep -n "SEAT_CAP_BY_TIER\|PLAN_SEAT_CAPS" api/*.js server-lib/*.js` shows one
definition (`onboardingHelpers.js:90`); `src/AdminPanel.jsx:56` is the pinned client copy.

**Weak points on slice 3b, recorded, not filed** (each works as coded, the number means less
than its label):
1. **"Payment at risk" mostly cannot fire for the worst statuses.** `canceled`, `unpaid` and
   `incomplete_expired` all set `suspended = true` (`api/stripe-webhook.js:46,86`) and
   `buildBusinessMetrics` drops suspended companies before anything is summed
   (`platformBusiness.js:62`). The card says "past due, unpaid or canceled"
   (`PlatformDashboard.jsx:79`), but in practice only `past_due` and `incomplete` land there
   unless someone un-suspended the company by hand. A cancellation removes the company
   from MRR without ever showing as at risk. Churn is not measured here.
2. **Hand-created companies inflate the estimate.** `create_company` turns all 13 doc keys on
   (`api/admin.js:565`), so every one counts as owning every module at list price and lands
   in "Not billed via Stripe" (`platformBusiness.js:177`).
3. **Logins are PIN logins only**, same source as #41 weak point 1 (`login.js:444`), and
   they drive 30 of 100 points (`platformBusiness.js:138`).
4. **Health thresholds are a judgment call, not measured against churn.** Document
   recency cutoffs 7/14/30 days worth 40/30/15/0 (`:129-132`), logins as the share of active
   workers seen in 7 days times 30 (`:138`), adoption times 20 with 10 when nothing is
   measurable (`:142-145`), payment 10 billed, 5 no subscription, 0 at risk (`:148-150`),
   bands 70/40 (`:52-56`), under 14 days unscored (`:32`), near cap 80 percent (`:33`).
   Dillon should tune these against real accounts. Companies with no `plan_tier` are unpriced
   and counted separately (`:166,180`).
5. **Trial to paid is deliberately absent.** Checkout has no trial. `trialing` counts as
   billed (`:28`) only because Stripe can report it.
6. **Truncation** carries over from #41 weak point 3: rows come through the same 20000-row cap
   (`platformOverview.js:235-238`).

### #44: An auto-generated company code can contain characters the login page rejects
**Severity: medium for the one company it hits, silent. Status: OPEN, not approved.** Opened 2026-10-06 by the pass that placed the company-code login.

`find_company` only accepts `[A-Z0-9-]`, 6 to 32 characters, and answers any other code with the same "wasn't recognized" 401 (`api/login.js:104-105,518,527`). The two founder-typed writers run `normalizeCompanyCode`, which enforces exactly that shape (`api/admin.js:52-55,541,602`). The onboarding auto-generator does not: `codePrefix` takes the first three characters of a one-word name, or the first letters of up to three words, with no character filter (`server-lib/onboardingApproval.js:66-72`), and the code is inserted unchecked (`:177-194`). A company whose name starts with an apostrophe, bracket or accented letter gets a code its staff can never type successfully. Nothing errors; the claim page and Admin Panel show the code and tell staff to type it (`src/ClaimAccount.jsx:174,194`, `src/AdminPanel.jsx:1433`).

*Evidence (real output, the generator's `codePrefix` copied verbatim, suffix `ABCDE`, tested against the login regex):* `O'Brien` gives `O'BABCDE` false; `Étoile Haulage` gives `ÉHABCDE` false; `(1) Ltd Co` gives `(LCABCDE` false; `Acme Corp` gives `ACABCDE` true. Re-check: `grep -n "codePrefix\|normalizeCompanyCode\|shapeOk" server-lib/onboardingApproval.js api/admin.js api/login.js`; it is fixed when the generator filters to `[A-Z0-9]` (or runs the same validator) before the clash check.

**A fix would touch:** `codePrefix` (strip non `[A-Z0-9]`, fall back to `CO`), one line, plus a unit test; existing bad rows are repaired by the founder through `update_company_codes`. Needs a yes.

**Not verified (`?`):** whether any live `companies.company_code` is shorter than 6 characters or contains other characters. The login floor moved from 3 to 6 (`api/login.js:104`, `2724f83`) and `normalizeCompanyCode` has always required 6, but a legacy row typed before that rule would be unfindable. One query settles it: `select name, company_code from companies where company_code !~ '^[A-Za-z0-9-]{6,32}$'`.

## 4b. The recurring shape: a key written and never read

Three of the breaks closed in PRs #119 and #120 turned out to have the same
underlying failure, and **each one was introduced by the fix for the break it
belonged to**. Check this before assuming a join key works.

| Column | Written by | Read by, until | Surfaced while closing |
|---|---|---|---|
| `equipment_id` | inspections, always | nothing — the weekly report grouped on the text label | #7 (PR #119) |
| `site_id` | PR #118, all five field forms | nothing — every list payload SELECTed only the text | #2 (PR #120) |
| `submitted_by_roster_id` | PR #118, every submit path | **nothing at all**, anywhere | #8 (PR #120) |
| `daily_reports.equipment_ids` | 2026-09-17 fleet branch, both submit paths | **nothing at all**, until `42ed3c7` — now Fleet Overview's "last on site" (`companydata.js:872` → `Dashboard.jsx:6063-6065`) | #13, caught before merge; built 2026-09-23, closes when the branch's PR merges |
| `roster.employee_id` | `8916156`, three roster write paths (`companydata.js:409,471,534`) | nothing but its own badge on the roster row (`Dashboard.jsx:7091-7093`) | **deliberately not filed** — unlike every row above it, no consumer exists that *should* be reading it (FORA has no HRIS surface). See §2 |
| `create_company`'s `warning` (a response field, not a column) | `c30d995`, `api/admin.js:433` | **nothing**, for exactly one commit — `src/AdminPanel.jsx:624-626` read `data.error` only, on `!res.ok`; `965d812` made it `:634` | #22, **written and read in consecutive commits** — the one instance in this table caught before merge rather than after months |

The pattern: a fix adds a column, validates it on write, backfills it, and
stops. The read side — the `select(...)` list, the aggregator, the display —
still uses whatever it used before. **Nothing fails.** No error, no failing
test, no log line. The column fills up with correct data that no feature ever
looks at, and the break the column was added to close stays open while the
changelog says it is fixed.

**So when a change adds a join key, the check is not "is it written and
validated". It is:**

1. Which `select`/`listColumns` must now include it? (A column absent from
   the list payload does not exist as far as the frontend is concerned.)
2. Which aggregator or grouping function should key on it instead of the
   text it replaces?
3. Is there a comment somewhere explaining why two things *cannot* be joined,
   written back when the key did not exist? Comments do not get re-read when
   the facts under them change — `src/analyticsUtils.js` carried exactly such
   a comment through break #2's entire first half.
4. Does a test pin the new key's behaviour, or only the old one's?

**PR #121 added two more variants, and they are the mirror image.** 4b is
about a key nobody reads. These are about a reader whose *producer* never
wrote:

| What | Consumer | The producer that never wrote it | Surfaced while closing |
|---|---|---|---|
| `results_json.items` | `correctiveActionsFromInspection`, `inspectionFindingSignal` | the **post-trip** half of `src/Inspection.jsx` | #10 (PR #121) |
| `linkedPretrip.results_json` | `src/generateInspectionPDF.js:197` | `resubmitInspection`'s payload, which passed three scalars | #12 (PR #121) |
| `item.unit === "trailer"` | `src/generateInspectionPDF.js` (pre-fix `:53,129`) | `src/Inspection.jsx`, which now writes `"attachment"` | #16, caught and fixed before merge |
| `item.attachmentId` | `attachmentForItem` (`inspectionAttachments.js:53`), `unitKey` (`generateInspectionPDF.js:16`), and since `bb13340` `itemAttachment` (`correctiveActions.js:471`) | `buildPosttripItems` — **now writes it** (`src/Inspection.jsx:393`) | #17 — producer fixed on `main` before `363da23`; consumer added in `bb13340` |

So the check in both directions is the same one question: **for every field a
consumer reads, is there more than one code path that produces the record —
and does every one of them set it?** A feature with two entry points (a
pre-trip and a post-trip; a live submit and an offline drain) is where this
hides, because the case somebody tested works perfectly.

Two related instances, same family:
- **The guard that went stale.** `tests/unit/brain-signal-capture.test.js`
  asserted writers and `bySourceType` agree, from a **hardcoded list of
  writers** — so it went out of date the moment a writer was added, which is
  the exact failure it existed to catch. It now scans `api/`.
- **The invariant that was only a comment.** Break #6's doc-key ↔ module
  rule was stated in prose in `server-lib/pricing.js` and checked by nothing.

## 5. Deliberate non-connections

Do **not** flag these. They are decisions, not gaps.

- **Assignments and supervisor scope do not cover Equipment Reports, Maintenance, Time
  Clock, Certifications or Equipment Compliance, and Equipment Inspection is placed by
  author only.** `ENFORCED_BUILTIN_KEYS` lists the eight document types whose handlers call
  `requireAssignment` (`server-lib/documentAccess.js:50-60`); a row on any other key would
  hide a card while the handler answered (the #21 shape), so the assignment screen must not
  offer them. `inspections` has no `site_id` (`api/logs.js:125-131`), so only the author rule
  can place it. Dillon's scoping for the branch, 2026-10-06. Corrective Actions are **not** in this list: they follow their source record's scope (#48, PR #200).

- **A crew lead can fill in for a crew member on a Daily Report and a Fuel Log only,
  and cannot restrict anything.** `resolveOnBehalf` is called from exactly two
  places (`api/logs.js:378`, daily only, other types answer 400 at `:377`;
  `api/fuellogs.js:174`), because the other documents carry a personal signature and
  a signature is a legal act by the person (`server-lib/leadAccess.js:66-69`). A lead's
  tasks are always `restricts: false` for one named crew member
  (`api/companydata.js:1504-1508`); only the Owner restricts a document (`:1375-1377`).
  Dillon's design for the lead role, 2026-10-06. What is NOT deliberate and is filed as a
  weak point instead: `entered_by_roster_id` shown to no supervisor and absent from the
  Daily PDF (W-L2). The hide-unassigned bypass through a lead's task (W-L5) is closed.
- **Portal escalations, scheduled Portal digests and `email_portal_record` recipients are department-routed, by design.** Dillon's decision, 2026-10-07. An escalation exists to reach a different department than the document it came from (`api/portal.js:1019-1072`, `list_escalations`); the digest is a department's inbox (`server-lib/portalReports.js:87-103,131`, `api/cron-portal-reports.js`, `send_report_schedule_now` `portal.js:1316`); `email_portal_record` checks the *sender* with rule A (`:1353`) and sends to department supervisors. A supervisor scoped to one site can therefore receive a flag or a PDF link for another site's record in their department. Not a break, do not re-raise (#47).
- **A lead's crew view leaves out Portal documents and corrective actions.**
  `get_crew_documents` has no `portal_records` or `corrective_actions` source
  (`api/customforms.js:444-482`). Recorded as W-L3, not as a break: Portal supervisor reads
  reads are outside rule A (corrective actions, #48; Portal was #47, now inside rule A, PR #199). Both supervisor-side reads are now inside rule A, so the lead omission is the only gap left, as W-L3 says.
- **An auditor cannot be shown an equipment inspection, a record with no site, a Portal document or a corrective action, and never writes anything.** The auditor's reach is documents placed by `site_id` (`api/audit.js:106,118,128`); `AUDITABLE_BUILTIN_KEYS` omits `inspection` (`server-lib/documentSources.js:26`) because `inspections` has no site (`api/logs.js:125-131`), and the list has no Portal or corrective-action source. Dillon's scoping for the auditor role, 2026-10-06 (A-W1, A-W4). What is NOT deliberate and is filed as a weak point: custom forms ignoring their own on/off setting (A-W6).
- **An auditor reaches no other endpoint, by design.** Thirteen `verifySession` copies return null for `role === 'auditor'` (the list is in the Auditor section); an auditor therefore also has no `AccountSecurity` screen (A-W3) and no session-based authenticator change. Not a missing link.
- **Auditors do not count toward the seat cap and are never sent a bulk setup link.** `companydata.js:379,424,490,614,621,786`; their link goes out with their access, which starts the 14 day window.
- **Custom documents emit no Brain signals, and Portal answer values and
  worker names stay out of the Brain.** Dillon's call 2026-09-17, reconfirmed
  2026-09-29. Portal itself now feeds the Brain, metadata only
  (`api/portal.js:608`, `server-lib/portalSignals.js:29`), so
  "Portal emits nothing" is no longer true and is not the rule (`grep -n
  "source_type:" api/portal.js` returns `:608`). Portal assignment health only
  reaches the profile for a company that also hits the 5-new-signals gate
  (`companyBrainSummary.js:217-226`); that is by design.
- **Portal is not in Safety Analytics, its PDF, or the Safety tab.** Portal is
  its own product with its own departments; it gets its own Analytics sub-tab
  (`src/Analytics.jsx:445-449`) and joins only Overview Site Activity
  (`src/Dashboard.jsx:4278-4282`). Decided with #40, 2026-09-29.
- **Company Portal is not in `server-lib/pricing.js`.** Known and unchanged
  (`grep -n "portal" server-lib/pricing.js` returns nothing, 2026-09-29). The
  Portal tab rides `roster_enabled`; the department-report cron gates on it
  too (`api/cron-portal-reports.js:36-39`).

- **Gatehouse is gone, not a non-connection.** Removed 2026-09-30 by
  Dillon's decision (it belongs in a separate project). Do not file its
  absence as a missing link. `companies.app_type` was dropped by
  `docs/schema/company-name-login-migration.sql:16` (`b2044ee`, run after
  deploy); `grep -rn app_type api src server-lib` returns nothing, 2026-10-06.
- **Equipment Inspection makes no AI call.** It is checklist-driven, so it
  correctly does not import `companyProfile.js`. "7 of 8 generators" in
  CLAUDE.md counts AI-calling generators; Inspection is the 8th form, not
  a missing integration. (It *should* still emit a Brain signal — that was
  break #4, closed in PR #118, and extended to post-trips by #10 in PR #121.)
- **`equipment_id` is null for free-text machines.** Intentional
  (`maintenance.js:5-7`). Never "fix" this by matching on label.
- **RLS has no policies.** Deny-by-default backstop by design (README).
- **`website/` is a separate Vercel project.** Cross-project coupling to
  `api/checkout.js` is documented in README and is not a break.
- **Admin Panel is founder-only.** Not a customer surface — see
  `admin-access-copy-guard`.
- **A RETIRED machine's id still resolves on submit.** `resolveEquipmentId(s)`
  (`equipmentScope.js:42,80,119`) deliberately does not filter `retired_at`. A
  worker's report can sit in the offline queue for days; if the machine was
  retired in the meantime, rejecting the id would 403 the submit. **What that
  403 costs changed in `48d5889` and the rule did not:** `drainQueue` used to
  have no drop path, so one 403 wedged that worker's entire queue forever; it
  now **drops** a permanent 4xx (`src/offlineQueue.js:252-263`), so the same
  403 would delete that worker's inspection outright instead. Still the wrong
  outcome for a machine somebody retired, and still `null` — the reasoning
  lives in the code at `equipmentScope.js:32-39` and `siteScope.js:35-38`.
  There is still **no attempt cap**, deliberately (`offlineQueue.js:215-218`):
  a cap punishes a worker who was offline for a week, so only the server
  saying "never" drops anything. Same reasoning as break #2's follow-up. Do
  not "fix" this by adding a retired check.
- **Four groups of actions are ungated on purpose, as of `48d5889`.** The
  wallet's five self-service actions (`certifications.js:390,400,414,423,434` —
  the roster is platform base, and gating them would stop a company without
  cert tracking onboarding anyone), `list_corrective_actions` /
  `update_corrective_action` (`monthly.js:681,865` — polymorphic since break
  #5, so gating on `monthly` would hide a company's incident follow-ups),
  every admin-only action (`docKeyGate.js:113` — the founder is on the other
  side of the paid boundary), and `create_upload_url` in all five handlers
  (it runs before the record type is known; the submit that would use the file
  is gated). Full reasoning in §2's `document_key` section. **Do not file
  these as #21 leftovers.** #23 and #25 were the real leftovers; #23 is closed
  (`d4b8aa3`) and #25 is built (`f955ad9`).
- **Five time-clock actions are ungated on purpose, as of `ac80f96` — Dillon's
  decision on #23, 2026-09-22.** `clock_out` and `my_time_status`
  (`companydata.js:1503,1524` at `42ed3c7`): a shift open when a company drops Time Clock +
  GPS must always be closable, and the clock-out screen needs `my_time_status`
  to find it. `list_time_entries`, `list_time_reports` and `get_time_report`
  (`:1543,1651,1676` at `42ed3c7`): recorded hours are payroll records and stay readable
  after cancelling. Reasoning in the code at `:1473-1483`, pinned by
  `tests/unit/timeclock-gate.test.js:156,161,170,176`. **Do not file these as
  #23 leftovers** and do not "make them consistent" with `clock_in`. Their
  *UI* reachability once the module is off was #27, built in `98f9d70`: the
  worker's card and the supervisor's tab now call them read-only when the
  module is off (`WorkerMenu.jsx:137-150,272-273`, `Dashboard.jsx:2830,3299-3324`
  at `42ed3c7`).
  The answer there was never to gate these, and still is not.
- **No longer a limit: a company without Time Clock can page back through
  every past week on its read-only tab** — the current-week-only residual
  recorded at `98f9d70` is fixed by `b0411b1`, merged in `363da23`
  (Dillon approved it): `weekStart` is sent (`Dashboard.jsx:3045`), paging at
  `:6679-6696`, and visibility keys off `latestEntryAt`
  (`companydata.js:1663-1674` → `Dashboard.jsx:3315`) rather than this week's
  entries. **Still deliberate:** the final partial week never becomes a
  *report* once the module is off, because the cron and
  `generate_time_report_now` (`companydata.js:1699`) stay gated — its hours
  are readable as entries, which is what was asked for. Do not file "no final
  report at switch-off" as a break without a product decision that it is one.
- **`list_records` and `companyEquipmentIndex` include retired machines on
  purpose** (`maintenance.js:373-377`, `equipmentScope.js:80-88`). A service
  history or a vetting index
  that drops the machines you no longer own is not a history or an index.
  Break #15 is about `list_status` and the three compliance surfaces only, and
  its fix (PR #123) deliberately left all three of these alone.
- **`equipment_ids` is not editable on a submitted daily report**
  (`api/logs.js:620-625`). The supervisor edit corrects the free-text summary;
  the ids record what the worker actually picked in the field. Deliberate.
- **A post-trip has no attachment picker.** What was hooked up is recorded on
  the pre-trip, and the post-trip reads it from there
  (`generateInspectionPDF.js:223`, `equipmentreports.js:343`). Not a gap.
- **"Used" stays trip-derived and attachments are credited, not metered.** See
  breaks #1 and #18 — the credit is deliberate. Its absence from PM was #18 and
  is now built for trailers (towed KM); for every other attachment it is now
  deliberate — see the next bullet.
- **A non-trailer attachment has no preventative-maintenance clock, by design.**
  Dillon, 2026-09-23, rescoping #18: *"Attachments won't get a preventative
  maintenance log, unless it's a trailer. Things like loader forks don't require
  preventative maintenance."* Forks, buckets, hammers and the like are
  inspected, not serviced on a clock: `pmAllowedFor`
  (`server-lib/fleetActivity.js:88-91`) says no, `list_status` reports
  `not_tracked` even over a legacy interval (`api/maintenance.js:216-222`),
  `set_equipment_pm_interval` refuses a new one (`api/companydata.js:1273-1275`,
  clearing is always allowed), and the Maintenance screen says so instead of
  offering set-up (`src/Dashboard.jsx:6559-6561`). Their defects still open
  corrective actions against the attachment (#17) and their repairs still land
  in its maintenance log. **Do not file "attachments never come due" as a
  break.** The one real gap near this line was #28 — a *trailer* the fleet row
  doesn't flag, which is the opposite case; built `1301c76`, closes with PR #129.
- **A trailer's PM clock ignores trips towed on an hour meter.** Hours are not
  distance (`fleetActivity.js:108`, pinned by
  `tests/unit/fleet-activity.test.js:79`). Weekly Hours does credit those hours
  to the trailer; that is Weekly Hours' own quirk, not a PM gap. (A trip towed
  by a **free-text** machine is different and is #29.)
- **`fleet_activity` is not module-gated.** Fleet Overview is BASE (#19), and
  every source it reads is the company's own record, so a company without Daily
  Reports gets no last-on-site lines rather than a refused screen
  (`api/companydata.js:849-856`). Supervisor/admin only (`:858`),
  company-scoped (`:859,863-866`). Do not file it as a #21 leftover.
- **Fleet Overview is BASE and has no module.** Dillon's call, 2026-09-18
  (`2560819`): the fleet list is reference data every other module joins to,
  like Analytics and SOPs, not a document type a company buys. Its write actions
  (`companydata.js:903,952`) are ungated to match. Break #19's Compliance half
  was the real gap and is closed; do not re-open the Fleet half.
- **Custom forms default ON while built-in keys default OFF.** Opposite on
  purpose (`customforms.js:324` vs `:342`, `:384` vs `:387`), pinned by
  `tests/unit/doc-setting-defaults.test.js`. A built-in key is bought; a custom
  form was built by this company's own admin, here, and denying it by default
  would hide a form from the person who just created it. "Making them
  consistent" is the most likely way this comes back. **Server-side the same
  split holds as of `f955ad9` (#25):** `requireCustomDocKey`
  (`docKeyGate.js:152-167`) is allow-by-default next to `requireDocKey`'s
  deny-by-default — do not merge the two.
- **A switched-off custom document drops a queued offline submission, on
  purpose.** Dillon's call on #25: "refuse and tell them". `submit_custom`
  answers 403 (`customforms.js:522-526`), and a 403 is the offline queue's
  permanent-rejection signal (`src/offlineQueue.js:194,252-263`), so the entry
  is removed and the worker is told why. A failed settings lookup is 503 and
  keeps it. Do not "fix" this by holding the entry.
- **The wallet invite shows the ticket card when it cannot tell.**
  `certificationsEnabled: null` (settings lookup failed, `api/login.js:883-884`)
  keeps the card (`src/WalletInvite.jsx:304`); only an explicit `false` hides
  it. The upload is still refused server-side if the company has not bought
  the module (`certifications.js:143,160`). Deliberate (#24).
- **Photo and tickets are skipped for anyone who goes through authenticator setup.**
  The "extras" stage (photo, tickets) is only reached on `stage:'session'`
  (`src/WalletInvite.jsx:121-126`). A role that needs an authenticator gets
  `stage:'enroll'` and is redirected to the login page's setup
  (`:114-118`, `api/login.js:879-881`), and someone who already has one gets
  `stage:'signin'` (`:119`, `login.js:878`). Neither sees the extras. Deliberate
  per the 2026-09-30 brief: the session only exists after the second factor,
  and a half-signed-in person must not reach the certifications API. They add a
  photo and tickets later from "My Certifications". Do not file as a break.
- **`pin_link_open` does not return `certificationsEnabled`.** Only the session
  stage does (`api/login.js:884`). Nothing on the PIN step needs it.
- **A setup link replaces a PIN, never the second factor.** Opening it for
  someone with `totp_enabled` resets the PIN only (`api/login.js:878`); the
  authenticator stays. Deliberate (comment `:689-690`).
- **The setup link is emailed to the address on file, and a supervisor's link is
  never handed to someone else.** `handBack` is founder or worker only
  (`api/companydata.js:734`, `:519`). A supervisor or Owner with no email cannot
  be sent one until an address is added (`:735`).
- **Company creation emails at most 25 links** (`setupLinks.js:18`), Owner
  first; the rest show "No setup link sent" and are a "Send setup link" click
  away (`onboardingApproval.js:148-151`). Deliberate, to keep approval off email latency.
- **People with no email still get typed PINs on the claim page**
  (`src/ClaimAccount.jsx:184`). A link needs a mailbox to prove.
- **`roster.employee_id` is read by nothing, on purpose.** It is a join key for
  a future HRIS sync; there is no internal consumer that should be reading it
  today. See §2 and §4b.
- **A paid `portal_scope_requests` row never becomes an `onboarding_requests`
  row or a `companies` row automatically.** `notifyPortalScopePaid`
  (`api/stripe-webhook.js:53-78`) marks the scope row `paid` and notifies
  Dillon by Slack/email — that's the whole handler. Confirmed by reading it:
  no `.from('onboarding_requests')` or `.from('companies')` call anywhere in
  the file. Company Portal engagements are hands-on builds (document
  collection, the actual build) that Dillon picks up manually once payment
  clears — CLAUDE.md's "Client scoping pipeline (Ted)" section says so in
  as many words. Do not file the missing auto-handoff as a break. Worth
  revisiting only if/when Portal becomes a real checkout-purchasable module
  (`server-lib/portalScopePricing.js:11-13` names that as the trigger) —
  at that point a paid scope creating a **draft** `onboarding_requests` row
  Dillon still has to approve (same pattern §1's writer table already uses
  for every other provisioning path) would be a legitimate opportunity, not
  a mandate to auto-create a company outright.
- **Company Portal phase 2's named deferrals — status after phase 4.**
  `portal_documents.departments` having no reader, and
  `list_portal_records`/`get_portal_record_detail` having no
  `Dashboard.jsx` UI, were deferrals at the phase-2 pass and were built by
  phase 3 (see §2's `roster.departments` and `portal_documents.id` entries
  for the file:line evidence). **Assignment rules (`portal_assignment_rules`)
  were the last of the phase-2 deferrals list and are now built by phase 4
  (2026-09-29, `company-portal-phase-4-assignment-compliance`** — see §2's
  new `portal_assignment_rules.id → portal_assignments` entry). `portal_documents.category`
  still has no reader (§2's `portal_documents.id` entry) — unaffected by
  phase 4. Escalation (`portal_escalations`, `escalation_department`/
  `escalation_trigger_value`) was the only remaining phase-2 deferral after
  phase 4, and is now built (2026-09-29,
  `company-portal-phase-5-escalation`, PR #150) — see §2's
  `portal_questions.escalation_department`/`portal_escalations` entry. This
  closes the phase-2 deferrals list entirely: `departments` (phase 3),
  assignment rules (phase 4), and escalation (phase 5) are all now
  consumed by something. `portal_documents.category` remains the one item
  on that original list still without a reader — do not file it as a
  break; nothing ever named a future phase as its job. Do not file
  escalation's own notification gap here either — it's a phase-5-specific
  finding, tracked as break #34, not a "not yet built" deferral. **Break
  #32 (Portal submissions missing from My Forms) is different** — nothing
  names it as a future phase's job, which is why it's filed and these
  aren't; phase 5 doesn't touch `MyDocuments.jsx` or `get_my_documents` at
  all, so it stays exactly as recorded at the phase-3 pass, not
  re-verified as new (§4's break #32 entry). Company Portal still missing
  from `server-lib/pricing.js`'s `MODULES`, and the Portal dashboard tab
  (now including the phase-4 Assignments and phase-5 Escalations sub-tabs)
  riding `roster_enabled` instead of a doc key, is also not a new item
  here — it's the same open flag carried from the phase-1 entry, not a new
  one.
- **Phase 4's targeting deviation: no department-based ("group")
  assignment targeting, by design.** The build spec's assignment-rule
  targets are "role/group/individual/everyone"; this codebase built
  `target_type` in `('everyone', 'role', 'individual')` — no `'group'`/
  department option — because `roster.departments` (phase 1) is written
  only on supervisor-tier rows (`api/companydata.js:864-865` forces it to
  `[]` on any worker row), so a department-targeted rule could never reach
  a worker, the wrong default for a feature whose whole point is putting
  paperwork in front of the people doing the work. Recorded in the
  migration's own header comment
  (`docs/schema/company-portal-phase4-migration.sql`) as worth reopening
  if a real customer needs department-scoped assignment once workers gain
  some equivalent grouping. Do not file the missing `'group'` target type
  as a break — it's a considered scope decision, not a silent gap.
- **The build spec's "Company Admin" role does not exist in this codebase,
  by Dillon's explicit 2026-09-29 decision — do not go looking for it.**
  This app has exactly two customer-facing roster roles, `worker` and
  `supervisor` (`admin` is founder-only, see `admin-access-copy-guard` and
  `server-lib/docKeyGate.js`'s admin-exemption comment). Phase 3's
  department-intersection scoping (§2's `roster.departments` entry) means
  a supervisor-tier roster row with every one of the 5
  `PORTAL_DEPARTMENTS` checked already sees every Portal document
  unfiltered, which satisfies the build spec's "Company Admin sees
  everything" requirement without a new role, table, or column. Confirmed
  by grep: no `company_admin` string anywhere in `api/portal.js`. A future
  pass should not assume a `company_admin` role was built somewhere else
  in this phase or a later one just because the build spec names one.

### The founder dashboard (Admin Panel > Platform) is deliberately not gated by a company doc key

Verified 2026-09-29 against `cb9908a`. `platform_overview` has no
`requireDocKey`/`docKeyGate` call (`api/admin.js` never references the gate;
the action sits at `:127-134` behind the handler-level check at `:112`, which
answers 403 to anything but a `role: 'admin'` session, minted only for the
`ADMIN_CODE` login, `api/login.js:1335-1341`). A company must not be able to
switch off the founder's own view of the platform, so a missing
`company_document_settings` row here is data to count, not a gate to obey.
`tests/unit/platform-overview.test.js:121-127` pins the 403 for worker,
supervisor, missing and garbage tokens, and `:138` pins that no other
`server-lib` file imports `platformOverview.js` (it takes a service-role client
and reads across companies). Do not file "ungated surface" against it. Also
deliberate: Preventative Maintenance and Equipment Compliance report `not
measurable` (`platformOverview.js:22-25,46,146,154`, rendered
`PlatformDashboard.jsx:149`) because they read other documents and file none
of their own; Custom Document and Company Portal filings count toward activity
(`:37-38`) but toward no module (`docKey: null`), consistent with Portal not
being in `pricing.js`. Slice 3b (`d4217e7`) has since added MRR, seat usage and
health scores. Its MRR deliberately excludes Company Portal engagements, Custom
Builds, which are priced outside `pricing.js` (Gatehouse was also outside it until its removal on 2026-09-30)
(`platformBusiness.js:9-11`, note string `:181`); do not file that as a missing
revenue link. `platformBusiness.js` is pure and imported only by
`platformOverview.js` (`platformOverview.js:18`, pinned by
`tests/unit/platform-business.test.js:157-165`). A trial-to-paid metric is absent on
purpose because checkout has no trial. Churn is not measured (see #42 weak point 1).

### Workforce-category custom documents appear in no Analytics panel, by Dillon's 2026-09-29 decision

Do not file "workforce custom docs never reach Analytics" as a break, and do not
propose a Workforce analytics view. Dillon decided 2026-09-29 to leave them out of
every customer Analytics panel. Re-check: only two panels exist,
`SafetyAnalyticsPanel` (`src/Analytics.jsx:132`) and `EquipmentAnalyticsPanel`
(`:331`). `Dashboard.jsx` mounts them with `companySafetyCustomDocs` (`:6627`) and
`companyOperationsCustomDocs` (`:6659`). `companyWorkforceCustomDocs` (`:4005`) is
read only by the Workforce Custom Docs list tab (`:6434`). `src/analyticsUtils.js`
takes a `customDocs` argument (`:149,158`) and never sees a category. `grep -in
workforce src/Analytics.jsx src/analyticsUtils.js` returns nothing.

---

## 6. Changelog

| Date | Commit | Change |
|---|---|---|
| 2026-09-16 | `0bd289c` | Map seeded. 18 surfaces, 7 join keys, 8 breaks found and verified. |
| 2026-09-16 | PR #118 | Break #1 **half** fixed: `api/maintenance.js` now reads `fuel_logs` readings alongside inspection readings. The weekly-equipment-report half stays open. An earlier version of this row claimed the whole break was closed; that was wrong and was caught by `interaction-break-hunter`. |
| 2026-09-16 | PR #118 | Break #4 partially fixed: equipment inspections and monthly site inspections now emit Brain signals. Daily reports, custom documents and corrective actions remain unwired. |
| 2026-09-16 | — | Break #9 added (post-trip defects never reach Equipment Analytics). Break #7's wording corrected. |
| 2026-09-16 | PR #118 | Break #9 fixed: Equipment Analytics counts both trip types and its copy says so. Also fixed a blank-label bucket in the same function, found by a test. |
| 2026-09-17 | PR #118 | Break #5 fixed: corrective actions now open from incidents, near misses and Defective inspection items. Two migrations applied. Surfaced a live regression (NOT NULL ahead of its code) and a gap with no home yet (worker-logged routine service, scoped in `docs/scope-equipment-service-log.md`). |
| 2026-09-17 | PR #118 | Worker-logged equipment service built (`docs/scope-equipment-service-log.md`). Not a break — a gap with no home. |
| 2026-09-17 | PR #118 | Break #2 fixed: `site_id` on all five field forms, backfilled 89% of history. Two map errors corrected in the process — the forms already had dropdowns, and `delete_site` was failing outright rather than orphaning. |
| 2026-09-17 | PR #118 | Break #2 follow-up: fixing `delete_site` made a dangling `site_id` reachable, which permanently wedged the offline queue (`drainQueue` `break`ed on any throw, with no attempt cap **and no drop path** — the drop path arrived on 2026-09-22 in `48d5889`, which changes what a 403 costs there from "wedges the queue" to "deletes that one record"; there is still no attempt cap, deliberately). A missing site now stores a text-only record. **A fix for one break created a fault in another — exactly what this map exists to catch, introduced while closing a break.** |
| 2026-09-17 | PR #118 | Break #3 fixed: `submitted_by_roster_id` stamped server-side on all nine document tables, with anonymous near misses structurally protected. |
| 2026-09-17 | — | **PR #118 merged.** Six migrations live. |
| 2026-09-17 | PR #119 | Break #7 fixed: weekly equipment reports group by fleet id, with free-text rows reconciled by label. No migration. |
| 2026-09-17 | — | `linked_inspection_id` recorded as a weak link (unvalidated client-supplied foreign id, inert today). Found by `tenant-scope-reviewer` while verifying `afee546`. **Not being worked** — it needs a decision on missing-id semantics and on offline pre-trip ids, not a copy of `equipmentScope.js`. |
| 2026-09-17 | PR #120 | Break #8 **closed**, as a reviewer signal rather than a gate — gating was both incomputable (no cert→task mapping) and the wrong behaviour (it would block safety paperwork). Found a third "producer nothing consumes": `submitted_by_roster_id` was written by every submit path and selected by none. |
| 2026-09-17 | PR #120 | Break #6 **closed**: the doc-key ↔ module invariant is a test now, not a comment. No application code changed — the lists already agreed; nothing guaranteed they would keep agreeing. |
| 2026-09-17 | PR #120 | Break #4 **closed**: daily reports now emit a `daily_report` signal carrying working conditions only (fixed-vocabulary weather + parsed temperature). Custom documents and corrective actions excluded on purpose. The writers-vs-counters guard was itself stale and now scans `api/` instead of hardcoding a list. |
| 2026-09-17 | PR #120 | Break #2 **closed**: `site_id` now survives the read boundary (five list payloads were dropping it) and the analytics site tables key on it. Two tables kept on purpose. |
| 2026-09-17 | PR #120 | Break #1 **closed**: the weekly report's ending reading now reads fuel logs too, via reading helpers moved into `server-lib/readings.js` so maintenance and the report share one definition. "Used" stays trip-derived by definition, recorded as a boundary rather than a gap. |
| 2026-09-17 | PR #119 (`afee546`) | `equipment_id` ownership validation added (`server-lib/equipmentScope.js`), found by `tenant-scope-reviewer` on the break #7 diff. Making a column load-bearing exposed that nothing validated it: `api/logs.js`'s inspection submit never checked it, and `attachedTrailer.id` can't be checked on submit at all. **A second instance of the #2 pattern — closing a break turned a dormant column into a live dependency.** Nothing leaked; the trap was closed before a reader existed to spring it. |
| 2026-09-17 | PR #121 | Breaks **#10, #11 and #12** found and closed, all from one live report: a pre-trip flat tire that the post-trip never mentioned. #10 — a post-trip's `results_json` had no `items`, so the helper every consumer shares opened an action for a defect at the start of a shift and silently nothing for the same defect at the end. #11 — nothing could close an equipment action from the field or record the repair. #12 — pre-existing on `main`: **every post-trip PDF ever produced** printed "Pre-trip checklist not available." because the caller passed three scalars where the generator reads a whole record. |
| 2026-09-17 | PR #121 | New join key: `(machine, item_key)` on `corrective_actions`, reusing break #7's two-key machine space. One reducer (`server-lib/recurrence.js`), two callers, per break #1's lesson. Migration **written, not applied** — deliberately all-nullable so it is safe in either deploy order, which is break #5's NOT-NULL-ahead-of-its-code lesson encoded in the schema rather than a comment. |
| 2026-09-17 | PR #121 | Surface #15 re-homed. Corrective Actions was a sub-tab of Monthly Inspections **gated on `isDocActive("monthly")`** — so a company on inspections + maintenance without monthly site inspections had corrective actions being created and unreachable. A gating bug hiding inside what looked like a navigation complaint. |
| 2026-09-17 | PR #121 | Section 4b extended: the same silence has a mirror image — a consumer reading a field one of its two producers never wrote. Both PR #121 variants are that shape, and both hid in a feature with two entry points. |
| 2026-09-17 | PR #122 | Fleet management. Four new keys mapped: `equipment.is_attachment` (a flag replacing `isTrailerTemplate`'s guess from the make/model text), `equipment.retired_at`, `daily_reports.equipment_ids`, and the `equipment_compliance` table. New jsonb shape `results_json.attachments` replaces the single `attachedTrailer`; both are live at once and read through one normaliser (`server-lib/inspectionAttachments.js`), because legacy records are signed documents that cannot be migrated by rewriting rows. |
| 2026-09-17 | PR #122 | **#16 found and fixed on the branch**, by `pdf-consistency-reviewer`. `generateInspectionPDF.js` grouped checklist items by `unit` alone, so a new-shape attachment item (`unit: 'attachment'`, not `'trailer'`) would have printed under a "TRUCK / TOW VEHICLE" banner, and a truck with a pup and a trailer would have merged both into one group named after whichever came first. The info box said MACHINE/ATTACHMENT while the body of the same page still said TRUCK / TOW VEHICLE — the document disagreed with itself. Grouping keys on `attachmentId` now. **A data-shape change breaking a consumer nobody thought of as a consumer.** |
| 2026-09-17 | PR #122 | Breaks **#13, #14, #15, #17 and #18 opened, none worked.** #13 and #14 are §4b again (`equipment_ids` read by nothing; compliance dates visible on one screen). #15 is new and introduced by retirement itself: `list_status` and the compliance list read `equipment` directly, so a sold machine keeps a live PM clock and a live expired CVIP. #17 and #18 are pre-existing and only now addressable — an attachment's defect opens an action against the host machine, and an attachment can never come due for service. |
| 2026-09-17 | PR #122 | Surfaces 19–22 added and the Equipment hub re-mapped: Maintenance and Fuel Logs stopped being top-level tabs, and `TAB_VISIBLE.equipment` went from `equipmentReportsEnabled` to `true`. **Break #19 opened** — Fleet Overview and Compliance are `on: true` with no `BUILTIN_DOC_KEYS` entry and no `server-lib/pricing.js` module, which is break #6's expensive direction: a feature no module sells ships to every company free. Filed as a decision for Dillon, not a defect; the code states a rationale and nothing in the repo records an approval. |
| 2026-09-17 | PR #122 | Break #7's root cause **half closed**: `activeUnitNumberClash` (`companydata.js:127-145`) enforces unit-number uniqueness among ACTIVE machines on add, edit and un-retire. Blank unit numbers still collide, and a machine still needs only one of make/model/type. Two statements in break #7 corrected — `update_equipment` exists now, and after a rename Weekly Hours shows the old label while Maintenance Records shows the new one. |
| 2026-09-17 | PR #122 | Not an interaction break, recorded because it was found by the same sweep: `api/login.js`'s roleless roster **ticket** — minted after the company code, before any PIN — was accepted as a full session by every `verifySession` in `api/`, since a ticket has no `userId` and every copy short-circuits on that. The endpoints scoping by company rather than by role answered it for a 7-day TTL. Every verifier now rejects a payload carrying `purpose`. Found by `tenant-scope-reviewer`; the comment in `login.js` asserting this could never happen was the thing that made it invisible. |
| 2026-09-18 | PR #122 | **#14 built, not closed** — approved by Dillon, both halves: a `compliance_summary` action (`companydata.js:941`) feeding an overview banner (`Dashboard.jsx:4841`), and a compliance section snapshotted into `report_json` at build time (`equipmentreports.js:377,593-618`) and rendered on the weekly equipment report (`reportPdfs.js:142`). The 30-day window and the doc-type names moved out of `Dashboard.jsx` into `server-lib/compliance.js` so the browser, the API and the PDF answer from one definition — copying a threshold onto the server to close a §4 break would have opened the next one. Snapshot-at-build rather than live-at-render is deliberate: the PDF is cached on first view, so "live" would mean "live for whoever opened it first". **Shipping this makes #15 more visible, not less** — a retired machine's expired CVIP now reaches the banner and the weekly PDF, because filtering it here alone would make three surfaces disagree. No migration, no doc key, no pricing module (#19 untouched). Marked closed only when #122 merges. |
| 2026-09-18 | PR #122 (`d91fcb6`) | **#14 closed on merge.** Nothing further was built — this row records the state change the map had been carrying as "built, not closed" since the row above it. The compliance banner and the weekly report's compliance section are live for every company that tracks an expiry date. |
| 2026-09-18 | PR #123 | **#15 built, not closed** — approved by Dillon, including the product call the map had left open. Retirement now means *operationally gone, historically present*: `list_status` filters `retired_at`, and the three compliance surfaces (tab list, `compliance_summary` banner, weekly report snapshot) drop a retired machine's rows through **one** shared rule in `server-lib/equipmentScope.js` rather than three copies — the break was that counts and lists must agree, so three separate filters would have been the same bug in a new shape. #14's comment claiming `compliance_summary` deliberately does not filter was stale the moment this landed and was removed, not left. **The three readers that were already correct stayed correct** and now have tests saying so: `list_records`, `companyEquipmentIndex`, and especially `resolveEquipmentId(s)`, where a "consistency" fix would 403 a submit from a worker whose report sat in the offline queue while the machine was retired and wedge their queue forever (§5, break #2's follow-up). No migration, no `src/` change, no new `api/` file, no doc key (#19 untouched). Marked closed only when #123 merges. |
| 2026-09-18 | `18645f0` | **#15 closed on merge** (PR #123). No further work — this row records the state change the row above carried as "built, not closed". |
| 2026-09-18 | `8916156` | New join key `roster.employee_id` — the employer's own number for a person, for a future HRIS sync. Unique per company across active AND inactive rows (`companydata.js:275-291`, index in `docs/schema/roster-employee-id-migration.sql:58-60`), which is the **opposite** rule to `equipment.unit_number`: a unit number is reused when a machine is scrapped, an employee number is not reused when somebody leaves. Read by nothing but its own badge — §4b's shape, recorded and deliberately **not** filed as a break, because no consumer exists that should be reading it. |
| 2026-09-18 | `edd7a41` | **Built-in document keys flipped to deny-by-default.** A missing `company_document_settings` row resolved as ACTIVE (`customforms.js:323,383`); it now resolves OFF. Custom forms keep allow-by-default on purpose (`:341,386`), pinned by `tests/unit/doc-setting-defaults.test.js`. This is break #6's expensive direction removed from the code rather than from a comment, and it was live: all three companies were running document types nobody had decided to give them. Rows backfilled to each company's exact effective state first, so nothing changed on screen. **Map-wide consequence:** every gated surface's reachability now depends on an explicit row existing, so a ✅ in §3 means the join exists in code, not that the company can reach it. |
| 2026-09-18 | `2560819` | **#19 decided and built.** Compliance half **closed**: new `compliance` module ($20/$45, `pricing.js:98-103`), 13th doc key `equipment_compliance` (`customforms.js:119,734`), and three gates — sub-tab (`Dashboard.jsx:2755,2832`), overview banner (`:4841`) and the weekly report's compliance section, where the query is skipped rather than filtered (`equipmentreports.js:618-625`) because that report is the *Inspections* module's artifact and would otherwise deliver a paid module's output inside another module's document every Monday. `cron-equipment-reports.js:40-48`'s second copy of `isDocKeyActive` still defaulted to active and was brought in step — two copies of one gate disagreeing is how a cron emails a report the dashboard says should not exist. Existing companies backfilled (`docs/schema/equipment-compliance-module-backfill.sql`, applied). Fleet half **decided as BASE**, not a gap — see §5. Doc-key ↔ module invariant re-checked: 13 keys on both sides, in agreement. Closes when PR #124 merges. |
| 2026-09-18 | `2560819` | **Breaks #20 and #21 opened by this pass, neither worked.** #20 — deny-by-default has no provisioning path for a company created outside checkout: `api/admin.js:384-411` writes no settings rows at all and `onboardingApproval.js:211` skips them when `request.modules` is NULL, so a hand-created company now gets **zero** document types, silently, where it used to get all of them. The comment above that condition still asserts the old everything-on default — a comment describing behaviour that shipped away underneath it, which is why the gap is invisible. #21 — module gating is UI-only: no handler in `api/` consults `company_document_settings` except the two weekly-report builders, and the client's `isDocActive` fails open (`Dashboard.jsx:2749`). Pre-existing and cross-cutting; recorded now because a module is sold on that gate for the first time. |
| 2026-09-22 | `c30d995` | **#20 built, not closed** — approved by Dillon, who settled the product question the map had left open: a company that did not come through a checkout gets **everything on, explicitly**, not everything off, because that preserves exactly the pre-`edd7a41` outcome while recording the state as real rows instead of inferring it from an empty table. Both non-checkout paths now write: `api/admin.js:405-409,422-424` (`create_company` captures the inserted id and upserts) and `server-lib/onboardingApproval.js` (the `request.modules` non-empty gate replaced by a ternary, so a NULL or empty list writes an all-on set — the ternary is `:239-241` as of `965d812`; see the #20 entry, whose numbers are re-read against the branch head rather than offset). One definition, `allDocumentSettingsOn` (`pricing.js:255-257`), derived from `MODULE_KEYS` rather than a second copy of the key list — break #1's lesson. Four new cases in `tests/unit/doc-setting-defaults.test.js:92,101,118,127`, one of which reads `BUILTIN_DOC_KEYS` out of `api/customforms.js`'s **source** and asserts the on-by-default set is exactly those 13 keys, and one of which pins that a purchased request still gets only what it bought, so this cannot quietly become "everyone gets everything". 333 unit tests pass. Marked closed only when PR #124 merges. |
| 2026-09-22 | `551fbfd`, `c30d995` | The comment above `onboardingApproval.js`'s settings write has now been rewritten twice — `551fbfd` replaced the text asserting the old everything-on default with a plain statement that the `if` was a gap, and `c30d995` replaced that with a description of the two-branch write. Map entries quoting the old text were stale and are corrected. **A comment is the thing that made #20 invisible in the first place**, which is why its state is tracked here rather than assumed. |
| 2026-09-22 | `6719415` | Follow-on to #20, recorded so the map is not read as behind the branch: a request with a `stripe_customer_id` and no module list now logs a warning before the all-on fallback runs (`onboardingApproval.js:232-237`, unchanged since). That is a Stripe session made outside `api/checkout.js` — `resolveModules` rejects an empty selection, so the handler cannot produce one — meaning a retired Payment Link or a hand-made Dashboard session, which would otherwise be handed every module free and silently. Logged rather than blocked: refusing to provision a company that has already paid is worse than over-granting it. Observational only, but it moved the settings write down the file — #20's entry carries numbers re-read against the branch head, not offsets. |
| 2026-09-22 | `c30d995` | **Break #22 opened by this pass.** `create_company` returns `{ ok: true, warning: … }` when the settings upsert fails (`api/admin.js:433`) and `src/AdminPanel.jsx:624-626` never read it — the founder saw the ordinary success path and would hand over a company with every document type off, which is the one case #20's fix deliberately cannot prevent. §4b's shape applied to a response field instead of a column. Approved and built the same day; see below. #21 re-checked against `c30d995` and **still open, unapproved and untouched**: the only change is that `admin.js` now writes settings rows (`:423`) as well as deleting them; no handler reads one to decide whether an action is allowed. |
| 2026-09-22 | `965d812` | **#22 built, not closed** — approved and built the same day it was opened, one commit after the warning it reads was written. `src/AdminPanel.jsx:634` reads `data.warning` and puts it through the `setMsg` banner already on that screen, after `await loadAll()` so the reload cannot overwrite it. The detail that makes it land rather than look like a success toast: the banner's error/success colouring is a **regex on the message text** (`:1215`, consumed at `:1280`), and the warning contains "could not", so it renders in the danger colours — verified by running that regex against that exact string. That coupling is recorded in the #22 entry as a thin thread (a reword could silently turn the alert green) but not filed, since the string and the regex are in view of each other. `onboardingApproval.js:245-255` still handles the same failure with `console.error` and no human — same outcome, no response field to drop, left open deliberately. **The one §4b instance in this map written and read in consecutive commits** instead of sitting in the product for months. Closes when PR #124 merges. |
| 2026-09-22 | `48d5889` | **#21 built, not closed** — approved explicitly by Dillon ("Build #21"), full server-side gating including the worker submit paths. Built in three steps, in the only order that was safe. **(1) The offline queue got a drop path first.** `drainQueue` caught every failure identically (`markAttempt`, `break`) with no drop path, so one permanently-rejected item wedged that worker's whole queue for that form type forever — survivable only while nothing on the server rejected a well-formed submit permanently, which a module 403 does, stably. A 4xx is now dropped and **reported** in the new `dropped` array (`src/offlineQueue.js:194,243,252-263`), following the `pdfUnlinked` precedent; 401/408/425/429, 5xx, network failures and anything with no status keep the stop-and-preserve-order retry. All ten resubmit functions attach `err.status`, and `WorkerMenu.jsx:386-407` tells the worker what went nowhere and why. **There is still no attempt cap and that is deliberate** (`:215-218`): a cap punishes a worker who was offline for a week, so only the server saying "never" drops anything — the map's three claims that `drainQueue` has "no attempt cap and no drop path" are half stale and are corrected in §2, §5 and the PR #118 row above rather than deleted. **(2) One shared gate, with the duplicate removed rather than tripled.** `server-lib/docKeyGate.js` is deny-by-default and derives its key→module map from `MODULES` in `pricing.js` (`:33-35`); **both** previous copies of `isDocKeyActive` are deleted and migrated onto it (`equipmentreports.js:17`, `cron-equipment-reports.js:20`), so break #1's duplicate-helper shape is resolved here instead of made worse — this entry's own "a fix would touch" note had warned about exactly that. A hard no is **403**, a failed lookup is **503** (`:117-120` as shipped; `:126-133` after `89ca755` renumbered the file), because a 403 now means DROP to a queued submit and a database blip must not delete a worker's shift. Admin exempt (`:113`). **(3) 41 guards across eight handler files** (`grep -rn "await requireDocKey(" api/ \| wc -l` → 41), listed with their actions in §2, along with what was deliberately left ungated: the wallet's five self-service actions (the roster is platform base), the two polymorphic corrective-action endpoints (gating on `monthly` would hide incident follow-ups), admin-only actions, and `create_upload_url` (it runs before the record type is known; the submit is gated). `npm run test:unit` → **364 pass**, re-run by this pass. Deny-by-default enforced server-side is only safe given the live data: all three companies carry an explicit row for every one of the 13 built-in keys, none missing, none with zero rows — queried against the FORA Supabase project on 2026-09-22 before the push **by the session that built `48d5889`**, not by Dillon; recorded in §2 with its date and its author so the next session re-runs it rather than assuming. (An earlier version of this row credited Dillon. Who ran a check is part of being able to re-run it.) Closes when PR #124 merges. |
| 2026-09-22 | `48d5889` | **Breaks #23, #24 and #25 opened by this pass, none worked, none approved.** #23 — the handlers #21's approved scope did not reach are now gated differently from their neighbours: ten time-clock actions and `set_equipment_pm_interval` (`companydata.js:1423-1616,1214`). *(As first written this entry also covered `api/equipmentreports.js`'s four supervisor-callable actions; `89ca755` fixed those the same day and they are now **#26** — see the row below.)* The sharpest instance: the Sunday cron refuses to build a weekly time-clock report for a company without the module (`cron-equipment-reports.js:85`) and `generate_time_report_now` builds the same report on demand with no such check. `api/timeclockreports.js` is **not** a gap — its handler returns 404 unconditionally (`:77-78`); it is a builder module, recorded because it looks like an ungated endpoint in a file listing. #24 — `src/WalletInvite.jsx:262-300` still renders its "Add a ticket" card for a company without Certification Tracking; the server now refuses it and it fails soft, so a new hire fills in four fields and picks a file before being told. #25 — `custom_<id>` keys belong to no module, so the gate (built from `pricing.js`) does not cover them: `get_active_form` and `submit_custom` (`customforms.js:465,491`) check `custom_forms.is_active` and never `company_document_settings`, while the worker menu filters on it (`:386`). Narrow — custom keys are allow-by-default on purpose and `set_document_setting` is admin-only (`:348`) — and a fix cannot reuse `requireDocKey`, which is deny-by-default and would switch off every custom form with no row. |
| 2026-09-22 | `89ca755` | **#26 built, not closed** — split out of #23 the day both were opened, found by `tenant-scope-reviewer` reviewing `48d5889`. That commit skipped `api/equipmentreports.js` because the file was "already an enforcement point" — true of the compliance section **inside the report body** (`:600`), false of its own four actions. So the cron refused to build a weekly report on Sunday for a company without Equipment Inspections (`cron-equipment-reports.js:66-67`) and that company's supervisor got the same document, PDF and signed URL included, by calling `generate_now` on Monday: two entry points to one artifact disagreeing, **inside the change meant to stop exactly that**. `list_reports`, `get_report` and `generate_now` now gate on `equipment_reports` (`:666,683,714`); `list_weekly_hours` gates on **`inspection`** (`:763`) because it is folded from inspection readings and its sub-tab gates on `inspectionsEnabled` (`Dashboard.jsx:2831`) — the obvious key would have locked out a company that bought Inspections and not the report, which is the one place in this work where the file a handler lives in was not the module it belongs to. Two smaller fixes rode along, both about the offline queue rather than the gate: the cron reported a **failed** settings read as `reason: 'deactivated'`, collapsing "not bought" with "couldn't check" — an outage at 11:59pm Sunday would have cost every company that week's report and blamed the customer in the only trace of it (`readDocKeySetting` is exported now, `:20,66-67,93-94`); and `requireDocKey` answered a non-admin session with no `companyId` with 403, which since `48d5889` means the queue **drops** the submission, so it returns 401 without querying (`docKeyGate.js:112,123`) — not reachable today, a guard against the shape. 368 unit tests pass. Guard count across `api/` is now **45**. Closes when PR #124 merges. |
| 2026-09-22 | — | **Third instance on this branch of one reasoning error, recorded as the lesson rather than as a break:** "that's already handled", applied at the wrong granularity. #12 — the generator read `linkedPretrip.results_json` and its *caller* passed three scalars. #16 — the form wrote `unit: 'attachment'` and one of two consumers still tested `'trailer'`. #26 — a file was an enforcement point for one thing inside it and not for its own endpoints. Each time the sentence was true of something adjacent to the thing that wasn't. |
| 2026-09-22 | `82fa4a2` + `34925b0` | **Every `src/Dashboard.jsx` citation in this map re-anchored — 46 of them, 33 distinct line numbers, against a 7138-line file.** PR #126 rebuilt the supervisor dashboard from a Stitch mockup on `main` (`82fa4a2`, ~673 lines of `Dashboard.jsx`, plus `Sidebar.jsx`, `theme.js`, `index.html`), and this branch merged it forward in `34925b0`. **No offset was applied.** Each claim was re-read in the current file and re-cited where the code it describes actually lives — a diff-derived offset is exactly how a confidently wrong `file:line` gets into a document whose entire value is that a later session can re-check it. Some citations had already drifted *before* #126: `:816,957,3166`, `:1626`, `:1905`, `:3429`, `:4329-4330`, `:4650-4670`, `:5509`, `:5710,5745,5749` and `:6175` all landed on `}}>`, `</div>` or unrelated code at `07795a7` — the branch head the previous map pass was written against — so this was two overlapping drifts, not one. Three citations that were **historical** claims (#19's original finding: "is now `true`", "marks Fleet Overview and Compliance `on: true`") are pinned as `git show ea1c9e1:src/Dashboard.jsx` instead of live line numbers, because the second is false of the file today and a live number would keep asserting it. Zero line-numbered citations to `Sidebar.jsx` or `theme.js` exist in this map — confirmed by grep, not assumed. Two `api/monthly.js` numbers riding on the same claims (`:809`, `:819`/`:838`) were corrected to `:850` and `:860` while verifying them. No application code touched. |
| 2026-09-22 | `34925b0` | **The merge's one conflict was semantic, not structural, and the shape belongs on the map: a rebuild branched before a module existed and silently reverted that module's gate.** #126 was cut from `main` before Equipment Compliance became purchasable, so its version of the compliance alert banner carried **no** `complianceEnabled &&` test and a comment reading *"compliance has no purchasable module (break #19, open)"* — true on the day it was written, and a paid feature given away free on the day it would have merged. Resolved in favour of keeping the gate (`Dashboard.jsx:4841`); the comment now matches the code. **Nothing would have failed.** No test asks "is this banner gated", the stale comment reads as an explanation rather than a contradiction, and the only symptom is a company seeing a module it never bought — break #6's expensive direction arriving through a *merge* instead of through a new feature, which is this map's first instance of it. The check it argues for: when a long-lived UI branch merges, re-verify every module gate inside the files it rewrote, not only the hunks git marked as conflicting. `EQUIPMENT_SUBTABS`' compliance entry was the same risk and did **not** conflict — verified on the merged file as `{ key: "compliance", label: "Compliance", on: complianceEnabled }` (`:2832`), and `isDocActive` still fails open (`:2749`), unchanged and still presentation-only per #21. |
| 2026-09-22 | `82fa4a2` | **One genuinely new interaction arrived with #126.** Both overview alert banners now render through a shared `alertBanner` helper (`Dashboard.jsx:4540`) instead of two hand-copied blocks, and each gained a click-through: "View Certifications" (`:4823`) into the Certifications tab, "View Compliance" (`:4855`) into Equipment ▸ Compliance. An expiry a supervisor sees on the overview is now one click from the screen that fixes it — an increment on the reach break #14 was opened about, not a new break. Both actions are gated on their target tab's own `TAB_VISIBLE` entry; the compliance one resolves to `true` unconditionally and is safe only because the banner around it is `complianceEnabled`-gated, which is recorded in §1. The shared helper also removes the hand-copy that let the two banners drift — the `pdf-consistency-reviewer` shape, in the dashboard. |
| 2026-09-22 | `ac80f96` | **#23 built, not closed** — approved by Dillon, on `claude/modular-pricing-enforcement-rzdib2`. Six new guards in `api/companydata.js`: `set_equipment_pm_interval` on `maintenance` (`:1216`), and `clock_in`, `edit_time_entry`, `add_time_entry`, `delete_time_entry`, `generate_time_report_now` on `timeclock` (`:1438,1530,1562,1590,1639`). The sharpest instance is gone: `generate_time_report_now` now agrees with the Sunday cron (`cron-equipment-reports.js:93`) on who gets a time-clock report. **Two product decisions, recorded in §2's exemption table and §5 so they are never re-filed:** `clock_out`/`my_time_status` stay open so a shift open when the module is dropped can be closed, and `list_time_entries`/`list_time_reports`/`get_time_report` stay open so recorded hours remain readable after cancelling (`:1455,1476,1495,1603,1617`; reasoning `:1425-1435`). Guard count across `api/` **45 → 51** (`grep -rn "await requireDocKey(" api/ \| wc -l`, re-run by this pass; 45 via `git grep` at `57efbeb`). `tests/unit/timeclock-gate.test.js` — 19 pass at `ac80f96`; against a `57efbeb` worktree, **12 fail / 7 pass**, the 12 being exactly the gating cases. `npm run test:unit` → 387 pass. All re-run by this pass. Time-clock punches are still not offline-queued (`TimeClock.jsx:62-64`), so these 403s show on screen rather than dropping a punch. Closes when the branch's PR merges. |
| 2026-09-22 | `ac80f96` | **#27 opened by this pass, not worked, not approved.** #23's two carve-outs are open on the server and unreachable in the product: the worker's Time Clock card is filtered out when the module is off (`WorkerMenu.jsx:247,250`) and the supervisor's Time Clock tab — entries, report list and all — is hidden by `TAB_VISIBLE.timeclock` (`Dashboard.jsx:2793,6567`). So a worker clocked in when the module is dropped has no screen to clock out from, and a cancelled company has no screen to read its hours from; the API would answer both. Not a defect in `ac80f96`, which built exactly the approved server scope — a gap between a decision's intent and its reach. The fix is UI-only and must never be "gate the carve-outs"; see §5. |
| 2026-09-22 | `98f9d70` | **#27 built, not closed** — approved by Dillon ("readable in the app"), UI only, on `claude/modular-pricing-enforcement-rzdib2` (`main` is at `d4b8aa3`, the squash of PR #127, which already carries #23). Worker: with the module off and an open shift, `src/WorkerMenu.jsx:137-150` finds it via `my_time_status` and `:272-273` keeps the Time Clock card, which opens a clock-out-only screen (`TimeClock.jsx:157`) and goes away after. Supervisor: `Dashboard.jsx:3262-3280` probes `list_time_reports` / `list_time_entries` / `my_time_status`, and `TAB_VISIBLE.timeclock` is `timeClockEnabled \|\| timeClockHistory` (`:2805`); every write control is hidden under `timeClockReadOnly` (`:2767,6634,6702,6710,6757,6797,6822,6841`). A company that never used Time Clock gets no tab. No `api/` change, no migration (`git diff d4b8aa3 98f9d70 --stat`). Re-run by this pass: new spec **7/7** at `98f9d70`, **4 fail / 3 pass** against `d4b8aa3` (the 4 behaviour tests); `npm run test:unit` **387 pass**. **Residual limit recorded, not numbered:** the read-only tab shows past reports plus the current week only (`:3020`, no `weekStart`), and the cron (`cron-equipment-reports.js:93-94`) and `generate_time_report_now` (`companydata.js:1639`) are gated, so the last partial week is readable in-app only until it ends; data retained. Also re-anchored §2's stale Sunday-cron row (`cron-equipment-reports.js:40-48,76,99` → `readDocKeySetting` `docKeyGate.js:66-75`, used at `cron-equipment-reports.js:66,93`). Closes when the branch's PR merges. |
| 2026-09-22 | `b0411b1` | **#27's residual limit closed — not a new break, still not closed as a whole.** Approved by Dillon: "let the supervisor page back through past weeks of entries in the read-only tab". `list_time_reports` now also returns `latestEntryAt`, the newest `time_clock_entries.clock_in` for the resolved company (`api/companydata.js:1614-1625`, scoped by `resolveCompanyId` `:1605` and `.eq('company_id')` `:1622`). `src/Dashboard.jsx`: `list_time_entries` sends `weekStart` (`:3026`, state `:2023-2024`, re-fetch `:3043`, stepping `:3047-3054`); Previous / This week / Next card at `:6636-6653`, shown in both modes; the module-off probe drops the current-week `list_time_entries` call and keys on reports OR `latestEntryAt` OR own open shift (`:3281-3305`, test at `:3296`), opening on the week of the latest entry (`:3298-3301`). So both halves of the residual are gone: any past week is readable, and a sub-week company keeps its tab after the week rolls over. Still deliberate (§5): no final *report* at switch-off — cron and `generate_time_report_now` (`:1650`) stay gated. Not a write path: paging only changes a read's `weekStart`. Re-run by this pass: `npm run test:unit` **388 pass**; `tests/time-clock-module-off.spec.js` **8 pass**; against a clean `f561f42` worktree with the new tests copied in, unit `:206` and spec `:114` each **fail** (19/20 and 7/8 pass), so both new tests fail before. Re-anchored the #27, §2-exemption, #23 re-check and §5 time-clock anchors to the working tree (`get_time_report` `:1617`→`:1628`, `generate_time_report_now` guard `:1639`→`:1650`, Dashboard `:2766/2767/2805`→`:2772/2773/2811`, probe `:3262-3280`→`:3281-3305`, `get_time_report` call `:3363`→`:3388`, read-only controls `:6601,6634,6702,6710,6757,6797,6822,6832,6841`→`:6626,6677,6745,6753,6800,6840,6865,6875,6884`); as-found tables left at their recorded commits. Corrected the #23 re-check's "11 hits" — `grep -n "requireDocKey" api/companydata.js` returns 12 (a comment at `:1074`), at `ac80f96` too; the 51-guard count is unaffected. **Not done, flagged:** the map's *other* `Dashboard.jsx` anchors (Fleet Overview `:5913`, Compliance `:6119`, `complianceEnabled` `:2755`, etc.) were already stale at `f561f42` itself — e.g. `complianceEnabled` is `:2765` and the Compliance sub-tab `:6176` there — before this change added 6–43 more lines; they need their own re-anchor pass. Replace "`b0411b1`" with the hash once committed. |
| 2026-09-23 | — | **Status corrections, verified against `origin/main` = `363da23`.** Seven entries still said "closes when … merges" after the merge: #19, #20, #21, #22 and #26 closed with PR #124 (`57efbeb` — `git grep` on it finds `requireDocKey` in nine handler files, `allDocumentSettingsOn` in `admin.js:424`, `data.warning` in `AdminPanel.jsx:634`); #23 with PR #127 (`d4b8aa3`); #27 with PR #128 (`363da23`, which carries `latestEntryAt` and the paging UI). #15 (`18645f0`) and #16 (`d91fcb6`) were closed in this changelog and still open at the top of their entries. All nine status lines now say closed. `b0411b1`, which the row above asked to be replaced once committed, is not an object in this clone — it went into the `363da23` squash, and the entries say so rather than inventing a hash. |
| 2026-09-23 | `bb13340` | **#17 built, not closed** — approved by Dillon. An attachment's defect opens, resolves and repair-logs against the **attachment**: each finding carries its machine (`correctiveActions.js:419,449`, `itemAttachment` `:471`), `groupFindingsByMachine` (`:489-504`) splits one inspection per machine, and `api/logs.js:517-527,543-581` opens/closes/logs per group. Attachment ids come from client jsonb and go through `resolveEquipmentIds` first (`logs.js:513-515`); an unvetted id drops to label-only, never stored — a new row in §2's validation table. The narrower post-trip half (`buildPosttripItems` dropping `attachmentId`) was already fixed on `main` (`Inspection.jsx:393`); §4b's mirror row updated. Evidence re-run: `tests/unit/attachment-defect-routing.test.js` 6/6 at `42ed3c7`, **5 fail / 1 pass** against `363da23`. The Brain half of the old matrix cell was never in #17's scope and is now #30. Closes when the branch's PR merges. |
| 2026-09-23 | `f955ad9` | **#25 built, not closed** — approved by Dillon: allow-by-default, and a switched-off form's queued offline entry is **dropped on purpose** ("refuse and tell them"). `requireCustomDocKey` (`docKeyGate.js:152-167`) at `customforms.js:483` (`get_active_form`) and `:525` (`submit_custom`); `submit_custom` also checks `custom_forms.is_active` now (`:522`), which it never selected before — so the supervisor's own toggle leaked the same way the Admin Panel's did, and the fix's reach is wider than the entry said (recorded in #25, not a break). 403 on a refusal, 503 on a failed lookup. Not counted in the 51 `requireDocKey` guards. Evidence re-run: `tests/unit/custom-form-gate.test.js` 6/6 at `42ed3c7`, **4 fail / 2 pass** against `363da23` (the passes are the no-row cases, unchanged by design). Two §5 entries added. Closes when the branch's PR merges. |
| 2026-09-23 | `940efa9` | **#24 built, not closed** — Dillon took the honest version: the invite payload carries `certificationsEnabled` (`api/login.js:555-557`, via the shared `readDocKeySetting`), `null` on a failed lookup. `src/WalletInvite.jsx:267,338` hide the ticket card and its hint only on an explicit `false`, and `:91` skips the certifications fetch. The upload stays gated server-side. Evidence re-run: unit 4/4 (all fail against `363da23`); `tests/wallet-invite.spec.js` 3/3, **1 fail / 2 pass** against `363da23` — the fail is the module-off case, the passes are the two where the card should still show. Closes when the branch's PR merges. |
| 2026-09-23 | `42ed3c7` | **#13 and #18 built, not closed.** #13: `daily_reports.equipment_ids` finally has a consumer — Fleet Overview's "last on site" line (Dillon's pick), via a new read-only, supervisor/admin, company-scoped `fleet_activity` action (`companydata.js:865-891`) and `lastOnSiteByEquipment` (`fleetActivity.js:36-49`) → `Dashboard.jsx:6057-6068`. §4b's `equipment_ids` row is no longer "nothing at all". **#18 was rescoped by Dillon before it was built:** "Attachments won't get a preventative maintenance log, unless it's a trailer. Things like loader forks don't require preventative maintenance", plus what an attachment is mounted on and the most used / most repaired attachment in analytics. So: `pmAllowedFor` (`fleetActivity.js:75-78`); a trailer's PM usage is KM towed since its last service (`maintenance.js:221-233` → `towedDistanceSince`, `fleetActivity.js:86-106`), where it read `ok` forever; a non-trailer attachment reads `not_tracked` and `set_equipment_pm_interval` refuses one (`companydata.js:1273-1278`). **New deliberate non-connection in §5: non-trailer attachments have no PM clock by design.** **New joins on the map:** Daily Report → Fleet Overview (`equipment_ids`), Inspection pre-trip → Fleet Overview (attachment ids, "last mounted on"), Inspection + maintenance log → Analytics (most used / most repaired, fleet-id keyed — the first equipment analytics that does not key on the label), and Inspection → PM for a trailer via `linked_inspection_id` + the pre-trip's attachments — a new table under §3 and a new row in §2's reading table. The towed sum lives in `fleetActivity.js`, not `readings.js` as #18's old entry proposed — recorded in §2 with why. Evidence re-run: `tests/fleet-activity.spec.js` 3/3 at `42ed3c7`, **3/3 fail** against `363da23`; `timeclock-gate.test.js` 23/23, **2 fail** (the two interval refusals) against `363da23`; `fleet-activity.test.js` 8/8 (pure module, no "before"). No test runs the real `list_status` towed branch — recorded in #18. `npm run test:unit` → **415 pass, 0 fail**. Both close when the branch's PR merges. |
| 2026-09-23 | `42ed3c7` | **#28, #29 and #30 opened by this pass, none approved, none worked** — all three are residuals of the day's builds, each read in the code. #28: PM decides "towed trailer" with `is_attachment && isTrailerTemplate` while the inspection uses `is_attachment \|\| isTrailerTemplate` (`Inspection.jsx:276-287`), and `is_attachment` was never backfilled (`default false`, migration `:70`) — so a template-matched trailer without the flag takes the metered branch and reads **`ok` forever** once serviced (`maintenance.js:242`), #18's original symptom. Whether any live row is in that state was not queried. #29: `list_status`'s inspections read keeps `.not('equipment_id', 'is', null)` (`maintenance.js:166`), so a trip towed by a free-text machine credits Weekly Hours and not the trailer's PM clock. #30: `inspectionFindingSignal` still names the carrier for an attachment's defect (`logs.js:214-215`) — the Brain half of the Attachments row #17 used to cover. |
| 2026-09-23 | `42ed3c7` | **Line-number refresh, as Dillon asked.** Every live `src/Dashboard.jsx` citation in §1–§5 re-read against the 7274-line file at `42ed3c7` and re-cited where the code actually is — no offsets applied. The previous pass had flagged these as already stale at `f561f42` (e.g. `complianceEnabled` cited `:2755`, the Compliance sub-tab `:2832`, Fleet Overview `:5913`); at `42ed3c7` they are `:2784`, `:2869` and `:5990`. Also re-anchored, because #13/#18's `companydata.js` insertions moved them by 34–48 lines: the `companydata.js` guard, carve-out and time-clock anchors in §2, §5 and #27's built table; and the `customforms.js` anchors in §2/§5 (one line down since #25's import). Left as found on purpose: the changelog, the "as found at `ac80f96`" tables, the text quoted from `98f9d70`, and the `git show`-pinned historical claims in §1 and #19. Other `api/` anchors in older break entries were not swept and may be stale. No application code touched. |
| 2026-09-23 | `afc4b93`, `e7bd475` | **Re-anchored after two follow-up commits on the branch; no break status changed.** `afc4b93` (tenant-scope review): `fleet_activity`'s `mountedOn` is now filtered to the company's own fleet ids (`api/companydata.js:877-880`), since attachment ids come from client jsonb; and `resolveCorrectiveActionsForItems`' update carries `.eq('company_id', companyId)` next to `.in('id', ids)` (`server-lib/correctiveActions.js:345`). Both recorded in #13/#18/§3 and #17. `e7bd475` moved the `fleet_activity` block above `list_equipment`'s comment, which fixes the misplacement the previous row's report noted: the block is `:857-883` (was `:865-891`), its no-gate comment `:849-856`, queries `:863-866`, and the retired-machines comment is back directly over `list_equipment` at `:885-892`. Re-read against HEAD: everything in `companydata.js` from `list_equipment` (`:893`) down is **unchanged** — `set_equipment_pm_interval` `:1251` (guard `:1253`, refusals `:1273,1276`), the compliance guards `:1065,1114,1183,1231`, the time-clock guards `:1486,1578,1610,1638,1698`, carve-outs `:1503,1524,1543,1651,1676`, reasoning `:1473-1483`, `latestEntryAt` `:1662-1673` — so none of those needed to move. `correctiveActions.js` anchors cited by the #17 build (`:419,449,471-478,489-504,495`) re-read and still correct; three older §2 anchors (`:272-352`, `:298`, `:327`) re-anchored to `:273-356` and `:328`. #28, #29, #30 still OPEN. |
| 2026-09-23 | `1301c76` | **#28 BUILT, not closed — closes when PR #129 merges.** Dillon approved it ("Complete 28, then merge"). "Is it towed?" is now `isTowedUnit` (`server-lib/fleetActivity.js:79-82`), by type alone — the inspection's own test — and `pmAllowedFor` (`:88-91`) delegates to it. `list_status` sets `isTowed = isTowedUnit(eq)` (`api/maintenance.js:219`), so an unflagged trailer runs the towed-KM clock (`:223-242`) instead of reading `ok` forever; a trailer already set up in **Hours** now returns `unit_mismatch` (`:231-236`, rendered by `src/Dashboard.jsx:6430`) rather than comparing KM to hours. `set_equipment_pm_interval` requires KM for any towed unit (`api/companydata.js:1276-1279`), and `attachmentStats` counts unflagged trailers (`fleetActivity.js:127-129`). Evidence: 4 new tests (`tests/unit/fleet-activity.test.js:120,126,132`, `tests/unit/timeclock-gate.test.js:242`) fail 4/35 with those files dropped into a `427895e` worktree and pass 35/35 at `1301c76`; `npm run test:unit` 419/419. Gap: no test runs `list_status` itself, so `maintenance.js:219` and the new `unit_mismatch` return are verified by reading. **Re-anchored** everything the commit shifted: `fleetActivity.js` +13 from `pmAllowedFor` down (`:75→88`, `towedDistanceSince` `:86→99`, `:95→108`, `attachmentStats` `:113→126`, filter `:114→129`); `maintenance.js` +2 from `:217` and +8 from `:229` (towed branch `:221-233→223-242`, `list_records`-area and `log_field_service` anchors); `companydata.js` +1 from `:1276` (time-clock `:1503,1524,1543,1651,1676,1698` → `:1504,1525,1544,1652,1677,1699`, reasoning `:1474-1484`, `latestEntryAt` `:1663-1674`). Changelog rows and "as found" blocks keep their original numbers. **#29 and #30 still OPEN.** |
| 2026-09-25 | this branch (`claude/toolbox-talk-edit-notes-oz5y1u`) | **New surface reached its join key: Toolbox Talk attendee and FLHA crew (secondary) signers now pick a real roster row instead of typing a name.** New worker-facing action `list_roster_names` (`api/companydata.js:761-770`) — company-scoped, `id, name, role`, active only, no role check, same pattern as `list_sites`/`list_equipment`. `src/ToolboxTalk.jsx` adds a `rosterId` (or `rosterId: null, guest: true` for a genuine non-employee, `:275-280`) to each `attendees_json` entry; `src/App.jsx`'s FLHA crew adds `rosterId` to each `crew_signatures` entry with no guest fallback (`:502-504,526-529`) since additional crew is assumed to always be an employee. Both flows block adding a second signer at all (no free-text fallback) if the company has zero active roster members (`ToolboxTalk.jsx:612`, `App.jsx:1495`). **Placed as a refinement of the `roster_id` join key (§2), not a new key** — same target table, same shape as break #3's `submitted_by_roster_id`, but weaker: `attendees_json`/`crew_signatures` are client-submittable jsonb columns (`api/logs.js:159`, `api/flhas.js:148`) and neither submit path validates the embedded `rosterId` against the caller's own roster, unlike `site_id`/`equipment_id`, which get exactly that check. **Filed as new break #31, OPEN, not approved, not worked** — a client can currently write any `rosterId` value into either array. No `api/logs.js` or `api/flhas.js` application code touched by this pass; map only. |
| 2026-09-29 | uncommitted working tree | **New join key: `roster.departments` — Company Portal phase 1 (Departments), producer side only.** `docs/schema/roster-departments-migration.sql` (applied live) adds `roster.departments text[] not null default '{}'`; `server-lib/portalDepartments.js` fixes the v1 list (`hr`, `payroll`, `safety`, `maintenance`, `operations_manager` — deliberately excludes `company_admin`, since that access already comes from `roster.role === 'admin'`); `api/companydata.js:862-876`'s `update_worker_profile` validates against that list, forces `[]` on any worker-tier row, and clears it when a row is demoted from supervisor in the same request; `src/WorkerProfileDrawer.jsx` gained the chip picker, shown only when the drafted role is supervisor. Read every file listed. **No consumer exists yet, and that's correct for this phase, not a break** — phase 3 (document routing) and phase 4 (assignment rules) are the named future consumers per the build spec, and their tables (`portal_documents`, `portal_assignment_rules`) don't exist yet (confirmed by grep: no hits in `api/`, `src/`, `server-lib/`). Recorded in §2 with two things to re-check once those phases land: client-side department validation, and whether the phase-3/4 surface needs `document_key`-style gating (Company Portal isn't in `pricing.js`'s `MODULES` yet, so an ungated arrival would repeat break #19's shape). No break filed. No application code beyond what's listed touched by this pass; map only. |
| 2026-09-28 | uncommitted working tree | **Client scoping pipeline (Ted) placed on the map, kept off §1/§3 on purpose.** New agents (`.claude/agents/ted.md` + three specialists), new table `portal_scope_requests` (no `company_id` — rows exist pre-company), new pricing module `server-lib/portalScopePricing.js` (separate source of truth from `pricing.js`'s `MODULES`), new endpoint `api/scope-approval.js`, and a new `invoice.paid` handler in `api/stripe-webhook.js` (`notifyPortalScopePaid`). Read every file listed above. Not a product surface — it's sales-ops plumbing that runs before any tenant exists, same reasoning §1 already applies to `api/checkout.js`. One join key recorded in §2 (`approval_token`, same unguessable-link pattern as `onboarding_requests.edit_token`/`claim_token`) plus a note that `stripe_invoice_id` is written and uniquely indexed but never read back — the webhook keys on `invoice.metadata.portal_scope_request_id` instead, which is not a break, just worth knowing before assuming the invoice id is the join. **No new break filed.** Confirmed by reading `stripe-webhook.js:53-78` that a `paid` row does not auto-create an `onboarding_requests` or `companies` row — that's Dillon's manual pickup by design (CLAUDE.md's own description agrees), recorded as a new deliberate non-connection in §5 rather than left for a future pass to mistake for a silent gap. Worth re-opening as a real opportunity once Portal becomes a checkout-purchasable module (`portalScopePricing.js:11-13` names that as the trigger) — not proposed now since that trigger hasn't happened. No application code touched; map only. |
| 2026-09-29 | uncommitted working tree | **Company Portal phase 2 (Document engine v2) placed on the map.** New tables `portal_documents`/`portal_questions`/`portal_records`/`portal_answers` (`docs/schema/company-portal-phase2-migration.sql`, applied live), `server-lib/portalFieldTypes.js` (8 field types, generalizing `custom_form_questions`' yes/no-only shape), new file `api/portal.js` (admin builder incl. a real Anthropic vision/document call in `ai_draft_document`, worker submit, supervisor/admin view actions), `src/generatePortalDocumentPDF.js`, `src/PortalDocumentForm.jsx` (registered in `WorkerMenu.jsx:38`'s `RESUBMIT_HANDLERS` as `portalform`), `src/PortalDocumentBuilder.jsx` (wired into `AdminPanel.jsx:1407`, founder-only). Two new private Storage buckets, `portal-sources` and `portal-attachments`, both through the existing signed-upload-receipt model. Read every file listed. Recorded as a new join-key section in §2 (`portal_documents.id` → `portal_questions`/`portal_records`/`portal_answers`, with the submit-time question/document/site company-scope checks and the `authorRosterId`-stamped `submitted_by_roster_id`). **Break #32 filed:** a worker's Portal submissions don't appear in `src/MyDocuments.jsx`'s "My Forms" — `api/customforms.js:405-445`'s `get_my_documents` queries eight other sources and never `portal_records` (confirmed: `grep -n "portal" api/customforms.js src/MyDocuments.jsx` → no hits in either file). Distinct from the phase-3/4/5 deferrals (department/category routing, records-list UI, escalation) recorded in the same §2 entry and in a new §5 bullet — those are named future phases per the build spec and confirmed absent by grep; #32 is not planned anywhere and won't close on its own. Company Portal still not in `server-lib/pricing.js`'s `MODULES` (confirmed: `grep -n "portal" server-lib/pricing.js` → no hits) and `api/portal.js` calls neither `requireDocKey` nor `docKeyGate` — `is_active` on the row itself is the only gate, same open flag already carried from the phase-1 entry, not refiled as new. No application code touched by this pass; map only. |
| 2026-09-29 | branch `company-portal-phase-3-routing-notification` | **Company Portal phase 3 (document-level routing + notification) placed on the map — `roster.departments` and `portal_documents.departments` get their first real consumer.** `api/portal.js`'s `list_portal_records`/`get_portal_record_detail` now filter an individually-identified supervisor (`session.userId` set) to documents whose `departments` intersect their own `roster.departments`; a shared-code supervisor (no `session.userId`) falls back to unfiltered-within-company. `submit_portal` now sends a best-effort, non-blocking notification email (`server-lib/email.js`'s `sendEmail`) to every active, on-department supervisor with an email on file. New company-scoped, read-only action `list_portal_documents_for_dashboard`, and a new "Portal" tab in `src/Dashboard.jsx` (Inbox reading `list_portal_records`, Document Library reading the new action) gated on the same `roster_enabled` signal the Roster tab uses — not on a doc key or `MODULES` entry, which is the same open gating gap already carried from phases 1-2, not a new one. Updated both the phase-1 (`roster.departments`) and phase-2 (`portal_documents.id`) §2 entries from "no consumer yet" to consumed, with file:line evidence, and updated the phase-2 §5 deferrals bullet accordingly. **No new break filed.** Break #32 (Portal submissions missing from My Forms) is untouched by this phase and re-confirmed still open (`grep -n "portal" api/customforms.js src/MyDocuments.jsx` → still no hits in either file) — recorded explicitly so it doesn't read as silently resolved. **Role-model resolution recorded, not a break:** the build spec's "Company Admin" persona was deliberately not built (Dillon's 2026-09-29 decision, mid-build) — this app has no customer-facing admin role, only worker/supervisor; a supervisor row with all 5 `PORTAL_DEPARTMENTS` checked already sees everything under this phase's intersection logic, satisfying the spec's requirement without a new role. New §5 bullet added so a future pass doesn't go looking for a `company_admin` role that was never built. `category` on `portal_documents` still has no reader (unlike `departments`, which this phase consumes); escalation (phase 5) and assignment rules (phase 4) remain unbuilt, confirmed by grep. No application code touched by this pass; map only. |
| 2026-09-29 | branch `company-portal-phase-4-assignment-compliance` | **Company Portal phase 4 (assignment + compliance) placed on the map — this closes the sellable-v1 cut line (phases 1-4 complete per the Boardroom decision).** New tables `portal_assignment_rules` (`document_id`, `target_type` in `everyone`/`role`/`individual`, `target_role`, `target_roster_id`, `due_days`, `auto_apply_new_hires`) and `portal_assignments` (`rule_id` nullable, `document_id`, `roster_id`, `due_at`, unique on `(document_id, roster_id)`) — `docs/schema/company-portal-phase4-migration.sql`, applied live. New `server-lib/portalAssignments.js`: `applyRuleToExistingRoster` (materializes a new rule against the company's current active roster) and `applyRulesToNewRosterMember` (the spec's "auto-applies to new hires," called from `api/companydata.js`'s `add_roster_member`/`onboard_new_employee` right after the roster insert), both best-effort/non-blocking and idempotent via `upsert ... ignoreDuplicates` against the unique index. New `api/portal.js` actions: admin-only `create_assignment_rule`/`list_assignment_rules`/`delete_assignment_rule`, and supervisor/admin `get_assignment_rollup`, which computes `not_started`/`submitted`/`overdue` **at read time** by cross-referencing `portal_records` — deliberately not a stored column, same reasoning the migration's own header comment gives for not storing a `portal_records`-style "gated" value. New "Who needs to complete this" section in `src/PortalDocumentBuilder.jsx` (shown only for an already-published document) and a new "Assignments" sub-tab in `src/Dashboard.jsx`'s Portal tab (overdue flagged in red). Placed as a new §2 join-key section (`portal_assignment_rules.id → portal_assignments`); the phase-2 §5 deferrals bullet updated to mark assignment rules built, closing that list except for phase 5. **Deliberate spec deviation recorded, not a gap:** the build spec's "role/group/individual/everyone" targeting was built as `everyone \| role \| individual` only — no department ("group") targeting — because `roster.departments` exists only on supervisor-tier rows (phase 1) and a department-targeted rule could therefore never reach a worker, the wrong default for assigning paperwork to the people doing the work. Flagged in the migration's own header comment as worth reopening once workers get some equivalent grouping; new §5 bullet added so it isn't mistaken for a silent break later. **Confirmed phase 5 (escalation) remains completely unbuilt:** `grep -rln "portal_escalations\|escalation_department\|escalation_condition" api/ src/ server-lib/ docs/schema/` → no hits beyond the phase-2 migration's own forward-looking comment. **No new break filed. Break #32 (Portal submissions missing from My Forms) is unaffected by this phase** — it doesn't touch `MyDocuments.jsx` or `get_my_documents` — and is left exactly as recorded at the phase-3 pass, not re-verified as new. Also noted in §2: `get_assignment_rollup`'s admin-session scoping (no `company_id` filter server-side, filtered client-side in `src/Dashboard.jsx`) matches its pre-existing `list_portal_records` sibling exactly — read both before assuming phase 4 introduced a new gating shape; it didn't. No application code touched by this pass; map only. |
| 2026-09-29 | branch `fix-break-32-portal-my-documents`, PR #149, commit `6b2fc3a` | **Break #32 CLOSED — Portal submissions now reach My Forms.** `api/customforms.js`'s `get_my_documents` (`:451-462`) now also queries `portal_records`, scoped through `portal_documents.company_id` (same indirection `custom_form_records` already used via `custom_forms`) and matched to the requesting worker by `submitted_by`, merging into the response as `type: 'portalform'`. No client-side change needed — `src/MyDocuments.jsx`'s Submitted section already renders an unrecognized `doc.type` via its existing fallback (`:196`, `TYPE_META[doc.type] \|\| { label: doc.title, icon: FileText }`). Updated §2's `portal_documents.id` join-key table with the new consumer row, and rewrote break #32's §4 entry from open to closed. **Break #33 filed, found while building the fix and deliberately not folded into it (needs its own approval per CLAUDE.md's hard rule):** the *separate* Unfinished-drafts half of the same screen (`scanDrafts`, `MyDocuments.jsx:41-70`) has no such fallback — its `TYPE_META[type]` check at `:54` is a strict allowlist that still excludes `portalform`, so an in-progress (unsubmitted) Portal draft is silently skipped by `scanDrafts` even though `src/PortalDocumentForm.jsx:167-171`'s `useDraftAutosave("portalform", ...)` genuinely writes one to the same `fora_draft_` localStorage namespace `scanDrafts` reads. Confirmed the drafts render path also lacks a fallback (`:147`, `const meta = TYPE_META[d.type];` used directly, no `||`). New §4 entry added for #33; not started, awaiting a yes. No other application code touched by this pass. |
| 2026-09-29 | branch `company-portal-phase-5-escalation`, PR #150 | **Company Portal phase 5 (question-level escalation) placed on the map — the last of the 5 build-order phases.** New columns `portal_questions.escalation_department`/`.escalation_trigger_value` and a new table `portal_escalations` (`record_id`, `document_id` cascade; `question_id` nullable-on-delete; `question_text`/`answer_value` snapshotted at insert time; `target_department`; `status` open/actioned; `actioned_by_roster_id`/`actioned_at`) — `docs/schema/company-portal-phase5-migration.sql`, applied live. New `server-lib/portalFieldTypes.js` export `ESCALATABLE_FIELD_TYPES`/`fieldTypeCanEscalate` (`yesno`/`dropdown`/`multiselect` only — the only types with a fixed, pre-configurable "flagged" value), consumed by `validateQuestions`, `ai_draft_document`'s sanitizer, and `src/PortalDocumentBuilder.jsx`'s escalation controls so all three can't drift on which types allow it. `submit_portal` compares each answer against its own question's trigger and inserts a `portal_escalations` row on match, best-effort/non-blocking like the phase-3 email beside it (`api/portal.js:552-578`). Two new supervisor/admin actions, `list_escalations`/`action_escalation` (`api/portal.js:858-931`), scoped by the escalation's own `target_department` — deliberately different from every other Portal read in the file, which scope by the *document's* `departments`, since an escalation is meant to reach a different department than its source document. New "Escalate if answer is / send to" controls in `src/PortalDocumentBuilder.jsx`, and a new "Escalations" sub-tab in `src/Dashboard.jsx`'s Portal tab. New §2 join-key section (`portal_questions.escalation_department`/`portal_escalations`) with full producer/consumer file:line evidence, confirming `escalation_department` as a new consumer of the same `PORTAL_DEPARTMENTS` list `roster.departments`/`portal_documents.departments` already use, for a different semantic (escalation target, not document routing). Closed out both the phase-2 and phase-4 "escalation deferred to phase 5" §5 notes — the phase-2 deferrals list (`departments`, assignment rules, escalation) is now fully consumed; only `portal_documents.category` remains unread, which was never on a future-phase list and stays a non-break. **Break #34 filed:** `submit_portal`'s escalation-insert block never sends a notification the way the phase-3 submission email does for a document's own departments — `grep -n "sendEmail" api/portal.js` shows one call site, and it's not near the escalation code. An escalation routed to a department that never saw the source document (the whole point of the feature, per the code's own comments) has no push at all; it sits `open` until someone happens to open the new Escalations tab. Not fixed, awaiting a yes — a fix would add a second `sendEmail` call in the same block, mirroring the phase-3 email's recipient query but keyed on `escalation_department` instead of the document's `departments`. No application code touched by this pass; map only. |
| 2026-09-29 | branch `fix-break-34-escalation-notification` | **#34 BUILT, not closed — approved by Dillon, closes when this branch's PR merges.** (superseded by the row below once PR #152 merged) `api/portal.js`'s escalation-insert block now sends a second, best-effort `sendEmail` call after a successful `portal_escalations` insert, same recipient-query shape as the phase-3 email directly below it (`roster` filtered to `company_id`, `role: 'supervisor'`, `active: true`, non-null `email`), but filtered on `r.departments.includes(q.escalation_department)` instead of the document's `departments` array, so it reaches the escalation's own target department rather than repeating the phase-3 recipients. Gated on a local `escalationInserted` flag so it only fires once the escalation row is actually saved, and wrapped in its own try/catch that only logs on failure — a notification failure can never affect the already-saved escalation row, matching the posture of every other side effect in this handler. No schema change. `grep -n "sendEmail" api/portal.js` now returns three lines (import, the new escalation email, the phase-3 email) where it returned two before. Reviewed against `tenant-scope-reviewer`'s checklist (Agent tool unavailable in this session, applied manually per CLAUDE.md's fallback): the new query scopes on `session.companyId` (never a client-supplied value) and filters on `company_id`, identical in shape to the already-reviewed phase-3 query beside it — clean, no new tenant-boundary risk. `npx vite build` and `npm run test:unit` (446 pass) both re-run clean; no existing unit test exercises `submit_portal` itself, same as phase 3's email — verified by reading, not by a dedicated test file. |
| 2026-09-29 | PR #151 (branch `fix-break-33-unfinished-portal-drafts`), commit `a02612d` | **Break #33 CLOSED on merge.** One-line, client-only fix: `TYPE_META.portalform` added to `src/MyDocuments.jsx:37`, so an in-progress Portal draft now shows up in Unfinished the same way every other form type does. Re-verified against the merged code (`grep -n "portalform" src/MyDocuments.jsx` → `:37`) before rewriting §4's break #33 entry from open to closed. No other application code touched by this pass; map only. |
| 2026-09-29 | PR #152 (branch `fix-break-34-escalation-notification`), commit `582ee3d` | **Break #34 CLOSED on merge.** `api/portal.js`'s escalation-insert block (`:588-611`) now sends a second best-effort `sendEmail` to the escalation's own target department, gated on the insert actually succeeding and wrapped in its own try/catch — mirrors the phase-3 submission email's recipient shape but keyed on `escalation_department` instead of the document's `departments`. Re-verified against the merged code (`grep -n "sendEmail" api/portal.js` → import at `:27`, escalation email at `:603`, phase-3 email at `:643` — three hits, was two before the fix) before rewriting §4's break #34 entry from built-not-closed to closed. No other application code touched by this pass; map only. |
| 2026-09-29 | branch `portal-pdf-email`, `ba5f6ab` | **Company Portal "email documents to a department" placed on the map.** New table `portal_report_schedules` (migration written, **not applied live**), `server-lib/portalReports.js`, `api/cron-portal-reports.js` (`vercel.json:9`), five `api/portal.js` actions (`:1042-1158`), `src/PortalReports.jsx`, and the Email to department button (`Dashboard.jsx:1651`). Consumes `PORTAL_DEPARTMENTS`, `roster.departments`, `portal_documents.departments`, `portal_records.pdf_url` and encrypted `roster.email`; all keys agree (table in §2). Earlier merged steps recorded in the same §2 section: `fieldCrypto` roster/onboarding encryption, `people_encrypted`, supervisor-created assignment rules. **Breaks #35** (zero-recipient run marks documents as sent, `portalReports.js:143-145`) **and #36** (one-off email doesn't check the target department against the document's routing, `portal.js:1138-1149`) opened. #35 not approved. #36 was fixed in `e3c49ad` (`portal.js:1150-1153`, `Dashboard.jsx:1603`), not closed until the branch merges. That commit also rejects recipient addresses containing `,;<>()"` (`portal.js:1067`), not mapped as a break. Noted, not filed: the cron skips no `roster_enabled`/`suspended` check, unlike `cron-equipment-reports.js:88`. Overview Company Portal panel not read (`?`). Map only; no application code touched. |
| 2026-09-29 | branch `portal-brain-signals`, `23bad5b` | **Company Portal feeds the Brain; break #4 stays closed and now covers Portal.** New `source_type` `portal_escalation` (`api/portal.js:608 (was :598 before the merge with main)`), `{document, question, department}` only (`server-lib/portalSignals.js:26-32`), written after a saved `portal_escalations` row. The escalation insert now checks its returned error (`portal.js:577-583`), so the department email (`:618`) no longer fires for an escalation that failed to save. All four places updated and read: writer, `bySourceType` plus `topPortalFlagged` tally (`companydata.js:1639,1669-1672,1689`), Admin Panel tile and list (`AdminPanel.jsx:2246,2258`), prompt builder (`companyBrainSummary.js:124`). Assignment completion and overdue counts per department are computed at summary time by `loadPortalHealthLines` (`portalSignals.js:89-110`, company-scoped, `[]` on failure), called at `companyBrainSummary.js:220`, never stored. Map: §2 table now 8 source types, new Company Portal matrix row, #4 entry, header, and the §5 bullet that said Portal emits nothing (now rewritten). Deliberate: custom documents stay excluded; Portal answer values and worker names stay out; assignment health needs the 5-new-signals gate. Evidence: `node --test tests/unit/portal-brain-signals.test.js tests/unit/brain-signal-capture.test.js` 26 pass, 0 fail. **No new break.** Two soft spots noted, not filed: `loadPortalHealthLines` reads `portal_assignments` and `portal_records` with no `.limit`/pagination (`portalSignals.js:95-101`), so a company past the API's default row cap could get undercounted health lines (the cap was not checked against the project config); and the `portal_escalation` prompt lines are appended after the 80-line slice input (`companyBrainSummary.js:124-125`), so they can be trimmed only if other lines already fill it. Map only; no application code touched. |
| 2026-09-29 | branch `fix-portal-p3` (`b97b231`), PRs #157, #158, #159 | **Company Portal parity sweep, plus everything merged since the last pass.** PR #158 merged (department report emails; `portal_report_schedules` reported applied live by Dillon, not verifiable from code): **#35 and #36 CLOSED**, cron now gated on `companies.roster_enabled`/`suspended` (`cron-portal-reports.js:36-39`), `runSchedule` refuses without `RESEND_API_KEY` (`portalReports.js:128`). PR #157 merged: Overview "Company Portal" panel read (`Dashboard.jsx:5502-5508`), the standing `?` cleared. Sweep filed four breaks: **#37** (Resume on a Portal draft, `WorkerMenu.jsx:221`) CLOSED, PR #159; **#38** (edit, regenerate, delete a submitted Portal record: `update_portal_record` `portal.js:1037`, `delete_portal_record` `:1085`, `validateEditedPortalAnswer` `portalFieldTypes.js:48`, `PortalRecordCard` edit UI, delete also removes stored PDF and attachments) CLOSED, PR #159; **#39** (`delete_site` `companydata.js:1027-1032`, `delete_company` `admin.js:685-731` ignored Portal) approved and FIXED on this branch, closes when its PR merges; **#40** (Portal absent from Overview Recent Activity, Site Activity, Analytics, `Dashboard.jsx:4248-4262`) OPEN, not approved. **#33 amended:** its Unfinished-list fix (PR #151) was incomplete until #37, since Resume went nowhere. `get_portal_record_detail` now returns one generic 403 for missing versus foreign record for non-admin (`portal.js:721-729`). Known, unchanged, now in §5: Portal not in `pricing.js`; Portal answers emit no Brain signals. Map only; no application code touched. |
| 2026-09-29 | branch `founder-dashboard-activity`, `cb9908a` | **Founder dashboard slice 3a placed on the map.** New surface #24 (Admin Panel > Platform): `api/admin.js:127-134` `platform_overview` → `server-lib/platformOverview.js:221` `loadPlatformOverview`, rendered by `src/PlatformDashboard.jsx` (`AdminPanel.jsx:1408-1409`). Aggregates only, no new table, not gated by a company doc key on purpose (§5). It is a **new consumer** of the doc-key/module invariant (#6) and of `company_document_settings`, `roster.last_login_at`, `companies.created_at`/`plan_tier`/`stripe_subscription_status` and `onboarding_requests`. All nine document tables, the three via-parent tables and the four join names read from resolve against the code (`platformOverview.js:201-219`). **Break #41 opened** (the dashboard's own document-type list is a second copy of the doc-key list and nothing ties it to `pricing.js`, so adoption can undercount silently), not approved, no code touched. Two weak points recorded, not filed: "active workers" counts PIN logins only (`login.js:437` is the only `last_login_at` write; invite-link sessions at `:581-591` never set it), and the totals mix live-only and all-company denominators (`platformOverview.js:67-79` vs `:114-116`). `platform_events` (surface #23, pending link P1) was recorded here as having zero references in the repo; that is stale once `main` is merged in, since it now has a writer and a migration (see the `platform-events-instrumentation` row below). It still has no reader, so the dashboard link stays `?` until health slice 3c lands. Not to be confused with the existing Portal-sweep P1 (#37). Slices 3b (MRR, churn, seat usage, health scores) and 3c (`platform_events` health) are not built and not mapped. Map only; no application code touched. |
| 2026-09-29 | branch `founder-dashboard-activity`, `8502cb2` | **#41 BUILT, closed pending merge of its PR** (same convention as #37-#40). Dillon approved it. `server-lib/platformOverview.js` exports `UNMEASURED_DOC_KEYS` (`:46`) and `tests/unit/platform-overview.test.js:148-173` has four guard tests requiring `DOC_TYPES` plus that list to cover `pricing.js` `ALL_DOC_KEYS` (`:124`) exactly, with no stray and no double-listed keys. Read all three files. The builder reported a fake doc key made the test fail clearly, then restored `pricing.js`; this pass did not re-run that. §3 consumer table cell for the module join moved from warning to fine. The dashboard is now the **second consumer of the doc-key/module invariant with its own guard**, alongside #6's `doc-key-module-invariant.test.js`. `UNMEASURED_DOC_KEYS` is three keys, and the export added 8 lines to `platformOverview.js`, so the anchors below line 47 in the #41 entry and §3 table were re-cited (`DOC_SOURCES` `:208-218`, `VIA_PARENT` `:222-226`, module loop `:144-155`, settings read `:126-133`). Other `platformOverview.js` line cites elsewhere in the map (the surface #24 row `:221`, weak points 2 and 3 in #41) were not swept and may sit about 8 lines low. Map only. |
| 2026-09-29 | branch `portal-parity-analytics`, `23aad0b` (after PR #161 `599ba95`) | **Break #40 FULLY BUILT, closed pending merge.** Recent Activity merged earlier in PR #161. This commit: `fieldSiteActivity` gains a 7th `extras` argument `{portal, custom}` (`analyticsUtils.js:122,138-139`), Overview Site Activity passes Portal records and custom docs of every category (`Dashboard.jsx:4278-4282`), new `portalSummary` (`analyticsUtils.js:165`) and `PortalAnalyticsPanel` (`Analytics.jsx:449`) as the Portal tab's Analytics sub-tab (`Dashboard.jsx:6567-6575`), department-scoped by the server. Safety Analytics and its PDF unchanged (no `extras`). Tests: `tests/unit/portal-analytics.test.js`. New matrix row for Portal, Custom Document row annotated. New §5 entry: Portal deliberately not in Safety Analytics or its PDF. Residual gap recorded: workforce-category custom docs appear in no Analytics panel (open, low). Map only; no application code touched. |
| 2026-09-29 | branch `platform-events-instrumentation` (uncommitted) | **`platform_events` placed on the map.** New surface #23 in §1, new §2 join-key section, new all-`—` matrix row, and a new "Known pending links" section (P1) recording that it has no reader yet on purpose (Admin Panel, phase 3c). Migration `docs/schema/platform-events-migration.sql` written, **not applied live**. Eight producers verified in code: three crons (`cron_run`), `server-lib/email.js` (`email_send`), and four Anthropic call sites (`ai_generation`: `api/generate-flha.js:297`, `api/portal.js:248`, `server-lib/companyBrainSummary.js:70`, `server-lib/onboardingDrafting.js:61`). No break filed. **Stale Brain wording corrected:** §2's `source_type` table said daily reports and the equipment inspection "write nothing" and pointed at open break #4; it now lists all 7 source types with re-anchored lines (`flhas.js:436`, `reports.js:303`, `logs.js:442`, `logs.js:466`, `monthly.js:470`, `logs.js:484`), the "Equipment fleet" to Brain matrix cell went from `❌ #4` to `✅`, and #4's leftover "never sees equipment inspection defects" paragraph is now labelled historical. |
| 2026-09-29 | branch `founder-dashboard-business`, `d4217e7` | **Founder dashboard slice 3b placed on the map.** New `server-lib/platformBusiness.js` (pure, imported only by `platformOverview.js:18,190`, so it stays behind `api/admin.js`'s founder-only `platform_overview`) adds a `business` section: estimated MRR, seat usage, median days to first document, per-company health score. Rendered as Revenue, Company health and Seats cards (`PlatformDashboard.jsx:67-113`). Tests: `tests/unit/platform-business.test.js`. New consumer rows added to §3 for `pricing.js` (good: one price source), `company_document_settings`, `stripe_subscription_status`, `planSeatCap`, `roster.last_login_at` (PIN logins only) and `created_at`. **Filed #42** (the Seats card uses `planSeatCap`, but enforcement uses a separate `SEAT_CAP_BY_TIER`, `companydata.js:219`, so the brief's claim that they cannot drift does not hold) with six recorded weak points, chiefly that the webhook suspends canceled/unpaid companies so they drop out of MRR and never show as at risk. Health thresholds are a judgment call for Dillon to tune. Tests were not re-run by this pass. Map only. |
| 2026-09-29 | branch `founder-dashboard-health`, `26d6d4f` | **Founder dashboard slice 3c placed on the map; P1 closed.** `server-lib/platformHealth.js` (pure, imported only by `platformOverview.js:19`, so it stays behind `api/admin.js`'s founder-only `platform_overview`) adds a `platformHealth` section from the last 30 days of `platform_events`: scheduled job state for the three crons, email delivery, AI success rate, estimated cost by document type, model and company (`MODEL_PRICES` opus-5 $5/$25, sonnet-5 $2/$10, haiku-4-5 $1/$5 per million, cache read 0.1x, write 1.25x, table cached 2026-09-25, unlisted model counted unpriced), recent trouble, and a not-visible-from-the-app note. Rendered as `HealthSection` (`PlatformDashboard.jsx:69`). Tests: `tests/unit/platform-health.test.js`, not re-run by this pass. **`platform_events` now has a reader**, so the `?` row in the founder-dashboard consumer table and pending link P1 are resolved; the Founder Dashboard (surface #24) and its consumer table now cover 3a, 3b and 3c. PR #162 (table plus 8 writers) merged into `main` 2026-09-29 and the table is applied live. Three breaks hunted (unmetered Anthropic call, `CRONS` vs `vercel.json`, `MODEL_PRICES` vs models in code): **none found**, all verified in code, see §4. One weak point recorded, not filed: no test ties `CRONS` or `MODEL_PRICES` to their sources. *Numbering, resolved:* `main` uses surface #23 for `platform_events` and P1 for its pending link, and the Founder Dashboard is #24 here, so the two no longer collide (the earlier merge hazard note is obsolete). Map only. |
| 2026-09-29 | branch `founder-dashboard-health` | **#43 BUILT, closed pending merge of its PR** (same convention as #37-#42). Dillon approved it. Closes the slice 3c weak point (no test tied `CRONS` or `MODEL_PRICES` to their sources). `tests/unit/platform-health-sources.test.js` (4 tests): every `vercel.json` cron records a `cron_run` subtype that `CRONS` lists, both directions, and the counts match (`:22-34`); every `api/cron-*` file that records `cron_run` is scheduled in `vercel.json` (`:36-43`); `CRONS` cadence matches the schedule, weekly 168h, monthly 720h, else 24h (`:45-53`); `MODEL_PRICES` equals the set of `claude-*` literals in `api/` and `server-lib/`, both directions (`:55-67`). The builder shows it fails on a fake `vercel.json` cron and on a fake model string, and 529 unit tests pass, reported to this map, not re-run by this pass. Not marked merged. |
| 2026-09-29 | branch `founder-dashboard-business`, `c1a9266` | **#42 BUILT, closed pending merge of its PR** (same convention as #37-#41). Dillon approved it. `server-lib/onboardingHelpers.js:101-103` exports `effectiveSeatCap`; `api/companydata.js` lost its own `SEAT_CAP_BY_TIER` and calls it at `:362,392,457,582`; `platformBusiness.js:105` uses it, so the Seats card reports what enforcement uses and an unknown tier is basic in both. `tests/unit/seat-cap-source.test.js` (5 tests) pins one source and the Admin Panel copy; the copy test was shown to fail with advanced changed to 60. Left on purpose: `api/admin.js:355` keeps `planSeatCap`, and `src/AdminPanel.jsx:56` stays a copy, now test-pinned. §3 planSeatCap consumer row moved from broken to fine. Not marked merged. |
| 2026-09-29 | branch `founder-dashboard-health` | Deliberate non-connection added to §5: workforce-category custom documents appear in no Analytics panel, per Dillon (no Workforce analytics view). Re-check evidence cited there. Map only, no code touched. |
| 2026-09-30 | branch `claude/fora-document-assignment-review-a0j8z7` | Gatehouse removed entirely by Dillon's decision (separate project): `api/gatehouse.js`, `src/GatehouseBooth.jsx`, `src/GatehouseDashboard.jsx`, `server-lib/gatehousePdf.js`, `docs/schema/gatehouse-migration.sql`, the Login routing, the Admin Panel Pricing tab and the `gatehouse-uploads` upload entry are deleted. Live `gatehouse_*` tables and the bucket are dropped after merge. Map: surface #18 retired (23 surfaces now, was 24 rows), its §5 non-connection rewritten, offline-queue producer count 11 to 10, MRR note trimmed. Archive artifact: https://claude.ai/artifact/JHsEaSAYpED6ZwymGNAXX4, code recoverable at commit `023b9bb`. Map only, no code touched here. |
| 2026-09-30 | branch `claude/step1-autofill-name-stamp` | **Break #3 coverage corrected for FLHA; name stamp placed.** The map said `submitted_by_roster_id` was on all nine document tables since PR #118, but `api/flhas.js` never wrote it until this branch (`:426`, import `:10`). Also new: `stampAuthorName` overwrites free-text name columns with the roster name on every submit handler (`server-lib/authorStamp.js:57-63`; call sites listed under #3). `incidents`/`near_misses` `occurred_at` is now a datetime-local string for new rows (`src/occurredAt.js`, column stays text; `api/reports.js:173-174` allowlist unchanged), so old and new rows differ in shape: a consumer that parses it must tolerate both (no consumer of `occurred_at` for date math verified, `?`). No new break filed. Map only, no code touched. |
| 2026-09-30 | branch `claude/step3-owner-profile` (uncommitted) | **Owner profile, company structure and default site placed on the map.** New roster columns `is_owner`, `title`, `divisions`, `default_site_id`; new tables `company_departments`, `company_divisions`. (1) `roster.departments` now accepts per-company `c_` keys (`server-lib/companyStructure.js:38-60`), Portal validation follows (`api/portal.js:95-100`); the phase-1 rows in that section are marked stale. (2) **Closed:** onboarding approval used to write no `departments`; it now does (`onboardingApproval.js:313`, `onboardingRoster.js`), so a new Portal customer's supervisors route from day one. (3) New join key `roster.default_site_id` -> `sites.id` (§2 site section): nine forms preselect it, but five copy the site name into free text, so break #2 is unchanged. (4) New weak links W1-W4 in the `roster.departments` section (W1: deleting a custom department leaves its key on Portal documents, escalations and schedules, `companydata.js:1157-1169`). (5) `roster.divisions` has no consumer, filed as pending link P2. (6) Onboarding also seeds the contact as Account Owner (`onboardingRoster.js:34-51`). Owner-only gating of profile edits (`companydata.js:953-955`) is tenant-scope territory and was not reviewed here. No matrix cell changed. |
| 2026-09-30 | branch `claude/step-pin-setup-links`, `624ef31` | **Set-your-own-PIN link placed on the map.** New surface #25 and a §2 section with the producer/consumer table. `create_wallet_invite` / `redeem_wallet_invite` are gone; the stale references were re-anchored, not deleted: #24's flag row and test row (`api/login.js:774-775`, `src/WalletInvite.jsx:81,124-125,304,368`), the §5 wallet-invite bullet, the #3 pointer to `WalletInvite.jsx`, and the `last_login_at` writer, which was stale map-wide (`login.js:514`, now `mintRosterSession` at `:437`; the "wallet redemption mints a session without setting it" weak point is fixed because the link's session stage goes through `mintRosterSession`, `:772`). Five new §5 non-connections. **New break #43** (`pin_set_at` has one writer, so typed, reset and pre-existing PINs show "Waiting for PIN"). Not verified: migration applied live; `tests/wallet-invite.spec.js` against this commit. `send_pin_setup_link` fetches by `id` alone (`companydata.js:726`) but is company-checked by `canResetMfa` (`rosterMfa.js:198`), so not filed. All line numbers are against commit `624ef31`; commit `6c30667` (another session, landed after this pass read the code) changed `api/companydata.js` adds a 30 per hour per company throttle on `onboard_new_employee` and clears the link on deactivate; `server-lib/setupLinks.js` sanitises name and company in the email), which shifts `companydata.js` lines after about `:488` by 5. Re-anchor those. Not built, not approved. |
| 2026-10-06 | branch `claude/step4-company-name-login`, `b2044ee` | **Company-name login placed on the map.** New §2 section "Login and session" with file:line for search_companies, list_roster_names, roster_login, master_login, unlock_roster_pin plus the derived `locked` flag, `server-lib/sessionTtl.js` (supervisor 12h, other 7d, 13 api files) and supervisor localStorage persistence. Stale entries rewritten: Portal shared-code fallback (§2 Portal scoping), `list_sites` defaultSiteId note, Portal-reports shared-code note, break #3 'two of three companies on shared logins' (now `?`: live roster counts unknown), and the §5 `app_type` note. Mechanical checks run, no new break. Line numbers cited elsewhere for `api/login.js` after about :430 (e.g. `last_login_at` is now :435, not :437; `pin_link_*` lines shifted) and `companydata.js` after about :700 are against older commits, re-anchor on next sweep. Map only, no code touched. |
| 2026-10-06 | branch `claude/step4b-company-code-login`, `bc446a0` (anchored against `2724f83`) | **Login step 1 is a company code, not a name search.** The §2 "Login and session" section is rewritten: `find_company` (`api/login.js:508-530`, exact case-insensitive `company_code`, shape `[A-Z0-9-]` 6-32), throttles `clookup:` and `ccode:` in `master_code_ip_limits`, `peekIpThrottle` (`server-lib/ipThrottle.js:52`) and `ipBucket` (`:69`, IPv6 to /64, wraps five throttle keys), Owner recovery `request_unlock_link` (`:561-589`), `pin_link_set_pin` clearing the authenticator lock (`:858-861`). `company_code` is a login-finding key again (it was recorded as internal-only); its readers and four writers are tabled with the case-insensitive clash checks from `9861cc0`. Stale anchors re-pointed map-wide (the login.js file shifted by up to 100 lines): `master_login`, the PIN-link block, `mintRosterSession`, `claim_get_details`, `claim_set_roster_pin`, the ADMIN_CODE entry, the onboarding people_encrypted write and read; changelog rows left as history. **New break #44** (auto-generated company code can fail the login regex). Mechanical checks re-run, nothing else new. Map only, no code touched. |
| 2026-10-06 | branch `claude/assignments-enforcement`, `ae9aee4` | **Document assignments and supervisor scope placed on the map.** New table `document_assignments` (migration not applied live, `?`) and new column `sites.division_id`; new `server-lib/documentAccess.js`. New §2 section with the join table and the per-surface enforcement lines; new matrix block; §5 non-connection for the five unenforced built-in keys; new pending link P3 (`queuedAt` not sent by any client); P2 updated (`roster.divisions` now has a reader). **Four new breaks, all OPEN: #45** (no code writes `document_assignments`; rule A is live without it), **#46** (nothing writes `sites.division_id`, and the migration's claim that `companydata.js` validates it is false), **#47** (Portal enforced on submit only; the worker menu action `get_worker_portal_documents` is unwrapped and the `menuAccessFor` call at `portal.js:344` is in an admin-only action), **#48** (`list_corrective_actions` and `get_worker_profile` bypass rule A). Correction to the brief: the Portal worker-menu wrap is not in place. Map only, no code touched. |
| 2026-10-06 | branch `claude/assignments-enforcement`, `89e8e52` | **Delta pass after the enforcement follow-up.** Fixed and verified in code: #47 worker-menu half (`portal.js:485`) and portal `view` rows (refused by `documentAccess.js:65-69` and migration CHECK `:55`); #48 `get_worker_profile` half (`companydata.js:964-978`). #47 narrowed to supervisor Portal reads, still department-only (`portal.js:759-763,811-813,1093`); #48 narrowed to `list_corrective_actions` / `update_corrective_action` (`monthly.js:704-706,895-898`). New enforcement in matrix: `check_equipment` (`logs.js:338`, `fuellogs.js:124`), `get_active_form` (`monthly.js:248`), `list_open_toolbox` supervisor scope (`logs.js:770-774`), `get_toolbox_detail` worker notes dropped (`logs.js:799`), `sign_late_toolbox` supervisor record scope (`logs.js:860`). `queuedAt` now honoured only with a `clientSubmissionId`, window 48h, still client-supplied (`documentAccess.js:48,84-87`): filed as an unnumbered weak link, signed stamp planned for PR 2. Migration CHECKs on `document_key` (`:53`) and portal view (`:55`) noted in #45. #45 and #46 re-verified unchanged: no writer for `document_assignments` or `sites.division_id`; `isAssignableAction` has no caller. Stale line cites in the assignments section refreshed. No new numbered break. |
| 2026-10-06 | branch `claude/assignments-ui`, `e8ccde0` | **Assignment writers, hide-unassigned, worker-menu "Assigned to you" and client `queuedAt` placed on the map.** (1) **#45 and #46 CLOSED in code** (merge and live migration pending, `?`): `list_document_assignments` / `create_document_assignment` / `end_document_assignment` / `set_site_division`, Owner or founder only (`api/companydata.js:1363-1444` at the committed head), ids validated in `server-lib/assignmentAdmin.js:75-123`; screens `src/DocumentAssignmentsManager.jsx` (mounted `Dashboard.jsx:7880`) and "Sites by division" in `src/CompanyStructureManager.jsx:88-104`. (2) New column `roster.hide_unassigned` (`docs/schema/roster-hide-unassigned-migration.sql:14`, **not applied live**), read in `documentAccess.js:127,160` with a missing-column retry (`:120-131`), enforced for `submit` only (`:202-204`), set by `update_worker_profile` `hideUnassigned`, Owner only (`companydata.js:1047-1051,1123-1126`). Limit filed in §2: it does not hide Time Clock, Certifications, Equipment Reports, Maintenance or Equipment Compliance (`:269`). (3) Worker menu: `assigned` entries with `dueAt` and `completedAt` from `get_worker_documents` (`customforms.js:407`) and `get_worker_portal_documents` (`portal.js:489`), completion derived from `submitted_by_roster_id` (`documentAccess.js:434-454`), rendered first in `WorkerMenu.jsx:622`; an anonymous near miss never shows done (`authorStamp.js:36`). (4) **P3 CLOSED:** all ten forms send `queuedAt` via `queuedAtFor` (`offlineQueue.js:209`); the 48h reach-back on a handcrafted request stays as a weak link under #48, and the two stale comments in `documentAccess.js` were corrected in `04abb29` (`:30-31,81-83`). (5) **Corrected on the committed head (`c8499af`, after `e8ccde0`):** `delete_department`, `delete_division` and `delete_site` do NOT end assignments, they REFUSE while an active row names the audience (`assignmentsNamingAudience`, `assignmentAdmin.js:160`; `companydata.js:1298-1302` and `:1342-1346` return 409, `:1521-1523` adds it to the site's 400 blockers), because ending the rows would leave none, which means not narrowed, so the document would open to everyone. `endAssignmentsForAudience` is gone. `update_worker_profile` also clears `roster.hide_unassigned` on promotion to Owner, only when it is on (`companydata.js:1104-1110`, via `readHideUnassigned`, `documentAccess.js:407`). Weak links, no new break: hide-unassigned covers only assignable documents (`documentAccess.js:269`), and the 409 depends on the Document assignments screen to be actionable. No cascade and no block for `individual`. P2 gets an update note (divisions now consumed). #47 and #48 unchanged and still OPEN (`portal.js` and `monthly.js` record handlers not touched by this commit; `grep -n "listVisibleRecords\|requireRecordsAccess" api/portal.js` re-run, empty). Citations into `documentAccess.js` and `companydata.js` elsewhere in the map may be off by up to 54 and 99 lines respectively; the §2 assignment section is fully re-anchored. No new numbered break. Re-anchored 2026-10-06 against the committed head; the earlier caveat about uncommitted edits is resolved (they are `c8499af`, plus the `queuedAt` finite guard in `src/offlineQueue.js`). |
| 2026-10-06 | branch `claude/lead-role`, `507c7cc` (on `claude/assignments-ui`, `17b85e6`) | **Tasks versus restrictions and the crew lead placed on the map.** (1) `17b85e6`: `document_assignments.restricts` (default false). A task puts a document on the person's "Assigned to you" list and narrows nothing; only a restricting row narrows (`documentAccess.js:216-224`); view rows always restrict (`assignmentAdmin.js:125`, migration CHECK `:63`); delete refusals count restricting rows only (`assignmentAdmin.js:168,179`). New hazard recorded: the migration was edited in place with no `alter table`, so a database that already has the older table never gets `restricts` and every read silently returns no rows (`42703` is in `isMissingSchema`, `documentAccess.js:71-74`). Live state `?`. (2) `507c7cc`: new §2 section `roster.is_lead` + `entered_by_roster_id` (migration not applied live, `?`): `server-lib/leadAccess.js` (`requireLead`, `inCrew`, `loadCrew`, `resolveOnBehalf`), `loadActor` reads `is_lead` with column fallbacks (`documentAccess.js:125-135,166`), `requireAssignment` holds a lead to view rows (`:263`), `get_my_crew` / `lead_assign_task` / `lead_end_task` / `lead_list_tasks` / `update_worker_profile isLead` (Owner only, workers only, cleared on promotion to supervisor), FLHA list and approve open to a lead (own record refused, sign-off name from roster), `get_crew_documents`, on-behalf Daily Report and Fuel Log (`logs.js:376-381`, `fuellogs.js:173-177`), client `CrewScreen` / `FillingInFor` / "My crew" card / Crew lead checkbox / `FLHACard` now exported. Weak points W-L1 to W-L7 recorded as verified, unnumbered; two §5 non-connections added; four matrix rows added; line shift table added to the assignments section. **Not placed:** uncommitted working-tree edits seen during this pass (`by_lead`, `crewIdSet`, second-lead refusal on approve), which target W-L4, W-L5 and W-L6. No break opened or closed. |
| 2026-10-06 | branch `claude/auditor-role`, `46553fb`, review fixes `6ad7e0a` (on `claude/lead-role`) | **Auditor role placed; lead role brought current.** (1) **Lead follow-ups now on the map, W-L4, W-L5 and W-L6 CLOSED:** FLHA list and `get_crew_documents` are crew-authored only through `crewIdSet` (`server-lib/leadAccess.js:78-88`, `flhas.js:488-492`, `customforms.js:487-489`; an anonymous near miss no longer reaches a lead at all); FLHA approve refuses own, a non-crew author (supervisor, Owner, unstamped), another lead's and an already-signed FLHA, and signs with the roster name (`flhas.js:610-631`); lead tasks write `document_assignments.by_lead` (`companydata.js:1655`, column in `roster-lead-migration.sql:22-27`), `evaluateAccess` now checks restrictions before the hide switch and the hide branch ignores `by_lead` rows (`documentAccess.js:210-222`), and `lead_assign_task` refuses a document the target cannot already submit (`companydata.js:1645-1646`). `get_crew_documents` now reads the shared `DIRECT_SOURCES` (`documentSources.js:11-23`). (2) **`restricts` hazard closed in the migration file:** `document-assignments-migration.sql:71-82` adds the column with `add column if not exists` and the view-restricts check as the named constraint `document_assignments_view_restricts`; a database that skipped the re-run still silently stops narrowing (check query recorded). New hazard: `lead_assign_task` inserts `by_lead` with no 42703 tolerance. (3) **Auditor placed (surface #26, new section before `source_type`):** `roster.role = 'auditor'`, `roster.auditor_access_expires_at`, `auditor_scopes` (`docs/schema/auditor-migration.sql`, **not applied live, `?`**), `api/audit.js` (scope applied in the query by `site_id` and document key), `server-lib/auditorAccess.js`, `server-lib/documentSources.js`, 13 `verifySession` copies return null for the role, login refuses an auditor with ended access (`login.js:446,694`), MFA required (`rosterMfa.js:27`), 12 hour token (`sessionTtl.js:23-24`), five Owner actions (`companydata.js:1473-1590`), seat counts exclude auditors, bulk setup send skips them, `AuditorsManager.jsx` / `AuditorView.jsx` / `Login.jsx:383-388`, sessionStorage only. Weak points A-W1 to A-W7 recorded, unnumbered (equipment inspections and site-less records not auditable; 24 hour single-use link, not a typed password; no `AccountSecurity` for an auditor; Portal and corrective actions not auditable; migration not applied; **new: custom forms ignore their own on/off setting**; auditor names appear on the login list). **Correction to the brief:** at `46553fb` `canResetMfa` did not let an Owner act on an auditor (founder only); `6ad7e0a` fixed it (`rosterMfa.js:200`). Three §5 non-connections and four matrix rows added. No numbered break opened or closed. |
| 2026-10-07 | branch `claude/sign-afterwards`, `c74082b` (PR #183, on `claude/auditor-role`) | **Worker signs afterwards placed on the map (map only, no code touched).** New §2 section for `awaiting_signature` / `signature_requested_at` / `worker_signed_at` on `flhas`; migration `docs/schema/sign-later-migration.sql` also adds them to `incidents`, `inspections`, `near_misses` and is NOT applied live (`?`); only FLHA uses the columns (`api/flhas.js`, `server-lib/signLater.js`). Producers and consumers placed: `submit` sign_later (`flhas.js:470-481`), `my_unsigned` (`:519`), `sign_now` (`:544`), approve block (`:703-708`), `list` (`:581`), `SignAfterwards.jsx`, WorkerMenu card, Dashboard FLHACard, CrewScreen. Fail-closed without the migration confirmed in code. **Twelve weak points W-S1 to W-S12, none numbered or approved**: the flag is read by the FLHA tab only, so the auditor list (`documentSources.js:12`, `audit.js:102`), the crew lead document list (`customforms.js:444`), My Documents (`customforms.js:522`), worker profile (`companydata.js:928`), Analytics and Overview counts (`Dashboard.jsx:4320,6731`), status colours (`:5550,5852`), bulk export (`:2485`) and the supervisor `update` action (`flhas.js:606`) all treat an unsigned FLHA as a finished one; the 24 hour overdue helper has no caller (`signLater.js:106`). Matrix FLHA row re-anchored to `flhas:501`. Older FLHA line anchors in the lead section are stale by this branch's edits (noted in the new section). |
| 2026-10-07 | `0a1d7db` (on `961dc92`) | **Near miss follow-ups verified closed (map only).** Re-read in code: `runReportFollowUps` holds the incident / near miss Brain signal and corrective actions until signed (`api/reports.js:102-129,381,438`); `get_my_documents`, `get_worker_profile` and the monthly corrective-action source lookups return `awaiting_signature` and the UI labels it (`MyDocuments.jsx:213`, `WorkerProfileDrawer.jsx:264`, `Dashboard.jsx:1943`); `reviewBacklog` reports `awaitingSignature` with counts unchanged (`analyticsUtils.js:38`). NM-1 to NM-5 and W-S3, W-S4 closed; NM-6, NM-7 unchanged non-issues. New NM-8 (selects unguarded against a missing column). Still open: W-S5 to W-S10, W-S12. Same commit also adds company_id scoping to supervisor edit/delete in `reports.js` (not a join; noted, not mapped). |
| 2026-10-07 | working tree on `baa69e9` (uncommitted near miss sign afterwards) | **Near Miss sign-afterwards placed on the map (map only, no application code touched).** A named near miss with no signature, or `sign_later: true`, is saved awaiting (`api/reports.js:311-320`); anonymous never (`:312,315`, CHECK `sign-later-migration.sql:54-58`). New subsection with the join table (`my_unsigned`, `sign_now`, supervisor list, review and edit 409 blocks, auditor hide `audit.js:111`, crew lead label `customforms.js:511`) all verified. **Corrected stale text:** the §2 sign-afterwards paragraph said only FLHA writes the columns; Incident (`reports.js:315`), Inspection (`logs.js:622`) and Near Miss do too, W-S1 and W-S2 are fixed in code for signable sources, W-S11 marked superseded; W-S3 to W-S10 not re-verified for FLHA. **Near miss consumers still not labelling an unsigned row, NM-1 to NM-7, none numbered:** My Documents (`customforms.js:541,583`), worker profile (`companydata.js:939,995`), corrective actions opened at save and listed unlabelled (`reports.js:375-382`, `monthly.js:783`), Brain signal at save (`reports.js:346-359`, by design), Analytics and review backlog counts (`analyticsUtils.js:31-36`), platform counts. Mechanical checks: `BUILTIN_DOC_KEYS` and `pricing.js` both carry `nearmiss` (match), `source_type:` writers unchanged (8), no new cron, no new table, `sign-later-reports.test.js` 12 pass. No new numbered break. |
| 2026-10-07 | branch `claude/notify-routing-core`, `d4487d2` | **Notification routing PR 1 placed on the map (map only, no application code touched).** New table `document_notifications` (`docs/schema/document-notifications-migration.sql:26-36`, not applied) and `server-lib/notifyRouting.js`, which reuses `recordInScope` (`documentAccess.js:331`) and `inCrew` (`leadAccess.js:36`) and reads `roster.departments/divisions/default_site_id/is_lead/is_owner/email`, `sites.division_id` and `submitted_by_roster_id` (`notifyRouting.js:140,153,85`). No caller yet: recorded as pending link P4 (§4), not a break; new §2 section with the join table and weak points W-N1 (`view` assignment rows not consulted, so the "exactly who could open it" header overstates), W-N2 (no `isDocKeyActive`), W-N3 (custom label generic). Mechanical checks: `BUILTIN_DOC_KEYS` (`customforms.js:132`) and `pricing.js` `docKeys` (`:65-114`) unchanged and matching, `source_type:` writers in `api/` still 8, no new cron, no new `api/` file, `isDocKeyActive` in `api/cron-*.js` unchanged. The table's CHECK keys are a subset of `BUILTIN_DOC_KEYS` plus `custom_<n>`, by design. No new numbered break. |
| 2026-10-07 | branch `claude/notify-routing-core`, `1488a5b` (on `d4487d2`) | **Notification routing cooldown placed on the map (map only, no application code touched).** Second table `document_notification_state` (`docs/schema/document-notifications-migration.sql:48-55`, PK `company_id, document_key, roster_id`, `last_sent_at`, `suppressed_count`, RLS on `:57`) and a 10 minute per-person per-document cooldown in `server-lib/notifyRouting.js` (`COOLDOWN_MS` `:68`, `applyCooldown` `:279-289`, `loadState` `:291-300`, `saveState` `:302-307`, wired in `notifyOnSubmit` `:316-354`). **Both tables are about to be applied live; neither is confirmed applied, so both stay `?`.** The state table fails closed (read error sends nothing, `:322`) where the settings table fails open to off (`:184`), recorded as W-N4; W-N5 (read-then-write not atomic) and W-N6 (held notices unseen) added, unnumbered. `notifyOnSubmit` now returns `held` (`:349`). §2 notifyRouting section and P4 re-anchored to the new line numbers (the file grew from about 230 to 354 lines, so every old `notifyRouting.js` citation had shifted). Still no caller, still pending P4, not a break. Mechanical checks: `BUILTIN_DOC_KEYS` (`customforms.js:132`) and `pricing.js` `docKeys` (`:65-114`) unchanged and matching; `source_type:` writers in `api/` still 8; `grep -n isDocKeyActive api/cron-*.js` returns nothing at this commit (the gate lives in `server-lib/docKeyGate.js` and is called from `api/equipmentreports.js`, `customforms.js`, `audit.js`, `companydata.js`; not re-verified against the older map claim about `cron-equipment-reports.js`, `?`) and `notifyRouting.js` has none (W-N2); no new `api/` file (22) and no new cron; usage-reading query sites unchanged (`maintenance.js:174,207`, `fuellogs.js:137,146`, `equipmentreports.js:432`). No new numbered break. |
| 2026-10-07 | branch `claude/notify-wire-incident-nearmiss`, `1475b5e` (map text from `main`; PR #190 digest cron not included and not merged) | **Notification routing PR 2 placed on the map (map only, no application code touched).** First real caller of `notifyOnSubmit`: `notifyAudience` in `api/reports.js` (`:151-170`), incident and near miss only (`:153`), called after submit when not sign-later (`:422-428`) and after `sign_now` (`:488`). Join keys read at the call site: `session.companyId` (`:162`), `recordToInsert.site_id` after `resolveSiteId` (`:357-359,425`) or the stored `row.site_id` on sign_now (`:482,488`), `authorRosterId` (`:409,426`) or stored `submitted_by_roster_id`, and `sites.name` looked up company-scoped (`:157`). Sign-later: notice goes out when signed, not when saved, once per record (second `sign_now` is a 409, `signLater.js:92`). W-N2 satisfied for this caller (`requireDocKey` `:304,467`). P4 and the §2 section updated: two of eight document types wired, PR 3 (FLHA, inspection, daily, toolbox), PR 4 (monthly, custom), PR 5 (Owner toggle) still open, so no company can switch it on yet. Mechanical checks: `BUILTIN_DOC_KEYS` (`customforms.js:132`) and `pricing.js` `docKeys` (`:65-114`) unchanged and matching; `grep -rn notifyOnSubmit api` lists `reports.js` only; `document_notifications` / `document_notification_state` have no reader or writer outside `notifyRouting.js`; `grep -n isDocKeyActive api/cron-*.js` empty, no new cron, no new `api/` file. No new numbered break. |
| 2026-10-07 | branch `claude/notify-digest-cron`, `f64a993` | **Notification digest cron, slot refund and health registration placed on the map (map only, no application code touched).** New cron `api/cron-notification-digest.js` (`*/10 * * * *`, `vercel.json:10`) runs `runDigest` (`server-lib/notifyDigest.js:64`) over the new live function `claim_held_notices`; `refundSlot` (`server-lib/notifyRouting.js:321`, calls live `refund_notification_slot`) gives back a failed send's slot and held count (`:371`, `notifyDigest.js:117`). **W-N6 CLOSED** (held notices reported within about one window plus one cron interval, 10 to 20 minutes, batch-limited to 200 rows). Registered in platform health (`platformHealth.js:44`, subtype matches `cron-notification-digest.js:35`). Mechanical checks: `vercel.json` crons and `CRONS` match 4 for 4; `grep isDocKeyActive api/cron-*.js` empty (true of all four crons, so not an outlier); `grep -rn "source_type:" api/` unchanged at 8 writers, none new. **New W-N7** (digest has no doc-key gate, same shape as W-N2, low). Notice flow is still idle: `notifyOnSubmit` has no caller and nothing writes `document_notifications` (P4 unchanged). Live function state is from the migration header, not re-queried (`?`). |
| 2026-10-07 | branch `claude/notify-wire-flha-logs`, `1ebc5ec` (on main with PRs #189, #190, #191) | **Notification routing PR 3 placed on the map (map only, no application code touched).** New shared helper `server-lib/notifyAudience.js` (moved out of `api/reports.js`, which now imports it, `reports.js:17`); `WIRED_DOCUMENT_KEYS` = incident, nearmiss, flha, inspection, toolbox, daily (`notifyAudience.js:24`). New callers: `api/flhas.js:515` (submit, not sign-later) and `:572` (sign_now); `api/logs.js:689` (submit; inspection only when not sign-later; toolbox and daily always) and `:755` (inspection sign_now). Six of eight document types wired; still unwired: monthly and custom forms (PR 4) and the Owner toggle writer (PR 5). Call-site join-key table added: `site_id` comes from `resolveSiteId`-validated `recordToInsert.site_id` for incident, near miss, FLHA, toolbox and daily; **inspections carry no site** (`logs.js:131-137`, `site_id` not submittable `:185`) so they are placed by author alone; toolbox and daily filed without `site_id` (free-text `site` only) are routed as site-less. Sign-later: FLHA and inspection notify at `sign_now`, not at save, once per record (second `sign_now` is a 409, `signLater.js:92`); toolbox and daily have no sign-later. Gate order: all six callers sit behind `requireDocKey` for the same key. P4 and the §2 notification section re-anchored (the old `reports.js:151-170` helper anchors no longer exist). Mechanical checks: `BUILTIN_DOC_KEYS` (`customforms.js:132`) and `pricing.js` `docKeys` (`:65-114`) unchanged, all six wired keys present in both; `grep -rn notifyAudience api` lists `reports.js`, `flhas.js`, `logs.js` only; `grep -rn "document_notifications\|document_notification_state" api src` empty, so still no writer; no new `api/` file, no new cron, no new table. Open `?`: whether `recordInScope` places a site-less inspection in a site-scoped supervisor's audience (not traced); `runInspectionFollowUps` error behaviour before the sign_now notice. **Uncommitted working-tree edits also seen and placed (not in `1ebc5ec`, so anchors for `flhas.js` after `:406` and `logs.js` after `:692` are working-tree lines):** a third FLHA call at `api/flhas.js:407-415` (amendment that newly moves the record to `pending_approval`, site from the amendment or the stored row) and a `skipId` (`notifyAudience.js:26,42`, `notifyRouting.js:165-168,185`, `logs.js:692`) so a lead who typed a record in on a worker's behalf is not emailed about it. Re-verify after they commit. No new numbered break. |
| 2026-10-07 | branch `claude/notify-wire-monthly-custom`, `c9d0049` (PR #193, on main `8051c07`) | **Notification routing PR 4 placed on the map (map only, no application code touched).** New callers of `notifyAudience`: `api/monthly.js:500` (`submit_monthly`, key `monthly`) and `api/customforms.js:733` (`submit_custom`, key `custom_<formId>`, `documentLabel` = form title `:736`). `WIRED_DOCUMENT_KEYS` gains `monthly`; custom keys are accepted by the `CUSTOM_KEY` pattern (`notifyAudience.js:24,26,30`), which matches the table CHECK `custom_[0-9]+`. `site_id` provenance: both require a `siteId` and 403 unless it is a company-owned `sites.id` (`monthly.js:316-319`, `customforms.js:646-649`), and the same id is inserted on the record, so neither can be site-less. `authorId` = `authorRosterId(session)`, same as the stamped row. Gate order verified: monthly `requireDocKey` `:296` then `requireAssignment` `:298`; custom `requireCustomDocKey` `:660` then `requireAssignment(custom_<id>)` `:662`, both before insert and before notify. **W-N2 holds for both**; W-N3 narrowed (immediate email names the form, digest still says "Custom document", `notifyDigest.js:92`); W-N7 now also covers monthly and custom. Digest cron needs no change for custom keys (`document_key` is plain text through the claim and `runDigest`). **New observation, not a numbered break: Fuel Log (`fuellog`) is the only key in `DOCUMENT_LABELS` with no caller** (`fuellogs.js` has no `notifyAudience`); earlier "six of eight" counts in this map omitted it. Promotes to a break if the PR 5 toggle ships first. Mechanical checks: `BUILTIN_DOC_KEYS` now at `customforms.js:133` (shifted one line by this diff's import, list unchanged) and `pricing.js` `docKeys` untouched, still matching; `grep -rn notifyAudience api` now lists reports, flhas, logs, monthly, customforms; `document_notifications` still has no writer outside `notifyRouting.js`; no new `api/` file, no new cron, no new table. No new numbered break. |
| 2026-10-07 | branch `claude/notify-wire-monthly-custom` (PR #193) | Fuel Log removed from the notify list (labels, migration file, both live `document_key` CHECKs; zero rows existed). Digest names custom documents by form title. P4 Fuel Log watch and W-N3 closed. |
| 2026-10-07 | branch `claude/notify-owner-toggle`, `6afe46b` (PR #194, uncommitted map edit) | **Notification routing PR 5 placed on the map (map only, no application code touched).** First writer of `document_notifications`: `server-lib/notifySettings.js:73`, actions `list_document_notifications` / `set_document_notification` (`companydata.js:1417,1422`, Owner/founder via `canManageCompany`, `:1389`), UI `src/NotificationSettings.jsx` (`Dashboard.jsx:7957`). P4 closed; offered list verified against `WIRED_DOCUMENT_KEYS` and `notifyAudience` callers; list verified to share `listAssignableDocuments` with the assignments screen. New weak points W-N10 (extras not site-scoped) and W-N11 (a switch stays on and cannot be turned off after its document is switched off, digest keeps sending); W-N7 re-checked, still open, not fixed by PR 5. No numbered break opened. |
| 2026-10-07 | branch `claude/notify-owner-toggle` (PR #194, final commit) | Digest drops held counts for a document the company has switched off (built-in without an active settings row, custom form missing, inactive or switched off), closing W-N7 and W-N11; the lookup failing refunds every row. Always-tell wording changed (W-N10). |
| 2026-10-07 | branch `claude/unsigned-escalation`, `2a90e83` (PR #195, uncommitted map edit) | **Unsigned escalation placed (map only, no application code touched).** `unsigned_alerted_at` and `unsigned_closed_at` on the four sign-later tables; `server-lib/unsignedSweep.js` run inside `api/cron-notification-digest.js:47-48` (no new cron, `vercel.json` still four). Limitation "a record nobody signs is never announced" CLOSED (24 hour heads-up through `routeNotification`, close at 10 days). Every `awaiting_signature` reader re-grepped; a closed record keeps `awaiting_signature = true`, so Notifications, Brain, Corrective actions, readings, auditor and supervisor paths exclude it as before. **New break #49** (closed record can never be reviewed/approved and still counts as outstanding in the review tabs and Analytics) and weak points U-1 to U-5. W-S10 superseded. Live migration state not re-queried (`?`). |
| 2026-10-07 | branch `claude/weak-points-ws` (PR #196, `2f78e24`, uncommitted map edit) | **Sign-later weak points closed on the map (map only, no application code touched).** W-S1 (`audit.js:111`, `documentSources.js:16,19,20,27`), W-S2 (`customforms.js:453-456,514-517`, `CrewScreen.jsx:200`), W-S5/W-S6/W-S7 (`analyticsUtils.js:50,53,136,313`, `Analytics.jsx:159`, `Dashboard.jsx:2507-2512,4294,4351-4358,5586-5589,5891`) closed; W-S8 re-read and closed (`flhas.js:660,742`); W-S10 and W-S11 superseded; W-S12 (b) verified (`App.jsx:28,61,63,963,966`, `offlineQueue.js:72-80`, `WorkerMenu.jsx:35`), (c) fixed; W-S9 stays a recorded decision. **#49 recorded RESOLVED** (Dillon decision A, shipped in #195). **New: W-S13**, undefined `rec` at `Dashboard.jsx:5902,6043` in the new badge. Cited lines in matrix rows re-anchored. |
| 2026-10-07 | branch `claude/portal-reads`, `d92db3f` (PR #199, uncommitted map edit) | **#47 fixed in PR #199 (map only, no application code touched).** Portal supervisor reads go through rule A: `scopeRecords` at `portal.js:779`, `requireRecordScope` at `:831`, `:1125` (update / delete), `:1353` (email). Approved by Dillon 2026-10-07. Guard test 5/5 pass. Not marked closed until merge. Deliberately unchanged: Portal escalations (department-routed), `get_crew_documents` (W-L3), no Portal `view` row. Open and not filed: department digests mail records without rule A on the recipient side (`portalReports.js:87-103`), Dillon's call. No new numbered break. |
| 2026-10-07 | branch `claude/corrective-scope`, `61044ae` (PR #200) | **#48 fixed in PR #200 (map only, no application code touched).** Corrective actions follow the record they were raised on: new `server-lib/correctiveActionScope.js`, `list_corrective_actions` filtered through `listVisibleRecordsMulti` (`monthly.js:900-905`), `update_corrective_action` through `requireActionAccess` (`:929`); `node --test tests/unit/corrective-action-scope.test.js` 5 pass. Left open on the read side: `equipmentPatterns` (`monthly.js:908`) is built from the unscoped set and carries `sampleDescription`, filed as **#50** (weak point, Dillon's call); `list_records` / `get_record_detail` counts, maintenance, Brain and Analytics verified fine. **#49 recorded as resolved by decision A** (closed-unsigned excluded from counts: `analyticsUtils.js:34-35`, `Dashboard.jsx:4876,4911,5392-5393`). **Dillon's decision recorded:** Portal escalations, scheduled digests and `email_portal_record` recipients are department-routed by design (section 5, #47 entry). Matrices and rule A tables updated. Not marked closed until PR #200 merges. |
| 2026-10-08 | branch `claude/corrective-scope`, `0cacb6f` (PR #200) | **Map re-anchored to the final PR #200 code (map only).** #50 (`equipmentPatterns` unscoped) closed in code by `0cacb6f`: `patternsByEquipment(visible.records)` `monthly.js:910`. A missing action id now reads 403 "Not allowed." like a denied one (`monthly.js:928-929`), tests 7 pass. Citations moved: update handler `:915`, access check `:931`, `get_worker_profile` scope `companydata.js:973-985`. Deliberate residue recorded under #48: recurrence counts span the whole company history (counts only), inspection actions are placed by author only (no `site_id` on inspections). Dillon's 2026-10-07 decisions confirmed in section 5 and the #47 entry (Portal escalations, scheduled digests, `email_portal_record` recipients department-routed by design); #49 resolved by decision A. New breaks: none. Not marked closed until PR #200 merges. |
| 2026-10-09 | branch `claude/document-engine-wp3-rules` (WP1 and WP2 merged, WP3 uncommitted; map only, no application code touched) | **Unified Document Engine placed.** New surface #27 and an engine section in §2 with six join keys (`engine_<id>` document key, `engine_document` source type, `site_id`, `submitted_by_roster_id`, `signer_roster_id`, `company_documents`), a matrix row, and a not-yet-connected table (assignments, auditor `DIRECT_SOURCES`, analytics, platform overview, corrective actions, readings, `requireDocKey`). **New break #51** (engine notification keys violate the `document_key` CHECK on `document_notification_state`, so claim-based engine emails never send; tests miss it because the RPC is faked), **#52** (WP3 columns and `document_escalations` exist only in the unapplied migration), weak points E-1 to E-3. Engine is dormant: no screen calls it. |
| 2026-10-09 | `main` at `03f60be` (WP7a #213, WP7b #214) plus branch `claude/document-engine-wp7c-server` `240d3b9` (unmerged); map only, no application code touched | **Engine section re-placed: no longer dormant.** Merged screens added (worker form and cards, Dashboard `enginedocs` inbox, worker inbox, resubmit keeping earlier file answers and accepting `pdfReceipt`). WP7c-1 rows added and marked unmerged: per-step follow-up retry (`service.js:454-489`, `sweeps.js:267-296`, `cron-notification-digest.js:59`), `get_record_links` / `links.js`, server-side attachment kinds plus Word/Excel on `portal-attachments`. New join-key row for storage paths. **E-3 closed** (`delete_site` blocks on engine records, `companydata.js:1789-1794`). **E-1 only partly handled**: the retry works for escalation-insert failures, but `notifyRecord`, `notifyPeople` and `writeBrainSignal` swallow their own errors so a lost email or Brain signal never marks the record failed; resubmit follow-ups untracked; abandoned silently after 5 attempts. New weak points E-4 (assignments and 48 hour reach-back ignored by the engine, `queuedAt` sent and never read), E-5 (auditor view), E-6 (id-bearing types refused). E-2 still open. Stale line cites in the engine section refreshed (service.js moved +71 lines). |
| 2026-10-09 | branch `claude/document-engine-wp7c-access`, `2da835a` and `42ad499` (on top of main with WP7c-1 #215; no PR number found; map only, no application code touched) | **Engine access placed (WP7c-2).** E-4 closed in code: engine documents are assignable keys `engine_<id>` (`documentAccess.js:61`, `assignmentAdmin.js:62`), submit enforced with the 48 hour reach-back through `body.queuedAt` (`documents.js:210`, `service.js:574`), view enforced in `requireRecordView`, `listRecords`, `myInbox`, `reviewRecord` and the worker menu with its `assigned` section (`service.js:405-413`). E-5 closed in code: auditors see filed engine records (`companyDocs.js`, `auditorAccess.js:129-137`, `audit.js:149-165`, signed PDF only). E-6 closed in code: `idAnswers.js` resolves equipment, attachment, site, person and linked-document ids against the caller's company with labels from the database, `get_picker_options`, `PickerControl.jsx`. **New break #53 (open): the `document_assignments.document_key` CHECK (`document-assignments-migration.sql:60`) refuses `engine_<n>`, so the Owner screen offers an engine document and the save fails; no migration on the branch; live constraint unread, `?`.** Remaining gaps kept: `get_document` not hidden from unassigned workers (design), a crew lead not narrowed by view rows in `myInbox` (`service.js:983`), E-2 (`topEngineFlagged` unshown), E-1 residual (email send failures and resubmit follow-ups not retried; the Brain-signal half is now retried, `service.js:460`). New not-connected: the crew lead's `get_crew_documents` omits engine records (`customforms.js:445`); stored equipment, site and person ids have no reader outside the engine. WP7c-1 relabelled merged and every service.js cite in the engine section refreshed (about +10 to +25 lines). Join-key tables updated: `equipment_id`, `site_id`, `roster_id`, `document_key`, `document_assignments`; matrix rows for the engine and the assignments table updated. |
