// server-lib/readings.js
// One definition of "the machine's latest known reading", shared by every
// feature that needs it.
//
// Break #1 in docs/feature-interaction-map.md was exactly this drifting:
// api/maintenance.js computed preventative-maintenance status from
// inspection readings alone while api/fuellogs.js already read both tables,
// so a company that fuelled daily and inspected weekly had a PM clock
// running behind readings FORA already held. PR #118 fixed the maintenance
// half by putting both sources through one reducer -- but left that reducer
// inside api/maintenance.js, where the weekly equipment report could not
// reach it and went on answering the same question a different way.
//
// So it lives here now. The move is the point: a second copy of this logic
// is how break #1 happened in the first place.

// A usage reading is a usage reading regardless of which form captured it.
// Inspections record one on every pre/post-trip; a fuel-up records one too,
// and api/fuellogs.js's check_equipment already treats the two as a single
// shared "last known reading" per machine. Preventative maintenance used to
// read inspections alone, so a company that fuels daily and inspects weekly
// had a PM clock running behind readings already on file — a service could
// come due and never flag. Both tables now feed the same reducer.
//
// Normalizes one inspection row to a comparable reading point. A posttrip's
// end_reading is the machine's state at the end of that trip; anything else
// uses start_reading.
export function inspectionReadingPoint(insp) {
  const raw = insp.trip_type === 'posttrip' ? insp.end_reading : insp.start_reading;
  return { equipmentId: insp.equipment_id, raw, unit: insp.reading_unit, at: insp.created_at, id: insp.id, source: 'inspection' };
}

// Same, for a fuel-up. fuel_logs.hour_reading holds hours or kilometres
// depending on the machine, exactly as inspections' readings do.
export function fuelReadingPoint(log) {
  return { equipmentId: log.equipment_id, raw: log.hour_reading, unit: log.reading_unit, at: log.created_at, id: log.id, source: 'fuel_log' };
}

// Reduces reading points from every source down to the single most recent
// one per equipment_id. Ties on created_at fall to the inspection, then to
// the higher id within one source — row ids are only comparable to
// themselves, so they can never order an inspection against a fuel log.
export function latestReadingsByEquipment(points) {
  // Null-prototype: this function is exported for unit testing, so key it
  // defensively rather than relying on every future caller passing ids that
  // came from the database. Today they all do.
  const latest = Object.create(null);
  for (const point of points) {
    if (!point.equipmentId) continue;
    const reading = point.raw != null && point.raw !== '' ? parseFloat(point.raw) : null;
    if (reading == null || Number.isNaN(reading)) continue;

    const current = latest[point.equipmentId];
    if (!current) { latest[point.equipmentId] = { ...point, reading }; continue; }

    const a = new Date(point.at).getTime(), b = new Date(current.at).getTime();
    const newer = a > b
      || (a === b && point.source === 'inspection' && current.source !== 'inspection')
      || (a === b && point.source === current.source && point.id > current.id);
    if (newer) latest[point.equipmentId] = { ...point, reading };
  }

  const readings = Object.create(null);
  Object.entries(latest).forEach(([equipmentId, point]) => {
    readings[equipmentId] = {
      reading: point.reading,
      readingUnit: point.unit || null,
      readingDate: point.at,
      readingSource: point.source,
    };
  });
  return readings;
}
