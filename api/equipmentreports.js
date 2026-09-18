// api/equipmentreports.js
// Weekly equipment usage reports — aggregates pre-trip/post-trip inspection
// readings into a per-machine summary (hours/km used, ending reading,
// outstanding flagged issues). Viewable from the Supervisor Dashboard.
// Actual PDF rendering happens client-side (same jsPDF-via-CDN pattern as
// every other document in the app) the first time a report is opened —
// this endpoint only computes and stores the underlying data, plus lets
// the client save the resulting pdf_url back once generated.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { renderEquipmentReportPdf, equipmentReportFilename } from '../server-lib/reportPdfs.js';
import { companyEquipmentIndex } from '../server-lib/equipmentScope.js';
import { inspectionReadingPoint, fuelReadingPoint, latestReadingsByEquipment } from '../server-lib/readings.js';
import { inspectionAttachments, attachmentForItem } from '../server-lib/inspectionAttachments.js';
import { EXPIRY_WARNING_DAYS, expiryStatus, expiryText, complianceDocLabel } from '../server-lib/compliance.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Hash-then-compare so mismatched-length inputs never short-circuit —
// timingSafeEqual itself throws on unequal-length buffers, and fixed-length
// digests sidestep that while still comparing in constant time.
function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a)).digest();
  const bh = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

async function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  if (!safeEqual(sig, expectedSig)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString());
  } catch (e) {
    return null;
  }
  if (!payload.issuedAt || Date.now() - payload.issuedAt > SESSION_TTL_MS) return null;

  // A login TICKET is not a session. api/login.js mints two roleless,
  // short-lived tokens with this same signature and secret — the roster
  // ticket (`purpose: 'roster'`, handed out after the company code alone,
  // BEFORE any PIN) and the master ticket (`purpose: 'master'`) — and the
  // comment there claims they can never be replayed as a session because
  // "every other protected endpoint in this app gates on session.role".
  // That was not true: a ticket carries no `userId`, so the roster
  // short-circuit below returned it as a valid session, and the handlers
  // that gate only on company scope rather than on role (list_equipment,
  // list_sops, list_sites, list_custom_fields, get_company_logo) answered
  // it — for this file's 7-day TTL, not the ticket's 5 minutes. Anyone
  // holding a company's worker code could read that company's reference
  // data without ever knowing a PIN.
  //
  // Nothing that is genuinely a session carries `purpose`, so rejecting it
  // outright is the whole fix, and it belongs here rather than in each
  // handler: the next endpoint added without a role check inherits it.
  if (payload.purpose) return null;

  // Admin sessions and legacy (pre-cutover) worker/supervisor sessions carry
  // no userId — nothing to live-check beyond the signature+TTL above.
  if (payload.role === 'admin' || !payload.userId) return payload;

  // Individually-identified (roster) sessions: re-check `active` on every
  // request, so deactivating someone takes effect on their very next call
  // instead of waiting out the token's TTL.
  const { data: rows, error } = await supabaseAdmin
    .from('roster')
    .select('active, role, company_id')
    .eq('id', payload.userId)
    .limit(1);
  if (error || !rows || rows.length === 0 || !rows[0].active) return null;
  if (rows[0].company_id !== payload.companyId) return null;
  return { ...payload, role: rows[0].role };
}

// Admins may act on any company they specify; supervisors are always
// locked to their own session.companyId, regardless of what they send.
function resolveCompanyId(session, requestedCompanyId) {
  if (session.role === 'admin') return requestedCompanyId || null;
  return session.companyId;
}

// flha-reports is a private bucket — the DB still stores a "public"-shaped
// URL (upload code never changed), but that string is never itself a
// working link. Every value handed to a client is swapped for a
// short-lived signed URL first.
function pathFromStoredUrl(url, bucket) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = decodeURIComponent(url.slice(idx + marker.length));
  // The bucket name is not a boundary. Supabase's createSignedUrl builds
  // `object/sign/<bucket>/<path>` as a URL string, and WHATWG URL parsing
  // collapses dot segments before the request goes out, so a stored path of
  // `../flha-reports/x.pdf` in the gatehouse-uploads bucket resolves to
  // `object/sign/flha-reports/x.pdf` and signs a file in a bucket the caller
  // was never reading. Reject traversal and absolute paths outright —
  // server-lib/uploadUrls.js's sanitizeFilename already drops these segments
  // on the write side, so no legitimately issued path contains one.
  if (!path || path.startsWith('/')) return null;
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  return path;
}

