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
| 25 | Set-your-own-PIN link (roster onboarding; branch `claude/step-pin-setup-links`, `624ef31`, **migration `docs/schema/roster-pin-setup-link-migration.sql` written, not verified applied live**) | `src/WalletInvite.jsx` (route `/wallet`, `src/main.jsx:12`), `src/ClaimAccount.jsx`, roster rows in `src/Dashboard.jsx:7903-7909` and `src/AdminPanel.jsx:2366-2370` | producers `server-lib/onboardingApproval.js:140-167` (at company creation), `api/companydata.js:451` (`onboard_new_employee`), `:720` (`send_pin_setup_link`); consumer `api/login.js:694` (`pin_link_open` / `pin_link_set_pin`); lib `server-lib/setupLinks.js` | *(none, roster is platform base)* |

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
| Fallback (not a bug) | A **shared-code** supervisor session (no `session.userId` — a pre-cutover company login) has no individual roster row to scope by, so both read actions fall back to unfiltered-within-company, same as every other document type already shows a shared-code supervisor |

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

(Company Portal is a fourth `site_id` FK user: `api/portal.js:476-479,515-525` check `siteId` against `sites`; it was missing from this table.)

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
(`:1102`); a shared-code session gets `null` and no preselect, which is expected.

### `roster_id` → `roster.id` (the person)
| Feature | Link |
|---|---|
| Time Clock | ✅ FK `roster_id` |
| Certifications | ✅ FK, path-namespaced `certifications.js:130` |
| Every document form (primary signer) | ✅ `submitted_by_roster_id`, stamped server-side from the session (#3, fixed PR #118; **FLHA only from branch `claude/step1-autofill-name-stamp`, `api/flhas.js:428`**, it was missing before) |
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
ids get the same 403, shared-code supervisors have no department limit.
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
`login.js:600`, `portal.js:603,644`, `portalReports.js:66`).
`onboarding_requests.people_encrypted` is written `login.js:665,681` and
consumed `login.js:860-868` (edit link, blanked once approved) and
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

### The set-your-own-PIN link (`roster.pin_link_*`, `624ef31`, placed 2026-09-30)

Replaces the plaintext wallet invite. `create_wallet_invite` and `redeem_wallet_invite` no longer exist (`grep -rn "wallet_invite" api/ server-lib/ src/` returns only `tests/unit/wallet-invite-modules.test.js:10`, a comment). The old `roster.wallet_invite_token` columns stay in the table unused (`docs/schema/roster-pin-setup-link-migration.sql:2`). Re-check: `grep -rn "pin_link_jti_hash" api/ server-lib/ src/`.

**Key:** the link is a signed ticket `{purpose:'pin_setup', jti, rosterId, companyId}` (`server-lib/setupLinks.js:47-49`). The join is `roster.id` + `roster.company_id` **and** `roster.pin_link_jti_hash = sha256(jti)`, checked on open (`api/login.js:700-708`) and again inside the set-PIN UPDATE's WHERE (`:763`), which also clears it, so two parallel submits cannot both win. A worker session never carries this purpose, so `verifySession` rejects it (`setupLinks.js:4-5`).

| Side | Who | Evidence |
|---|---|---|
| Writes the link (`pin_link_jti_hash`, `pin_link_expires_at`, `pin_link_sent_at`) | `issuePinSetupLink` | `server-lib/setupLinks.js:69-78`; 7 day TTL `:15` |
| Producer 1, company creation | everyone with an email, Owner first, cap 25, 3 parallel senders | `server-lib/onboardingApproval.js:148-167` (cap `setupLinks.js:18`), called `:364`; matches people to inserted rows by lower-cased name (`:149,157`) |
| Producer 2, Owner adds a person | email required, link emailed; a worker's URL is also handed back to the caller | `api/companydata.js:451-520` (`:519` hand-back rule) |
| Producer 3, resend | rank check via `canResetMfa` or self, throttled 5 per hour per person; no email on file means URL only, handed back | `api/companydata.js:720-760` |
| Consumer | `pin_link_open` returns name, company, `emailOnFile`, `mfaRequired`, `hasAuthenticator`; `pin_link_set_pin` saves the PIN, sets `pin_set_at`, clears the link | `api/login.js:694-776` (`pin_set_at` `:753`) |
| Feeds authenticator setup | `mfaNeeded = requiresMfa(member) && !totp_enabled` mints `mfa_setup_jti_hash` and returns `stage:'enroll'` + `enrollTicket`; the page redirects to `/?mfa_setup=` | `api/login.js:734,742-761,768-770`; `src/WalletInvite.jsx:114-118`; `src/Login.jsx:100`; consumer `mfa_enroll_start/confirm` `api/login.js:628` |
| Already has an authenticator | PIN reset only, `stage:'signin'`, no session | `api/login.js:767`; `src/WalletInvite.jsx:119` |
| Everyone else | session minted through `mintRosterSession` (writes `last_login_at`) | `api/login.js:771-775`, `:437` |
| Invalidated by | email change, `reset_roster_pin`-type resets, `set_own_pin`, a newer link | `api/companydata.js:633,778,970-971`; `api/certifications.js:411`; `setupLinks.js:70-78` |
| Read by the UI | `pin_set_at`, `pin_link_sent_at` on the roster list | `api/companydata.js:358`; `src/Dashboard.jsx:7903-7909`; `src/AdminPanel.jsx:2366-2370`; `claim_get_details` returns `hasEmail/linkSent/pinSet` (`api/login.js:1101-1114`) which drive `needsTypedPin` (`src/ClaimAccount.jsx:184-185,218-222`) |

