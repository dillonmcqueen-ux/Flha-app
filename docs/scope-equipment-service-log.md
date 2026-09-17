# Scope: worker-logged equipment service

**Status: scoping only. Nothing built.** Asked for on 2026-09-17 while
building break #5, in these words:

> should there be a separate maintenance tab that log services, employee can
> say when they changed filters, did a small fix themself etc? scope that,
> i'm open to building if needed than forcing things to work sloppy

Short answer: **yes, and it should be its own thing.** There are three
different events being conflated right now, and two of them already have a
home. The third — a worker doing routine work themselves — has none, and
every place you could force it breaks something real.

---

## The three events

| Event | Example | Home today | Resets the PM clock? |
|---|---|---|---|
| **PM service** | 250-hour service done | `equipment_maintenance_log` via `log_service` | **Yes — that's its job** |
| **Defect needing a fix** | Hydraulic leak found on a pre-trip | `corrective_actions` (as of break #5) | No |
| **Routine self-performed work** | "Changed the filters, greased the pins" | **nowhere** | Should not |

---

## Why the existing service log is the wrong home

`api/maintenance.js`'s `latestServiceByEquipment` takes the **most recent**
`equipment_maintenance_log` row as the PM baseline, and
`list_status` computes `usageSinceService = currentReading -
baseline.service_reading`.

So if a worker logs "changed the filters" at 1,240 hours through the
existing `log_service`, the machine's 250-hour service clock **resets to
zero**. A real service that was 40 hours from due now reads as freshly
serviced, and it silently never comes due. That is worse than not logging
it at all: the log would actively hide the thing preventative maintenance
exists to catch.

Two other mismatches, smaller but real:

- `log_service` is **supervisor/admin only** (`api/maintenance.js:220`), and
  the whole point here is the operator who did the work recording it.
- `service_reading` and `reading_unit` are both `NOT NULL`, and it refuses a
  backdated entry without a reading. A worker who greased something at lunch
  and logs it that evening does not necessarily know the meter reading, and
  demanding one is how a log stops getting filled in.

## Why a corrective action is the wrong home either

Break #5 just made a Defective inspection item open a tracked corrective
action. Routine work is not that shape: a corrective action is **a finding
somebody still has to close**, with an owner, a target date and an age. Work
already done would be opened and immediately resolved, which pollutes
`correctiveActionAging` — "average days to resolve" drops toward zero and
stops meaning anything.

---

## What to build

A fourth entry type in the same table, not a fourth table. The distinction
that matters is **does this reset the PM clock**, and that is one column.

### Data

```sql
alter table public.equipment_maintenance_log
  add column if not exists entry_type text not null default 'pm_service',
  add column if not exists logged_by_roster_id bigint references public.roster(id);

alter table public.equipment_maintenance_log
  add constraint equipment_maintenance_log_entry_type_check
  check (entry_type in ('pm_service', 'field_service'));

-- Make the reading optional for field_service only. PM service still
-- requires one, because it is the baseline the clock is measured from.
alter table public.equipment_maintenance_log
  alter column service_reading drop not null,
  alter column reading_unit    drop not null;

alter table public.equipment_maintenance_log
  add constraint equipment_maintenance_log_pm_needs_reading
  check (entry_type <> 'pm_service' or (service_reading is not null and reading_unit is not null));
```

Existing rows all default to `pm_service`, which is what they are.

**The one line that matters:** `latestServiceByEquipment` must filter to
`entry_type = 'pm_service'`. Without it this whole change is pointless,
because field entries would still reset the clock.

### API

`api/maintenance.js` gains `log_field_service`, worker-callable, scoped the
same way `log_service` already is (`equipment.company_id` checked against
the session). Reading optional. `logged_by_roster_id` from
`session.userId` rather than a typed name, so this is one of the few places
FORA can identify a person properly — see break #3, which is the opposite
problem everywhere else.

`list_status` returns recent field entries per machine so the supervisor
sees them beside the PM status.

### UI

A **Service** entry on `WorkerMenu.jsx` — pick a machine, say what you did,
optionally a reading and a photo. Should be roughly as fast as a fuel-up,
which is the closest existing analogue (`src/FuelLog.jsx` is the model to
copy, including its last-reading prefill).

On the supervisor side, field entries show under each machine in the
existing maintenance panel. No new tab needed on the dashboard — the
maintenance view is already the place you look at a machine.

---

## Why this is worth building

- **It's the thing the operations manager already told you about.** "I know
  we have a problem with preventative maintenance, I wonder if this could
  help" — the gap in most PM programs isn't the scheduled service, it's that
  nobody records the twenty small things between them, so nobody knows what
  a machine has actually had done.
- **It feeds the Brain for free.** Break #4 just wired equipment inspections
  into `company_signals`. "Filters changed on Unit 12 three times this
  quarter" is the same class of signal and would slot into the same pipe.
- **It's the missing half of the fuel log.** FORA already records what goes
  *into* a machine. This records what was *done* to it. Same form shape,
  same fleet dropdown, same reading prefill.

## Size

Medium. One migration, one API action plus a change to `list_status`, one
worker form modelled on `FuelLog.jsx`, one panel addition. The riskiest line
is the `latestServiceByEquipment` filter, and it has an obvious test:
a field-service entry must not move a machine's PM status.

---

## Open questions

1. **Can a field entry ever reset the clock?** Someone doing the actual
   250-hour service themselves is a real case. Options: a "this was the
   scheduled service" checkbox on the worker form (needs the reading, then),
   or supervisor-only promotion of an entry afterwards. The second is
   safer — a worker can't accidentally wipe the interval — but adds a step.
2. **Photos?** `Incident.jsx` is the only worker form that takes them today.
   "Here's the cracked hose I replaced" is genuinely useful, but it means
   another storage path, and per `TODO.md` storage objects are still not
   namespaced by company.
3. **Parts and cost?** Fuel already tracks cost. If this tracks parts, the
   two together become a real cost-per-machine number — which is a stronger
   sales story than either alone, and also a much bigger build.
4. **Should a field entry be able to close a corrective action?** "Replaced
   the hose" arguably resolves the Defective item that opened it. Tempting,
   and it would close the loop properly — but it's the kind of automatic
   state change that's wrong when the fix was partial.