async function signStoredUrl(url, bucket, ttlSeconds = 3600) {
  const path = pathFromStoredUrl(url, bucket);
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  return error ? null : data.signedUrl;
}

// Renders + uploads the PDF server-side (service role key, no anon-key
// storage write involved at all) the first time a report is viewed, and
// caches the resulting path on the row so later views skip straight to
// signing it. Returns the stored ("public"-shaped, never handed to a
// client as-is) URL, or null if rendering/upload failed.
async function ensureEquipmentReportPdf(report, companyName, companyLogo) {
  if (report.pdf_url) return report.pdf_url;
  try {
    const buffer = await renderEquipmentReportPdf({ report, companyName, companyLogo });
    const filename = equipmentReportFilename({ companyName, report });
    const { error } = await supabaseAdmin.storage.from('flha-reports').upload(filename, buffer, { contentType: 'application/pdf', upsert: true });
    if (error) return null;
    const { data: pub } = supabaseAdmin.storage.from('flha-reports').getPublicUrl(filename);
    const url = pub?.publicUrl || null;
    if (url) await supabaseAdmin.from('equipment_reports').update({ pdf_url: url }).eq('id', report.id);
    return url;
  } catch (e) {
    return null;
  }
}

// Monday of the week containing `d` (ISO week, Monday start).
function mondayOf(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

// Resolves which report line a given inspection row belongs to.
//
// Exported so the rule can be tested directly — it is the whole of break #7
// and it has to be right in both directions at once.
//
// A row that carries a fleet id groups by that id, which is what fixes the
// merge bug: add_equipment requires only one of make/model/type and leaves
// unit_number optional with no uniqueness check, so two genuinely different
// machines can produce a byte-identical label and have their hours summed
// into one line.
//
// A row with no id (a machine typed by hand rather than picked from the
// fleet) adopts a fleet id when its label points at exactly ONE machine in
// the same week. That preserves the behaviour keying purely on id would have
// broken: a machine picked on Monday and typed on Tuesday must stay one line,
// not split into two.
//
// When a label points at SEVERAL fleet machines it is ambiguous by
// definition, so the free-text row keeps its own label key rather than being
// guessed onto one of them — guessing there would reintroduce the merge bug
// from the other side, and silently.
// Every equipment id this report can see must belong to the company the
// report is for — and unlike the inspections themselves, that is not
// something the query above can guarantee.
//
// `inspections.equipment_id` is checked on submit (server-lib/equipmentScope.js),
// but `results_json.attachedTrailer.id` cannot be: results_json is a
// free-form jsonb blob, and api/logs.js's pickAllowed whitelists the
// COLUMN, never the contents. The legitimate client picks the trailer out
// of the company's own fleet (src/Inspection.jsx:231-242), which is a UI
// convention rather than an enforced one — a worker can POST any
// results_json they like.
//
// An id from outside the fleet is dropped rather than rejected, because
// keyFor already has a correct answer for "no id": fall back to the label,
// exactly as a free-text machine does. So a bad id costs its row nothing
// but the join, and a stale id from a machine retired mid-week behaves the
// same way. Rejecting would throw away a whole week of real inspections
// over one bad field.
export function vetEquipmentIds(records, fleetIndex) {
  // The fleet row's own id is what survives, not the value that arrived —
  // so an id that round-tripped through jsonb as a string comes back as the
  // number every other row carries, and report_json can't end up holding
  // both spellings of the same machine.
  const owned = (id) => (id === null || id === undefined || id === '') ? null : (fleetIndex.get(String(id)) ?? null);
  (records || []).forEach((r) => {
    if (!r) return;
    r.equipment_id = owned(r.equipment_id);
    // Both attachment shapes are vetted in place, because both are read
    // downstream — see server-lib/inspectionAttachments.js. A machine can
    // now carry several, and every one of them is a client-supplied id
    // inside a free-form jsonb blob.
    const attached = r.results_json?.attachedTrailer;
    if (attached && typeof attached === 'object') attached.id = owned(attached.id);
    const list = r.results_json?.attachments;
    if (Array.isArray(list)) list.forEach(a => { if (a && typeof a === 'object') a.id = owned(a.id); });
  });
  return records;
}

export function buildEquipmentKeyResolver(records) {
  const labelToIds = {};
  (records || []).forEach((r) => {
    if (!r || !r.equipment_id) return;
    const label = (r.equipment_label || '').trim().toLowerCase();
    if (!label) return;
    if (!labelToIds[label]) labelToIds[label] = new Set();
    labelToIds[label].add(r.equipment_id);
  });

  return function keyFor(equipmentId, rawLabel) {
    if (equipmentId) return `eq:${equipmentId}`;
    const label = (rawLabel || '').trim().toLowerCase();
    const ids = label ? labelToIds[label] : null;
    if (ids && ids.size === 1) return `eq:${[...ids][0]}`;
    return `label:${label || 'unknown equipment'}`;
  };
}

// Folds the week's readings, from BOTH inspections and fuel logs, into each
// report line's ending reading -- break #1's second half.
//
// What this does NOT touch is the "Used" column. That is a sum of trip
// deltas (post-trip end minus its own start), and a fuel-up is a
// point-in-time odometer, not a trip. Adding one to the other would either
// double-count or invent usage. So usage stays inspection-derived by
// definition, and the map records that as a deliberate boundary rather than
// a remaining gap. The consequence worth knowing: a machine fuelled far more
// than its inspections account for still under-reports "Used", and the
// ending reading is where that shows up.
//
// Only entries already carrying a fleet id can be matched, because
// latestReadingsByEquipment keys on equipment_id. A free-text line that
// could not be reconciled onto the fleet (break #7's ambiguous case) has
// nothing to join a fuel log to -- correctly, since guessing which machine
// was fuelled is the same mistake break #7 exists to prevent.
export function applyLatestReadings(byEquipment, records, fuelLogs) {
  const points = [
    ...(records || []).map(inspectionReadingPoint),
    ...(fuelLogs || []).map(fuelReadingPoint),
  ];
  const latest = latestReadingsByEquipment(points);

  Object.values(byEquipment || {}).forEach((entry) => {
    if (!entry || !entry.equipmentId) return;
    const best = latest[entry.equipmentId];
    if (!best) return;

    // A reading in a different unit is not a bigger number, it is a
    // different question. api/maintenance.js has a unit_mismatch status for
    // exactly this; here the safe answer is to leave the line alone rather
    // than print kilometres under an hours heading.
    if (entry.unit && best.readingUnit && entry.unit !== best.readingUnit) return;

    // Strictly newer only, so a same-moment tie keeps what the inspection
    // pass already wrote.
    const currentAt = entry.endingReadingDate ? new Date(entry.endingReadingDate).getTime() : null;
    const bestAt = new Date(best.readingDate).getTime();
    if (currentAt != null && !(bestAt > currentAt)) return;

    entry.endingReading = best.reading;
    entry.endingReadingDate = best.readingDate;
    // Additive: reports written before this carry no source, and both
    // consumers render the reading the same way regardless.
    entry.endingReadingSource = best.readingSource;
  });
  return byEquipment;
}

// Folds a span of inspections into per-machine, per-week usage.
//
// Same arithmetic as the weekly report above and deliberately so: usage is
// the sum of COMPLETED trip deltas (a post-trip's end minus its own start),
// never a fuel-up reading. A fuel-up is a point-in-time odometer, and mixing
// the two either double-counts or invents hours — see applyLatestReadings.
//
// A trailer has no meter of its own, so a trip where it was attached credits
// it the SAME distance the towing unit logged, exactly as the weekly report
// does. Without that, every towed unit on the hours screen reads zero
// forever, which is worse than absent because it looks like an answer.
//
// `weekOf` is injected rather than imported so a test can pin the week
// boundary without pinning the clock.
export function foldWeeklyUsage(records, weekOf) {
  const keyFor = buildEquipmentKeyResolver(records || []);
  const machines = {};

  const ensure = (equipmentId, rawLabel) => {
    const key = keyFor(equipmentId, rawLabel);
    if (!machines[key]) {
      machines[key] = {
        equipmentId: equipmentId || null,
        equipmentLabel: rawLabel || 'Unknown equipment',
        unit: null,
        total: 0,
        weeks: {},
      };
    }
    const entry = machines[key];
    if (equipmentId && !entry.equipmentId) entry.equipmentId = equipmentId;
    return entry;
  };

  const credit = (entry, weekStart, amount, unit) => {
    if (!(amount > 0)) return;
    if (unit && !entry.unit) entry.unit = unit;
    entry.weeks[weekStart] = (entry.weeks[weekStart] || 0) + amount;
    entry.total += amount;
  };

  const byId = {};
  (records || []).forEach(r => { if (r && r.id != null) byId[r.id] = r; });

  (records || []).forEach(r => {
    if (!r || r.trip_type !== 'posttrip') return;
    const start = parseFloat(r.start_reading);
    const end = parseFloat(r.end_reading);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return;

    const entry = ensure(r.equipment_id, r.equipment_label);
    credit(entry, weekOf(r.created_at), end - start, r.reading_unit);

    // The pre-trip is where an attachment was recorded, and the post-trip is
    // where the distance is known, so the credit can only be worked out from
    // both halves of the same trip.
    const pretrip = r.linked_inspection_id != null ? byId[r.linked_inspection_id] : null;
    inspectionAttachments(pretrip?.results_json).forEach(attached => {
      const attachEntry = ensure(attached.id, attached.label);
      credit(attachEntry, weekOf(r.created_at), end - start, r.reading_unit);
    });
  });

  return Object.values(machines).sort((a, b) => b.total - a.total);
}

// Folds a company's compliance rows into the report's compliance section --
// break #14. The dates that park a machine when they lapse (CVIP,
// registration, insurance) reached exactly one screen before this; the
// weekly report is the thing a supervisor reads WITHOUT opening the
// dashboard, which is why it is the half worth having.
//
// Only what needs acting on is listed: anything expired, plus anything due
// inside the shared 30-day window (server-lib/expiry.js -- the same window
// the Compliance tab and the overview banner use). Everything else is a
// count, so "14 other documents current" still tells a supervisor the
// company is tracking them.
//
// `asOf` is the report's own week-end date, not today. A stored report is a
// snapshot: the PDF is rendered once and cached on the row
// (ensureEquipmentReportPdf), so "live at render time" would really mean
// "live the first time anyone opened it" and would then freeze anyway --
// two different answers for the same report depending on who opened it
// first. Classifying against the week the report covers gives one answer
// that stays true, and the section says which date it is as of.
//
// A machine whose fleet row cannot be read (deleted mid-week -- the FK
// cascades, so this is belt and braces) still lists, under a label rather
// than being dropped: an expired CVIP is worth printing even when the
// machine's name is not resolvable.
export function foldComplianceSnapshot(rows, fleetById, asOf) {
  const items = [];
  let currentCount = 0;
  for (const row of rows || []) {
    const status = expiryStatus(row.expiry_date, asOf);
    if (status === 'ok') { currentCount += 1; continue; }
    const eq = fleetById ? fleetById.get(String(row.equipment_id)) : null;
    const base = eq ? [eq.year, eq.make, eq.model, eq.type].filter(Boolean).join(' ') : '';
    const label = eq
      ? (base || `Machine #${eq.id}`) + (eq.unit_number ? ` (Unit ${eq.unit_number})` : '')
      : 'Unknown machine';
    items.push({
      equipmentId: row.equipment_id ?? null,
      equipmentLabel: label,
      docType: row.doc_type,
      // The supervisor's own wording wins; the doc type is the fallback, and
      // it is spelled the way the Compliance editor spells it rather than as
      // the raw 'cvip' the column stores.
      label: row.label || complianceDocLabel(row.doc_type),
      expiryDate: row.expiry_date,
      status,
      detail: expiryText(row.expiry_date, asOf),
      notes: row.notes || null,
    });
  }
  // Soonest first, so the worst-expired line is the first thing read.
  items.sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)));
  return {
    asOf,
    warningDays: EXPIRY_WARNING_DAYS,
    expiredCount: items.filter(i => i.status === 'expired').length,
    dueSoonCount: items.filter(i => i.status === 'due_soon').length,
    currentCount,
    items,
  };
}

