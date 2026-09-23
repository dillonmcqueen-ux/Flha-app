// server-lib/fleetActivity.js
// What the fleet has been doing, folded from records FORA already holds.
//
// Break #13: daily_reports.equipment_ids was produced, vetted and selected
// into the list payload, and then read by nothing. lastOnSiteByEquipment is
// its first consumer (Fleet Overview, Dillon's pick on 2026-09-23).
//
// Break #18, as Dillon scoped it on 2026-09-23: "Attachments won't get a
// preventative maintenance log, unless it's a trailer. Things like loader
// forks don't require preventative maintenance." Plus: track what an
// attachment is mounted on, and name the most used and most repaired
// attachment in analytics. A trailer has no meter, so its PM clock runs on
// the distance it was towed, the same credit the weekly report and the
// Weekly Hours screen already give it (api/equipmentreports.js
// foldWeeklyUsage). Towed distance is summed here rather than faked into a
// reading point, because a trailer has no odometer for a point to be on.
//
// Every function is pure so it can be pinned without a database
// (tests/unit/fleet-activity.test.js).

import { inspectionAttachments } from './inspectionAttachments.js';
import { isTrailerTemplate } from '../src/equipmentInspectionTemplates.js';

const DISTANCE_UNITS = new Set(['KM', 'Kilometers', 'km', 'Miles', 'mi']);

/** A report's calendar day: report_date when set, else the day it was filed. */
function reportDay(row) {
  if (row.report_date) return String(row.report_date).slice(0, 10);
  return row.created_at ? String(row.created_at).slice(0, 10) : null;
}

/**
 * { [equipmentId]: { date, site } } from the latest daily report naming each
 * machine. Attachments are pickable on a daily report too, so they get one.
 */
export function lastOnSiteByEquipment(dailyReports) {
  const out = Object.create(null);
  for (const r of dailyReports || []) {
    if (!r || !Array.isArray(r.equipment_ids)) continue;
    const date = reportDay(r);
    if (!date) continue;
    for (const id of r.equipment_ids) {
      if (id == null) continue;
      const current = out[id];
      if (!current || date > current.date) out[id] = { date, site: r.site || null };
    }
  }
  return out;
}

/**
 * { [attachmentId]: { hostId, hostLabel, at } } from the most recent
 * pre-trip each attachment was recorded on. The pre-trip is where an
 * attachment is picked; a post-trip only carries items forward.
 */
export function mountedOnByAttachment(inspections) {
  const out = Object.create(null);
  for (const r of inspections || []) {
    if (!r || r.trip_type === 'posttrip') continue;
    for (const a of inspectionAttachments(r.results_json)) {
      if (a.id == null) continue;
      const current = out[a.id];
      if (!current || String(r.created_at) > String(current.at)) {
        out[a.id] = { hostId: r.equipment_id ?? null, hostLabel: r.equipment_label || null, at: r.created_at };
      }
    }
  }
  return out;
}

/**
 * Whether a machine may carry a PM schedule. Every machine may, except an
 * attachment that is not a trailer.
 */
export function pmAllowedFor(eq) {
  if (!eq || !eq.is_attachment) return true;
  return isTrailerTemplate(eq.type || '', eq.make || '', eq.model || '');
}

/**
 * The distance a towed attachment covered since `sinceDate` (YYYY-MM-DD or
 * ISO): the sum of every completed trip whose pre-trip recorded it. Only
 * distance-metered trips count; an hour meter says nothing about how far a
 * trailer travelled.
 */
export function towedDistanceSince(inspections, attachmentId, sinceDate) {
  const since = sinceDate ? String(sinceDate).slice(0, 10) : '';
  const byId = Object.create(null);
  for (const r of inspections || []) if (r && r.id != null) byId[r.id] = r;

  let distance = 0, trips = 0, unit = null;
  for (const r of inspections || []) {
    if (!r || r.trip_type !== 'posttrip') continue;
    if (since && String(r.created_at).slice(0, 10) < since) continue;
    if (!DISTANCE_UNITS.has(r.reading_unit)) continue;
    const start = parseFloat(r.start_reading), end = parseFloat(r.end_reading);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    const pre = r.linked_inspection_id != null ? byId[r.linked_inspection_id] : null;
    const onIt = inspectionAttachments(pre?.results_json).some(a => a.id != null && String(a.id) === String(attachmentId));
    if (!onIt) continue;
    distance += end - start;
    trips += 1;
    unit = unit || r.reading_unit;
  }
  return { distance, trips, unit };
}

/**
 * Most used (pre-trips it was recorded on) and most repaired (maintenance
 * log entries of any kind) attachments, busiest first, zero counts dropped.
 * `fleet` rows need { id, is_attachment, label }.
 */
export function attachmentStats(fleet, inspections, maintenanceLogs, limit = 5) {
  const attachments = (fleet || []).filter(e => e && e.is_attachment);
  const ids = new Set(attachments.map(e => String(e.id)));
  const trips = Object.create(null), repairs = Object.create(null);

  for (const r of inspections || []) {
    if (!r || r.trip_type === 'posttrip') continue;
    for (const a of inspectionAttachments(r.results_json)) {
      if (a.id != null && ids.has(String(a.id))) trips[a.id] = (trips[a.id] || 0) + 1;
    }
  }
  for (const l of maintenanceLogs || []) {
    if (l && l.equipment_id != null && ids.has(String(l.equipment_id))) repairs[l.equipment_id] = (repairs[l.equipment_id] || 0) + 1;
  }

  const rows = attachments.map(e => ({ equipmentId: e.id, label: e.label, trips: trips[e.id] || 0, repairs: repairs[e.id] || 0 }));
  return {
    mostUsed: rows.filter(r => r.trips > 0).sort((a, b) => b.trips - a.trips).slice(0, limit),
    mostRepaired: rows.filter(r => r.repairs > 0).sort((a, b) => b.repairs - a.repairs).slice(0, limit),
  };
}
