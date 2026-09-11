# Scope: fuel log tracker

Status: **Phases 1-2 built.** Manual fuel-up logging is live — `src/FuelLog.jsx`
(own tile in the worker menu, per the confirmed decision below), `api/fuellogs.js`,
and the `fuel_logs` table (migration applied to production). Phase 2 added
per-row burn rate calculation and a supervisor/admin-facing "Fuel Logs" tab
in the Dashboard (Operations group), grouped by machine. Not yet built:
Phases 3-4 (dashboard cost/PDF rollup, exception alerts) and the
receipt-photo capture mentioned below — cut from Phase 1 to keep the first
build small; see "Deferred from Phase 1" at the bottom.

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

**Phase 3 — dashboard/analytics rollup**
- New stat card or `Analytics.jsx` section: total fuel cost this
  period, cost per site, machines flagged for above-normal burn rate.
- PDF export of a fuel report, following the existing per-document PDF
  pattern (`src/generateEquipmentAnalyticsPDF.js` is the closest existing
  template).

**Phase 4 — exception alerts (optional, only if Phase 2/3 data shows it's
worth it)**
- Dashboard flag when a machine's latest burn rate crosses its own
  threshold. Not a notification/push system, just a visible flag —
  matches the existing defect-flag pattern rather than adding new
  infrastructure.

## Deferred from Phase 1

- **Receipt photo capture.** Scoped above as optional, but building the full
  offline-photo path (a private storage bucket, signed-upload flow, and the
  blob-queue handling Incident.jsx already has for its own photos) is real
  added scope on its own. Cut from this first build to keep Phase 1 to "get
  fuel data flowing" rather than bundling a second feature into it. Worth
  its own short scoping pass if it turns out to matter to real users —
  don't build it speculatively.
- **A place to actually view logged entries.** `api/fuellogs.js` has a
  `list` action (supervisor/admin, company-scoped) so the data isn't a dead
  end, but there's no screen calling it yet — that's Phase 2's "per-machine
  history" and Phase 3's dashboard rollup. Until then, entries are visible
  only via direct DB query.

## Remaining open question

**Threshold for the burn-rate flag (Phase 4)** — 25% above trailing average
was a guess for this doc, not a researched number. Needs real data from a
few companies' first month of use before picking one. Not a blocker for
anything built so far.

## TL;DR

Phase 1 built: standalone "Log Fuel" tile, hour/KM reading pre-filled from
whichever is more recent between the last fuel log and the last pre/post-trip
inspection, offline-queue-backed submit, admin can hide it per company.
Cut receipt photos and a viewing screen from this first pass to keep it
tight — both are real scope on their own, not a five-minute add-on. Next up
per the phase order: burn-rate calculation + per-machine history (Phase 2).
