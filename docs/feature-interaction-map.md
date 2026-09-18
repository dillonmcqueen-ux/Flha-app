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

**Status:** seeded 2026-09-16 against commit `0bd289c`; last extended
2026-09-17 against the working tree on `claude/equipment-tab-fleet-mgmt-9g0xra`
(fleet management + attachments + compliance, migration **written, not yet
applied**). Every ❌ and ⚠️ in "Known breaks" was read in the code, not
inferred.

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
| 18 | Gatehouse | `src/GatehouseBooth.jsx` | `api/gatehouse.js` | *(none — `app_type`)* |
| 19 | Fleet Management | Equipment ▸ Fleet Overview (`Dashboard.jsx:5693`) | `api/companydata.js:780,829` update/retire/restore | *(none — always on, see #19)* |
| 20 | Equipment Compliance | Equipment ▸ Compliance (`Dashboard.jsx:5899`) | `api/companydata.js:902-969` | *(none — always on, see #19)* |
| 21 | Weekly Hours | Equipment ▸ Weekly Hours (`Dashboard.jsx:5838`) | `api/equipmentreports.js:617` (`foldWeeklyUsage`, `:300`) | `inspection` |
| 22 | Maintenance Records | Equipment ▸ Maintenance Records (`Dashboard.jsx:5780`) | `api/maintenance.js:357` | `maintenance` |

**The Equipment hub, 2026-09-17.** Maintenance and Fuel Logs stopped being
top-level tabs and became sub-tabs of Equipment, and the hub itself went from
module-gated to always-visible: `TAB_VISIBLE.equipment` was
`equipmentReportsEnabled` (`git show HEAD:src/Dashboard.jsx`, line 2505) and is
now `true` (`src/Dashboard.jsx:2767`). Per-sub-tab gating moved to
`EQUIPMENT_SUBTABS` (`src/Dashboard.jsx:2800-2810`), where each entry carries
its own `on:`. Two of the eight — Fleet Overview and Compliance — are `on: true`
with no doc key and no pricing module behind them. **That is break #19.**

Supporting surfaces: Onboarding → Claim (`Onboarding.jsx` → `ClaimAccount.jsx`),
Admin Panel, SOPs, Sites, Equipment fleet, Roster, Custom Fields, Billing
(`api/checkout.js` + `api/stripe-webhook.js`).

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
| Corrective Actions | ✅ *(#11, PR #121)* `logs.js:463` | ✅ `recurrence.js:51`, `correctiveActions.js:298` |
| Equipment Compliance | ✅ `companydata.js:934` | ✅ `companydata.js:907`, `:941` (`compliance_summary`), `equipmentreports.js:595` — **#14** fix in PR #122, unmerged |
| Daily Report | ⚠️ array form `equipment_ids`, **nothing reads it** — **#13** | — |
| Analytics | — | ⚠️ groups by `equipment_label` (`analyticsUtils.js:68,217`) |

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
**never `false` for a missing id**, because both callers are offline-queued
and `drainQueue` (`src/offlineQueue.js:185-208`) has no attempt cap and no
drop path, so a permanent 403 wedges a worker's whole queue. Same failure
mode recorded for `site_id` under break #2's follow-up.

| Caller | Validates `equipment_id` | Since |
|---|---|---|
| `api/logs.js` inspection submit | ✅ `logs.js:280-283` | PR #119 (`afee546`) — had **no** check before, though `equipment_id` was in `SUBMITTABLE_FIELDS.inspection` all along |
| `api/fuellogs.js` submit | ✅ `fuellogs.js:165-168` | had an inline guard; migrated onto the shared helper in `afee546` |
| `api/equipmentreports.js` report build | ✅ `equipmentreports.js:175-188` (`vetEquipmentIds`), called at `:227-229` | PR #119 (`afee546`) |
| `api/logs.js` daily-report submit (`equipment_ids`) | ✅ `logs.js:386-389` → `resolveEquipmentIds` (`equipmentScope.js:119-152`) | 2026-09-17 fleet branch |
| `api/companydata.js` compliance upsert | ✅ `companydata.js:928-931` (row re-read, `company_id` compared) | 2026-09-17 fleet branch |

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
| Weekly Equipment Report — defect routing | `equipmentreports.js:456,468` | ✅ pre-trip only |
| Weekly Equipment Report — towed distance | `equipmentreports.js:491-511` | ✅ |
| Weekly Hours | `equipmentreports.js:343` | ✅ |
| Inspection PDF — header | `generateInspectionPDF.js:223` | ✅ |
| Inspection PDF — checklist + deficiency banners | `generateInspectionPDF.js:69,141` | ✅ *(was **#16**, fixed on this branch)* — groups by `unitKey()` (`:16`), which keys on `attachmentId` and falls back to `unitLabel`. Keying on `unit` alone printed an attachment's defect under a "TRUCK / TOW VEHICLE" banner and merged two attachments into one group named after whichever came first |
| Corrective actions | `correctiveActions.js:411` (label only) | ❌ **#17** — the row is keyed to the host machine |
| Preventative Maintenance | — | ❌ **#18** — an attachment's usage never reaches its PM clock |

### `equipment.is_attachment` (is this thing hooked onto something else?)
A fact about the machine, replacing `isTrailerTemplate`'s guess from the
make/model text — which worked for anything with "trailer" in the name and
silently failed for a bucket, a hammer, a mulcher or a plate tamper.

| Consumer | Reads it |
|---|---|
| Inspection — no-readings path, attachment picker | `Inspection.jsx:275,283,291` |
| Daily Report picker label | `DailyReport.jsx:403` |
| Fleet Overview / Admin Panel badges | `Dashboard.jsx:5710,5745,5749`, `AdminPanel.jsx:1953` |
| Preventative Maintenance | ❌ nothing — **#18** |
| Fuel Log picker | ❌ nothing — an attachment with no tank is still offered (`FuelLog.jsx:84`). Cosmetic, not filed. |

### `equipment.retired_at` (out of the fleet, still in the history)
Set by `retire_equipment` (`companydata.js:854`). `list_equipment` filters
`retired_at is null` unless `includeRetired: true` is passed
(`companydata.js:736`), so every worker-facing picker drops the machine with
no change on its side — `Inspection.jsx:169`, `DailyReport.jsx:130`,
`FuelLog.jsx:84`, `FieldService.jsx:86`. Only `Dashboard.jsx:2444` and
`AdminPanel.jsx:666,998` ask for retired rows.

Everything that reads the `equipment` table **directly** bypasses that filter,
which is right for some and wrong for one:

| Direct reader | Includes retired? | Correct? |
|---|---|---|
| `maintenance.js:133-137` (`list_status`) | yes | ❌ **#15** — a sold machine keeps a live PM clock |
| `maintenance.js:376-379` (`list_records`) | yes | ✅ deliberate; a history that drops the machines you no longer own is not a history |
| `equipmentScope.js:80-88` (`companyEquipmentIndex`) | yes | ✅ historical ids must still vet |
| `equipmentScope.js:42,119` (`resolveEquipmentId(s)`) | yes | ✅ deliberate — see §5 |
| `companydata.js:902-910` (compliance list) | yes | ⚠️ **#15** — a retired unit's expired CVIP still counts |

### `daily_reports.equipment_ids` (jsonb array → `equipment.id`)
The joinable half of the free-text `daily_reports.equipment`, the same
producer/consumer split `site_id` has. Written by `src/DailyReport.jsx:296`
(live) and `:44` (offline drain), vetted by `resolveEquipmentIds`
(`logs.js:386-389`), present in the list payload (`logs.js:130`), deliberately
absent from `EDITABLE_FIELDS.daily` (`logs.js:620-625`).

**Read by nothing. That is break #13** — the fourth instance of §4b.

### `equipment_compliance.equipment_id` → `equipment.id`
Per-machine CVIP / registration / insurance expiry dates. Written and read by
`api/companydata.js:902-1020`. Until **#14** the only consumer was Equipment ▸
Compliance (`Dashboard.jsx:5899-5989`) — not the weekly equipment report, not
the cron, not the overview banner, not the Brain. PR #122 (draft, unmerged)
adds two: the overview banner via `compliance_summary` (`companydata.js:941` →
`Dashboard.jsx:4681`) and the weekly equipment report's compliance section
(`equipmentreports.js:593-618` → `reportPdfs.js:142`). The Brain still never
sees an expiry date — that was never in #14's approved scope.

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
| Dashboard inspection detail | `src/Dashboard.jsx:3283` |

**Weak link, recorded 2026-09-17, not being worked.** This is the last
client-supplied foreign id in `SUBMITTABLE_FIELDS.inspection`
(`logs.js:132`) with no ownership check — the same shape as the
`equipment_id` gap `afee546` closed, found by `tenant-scope-reviewer` while
verifying that fix.

**It is inert today, and the reason is worth writing down:** all four
consumers above compare `linked_inspection_id` against rows from a set that
is *already* company-scoped (`logs.js:210`, `equipmentreports.js:216`, and
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
| Recurrence count on each action | `api/monthly.js:809` (`annotateRecurrence`) |
| Per-machine repeat-offender list | `api/monthly.js:819` (`patternsByEquipment`) → `src/Dashboard.jsx:1905,5509` |
| Post-trip resolution | `server-lib/correctiveActions.js:327` |
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
| `api/equipmentreports.js` weekly — ending reading | ✅ | ✅ *(#1, PR #120)* |
| `api/equipmentreports.js` weekly — "Used" | ✅ | — *(by definition; see #1)* |

**This was break #1 below.** Both consumers now share one reducer in
`server-lib/readings.js`, so neither can drift from the other again.

### `site_id` → `sites.id` vs `site` vs `job_site`
One concept, **three column shapes across ten features**:

| Shape | Features |
|---|---|
| `site_id` FK → `sites` | Fuel Log, Custom Documents, Monthly Inspection |
| `site` free text | Toolbox Talk, Daily Report, Incident, Near Miss |
| `job_site` free text | FLHA (`flhas.js:126`) |
| nothing at all | Equipment Inspection, Time Clock |

**This is break #2 below.**

### `roster_id` → `roster.id` (the person)
| Feature | Link |
|---|---|
| Time Clock | ✅ FK `roster_id` |
| Certifications | ✅ FK, path-namespaced `certifications.js:130` |
| Every document form | ❌ free-text `worker_name` / `reporter_name` / `presenter_name` |

**This is break #3 below.**

### `company_id` (tenancy)
Honoured everywhere. Governed by `tenant-scope-reviewer`, not this map.

### `document_key` → `company_document_settings`
`BUILTIN_DOC_KEYS` (`customforms.js:119`) must exactly equal `ALL_DOC_KEYS`
(`pricing.js:118`). `pricing.js:50-56` states the invariant in a comment;
nothing enforces it. **This is break #6 below.**

### `source_type` → `company_signals` (the Brain's input)
| Writer | source_type |
|---|---|
| `api/flhas.js:370` | `flha_edit` |
| `api/reports.js:231` | `incident`, `near_miss` |
| `api/logs.js:244` | `toolbox_talk` |
| `api/logs.js` (PR #118) | `equipment_inspection` |
| `api/monthly.js` (PR #118) | `monthly_inspection` |

Daily reports, custom documents and corrective actions still write nothing.
**This is break #4 below.**

A source type is only half-wired by its writer. `bySourceType` in
`api/companydata.js:800` drops any type missing from its map, so an
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
(`api/logs.js:493`, `server-lib/correctiveActions.js:272-352`), writing a
`field_service` row to `equipment_maintenance_log` (`api/logs.js:513`) —
never `pm_service`, which would reset the machine's PM clock. That made
corrective actions the fourth writer of that table, alongside
`api/maintenance.js:262` (`log_field_service`), `api/maintenance.js:325`
(`log_service`) and `api/companydata.js:748`. **This was break #11 below.**

---

## 3. Interaction matrix

`✅` verified working · `⚠️` partial/lossy · `❌` expected but absent
· `—` no expected relationship

| From ↓ / To → | PM | Fuel | Equip Rpt | Brain | Analytics | Corrective | Certs |
|---|---|---|---|---|---|---|---|
| Equipment Inspection | ✅ `maint:129` | ✅ `fuel:106` | ✅ | ✅ *(#4, PR #118; post-trip too, #10, PR #121)* | ⚠️ label-joined | ✅ *(#5, PR #118; post-trip opens AND closes, #10/#11, PR #121)* | — |
| Fuel Log | ✅ *(#1, PR #118)* | — | ✅ *(#1, PR #120)* | — *(no finding to extract)* | ⚠️ label-joined | — | — |
| FLHA | — | — | — | ✅ `flhas:370` | ✅ | — | — |
| Toolbox Talk | — | — | — | ✅ `logs:244` | ✅ | — | — |
| Incident | — | — | — | ✅ `reports:231` | ✅ | ✅ *(#5, PR #118)* | — |
| Near Miss | — | — | — | ✅ `reports:231` | ✅ | ✅ *(#5, PR #118)* | — |
| Monthly Inspection | — | — | — | ✅ *(#4, PR #118)* | ✅ | ✅ `monthly:375` | — |
| Daily Report | ❌ #13 | ❌ #13 | ❌ #13 | ✅ *(#4, PR #120)* | ⚠️ #13 machines still label-only | — | — |
| Custom Document | — | — | — | — *(excluded, #4)* | ✅ | — | — |
| Time Clock | — | — | — | — | ✅ | — | — |
| Roster | — | — | — | — | ⚠️ #3 | — | ✅ |
| Certifications | — | — | — | — | — | — | ✅ *(#8, PR #120: expiry now reaches document review)* |
| Sites | ⚠️ #2 | ✅ | — | — | ✅ *(#2, PR #120)* | — | — |
| Equipment fleet | ✅ | ✅ | ✅ *(#7, PR #119)* | ❌ #4 | ⚠️ label | ✅ *(#11, PR #121)* | — |
| Corrective Actions | ✅ *(#11, PR #121: a post-trip repair writes `field_service`)* | — | — | — *(excluded, #4)* | — | — | — |
| SOPs | — | — | — | ✅ | — | — | — |
| Attachments (`is_attachment`) | ❌ #18 | — | ✅ `equipmentreports:343,491` | ❌ #17 | — | ❌ #17 | — |
| Equipment Compliance | ❌ #14 | — | ⏳ #14 *(PR #122, unmerged: `reportPdfs.js:142`)* | ❌ #14 | ❌ #14 | ❌ #14 | — *(the cert analogue it copies: `Dashboard.jsx:4650`; the overview banner it now matches is `Dashboard.jsx:4681`, PR #122, unmerged)* |
| Fleet retirement (`retired_at`) | ❌ #15 | ✅ picker filtered | ✅ | — | — | — | — |

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
consumers (`server-lib/reportPdfs.js:129`, `src/Dashboard.jsx:1626`) rather
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

Original finding: Roster login exists precisely so a person is a real
record, but every submitted document stores a name string. Per-worker
analytics, "show me everything Rob submitted", and deactivation-aware
history all become string matching. `WalletInvite.jsx:115` and
`certifications.js` show the correct pattern.

### #4 — The Brain learns from 4 of 9 document types
**Severity: high. Status: closed, with two documented exclusions.** PR #118
took it from 4 to 6 (`equipment_inspection`, `monthly_inspection`); PR #120
added `daily_report`, taking it to 7.

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
 CLAUDE.md calls the Brain FORA's flagship. It receives
signals only from FLHA edits, toolbox talks, incidents and near misses.
It never sees: **equipment inspection defects**, monthly inspection
findings, corrective actions, daily reports, or custom documents.

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
the fleet table (`maintenance.js:363-367`). So after a rename, Equipment ▸
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
  is selected on the same line and `src/Dashboard.jsx:816,957,3166` renders
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
`Dashboard.jsx:4329-4330` sums both trip types, `analyticsUtils.js` counts
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

**Severity: medium. Status: open, found 2026-09-17 on the fleet branch.**
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

**Severity: high. Status: fix built and pushed on
`claude/equipment-tab-fleet-mgmt-9g0xra` (PR #122, draft). NOT closed — it
closes when #122 merges.** Found 2026-09-17 on the fleet branch, approved by
Dillon 2026-09-18, both approved halves built the same day.

**What was built** (only the two halves Dillon approved):

| Half | Where |
|---|---|
| `compliance_summary` action | `companydata.js:941` — same shape as `certification_summary`: `resolveCompanyId` + `company_id` on the row, supervisor/admin only, machine names resolved in a second `company_id`-scoped query and only when there is something to name |
| Overview banner | `Dashboard.jsx:4681` (state `:2006`, loader `:2618`) — red when something is already expired, amber when only coming due; gated on having something to show, the same way the Compliance sub-tab is gated today |
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
* Retired machines still count, because they still count on the Compliance
  tab, and three surfaces disagreeing is worse than one being wrong. **That a
  sold machine's expired CVIP counts at all is #15** — shipping this gives
  #15 two more places to be seen, weekly and in print.
* No doc key and no pricing module were added — that is **#19**, open and not
  approved.

`equipment_compliance` is written and read by `api/companydata.js:902-969` and
consumed by exactly one screen, Equipment ▸ Compliance
(`src/Dashboard.jsx:2483,2575,2598` → `:5899-5989`).

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
(`src/Dashboard.jsx:4650-4670`, fed by `certification_summary` in
`api/certifications.js:266-300`, with a 30-day `expiring_soon` window at
`:33-40`). Machine compliance uses the same three-state model
(`expiryStatus` → expired / due_soon / ok, `src/Dashboard.jsx:5918-5920`) and
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

**Severity: medium. Status: open, found 2026-09-17 on the fleet branch.**

Retiring is the whole point of the new column: hide a sold or scrapped machine
from every worker picker while keeping every row that references its id
(`api/companydata.js:704-718`). The pickers honour it. Preventative maintenance
does not.

`api/maintenance.js:133-137` selects the fleet with **no `retired_at` filter**
and `:186-207` computes a status for every row returned. A retired machine with
a `pm_interval` and a service baseline keeps its last known reading forever, so
its `usageSinceService` is frozen at whatever it was — and if that was past the
interval, it reports `overdue` permanently (`maintenance.js:201-204`). That
count feeds the Equipment nav badge (`src/Dashboard.jsx:4592-4593`), so the badge shows work outstanding on a
machine the company no longer owns, and there is no way to clear it short of
hard-deleting the row, which destroys the history retirement exists to keep.

Same shape, smaller: a retired machine's compliance rows still count in the
Expired / Due-in-30 stat strip. The **add** dropdown uses `activeFleet`
(`src/Dashboard.jsx:5907`) but the list and the counters use the unfiltered
`compliance` array (`:5918-5920`).

*Re-check:* `grep -n "retired" api/maintenance.js` → four hits, all inside
`list_records` (`:367,377,385,402`). `list_status` has none. Run 2026-09-17
against `ea1c9e1`.

**A fix would touch:** the fleet query in `list_status` (exclude retired, or
return them flagged so the screen can group them), and the compliance counters.
Whether a retired machine should vanish from the PM screen or appear greyed out
is a product call, not a mechanical one. No migration.

### #16 — The inspection PDF grouped checklist items by a tag the form stopped writing

**Severity: medium. Status: FIXED on this branch (PR #122), before merge.**
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

**Severity: high. Status: open. Pre-existing since PR #121 for trailers;
widened 2026-09-17 to every kind of attachment.**

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
- **The per-machine repeat-offender list** (`api/monthly.js:838`
  `patternsByEquipment` → `src/Dashboard.jsx:3429,6175`) inherits the same
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

**Severity: medium. Status: open. Pre-existing; newly detectable.**

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

**Severity: low, but it is a billing question. Status: needs a decision, not a
fix.**

`TAB_VISIBLE.equipment` was `equipmentReportsEnabled`
(`git show c68f57d:src/Dashboard.jsx`, line 2505) and is now unconditionally
`true` (`src/Dashboard.jsx:2767`). Inside it, `EQUIPMENT_SUBTABS`
(`src/Dashboard.jsx:2800-2810`) marks Fleet Overview and Compliance `on: true`
while the other six are gated on a doc key. Neither has an entry in
`BUILTIN_DOC_KEYS` (`api/customforms.js:119`) or a module in
`server-lib/pricing.js:60-117`.

That is break #6's expensive direction, stated in `pricing.js:50-56`: a feature
no module sells is not withheld, it ships to every company free and silently.
A company that bought only the FLHA module now gets fleet management with
edit/retire/restore, and per-machine CVIP tracking.

**Why this is filed as a decision rather than a defect.** The code states the
rationale — the fleet is reference data every other module joins to, not a
document type (`Dashboard.jsx:2762-2767`) — and that is a defensible product
call; Analytics and SOPs are already always-on the same way. But Compliance is
not reference data, it is a new tracked-record feature with its own table, its
own CRUD and its own expiry model, and nothing in this repo records a decision
to give it away. The doc-key invariant test (`tests/unit/doc-key-module-invariant.test.js`)
cannot catch this, because a feature with no doc key at all is invisible to it.

*Re-check:* `grep -n "BUILTIN_DOC_KEYS = " api/customforms.js` and
`grep -n "docKeys:" server-lib/pricing.js` — run 2026-09-17, 12 keys on both
sides, still in exact agreement. Nothing is mis-sold; two features are simply
outside the system.

## 4b. The recurring shape: a key written and never read

Three of the breaks closed in PRs #119 and #120 turned out to have the same
underlying failure, and **each one was introduced by the fix for the break it
belonged to**. Check this before assuming a join key works.

| Column | Written by | Read by, until | Surfaced while closing |
|---|---|---|---|
| `equipment_id` | inspections, always | nothing — the weekly report grouped on the text label | #7 (PR #119) |
| `site_id` | PR #118, all five field forms | nothing — every list payload SELECTed only the text | #2 (PR #120) |
| `submitted_by_roster_id` | PR #118, every submit path | **nothing at all**, anywhere | #8 (PR #120) |
| `daily_reports.equipment_ids` | 2026-09-17 fleet branch, both submit paths | **nothing at all** — still open | #13, caught before merge |

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
| `item.attachmentId` | `attachmentForItem` (`inspectionAttachments.js:53`), `unitKey` (`generateInspectionPDF.js:16`) | `buildPosttripItems` (`src/Inspection.jsx:374-393`) | #17, open |

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

- **Gatehouse is a separate product.** Gated by `companies.app_type ===
  'gatehouse'` (`AdminPanel.jsx:1678`), not by a doc key or module. A
  gatehouse company gets no SOPs, sites, equipment, Brain or documents
  tabs (`AdminPanel.jsx:1680-1681`). It is not meant to interoperate with
  the safety-document product.
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
  retired in the meantime, rejecting the id would 403 the submit, and
  `drainQueue` (`src/offlineQueue.js:185-208`) has no attempt cap — one 403
  wedges that worker's entire queue forever. Same reasoning as break #2's
  follow-up. Do not "fix" this by adding a retired check.
- **`list_records` and `companyEquipmentIndex` include retired machines on
  purpose** (`maintenance.js:365-369`, `equipmentScope.js:80-88`). A service
  history or a vetting index
  that drops the machines you no longer own is not a history or an index.
  Break #15 is about `list_status` only.
- **`equipment_ids` is not editable on a submitted daily report**
  (`api/logs.js:620-625`). The supervisor edit corrects the free-text summary;
  the ids record what the worker actually picked in the field. Deliberate.
- **A post-trip has no attachment picker.** What was hooked up is recorded on
  the pre-trip, and the post-trip reads it from there
  (`generateInspectionPDF.js:223`, `equipmentreports.js:343`). Not a gap.
- **"Used" stays trip-derived and attachments are credited, not metered.** See
  breaks #1 and #18 — the credit is deliberate, its absence from PM is not.

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
| 2026-09-17 | PR #118 | Break #2 follow-up: fixing `delete_site` made a dangling `site_id` reachable, which permanently wedged the offline queue (`drainQueue` breaks on any throw with no attempt cap). A missing site now stores a text-only record. **A fix for one break created a fault in another — exactly what this map exists to catch, introduced while closing a break.** |
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
| 2026-09-18 | PR #122 | **#14 built, not closed** — approved by Dillon, both halves: a `compliance_summary` action (`companydata.js:941`) feeding an overview banner (`Dashboard.jsx:4681`), and a compliance section snapshotted into `report_json` at build time (`equipmentreports.js:377,593-618`) and rendered on the weekly equipment report (`reportPdfs.js:142`). The 30-day window and the doc-type names moved out of `Dashboard.jsx` into `server-lib/compliance.js` so the browser, the API and the PDF answer from one definition — copying a threshold onto the server to close a §4 break would have opened the next one. Snapshot-at-build rather than live-at-render is deliberate: the PDF is cached on first view, so "live" would mean "live for whoever opened it first". **Shipping this makes #15 more visible, not less** — a retired machine's expired CVIP now reaches the banner and the weekly PDF, because filtering it here alone would make three surfaces disagree. No migration, no doc key, no pricing module (#19 untouched). Marked closed only when #122 merges. |
