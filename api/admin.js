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

function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.issuedAt || Date.now() - payload.issuedAt > SESSION_TTL_MS) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function genAccountNumber() {
  return Math.floor(100000 + Math.random() * 900000);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = verifySession(token);
  if (!session || session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });

  try {
    // ── List all companies (includes codes + contact info) ─────────────
    if (action === 'list_companies') {
      const { data, error } = await supabaseAdmin
        .from('companies')
        .select('id, name, worker_code, supervisor_code, contact_name, contact_email, contact_phone, address, logo_url, suspended, account_number, analytics_tier')
        .order('id');
      if (error) return res.status(500).json({ error: 'Could not load companies.' });
      return res.status(200).json({ companies: data || [] });
    }

    // ── Set a company's analytics dashboard tier (basic/advanced) ──────
    if (action === 'set_analytics_tier') {
      const { companyId, tier } = req.body;
      if (!companyId || !['basic', 'advanced'].includes(tier)) {
        return res.status(400).json({ error: 'Missing or invalid tier.' });
      }
      const { error } = await supabaseAdmin.from('companies').update({ analytics_tier: tier }).eq('id', companyId);
      if (error) return res.status(500).json({ error: "Couldn't update analytics tier." });
      return res.status(200).json({ ok: true });
    }

    // ── Onboard a new company ───────────────────────────────────────────
    if (action === 'create_company') {
      const { name, workerCode, supervisorCode } = req.body;
      if (!name?.trim() || !workerCode?.trim() || !supervisorCode?.trim()) {
        return res.status(400).json({ error: 'Missing company details.' });
      }
      const { data: existing } = await supabaseAdmin
        .from('companies')
        .select('id')
        .or(`worker_code.eq.${workerCode.trim()},supervisor_code.eq.${supervisorCode.trim()}`);
      if (existing && existing.length > 0) {
        return res.status(400).json({ error: 'One of those codes is already in use. Edit and try again.' });
      }

      let acct = genAccountNumber();
      for (let tries = 0; tries < 5; tries++) {
        const { data: clash } = await supabaseAdmin.from('companies').select('id').eq('account_number', acct).limit(1);
        if (!clash || clash.length === 0) break;
        acct = genAccountNumber();
      }

      const { error } = await supabaseAdmin.from('companies').insert({
        name: name.trim(),
        worker_code: workerCode.trim(),
        supervisor_code: supervisorCode.trim(),
        account_number: acct,
      });
      if (error) return res.status(500).json({ error: "Couldn't add company: " + error.message });
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
