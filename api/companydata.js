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

function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString());
  } catch (e) {
    return null;
  }
}

// For any read/write scoped to a company: admins may act on any company
// they specify; supervisors and workers are always locked to their own
// session.companyId, regardless of what companyId they send.
function resolveCompanyId(session, requestedCompanyId) {
  if (session.role === 'admin') return requestedCompanyId || null;
  return session.companyId;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
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
      const { data, error } = await supabaseAdmin.from('equipment').select('id, year, make, model, type, unit_number').eq('company_id', companyId).order('id');
      if (error) return res.status(500).json({ error: 'Could not load equipment.' });
      return res.status(200).json({ equipment: data || [] });
    }

    if (action === 'add_equipment') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { companyId, year, make, model, type, unitNumber } = req.body;
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
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