**Gating:** roster is platform base, so no `requireDocKey`. `pin_link_*` does not check `wallet_enabled`; that flag only governs the ticket upload (`api/certifications.js:95-100`), same as before. Not re-verified: that the migration is applied to the live project.

**Tenant scope:** every lookup is by `id` **and** `company_id` (`login.js:699-700,760-761`, `setupLinks.js:76-77`). `send_pin_setup_link` fetches by `id` alone (`companydata.js:726`) but then requires either self in the same company (`:729`) or `canResetMfa`, which rejects a different company unless founder (`server-lib/rosterMfa.js:196-198`). Read, so not a break.

## 3. Interaction matrix

`✅` verified working · `⚠️` partial/lossy · `❌` expected but absent
· `—` no expected relationship

| From ↓ / To → | PM | Fuel | Equip Rpt | Brain | Analytics | Corrective | Certs |
|---|---|---|---|---|---|---|---|
| Equipment Inspection | ✅ `maint:129` | ✅ `fuel:106` | ✅ | ✅ *(#4, PR #118; post-trip too, #10, PR #121)* | ⚠️ label-joined | ✅ *(#5, PR #118; post-trip opens AND closes, #10/#11, PR #121)* | — |
| Fuel Log | ✅ *(#1, PR #118)* | — | ✅ *(#1, PR #120)* | — *(no finding to extract)* | ⚠️ label-joined | — | — |
| FLHA | — | — | — | ✅ `flhas:436` | ✅ | — | — |
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

The Platform events row is all `—` on purpose: it is a founder-only health
log, not a product feature a company uses, and it feeds none of the seven
columns. Its only planned consumer is the Admin Panel, which is not a column
here. See §2's `platform_events` section and §4's "Known pending links".

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
| `roster.last_login_at` | `login.js:437` | Active workers | ⚠️ PIN logins only, #41 weak point 1 |
| `companies`, `onboarding_requests` | `created_at`, `plan_tier`, `stripe_subscription_status`, `status` (`:225-232`) | Sign-ups, plan mix | ✅ |
| Preventative Maintenance, Equipment Compliance | none, no filing of their own | `not measurable` | n/a, deliberate |
| `platform_events` (last 30 days, `event_type, status, subtype, company_id, metrics, created_at`) | `event_type` + `subtype` to `CRONS` (`platformHealth.js:40-44`); `metrics.model` to `MODEL_PRICES` (`:28-32`, `:54-55`); `company_id` to `companies.name` (`:65,139`) | **3c, Platform health** (`PlatformDashboard.jsx:69`): job state ok / failed / overdue (1.5 cadences plus 2h, `:75`) / not observed yet, email sent / failed / skipped with failure kinds, AI success rate, estimated cost by document type, model and company (unlisted model counted unpriced, `:54-55,132`), recent trouble, and a note that storage growth, Supabase advisors and Vercel errors are not visible from the app (`:174`). Read failure yields `{unavailable:true}`, not a failed dashboard (`platformOverview.js:194,266-268`) | ✅ **P1 CLOSED by 3c**, see §4. Writers (8 producers) are on `main` via PR #162, not on this branch, verified with `git grep origin/main`. Two unguarded couplings recorded in §4, neither a break today |
| `pricing.js` `BASE`, `MODULES`, `MODULE_KEYS`, `TIERS` | `plan_tier` + module `docKeys` (`platformBusiness.js:20,35-43`, `pricing.js:37,60-118`) | Estimated MRR: BASE plus each bought module's price for the tier | ✅ a price change flows straight into the estimate, no second price table |
| `company_document_settings` | `is_active`, `document_key` (`platformBusiness.js:64-69`, read `platformOverview.js:238`) | "Bought" = any of a module's doc keys active (`platformBusiness.js:37`) | ⚠️ a hand-created company gets all 13 keys on (`admin.js:565`, `pricing.js:255`), so it is priced at every module, list price, in "Not billed via Stripe" |
| `companies.stripe_subscription_status` | written `stripe-webhook.js:84` and `onboardingApproval.js:198` | Billed / not billed / payment at risk split (`platformBusiness.js:28-29,100-102,174-182`) | ⚠️ see #42 weak point 1: the webhook suspends `canceled`, `unpaid`, `incomplete_expired` (`stripe-webhook.js:46,86`) and the dashboard drops suspended companies (`platformBusiness.js:62`) |
| `effectiveSeatCap` (`onboardingHelpers.js:101-103`, wraps `planSeatCap` `:92-94`) | `plan_tier` | Seat usage, near cap at 80 percent (`platformBusiness.js:21,33,104-106,160`) | ✅ **#42** built, closes when its PR merges: the dashboard (`platformBusiness.js:105`) and the enforcing handler (`companydata.js:362,392,457,582`) both call `effectiveSeatCap`, one source, an unknown tier is basic in both |
| `roster.last_login_at` | `login.js:437` (same single writer) | Worker logins this week, 30 of the 100 health points (`platformBusiness.js:88-95,138`) | ⚠️ PIN logins only, same weak point as Active workers (#41 weak point 1); a worker on a live session scores as not logged in |
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
history all become string matching. `WalletInvite.jsx` (the session it stores comes from `rosterId`-keyed `mintRosterSession`, `api/login.js:772`) and
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
| The flag | **Re-anchored 2026-09-30 against `624ef31`: `redeem_wallet_invite` no longer exists; `pin_link_set_pin` replaced it.** `api/login.js:774-775`, the `pin_link_set_pin` `stage: 'session'` response returns `certificationsEnabled`, read through the shared `readDocKeySetting` (`server-lib/docKeyGate.js:66`, called `login.js:774`): `true` / `false`, or **`null`** when the settings lookup fails. Deny-by-default like every built-in key, so a company with **no** row gets `false` |
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
   (`api/login.js:437`, re-checked 2026-09-30 against `624ef31`). The old wallet-invite redemption minted a session
   without it; that path is gone, and `pin_link_set_pin`'s session stage now goes through `mintRosterSession` (`:772`), so a first login via the setup link **does** count. A worker on an existing session who
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

`roster.pin_set_at` is written in exactly one place, `pin_link_set_pin` (`api/login.js:753`). Every other path that sets a PIN leaves it null: the claim-page typed PIN `claim_set_roster_pin` (`api/login.js:1146`), `set_own_pin` (`api/certifications.js:411`), an Owner PIN reset (`api/companydata.js:633,778`), and every roster row that existed before the migration. The roster rows show the label for `active && !pin_set_at` (`src/Dashboard.jsx:7903-7906`, `src/AdminPanel.jsx:2366-2367`), so those people read "No setup link sent" or "Waiting for PIN" while signing in fine every day. The claim page shows the honest state only for the link path (`src/ClaimAccount.jsx:221-222`). Customer loses: an Owner who trusts the label chases people who are already set up, and the label stops meaning anything, which is the wrong outcome for the only roster-wide "who is not onboarded" signal.

*Evidence:* `grep -n "pin_set_at" api/*.js server-lib/*.js` returns the roster select (`companydata.js:358`), the claim select (`login.js:1101,1114`) and the single writer (`login.js:753`). Re-check: same grep; it is fixed when a second writer exists or the label also keys off `last_login_at`.

**A fix would touch:** set `pin_set_at` in the other PIN writers, or show the label only when `!pin_set_at && !last_login_at`; backfill `pin_set_at = last_login_at` for existing rows. Two one-line edits plus a migration statement. Needs a yes.

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
3. **Logins are PIN logins only**, same source as #41 weak point 1 (`login.js:437`), and
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
  absence as a missing link. `companies.app_type` is kept for now and login
  still passes appType `'safety'`; that column has no second consumer.
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
  `certificationsEnabled: null` (settings lookup failed, `api/login.js:774-775`)
  keeps the card (`src/WalletInvite.jsx:304`); only an explicit `false` hides
  it. The upload is still refused server-side if the company has not bought
  the module (`certifications.js:143,160`). Deliberate (#24).
- **Photo and tickets are skipped for anyone who goes through authenticator setup.**
  The "extras" stage (photo, tickets) is only reached on `stage:'session'`
  (`src/WalletInvite.jsx:121-126`). A role that needs an authenticator gets
  `stage:'enroll'` and is redirected to the login page's setup
  (`:114-118`, `api/login.js:768-770`), and someone who already has one gets
  `stage:'signin'` (`:119`, `login.js:767`). Neither sees the extras. Deliberate
  per the 2026-09-30 brief: the session only exists after the second factor,
  and a half-signed-in person must not reach the certifications API. They add a
  photo and tickets later from "My Certifications". Do not file as a break.
- **`pin_link_open` does not return `certificationsEnabled`.** Only the session
  stage does (`api/login.js:775`). Nothing on the PIN step needs it.
- **A setup link replaces a PIN, never the second factor.** Opening it for
  someone with `totp_enabled` resets the PIN only (`api/login.js:767`); the
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
`ADMIN_CODE` login, `api/login.js:1030-1036`). A company must not be able to
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
