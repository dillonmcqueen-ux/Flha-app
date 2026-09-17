-- docs/schema/equipment-field-service-migration.sql
--
-- Worker-logged equipment service. See docs/scope-equipment-service-log.md.
--
-- Decision from Dillon, 2026-09-17: "supervisor only, workers shouldnt be
-- able to reset the interval but they should be able to log things like
-- filter changes or repairs they've done."
--
-- So there is no "this was the scheduled service" checkbox on the worker
-- form, and no promotion flow. A worker writes `field_service`, full stop.
-- Only the existing supervisor/admin `log_service` writes `pm_service`, and
-- only `pm_service` moves the preventative-maintenance baseline.
--
-- ── Why this is needed at all ────────────────────────────────────────────
--
-- api/maintenance.js's latestServiceByEquipment takes the MOST RECENT
-- equipment_maintenance_log row as the PM baseline, and list_status computes
-- usageSinceService = currentReading - baseline.service_reading. So without
-- a type column, a worker logging "changed the filters" at 1,240 hours
-- resets that machine's 250-hour service clock to zero: a service 40 hours
-- from due reads as freshly serviced and silently never comes due. That is
-- worse than not logging it, which is why this got its own column rather
-- than being forced through the existing action.
--
-- ── Backward compatibility, deliberately, this time ──────────────────────
--
-- The previous migration in this repo (corrective_actions_any_source) added
-- NOT NULL columns ahead of the code that sets them and silently broke a
-- live write path. This one cannot: `entry_type` has a DEFAULT, and the two
-- existing writers (api/maintenance.js's log_service and
-- api/companydata.js's tracking-enable baseline) both already set
-- service_reading and reading_unit, so they satisfy every constraint below
-- unchanged. Relaxing two NOT NULLs cannot break an existing writer either.
--
-- Verified before applying: both writers always supply a reading.

alter table public.equipment_maintenance_log
  add column if not exists entry_type text not null default 'pm_service',
  add column if not exists logged_by_roster_id bigint references public.roster(id);

alter table public.equipment_maintenance_log
  drop constraint if exists equipment_maintenance_log_entry_type_check;
alter table public.equipment_maintenance_log
  add  constraint equipment_maintenance_log_entry_type_check
  check (entry_type in ('pm_service', 'field_service'));

-- A field entry may not know the meter reading. The operator who greased
-- something at lunch and logs it that evening often does not, and demanding
-- one is how a log stops getting filled in. A pm_service still must have
-- one, because it is the baseline everything is measured from.
alter table public.equipment_maintenance_log
  alter column service_reading drop not null,
  alter column reading_unit    drop not null;

alter table public.equipment_maintenance_log
  drop constraint if exists equipment_maintenance_log_pm_needs_reading;
alter table public.equipment_maintenance_log
  add  constraint equipment_maintenance_log_pm_needs_reading
  check (entry_type <> 'pm_service' or (service_reading is not null and reading_unit is not null));

-- Both hot paths filter on entry_type: the PM baseline lookup and the
-- per-machine field-entry list.
create index if not exists equipment_maintenance_log_equipment_type_idx
  on public.equipment_maintenance_log (equipment_id, entry_type);

-- ── The two lines that make this real ────────────────────────────────────
--
-- Adding the column does nothing on its own. Two readers must learn to
-- ignore field entries, and missing either one reintroduces the exact bug
-- this exists to prevent:
--
--   1. api/maintenance.js  latestServiceByEquipment  -- the PM baseline.
--      Unfiltered, a filter change still resets the clock.
--
--   2. api/companydata.js  set_equipment_pm_interval -- decides whether to
--      write a starting baseline by checking whether ANY log row exists for
--      the machine. Unfiltered, a worker's field entry made before tracking
--      was switched on suppresses the baseline entirely, and the machine
--      reports not_started forever.
--
-- Both are covered by tests/unit/maintenance-readings.test.js.