// Builds the report_json for one company + week by pulling every
// pre-trip/post-trip inspection pair whose post-trip falls in the range.
async function buildReportForCompanyWeek(companyId, weekStartISO, weekEndISO) {
  // weekEndISO is exclusive upper bound (Monday after the week)
  const { data: records, error } = await supabaseAdmin
    .from('inspections')
    .select('id, equipment_id, equipment_label, worker_name, created_at, trip_type, linked_inspection_id, start_reading, end_reading, reading_unit, has_changes, results_json')
    .eq('company_id', companyId)
    .gte('created_at', weekStartISO)
    .lt('created_at', weekEndISO)
    .order('created_at', { ascending: true });
  if (error) throw new Error('Could not load inspections: ' + error.message);

  // Break #1's second half. api/maintenance.js has read both tables since
  // PR #118; this report did not, so a machine fuelled on Friday after its
  // last post-trip showed a Thursday odometer. The "Used" column is a
  // different question and stays inspection-only -- see the note on
  // applyLatestReadings below.
  const { data: fuelRows, error: fuelErr } = await supabaseAdmin
    .from('fuel_logs')
    .select('id, equipment_id, hour_reading, reading_unit, created_at')
    .eq('company_id', companyId)
    .gte('created_at', weekStartISO)
    .lt('created_at', weekEndISO);
  // A company that never bought the fuel module has no rows here, and a
  // failure to read them must not cost the whole report -- the inspection
  // half is still worth generating, just with the older reading.
  const fuelLogs = fuelErr ? [] : (fuelRows || []);

  // Drop any equipment id that isn't this company's before anything keys on
  // it — see vetEquipmentIds above for which ids can be attacker-chosen and
  // why they're dropped rather than rejected. Failing the build on an
  // unreadable fleet is deliberate: a report silently keyed on unvetted ids
  // is worse than a cron run that retries.
  const fleetIndex = await companyEquipmentIndex(supabaseAdmin, companyId);
  if (!fleetIndex) throw new Error('Could not load equipment fleet');
  vetEquipmentIds(records || [], fleetIndex);
  vetEquipmentIds(fuelLogs, fleetIndex);

  // Break #7 in docs/feature-interaction-map.md — this grouped machines by
  // their free-text equipment_label while inspections.equipment_id, a real
  // foreign key to the fleet, sat unread on the same rows.
  //
  // The live failure is the MERGE direction: add_equipment requires only one
  // of make/model/type and leaves unit_number optional with no uniqueness
  // check, so two genuinely different machines can produce a byte-identical
  // label and have their hours summed into one line. A supervisor then bills
  // or schedules service from a reading for a machine that does not exist.
  //
  // Keying purely on equipment_id would fix that and break the other
  // direction: a machine picked from the fleet on Monday and typed by hand on
  // Tuesday has an id on one row and null on the other, and would split into
  // two lines where today it correctly merges. So free-text rows are
  // reconciled onto a fleet entry by label first, and only fall back to a
  // label key when that is genuinely ambiguous.
  const keyFor = buildEquipmentKeyResolver(records || []);

  const byEquipment = {};
  const ensure = (equipmentId, rawLabel) => {
    const key = keyFor(equipmentId, rawLabel);
    const label = rawLabel || 'Unknown equipment';
    if (!byEquipment[key]) {
      // equipmentId is stored on the entry so a later reader can join to the
      // fleet. It is additive: only Object.values() is persisted into
      // report_json, so the key change is invisible to stored reports and
      // both consumers (server-lib/reportPdfs.js, Dashboard's
      // EquipmentReportCard) read equipmentLabel for display as before.
      byEquipment[key] = { equipmentId: equipmentId || null, equipmentLabel: label, unit: null, usage: 0, endingReading: null, endingReadingDate: null, issues: [], noPostTripCount: 0, attachments: [] };
    }
    const entry = byEquipment[key];
    // A row that carries the real id upgrades an entry first created from a
    // free-text row, so the report line can be joined to the fleet.
    if (equipmentId && !entry.equipmentId) entry.equipmentId = equipmentId;
    return entry;
  };

  (records || []).forEach(r => {
    const label = r.equipment_label || 'Unknown equipment';
    const entry = ensure(r.equipment_id, r.equipment_label);
    if (r.reading_unit) entry.unit = r.reading_unit;

    if (r.trip_type === 'posttrip') {
      const start = parseFloat(r.start_reading);
      const end = parseFloat(r.end_reading);
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        entry.usage += (end - start);
      }
      if (!isNaN(end)) {
        // Keep the latest (by created_at, already ascending) ending reading for the week.
        entry.endingReading = end;
        entry.endingReadingDate = r.created_at;
      }
      if (r.has_changes) {
        const rr = r.results_json || {};
        entry.issues.push({
          date: r.created_at,
          worker: r.worker_name,
          type: rr.changeCondition || 'Flagged',
          note: rr.changeNotes || '(no details provided)',
        });
      }
    } else {
      // pretrip
      const items = (r.results_json?.items) || [];
      const attachments = inspectionAttachments(r.results_json);
      items.filter(it => it.condition === 'Defective' || it.condition === 'Monitor').forEach(it => {
        // A tow unit's pretrip can carry a combined checklist (its own
        // items plus an attached trailer's, tagged by `unit` — see
        // Inspection.jsx's generateInspection). A trailer defect must land
        // on the TRAILER's own report entry, never the tow vehicle's, and
        // vice versa — otherwise a bad trailer tire reads as a defect on
        // the truck that happened to be pulling it that day.
        // src/Inspection.jsx stores the fleet id right alongside the name,
        // so the attachment's own entry is found by id and only falls back
        // to its label. attachmentForItem handles both the legacy
        // single-trailer records and the multi-attachment ones.
        const attached = attachmentForItem(it, attachments);
        const targetEntry = attached ? ensure(attached.id, attached.label) : entry;
        targetEntry.issues.push({
          date: r.created_at,
          worker: r.worker_name,
          type: it.condition,
          note: `${it.item}${it.note ? `: ${it.note}` : ''}`,
        });
      });
      // Track pretrips with no matching posttrip yet (checked out, not returned).
      const hasPosttrip = (records || []).some(p => p.trip_type === 'posttrip' && p.linked_inspection_id === r.id);
      if (!hasPosttrip) entry.noPostTripCount += 1;
    }
  });

  // Trailers have no engine and no reading of their own (see
  // Inspection.jsx's isTrailerTemplate), so their usage for the week comes
  // entirely from whatever towed them: a pretrip on a tow-capable unit can
  // carry results_json.attachedTrailer = { id, label }, and the distance
  // credited to the trailer is the SAME distance the towing unit logged on
  // its own linked posttrip for that trip.
  (records || []).forEach(r => {
    if (r.trip_type !== 'pretrip') return;
    const attachedList = inspectionAttachments(r.results_json);
    if (attachedList.length === 0) return;
    const posttrip = (records || []).find(p => p.trip_type === 'posttrip' && p.linked_inspection_id === r.id);
    if (!posttrip) return; // only credit completed trips
    const start = parseFloat(r.start_reading);
    const end = parseFloat(posttrip.end_reading);
    if (isNaN(start) || isNaN(end) || end < start) return;
    attachedList.forEach(attached => {
      const trailerEntry = ensure(attached.id, attached.label);
      trailerEntry.attachments.push({
        towUnit: r.equipment_label || 'Unknown equipment',
        // The tow unit's fleet id, so the display below can group two
        // identically-named trucks apart. Additive: reports written before
        // this have only towUnit, and both consumers fall back to it.
        towUnitId: r.equipment_id || null,
        distance: end - start,
        unit: r.reading_unit || 'km',
        date: posttrip.created_at,
      });
    });
  });

  applyLatestReadings(byEquipment, records || [], fuelLogs);

  const equipment = Object.values(byEquipment).sort((a, b) => a.equipmentLabel.localeCompare(b.equipmentLabel));
  const weekEnd = toISODate(new Date(new Date(weekEndISO).getTime() - 86400000));

  // Break #14: compliance expiries, snapshotted into report_json alongside
  // the week's usage -- see foldComplianceSnapshot above for why they are
  // stored at build time rather than read live at render time.
  //
  // Scoped by company_id on the row, like every other compliance query in
  // this app (api/companydata.js): never by an equipment id, which the
  // report has no reason to trust.
  //
  // Read failures and a company that tracks nothing are the same outcome
  // here -- no `compliance` key at all -- so a report is never lost over
  // this, and every report generated before today renders exactly as it
  // did. The section is not gated on a doc key because compliance has no
  // module to gate on (break #19, open); a company that has never added an
  // expiry date gets no section, which is what it had before.
  const { data: complianceRows, error: complianceErr } = await supabaseAdmin
    .from('equipment_compliance')
    .select('id, equipment_id, doc_type, label, expiry_date, notes')
    .eq('company_id', companyId);

  let compliance = null;
  if (!complianceErr && complianceRows && complianceRows.length > 0) {
    // Named from this company's own fleet only, and only the machines the
    // compliance rows actually point at.
    const ids = [...new Set(complianceRows.map(r => r.equipment_id).filter(id => id != null))];
    let fleetById = new Map();
    if (ids.length > 0) {
      const { data: eqRows } = await supabaseAdmin
        .from('equipment')
        .select('id, year, make, model, type, unit_number')
        .eq('company_id', companyId)
        .in('id', ids);
      fleetById = new Map((eqRows || []).map(e => [String(e.id), e]));
    }
    // Retired machines are included, exactly as they are on the Compliance
    // tab and in the overview banner. That a sold machine's expired CVIP
    // still counts anywhere is break #15, which is open and is not this
    // change -- filtering it here alone would make three surfaces disagree.
    compliance = foldComplianceSnapshot(complianceRows, fleetById, weekEnd);
  }

  const report = { weekStart: weekStartISO, weekEnd, equipment };
  if (compliance) report.compliance = compliance;
  return report;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });
  if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });

  try {
    // List all generated reports for a company, newest first.
    if (action === 'list_reports') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin
        .from('equipment_reports')
        .select('id, week_start, week_end, pdf_url, generated_by, created_at')
        .eq('company_id', companyId)
        .order('week_start', { ascending: false });
      if (error) return res.status(500).json({ error: 'Could not load reports.' });
      const reports = await Promise.all((data || []).map(async r => ({ ...r, pdf_url: await signStoredUrl(r.pdf_url, 'flha-reports') })));
      return res.status(200).json({ reports });
    }

    // Full detail (report_json) for one report. Generates the PDF
    // server-side on first view if it doesn't exist yet.
    if (action === 'get_report') {
      const { reportId } = req.body;
      if (!reportId) return res.status(400).json({ error: 'Missing report id.' });
      const { data, error } = await supabaseAdmin.from('equipment_reports').select('*').eq('id', reportId).limit(1);
      if (error || !data || data.length === 0) return res.status(404).json({ error: 'Report not found.' });
      const report = data[0];
      if (session.role === 'supervisor' && report.company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed.' });
      }
      const { data: coRows } = await supabaseAdmin.from('companies').select('id, name, logo_url').eq('id', report.company_id).limit(1);
      const company = coRows && coRows[0];
      const storedUrl = await ensureEquipmentReportPdf(report, company?.name || '', company?.logo_url || '');
      report.pdf_url = await signStoredUrl(storedUrl, 'flha-reports');
      return res.status(200).json({ report, company });
    }

    // Manual on-demand generation for a specific company + week (defaults to
    // last completed week if no dates given). Overwrites any existing report
    // for that company+week (upsert), clearing a stale pdf_url so it regenerates.
    //
    // Optional `pullUntil`: a "request a manual pull" cutoff — instead of the
    // full Monday-to-Monday week, pull everything from that week's Monday up
    // to this exact timestamp (e.g. mid-week, or partway through the current
    // week). Must fall inside the resolved week or it's rejected — this
    // action pulls ONE week's worth of data, not an arbitrary range. The
    // standard automated Sunday-11:59pm pull (cron-equipment-reports.js)
    // upserts on the same company_id+week_start key, so once the week
    // actually closes, the automatic full-week pull overwrites any earlier
    // manual partial pull for that week.
    if (action === 'generate_now') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { weekStart, pullUntil } = req.body;

      const anchor = weekStart ? new Date(weekStart) : new Date();
      const monday = weekStart ? mondayOf(anchor) : mondayOf(new Date(anchor.getTime() - 7 * 86400000));
      const weekStartISO = toISODate(monday);
      const nextMonday = new Date(monday); nextMonday.setDate(nextMonday.getDate() + 7);

      let weekEndExclusiveISO = nextMonday.toISOString();
      if (pullUntil) {
        const until = new Date(pullUntil);
        if (isNaN(until.getTime())) return res.status(400).json({ error: 'Invalid pull-until time.' });
        if (until < monday || until > nextMonday) return res.status(400).json({ error: "Requested time must fall within that report's week." });
        weekEndExclusiveISO = until.toISOString();
      }

      const reportJson = await buildReportForCompanyWeek(companyId, monday.toISOString(), weekEndExclusiveISO);
      reportJson.pulledUntil = pullUntil ? weekEndExclusiveISO : null;

      const { data, error } = await supabaseAdmin
        .from('equipment_reports')
        .upsert(
          { company_id: companyId, week_start: weekStartISO, week_end: reportJson.weekEnd, report_json: reportJson, pdf_url: null, generated_by: 'manual' },
          { onConflict: 'company_id,week_start' }
        )
        .select()
        .single();
      if (error) { console.error("equipment report save failed:", error.message); return res.status(500).json({ error: "Couldn't generate report. Try again." }); }

      const { data: coRows } = await supabaseAdmin.from('companies').select('name, logo_url').eq('id', companyId).limit(1);
      const company = coRows && coRows[0];
      const storedUrl = await ensureEquipmentReportPdf(data, company?.name || '', company?.logo_url || '');
      data.pdf_url = await signStoredUrl(storedUrl, 'flha-reports');
      return res.status(200).json({ ok: true, report: data });
    }

    // ── Weekly hours: the usage data that already existed with no screen ─
    //
    // The Sunday-night report already computes a week of usage per machine,
    // but it is a stored PDF snapshot of ONE week — there was no way to look
    // at a machine across weeks, which is the question behind every rental
    // decision, utilization argument and service forecast.
    if (action === 'list_weekly_hours') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const requested = parseInt(req.body.weeks, 10);
      const weeks = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 52) : 8;

      const firstMonday = mondayOf(new Date());
      firstMonday.setDate(firstMonday.getDate() - 7 * (weeks - 1));

      const { data: records, error } = await supabaseAdmin
        .from('inspections')
        .select('id, equipment_id, equipment_label, created_at, trip_type, linked_inspection_id, start_reading, end_reading, reading_unit, results_json')
        .eq('company_id', companyId)
        .gte('created_at', firstMonday.toISOString())
        .order('created_at', { ascending: true });
      if (error) return res.status(500).json({ error: 'Could not load inspection history.' });

      // Same vetting as the stored report: an id from outside this company's
      // fleet is dropped back to its label rather than rejected, so one bad
      // field costs a row its join and nothing else.
      const fleetIndex = await companyEquipmentIndex(supabaseAdmin, companyId);
      if (!fleetIndex) return res.status(500).json({ error: 'Could not load equipment fleet.' });
      vetEquipmentIds(records || [], fleetIndex);

      // A pre-trip's linked post-trip can land in the NEXT week (a night
      // shift, a trip that ran past midnight Sunday). The fold credits usage
      // to the post-trip's week, which is when the hours were finished, so
      // the week list is built from the same boundaries rather than from the
      // rows that happen to be present.
      const weekStarts = [];
      for (let i = 0; i < weeks; i++) {
        const d = new Date(firstMonday);
        d.setDate(d.getDate() + 7 * i);
        weekStarts.push(toISODate(d));
      }

      const machines = foldWeeklyUsage(records || [], (createdAt) => toISODate(mondayOf(new Date(createdAt))));
      return res.status(200).json({ weekStarts, machines });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error("equipmentreports handler failed:", e.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}

// Exported so the cron endpoint can reuse the exact same aggregation logic.
export { buildReportForCompanyWeek, mondayOf, toISODate };
