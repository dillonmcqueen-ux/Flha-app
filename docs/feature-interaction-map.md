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

**Status:** seeded 2026-09-16 against commit `0bd289c`. Every ❌ and ⚠️ in
"Known breaks" was read in the code, not inferred.

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
| 9 | Preventative Maintenance | `src/Dashboard.jsx` | `api/maintenance.js` | `maintenance` |
| 10 | Fuel & Consumables | `src/FuelLog.jsx` | `api/fuellogs.js` | `fuellog` |
| 11 | Time Clock + GPS | `src/TimeClock.jsx` | `api/companydata.js` | `timeclock` |
| 12 | Weekly Equipment Reports | `src/Dashboard.jsx` | `api/equipmentreports.js` | `equipment_reports` |
| 13 | Weekly Time Clock Reports | `src/Dashboard.jsx` | `api/timeclockreports.js` | `timeclock` |
| 14 | Certifications | `src/WorkerCertifications.jsx` | `api/certifications.js` | `certifications` |
| 15 | Corrective Actions | `src/Dashboard.jsx` | `api/monthly.js` | *(none — rides `monthly`)* |
| 16 | Company Brain | `AdminPanel.jsx` Brain tab | `api/cron-company-brain-summary.js` | *(none — always on)* |
| 17 | Analytics | `src/Analytics.jsx` | `api/companydata.js` | *(none — tier-gated)* |
| 18 | Gatehouse | `src/GatehouseBooth.jsx` | `api/gatehouse.js` | *(none — `app_type`)* |

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

`results_json.attachedTrailer.id` is the one that can't be guarded on
submit: `results_json` is a free-form jsonb blob and `pickAllowed`
(`logs.js:122`) whitelists the **column**, never its contents. It is
therefore vetted on the read side instead — `vetEquipmentIds` drops any id
not in the company's fleet before anything keys on it, falling back to the
label the way a free-text machine already does.

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
`BUILTIN_DOC_KEYS` (`customforms.js:99`) must exactly equal `ALL_DOC_KEYS`
(`pricing.js:118`). `pricing.js:51-56` states the invariant in a comment;
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
| `api/logs.js` | `equipment_inspection` |

All four go through `server-lib/correctiveActions.js`. **This was break #5
below.**

---

## 3. Interaction matrix

`✅` verified working · `⚠️` partial/lossy · `❌` expected but absent
· `—` no expected relationship

| From ↓ / To → | PM | Fuel | Equip Rpt | Brain | Analytics | Corrective | Certs |
|---|---|---|---|---|---|---|---|
| Equipment Inspection | ✅ `maint:129` | ✅ `fuel:106` | ✅ | ✅ *(#4, PR #118)* | ⚠️ label-joined | ✅ *(#5, PR #118)* | — |
| Fuel Log | ✅ *(#1, PR #118)* | — | ❌ #1 | ❌ #4 | ⚠️ label-joined | — | — |
| FLHA | — | — | — | ✅ `flhas:370` | ✅ | — | — |
| Toolbox Talk | — | — | — | ✅ `logs:244` | ✅ | — | — |
| Incident | — | — | — | ✅ `reports:231` | ✅ | ✅ *(#5, PR #118)* | — |
| Near Miss | — | — | — | ✅ `reports:231` | ✅ | ✅ *(#5, PR #118)* | — |
| Monthly Inspection | — | — | — | ✅ *(#4, PR #118)* | ✅ | ✅ `monthly:375` | — |
| Daily Report | — | — | — | ❌ #4 | ✅ | — | — |
| Custom Document | — | — | — | ❌ #4 | ✅ | — | — |
| Time Clock | — | — | — | — | ✅ | — | — |
| Roster | — | — | — | — | ⚠️ #3 | — | ✅ |
| Sites | ⚠️ #2 | ✅ | — | — | ⚠️ #2 | — | — |
| Equipment fleet | ✅ | ✅ | ⚠️ label | ❌ #4 | ⚠️ label | — | — |
| SOPs | — | — | — | ✅ | — | — | — |

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
**Status: fixed in PR #118.** `site_id` (nullable FK) added to `flhas`,
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
**Severity: high. Status: partially fixed in PR #118** — equipment
inspections (`equipment_inspection`) and monthly site inspections
(`monthly_inspection`) now emit signals, taking it to 6 of 9. **Still
unwired: daily reports, custom documents, and corrective actions.** Daily
reports and custom documents carry free text with no structured finding to
extract, so wiring them is a judgement call about noise, not an oversight;
corrective actions derive from monthly inspections and would double-count.
Do not mark #4 closed.

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
`pricing.js:51-56` says every key in `BUILTIN_DOC_KEYS` must appear in
exactly one module, "or a company could be charged for something it cannot
see, or see something it was not charged for." That invariant lives in a
comment. `customforms.js:268-283` treats a missing settings row as
**active**, so the failure direction is: add a doc key, forget the module,
every company gets it free.

*Verified equal 2026-09-16: 12 keys each, no duplicates.* The check:
```bash
node -e "import('./server-lib/pricing.js').then(p=>{const a=[...p.ALL_DOC_KEYS].sort();console.log(JSON.stringify(a))})"
grep -n "BUILTIN_DOC_KEYS = " api/customforms.js
```

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
**Severity: medium.** Certifications are tracked with expiry alerts
(`api/certifications.js`), but no form consults them —
`worker_certifications` is referenced by that one file and nowhere else in
`api/` or `src/`. A worker whose ticket
expired yesterday can still submit an FLHA for the task that ticket
covers, and nothing anywhere connects the two.

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
  a missing integration. (It *should* still emit a Brain signal — that's
  break #4, a different thing.)
- **`equipment_id` is null for free-text machines.** Intentional
  (`maintenance.js:5-7`). Never "fix" this by matching on label.
- **RLS has no policies.** Deny-by-default backstop by design (README).
- **`website/` is a separate Vercel project.** Cross-project coupling to
  `api/checkout.js` is documented in README and is not a break.
- **Admin Panel is founder-only.** Not a customer surface — see
  `admin-access-copy-guard`.

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
| 2026-09-17 | PR #120 | Break #1 **closed**: the weekly report's ending reading now reads fuel logs too, via reading helpers moved into `server-lib/readings.js` so maintenance and the report share one definition. "Used" stays trip-derived by definition, recorded as a boundary rather than a gap. |
| 2026-09-17 | PR #119 (`afee546`) | `equipment_id` ownership validation added (`server-lib/equipmentScope.js`), found by `tenant-scope-reviewer` on the break #7 diff. Making a column load-bearing exposed that nothing validated it: `api/logs.js`'s inspection submit never checked it, and `attachedTrailer.id` can't be checked on submit at all. **A second instance of the #2 pattern — closing a break turned a dormant column into a live dependency.** Nothing leaked; the trap was closed before a reader existed to spring it. |
