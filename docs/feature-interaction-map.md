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
| Preventative Maintenance | ✅ `maintenance.js:214` | ✅ `maintenance.js:130-132` |
| Weekly Equipment Report | — | ⚠️ groups by `equipment_label`, not id |
| Analytics | — | ⚠️ groups by `equipment_label` (`analyticsUtils.js:54,203`) |

**Consequence:** anything that groups by `equipment_label` silently splits
one machine into several when the label is typed differently, and can't
join to the fleet at all. `maintenance.js:5-7` documents this decision
explicitly and is the correct reference.

### `reading` / `reading_unit` (the usage clock)
Hours or kilometres on a machine. Written by inspections
(`start_reading`/`end_reading`) and fuel logs (`hour_reading`).

| Consumer | Reads inspections | Reads fuel logs |
|---|---|---|
| `api/fuellogs.js` `get_last_reading` | ✅ `:106` | ✅ `:99` |
| `api/fuellogs.js` consumption calc | ✅ `:211` | ✅ `:229` |
| `api/maintenance.js` PM status | ✅ `:129` | ✅ *(#1, PR #118)* |
| `api/equipmentreports.js` weekly | ✅ | ❌ |

**This is break #1 below.** Fuel already understands that a reading can come
from either table. Maintenance does not.

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

Nothing else writes a signal. **This is break #4 below.**

### `answer_id` → corrective actions
`corrective_actions` rows key on a **monthly inspection answer id**
(`monthly.js:375,518`), and are written/read only by `api/monthly.js`.
**This is break #5 below.**

---

## 3. Interaction matrix

`✅` verified working · `⚠️` partial/lossy · `❌` expected but absent
· `—` no expected relationship

| From ↓ / To → | PM | Fuel | Equip Rpt | Brain | Analytics | Corrective | Certs |
|---|---|---|---|---|---|---|---|
| Equipment Inspection | ✅ `maint:129` | ✅ `fuel:106` | ✅ | ❌ #4 | ⚠️ label-joined | ❌ #5 | — |
| Fuel Log | ✅ *(#1, PR #118)* | — | ❌ #1 | ❌ #4 | ⚠️ label-joined | — | — |
| FLHA | — | — | — | ✅ `flhas:370` | ✅ | — | — |
| Toolbox Talk | — | — | — | ✅ `logs:244` | ✅ | — | — |
| Incident | — | — | — | ✅ `reports:231` | ✅ | ❌ #5 | — |
| Near Miss | — | — | — | ✅ `reports:231` | ✅ | ❌ #5 | — |
| Monthly Inspection | — | — | — | ❌ #4 | ✅ | ✅ `monthly:375` | — |
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
**Status: fix approved and built — PR #118. Closes when that merges.**

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
**Severity: high** for analytics, medium for daily use. See the join-key
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
**Severity: medium.** Roster login exists precisely so a person is a real
record, but every submitted document stores a name string. Per-worker
analytics, "show me everything Rob submitted", and deactivation-aware
history all become string matching. `WalletInvite.jsx:115` and
`certifications.js` show the correct pattern.

### #4 — The Brain learns from 4 of 9 document types
**Severity: high.** CLAUDE.md calls the Brain FORA's flagship. It receives
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
**Severity: high.** An incident, a near miss, and a failed equipment
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
**Severity: medium.** `api/equipmentreports.js:3` aggregates per machine,
but the fleet FK is available and unused. Same class as the Analytics
grouping at `analyticsUtils.js:54,203`. A machine relabelled mid-quarter
becomes two machines in the report.

### #8 — Certification expiry doesn't gate anything
**Severity: medium.** Certifications are tracked with expiry alerts
(`api/certifications.js`), but no form consults them —
`worker_certifications` is referenced by that one file and nowhere else in
`api/` or `src/`. A worker whose ticket
expired yesterday can still submit an FLHA for the task that ticket
covers, and nothing anywhere connects the two.

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
| 2026-09-16 | PR #118 | Break #1 approved and built: `api/maintenance.js` now reads `fuel_logs` readings alongside inspection readings. 7 breaks remain open. |
