-- GPS punch location for the time clock feature. Coordinates are captured
-- once, at the moment of clock in / clock out, via navigator.geolocation on
-- the worker's device (src/TimeClock.jsx) — this is NOT continuous location
-- tracking while a worker is clocked in. All columns are nullable: a denied
-- permission, timed-out GPS fix, or a supervisor manually adding/editing an
-- entry (api/companydata.js's add_time_entry/edit_time_entry) all leave
-- these null rather than blocking the punch. accuracy_m is the browser's
-- reported horizontal accuracy radius in meters (Geolocation API's
-- coords.accuracy), shown to the supervisor alongside the pin so an
-- obviously low-accuracy fix (e.g. IP-based fallback) isn't mistaken for a
-- precise one.
--
-- APPLIED to the live FORA Supabase project (wzyvbtzxxdcxgvbkcqmt) via
-- mcp__Supabase__apply_migration, migration name "time_clock_gps".
alter table time_clock_entries
  add column if not exists clock_in_lat numeric(9,6),
  add column if not exists clock_in_lng numeric(9,6),
  add column if not exists clock_in_accuracy_m numeric(8,2),
  add column if not exists clock_out_lat numeric(9,6),
  add column if not exists clock_out_lng numeric(9,6),
  add column if not exists clock_out_accuracy_m numeric(8,2);
