// api/admin.js
// Handles company management for the Admin Console — listing, creating,
// editing, suspending, and deleting companies. Admin-only, same session
// check pattern as the other protected endpoints.

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

function genAccountNumber() {
  return Math.floor(100000 + Math.random() * 900000);
}

function genSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = await verifySession(token);
  if (!session || session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });

  try {
    // ── List all companies (includes codes + contact info) ─────────────
    if (action === 'list_companies') {
      const { data, error } = await supabaseAdmin
        .from('companies')
        .select('id, name, worker_code, supervisor_code, company_code, roster_enabled, contact_name, contact_email, contact_phone, address, logo_url, suspended, account_number, plan_tier')
        .order('id');
      if (error) return res.status(500).json({ error: 'Could not load companies.' });
      return res.status(200).json({ companies: data || [] });
    }

    // ── Set a company's plan tier (basic/advanced) — drives both the
    // Analytics dashboard's depth and the roster's seat cap ──────────
    if (action === 'set_plan_tier') {
      const { companyId, tier } = req.body;
      if (!companyId || !['basic', 'advanced'].includes(tier)) {
        return res.status(400).json({ error: 'Missing or invalid tier.' });
      }
      const { error } = await supabaseAdmin.from('companies').update({ plan_tier: tier }).eq('id', companyId);
      if (error) return res.status(500).json({ error: "Couldn't update plan tier." });
      return res.status(200).json({ ok: true });
    }

    // ── Set the master login code — logs into any company, either role,
    // straight from the public worker/supervisor login screen. No "confirm
    // old code" step needed: only an authenticated admin session can even
    // reach this action. ────────────────────────────────────────────────
    if (action === 'set_master_code') {
      const { newCode } = req.body;
      if (!newCode || !String(newCode).trim()) return res.status(400).json({ error: 'Enter a code.' });
      const salt = genSalt();
      const hash = hashPin(String(newCode).trim(), salt);
      const { error } = await supabaseAdmin
        .from('app_settings')
        .upsert({ id: 1, master_code_hash: hash, master_code_salt: salt, updated_at: new Date().toISOString() });
      if (error) return res.status(500).json({ error: "Couldn't update the master code." });
      return res.status(200).json({ ok: true });
    }

    // ── Recent master-code logins, newest first — the visibility backstop
    // in place of rate-limiting the master code itself (see api/login.js).
    if (action === 'list_master_login_log') {
      const { data: logs, error: logErr } = await supabaseAdmin
        .from('master_login_log')
        .select('id, company_id, role, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (logErr) return res.status(500).json({ error: 'Could not load the login log.' });

      const companyIds = [...new Set((logs || []).map(l => l.company_id))];
      const { data: companies } = await supabaseAdmin.from('companies').select('id, name').in('id', companyIds.length ? companyIds : [0]);
      const nameById = {}; (companies || []).forEach(c => { nameById[c.id] = c.name; });

      const enriched = (logs || []).map(l => ({ ...l, company_name: nameById[l.company_id] || 'Unknown company' }));
      return res.status(200).json({ logs: enriched });
    }

    // ── Onboarding intake — submissions from the public /onboarding form,
    // newest first, with short-lived signed links for any uploaded SOP
    // files (the storage bucket is private, so a plain public URL won't
    // work) ──────────────────────────────────────────────────────────
    if (action === 'list_onboarding_requests') {
      const { data: requests, error: reqErr } = await supabaseAdmin
        .from('onboarding_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (reqErr) return res.status(500).json({ error: 'Could not load onboarding requests.' });

      const enriched = await Promise.all((requests || []).map(async (r) => {
        if (!r.sop_file_paths || r.sop_file_paths.length === 0) return { ...r, sop_file_urls: [] };
        const { data: signed } = await supabaseAdmin.storage
          .from('onboarding-uploads')
          .createSignedUrls(r.sop_file_paths, 60 * 60); // 1 hour
        return { ...r, sop_file_urls: (signed || []).map(s => s.signedUrl).filter(Boolean) };
      }));

      return res.status(200).json({ requests: enriched });
    }

    // ── Onboarding intake — mark a submission new / in progress / done ──
    if (action === 'update_onboarding_status') {
      const { id, status } = req.body;
      if (!id || !['new', 'in_progress', 'done'].includes(status)) {
        return res.status(400).json({ error: 'Missing or invalid status.' });
      }
      const { error } = await supabaseAdmin.from('onboarding_requests').update({ status }).eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't update status." });
      return res.status(200).json({ ok: true });
    }

    // ── Onboard a new company ───────────────────────────────────────────
    // New companies get only the unified company_code — no legacy
    // worker_code/supervisor_code, since roster login is how they'll work
    // from day one. roster_enabled defaults false until the admin (the
    // only one with a session for a company with no roster yet) has added
    // at least one active worker and supervisor and flips the cutover.
    if (action === 'create_company') {
      const { name, companyCode } = req.body;
      if (!name?.trim() || !companyCode?.trim()) {
        return res.status(400).json({ error: 'Missing company details.' });
      }
      const { data: existing } = await supabaseAdmin
        .from('companies')
        .select('id')
        .eq('company_code', companyCode.trim());
      if (existing && existing.length > 0) {
        return res.status(400).json({ error: 'That code is already in use. Edit and try again.' });
      }

      let acct = genAccountNumber();
      for (let tries = 0; tries < 5; tries++) {
        const { data: clash } = await supabaseAdmin.from('companies').select('id').eq('account_number', acct).limit(1);
        if (!clash || clash.length === 0) break;
        acct = genAccountNumber();
      }

      const { error } = await supabaseAdmin.from('companies').insert({
        name: name.trim(),
        company_code: companyCode.trim(),
        account_number: acct,
      });
      if (error) return res.status(500).json({ error: "Couldn't add company: " + error.message });
      return res.status(200).json({ ok: true });
    }

    // ── Edit a company's login code(s) ──────────────────────────────────
    // company_code is always required. worker_code/supervisor_code are only
    // validated/updated when actually sent with a non-empty value — this is
    // a pure edit of an existing legacy code, never a way to clear one to
    // null and strand that company's logins.
    if (action === 'update_company_codes') {
      const { companyId, companyCode, workerCode, supervisorCode } = req.body;
      if (!companyId || !companyCode?.trim()) {
        return res.status(400).json({ error: 'Missing company code.' });
      }

      const { data: codeClash } = await supabaseAdmin
        .from('companies')
        .select('id')
        .eq('company_code', companyCode.trim())
        .neq('id', companyId);
      if (codeClash && codeClash.length > 0) {
        return res.status(400).json({ error: 'That company code is already in use.' });
      }

      const updates = { company_code: companyCode.trim() };

      if (workerCode?.trim() || supervisorCode?.trim()) {
        const orParts = [];
        if (workerCode?.trim()) orParts.push(`worker_code.eq.${workerCode.trim()}`, `supervisor_code.eq.${workerCode.trim()}`);
        if (supervisorCode?.trim()) orParts.push(`worker_code.eq.${supervisorCode.trim()}`, `supervisor_code.eq.${supervisorCode.trim()}`);
        const { data: legacyClash } = await supabaseAdmin
          .from('companies')
          .select('id')
          .or(orParts.join(','))
          .neq('id', companyId);
        if (legacyClash && legacyClash.length > 0) {
          return res.status(400).json({ error: 'One of those codes is already in use.' });
        }
        if (workerCode?.trim()) updates.worker_code = workerCode.trim();
        if (supervisorCode?.trim()) updates.supervisor_code = supervisorCode.trim();
      }

      const { error } = await supabaseAdmin.from('companies').update(updates).eq('id', companyId);
      if (error) return res.status(500).json({ error: "Couldn't update codes: " + error.message });
      return res.status(200).json({ ok: true });
    }

    // ── Edit a company's profile ────────────────────────────────────────
    if (action === 'update_profile') {
      const { companyId, profile } = req.body;
      if (!companyId || !profile?.name?.trim()) return res.status(400).json({ error: 'Missing details.' });
      const { error } = await supabaseAdmin.from('companies').update({
        name: profile.name.trim(),
        contact_name: (profile.contact_name || '').trim(),
        contact_email: (profile.contact_email || '').trim(),
        contact_phone: (profile.contact_phone || '').trim(),
        address: (profile.address || '').trim(),
        logo_url: profile.logo_url || null,
      }).eq('id', companyId);
      if (error) return res.status(500).json({ error: "Couldn't save: " + error.message });
      return res.status(200).json({ ok: true });
    }

    // ── Suspend / reactivate a company ──────────────────────────────────
    if (action === 'toggle_suspend') {
      const { companyId, suspended } = req.body;
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { error } = await supabaseAdmin.from('companies').update({ suspended: !!suspended }).eq('id', companyId);
      if (error) return res.status(500).json({ error: "Couldn't update: " + error.message });
      return res.status(200).json({ ok: true });
    }

    // ── Delete a company ─────────────────────────────────────────────────
    // Fixed to check EVERY record type, not just FLHAs, so a company with
    // only inspections/toolbox talks/near misses/incidents/daily reports
    // can no longer be deleted and orphan those records.
    if (action === 'delete_company') {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const tables = ['flhas', 'incidents', 'near_misses', 'inspections', 'toolbox_talks', 'daily_reports'];
      const counts = {};
      for (const t of tables) {
        const { data, error } = await supabaseAdmin.from(t).select('id').eq('company_id', companyId);
        if (error) return res.status(500).json({ error: `Could not check ${t.replace('_', ' ')} records.` });
        counts[t] = (data || []).length;
      }

      // Monthly inspection and custom document submissions are reached
      // through their form definitions, not a direct company_id column —
      // same two-hop check delete_form (api/customforms.js) uses for one form.
      const { data: inspForms, error: inspFormsErr } = await supabaseAdmin.from('inspection_forms').select('id').eq('company_id', companyId);
      if (inspFormsErr) return res.status(500).json({ error: 'Could not check monthly inspection forms.' });
      const inspFormIds = (inspForms || []).map(f => f.id);
      let inspectionRecordsCount = 0;
      if (inspFormIds.length > 0) {
        const { data: records, error: recErr } = await supabaseAdmin.from('inspection_records').select('id').in('form_id', inspFormIds);
        if (recErr) return res.status(500).json({ error: 'Could not check monthly inspection submissions.' });
        inspectionRecordsCount = (records || []).length;
      }
      counts['monthly inspection submissions'] = inspectionRecordsCount;

      const { data: custForms, error: custFormsErr } = await supabaseAdmin.from('custom_forms').select('id').eq('company_id', companyId);
      if (custFormsErr) return res.status(500).json({ error: 'Could not check custom document forms.' });
      const custFormIds = (custForms || []).map(f => f.id);
      let customRecordsCount = 0;
      if (custFormIds.length > 0) {
        const { data: records, error: recErr } = await supabaseAdmin.from('custom_form_records').select('id').in('form_id', custFormIds);
        if (recErr) return res.status(500).json({ error: 'Could not check custom document submissions.' });
        customRecordsCount = (records || []).length;
      }
      counts['custom document submissions'] = customRecordsCount;

      const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
      if (totalRecords > 0) {
        const parts = Object.entries(counts)
          .filter(([, n]) => n > 0)
          .map(([t, n]) => `${n} ${t.replace(/_/g, ' ')}`);
        return res.status(400).json({
          error: `Couldn't delete: this company has ${parts.join(', ')}. Companies with submitted records can't be deleted.`,
        });
      }

      // No submitted records remain — safe to clean up company-scoped
      // config/settings. Children before parents where FK-constrained.
      if (inspFormIds.length > 0) {
        await supabaseAdmin.from('inspection_form_questions').delete().in('form_id', inspFormIds);
        await supabaseAdmin.from('inspection_forms').delete().eq('company_id', companyId);
      }
      if (custFormIds.length > 0) {
        await supabaseAdmin.from('custom_form_questions').delete().in('form_id', custFormIds);
        await supabaseAdmin.from('custom_forms').delete().eq('company_id', companyId);
      }
      await supabaseAdmin.from('company_document_settings').delete().eq('company_id', companyId);
      await supabaseAdmin.from('equipment_reports').delete().eq('company_id', companyId);
      await supabaseAdmin.from('roster').delete().eq('company_id', companyId);
      await supabaseAdmin.from('sops').delete().eq('company_id', companyId);
      await supabaseAdmin.from('sites').delete().eq('company_id', companyId);
      await supabaseAdmin.from('equipment').delete().eq('company_id', companyId);
      await supabaseAdmin.from('custom_fields').delete().eq('company_id', companyId);
      const { error } = await supabaseAdmin.from('companies').delete().eq('id', companyId);
      if (error) return res.status(500).json({ error: "Couldn't delete: " + error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
