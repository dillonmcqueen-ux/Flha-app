// api/monthly.js
// Handles Monthly Inspection Forms — admin builder (forms/questions),
// worker submission, and (in a later phase) corrective action tracking.

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ══ ADMIN: form builder ═══════════════════════════════════════════

    if (action === 'list_forms') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin
        .from('inspection_forms')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: 'Could not load forms.' });
      return res.status(200).json({ forms: data || [] });
    }

    if (action === 'create_form') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { companyId, title } = req.body;
      if (!companyId || !title?.trim()) return res.status(400).json({ error: 'Missing details.' });
      const { data, error } = await supabaseAdmin
        .from('inspection_forms')
        .insert({ company_id: companyId, title: title.trim(), is_active: true })
        .select()
        .single();
      if (error) return res.status(500).json({ error: "Couldn't create form." });
      return res.status(200).json({ form: data });
    }

    if (action === 'toggle_form') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { formId, isActive } = req.body;
      if (!formId) return res.status(400).json({ error: 'Missing form id.' });
      const { error } = await supabaseAdmin.from('inspection_forms').update({ is_active: !!isActive }).eq('id', formId);
      if (error) return res.status(500).json({ error: "Couldn't update form." });
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete_form') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { formId } = req.body;
      if (!formId) return res.status(400).json({ error: 'Missing form id.' });
      const { data: records, error: recErr } = await supabaseAdmin.from('inspection_records').select('id').eq('form_id', formId);
      if (recErr) return res.status(500).json({ error: 'Could not check submissions.' });
      if (records && records.length > 0) {
        return res.status(400).json({ error: "Couldn't delete: this form already has submitted inspections." });
      }
      await supabaseAdmin.from('inspection_form_questions').delete().eq('form_id', formId);
      const { error } = await supabaseAdmin.from('inspection_forms').delete().eq('id', formId);
      if (error) return res.status(500).json({ error: "Couldn't delete form." });
      return res.status(200).json({ ok: true });
    }

    if (action === 'list_questions') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { formId } = req.body;
      if (!formId) return res.status(400).json({ error: 'Missing form id.' });
      const { data, error } = await supabaseAdmin
        .from('inspection_form_questions')
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
        .from('inspection_form_questions')
        .select('sort_order')
        .eq('form_id', formId)
        .order('sort_order', { ascending: false })
        .limit(1);
      if (exErr) return res.status(500).json({ error: 'Could not add question.' });
      const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;
      const { data, error } = await supabaseAdmin
        .from('inspection_form_questions')
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
      const { error } = await supabaseAdmin.from('inspection_form_questions').delete().eq('id', questionId);
      if (error) return res.status(500).json({ error: "Couldn't remove question." });
      return res.status(200).json({ ok: true });
    }

    if (action === 'reorder_questions') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { updates } = req.body; // [{ id, sort_order }]
      if (!Array.isArray(updates)) return res.status(400).json({ error: 'Missing updates.' });
      for (const u of updates) {
        await supabaseAdmin.from('inspection_form_questions').update({ sort_order: u.sort_order }).eq('id', u.id);
      }
      return res.status(200).json({ ok: true });
    }

    // ══ WORKER: monthly submission ═════════════════════════════════════

    // Find the active form for this site's company, plus its questions,
    // plus whether a submission already exists for this site this month.
    if (action === 'get_active_form') {
      if (session.role !== 'worker') return res.status(403).json({ error: 'Not allowed.' });
      const { siteId } = req.body;
      if (!siteId) return res.status(400).json({ error: 'Missing site.' });

      const { data: siteRows, error: siteErr } = await supabaseAdmin.from('sites').select('id, company_id, name').eq('id', siteId).limit(1);
      if (siteErr || !siteRows || siteRows.length === 0 || siteRows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed for this site.' });
      }

      const { data: forms, error: formErr } = await supabaseAdmin
        .from('inspection_forms')
        .select('*')
        .eq('company_id', session.companyId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1);
      if (formErr) return res.status(500).json({ error: 'Could not load form.' });
      const form = (forms && forms[0]) || null;
      if (!form) return res.status(200).json({ form: null, questions: [], existingRecord: null });

      const { data: questions, error: qErr } = await supabaseAdmin
        .from('inspection_form_questions')
        .select('*')
        .eq('form_id', form.id)
        .order('sort_order', { ascending: true });
      if (qErr) return res.status(500).json({ error: 'Could not load questions.' });

      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const { data: existing } = await supabaseAdmin
        .from('inspection_records')
        .select('id, submitted_by, created_at')
        .eq('form_id', form.id)
        .eq('site_id', siteId)
        .eq('period_month', periodStart)
        .limit(1);

      return res.status(200).json({ form, questions: questions || [], existingRecord: (existing && existing[0]) || null });
    }

    // Submit a completed monthly inspection: creates the record, one
    // answer row per question, and a corrective action for every "No".
    if (action === 'submit_monthly') {
      if (session.role !== 'worker') return res.status(403).json({ error: 'Not allowed.' });
      const { siteId, formId, answers, submittedBy, aiSummary, pdfUrl } = req.body;
      if (!siteId || !formId || !Array.isArray(answers) || !submittedBy) {
        return res.status(400).json({ error: 'Missing details.' });
      }

      const { data: siteRows } = await supabaseAdmin.from('sites').select('id, company_id').eq('id', siteId).limit(1);
      if (!siteRows || siteRows.length === 0 || siteRows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed for this site.' });
      }
      const { data: formRows } = await supabaseAdmin.from('inspection_forms').select('id, company_id').eq('id', formId).limit(1);
      if (!formRows || formRows.length === 0 || formRows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed for this form.' });
      }

      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

      const { data: record, error: recErr } = await supabaseAdmin
        .from('inspection_records')
        .insert({
          form_id: formId, site_id: siteId, submitted_by: submittedBy,
          period_month: periodStart, ai_summary: aiSummary || null,
          pdf_url: pdfUrl || null, status: 'complete',
        })
        .select()
        .single();
      if (recErr) return res.status(500).json({ error: 'Save failed. Try again.' });

      for (const a of answers) {
        const { data: answerRow, error: ansErr } = await supabaseAdmin
          .from('inspection_answers')
          .insert({ record_id: record.id, question_id: a.questionId, answer: !!a.answer, notes: a.note || null })
          .select()
          .single();
        if (ansErr || !answerRow) continue;
        if (!a.answer) {
          await supabaseAdmin.from('corrective_actions').insert({
            answer_id: answerRow.id,
            description: (a.note || '').trim() || 'No description provided.',
            status: 'open',
          });
        }
      }

      return res.status(200).json({ id: record.id });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
