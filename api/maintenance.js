// api/maintenance.js
// Preventative maintenance tracking for fleet equipment: computing whether
// each tracked machine is OK / due soon / overdue based on usage readings
// captured on inspections, and logging completed services. Equipment is
// matched to inspections via inspections.equipment_id (a real FK, set only
// when a worker picks a machine from the registered fleet dropdown) — never
// by the free-text equipment_label, which has no uniqueness guarantee.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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

function resolveCompanyId(session, requestedCompanyId) {
  if (session.role === 'admin') return requestedCompanyId || null;
  return session.companyId;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

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

// Reduces a set of maintenance log rows down to the most recent one per
// equipment_id (service_date desc, tie-broken by created_at then id).
function latestServiceByEquipment(logs) {
  const latest = {};
  for (const log of logs) {
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
        .select('id, equipment_id, service_date, service_reading, reading_unit, performed_by, notes, created_at')
        .eq('company_id', companyId);
      if (logErr) return res.status(500).json({ error: 'Could not load maintenance history.' });

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
          return { id: eq.id, label, pmInterval: null, current, lastService: null, usageSinceService: null, status: 'not_tracked' };
        }
        if (!baseline) {
          return { id: eq.id, label, pmInterval: eq.pm_interval, current, lastService: null, usageSinceService: null, status: 'not_started' };
        }
        if (current && current.readingUnit && current.readingUnit !== baseline.reading_unit) {
          return { id: eq.id, label, pmInterval: eq.pm_interval, current, lastService: baseline, usageSinceService: null, status: 'unit_mismatch' };
        }

        const usageSinceService = current ? Math.max(0, current.reading - baseline.service_reading) : 0;
        let status = 'ok';
        if (usageSinceService >= eq.pm_interval) status = 'overdue';
        else if (usageSinceService >= eq.pm_interval * 0.85) status = 'due_soon';

        return { id: eq.id, label, pmInterval: eq.pm_interval, current, lastService: baseline, usageSinceService, status };
      });

      return res.status(200).json({ equipment: equipmentStatus });
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

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
