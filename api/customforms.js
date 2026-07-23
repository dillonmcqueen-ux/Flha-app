// api/customforms.js
// Handles fully custom document types — admin builder (forms/questions),
// worker submission, supervisor/admin viewing, and the per-company
// document active/deactivated toggle settings.

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

// Admins may act on any company they specify; supervisors are always
// locked to their own session.companyId, regardless of what they send.
function resolveCompanyId(session, requestedCompanyId) {
  if (session.role === 'admin') return requestedCompanyId || null;
  return session.companyId;
}

// Built-in document keys — used so the toggle system has a fixed list
// of the non-custom types to show alongside custom ones.
const BUILTIN_DOC_KEYS = ['flha', 'inspection', 'toolbox', 'nearmiss', 'incident', 'daily', 'monthly', 'equipment_reports'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ══ ADMIN: custom form builder ═══════════════════════════════════

    if (action === 'list_forms') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin
        .from('custom_forms')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: 'Could not load forms.' });
      return res.status(200).json({ forms: data || [] });
    }

    if (action === 'create_form') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { companyId, title, icon, accentColor } = req.body;
      if (!companyId || !title?.trim()) return res.status(400).json({ error: 'Missing details.' });
      const { data, error } = await supabaseAdmin
        .from('custom_forms')
        .insert({
          company_id: companyId,
          title: title.trim(),
          icon: icon || '📄',
          accent_color: accentColor || '#4338CA',
          is_active: true,
        })
        .select()
        .single();
      if (error) return res.status(500).json({ error: "Couldn't create form." });

      // Default the new form's toggle to active so it shows up immediately.
      await supabaseAdmin.from('company_document_settings').upsert(
        { company_id: companyId, document_key: `custom_${data.id}`, is_active: true },
        { onConflict: 'company_id,document_key' }
      );

      return res.status(200).json({ form: data });
    }

    if (action === 'update_form') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { formId, title, icon, accentColor } = req.body;
      if (!formId) return res.status(400).json({ error: 'Missing form id.' });
      const updates = {};
      if (title !== undefined) updates.title = title.trim();
      if (icon !== undefined) updates.icon = icon;
      if (accentColor !== undefined) updates.accent_color = accentColor;
      const { error } = await supabaseAdmin.from('custom_forms').update(updates).eq('id', formId);
      if (error) return res.status(500).json({ error: "Couldn't update form." });
      return res.status(200).json({ ok: true });
    }

    if (action === 'toggle_form') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { formId, isActive } = req.body;
      if (!formId) return res.status(400).json({ error: 'Missing form id.' });
      const { error } = await supabaseAdmin.from('custom_forms').update({ is_active: !!isActive }).eq('id', formId);
      if (error) return res.status(500).json({ error: "Couldn't update form." });
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete_form') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { formId } = req.body;
      if (!formId) return res.status(400).json({ error: 'Missing form id.' });
      const { data: records, error: recErr } = await supabaseAdmin.from('custom_form_records').select('id').eq('form_id', formId);
      if (recErr) return res.status(500).json({ error: 'Could not check submissions.' });
      if (records && records.length > 0) {
        return res.status(400).json({ error: "Couldn't delete: this document already has submitted records." });
      }
      await supabaseAdmin.from('custom_form_questions').delete().eq('form_id', formId);
      await supabaseAdmin.from('company_document_settings').delete().eq('document_key', `custom_${formId}`);
      const { error } = await supabaseAdmin.from('custom_forms').delete().eq('id', formId);
      if (error) return res.status(500).json({ error: "Couldn't delete form." });
      return res.status(200).json({ ok: true });
    }

    if (action === 'list_questions') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { formId } = req.body;
      if (!formId) return res.status(400).json({ error: 'Missing form id.' });
      const { data, error } = await supabaseAdmin
        .from('custom_form_questions')
        .select('*')
        .eq('form_id', formId)
        .order('sort_order', { ascending: true });
      if (error) return res.status(500).json({ error: 'Could not load questions.' });
      return res.status(200).json({ questions: data || [] });
    }

    if (action === 'add_question') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { formId, questionText } = req.body;
      if (!formId || !questionText?.trim()) return res.status(400).json({ error: 'Missing details.' });
      const { data: existing, error: exErr } = await supabaseAdmin
        .from('custom_form_questions')
        .select('sort_order')
        .eq('form_id', formId)
        .order('sort_order', { ascending: false })
        .limit(1);
      if (exErr) return res.status(500).json({ error: 'Could not add question.' });
      const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;
      const { data, error } = await supabaseAdmin
        .from('custom_form_questions')
        .insert({ form_id: formId, question_text: questionText.trim(), sort_order: nextOrder })
        .select()
        .single();
      if (error) return res.status(500).json({ error: "Couldn't add question." });
      return res.status(200).json({ question: data });
    }

    if (action === 'delete_question') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { questionId } = req.body;
      if (!questionId) return res.status(400).json({ error: 'Missing question id.' });
      const { error } = await supabaseAdmin.from('custom_form_questions').delete().eq('id', questionId);
      if (error) return res.status(500).json({ error: "Couldn't remove question." });
      return res.status(200).json({ ok: true });
    }

    if (action === 'reorder_questions') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { updates } = req.body; // [{ id, sort_order }]
      if (!Array.isArray(updates)) return res.status(400).json({ error: 'Missing updates.' });
      for (const u of updates) {
        await supabaseAdmin.from('custom_form_questions').update({ sort_order: u.sort_order }).eq('id', u.id);
      }
      return res.status(200).json({ ok: true });
    }

    // ══ ADMIN + SUPERVISOR: document active/deactivated toggles ════════
    // Admins can view/edit any company's toggles. Supervisors can only
    // VIEW their own company's toggles (used by Dashboard.jsx to decide
    // whether to show the Equipment tab) — they cannot change them.

    if (action === 'get_document_settings') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const { data: settingsRows, error: setErr } = await supabaseAdmin
        .from('company_document_settings')
        .select('document_key, is_active')
        .eq('company_id', companyId);
      if (setErr) return res.status(500).json({ error: 'Could not load settings.' });
      const settingsMap = {}; (settingsRows || []).forEach(s => { settingsMap[s.document_key] = s.is_active; });

      const { data: customForms, error: cfErr } = await supabaseAdmin
        .from('custom_forms')
        .select('id, title, icon, accent_color')
        .eq('company_id', companyId)
        .order('created_at', { ascending: true });
      if (cfErr) return res.status(500).json({ error: 'Could not load custom forms.' });

      const builtins = BUILTIN_DOC_KEYS.map(key => ({
        key,
        label: BUILTIN_LABELS[key] || key,
        isCustom: false,
        isActive: settingsMap[key] !== undefined ? settingsMap[key] : true,
      }));

      const customs = (customForms || []).map(f => ({
        key: `custom_${f.id}`,
        label: f.title,
        icon: f.icon,
        isCustom: true,
        formId: f.id,
        isActive: settingsMap[`custom_${f.id}`] !== undefined ? settingsMap[`custom_${f.id}`] : true,
      }));

      return res.status(200).json({ documents: [...builtins, ...customs] });
    }

    if (action === 'set_document_setting') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { companyId, documentKey, isActive } = req.body;
      if (!companyId || !documentKey) return res.status(400).json({ error: 'Missing details.' });
      const { error } = await supabaseAdmin.from('company_document_settings').upsert(
        { company_id: companyId, document_key: documentKey, is_active: !!isActive },
        { onConflict: 'company_id,document_key' }
      );
      if (error) return res.status(500).json({ error: "Couldn't update setting." });
      return res.status(200).json({ ok: true });
    }

    // ══ WORKER: which documents can this worker see + submission ═══════

    // Called by WorkerMenu to build the dynamic list of doc types.
    if (action === 'get_worker_documents') {
      if (session.role !== 'worker') return res.status(403).json({ error: 'Not allowed.' });

      const { data: settingsRows } = await supabaseAdmin
        .from('company_document_settings')
        .select('document_key, is_active')
        .eq('company_id', session.companyId);
      const settingsMap = {}; (settingsRows || []).forEach(s => { settingsMap[s.document_key] = s.is_active; });

      const { data: customForms } = await supabaseAdmin
        .from('custom_forms')
        .select('id, title, icon, accent_color')
        .eq('company_id', session.companyId)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      const builtinActive = {};
      BUILTIN_DOC_KEYS.forEach(key => {
        builtinActive[key] = settingsMap[key] !== undefined ? settingsMap[key] : true;
      });

      const activeCustoms = (customForms || []).filter(f => {
        const key = `custom_${f.id}`;
        return settingsMap[key] !== undefined ? settingsMap[key] : true;
      });

      return res.status(200).json({ builtinActive, customForms: activeCustoms });
    }

    if (action === 'get_active_form') {
      if (session.role !== 'worker') return res.status(403).json({ error: 'Not allowed.' });
      const { siteId, formId } = req.body;
      if (!siteId || !formId) return res.status(400).json({ error: 'Missing details.' });

      const { data: siteRows } = await supabaseAdmin.from('sites').select('id, company_id').eq('id', siteId).limit(1);
      if (!siteRows || siteRows.length === 0 || siteRows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed for this site.' });
      }

      const { data: formRows } = await supabaseAdmin.from('custom_forms').select('*').eq('id', formId).limit(1);
      const form = formRows && formRows[0];
      if (!form || form.company_id !== session.companyId || !form.is_active) {
        return res.status(404).json({ error: 'This document is not available.' });
      }

      const { data: questions, error: qErr } = await supabaseAdmin
        .from('custom_form_questions')
        .select('*')
        .eq('form_id', formId)
        .order('sort_order', { ascending: true });
      if (qErr) return res.status(500).json({ error: 'Could not load questions.' });

      return res.status(200).json({ form, questions: questions || [] });
    }

    if (action === 'submit_custom') {
      if (session.role !== 'worker') return res.status(403).json({ error: 'Not allowed.' });
      const { siteId, formId, answers, submittedBy, aiSummary, pdfUrl } = req.body;
      if (!siteId || !formId || !Array.isArray(answers) || !submittedBy) {
        return res.status(400).json({ error: 'Missing details.' });
      }

      const { data: siteRows } = await supabaseAdmin.from('sites').select('id, company_id').eq('id', siteId).limit(1);
      if (!siteRows || siteRows.length === 0 || siteRows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed for this site.' });
      }
      const { data: formRows } = await supabaseAdmin.from('custom_forms').select('id, company_id').eq('id', formId).limit(1);
      if (!formRows || formRows.length === 0 || formRows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed for this form.' });
      }

      const { data: record, error: recErr } = await supabaseAdmin
        .from('custom_form_records')
        .insert({
          form_id: formId, site_id: siteId, submitted_by: submittedBy,
          ai_summary: aiSummary || null, pdf_url: pdfUrl || null, status: 'complete',
        })
        .select()
        .single();
      if (recErr) return res.status(500).json({ error: 'Save failed. Try again.' });

      for (const a of answers) {
        await supabaseAdmin.from('custom_form_answers').insert({
          record_id: record.id, question_id: a.questionId, answer: !!a.answer, notes: a.note || null,
        });
      }

      return res.status(200).json({ id: record.id });
    }

    // ══ SUPERVISOR / ADMIN: viewing submissions ═════════════════════════

    if (action === 'list_records') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });

      let formsQuery = supabaseAdmin.from('custom_forms').select('id, company_id, title, icon, accent_color');
      if (session.role === 'supervisor') formsQuery = formsQuery.eq('company_id', session.companyId);
      const { data: forms, error: formsErr } = await formsQuery;
      if (formsErr) return res.status(500).json({ error: 'Could not load forms.' });
      const formIds = (forms || []).map(f => f.id);
      if (formIds.length === 0) return res.status(200).json({ records: [] });

      const { data: records, error: recErr } = await supabaseAdmin
        .from('custom_form_records')
        .select('*')
        .in('form_id', formIds)
        .order('created_at', { ascending: false });
      if (recErr) return res.status(500).json({ error: 'Could not load records.' });

      const siteIds = [...new Set((records || []).map(r => r.site_id))];
      const { data: sites } = await supabaseAdmin.from('sites').select('id, name').in('id', siteIds.length ? siteIds : [0]);
      const siteMap = {}; (sites || []).forEach(s => { siteMap[s.id] = s.name; });
      const formMap = {}; (forms || []).forEach(f => { formMap[f.id] = f; });

      const enriched = (records || []).map(r => ({
        ...r,
        site_name: siteMap[r.site_id] || 'Unknown site',
        form_title: formMap[r.form_id]?.title || 'Unknown document',
        form_icon: formMap[r.form_id]?.icon || '📄',
        company_id: formMap[r.form_id]?.company_id,
      }));

      return res.status(200).json({ records: enriched });
    }

    if (action === 'get_record_detail') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { recordId } = req.body;
      if (!recordId) return res.status(400).json({ error: 'Missing record id.' });

      const { data: recordRows, error: recErr } = await supabaseAdmin.from('custom_form_records').select('*').eq('id', recordId).limit(1);
      if (recErr || !recordRows || recordRows.length === 0) return res.status(404).json({ error: 'Record not found.' });
      const record = recordRows[0];

      const { data: formRows } = await supabaseAdmin.from('custom_forms').select('id, company_id, title, icon, accent_color').eq('id', record.form_id).limit(1);
      const form = formRows && formRows[0];
      if (!form) return res.status(404).json({ error: 'Form not found.' });
      if (session.role === 'supervisor' && form.company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });

      const { data: siteRows } = await supabaseAdmin.from('sites').select('id, name').eq('id', record.site_id).limit(1);

      const { data: answers, error: ansErr } = await supabaseAdmin.from('custom_form_answers').select('*').eq('record_id', recordId);
      if (ansErr) return res.status(500).json({ error: 'Could not load answers.' });

      const { data: questions } = await supabaseAdmin.from('custom_form_questions').select('id, question_text, sort_order').eq('form_id', record.form_id).order('sort_order', { ascending: true });
      const questionMap = {}; (questions || []).forEach(q => { questionMap[q.id] = q; });

      const items = (answers || [])
        .map(a => ({
          ...a,
          question_text: questionMap[a.question_id]?.question_text || 'Unknown question',
          sort_order: questionMap[a.question_id]?.sort_order ?? 0,
        }))
        .sort((a, b) => a.sort_order - b.sort_order);

      return res.status(200).json({ record, form, site: siteRows && siteRows[0], items });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}

const BUILTIN_LABELS = {
  flha: 'FLHA',
  inspection: 'Equipment Inspection',
  toolbox: 'Toolbox Talk',
  nearmiss: 'Near Miss Report',
  incident: 'Incident Report',
  daily: 'Daily Report',
  monthly: 'Monthly Site Inspection',
  equipment_reports: 'Weekly Equipment Reports',
};
