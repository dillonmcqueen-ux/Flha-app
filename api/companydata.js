// api/companydata.js
// Protected access to company reference data: SOPs, Sites, Equipment, and
// Custom Fields. These were previously read/written directly from the
// browser with the anon key — this endpoint lets us lock down RLS on
// those tables without breaking the app, since everything now goes
// through session-verified server logic instead.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  if (sig !== expectedSig) return null;
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

// For any read/write scoped to a company: admins may act on any company
// they specify; supervisors and workers are always locked to their own
// session.companyId, regardless of what companyId they send.
function resolveCompanyId(session, requestedCompanyId) {
  if (session.role === 'admin') return requestedCompanyId || null;
  return session.companyId;
}

// Total active roster seats a plan tier allows — workers and supervisors
// combined, since both count as a "user" for billing.
const SEAT_CAP_BY_TIER = { basic: 10, advanced: 50 };

function genSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString('hex');
}

// No cross-member uniqueness check — login always resolves a specific
// roster row by name before the PIN is ever checked, so two people sharing
// a 4-digit PIN has no security impact, and skipping the check keeps this
// O(1) instead of re-hashing against every existing member on the roster.
function genPin() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ══ COMPANY (branding-only, no codes/contact info) ═════════════════
    // These exist so the Dashboard and worker-facing forms never need to
    // query the companies table directly with the anon key — that table
    // also holds worker_code/supervisor_code (login credentials) and
    // contact info, none of which belong in these responses.

    // Admin: every company (for the multi-company selector). Supervisor:
    // just their own, as a one-element array — same shape either way so
    // Dashboard.jsx doesn't need to branch on role.
    if (action === 'list_companies_brief') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      let query = supabaseAdmin.from('companies').select('id, name, logo_url, plan_tier').order('id');
      if (session.role === 'supervisor') query = query.eq('id', session.companyId);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: 'Could not load companies.' });
      return res.status(200).json({ companies: data || [] });
    }

    if (action === 'get_company_logo') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin.from('companies').select('logo_url').eq('id', companyId).limit(1);
      if (error) return res.status(500).json({ error: 'Could not load company.' });
      return res.status(200).json({ logo_url: (data && data[0] && data[0].logo_url) || '' });
    }

    // ══ ROSTER ═══════════════════════════════════════════════════════
    // Individually-named, individually-PIN'd workers and supervisors,
    // replacing the two shared company-wide codes. Deactivating one row
    // (below) cuts off exactly that person on their very next request —
    // verifySession live-checks `active` for any session carrying a
    // userId. Admins can manage any company's roster; supervisors only
    // their own, same resolveCompanyId pattern as everything else here.

    if (action === 'list_roster') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const { data: members, error } = await supabaseAdmin
        .from('roster')
        .select('id, name, role, active, last_login_at, deactivated_at, created_at')
        .eq('company_id', companyId)
        .order('role', { ascending: true })
        .order('name', { ascending: true });
      if (error) return res.status(500).json({ error: 'Could not load roster.' });

      const { data: coRows, error: coErr } = await supabaseAdmin.from('companies').select('plan_tier').eq('id', companyId).limit(1);
      if (coErr) return res.status(500).json({ error: 'Could not load plan tier.' });
      const tier = (coRows && coRows[0] && coRows[0].plan_tier) || 'basic';
      const activeSeatCount = (members || []).filter(m => m.active).length;

      return res.status(200).json({ members: members || [], activeSeatCount, cap: SEAT_CAP_BY_TIER[tier] || SEAT_CAP_BY_TIER.basic, tier });
    }

    // Admin-only: { [companyId]: { total, active } } across all companies,
    // for the console's per-company seat-usage display.
    if (action === 'list_roster_counts') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { data, error } = await supabaseAdmin.from('roster').select('company_id, active');
      if (error) return res.status(500).json({ error: 'Could not load roster counts.' });
      const counts = {};
      (data || []).forEach(row => {
        if (!counts[row.company_id]) counts[row.company_id] = { total: 0, active: 0 };
        counts[row.company_id].total += 1;
        if (row.active) counts[row.company_id].active += 1;
      });
      return res.status(200).json({ counts });
    }

    if (action === 'add_roster_member') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const name = (req.body.name || '').trim();
      const role = req.body.role;
      if (!name) return res.status(400).json({ error: 'Enter a name.' });
      if (role !== 'worker' && role !== 'supervisor') return res.status(400).json({ error: 'Invalid role.' });

      const { data: coRows, error: coErr } = await supabaseAdmin.from('companies').select('plan_tier').eq('id', companyId).limit(1);
      if (coErr) return res.status(500).json({ error: 'Could not load plan tier.' });
      const tier = (coRows && coRows[0] && coRows[0].plan_tier) || 'basic';
      const cap = SEAT_CAP_BY_TIER[tier] || SEAT_CAP_BY_TIER.basic;

      const { data: activeRows, error: activeErr } = await supabaseAdmin.from('roster').select('id, name_normalized').eq('company_id', companyId).eq('active', true);
      if (activeErr) return res.status(500).json({ error: 'Could not check the roster.' });
      if ((activeRows || []).length >= cap) {
        return res.status(400).json({ error: `Seat limit reached for this plan (${cap} on ${tier === 'advanced' ? 'Advanced' : 'Basic'}). Upgrade the plan or deactivate someone first.` });
      }
      if ((activeRows || []).some(r => r.name_normalized === name.toLowerCase())) {
        return res.status(400).json({ error: `"${name}" is already active on this roster. Add a last initial to tell them apart.` });
      }

      const salt = genSalt();
      const pin = genPin();
      const { data, error } = await supabaseAdmin
        .from('roster')
        .insert({ company_id: companyId, name, role, pin_hash: hashPin(pin, salt), pin_salt: salt })
        .select('id, name, role, active, created_at')
        .single();
      if (error) return res.status(500).json({ error: "Couldn't add to the roster: " + error.message });
      return res.status(200).json({ ok: true, member: data, pin });
    }

    if (action === 'deactivate_roster_member' || action === 'reactivate_roster_member') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      const { data: rows, error: findErr } = await supabaseAdmin.from('roster').select('id, company_id, role').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      const member = rows[0];
      if (session.role === 'supervisor' && member.company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed.' });
      }

      const activating = action === 'reactivate_roster_member';
      if (activating) {
        const { data: coRows, error: coErr } = await supabaseAdmin.from('companies').select('plan_tier').eq('id', member.company_id).limit(1);
        if (coErr) return res.status(500).json({ error: 'Could not load plan tier.' });
        const tier = (coRows && coRows[0] && coRows[0].plan_tier) || 'basic';
        const cap = SEAT_CAP_BY_TIER[tier] || SEAT_CAP_BY_TIER.basic;
        const { data: activeRows, error: activeErr } = await supabaseAdmin.from('roster').select('id').eq('company_id', member.company_id).eq('active', true);
        if (activeErr) return res.status(500).json({ error: 'Could not check the roster.' });
        if ((activeRows || []).length >= cap) {
          return res.status(400).json({ error: `Seat limit reached for this plan (${cap} on ${tier === 'advanced' ? 'Advanced' : 'Basic'}). Upgrade the plan or deactivate someone first.` });
        }
      }

      const updates = activating
        ? { active: true, deactivated_at: null, failed_pin_attempts: 0, pin_locked_until: null }
        : { active: false, deactivated_at: new Date().toISOString() };
      const { error } = await supabaseAdmin.from('roster').update(updates).eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't update." });
      return res.status(200).json({ ok: true });
    }

    if (action === 'reset_roster_pin') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      const { data: rows, error: findErr } = await supabaseAdmin.from('roster').select('id, company_id').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      if (session.role === 'supervisor' && rows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed.' });
      }

      const salt = genSalt();
      const pin = genPin();
      const { error } = await supabaseAdmin
        .from('roster')
        .update({ pin_hash: hashPin(pin, salt), pin_salt: salt, failed_pin_attempts: 0, pin_locked_until: null })
        .eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't reset the PIN." });
      return res.status(200).json({ ok: true, pin });
    }

    // Flips a company between the legacy shared-code login and the roster/PIN
    // login. Turning it ON requires at least one active worker and one
    // active supervisor already set up, so no one can strand a company with
    // no way to log in. Turning it OFF is always allowed — an instant,
    // lossless rollback since the legacy codes are never touched.
    if (action === 'set_roster_cutover') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const enabled = !!req.body.enabled;

      if (enabled) {
        const { data: activeRows, error: activeErr } = await supabaseAdmin.from('roster').select('role').eq('company_id', companyId).eq('active', true);
        if (activeErr) return res.status(500).json({ error: 'Could not check the roster.' });
        const hasWorker = (activeRows || []).some(r => r.role === 'worker');
        const hasSupervisor = (activeRows || []).some(r => r.role === 'supervisor');
        if (!hasWorker || !hasSupervisor) {
          return res.status(400).json({ error: 'Add at least one active worker and one active supervisor before switching over.' });
        }
      }

      const { error } = await supabaseAdmin.from('companies').update({ roster_enabled: enabled }).eq('id', companyId);
      if (error) return res.status(500).json({ error: "Couldn't update." });
      return res.status(200).json({ ok: true });
    }

    // ══ SOPs ═════════════════════════════════════════════════════════

    if (action === 'list_sops') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin.from('sops').select('id, policy_text').eq('company_id', companyId).order('id');
      if (error) return res.status(500).json({ error: 'Could not load SOPs.' });
      return res.status(200).json({ sops: data || [] });
    }

    if (action === 'add_sops') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { companyId, policies } = req.body;
      if (!companyId || !Array.isArray(policies) || policies.length === 0) return res.status(400).json({ error: 'Missing details.' });
      const rows = policies.filter(p => (p || '').trim()).map(policy_text => ({ company_id: companyId, policy_text: policy_text.trim() }));
      if (rows.length === 0) return res.status(400).json({ error: 'No valid policies.' });
      const { error } = await supabaseAdmin.from('sops').insert(rows);
      if (error) return res.status(500).json({ error: "Couldn't add policies: " + error.message });
      return res.status(200).json({ ok: true, count: rows.length });
    }

    if (action === 'delete_sop') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });
      const { error } = await supabaseAdmin.from('sops').delete().eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't remove policy." });
      return res.status(200).json({ ok: true });
    }

    // Admin-only: returns { [companyId]: sopCount } across all companies,
    // for the console's completeness meter — avoids N calls to list_sops.
    if (action === 'list_sops_counts') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { data, error } = await supabaseAdmin.from('sops').select('company_id');
      if (error) return res.status(500).json({ error: 'Could not load SOP counts.' });
      const counts = {};
      (data || []).forEach(row => { counts[row.company_id] = (counts[row.company_id] || 0) + 1; });
      return res.status(200).json({ counts });
    }

    // ══ SITES ════════════════════════════════════════════════════════

    if (action === 'list_sites') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin.from('sites').select('id, name').eq('company_id', companyId).order('name');
      if (error) return res.status(500).json({ error: 'Could not load sites.' });
      return res.status(200).json({ sites: data || [] });
    }

    // Admins can add a site to any company. Workers/supervisors can add a
    // site to their OWN company only — this covers the "auto-save a newly
    // typed site" behavior in the worker-facing forms.
    if (action === 'add_site') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const name = (req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Enter a site name.' });

      const { data: existing } = await supabaseAdmin.from('sites').select('id, name').eq('company_id', companyId);
      if ((existing || []).some(s => (s.name || '').toLowerCase() === name.toLowerCase())) {
        return res.status(200).json({ ok: true, alreadyExists: true });
      }
      const { data, error } = await supabaseAdmin.from('sites').insert({ company_id: companyId, name }).select('id, name').single();
      if (error) return res.status(500).json({ error: "Couldn't add site: " + error.message });
      return res.status(200).json({ ok: true, site: data });
    }

    if (action === 'delete_site') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });
      const { error } = await supabaseAdmin.from('sites').delete().eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't remove site." });
      return res.status(200).json({ ok: true });
    }

    // ══ EQUIPMENT ════════════════════════════════════════════════════

    if (action === 'list_equipment') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin.from('equipment').select('id, year, make, model, type, unit_number, pm_interval').eq('company_id', companyId).order('id');
      if (error) return res.status(500).json({ error: 'Could not load equipment.' });
      return res.status(200).json({ equipment: data || [] });
    }

    // Admins can add equipment to any company. Workers/supervisors can add
    // equipment to their OWN company only — this covers the "auto-save a
    // rental machine" behavior in Inspection.jsx.
    if (action === 'add_equipment') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { year, make, model, type, unitNumber } = req.body;
      if (!(make || '').trim() && !(model || '').trim() && !(type || '').trim()) {
        return res.status(400).json({ error: 'Enter at least a make, model or type.' });
      }
      const { error } = await supabaseAdmin.from('equipment').insert({
        company_id: companyId,
        year: (year || '').trim(), make: (make || '').trim(), model: (model || '').trim(),
        type: (type || '').trim(), unit_number: (unitNumber || '').trim(),
      });
      if (error) return res.status(500).json({ error: "Couldn't add equipment: " + error.message });
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete_equipment') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });
      const { error } = await supabaseAdmin.from('equipment').delete().eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't remove equipment." });
      return res.status(200).json({ ok: true });
    }

    // Turns preventative-maintenance tracking on/off for a piece of
    // equipment. Supervisors run this from the Dashboard's Maintenance tab
    // (whether that tab is even offered to them is controlled separately,
    // company-wide, by the admin's "Preventative Maintenance" toggle in the
    // Forms list — see BUILTIN_DOC_KEYS in api/customforms.js). Turning
    // tracking on for the first time requires a starting reading, which
    // becomes that equipment's maintenance-log baseline — status math in
    // api/maintenance.js never has to guess one.
    if (action === 'set_equipment_pm_interval') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id, pmInterval, startingReading, readingUnit } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      const { data: eqRows, error: eqErr } = await supabaseAdmin.from('equipment').select('id, company_id').eq('id', id).limit(1);
      if (eqErr || !eqRows || eqRows.length === 0) return res.status(404).json({ error: 'Equipment not found.' });
      if (session.role === 'supervisor' && eqRows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed to change this equipment.' });
      }

      const interval = pmInterval != null && pmInterval !== '' ? parseFloat(pmInterval) : null;
      if (interval != null && (Number.isNaN(interval) || interval <= 0)) {
        return res.status(400).json({ error: 'Enter a valid maintenance interval.' });
      }

      if (interval != null) {
        const { data: existingLog } = await supabaseAdmin.from('equipment_maintenance_log').select('id').eq('equipment_id', id).limit(1);
        if (!existingLog || existingLog.length === 0) {
          const reading = startingReading != null && startingReading !== '' ? parseFloat(startingReading) : null;
          if (reading == null || Number.isNaN(reading) || !(readingUnit || '').trim()) {
            return res.status(400).json({ error: 'Enter a starting reading and unit to begin tracking.' });
          }
          const { error: logErr } = await supabaseAdmin.from('equipment_maintenance_log').insert({
            company_id: eqRows[0].company_id,
            equipment_id: id,
            service_reading: reading,
            reading_unit: readingUnit.trim(),
            performed_by: `Baseline (tracking enabled by ${session.role === 'admin' ? 'Admin' : 'Supervisor'})`,
          });
          if (logErr) return res.status(500).json({ error: "Couldn't set starting reading." });
        }
      }

      const { error } = await supabaseAdmin.from('equipment').update({ pm_interval: interval }).eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't update maintenance tracking." });
      return res.status(200).json({ ok: true });
    }

    // ══ CUSTOM FIELDS ════════════════════════════════════════════════

    // docType is optional — when provided, filters to that document type
    // (used by worker-facing forms that only need their own fields).
    if (action === 'list_custom_fields') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      let query = supabaseAdmin.from('custom_fields').select('id, doc_type, label, field_type, options, required').eq('company_id', companyId).order('id');
      if (req.body.docType) query = query.eq('doc_type', req.body.docType);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: 'Could not load custom fields.' });
      return res.status(200).json({ fields: data || [] });
    }

    if (action === 'add_custom_field') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { companyId, docType, label, fieldType, options, required } = req.body;
      if (!companyId || !docType || !(label || '').trim()) return res.status(400).json({ error: 'Missing details.' });
      if (fieldType === 'dropdown' && !(options || '').trim()) return res.status(400).json({ error: 'Add dropdown options.' });
      const { error } = await supabaseAdmin.from('custom_fields').insert({
        company_id: companyId,
        doc_type: docType,
        label: label.trim(),
        field_type: fieldType || 'text',
        options: fieldType === 'dropdown' ? (options || '').trim() : '',
        required: !!required,
      });
      if (error) return res.status(500).json({ error: "Couldn't add field: " + error.message });
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete_custom_field') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });
      const { error } = await supabaseAdmin.from('custom_fields').delete().eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't remove field." });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
