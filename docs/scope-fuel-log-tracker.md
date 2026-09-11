# Scope: fuel log tracker

Status: scoped, not built.

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

New table, same shape as the existing company-scoped tables
(`inspection_forms`, `equipment_reports`):

```sql
create table fuel_logs (
  id bigint generated always as identity primary key,
  company_id bigint not null references companies(id),
  equipment_id bigint references equipment(id),
  equipment_label text not null,       -- fallback for "other" equipment not in the roster, same pattern as Inspection.jsx's eqMode
  worker_name text not null,
  logged_at timestamptz not null default now(),
  hour_reading numeric,                 -- meter reading at fill-up time (Hours or KM, same unit as that equipment's inspections)
  reading_unit text,                    -- 'Hours' | 'KM'
  quantity numeric not null,            -- liters or gallons
  quantity_unit text not null,          -- 'L' | 'gal'
  cost numeric,                         -- optional, $ spent
  site_id bigint references sites(id),  -- optional, for per-site rollups
  receipt_photo_url text,               -- optional, signed-upload pattern (src/uploadViaSignedUrl.js)
  created_at timestamptz not null default now()
);
```

RLS: deny-by-default with no policies, same as every other table (per
README's documented model) — enforced entirely through `api/fuellogs.js`'s
session checks, not client-side Supabase calls.

## Burn rate calculation

The actual "based on hours" part: burn rate isn't computed from a single
fuel-up, it's computed between two consecutive readings on the same
equipment.

```
burn_rate = quantity_used / (hour_reading_now - hour_reading_previous)
```

Where `hour_reading_previous` comes from whichever is more recent for that
equipment: the last fuel log, or the last pre/post-trip inspection reading
(`inspection_forms.start_reading` / `end_reading`) — both already exist and
use the same `Hours`/`KM` unit per machine, so this is a straight lookup
across two tables keyed on `equipment_id`, no new source of truth needed.

Flagging: a machine's burn rate more than some threshold (e.g. 25%) above
its own trailing average gets flagged on the dashboard, the same visual
pattern as the existing defect/monitor flags in `Analytics.jsx`. Needs a
few weeks of real data per machine before this is meaningful — first
version can just show the number, flagging comes once there's history to
compare against.

## Feature phases

**Phase 1 — logging**
- Standalone "Log Fuel" flow, same worker-facing shell as `Inspection.jsx`
  (equipment picker, worker name, then the fuel fields).
- Fields: equipment, hour/KM reading (pre-filled with the most recent known
  reading, editable), quantity + unit, cost (optional), site (optional).
- Optional receipt photo, reusing `uploadViaSignedUrl.js` — same offline
  caveat as Incident's photo capture (queued, not instant, per
  `docs/scope-offline-capability.md`).
- Goes through the offline queue like every other worker-facing submit
  (`WorkerMenu.jsx`'s `RESUBMIT_HANDLERS` pattern) so a no-signal fill-up
  at a remote site still saves.

**Phase 2 — burn rate + per-machine history**
- `api/fuellogs.js` computes burn rate on each new log using the lookup
  above.
- Equipment detail view (wherever equipment history lives today, or a new
  tab) shows a fuel history list per machine with burn rate trend.

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

## Open questions to settle before building

1. **Unit default** — liters or gallons? Assuming liters (Canadian crews,
   matches the existing metric-leaning app), but confirm.
2. **Cost field mandatory or optional?** Recommend optional — some crews
   fuel from a company tank with no per-fill cost, others buy at a pump
   and have a receipt. Forcing it would block the tank-fuel case.
3. **Where does "Log Fuel" live in the worker menu?** Own tile next to
   Inspection, or folded into the post-trip inspection flow as an extra
   step? Recommend its own tile — fuel-ups don't always happen at
   post-trip (mid-shift fill-ups are common), so tying it to that flow
   would miss most real entries.
4. **Threshold for the burn-rate flag (Phase 4)** — 25% above trailing
   average was a guess for this doc, not a researched number. Needs real
   data from a few companies' first month of use before picking one.

## TL;DR

Standalone fuel-log entry (equipment, hour/KM reading, quantity, optional
cost/photo), reusing the hour readings already captured by pre/post-trip
inspections to compute burn rate per machine with no second data source.
Build order: logging → burn rate/history → dashboard rollup → exception
flags. Four things need your call before Phase 1 starts (unit, cost
required or not, where it lives in the worker menu, and the flag
threshold, though that last one can wait until Phase 4).
