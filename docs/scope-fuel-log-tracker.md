# Scope: fuel log tracker

Status: **Phases 1-3 built.** Manual fuel-up logging is live — `src/FuelLog.jsx`
(own tile in the worker menu, per the confirmed decision below), `api/fuellogs.js`,
and the `fuel_logs` table (migration applied to production). Phase 2 added
per-row burn rate calculation and a supervisor/admin-facing "Fuel Logs" tab
in the Dashboard (Operations group), grouped by machine. Phase 3 added a
Fuel Cost & Consumption section to the Equipment Analytics tab (Advanced
tier) and its PDF export — cost/quantity totals, cost and burn rate by
machine, cost by site, and a plain "flagged" list for machines running
25%+ above their own trailing burn rate. Not yet built: Phase 4 (turning
that flag into a dashboard alert) and the receipt-photo capture mentioned
below — cut from Phase 1 to keep the first build small; see "Deferred from
Phase 1" at the bottom.

Decisions locked in for Phase 1 (previously open questions): liters as the
default unit (worker can switch to gal per entry), cost is optional, and
"Log Fuel" got its own tile in the worker menu rather than folding into
post-trip.

## What this is

Manual fuel-up logging tied to the equipment already tracked by pre-trip/
post-trip inspections (`src/Inspection.jsx`). The core value: every pre-trip
and post-trip already captures an hour (or KM) meter reading per machine —
this feature reuses those readings to calculate fuel burn rate per hour,
without asking anyone to track a second number by hand.

No telematics, no fuel cards, no GPS. FORA has none of that infrastructure
and small crews doing manual entry is the existing pattern (see
`docs/scope-offline-capability.md`) — this stays consistent with that, not a
sensor/integration play.

## Market research (why these features, not others)

Searched fuel management software roundups (2026) and construction
equipment fleet apps (Fleetio, Tenna, HCSS FuelerPlus) for what's actually
requested. Most-cited features cluster into two groups:

**Not relevant to FORA's model** (needs telematics/fuel cards FORA doesn't
have): real-time tank-level sensors, fuel card auto-sync (WEX, Comdata,
Shell), GPS-tagged theft/siphoning detection, driver-behavior-linked
route optimization.

**Relevant and buildable with manual entry**:
- Cost tracking per fill-up (liters/gallons + $ spent)
- Consumption/efficiency reporting per machine (this is the "burn rate"
  angle — flags a machine using more fuel than normal, which is often an
  early sign of an engine problem, same logic as the existing inspection
  defect flow)
- Exception alerts for unusual consumption (a machine suddenly burning way
  more than its own history)
- Per-site or per-job cost rollups
- Photo of the fuel receipt attached to the log entry

That second list is what this scope builds toward.

## Data model

**Built as-is** (corrected from this doc's first draft: the real pre/post-trip
table is `inspections`, not `inspection_forms` — checked against the live
schema before writing the migration):

```sql
create table fuel_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  company_id bigint not null references companies(id),
  equipment_id bigint references equipment(id),
  equipment_label text not null,       -- fallback for "other" equipment not in the roster, same pattern as Inspection.jsx's eqMode
  worker_name text not null,
  hour_reading text,                    -- text, matching inspections.start_reading/end_reading's existing type
  reading_unit text,                    -- 'Hours' | 'KM'
  quantity numeric not null,            -- liters or gallons
  quantity_unit text not null default 'L',
  cost numeric,                         -- optional, $ spent
  site_id bigint references sites(id),  -- optional, for per-site rollups
  meta_json jsonb not null default '{}'::jsonb  -- carries client_submission_id for offline-queue idempotency, same convention as api/reports.js
);
```

No `receipt_photo_url` column — cut from Phase 1, see "Deferred" below.

