// api/monthly.js
// Handles Monthly Inspection Forms — admin builder (forms/questions),
// worker submission, and supervisor/admin viewing + corrective action
// tracking.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { createUploadUrl } from '../server-lib/uploadUrls.js';
import { signRows } from '../server-lib/signedUrls.js';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ── Generated PDF uploads for monthly inspection reports ────────────
    if (action === 'create_upload_url') {
      const result = await createUploadUrl(supabaseAdmin, 'flha-reports', req.body.filename);
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true, path: result.path, uploadToken: result.uploadToken });
    }

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

    if (action === 'get_active_form') {
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
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

    if (action === 'submit_monthly') {
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { data: coRows } = await supabaseAdmin.from('companies').select('suspended').eq('id', session.companyId).limit(1);
      if (coRows && coRows[0] && coRows[0].suspended) {
        return res.status(403).json({ error: "Your company's access is suspended. Contact your administrator." });
      }
      const { siteId, formId, answers, submittedBy, aiSummary, aiAssisted, pdfUrl, clientSubmissionId, periodMonth } = req.body;
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

      // Idempotency (docs/scope-offline-capability.md Phase 1) — a queued
      // offline monthly inspection gets retried, possibly more than once.
      // This is a multi-step insert (record + per-question answers +
      // conditional corrective actions), so unlike the single-insert tables
      // a plain re-check isn't enough on its own — the unique index on
      // client_submission_id (see the migration that added this column) is
      // the real backstop against a race between this check and the insert
      // below creating two records for the same retried submission.
      // Scoped by form_id (already verified above to belong to
      // session.companyId) rather than a bare client_submission_id lookup —
      // inspection_records has no company_id column of its own, and an
      // unscoped check would match across tenants on a (practically
      // unlikely, but unnecessary to allow) clientSubmissionId collision.
      if (clientSubmissionId) {
        const { data: existingRows } = await supabaseAdmin
          .from('inspection_records')
          .select('id')
          .eq('form_id', formId)
          .eq('client_submission_id', clientSubmissionId)
          .limit(1);
        if (existingRows && existingRows.length > 0) {
          return res.status(200).json({ id: existingRows[0].id });
        }
      }

      // docs/scope-offline-capability.md Phase 1: period_month used to
      // always be computed from the server's now() at insert time, which
      // is wrong for a queued-offline submission resynced after a delay
      // that crosses a month boundary — an inspection actually done on the
      // last day of the month could land attributed to the next month.
      // periodMonth (YYYY-MM-01) is captured client-side once, at the
      // original fill time, and used here if given; a validated format
      // only, never trusted blindly — falls back to server-computed now()
      // for older clients or if the value is malformed.
      const now = new Date();
      const periodStart = (typeof periodMonth === 'string' && /^\d{4}-\d{2}-01$/.test(periodMonth))
        ? periodMonth
        : new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

      const { data: record, error: recErr } = await supabaseAdmin
        .from('inspection_records')
        .insert({
          form_id: formId, site_id: siteId, submitted_by: submittedBy,
          period_month: periodStart, ai_summary: aiSummary || null,
          pdf_url: pdfUrl || null, status: 'complete',
          client_submission_id: clientSubmissionId || null,
          // docs/scope-offline-capability.md Phase 2 — flags a record
          // submitted without AI-generated content (worker filled it in by
          // hand because /api/generate-flha was unreachable). Defaults true
          // (column default) when the client doesn't send it at all.
          ai_assisted: aiAssisted !== false,
        })
        .select()
        .single();
      if (recErr) {
        // A unique-index violation here means a concurrent retry of the
        // same clientSubmissionId won the race between the check above and
        // this insert — treat it as the same success the first insert got,
        // not a failure, so a retried queue item doesn't show an error for
        // a submission that actually landed.
        if (recErr.code === '23505' && clientSubmissionId) {
          const { data: raceRows } = await supabaseAdmin
            .from('inspection_records')
            .select('id')
            .eq('form_id', formId)
            .eq('client_submission_id', clientSubmissionId)
            .limit(1);
          if (raceRows && raceRows.length > 0) return res.status(200).json({ id: raceRows[0].id });
        }
        return res.status(500).json({ error: 'Save failed. Try again.' });
      }

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

    // ══ SUPERVISOR / ADMIN: viewing + corrective actions ════════════════

    if (action === 'list_records') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });

      let formsQuery = supabaseAdmin.from('inspection_forms').select('id, company_id, title');
      if (session.role === 'supervisor') formsQuery = formsQuery.eq('company_id', session.companyId);
      const { data: forms, error: formsErr } = await formsQuery;
      if (formsErr) return res.status(500).json({ error: 'Could not load forms.' });
      const formIds = (forms || []).map(f => f.id);
      if (formIds.length === 0) return res.status(200).json({ records: [] });

      const { data: records, error: recErr } = await supabaseAdmin
        .from('inspection_records')
        .select('*')
        .in('form_id', formIds)
        .order('created_at', { ascending: false });
      if (recErr) return res.status(500).json({ error: 'Could not load records.' });

      const siteIds = [...new Set((records || []).map(r => r.site_id))];
      const { data: sites } = await supabaseAdmin.from('sites').select('id, name').in('id', siteIds.length ? siteIds : [0]);
      const siteMap = {}; (sites || []).forEach(s => { siteMap[s.id] = s.name; });
      const formMap = {}; (forms || []).forEach(f => { formMap[f.id] = f; });

      const recordIds = (records || []).map(r => r.id);
      const { data: answers } = await supabaseAdmin.from('inspection_answers').select('id, record_id').in('record_id', recordIds.length ? recordIds : [0]);
      const answerIds = (answers || []).map(a => a.id);
      const { data: corrActions } = await supabaseAdmin.from('corrective_actions').select('id, answer_id, status').in('answer_id', answerIds.length ? answerIds : [0]);

      const answerToRecord = {}; (answers || []).forEach(a => { answerToRecord[a.id] = a.record_id; });
      const recordCounts = {};
      (corrActions || []).forEach(ca => {
        const recId = answerToRecord[ca.answer_id];
        if (!recId) return;
        if (!recordCounts[recId]) recordCounts[recId] = { open: 0, resolved: 0 };
        if (ca.status === 'resolved') recordCounts[recId].resolved++;
        else recordCounts[recId].open++;
      });

      const signedRecords = await signRows(supabaseAdmin, records, [{ key: 'pdf_url', bucket: 'flha-reports' }]);
      const enriched = signedRecords.map(r => ({
        ...r,
        site_name: siteMap[r.site_id] || 'Unknown site',
        form_title: formMap[r.form_id]?.title || 'Unknown form',
        company_id: formMap[r.form_id]?.company_id,
        open_actions: recordCounts[r.id]?.open || 0,
        resolved_actions: recordCounts[r.id]?.resolved || 0,
      }));

      return res.status(200).json({ records: enriched });
    }

    if (action === 'get_record_detail') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { recordId } = req.body;
      if (!recordId) return res.status(400).json({ error: 'Missing record id.' });

      const { data: recordRows, error: recErr } = await supabaseAdmin.from('inspection_records').select('*').eq('id', recordId).limit(1);
      if (recErr || !recordRows || recordRows.length === 0) return res.status(404).json({ error: 'Record not found.' });
      const record = { ...recordRows[0], pdf_url: await signStoredUrl(recordRows[0].pdf_url, 'flha-reports') };

      const { data: formRows } = await supabaseAdmin.from('inspection_forms').select('id, company_id, title').eq('id', record.form_id).limit(1);
      const form = formRows && formRows[0];
      if (!form) return res.status(404).json({ error: 'Form not found.' });
      if (session.role === 'supervisor' && form.company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });

      const { data: siteRows } = await supabaseAdmin.from('sites').select('id, name').eq('id', record.site_id).limit(1);

      const { data: answers, error: ansErr } = await supabaseAdmin.from('inspection_answers').select('*').eq('record_id', recordId);
      if (ansErr) return res.status(500).json({ error: 'Could not load answers.' });

      const { data: questions } = await supabaseAdmin.from('inspection_form_questions').select('id, question_text, sort_order').eq('form_id', record.form_id).order('sort_order', { ascending: true });
      const questionMap = {}; (questions || []).forEach(q => { questionMap[q.id] = q; });

      const answerIds = (answers || []).map(a => a.id);
      const { data: corrActions } = await supabaseAdmin.from('corrective_actions').select('*').in('answer_id', answerIds.length ? answerIds : [0]);
      const caByAnswer = {}; (corrActions || []).forEach(ca => { caByAnswer[ca.answer_id] = ca; });

      const items = (answers || [])
        .map(a => ({
          ...a,
          question_text: questionMap[a.question_id]?.question_text || 'Unknown question',
          sort_order: questionMap[a.question_id]?.sort_order ?? 0,
          corrective_action: caByAnswer[a.id] || null,
        }))
        .sort((a, b) => a.sort_order - b.sort_order);

      return res.status(200).json({ record, form, site: siteRows && siteRows[0], items });
    }

    if (action === 'list_corrective_actions') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });

      let formsQuery = supabaseAdmin.from('inspection_forms').select('id, company_id');
      if (session.role === 'supervisor') formsQuery = formsQuery.eq('company_id', session.companyId);
      const { data: forms } = await formsQuery;
      const formIds = (forms || []).map(f => f.id);
      if (formIds.length === 0) return res.status(200).json({ actions: [] });
      const formCompanyMap = {}; (forms || []).forEach(f => { formCompanyMap[f.id] = f.company_id; });

      const { data: records } = await supabaseAdmin.from('inspection_records').select('id, form_id, site_id, period_month, submitted_by').in('form_id', formIds);
      const recordIds = (records || []).map(r => r.id);
      if (recordIds.length === 0) return res.status(200).json({ actions: [] });

      const { data: answers } = await supabaseAdmin.from('inspection_answers').select('id, record_id, question_id').in('record_id', recordIds);
      const answerIds = (answers || []).map(a => a.id);
      if (answerIds.length === 0) return res.status(200).json({ actions: [] });

      const { data: corrActions, error } = await supabaseAdmin.from('corrective_actions').select('*').in('answer_id', answerIds).order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: 'Could not load corrective actions.' });

      const answerMap = {}; (answers || []).forEach(a => { answerMap[a.id] = a; });
      const recordMap = {}; (records || []).forEach(r => { recordMap[r.id] = r; });
      const siteIds = [...new Set((records || []).map(r => r.site_id))];
      const { data: sites } = await supabaseAdmin.from('sites').select('id, name').in('id', siteIds.length ? siteIds : [0]);
      const siteMap = {}; (sites || []).forEach(s => { siteMap[s.id] = s.name; });
      const questionIds = [...new Set((answers || []).map(a => a.question_id))];
      const { data: questions } = await supabaseAdmin.from('inspection_form_questions').select('id, question_text').in('id', questionIds.length ? questionIds : [0]);
      const qMap = {}; (questions || []).forEach(q => { qMap[q.id] = q.question_text; });

      const enriched = (corrActions || []).map(ca => {
        const ans = answerMap[ca.answer_id];
        const rec = ans ? recordMap[ans.record_id] : null;
        return {
          ...ca,
          question_text: ans ? (qMap[ans.question_id] || 'Unknown question') : 'Unknown question',
          site_name: rec ? (siteMap[rec.site_id] || 'Unknown site') : 'Unknown site',
          period_month: rec?.period_month,
          submitted_by: rec?.submitted_by,
          company_id: rec ? formCompanyMap[rec.form_id] : null,
        };
      });

      return res.status(200).json({ actions: enriched });
    }

    if (action === 'update_corrective_action') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { actionId, responsibleName, targetDate, status } = req.body;
      if (!actionId) return res.status(400).json({ error: 'Missing action id.' });

      if (session.role === 'supervisor') {
        const { data: caRows } = await supabaseAdmin.from('corrective_actions').select('id, answer_id').eq('id', actionId).limit(1);
        const ca = caRows && caRows[0];
        if (!ca) return res.status(404).json({ error: 'Not found.' });
        const { data: ansRows } = await supabaseAdmin.from('inspection_answers').select('record_id').eq('id', ca.answer_id).limit(1);
        const ans = ansRows && ansRows[0];
        if (!ans) return res.status(404).json({ error: 'Not found.' });
        const { data: recRows } = await supabaseAdmin.from('inspection_records').select('form_id').eq('id', ans.record_id).limit(1);
        const rec = recRows && recRows[0];
        if (!rec) return res.status(404).json({ error: 'Not found.' });
        const { data: formRows } = await supabaseAdmin.from('inspection_forms').select('company_id').eq('id', rec.form_id).limit(1);
        const form = formRows && formRows[0];
        if (!form || form.company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });
      }

      const updates = {};
      if (responsibleName !== undefined) updates.responsible_name = responsibleName;
      if (targetDate !== undefined) updates.target_date = targetDate || null;
      if (status !== undefined) {
        updates.status = status;
        updates.resolved_at = status === 'resolved' ? new Date().toISOString() : null;
      }

      const { error } = await supabaseAdmin.from('corrective_actions').update(updates).eq('id', actionId);
      if (error) return res.status(500).json({ error: "Couldn't update." });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
