// api/maintenance.js
// Preventative maintenance tracking for fleet equipment: computing whether
// each tracked machine is OK / due soon / overdue based on usage readings
// captured on inspections, and logging completed services. Equipment is
// matched to inspections via inspections.equipment_id (a real FK, set only
// when a worker picks a machine from the registered fleet dropdown) — never
// by the free-text equipment_label, which has no uniqueness guarantee.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { inspectionReadingPoint, fuelReadingPoint, latestReadingsByEquipment } from '../server-lib/readings.js';

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
  // `name` comes from the roster row, never from the request: log_field_service
  // below records who did the work, and a worker-supplied name would make
  // that attribution worthless. Matches api/fuellogs.js's verifySession.
  const { data: rows, error } = await supabaseAdmin
    .from('roster')
    .select('active, role, company_id, name')
    .eq('id', payload.userId)
    .limit(1);
  if (error || !rows || rows.length === 0 || !rows[0].active) return null;
  if (rows[0].company_id !== payload.companyId) return null;
  return { ...payload, role: rows[0].role, name: rows[0].name };
}

function resolveCompanyId(session, requestedCompanyId) {
  if (session.role === 'admin') return requestedCompanyId || null;
  return session.companyId;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Reduces a set of maintenance log rows down to the most recent one per
// equipment_id (service_date desc, tie-broken by created_at then id).
//
// Only `pm_service` rows count. This is THE line that makes worker-logged
// field service safe: equipment_maintenance_log now also holds
// `field_service` entries — a filter change, a small repair an operator did
// themselves — and the baseline here is what usageSinceService is measured
// from. Let a field entry through and a machine 40 hours from its 250-hour
// service reads as freshly serviced and silently never comes due, which is
// strictly worse than never logging the filter change at all.
//
// The caller already filters at the query, so this is the second of two
// guards on purpose. See docs/schema/equipment-field-service-migration.sql.
export function latestServiceByEquipment(logs) {
  const latest = {};
  for (const log of logs) {
    if (log.entry_type && log.entry_type !== 'pm_service') continue;
    const current = latest[log.equipment_id];
    if (!current) { latest[log.equipment_id] = log; continue; }
    const a = `${log.service_date}T${log.created_at}`, b = `${current.service_date}T${current.created_at}`;
    if (a > b || (a === b && log.id > current.id)) latest[log.equipment_id] = log;
  }
  return latest;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ── Supervisor / Admin: computed maintenance status per tracked equipment ──
    if (action === 'list_status') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const { data: fleet, error: eqErr } = await supabaseAdmin
        .from('equipment')
        .select('id, year, make, model, type, unit_number, pm_interval')
        .eq('company_id', companyId)
        .order('id');
      if (eqErr) return res.status(500).json({ error: 'Could not load equipment.' });
      if (!fleet || fleet.length === 0) return res.status(200).json({ equipment: [] });

      const { data: inspections, error: inspErr } = await supabaseAdmin
        .from('inspections')
        .select('id, equipment_id, trip_type, start_reading, end_reading, reading_unit, created_at')
        .eq('company_id', companyId)
        .not('equipment_id', 'is', null);
      if (inspErr) return res.status(500).json({ error: 'Could not load inspection history.' });

      const { data: logs, error: logErr } = await supabaseAdmin
        .from('equipment_maintenance_log')
        .select('id, equipment_id, service_date, service_reading, reading_unit, performed_by, notes, created_at, entry_type')
        .eq('company_id', companyId)
        .eq('entry_type', 'pm_service');
      if (logErr) return res.status(500).json({ error: 'Could not load maintenance history.' });

      // Field entries are shown beside each machine but never feed the
      // baseline above. Capped per company rather than per machine — this
      // is a status screen, not a history view.
      const { data: fieldLogs } = await supabaseAdmin
        .from('equipment_maintenance_log')
        .select('id, equipment_id, service_date, performed_by, notes, created_at')
        .eq('company_id', companyId)
        .eq('entry_type', 'field_service')
        .order('created_at', { ascending: false })
        .limit(200);
      const fieldByEquipment = {};
      (fieldLogs || []).forEach(f => {
        if (!fieldByEquipment[f.equipment_id]) fieldByEquipment[f.equipment_id] = [];
        if (fieldByEquipment[f.equipment_id].length < 5) fieldByEquipment[f.equipment_id].push(f);
      });

      // Fuel-ups carry a meter reading too. A company that never bought the
      // fuel module simply has no rows here, so this is a no-op for them and
      // the status they see is unchanged.
      const { data: fuelLogs, error: fuelErr } = await supabaseAdmin
        .from('fuel_logs')
        .select('id, equipment_id, hour_reading, reading_unit, created_at')
        .eq('company_id', companyId)
        .not('equipment_id', 'is', null);
      if (fuelErr) return res.status(500).json({ error: 'Could not load fuel history.' });

      const currentReadings = latestReadingsByEquipment([
        ...(inspections || []).map(inspectionReadingPoint),
        ...(fuelLogs || []).map(fuelReadingPoint),
      ]);
      const lastServices = latestServiceByEquipment(logs || []);

      const equipmentStatus = fleet.map(eq => {
        const label = [eq.year, eq.make, eq.model, eq.type].filter(Boolean).join(' ') + (eq.unit_number ? ` (Unit ${eq.unit_number})` : '');
        const current = currentReadings[eq.id] || null;
        const baseline = lastServices[eq.id] || null;

        if (eq.pm_interval == null) {
          return { id: eq.id, label, pmInterval: null, current, lastService: null, usageSinceService: null, status: 'not_tracked', fieldService: fieldByEquipment[eq.id] || [] };
        }
        if (!baseline) {
          return { id: eq.id, label, pmInterval: eq.pm_interval, current, lastService: null, usageSinceService: null, status: 'not_started', fieldService: fieldByEquipment[eq.id] || [] };
        }
        if (current && current.readingUnit && current.readingUnit !== baseline.reading_unit) {
          return { id: eq.id, label, pmInterval: eq.pm_interval, current, lastService: baseline, usageSinceService: null, status: 'unit_mismatch', fieldService: fieldByEquipment[eq.id] || [] };
        }

        const usageSinceService = current ? Math.max(0, current.reading - baseline.service_reading) : 0;
        let status = 'ok';
        if (usageSinceService >= eq.pm_interval) status = 'overdue';
        else if (usageSinceService >= eq.pm_interval * 0.85) status = 'due_soon';

        return { id: eq.id, label, pmInterval: eq.pm_interval, current, lastService: baseline, usageSinceService, status, fieldService: fieldByEquipment[eq.id] || [] };
      });

      return res.status(200).json({ equipment: equipmentStatus });
    }

    // ── Worker: log service they performed themselves ───────────────
    //
    // "Changed the filters", "replaced a hose", "greased the pins". This is
    // the third kind of maintenance event and the only one that had nowhere
    // to go: a PM service resets the clock, a corrective action is a finding
    // still to be closed, and this is neither.
    //
    // Deliberately worker-callable and deliberately unable to touch the PM
    // baseline. Dillon, 2026-09-17: "supervisor only, workers shouldnt be
    // able to reset the interval but they should be able to log things like
    // filter changes or repairs they've done." There is no flag on this
    // action that can produce a pm_service row; a worker who did the
    // scheduled service tells a supervisor, who logs it through
    // log_service above. That asymmetry is the whole point, not a gap.
    if (action === 'log_field_service') {
      // Every other worker-callable write in the codebase blocks a suspended
      // tenant (api/fuellogs.js:131 is the closest sibling). Without this, a
      // company whose subscription lapsed would find its fuel logs 403ing
      // while its service logs kept landing.
      const { data: coRows } = await supabaseAdmin.from('companies').select('suspended').eq('id', session.companyId).limit(1);
      if (coRows && coRows[0] && coRows[0].suspended) {
        return res.status(403).json({ error: "Your company's access is suspended. Contact your administrator." });
      }

      const { equipmentId, notes, serviceReading, readingUnit } = req.body;
      if (!equipmentId) return res.status(400).json({ error: 'Pick a machine.' });
      const what = (notes || '').trim();
      if (!what) return res.status(400).json({ error: 'Say what you did.' });

      const { data: eqRows, error: eqErr } = await supabaseAdmin.from('equipment').select('id, company_id').eq('id', equipmentId).limit(1);
      if (eqErr || !eqRows || eqRows.length === 0) return res.status(404).json({ error: 'Equipment not found.' });
      const equipment = eqRows[0];
      // A worker could otherwise submit a guessed equipment id and file work
      // against another company's machine. Admins are cross-company by
      // design here, as everywhere else in this file.
      if (session.role !== 'admin' && equipment.company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed for this equipment.' });
      }

      // The reading is optional on purpose. Somebody who greased a machine
      // at lunch and logs it that evening often does not know the meter,
      // and demanding one is how a log stops getting filled in. When they
      // do supply one it needs a unit, or it cannot be compared to anything.
      const reading = serviceReading != null && serviceReading !== '' ? parseFloat(serviceReading) : null;
      if (reading != null && Number.isNaN(reading)) return res.status(400).json({ error: 'That reading is not a number.' });
      const unit = (readingUnit || '').trim() || null;
      if (reading != null && !unit) return res.status(400).json({ error: 'Select the reading unit.' });

      // Offline idempotency, by natural key rather than client_submission_id.
      // equipment_maintenance_log has no such column and adding one is a
      // migration this does not need: the same person logging the same words
      // on the same machine on the same day is a drained queue retry, not two
      // real events. Without this, a submission that succeeded but whose
      // response was lost comes back as a duplicate line on the machine.
      //
      // Deliberately a heuristic, and deliberately narrow — it cannot merge
      // two genuinely different notes, and a second real job on the same
      // machine the same day just needs different words.
      const { data: dupes } = await supabaseAdmin
        .from('equipment_maintenance_log')
        .select('id')
        .eq('company_id', equipment.company_id)
        .eq('equipment_id', equipment.id)
        .eq('entry_type', 'field_service')
        .eq('service_date', todayISO())
        .eq('notes', what.slice(0, 1000))
        .limit(1);
      if (dupes && dupes.length > 0) return res.status(200).json({ ok: true, duplicate: true });

      const { error } = await supabaseAdmin.from('equipment_maintenance_log').insert({
        company_id: equipment.company_id,
        equipment_id: equipment.id,
        entry_type: 'field_service',
        service_date: todayISO(),
        service_reading: reading,
        reading_unit: unit,
        // session.name is the roster row's name and only exists for
        // individually-identified sessions. A company still on a shared
        // login has no roster row, so it falls back to the session payload's
        // userName — without which every entry from such a company would
        // record "Worker" with a null roster id, i.e. no attribution at all,
        // which is the entire point of the row.
        performed_by: (session.name || session.userName || '').trim() || 'Worker',
        logged_by_roster_id: session.userId || null,
        notes: what.slice(0, 1000),
      });
      if (error) return res.status(500).json({ error: "Couldn't save that. Try again." });
      return res.status(200).json({ ok: true });
    }

    // ── Supervisor / Admin: log a completed service ─────────────────
    if (action === 'log_service') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { equipmentId, serviceDate, serviceReading, readingUnit, performedBy, notes } = req.body;
      if (!equipmentId) return res.status(400).json({ error: 'Missing equipment.' });
      if (!(performedBy || '').trim()) return res.status(400).json({ error: 'Enter who performed the service.' });

      const { data: eqRows, error: eqErr } = await supabaseAdmin.from('equipment').select('id, company_id').eq('id', equipmentId).limit(1);
      if (eqErr || !eqRows || eqRows.length === 0) return res.status(404).json({ error: 'Equipment not found.' });
      const equipment = eqRows[0];
      if (session.role === 'supervisor' && equipment.company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed to log service for this equipment.' });
      }

      const date = (serviceDate || '').trim() || todayISO();
      const isToday = date === todayISO();

      let reading = serviceReading != null && serviceReading !== '' ? parseFloat(serviceReading) : null;
      let unit = (readingUnit || '').trim() || null;

      if (reading == null) {
        if (!isToday) {
          return res.status(400).json({ error: 'Enter the reading — it can’t be auto-filled for a backdated service.' });
        }
        const { data: recent } = await supabaseAdmin
          .from('inspections')
          .select('trip_type, start_reading, end_reading, reading_unit, created_at')
          .eq('company_id', equipment.company_id)
          .eq('equipment_id', equipmentId)
          .order('created_at', { ascending: false })
          .limit(1);
        const row = recent && recent[0];
        const raw = row ? (row.trip_type === 'posttrip' ? row.end_reading : row.start_reading) : null;
        reading = raw != null && raw !== '' ? parseFloat(raw) : null;
        unit = row?.reading_unit || null;
        if (reading == null || Number.isNaN(reading)) {
          return res.status(400).json({ error: 'No inspection reading found for this equipment yet — enter a reading manually.' });
        }
      } else if (!unit) {
        return res.status(400).json({ error: 'Select the reading unit.' });
      }

      const { error } = await supabaseAdmin.from('equipment_maintenance_log').insert({
        company_id: equipment.company_id,
        equipment_id: equipmentId,
        service_date: date,
        service_reading: reading,
        reading_unit: unit,
        performed_by: performedBy.trim(),
        notes: (notes || '').trim() || null,
      });
      if (error) return res.status(500).json({ error: "Couldn't log service." });
      return res.status(200).json({ ok: true });
    }

    // ── The full service history, not just the current status ──────────
    //
    // list_status answers "is anything due?" and deliberately caps field
    // entries at 5 per machine because it is a status screen. This answers
    // the other question a supervisor asks — "what has actually been done to
    // this machine?" — which is the one a buyer, an auditor or a warranty
    // claim needs, and it needs every row, not the latest five.
    //
    // Labels are resolved here rather than client-side so a record for a
    // RETIRED machine still reads as that machine. The fleet query is
    // deliberately unfiltered on retired_at for exactly that reason: a
    // history that silently drops the machines you no longer own is not a
    // history.
    if (action === 'list_records') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const { data: fleet, error: eqErr } = await supabaseAdmin
        .from('equipment')
        .select('id, year, make, model, type, unit_number, retired_at')
        .eq('company_id', companyId);
      if (eqErr) return res.status(500).json({ error: 'Could not load equipment.' });

      const labels = {};
      (fleet || []).forEach(eq => {
        labels[eq.id] = {
          label: [eq.year, eq.make, eq.model, eq.type].filter(Boolean).join(' ') + (eq.unit_number ? ` (Unit ${eq.unit_number})` : ''),
          retired: !!eq.retired_at,
        };
      });

      const { data: logs, error: logErr } = await supabaseAdmin
        .from('equipment_maintenance_log')
        .select('id, equipment_id, entry_type, service_date, service_reading, reading_unit, performed_by, notes, created_at')
        .eq('company_id', companyId)
        .order('service_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1000);
      if (logErr) return res.status(500).json({ error: 'Could not load maintenance records.' });

      const records = (logs || []).map(row => ({
        id: row.id,
        equipmentId: row.equipment_id,
        equipmentLabel: labels[row.equipment_id]?.label || 'Unknown equipment',
        equipmentRetired: labels[row.equipment_id]?.retired || false,
        entryType: row.entry_type || 'pm_service',
        serviceDate: row.service_date,
        serviceReading: row.service_reading,
        readingUnit: row.reading_unit,
        performedBy: row.performed_by,
        notes: row.notes,
        createdAt: row.created_at,
      }));

      return res.status(200).json({ records });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