RLS: enabled with no policies, same deny-by-default backstop as every other
table (per README's documented model) — enforced entirely through
`api/fuellogs.js`'s session checks, not client-side Supabase calls.
`equipment_id`/`site_id` are cross-checked against the caller's own
`company_id` server-side before insert (caught in tenant-scope review),
not just left to the foreign key.

## Burn rate calculation

The actual "based on hours" part: burn rate isn't computed from a single
fuel-up, it's computed between two consecutive readings on the same
equipment.

```
burn_rate = quantity_used / (hour_reading_now - hour_reading_previous)
```

Where `hour_reading_previous` comes from whichever is more recent for that
equipment: the last fuel log, or the last pre/post-trip inspection reading
(`inspections.start_reading` / `end_reading`) — both already exist and
use the same `Hours`/`KM` unit per machine, so this is a straight lookup
across two tables keyed on `equipment_id` (and always double-keyed on
`company_id` too, per the tenant-scope note above — a cross-tenant
`equipment_id` must never feed into this lookup). `api/fuellogs.js`'s
`check_equipment` action already does this lookup for the entry form's
pre-fill; Phase 2 reuses the same query for the burn-rate calculation.

Flagging: a machine's burn rate more than some threshold (e.g. 25%) above
its own trailing average gets flagged on the dashboard, the same visual
pattern as the existing defect/monitor flags in `Analytics.jsx`. Needs a
few weeks of real data per machine before this is meaningful — first
version can just show the number, flagging comes once there's history to
compare against.

## Feature phases

**Phase 1 — logging (built)**
- Standalone "Log Fuel" flow (`src/FuelLog.jsx`), own tile in the worker
  menu, same worker-facing shell/style as `Inspection.jsx`.
- Fields: equipment (fleet picker or free text), worker name, hour/KM
  reading (pre-filled from `api/fuellogs.js`'s `check_equipment` — whichever
  is more recent between the last fuel log and the last pre/post-trip
  inspection reading — editable), quantity + unit (L/gal), cost (optional),
  site (optional, from the existing site list).
- Goes through the offline queue like every other worker-facing submit
  (`WorkerMenu.jsx`'s `RESUBMIT_HANDLERS` pattern, `resubmitFuelLog`) so a
  no-signal fill-up at a remote site still saves and sends automatically
  once back online. Draft autosave included (single-screen form, so there's
  no in-progress step to restore, just the field values).
- Admin can hide the "Log Fuel" tile per company via the existing
  document-toggle system (`fuellog` added to `BUILTIN_DOC_KEYS` in
  `api/customforms.js`), same as every other built-in document type.

**Phase 2 — burn rate + per-machine history (built)**
- `api/fuellogs.js`'s `list` action computes burn rate per fuel log at
  read time (not stored — recalculated from `fuel_logs` + `inspections`
  each time a supervisor/admin opens the tab), using the lookup above.
  Always double-keyed on `(company_id, equipment_label)`, never
  `equipment_label` alone — confirmed by a second tenant-scope review
  after this cross-table logic was added.
- New "Fuel Logs" tab in the Dashboard's Operations group (next to
  Maintenance), gated by the same `fuellog` document-toggle as the
  worker-facing tile. Grouped by machine, newest entries first within each
  group, each row showing quantity/cost/reading and the computed burn rate
  where one exists (no prior reading yet on that machine = no rate shown,
  not a zero or an error).

**Phase 3 — dashboard/analytics rollup (built)**
- `analyticsUtils.js`'s new `fuelSummary()` aggregates cost/quantity
  totals, cost + burn rate by machine, and cost by site — same style as
  the existing `maintenanceSummary()`/`equipmentIssueStats()` functions it
  sits next to, so the on-screen tab and the PDF export share one source
  of truth (same convention the file's own header comment calls out for
  Safety vs. Equipment analytics).
- `Analytics.jsx`'s `EquipmentAnalyticsPanel` (Advanced tier only, same
  gate as Equipment Issue Detail and Preventative Maintenance) gained a
  "Fuel Cost & Consumption" section — total cost/quantity, a "Machines
  Flagged" tile, a per-machine table (fuel-ups, cost, avg/latest burn
  rate), and a cost-by-site table.
- `generateEquipmentAnalyticsPDF.js` mirrors the same two tables, so the
  downloaded snapshot never drifts from what's on screen — confirmed by a
  pdf-consistency-reviewer pass (shared jsPDF/header/footer boilerplate
  untouched, same page-break convention reused).
- "Machines flagged": a plain filter (not stored, not alerted) for a
  machine with 3+ rated fuel-ups whose latest burn rate is 25%+ above its
  own trailing average — the same 25% guess from this doc's first draft,
  still unvalidated against real data. This is groundwork for Phase 4, not
  Phase 4 itself: it only shows up inside the Analytics tab a supervisor
  has to go open, not as a standing dashboard alert.

**Phase 4 — exception alerts (optional, only if Phase 3's flag data shows
it's worth it)**
- Turn the "Machines Flagged" count from something a supervisor has to
  find in the Equipment Analytics tab into a visible flag on the main
  Dashboard — matches the existing defect-flag pattern rather than adding
  new infrastructure (still no push/notification system).

## Deferred from Phase 1

- **Receipt photo capture.** Scoped above as optional, but building the full
  offline-photo path (a private storage bucket, signed-upload flow, and the
  blob-queue handling Incident.jsx already has for its own photos) is real
  added scope on its own. Cut from this first build to keep Phase 1 to "get
  fuel data flowing" rather than bundling a second feature into it. Worth
  its own short scoping pass if it turns out to matter to real users —
  don't build it speculatively.
- ~~A place to actually view logged entries~~ — done as of Phase 2 (Fuel
  Logs tab) and Phase 3 (Equipment Analytics rollup + PDF export).

## Remaining open question

**Threshold for the burn-rate flag (Phase 4)** — 25% above trailing average
was a guess for this doc, not a researched number. Needs real data from a
few companies' first month of use before picking one. Not a blocker for
anything built so far.

## TL;DR

Phases 1-3 built. Workers log fuel-ups from their own menu tile (hour/KM
reading pre-filled from whichever's more recent between the last fuel log
and the last pre/post-trip inspection); supervisors/admins see it three
ways — a Fuel Logs tab grouped by machine, a Fuel Cost & Consumption
section in Equipment Analytics (Advanced tier) with a per-machine and
per-site cost/burn-rate breakdown, and the same numbers in the PDF export.
Cut receipt photos from Phase 1 to keep the first build tight — real scope
on its own, not a five-minute add-on. What's left: Phase 4, turning the
"machines flagged" list into an actual dashboard alert, worth doing once
there's enough real usage to trust the 25% threshold.
