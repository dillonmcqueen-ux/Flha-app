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
(§5). Two breaks still awaiting a decision: **#24** (`WalletInvite.jsx` still
offers a ticket upload a gated company cannot use) and **#25** (custom
documents ignore their own `custom_<id>` setting server-side). **#27** (those
#23 carve-outs were open on the server and unreachable from the product) is
**built, not closed** as of `98f9d70` — approved by Dillon ("readable in the
app"); the worker's card and the supervisor's tab now reach them read-only,
and (uncommitted, on `f561f42`) the tab pages back through every past week.
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
| 18 | Gatehouse | `src/GatehouseBooth.jsx` | `api/gatehouse.js` | *(none — `app_type`)* |
| 19 | Fleet Management | Equipment ▸ Fleet Overview (`Dashboard.jsx:5913`) | `api/companydata.js:903` update, `:952` retire/restore | *(none — BASE by decision, see #19)* |
| 20 | Equipment Compliance | Equipment ▸ Compliance (`Dashboard.jsx:6119`) | `api/companydata.js:1025-1203` | `equipment_compliance` — module `compliance` (`pricing.js:98-103`), added `2560819` |
| 21 | Weekly Hours | Equipment ▸ Weekly Hours (`Dashboard.jsx:6058`) | `api/equipmentreports.js` (`foldWeeklyUsage`, `:300`) | `inspection` |
| 22 | Maintenance Records | Equipment ▸ Maintenance Records (`Dashboard.jsx:6000`) | `api/maintenance.js:357` | `maintenance` |

**The Equipment hub, 2026-09-17, corrected 2026-09-18.** Maintenance and Fuel
Logs stopped being top-level tabs and became sub-tabs of Equipment, and the hub
itself went from module-gated to always-visible: `TAB_VISIBLE.equipment` was
`equipmentReportsEnabled` (`git show c68f57d:src/Dashboard.jsx`, line 2505) and
is now `true` (`src/Dashboard.jsx:2789`). Per-sub-tab gating moved to
`EQUIPMENT_SUBTABS` (`src/Dashboard.jsx:2826-2835`), where each entry carries
its own `on:`. **One of the eight is now `on: true`** — Fleet Overview
(`:2827`), BASE by decision. Compliance was the other, which was break #19; it
gates on `complianceEnabled` (`:2755` → `:2832`) as of `2560819`.

Which sub-tab is gated on what, verified 2026-09-18 against `2560819`:

| Sub-tab | `on:` | Doc key |
|---|---|---|
| Fleet Overview (`:2827`) | `true` | none — BASE, see #19 |
| Maintenance / Maintenance Records / Corrective Actions (`:2828-2830`) | `maintenanceEnabled` | `maintenance` |
| Weekly Hours (`:2831`) | `inspectionsEnabled` | `inspection` |
| Compliance (`:2832`) | `complianceEnabled` | `equipment_compliance` |
| Fuel Logs (`:2833`) | `fuelEnabled` | `fuellog` |
| Weekly Reports (`:2834`) | `equipmentReportsEnabled` | `equipment_reports` |

One asymmetry, recorded but not filed, re-verified 2026-09-22 against
`34925b0`: the Compliance panel's own render condition is
`activeTab === "equipment" && equipmentSubTab === "compliance"`
(`Dashboard.jsx:6119`) with no module flag, while Maintenance Records
(`:6000`), Weekly Hours (`:6058`), Weekly Reports (`:6210`) and Corrective
Actions (`:6303`) each repeat their flag in the render condition too. It is
still unreachable today — `equipmentSubTab` is only ever set from the filtered
tab list (`:5904`), from three `maintenanceEnabled`/`fuelEnabled`-gated
shortcuts (`:4941,4944,4951`), from the overview compliance banner's **new**
"View Compliance" action (`:4855`, added by #126), or bounced to a visible tab
(`:2843`) — so this is defence in depth that Compliance alone doesn't have, not
a live hole.

**The setter that needed checking is the new one.** `:4855` is gated on
`TAB_VISIBLE.equipment`, which is unconditionally `true` (`:2789`). On its own
that would be the first setter able to select Compliance for a company that did
not buy it. It cannot, because the whole banner it lives in sits inside
`complianceEnabled && …` (`:4841`) — the gate is on the banner, fourteen lines
above, rather than on the button itself. If that banner is ever refactored
so the action outlives the guard, this asymmetry stops being theoretical.

Supporting surfaces: Onboarding → Claim (`Onboarding.jsx` → `ClaimAccount.jsx`),
Admin Panel, SOPs, Sites, Equipment fleet, Roster, Custom Fields, Billing
(`api/checkout.js` + `api/stripe-webhook.js`).

**Every doc-key column above is now enforced, not just displayed.**
`server-lib/docKeyGate.js` (`48d5889`) is the one gate every handler asks; see
§2's `document_key` section for the 51 guards (as of `ac80f96`), the
deliberate exemptions — including the five time-clock actions left open by
decision in #23 — and what is still ungated (#25).

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
| Equipment Compliance | ✅ `companydata.js:1027` (`upsert_equipment_compliance`) | ✅ `companydata.js:914`, `:960` (`compliance_summary`), `equipmentreports.js:595` — **#14** closed in PR #122; all three now drop retired machines (**#15**, PR #123) |
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
| `api/logs.js` daily-report submit (`equipment_ids`) | ✅ `logs.js:386-389` → `resolveEquipmentIds` (`equipmentScope.js:119-152`) | 2026-09-17 fleet branch |
| `api/companydata.js` compliance upsert | ✅ `companydata.js:1138-1183` (row re-read, `company_id` compared) | 2026-09-17 fleet branch |

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
| Fleet Overview / Admin Panel badges | `Dashboard.jsx:5930,5965,5969`, `AdminPanel.jsx:1962` |
| Preventative Maintenance | ❌ nothing — **#18** |
| Fuel Log picker | ❌ nothing — an attachment with no tank is still offered (`FuelLog.jsx:84`). Cosmetic, not filed. |

### `equipment.retired_at` (out of the fleet, still in the history)
Set by `retire_equipment` (`companydata.js:952-978`). `list_equipment` filters
`retired_at is null` unless `includeRetired: true` is passed
(`companydata.js:859`), so every worker-facing picker drops the machine with
no change on its side — `Inspection.jsx:169`, `DailyReport.jsx:130`,
`FuelLog.jsx:84`, `FieldService.jsx:86`. Only `Dashboard.jsx:2444` and
`AdminPanel.jsx:675,1007` ask for retired rows.

Everything that reads the `equipment` table **directly** bypasses that filter,
which is right for some and wrong for one:

| Direct reader | Includes retired? | Correct? |
|---|---|---|
| `maintenance.js:148-153` (`list_status`) | **no** — `.is('retired_at', null)` | ✅ **#15** fixed, PR #123 (draft) |
| `maintenance.js:376-379` (`list_records`) | yes | ✅ deliberate; a history that drops the machines you no longer own is not a history |
| `equipmentScope.js:80-88` (`companyEquipmentIndex`) | yes | ✅ historical ids must still vet |
| `equipmentScope.js:42,119` (`resolveEquipmentId(s)`) | yes | ✅ deliberate — see §5 |
| `companydata.js:1025-1053` (compliance list) | **no** — `withoutRetiredEquipment` (`:1052-1053`) | ✅ **#15** fixed, PR #123, merged `18645f0`; same for `compliance_summary` (`:1090-1091`) and the weekly report's snapshot (`equipmentreports.js:645,657`) |

### `daily_reports.equipment_ids` (jsonb array → `equipment.id`)
The joinable half of the free-text `daily_reports.equipment`, the same
producer/consumer split `site_id` has. Written by `src/DailyReport.jsx:296`
(live) and `:44` (offline drain), vetted by `resolveEquipmentIds`
(`logs.js:386-389`), present in the list payload (`logs.js:130`), deliberately
absent from `EDITABLE_FIELDS.daily` (`logs.js:620-625`).

**Read by nothing. That is break #13** — the fourth instance of §4b.
Re-checked 2026-09-18 against `2560819`:
`grep -rn "equipment_ids\|equipmentIds" api/ src/ server-lib/` → 10 hits,
all producer/allowlist/validator/payload (`logs.js:130,157,160,386-389,620`,
`DailyReport.jsx:25,44,212,296`). Still zero consumers.

### `roster.employee_id` — the employer's own number for a person
New in `8916156` (2026-09-18). A join key for a future HRIS sync (Workday,
BambooHR, ADP all key on an employee number), not a label: the roster
de-duplicates on `name_normalized`, so a name is exactly what cannot be matched
on across systems.

| Side | Where |
|---|---|
| Written on hire | `companydata.js:409` (`add_roster_member`), `:471` (`onboard_new_employee`) |
| Written after the fact | `companydata.js:510-541` (`set_roster_employee_id`) → `Dashboard.jsx:3065,3073` |
| Uniqueness | per company, case-insensitive, **across active and inactive rows** — handler `companydata.js:275-291`, index `docs/schema/roster-employee-id-migration.sql:58-60` |
| Read by | `Dashboard.jsx:6955,6987` — displayed on the roster row. Nothing else |

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

### `equipment_compliance.equipment_id` → `equipment.id`
Per-machine CVIP / registration / insurance expiry dates. Written and read by
`api/companydata.js:1025-1203`. Until **#14** the only consumer was Equipment ▸
Compliance (`Dashboard.jsx:6119-6208`) — not the weekly equipment report, not
the cron, not the overview banner, not the Brain. PR #122 (merged)
added two: the overview banner via `compliance_summary` (`companydata.js:1071` →
`Dashboard.jsx:4841`) and the weekly equipment report's compliance section
(`equipmentreports.js:607-657` → `reportPdfs.js:142`). The Brain still never
sees an expiry date — that was never in #14's approved scope. All three drop a
retired machine's rows as of **#15** (PR #123, merged as `18645f0`), through one
shared rule (`withoutRetiredEquipment`, `equipmentScope.js`) so the counts and
the lists cannot disagree.

**Gated as of `2560819` (#19 closed).** All three surfaces now hang off the
`equipment_compliance` doc key: the sub-tab (`Dashboard.jsx:2755,2832`), the
overview banner (`:4728`), and the weekly report's compliance section, where
the query is **skipped entirely** rather than filtered afterwards
(`equipmentreports.js:618-625`). The weekly report is the Equipment Inspections
module's artifact, so ungated it would have delivered a paid module's output
inside another module's document every Monday. **As of `48d5889` the four
`api/companydata.js` handlers consult the doc key too** — `requireDocKey` at
`:1028`, `:1077`, `:1146`, `:1194`, so the data is refused and not merely
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
| Dashboard inspection detail | `src/Dashboard.jsx:3913` |

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
| Recurrence count on each action | `api/monthly.js:850` (`annotateRecurrence`) |
| Per-machine repeat-offender list | `api/monthly.js:860` (`patternsByEquipment`) → `src/Dashboard.jsx:2368,6395` |
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
| Built-in, supervisor's settings screen | `customforms.js:323` | `settingsMap[key] === true` |
| Built-in, worker's menu | `customforms.js:383` | `settingsMap[key] === true` |
| Custom form, both handlers | `customforms.js:341,386` | `settingsMap[...] !== false` — still **allow**-by-default |
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
| Admin toggle | `customforms.js:347-357` (`set_document_setting`, admin only) | one key at a time |
| Custom form creation | `customforms.js:177-180` | that form's `custom_<id>` key |

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
anything.** `isDocActive` (`Dashboard.jsx:2747-2749`) returns `true` when the
key is not in the loaded payload — *"not loaded yet / unknown key → default to
shown"*. Harmless for a known key, because `get_document_settings` returns an
entry for all 13 built-ins whether or not a row exists
(`customforms.js:319-324`); it means a failed or pending settings load still
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
| `api/companydata.js` | 10 — 4 (`:1028,1077,1146,1194`) + 6 added in `ac80f96` | `equipment_compliance` ×4; `maintenance` ×1 (`:1216`); `timeclock` ×5 (`:1438,1530,1562,1590,1639`) | the four compliance actions (the ones #19 gated in the UI only); `set_equipment_pm_interval`; `clock_in`, `edit_time_entry`, `add_time_entry`, `delete_time_entry`, `generate_time_report_now` |
| `api/maintenance.js` | 4 (`:130,247,327,396`) | `maintenance` | `list_status`, `log_field_service`, `log_service`, `list_records` |
| `api/fuellogs.js` | 3 (`:116,156,240`) | `fuellog` | `check_equipment`, `submit`, `list` — every action in the file |
| `api/equipmentreports.js` | 4 (`:666,683,714,763`), added in `89ca755` | `equipment_reports`; **`inspection`** for `list_weekly_hours` | `list_reports`, `get_report`, `generate_now`, `list_weekly_hours` |

**Deliberately NOT gated, so a later sweep does not read these as misses:**

| Left open | Where | Why |
|---|---|---|
| The five wallet self-service actions | `api/certifications.js:390,400,414,423,434` (`update_own_profile`, `set_own_pin`, `create_photo_upload_url`, `set_profile_photo`, `complete_onboarding`); reasoning at `:382-389` | These are the **roster**, not Certification Tracking — name, PIN, photo, "I'm done". The roster is platform base every company pays for, so gating them would stop a company without cert tracking from onboarding anyone. The cert-upload half of the same screen **is** gated (`:143`) |
| `list_corrective_actions` / `update_corrective_action` | `api/monthly.js:681,865`; reasoning at `:661-667` (immediately above `list_corrective_actions`) | Polymorphic since break #5 — an action can come from an incident, a near miss or a failed inspection. Gating them on `monthly` would hide a company's incident follow-ups behind a module it may never have bought. Still scoped by company and role |
| Admin-only actions | `docKeyGate.js:113` | The founder is on the other side of the paid boundary; gating them would break the console that decides what a company is sold |
| `create_upload_url` | `api/logs.js:288-293`, `api/reports.js:187`, `api/flhas.js:235`, `api/monthly.js:122`, `api/customforms.js:137` | It mints a signed upload slot inside the caller's own company namespace and runs **before the record type is known**, so there is no doc key to check. The submit that would use the file is gated, which is where a company without the module is stopped |
| `clock_out`, `my_time_status` | `api/companydata.js:1455,1476`; reasoning at `:1425-1435` | **Dillon's decision on #23 (2026-09-22, `ac80f96`).** A shift that was open when the company dropped Time Clock + GPS must always be closable, and the clock-out screen needs `my_time_status` to find the open shift. Gating `clock_out` would leave that entry open forever. Pinned by `tests/unit/timeclock-gate.test.js:156,161`. *Reached from the UI as of `98f9d70` (#27, built): the worker's Time Clock card stays while `my_time_status` reports an open shift (`src/WorkerMenu.jsx:137-150,272-273`) and opens a clock-out-only screen (`src/TimeClock.jsx:157`); a supervisor's own open shift keeps its Clock Out button on the read-only tab (`src/Dashboard.jsx:6677`, re-anchored against the uncommitted tree on `f561f42`).* |
| `list_time_entries`, `list_time_reports`, `get_time_report` | `api/companydata.js:1495,1603,1628`; same reasoning block | **Dillon's decision on #23.** Recorded hours are payroll records and stay readable after a company cancels the module. Reads only — every write and `generate_time_report_now` are gated. Pinned by `tests/unit/timeclock-gate.test.js:170,176`; `list_time_reports` now also returns `latestEntryAt`, the newest `time_clock_entries.clock_in` for the resolved company (`companydata.js:1614-1625`), pinned company-scoped by `:206`. *Reached from the UI as of `98f9d70` (#27, built): the Time Clock tab stays, read-only, for a company without the module that has any report, any recorded entry in any week (`latestEntryAt`), or the viewer's own open shift (`src/Dashboard.jsx:2811,3281-3305`). Since the uncommitted change on `f561f42` the tab pages through past weeks — `list_time_entries` sends `weekStart` (`:3026`), Previous / Next / This week at `:6636-6653` — so a week that never became a report stays readable; the current-week-only residual is closed. See #27.* |

**`custom_<id>` documents are still ungated — that is #25.** The time-clock and
PM-interval half (#23) is built as of `ac80f96`; see the table above for the
six guards and the carve-outs.

**Weekly Hours gates on `inspection`, not `equipment_reports`, and that is not a
slip** (`equipmentreports.js:763`): it is folded from inspection readings
(`foldWeeklyUsage`, `:300`) and the Dashboard sub-tab gates it on
`inspectionsEnabled` (`Dashboard.jsx:2831`), so `equipment_reports` there would
lock out a company that bought Equipment Inspections and not the weekly report.
The surface table in §1 has said `inspection` for Weekly Hours since it was
added; the server now agrees with it.

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
| Equipment Compliance | ❌ #14 | — | ✅ *(#14, PR #122: `reportPdfs.js:142`)*, gated on its own doc key since `2560819` (`equipmentreports.js:618`) | ❌ #14 | ❌ #14 | ❌ #14 | — *(the cert analogue it copies: `Dashboard.jsx:4809`; the overview banner it now matches is `Dashboard.jsx:4841`, and both are now gated the same way — cert on `isDocActive("certifications")`, compliance on `complianceEnabled`)* |
| Fleet retirement (`retired_at`) | ✅ *(#15, PR #123 merged `18645f0`: no PM clock)* | ✅ picker filtered | ✅ *(#15: off the weekly report)* | — | — | — | — |

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
  is selected on the same line and `src/Dashboard.jsx:894,1035,3764` renders
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
`Dashboard.jsx:5276-5277` (and `inspIssueCount`, `:4083-4085`) sums both trip types, `analyticsUtils.js` counts
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

**Severity: high. Status: CLOSED — PR #122 merged as `d91fcb6`, 2026-09-18.**
Found 2026-09-17 on the fleet branch, approved by Dillon 2026-09-18, both
approved halves built and merged the same day.

**What was built** (only the two halves Dillon approved):

| Half | Where |
|---|---|
| `compliance_summary` action | `companydata.js:941` — same shape as `certification_summary`: `resolveCompanyId` + `company_id` on the row, supervisor/admin only, machine names resolved in a second `company_id`-scoped query and only when there is something to name |
| Overview banner | `Dashboard.jsx:4841` (state `:2006`, loader `:2633`) — red when something is already expired, amber when only coming due; gated on having something to show, the same way the Compliance sub-tab is gated today |
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
(`src/Dashboard.jsx:2483,2575,2601` → `:6119-6208`).

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
(`src/Dashboard.jsx:4809-4823`, fed by `certification_summary` in
`api/certifications.js:266-300`, with a 30-day `expiring_soon` window at
`:33-40`). Machine compliance uses the same three-state model
(`expiryStatus` → expired / due_soon / ok, `src/Dashboard.jsx:6138-6140`) and
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

**Severity: medium. Status: fix built and pushed on
`claude/equipment-tab-fleet-mgmt-9g0xra` (PR #123, draft). NOT closed — it
closes when #123 merges.** Found 2026-09-17 on the fleet branch, approved by
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
count feeds the Equipment nav badge (`src/Dashboard.jsx:4711-4712`), so the badge shows work outstanding on a
machine the company no longer owns, and there is no way to clear it short of
hard-deleting the row, which destroys the history retirement exists to keep.

Same shape, smaller: a retired machine's compliance rows still count in the
Expired / Due-in-30 stat strip. The **add** dropdown uses `activeFleet`
(`src/Dashboard.jsx:6153`) but the list and the counters use the unfiltered
`compliance` array (`:6138-6140`).

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
- **The per-machine repeat-offender list** (`api/monthly.js:860`
  `patternsByEquipment` → `src/Dashboard.jsx:3483,6395`) inherits the same
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

**Severity: low, but it is a billing question. Status: DECIDED AND BUILT
2026-09-18 (`2560819`), on this branch. Closes when PR #124 merges.**

**The decision, Dillon's, recorded in `2560819`'s commit message:** Compliance
becomes a paid module; Fleet Overview stays in BASE.

*Compliance half — closed.* Verified 2026-09-18 against `2560819`:

| Piece | Where |
|---|---|
| Module | `server-lib/pricing.js:98-103` — `compliance`, "Equipment Compliance", $20 basic / $45 advanced, sole `docKeys` entry `equipment_compliance`. Placed next to `certifications` (`:92-97`), the closest analogue: same three-state expiry model, same 30-day window, people instead of machines |
| Doc key | `api/customforms.js:119` (13th built-in) + label at `:734` — without the label the Admin Panel renders the raw key (`BUILTIN_LABELS[key] \|\| key`, `:321`) |
| Sub-tab | `src/Dashboard.jsx:2755` (`complianceEnabled`) → `:2832` |
| Overview banner | `src/Dashboard.jsx:4841` — `complianceEnabled &&` prepended to the existing has-something-to-show test |
| Weekly report section | `api/equipmentreports.js:618-625` — `isDocKeyActive` (`:163-171`), query **skipped**, not filtered |
| Cron | `api/cron-equipment-reports.js:40-48` — its copy of `isDocKeyActive` still defaulted a missing row to active, which would have contradicted `edd7a41`; now matches |
| Existing companies | `docs/schema/equipment-compliance-module-backfill.sql`, applied — explicit row per company, company 1 (demo, the only one holding compliance rows) true, the other two false |

The invariant test was made to **fail on purpose** between adding the module and
adding the key (`2560819`'s message: *"these modules bill for document keys no
document uses: equipment_compliance"*), which is the evidence the net from break
#6 is live rather than decorative.

*Fleet half — decided as BASE, not a gap.* `EQUIPMENT_SUBTABS`
(`src/Dashboard.jsx:2827`) still carries `{ key: "fleet", on: true }`, and
`TAB_VISIBLE.equipment` (`:2789`) is still unconditional `true`. The rationale
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
document type (`Dashboard.jsx:2784-2789`) — and that is a defensible product
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
and pushed on `claude/equipment-tab-fleet-mgmt-9g0xra` (PR #124, draft). NOT
closed — it closes when #124 merges.** Found 2026-09-18 by this map's pass
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
and the Equipment tab's Fleet Overview (`Dashboard.jsx:2789,2827`), with no
error and nothing on screen saying why. Never reached production: `edd7a41` is
not an ancestor of `main`.

### #21 — Module gating is UI-only; no handler consults the doc key

**Severity: low, pre-existing, cross-cutting. Status: fix built and pushed on
`claude/equipment-tab-fleet-mgmt-9g0xra` (PR #124 — confirmed open and a draft,
head `48d5889`). NOT closed — it closes when #124 merges.** Recorded 2026-09-18
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
| The eleven producers | `err.status = res.status` in `src/App.jsx:73`, `CustomForm.jsx:47`, `DailyReport.jsx:63`, `FieldService.jsx:55`, `FuelLog.jsx:46`, `GatehouseBooth.jsx:96`, `Incident.jsx:147`, `Inspection.jsx:97`, `MonthlyInspection.jsx:48`, `NearMiss.jsx:76`, `ToolboxTalk.jsx:58` — §4b's mirror image avoided on purpose: a reader is useless if one producer doesn't write the field |
| Surfaced to the worker | `src/WorkerMenu.jsx:386-407` — a red panel naming each dropped form, its timestamp and the server's own reason, ending "Tell your supervisor"; `src/GatehouseBooth.jsx:432` — a dropped-count line beside the "saved offline" count |
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

**What did not change:** the browser still fails open (`Dashboard.jsx:2749`).
That is now presentation only and was left alone on purpose — a settings fetch
that fails should still render the app, and the handler behind each tab now
refuses on its own.

---

*Original finding, 2026-09-18, left as written:*

`2560819` gates Equipment Compliance in three places, all of them presentation:
the sub-tab (`Dashboard.jsx:2832`), the banner (`:4841`) and the weekly PDF's
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
load fails (`Dashboard.jsx:2749`).

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

**Severity: low, but it was the safety net under #20. Status: fix built and
pushed on `claude/equipment-tab-fleet-mgmt-9g0xra` (PR #124 — confirmed open
and a draft, base `main` at `18645f0`). NOT closed — it closes when #124
merges.** Found 2026-09-22 by this map's pass against `c30d995`, built the same
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
`claude/modular-pricing-enforcement-rzdib2` (`ac80f96`). NOT closed — it
closes when that branch's PR merges.** Approved by Dillon 2026-09-22, with two
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
(`98f9d70`, UI only), plus a week-paging follow-up **uncommitted on `f561f42`**
(PR #128) that closes the residual limit. NOT closed — it closes when that
branch's PR merges.**
Approved by Dillon 2026-09-22 with the answer to the open question below:
"readable in the app", so both halves were built, not just the worker's.
Opened 2026-09-22 by this map's pass against `ac80f96` — found while recording
#23's carve-outs, not handed to this pass.

**What was built** (`98f9d70` plus the uncommitted paging change on `f561f42`;
every line re-read 2026-09-22 against that working tree; the tables further
down are the as-found record at `ac80f96`, and their `Dashboard.jsx` line
numbers have since moved):

| Half | Producer (server, unchanged) | Consumer (UI, now reached) |
|---|---|---|
| Worker closes an open shift | `my_time_status` `companydata.js:1476`, `clock_out` `:1455` | `src/WorkerMenu.jsx:137-150` probes `my_time_status` whenever the menu shows and `builtinActive.timeclock === false` (explicit `false` — `customforms.js:383` writes `settingsMap[key] === true`, so a company with no row counts as off too); `:272-273` falls back to the unfiltered `BUILTIN_TYPES` entry when `openShiftWhileOff`, so the card renders (`:476`) with "You're still clocked in. Tap to clock out." (`:494-495`); `:233` passes `clockOutOnly`, and `src/TimeClock.jsx:157` replaces the button with a "can't clock in" note once `clockedIn` is false. The card goes away on the next menu render after clock-out |
| Supervisor reads recorded hours | `list_time_reports` `:1603` (now also returns `latestEntryAt`, the newest `time_clock_entries.clock_in` for the resolved company, `:1614-1625`), `get_time_report` `:1628`, `list_time_entries` `:1495` (honours `weekStart`, `:1500-1501`), `my_time_status` `:1476` | `src/Dashboard.jsx:3281-3305` — when `timeClockEnabled` (`:2772`, `isDocActive("timeclock")`) is false, probes `list_time_reports` and `my_time_status` (the old current-week `list_time_entries` probe is gone) and sets `timeClockHistory` if any report, a non-null `latestEntryAt` (any week), or the viewer's own open shift exists (`:3296`); `TAB_VISIBLE.timeclock: timeClockEnabled \|\| timeClockHistory` (`:2811`). A failed probe reads as `{}` → no tab (fails closed) |
| Supervisor pages past weeks | `list_time_entries` rounds any date to its Monday (`companydata.js:1500-1501`, `mondayOf` `:240`) | `timeClockWeekStart` / `timeClockShownWeek` (`Dashboard.jsx:2023-2024`); the entries fetch sends `weekStart` when set (`:3026`) and re-runs on it (`:3043`); `showTimeClockWeek` / `timeClockAtCurrentWeek` (`:3047-3054`) step by 7 days and snap back to "" (server default = current week) at the present; Previous / This week / Next card at `:6636-6653`, rendered in both modes. Read-only opens on the week of `latestEntryAt` when that is before the current week (`:3298-3301`); the week resets on company or module change (`:3281`) |
| Read-only, no write reachable | every write gated server-side by #23 (`:1438,1530,1562,1590,1650`) | `timeClockReadOnly = !timeClockEnabled` (`:2773`) — banner (`:6626`); My Time's button only while `myTimeStatus?.open` (`:6677`), so Clock Out and never Clock In; "+ Add Entry" and its form gone (`:6745,6753`); Edit/Delete gone (`:6800,6840`); Manual Pull and "Generate This Week" gone (`:6865`, the button itself at `:6875`) and the manual-pull panel suppressed (`:6884`). Report rows still open and download via `get_time_report` (`:3388`). Paging adds no write path — it only changes the `weekStart` of a read |

*Re-check:* `grep -n "openShiftWhileOff\|clockOutOnly" src/WorkerMenu.jsx src/TimeClock.jsx`
and `grep -n "timeClockHistory\|timeClockReadOnly\|timeClockEnabled\|timeClockWeekStart\|showTimeClockWeek\|latestEntryAt" src/Dashboard.jsx`
plus `grep -n "latestEntryAt" api/companydata.js` → the anchors above.
`git diff d4b8aa3 98f9d70 --stat` → five files, all under `src/` and `tests/`;
no `api/`, no migration. The paging follow-up **does** touch `api/` — one
read added to `list_time_reports`, company-scoped via `resolveCompanyId`
(`:1605`) and `.eq('company_id', companyId)` (`:1622`); still no migration
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

*Paging tests (uncommitted, on `f561f42`):* `tests/unit/timeclock-gate.test.js:206`
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

**Former residual limit — CLOSED by the uncommitted paging change on
`f561f42`** (Dillon: "let the supervisor page back through past weeks of
entries in the read-only tab"). Both halves are gone: any week's entries are
reachable via Previous / Next (`Dashboard.jsx:6636-6653`, `weekStart` at
`:3026`), and the tab's visibility no longer depends on the current week
(`latestEntryAt`, `companydata.js:1614-1625` → `Dashboard.jsx:3296`), so the
sub-week company keeps its tab after the week rolls over. The cron and
`generate_time_report_now` are still gated, so the final partial week still
never becomes a *report* — its hours are read as entries, which was the ask.
One assumption to keep in view: the browser steps weeks in UTC
(`Dashboard.jsx:3047-3049`) while `mondayOf` (`companydata.js:240-246`) uses
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

**Severity: low, cosmetic-but-confusing. Status: OPEN, awaiting a decision.
Opened 2026-09-22 by this map's pass against `48d5889`.**

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

**Severity: low, narrow. Status: OPEN, awaiting a decision. Opened 2026-09-22
by this map's pass against `48d5889`** — found while checking whether #21's
guards covered every gated surface, not handed to this pass.

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

**Severity: low. Status: fix built and pushed on
`claude/equipment-tab-fleet-mgmt-9g0xra` (PR #124, draft, head `89ca755`). NOT
closed — it closes when #124 merges.** Split out of **#23** on 2026-09-22, the
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
`inspectionsEnabled` (`src/Dashboard.jsx:2831`). Gating the server on
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
| `roster.employee_id` | `8916156`, three roster write paths (`companydata.js:409,471,534`) | nothing but its own badge on the roster row (`Dashboard.jsx:6955`) | **deliberately not filed** — unlike every row above it, no consumer exists that *should* be reading it (FORA has no HRIS surface). See §2 |
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
  'gatehouse'` (`AdminPanel.jsx:1687`), not by a doc key or module. A
  gatehouse company gets no SOPs, sites, equipment, Brain or documents
  tabs (`AdminPanel.jsx:1689-1690`). It is not meant to interoperate with
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
  these as #21 leftovers.** #23 and #25 were the real leftovers; #23 is built.
- **Five time-clock actions are ungated on purpose, as of `ac80f96` — Dillon's
  decision on #23, 2026-09-22.** `clock_out` and `my_time_status`
  (`companydata.js:1455,1476`): a shift open when a company drops Time Clock +
  GPS must always be closable, and the clock-out screen needs `my_time_status`
  to find it. `list_time_entries`, `list_time_reports` and `get_time_report`
  (`:1495,1603,1628` as of the uncommitted tree on `f561f42`; `:1617` before it): recorded hours are payroll records and stay readable
  after cancelling. Reasoning in the code at `:1425-1435`, pinned by
  `tests/unit/timeclock-gate.test.js:156,161,170,176`. **Do not file these as
  #23 leftovers** and do not "make them consistent" with `clock_in`. Their
  *UI* reachability once the module is off was #27, built in `98f9d70`: the
  worker's card and the supervisor's tab now call them read-only when the
  module is off (`WorkerMenu.jsx:137-150,272-273`, `Dashboard.jsx:2811,3281-3305`
  on the uncommitted tree on `f561f42`).
  The answer there was never to gate these, and still is not.
- **No longer a limit: a company without Time Clock can page back through
  every past week on its read-only tab** — the current-week-only residual
  recorded at `98f9d70` is fixed by the uncommitted change on `f561f42`
  (Dillon approved it): `weekStart` is sent (`Dashboard.jsx:3026`), paging at
  `:6636-6653`, and visibility keys off `latestEntryAt`
  (`companydata.js:1614-1625` → `Dashboard.jsx:3296`) rather than this week's
  entries. **Still deliberate:** the final partial week never becomes a
  *report* once the module is off, because the cron and
  `generate_time_report_now` (`companydata.js:1650`) stay gated — its hours
  are readable as entries, which is what was asked for. Do not file "no final
  report at switch-off" as a break without a product decision that it is one.
- **`list_records` and `companyEquipmentIndex` include retired machines on
  purpose** (`maintenance.js:365-369`, `equipmentScope.js:80-88`). A service
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
  breaks #1 and #18 — the credit is deliberate, its absence from PM is not.
- **Fleet Overview is BASE and has no module.** Dillon's call, 2026-09-18
  (`2560819`): the fleet list is reference data every other module joins to,
  like Analytics and SOPs, not a document type a company buys. Its write actions
  (`companydata.js:903,952`) are ungated to match. Break #19's Compliance half
  was the real gap and is closed; do not re-open the Fleet half.
- **Custom forms default ON while built-in keys default OFF.** Opposite on
  purpose (`customforms.js:323` vs `:341`, `:383` vs `:386`), pinned by
  `tests/unit/doc-setting-defaults.test.js`. A built-in key is bought; a custom
  form was built by this company's own admin, here, and denying it by default
  would hide a form from the person who just created it. "Making them
  consistent" is the most likely way this comes back.
- **`roster.employee_id` is read by nothing, on purpose.** It is a join key for
  a future HRIS sync; there is no internal consumer that should be reading it
  today. See §2 and §4b.

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
| 2026-09-22 | `48d5889` | **#21 built, not closed** — approved explicitly by Dillon ("Build #21"), full server-side gating including the worker submit paths. Built in three steps, in the only order that was safe. **(1) The offline queue got a drop path first.** `drainQueue` caught every failure identically (`markAttempt`, `break`) with no drop path, so one permanently-rejected item wedged that worker's whole queue for that form type forever — survivable only while nothing on the server rejected a well-formed submit permanently, which a module 403 does, stably. A 4xx is now dropped and **reported** in the new `dropped` array (`src/offlineQueue.js:194,243,252-263`), following the `pdfUnlinked` precedent; 401/408/425/429, 5xx, network failures and anything with no status keep the stop-and-preserve-order retry. All eleven resubmit functions attach `err.status`, and `WorkerMenu.jsx:386-407` / `GatehouseBooth.jsx:432` tell the worker what went nowhere and why. **There is still no attempt cap and that is deliberate** (`:215-218`): a cap punishes a worker who was offline for a week, so only the server saying "never" drops anything — the map's three claims that `drainQueue` has "no attempt cap and no drop path" are half stale and are corrected in §2, §5 and the PR #118 row above rather than deleted. **(2) One shared gate, with the duplicate removed rather than tripled.** `server-lib/docKeyGate.js` is deny-by-default and derives its key→module map from `MODULES` in `pricing.js` (`:33-35`); **both** previous copies of `isDocKeyActive` are deleted and migrated onto it (`equipmentreports.js:17`, `cron-equipment-reports.js:20`), so break #1's duplicate-helper shape is resolved here instead of made worse — this entry's own "a fix would touch" note had warned about exactly that. A hard no is **403**, a failed lookup is **503** (`:117-120` as shipped; `:126-133` after `89ca755` renumbered the file), because a 403 now means DROP to a queued submit and a database blip must not delete a worker's shift. Admin exempt (`:113`). **(3) 41 guards across eight handler files** (`grep -rn "await requireDocKey(" api/ \| wc -l` → 41), listed with their actions in §2, along with what was deliberately left ungated: the wallet's five self-service actions (the roster is platform base), the two polymorphic corrective-action endpoints (gating on `monthly` would hide incident follow-ups), admin-only actions, and `create_upload_url` (it runs before the record type is known; the submit is gated). `npm run test:unit` → **364 pass**, re-run by this pass. Deny-by-default enforced server-side is only safe given the live data: all three companies carry an explicit row for every one of the 13 built-in keys, none missing, none with zero rows — queried against the FORA Supabase project on 2026-09-22 before the push **by the session that built `48d5889`**, not by Dillon; recorded in §2 with its date and its author so the next session re-runs it rather than assuming. (An earlier version of this row credited Dillon. Who ran a check is part of being able to re-run it.) Closes when PR #124 merges. |
| 2026-09-22 | `48d5889` | **Breaks #23, #24 and #25 opened by this pass, none worked, none approved.** #23 — the handlers #21's approved scope did not reach are now gated differently from their neighbours: ten time-clock actions and `set_equipment_pm_interval` (`companydata.js:1423-1616,1214`). *(As first written this entry also covered `api/equipmentreports.js`'s four supervisor-callable actions; `89ca755` fixed those the same day and they are now **#26** — see the row below.)* The sharpest instance: the Sunday cron refuses to build a weekly time-clock report for a company without the module (`cron-equipment-reports.js:85`) and `generate_time_report_now` builds the same report on demand with no such check. `api/timeclockreports.js` is **not** a gap — its handler returns 404 unconditionally (`:77-78`); it is a builder module, recorded because it looks like an ungated endpoint in a file listing. #24 — `src/WalletInvite.jsx:262-300` still renders its "Add a ticket" card for a company without Certification Tracking; the server now refuses it and it fails soft, so a new hire fills in four fields and picks a file before being told. #25 — `custom_<id>` keys belong to no module, so the gate (built from `pricing.js`) does not cover them: `get_active_form` and `submit_custom` (`customforms.js:465,491`) check `custom_forms.is_active` and never `company_document_settings`, while the worker menu filters on it (`:386`). Narrow — custom keys are allow-by-default on purpose and `set_document_setting` is admin-only (`:348`) — and a fix cannot reuse `requireDocKey`, which is deny-by-default and would switch off every custom form with no row. |
| 2026-09-22 | `89ca755` | **#26 built, not closed** — split out of #23 the day both were opened, found by `tenant-scope-reviewer` reviewing `48d5889`. That commit skipped `api/equipmentreports.js` because the file was "already an enforcement point" — true of the compliance section **inside the report body** (`:600`), false of its own four actions. So the cron refused to build a weekly report on Sunday for a company without Equipment Inspections (`cron-equipment-reports.js:66-67`) and that company's supervisor got the same document, PDF and signed URL included, by calling `generate_now` on Monday: two entry points to one artifact disagreeing, **inside the change meant to stop exactly that**. `list_reports`, `get_report` and `generate_now` now gate on `equipment_reports` (`:666,683,714`); `list_weekly_hours` gates on **`inspection`** (`:763`) because it is folded from inspection readings and its sub-tab gates on `inspectionsEnabled` (`Dashboard.jsx:2831`) — the obvious key would have locked out a company that bought Inspections and not the report, which is the one place in this work where the file a handler lives in was not the module it belongs to. Two smaller fixes rode along, both about the offline queue rather than the gate: the cron reported a **failed** settings read as `reason: 'deactivated'`, collapsing "not bought" with "couldn't check" — an outage at 11:59pm Sunday would have cost every company that week's report and blamed the customer in the only trace of it (`readDocKeySetting` is exported now, `:20,66-67,93-94`); and `requireDocKey` answered a non-admin session with no `companyId` with 403, which since `48d5889` means the queue **drops** the submission, so it returns 401 without querying (`docKeyGate.js:112,123`) — not reachable today, a guard against the shape. 368 unit tests pass. Guard count across `api/` is now **45**. Closes when PR #124 merges. |
| 2026-09-22 | — | **Third instance on this branch of one reasoning error, recorded as the lesson rather than as a break:** "that's already handled", applied at the wrong granularity. #12 — the generator read `linkedPretrip.results_json` and its *caller* passed three scalars. #16 — the form wrote `unit: 'attachment'` and one of two consumers still tested `'trailer'`. #26 — a file was an enforcement point for one thing inside it and not for its own endpoints. Each time the sentence was true of something adjacent to the thing that wasn't. |
| 2026-09-22 | `82fa4a2` + `34925b0` | **Every `src/Dashboard.jsx` citation in this map re-anchored — 46 of them, 33 distinct line numbers, against a 7138-line file.** PR #126 rebuilt the supervisor dashboard from a Stitch mockup on `main` (`82fa4a2`, ~673 lines of `Dashboard.jsx`, plus `Sidebar.jsx`, `theme.js`, `index.html`), and this branch merged it forward in `34925b0`. **No offset was applied.** Each claim was re-read in the current file and re-cited where the code it describes actually lives — a diff-derived offset is exactly how a confidently wrong `file:line` gets into a document whose entire value is that a later session can re-check it. Some citations had already drifted *before* #126: `:816,957,3166`, `:1626`, `:1905`, `:3429`, `:4329-4330`, `:4650-4670`, `:5509`, `:5710,5745,5749` and `:6175` all landed on `}}>`, `</div>` or unrelated code at `07795a7` — the branch head the previous map pass was written against — so this was two overlapping drifts, not one. Three citations that were **historical** claims (#19's original finding: "is now `true`", "marks Fleet Overview and Compliance `on: true`") are pinned as `git show ea1c9e1:src/Dashboard.jsx` instead of live line numbers, because the second is false of the file today and a live number would keep asserting it. Zero line-numbered citations to `Sidebar.jsx` or `theme.js` exist in this map — confirmed by grep, not assumed. Two `api/monthly.js` numbers riding on the same claims (`:809`, `:819`/`:838`) were corrected to `:850` and `:860` while verifying them. No application code touched. |
| 2026-09-22 | `34925b0` | **The merge's one conflict was semantic, not structural, and the shape belongs on the map: a rebuild branched before a module existed and silently reverted that module's gate.** #126 was cut from `main` before Equipment Compliance became purchasable, so its version of the compliance alert banner carried **no** `complianceEnabled &&` test and a comment reading *"compliance has no purchasable module (break #19, open)"* — true on the day it was written, and a paid feature given away free on the day it would have merged. Resolved in favour of keeping the gate (`Dashboard.jsx:4841`); the comment now matches the code. **Nothing would have failed.** No test asks "is this banner gated", the stale comment reads as an explanation rather than a contradiction, and the only symptom is a company seeing a module it never bought — break #6's expensive direction arriving through a *merge* instead of through a new feature, which is this map's first instance of it. The check it argues for: when a long-lived UI branch merges, re-verify every module gate inside the files it rewrote, not only the hunks git marked as conflicting. `EQUIPMENT_SUBTABS`' compliance entry was the same risk and did **not** conflict — verified on the merged file as `{ key: "compliance", label: "Compliance", on: complianceEnabled }` (`:2832`), and `isDocActive` still fails open (`:2749`), unchanged and still presentation-only per #21. |
| 2026-09-22 | `82fa4a2` | **One genuinely new interaction arrived with #126.** Both overview alert banners now render through a shared `alertBanner` helper (`Dashboard.jsx:4540`) instead of two hand-copied blocks, and each gained a click-through: "View Certifications" (`:4823`) into the Certifications tab, "View Compliance" (`:4855`) into Equipment ▸ Compliance. An expiry a supervisor sees on the overview is now one click from the screen that fixes it — an increment on the reach break #14 was opened about, not a new break. Both actions are gated on their target tab's own `TAB_VISIBLE` entry; the compliance one resolves to `true` unconditionally and is safe only because the banner around it is `complianceEnabled`-gated, which is recorded in §1. The shared helper also removes the hand-copy that let the two banners drift — the `pdf-consistency-reviewer` shape, in the dashboard. |
| 2026-09-22 | `ac80f96` | **#23 built, not closed** — approved by Dillon, on `claude/modular-pricing-enforcement-rzdib2`. Six new guards in `api/companydata.js`: `set_equipment_pm_interval` on `maintenance` (`:1216`), and `clock_in`, `edit_time_entry`, `add_time_entry`, `delete_time_entry`, `generate_time_report_now` on `timeclock` (`:1438,1530,1562,1590,1639`). The sharpest instance is gone: `generate_time_report_now` now agrees with the Sunday cron (`cron-equipment-reports.js:93`) on who gets a time-clock report. **Two product decisions, recorded in §2's exemption table and §5 so they are never re-filed:** `clock_out`/`my_time_status` stay open so a shift open when the module is dropped can be closed, and `list_time_entries`/`list_time_reports`/`get_time_report` stay open so recorded hours remain readable after cancelling (`:1455,1476,1495,1603,1617`; reasoning `:1425-1435`). Guard count across `api/` **45 → 51** (`grep -rn "await requireDocKey(" api/ \| wc -l`, re-run by this pass; 45 via `git grep` at `57efbeb`). `tests/unit/timeclock-gate.test.js` — 19 pass at `ac80f96`; against a `57efbeb` worktree, **12 fail / 7 pass**, the 12 being exactly the gating cases. `npm run test:unit` → 387 pass. All re-run by this pass. Time-clock punches are still not offline-queued (`TimeClock.jsx:62-64`), so these 403s show on screen rather than dropping a punch. Closes when the branch's PR merges. |
| 2026-09-22 | `ac80f96` | **#27 opened by this pass, not worked, not approved.** #23's two carve-outs are open on the server and unreachable in the product: the worker's Time Clock card is filtered out when the module is off (`WorkerMenu.jsx:247,250`) and the supervisor's Time Clock tab — entries, report list and all — is hidden by `TAB_VISIBLE.timeclock` (`Dashboard.jsx:2793,6567`). So a worker clocked in when the module is dropped has no screen to clock out from, and a cancelled company has no screen to read its hours from; the API would answer both. Not a defect in `ac80f96`, which built exactly the approved server scope — a gap between a decision's intent and its reach. The fix is UI-only and must never be "gate the carve-outs"; see §5. |
| 2026-09-22 | `98f9d70` | **#27 built, not closed** — approved by Dillon ("readable in the app"), UI only, on `claude/modular-pricing-enforcement-rzdib2` (`main` is at `d4b8aa3`, the squash of PR #127, which already carries #23). Worker: with the module off and an open shift, `src/WorkerMenu.jsx:137-150` finds it via `my_time_status` and `:272-273` keeps the Time Clock card, which opens a clock-out-only screen (`TimeClock.jsx:157`) and goes away after. Supervisor: `Dashboard.jsx:3262-3280` probes `list_time_reports` / `list_time_entries` / `my_time_status`, and `TAB_VISIBLE.timeclock` is `timeClockEnabled \|\| timeClockHistory` (`:2805`); every write control is hidden under `timeClockReadOnly` (`:2767,6634,6702,6710,6757,6797,6822,6841`). A company that never used Time Clock gets no tab. No `api/` change, no migration (`git diff d4b8aa3 98f9d70 --stat`). Re-run by this pass: new spec **7/7** at `98f9d70`, **4 fail / 3 pass** against `d4b8aa3` (the 4 behaviour tests); `npm run test:unit` **387 pass**. **Residual limit recorded, not numbered:** the read-only tab shows past reports plus the current week only (`:3020`, no `weekStart`), and the cron (`cron-equipment-reports.js:93-94`) and `generate_time_report_now` (`companydata.js:1639`) are gated, so the last partial week is readable in-app only until it ends; data retained. Also re-anchored §2's stale Sunday-cron row (`cron-equipment-reports.js:40-48,76,99` → `readDocKeySetting` `docKeyGate.js:66-75`, used at `cron-equipment-reports.js:66,93`). Closes when the branch's PR merges. |
