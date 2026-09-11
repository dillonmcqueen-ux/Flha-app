// api/fuellogs.js
// Fuel-up logging (docs/scope-fuel-log-tracker.md Phase 1), tied to the same
// equipment fleet as Inspection.jsx. Same session-check pattern as the other
// protected endpoints (api/logs.js is the closest sibling).

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

  if (payload.role === 'admin' || !payload.userId) return payload;

  const { data: rows, error } = await supabaseAdmin
    .from('roster')
    .select('active, role, company_id, name')
    .eq('id', payload.userId)
    .limit(1);
  if (error || !rows || rows.length === 0 || !rows[0].active) return null;
  if (rows[0].company_id !== payload.companyId) return null;
  return { ...payload, role: rows[0].role, name: rows[0].name };
}

const LIST_COLUMNS = 'id, created_at, company_id, equipment_id, equipment_label, worker_name, hour_reading, reading_unit, quantity, quantity_unit, cost, site_id';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};

  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ── Worker: look up the most recent reading for a machine, so the fuel
    // form can pre-fill the hour/KM field instead of asking the worker to
    // remember it. Checks both fuel_logs and inspections (pre/post-trip
    // readings already captured there) and returns whichever is newer —
    // both use the same Hours/KM unit per machine, so there's one shared
    // "last known reading" regardless of which table it came from.
    if (action === 'check_equipment') {
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { equipmentLabel } = req.body;
      if (!equipmentLabel) return res.status(400).json({ error: 'Missing equipment.' });

      const [{ data: fuelRows }, { data: inspRows }] = await Promise.all([
        supabaseAdmin
          .from('fuel_logs')
          .select('hour_reading, reading_unit, created_at')
          .eq('company_id', session.companyId)
          .eq('equipment_label', equipmentLabel)
          .order('created_at', { ascending: false })
          .limit(1),
        supabaseAdmin
          .from('inspections')
          .select('start_reading, end_reading, reading_unit, created_at, trip_type')
          .eq('company_id', session.companyId)
          .eq('equipment_label', equipmentLabel)
          .order('created_at', { ascending: false })
          .limit(1),
      ]);

      const fuelReading = fuelRows && fuelRows[0]
        ? { value: fuelRows[0].hour_reading, unit: fuelRows[0].reading_unit, at: fuelRows[0].created_at }
        : null;
      const insp = inspRows && inspRows[0];
      const inspReading = insp
        ? { value: insp.trip_type === 'posttrip' ? (insp.end_reading || insp.start_reading) : insp.start_reading, unit: insp.reading_unit, at: insp.created_at }
        : null;

      let lastReading = null;
      if (fuelReading && inspReading) lastReading = new Date(fuelReading.at) >= new Date(inspReading.at) ? fuelReading : inspReading;
      else lastReading = fuelReading || inspReading || null;

      return res.status(200).json({ lastReading });
    }

    // ── Worker: submit a fuel-up entry ──────────────────────────────
    if (action === 'submit') {
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { data: coRows } = await supabaseAdmin.from('companies').select('suspended').eq('id', session.companyId).limit(1);
      if (coRows && coRows[0] && coRows[0].suspended) {
        return res.status(403).json({ error: "Your company's access is suspended. Contact your administrator." });
      }
      const { record, clientSubmissionId } = req.body;
      if (!record) return res.status(400).json({ error: 'Missing record.' });
      if (!record.equipment_label || !record.worker_name || record.quantity == null) {
        return res.status(400).json({ error: 'Missing required fields.' });
      }

      // A worker could otherwise submit a guessed/enumerated equipment_id or
      // site_id belonging to a different company — the row would still be
      // scoped to this company_id (so it stays unreadable by that other
      // tenant), but it would silently attach this fuel entry to another
      // company's equipment/site record, which a future burn-rate lookup
      // keyed on equipment_id could then read across tenants.
      if (record.equipment_id) {
        const { data: eqRows } = await supabaseAdmin.from('equipment').select('company_id').eq('id', record.equipment_id).limit(1);
        if (!eqRows || eqRows.length === 0 || eqRows[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed.' });
        }
      }
      if (record.site_id) {
        const { data: siteRows } = await supabaseAdmin.from('sites').select('company_id').eq('id', record.site_id).limit(1);
        if (!siteRows || siteRows.length === 0 || siteRows[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed.' });
        }
      }

      // Idempotency (docs/scope-offline-capability.md Phase 1 pattern) — a
      // queued offline submission may get retried more than once.
      if (clientSubmissionId) {
        const { data: existingRows } = await supabaseAdmin
          .from('fuel_logs')
          .select('id')
          .eq('company_id', session.companyId)
          .eq('meta_json->>client_submission_id', clientSubmissionId)
          .limit(1);
        if (existingRows && existingRows.length > 0) {
          return res.status(200).json({ id: existingRows[0].id });
        }
      }

      const recordToInsert = { ...record };
      if (clientSubmissionId) {
        recordToInsert.meta_json = { ...(recordToInsert.meta_json || {}), client_submission_id: clientSubmissionId };
      }

      const { data, error } = await supabaseAdmin
        .from('fuel_logs')
        .insert({ ...recordToInsert, company_id: session.companyId })
        .select('id')
        .limit(1);
      if (error) return res.status(500).json({ error: 'Save failed. Try again.' });
      return res.status(200).json({ id: data?.[0]?.id || null });
    }

    // ── Supervisor / Admin: load fuel logs, each with a computed burn rate ──
    // Burn rate (docs/scope-fuel-log-tracker.md Phase 2) = quantity used /
    // (this reading - the previous known reading for that same machine).
    // "Previous known reading" is looked up across BOTH fuel_logs and
    // inspections (pre/post-trip readings) — a fuel-up between two
    // inspections still gets a real number, and vice versa — always keyed
    // on (company_id, equipment_label) together, never equipment_label
    // alone, so one tenant's machine history can never feed another's.
    if (action === 'list') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      let query = supabaseAdmin.from('fuel_logs').select(LIST_COLUMNS).order('created_at', { ascending: false });
      if (session.role === 'supervisor') query = query.eq('company_id', session.companyId);
      const { data: fuelRows, error } = await query;
      if (error) return res.status(500).json({ error: 'Could not load fuel logs.' });

      const companyIds = session.role === 'supervisor'
        ? [session.companyId]
        : [...new Set((fuelRows || []).map(r => r.company_id))];

      let inspRows = [];
      if (companyIds.length > 0) {
        const { data } = await supabaseAdmin
          .from('inspections')
          .select('company_id, equipment_label, start_reading, end_reading, reading_unit, created_at, trip_type')
          .in('company_id', companyIds);
        inspRows = data || [];
      }

      const timelineKey = (companyId, label) => `${companyId}::${label}`;
      const timelines = new Map();
      const addPoint = (companyId, label, reading, unit, at) => {
        const value = parseFloat(reading);
        if (!label || Number.isNaN(value)) return;
        const k = timelineKey(companyId, label);
        if (!timelines.has(k)) timelines.set(k, []);
        timelines.get(k).push({ value, unit, at: new Date(at).getTime() });
      };
      inspRows.forEach(insp => {
        const reading = insp.trip_type === 'posttrip' ? (insp.end_reading || insp.start_reading) : insp.start_reading;
        addPoint(insp.company_id, insp.equipment_label, reading, insp.reading_unit, insp.created_at);
      });
      (fuelRows || []).forEach(f => addPoint(f.company_id, f.equipment_label, f.hour_reading, f.reading_unit, f.created_at));

      const records = (fuelRows || []).map(f => {
        const thisReading = parseFloat(f.hour_reading);
        let burnRate = null;
        if (!Number.isNaN(thisReading)) {
          const points = timelines.get(timelineKey(f.company_id, f.equipment_label)) || [];
          const at = new Date(f.created_at).getTime();
          let prior = null;
          for (const p of points) {
            if (p.at < at && p.unit === f.reading_unit && (!prior || p.at > prior.at)) prior = p;
          }
          if (prior) {
            const delta = thisReading - prior.value;
            if (delta > 0) burnRate = Number(f.quantity) / delta;
          }
        }
        return { ...f, burn_rate: burnRate };
      });

      return res.status(200).json({ records });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
