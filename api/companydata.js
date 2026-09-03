// api/companydata.js
// Protected access to company reference data: SOPs, Sites, Equipment, and
// Custom Fields. These were previously read/written directly from the
// browser with the anon key — this endpoint lets us lock down RLS on
// those tables without breaking the app, since everything now goes
// through session-verified server logic instead.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { renderTimeClockReportPdf, timeClockReportFilename } from '../server-lib/reportPdfs.js';
import { buildTimeClockReportForCompanyWeek } from './timeclockreports.js';

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

// For any read/write scoped to a company: admins may act on any company
// they specify; supervisors and workers are always locked to their own
// session.companyId, regardless of what companyId they send.
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
  return decodeURIComponent(url.slice(idx + marker.length));
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
async function ensureTimeClockReportPdf(report, companyName, companyLogo) {
  if (report.pdf_url) return report.pdf_url;
  try {
    const buffer = await renderTimeClockReportPdf({ report, companyName, companyLogo });
    const filename = timeClockReportFilename({ companyName, report });
    const { error } = await supabaseAdmin.storage.from('flha-reports').upload(filename, buffer, { contentType: 'application/pdf', upsert: true });
    if (error) return null;
    const { data: pub } = supabaseAdmin.storage.from('flha-reports').getPublicUrl(filename);
    const url = pub?.publicUrl || null;
    if (url) await supabaseAdmin.from('timeclock_reports').update({ pdf_url: url }).eq('id', report.id);
    return url;
  } catch (e) {
    return null;
  }
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

// ── Time Clock helpers ────────────────────────────────────────────────
// mondayOf/toISODate/isUniqueViolation stay here — the client-facing
// time-clock actions below (clock in/out, get_timeclock_report, etc.) use
// them directly. buildTimeClockReportForCompanyWeek moved to
// api/timeclockreports.js (imported above) since both this file's
// generate_time_report_now action and the weekly cron need it.

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

function isUniqueViolation(error) {
  return error && error.code === '23505';
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
      let query = supabaseAdmin.from('companies').select('id, name, logo_url, plan_tier, roster_enabled').order('id');
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

    // Admin-only: regenerate every active roster member's PIN in one shot
    // (e.g. after onboarding, or a security concern) — same one-time-reveal
    // rule as a single reset, just batched, with a plaintext PIN list handed
    // back exactly once and never persisted anywhere.
    if (action === 'regenerate_all_pins') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const { data: members, error: findErr } = await supabaseAdmin
        .from('roster')
        .select('id, name, role')
        .eq('company_id', companyId)
        .eq('active', true)
        .order('role', { ascending: true })
        .order('name', { ascending: true });
      if (findErr) return res.status(500).json({ error: 'Could not load roster.' });
      if (!members || members.length === 0) return res.status(400).json({ error: 'No active roster members to regenerate.' });

      const roster = [];
      for (const m of members) {
        const salt = genSalt();
        const pin = genPin();
        const { error } = await supabaseAdmin
          .from('roster')
          .update({ pin_hash: hashPin(pin, salt), pin_salt: salt, failed_pin_attempts: 0, pin_locked_until: null })
          .eq('id', m.id);
        if (error) return res.status(500).json({ error: `Couldn't regenerate the PIN for ${m.name}.` });
        roster.push({ id: m.id, name: m.name, role: m.role, pin });
      }
      return res.status(200).json({ ok: true, roster });
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

      // inspections.equipment_id is a real FK to this table (see the note
      // in api/maintenance.js). Deleting the equipment row out from under
      // it would either fail outright (FK violation, blocking the delete
      // entirely) or cascade-delete every inspection ever recorded against
      // this unit, depending on how the constraint is set up — neither is
      // acceptable, since a submitted inspection is a signed safety record
      // that must stay retrievable regardless of whether the equipment is
      // still in the fleet. Detach it explicitly first: each inspection
      // already carries its own equipment_label text snapshot (set at
      // submission time), so nulling the FK loses nothing the worker or
      // supervisor would see on that record, PDF, or in weekly reports.
      const { error: detachErr } = await supabaseAdmin.from('inspections').update({ equipment_id: null }).eq('equipment_id', id);
      if (detachErr) return res.status(500).json({ error: "Couldn't remove equipment." });

      // Maintenance log entries are meaningless without the equipment they
      // were serviced against and carry no equivalent label snapshot, so
      // remove them along with the unit rather than leave them stranded.
      await supabaseAdmin.from('equipment_maintenance_log').delete().eq('equipment_id', id);

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

    // ══ COMPANY PROFILE (docs/scope-company-brain.md, Phase 1) ═════════
    // company_profiles is written by two paths: the (not-yet-built) Phase 2
    // onboarding research pass, staged as status: 'draft'; and an admin's
    // own edit here, which is always authoritative and marks the row
    // 'confirmed'. Neither path may write hazard_emphasis directly to
    // anything that changes risk-rating logic — see the migration's column
    // comment and the Phase 4 note in the scope doc; this endpoint only
    // stores what it's given, the "never lowers the safety floor" rule is
    // enforced by how Phase 5's generation prompt consumes the field, not
    // here.

    if (action === 'get_company_profile') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin
        .from('company_profiles')
        .select('status, industry_inference, equipment_summary, terminology_notes, hazard_emphasis, last_summarized_at, updated_at')
        .eq('company_id', companyId)
        .limit(1);
      if (error) return res.status(500).json({ error: 'Could not load company profile.' });
      return res.status(200).json({ profile: (data && data[0]) || null });
    }

    if (action === 'update_company_profile') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      const { industryInference, equipmentSummary, terminologyNotes } = req.body;
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { error } = await supabaseAdmin
        .from('company_profiles')
        .upsert({
          company_id: companyId,
          status: 'confirmed',
          industry_inference: (industryInference || '').trim(),
          equipment_summary: (equipmentSummary || '').trim(),
          terminology_notes: (terminologyNotes || '').trim(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'company_id' });
      if (error) return res.status(500).json({ error: "Couldn't save company profile: " + error.message });
      return res.status(200).json({ ok: true });
    }

    // Phase 6 (docs/scope-company-brain.md) — a read-only aggregation of
    // company_signals for the Admin Panel's "Brain" tab: reuses the exact
    // same rows Phase 3 writes and Phase 4 reads, no separate pipeline.
    // Admin/supervisor only, like the other dashboard "list" actions in
    // this file — workers never see this (unlike get_company_profile
    // above, which worker-facing generation prompts also read).
    if (action === 'get_company_signal_trends') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const { data, error } = await supabaseAdmin
        .from('company_signals')
        .select('source_type, signal_json, created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) return res.status(500).json({ error: 'Could not load signal trends.' });

      const bySourceType = { flha_edit: 0, toolbox_talk: 0, incident: 0, near_miss: 0 };
      const tally = { addedHazards: {}, removedHazards: {}, toolboxTopics: {}, incidentCategories: {}, nearMissInvolved: {} };
      const bump = (map, key) => { if (key) map[key] = (map[key] || 0) + 1; };
      (data || []).forEach((row) => {
        const j = row.signal_json || {};
        if (bySourceType[row.source_type] !== undefined) bySourceType[row.source_type] += 1;
        if (row.source_type === 'flha_edit') {
          (j.added || []).forEach((h) => bump(tally.addedHazards, h));
          (j.removed || []).forEach((h) => bump(tally.removedHazards, h));
        } else if (row.source_type === 'toolbox_talk') {
          bump(tally.toolboxTopics, j.topic);
        } else if (row.source_type === 'incident') {
          bump(tally.incidentCategories, j.category);
        } else if (row.source_type === 'near_miss') {
          bump(tally.nearMissInvolved, j.involved);
        }
      });
      const topN = (map, n = 8) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

      return res.status(200).json({
        totalSignals: (data || []).length,
        bySourceType,
        topAddedHazards: topN(tally.addedHazards),
        topRemovedHazards: topN(tally.removedHazards),
        topToolboxTopics: topN(tally.toolboxTopics),
        topIncidentCategories: topN(tally.incidentCategories),
        topNearMissInvolved: topN(tally.nearMissInvolved),
      });
    }

    // ── Time Clock: self-service (any registered roster user) ───────────
    if (action === 'clock_in') {
      if (!session.userId) return res.status(403).json({ error: 'Not available for this login.' });
      const { error } = await supabaseAdmin.from('time_clock_entries').insert({
        company_id: session.companyId,
        roster_id: session.userId,
      });
      if (error) {
        if (isUniqueViolation(error)) return res.status(400).json({ error: "You're already clocked in." });
        return res.status(500).json({ error: "Couldn't clock in." });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'clock_out') {
      if (!session.userId) return res.status(403).json({ error: 'Not available for this login.' });
      const { data: openRows, error: openErr } = await supabaseAdmin
        .from('time_clock_entries')
        .select('id')
        .eq('roster_id', session.userId)
        .is('clock_out', null)
        .limit(1);
      if (openErr) return res.status(500).json({ error: "Couldn't clock out." });
      if (!openRows || openRows.length === 0) return res.status(404).json({ error: "You're not clocked in." });
      const { error } = await supabaseAdmin.from('time_clock_entries').update({ clock_out: new Date().toISOString() }).eq('id', openRows[0].id);
      if (error) return res.status(500).json({ error: "Couldn't clock out." });
      return res.status(200).json({ ok: true });
    }

    if (action === 'my_time_status') {
      if (!session.userId) return res.status(403).json({ error: 'Not available for this login.' });
      const { data: openRows } = await supabaseAdmin
        .from('time_clock_entries')
        .select('id, clock_in')
        .eq('roster_id', session.userId)
        .is('clock_out', null)
        .limit(1);
      const { data: recent, error: recentErr } = await supabaseAdmin
        .from('time_clock_entries')
        .select('id, clock_in, clock_out')
        .eq('roster_id', session.userId)
        .order('clock_in', { ascending: false })
        .limit(10);
      if (recentErr) return res.status(500).json({ error: "Couldn't load your time clock status." });
      return res.status(200).json({ open: (openRows && openRows[0]) || null, recent: recent || [] });
    }

    // ── Time Clock: supervisor / admin — view + edit everyone's entries ──
    if (action === 'list_time_entries') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const anchor = req.body.weekStart ? new Date(req.body.weekStart) : new Date();
      const monday = mondayOf(anchor);
      const nextMonday = new Date(monday); nextMonday.setDate(nextMonday.getDate() + 7);

      const { data: roster, error: rosterErr } = await supabaseAdmin
        .from('roster')
        .select('id, name, role, active')
        .eq('company_id', companyId)
        .order('name', { ascending: true });
      if (rosterErr) return res.status(500).json({ error: 'Could not load roster.' });

      const { data: entries, error: entriesErr } = await supabaseAdmin
        .from('time_clock_entries')
        .select('id, roster_id, clock_in, clock_out, edited_by_roster_id, edited_at')
        .eq('company_id', companyId)
        .gte('clock_in', monday.toISOString())
        .lt('clock_in', nextMonday.toISOString())
        .order('clock_in', { ascending: true });
      if (entriesErr) return res.status(500).json({ error: 'Could not load time clock entries.' });

      return res.status(200).json({
        weekStart: toISODate(monday),
        weekEnd: toISODate(new Date(nextMonday.getTime() - 86400000)),
        roster: roster || [],
        entries: entries || [],
      });
    }

    if (action === 'edit_time_entry') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { entryId, clockIn, clockOut } = req.body;
      if (!entryId || !clockIn) return res.status(400).json({ error: 'Missing entry details.' });
      const { data: rows, error: findErr } = await supabaseAdmin.from('time_clock_entries').select('id, company_id').eq('id', entryId).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Entry not found.' });
      if (session.role === 'supervisor' && rows[0].company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });

      const { error } = await supabaseAdmin.from('time_clock_entries').update({
        clock_in: clockIn,
        clock_out: clockOut || null,
        edited_by_roster_id: session.userId || null,
        edited_at: new Date().toISOString(),
      }).eq('id', entryId);
      if (error) {
        if (isUniqueViolation(error)) return res.status(400).json({ error: 'That person already has an open entry — close it first.' });
        return res.status(500).json({ error: "Couldn't save the change." });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'add_time_entry') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      const { rosterId, clockIn, clockOut } = req.body;
      if (!companyId || !rosterId || !clockIn) return res.status(400).json({ error: 'Missing entry details.' });

      const { data: memberRows, error: memberErr } = await supabaseAdmin.from('roster').select('id, company_id').eq('id', rosterId).limit(1);
      if (memberErr || !memberRows || memberRows.length === 0 || memberRows[0].company_id !== companyId) {
        return res.status(400).json({ error: 'That person is not on this company\'s roster.' });
      }

      const { error } = await supabaseAdmin.from('time_clock_entries').insert({
        company_id: companyId,
        roster_id: rosterId,
        clock_in: clockIn,
        clock_out: clockOut || null,
        edited_by_roster_id: session.userId || null,
        edited_at: new Date().toISOString(),
      });
      if (error) {
        if (isUniqueViolation(error)) return res.status(400).json({ error: 'That person already has an open entry.' });
        return res.status(500).json({ error: "Couldn't add the entry." });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete_time_entry') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { entryId } = req.body;
      if (!entryId) return res.status(400).json({ error: 'Missing entry id.' });
      const { data: rows, error: findErr } = await supabaseAdmin.from('time_clock_entries').select('id, company_id').eq('id', entryId).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Entry not found.' });
      if (session.role === 'supervisor' && rows[0].company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });
      const { error } = await supabaseAdmin.from('time_clock_entries').delete().eq('id', entryId);
      if (error) return res.status(500).json({ error: "Couldn't delete the entry." });
      return res.status(200).json({ ok: true });
    }

    // ── Time Clock: weekly PDF reports (same shape as equipment reports) ─
    if (action === 'list_time_reports') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin
        .from('timeclock_reports')
        .select('id, week_start, week_end, pdf_url, generated_by, created_at')
        .eq('company_id', companyId)
        .order('week_start', { ascending: false });
      if (error) return res.status(500).json({ error: 'Could not load reports.' });
      const reports = await Promise.all((data || []).map(async r => ({ ...r, pdf_url: await signStoredUrl(r.pdf_url, 'flha-reports') })));
      return res.status(200).json({ reports });
    }

    if (action === 'get_time_report') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { reportId } = req.body;
      if (!reportId) return res.status(400).json({ error: 'Missing report id.' });
      const { data, error } = await supabaseAdmin.from('timeclock_reports').select('*').eq('id', reportId).limit(1);
      if (error || !data || data.length === 0) return res.status(404).json({ error: 'Report not found.' });
      const report = data[0];
      if (session.role === 'supervisor' && report.company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });
      const { data: coRows } = await supabaseAdmin.from('companies').select('id, name, logo_url').eq('id', report.company_id).limit(1);
      const company = coRows && coRows[0];
      const storedUrl = await ensureTimeClockReportPdf(report, company?.name || '', company?.logo_url || '');
      report.pdf_url = await signStoredUrl(storedUrl, 'flha-reports');
      return res.status(200).json({ report, company });
    }

    // Optional `pullUntil`: a "request a manual pull" cutoff — see the
    // matching comment on equipmentreports.js's generate_now. Same rules:
    // must fall inside the resolved week, and the standard automated
    // Sunday-11:59pm pull (cron-equipment-reports.js) still overwrites this
    // once the week actually closes (same company_id+week_start upsert key).
    if (action === 'generate_time_report_now') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { weekStart, pullUntil } = req.body;

      const anchor = weekStart ? new Date(weekStart) : new Date();
      const monday = weekStart ? mondayOf(anchor) : mondayOf(new Date(anchor.getTime() - 7 * 86400000));
      const nextMonday = new Date(monday); nextMonday.setDate(nextMonday.getDate() + 7);

      let weekEndExclusiveISO = nextMonday.toISOString();
      if (pullUntil) {
        const until = new Date(pullUntil);
        if (isNaN(until.getTime())) return res.status(400).json({ error: 'Invalid pull-until time.' });
        if (until < monday || until > nextMonday) return res.status(400).json({ error: "Requested time must fall within that report's week." });
        weekEndExclusiveISO = until.toISOString();
      }

      const reportJson = await buildTimeClockReportForCompanyWeek(companyId, monday.toISOString(), weekEndExclusiveISO);
      reportJson.pulledUntil = pullUntil ? weekEndExclusiveISO : null;

      const { data, error } = await supabaseAdmin
        .from('timeclock_reports')
        .upsert(
          { company_id: companyId, week_start: reportJson.weekStart, week_end: reportJson.weekEnd, report_json: reportJson, pdf_url: null, generated_by: 'manual' },
          { onConflict: 'company_id,week_start' }
        )
        .select()
        .single();
      if (error) return res.status(500).json({ error: "Couldn't generate report: " + error.message });

      const { data: coRows } = await supabaseAdmin.from('companies').select('name, logo_url').eq('id', companyId).limit(1);
      const company = coRows && coRows[0];
      const storedUrl = await ensureTimeClockReportPdf(data, company?.name || '', company?.logo_url || '');
      data.pdf_url = await signStoredUrl(storedUrl, 'flha-reports');
      return res.status(200).json({ ok: true, report: data });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
