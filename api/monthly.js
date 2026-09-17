// api/monthly.js
// Handles Monthly Inspection Forms — admin builder (forms/questions),
// worker submission, and supervisor/admin viewing + corrective action
// tracking.

import { createClient } from '@supabase/supabase-js';
import { authorRosterId } from '../server-lib/authorStamp.js';
import { openCorrectiveActions } from '../server-lib/correctiveActions.js';
import { annotateRecurrence, patternsByEquipment, RECURRENCE_THRESHOLD, RECURRENCE_WINDOW_DAYS } from '../server-lib/recurrence.js';
import crypto from 'crypto';
import { createUploadUrl, storedUrlFromClientReceipt, receiptWasDropped } from '../server-lib/uploadUrls.js';
import { signRows } from '../server-lib/signedUrls.js';

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

// flha-reports is a private bucket — the DB still stores a "public"-shaped
// URL (upload code never changed), but that string is never itself a
// working link. Every value handed to a client is swapped for a
// short-lived signed URL first.
function pathFromStoredUrl(url, bucket) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = decodeURIComponent(url.slice(idx + marker.length));
  // The bucket name is not a boundary. Supabase's createSignedUrl builds
  // `object/sign/<bucket>/<path>` as a URL string, and WHATWG URL parsing
  // collapses dot segments before the request goes out, so a stored path of
  // `../flha-reports/x.pdf` in the gatehouse-uploads bucket resolves to
  // `object/sign/flha-reports/x.pdf` and signs a file in a bucket the caller
  // was never reading. Reject traversal and absolute paths outright —
  // server-lib/uploadUrls.js's sanitizeFilename already drops these segments
  // on the write side, so no legitimately issued path contains one.
  if (!path || path.startsWith('/')) return null;
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  return path;
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
      const result = await createUploadUrl(supabaseAdmin, 'flha-reports', req.body.filename, session.companyId);
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true, path: result.path, uploadToken: result.uploadToken, receipt: result.receipt });
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
      // Resolved up here so the response can tell the browser whether the
      // PDF actually attached, rather than the drop only reaching a log.
      const resolvedSubmitPdfUrl = storedUrlFromClientReceipt(pdfUrl, session.companyId);
      const pdfLinked = !receiptWasDropped(pdfUrl, resolvedSubmitPdfUrl);
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
      // original fill time, and used here if given.
      //
      // A tenant-scope review of this exact field (after an earlier,
      // premature "came back clean" note here that this comment replaces —
      // the review hadn't actually finished when that was written) found a
      // real gap: validating only the string's *shape* let a client submit
      // any date at all, not just a plausible one. That opened two paths —
      // pre-dating a submission into a future month to make
      // get_active_form's duplicate check silently treat a real future
      // inspection as "already done," and submitting several records for
      // the same real month under different periodMonth values to evade
      // that same duplicate check entirely. Fixed by bounding periodMonth
      // to the server's current month or the immediately preceding one —
      // covers the legitimate resync-a-day-late case this was built for
      // without accepting an arbitrary client-chosen date. Also tightens
      // the month digits to 01-12 (previously any two digits passed the
      // regex and only got caught by Postgres's own date validation,
      // surfacing as a confusing generic 500 instead of a clear rejection).
      const now = new Date();
      const serverPeriod = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevPeriod = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), 1).toISOString().slice(0, 10);
      const periodMonthValid = typeof periodMonth === 'string' && /^\d{4}-(0[1-9]|1[0-2])-01$/.test(periodMonth)
        && (periodMonth === serverPeriod || periodMonth === prevPeriod);
      const periodStart = periodMonthValid ? periodMonth : serverPeriod;

      const { data: record, error: recErr } = await supabaseAdmin
        .from('inspection_records')
        .insert({
          form_id: formId, site_id: siteId, submitted_by: submittedBy,
          // Break #3 — author from the session, never the request.
          submitted_by_roster_id: authorRosterId(session),
          period_month: periodStart, ai_summary: aiSummary || null,
          pdf_url: resolvedSubmitPdfUrl, status: 'complete',
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

      // Every answer must name a question that actually belongs to this
      // form. Without this, a worker could submit against their own
      // company's form while pointing one answer at a question id from
      // another company's form: the answer row stores it, a corrective
      // action is opened against it, and list_corrective_actions below
      // then renders that other company's question wording on this
      // company's dashboard. Found by tenant-scope-reviewer while
      // reviewing the Brain signal added below; pre-existing, not
      // introduced by it.
      //
      // The form was already proven to belong to this company above, so
      // scoping the lookup to the form is enough to scope it to the
      // tenant. A mismatch is a broken or hostile client, never a real
      // field submission, so it fails the submit rather than being
      // silently dropped — dropping it would lose a worker's answer.
      const { data: formQuestionRows, error: qErr } = await supabaseAdmin
        .from('inspection_form_questions')
        .select('id, question_text')
        .eq('form_id', formId);
      if (qErr) return res.status(500).json({ error: 'Could not load the form. Try again.' });
      const questionTextById = new Map((formQuestionRows || []).map((q) => [String(q.id), q.question_text]));
      const foreignAnswer = answers.find((a) => !questionTextById.has(String(a.questionId)));
      if (foreignAnswer) return res.status(400).json({ error: "That answer doesn't belong to this form." });

      const failedQuestionIds = [];
      for (const a of answers) {
        const { data: answerRow, error: ansErr } = await supabaseAdmin
          .from('inspection_answers')
          .insert({ record_id: record.id, question_id: a.questionId, answer: !!a.answer, notes: a.note || null })
          .select()
          .single();
        if (ansErr || !answerRow) continue;
        if (!a.answer) {
          failedQuestionIds.push(a.questionId);
          // Break #5: corrective actions now carry company_id/source_type/
          // source_id so an incident or a failed equipment inspection can
          // open one too. Written through the shared helper so all four
          // sources stay in step.
          await openCorrectiveActions(supabaseAdmin, {
            companyId: session.companyId,
            sourceType: 'monthly_answer',
            sourceId: answerRow.id,
            answerId: answerRow.id,
            descriptions: [(a.note || '').trim() || 'No description provided.'],
          });
        }
      }

      // docs/scope-company-brain.md Phase 3 — monthly site inspections were
      // left out of the original signal set alongside equipment
      // inspections (see the note in api/logs.js). A failed question is a
      // real, structured finding about this company's own sites, which is
      // exactly what the profile should learn from.
      //
      // Only failures are recorded, and only when there are any: a clean
      // walkthrough writes no row. The question text lives on
      // inspection_form_questions rather than in the submitted payload, so
      // it is resolved here in one query rather than per answer. Same
      // best-effort discipline as every other signal writer — the record
      // and its corrective actions are already saved by this point, and a
      // failure below is logged, never turned into a failed submit.
      if (failedQuestionIds.length > 0) {
        try {
          const failed = failedQuestionIds
            .map((id) => questionTextById.get(String(id)))
            .map((t) => (typeof t === 'string' ? t.trim().slice(0, 200) : ''))
            .filter(Boolean)
            .slice(0, 12);
          if (failed.length > 0) {
            const { error: signalErr } = await supabaseAdmin.from('company_signals').insert({
              company_id: session.companyId,
              source_type: 'monthly_inspection',
              source_id: String(record.id),
              signal_json: { failed },
            });
            if (signalErr) console.error('company_signals insert failed for monthly inspection', record.id, signalErr.message);
          }
        } catch (e) {
          console.error('company_signals capture failed for monthly inspection', record.id, e.message);
        }
      }

      return res.status(200).json({ id: record.id, pdfLinked });
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

    // ── Supervisor / Admin: correct the submitted content of a record ──
    // General "fix a mistake" edit — corrects the actual answers (and the
    // optional AI summary) that feed the PDF, distinct from
    // `update_corrective_action` below (which only ever touches the
    // separate corrective_actions tracking row). Tenant ownership is
    // re-checked the same way as `get_record_detail` above: walk
    // record -> form -> company_id, never trust a client-supplied company.
    if (action === 'update_record') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { recordId, answers, aiSummary, pdfUrl } = req.body;
      if (!recordId || !Array.isArray(answers)) return res.status(400).json({ error: 'Missing details.' });

      const { data: recordRows, error: recErr } = await supabaseAdmin.from('inspection_records').select('id, form_id').eq('id', recordId).limit(1);
      if (recErr || !recordRows || recordRows.length === 0) return res.status(404).json({ error: 'Record not found.' });
      const record = recordRows[0];

      const { data: formRows } = await supabaseAdmin.from('inspection_forms').select('id, company_id').eq('id', record.form_id).limit(1);
      const form = formRows && formRows[0];
      if (!form) return res.status(404).json({ error: 'Form not found.' });
      if (session.role === 'supervisor' && form.company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed to edit this record.' });
      }

      // Only ever touch answer rows that actually belong to this record —
      // never trust a client-supplied answer id blindly.
      const { data: existingAnswers } = await supabaseAdmin.from('inspection_answers').select('id').eq('record_id', recordId);
      const validAnswerIds = new Set((existingAnswers || []).map(a => a.id));

      for (const a of answers) {
        if (!a || !validAnswerIds.has(a.id)) continue;
        const { error: ansErr } = await supabaseAdmin
          .from('inspection_answers')
          .update({ answer: !!a.answer, notes: a.note || null })
          .eq('id', a.id);
        if (ansErr) continue;
        // An item corrected to "no" that has no corrective action yet gets
        // one opened — same as a fresh submission would. An item corrected
        // to "yes" keeps any existing corrective action row as-is (an
        // audit trail, not something a content edit should silently erase).
        if (!a.answer) {
          // form.company_id, NOT session.companyId: this branch is reachable
          // by an admin, who is deliberately cross-company here, so their
          // own session company would file the action under the wrong
          // tenant. The supervisor path is already pinned to their company
          // by the 403 above.
          //
          // The helper dedupes on (company, source, description), so the
          // explicit existence check this used to do is no longer needed.
          await openCorrectiveActions(supabaseAdmin, {
            companyId: form.company_id,
            sourceType: 'monthly_answer',
            sourceId: a.id,
            answerId: a.id,
            descriptions: [(a.note || '').trim() || 'No description provided.'],
          });
        }
      }

      const recordUpdate = {};
      if (aiSummary !== undefined) recordUpdate.ai_summary = aiSummary || null;
      const resolvedPdfUrl = storedUrlFromClientReceipt(pdfUrl, session.companyId);
      if (resolvedPdfUrl) recordUpdate.pdf_url = resolvedPdfUrl;
      const pdfLinked = !receiptWasDropped(pdfUrl, resolvedPdfUrl);
      if (Object.keys(recordUpdate).length > 0) {
        const { error: updErr } = await supabaseAdmin.from('inspection_records').update(recordUpdate).eq('id', recordId);
        if (updErr) return res.status(500).json({ error: 'Update failed.' });
      }

      // Sign the pdf_url now stored on the row, not the `pdfUrl` string the
      // client sent. Signing a request-supplied path turned this endpoint
      // into an oracle: `flha-reports` is one flat bucket shared by every
      // tenant with deterministic, second-granularity filenames, so a
      // caller could hand over another company's report path and get a
      // working signed URL back for it. Re-reading the row means the only
      // path that can be signed is the one this record actually points at.
      const { data: afterRows } = await supabaseAdmin.from('inspection_records').select('pdf_url').eq('id', recordId).limit(1);
      const storedPdfUrl = afterRows?.[0]?.pdf_url || null;
      const signedPdfUrl = storedPdfUrl ? await signStoredUrl(storedPdfUrl, 'flha-reports') : null;
      return res.status(200).json({ ok: true, pdfUrl: signedPdfUrl, pdfLinked });
    }

    // Corrective actions are no longer a monthly-inspection concept — since
    // break #5 they can come from an incident, a near miss or a failed
    // equipment inspection too. The endpoint still lives in this file so the
    // Dashboard's existing call keeps working; the honest home for it is its
    // own api/correctiveactions.js, which is a follow-up rather than part of
    // this change.
    //
    // company_id on the row replaces the old four-hop walk
    // (answer -> record -> form -> company), which only ever worked because
    // every row was a monthly answer. That walk is why the column had to be
    // added: with a polymorphic source there is no single join that resolves
    // an owner.
    if (action === 'list_corrective_actions') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });

      let caQuery = supabaseAdmin.from('corrective_actions').select('*').order('created_at', { ascending: false });
      if (session.role === 'supervisor') caQuery = caQuery.eq('company_id', session.companyId);
      const { data: corrActions, error } = await caQuery;
      if (error) return res.status(500).json({ error: 'Could not load corrective actions.' });
      if (!corrActions || corrActions.length === 0) return res.status(200).json({ actions: [] });

      const idsFor = (type) => corrActions.filter(ca => ca.source_type === type).map(ca => ca.source_id);

      // Every enrichment lookup below is constrained to the companies whose
      // actions were actually returned above, not just to the ids found on
      // those actions.
      //
      // This is deliberate belt-and-braces. The old four-hop walk *proved*
      // ownership of each parent row; filtering by source_id alone would
      // only *assume* it, resting entirely on "source_id always points at a
      // row inside company_id" holding for every writer, forever. That
      // invariant is true for all four writers today, but a fifth that takes
      // sourceId from a request body while taking companyId from the session
      // would turn this read path into a cross-tenant disclosure of site
      // names, incident details and equipment labels. Costs one predicate;
      // removes the whole class. (tenant-scope-reviewer, 2026-09-17.)
      const companyIds = [...new Set(corrActions.map(ca => ca.company_id).filter(Boolean))];
      const scopedIds = companyIds.length ? companyIds : [0];

      // Forms first: inspection_answers and inspection_records carry no
      // company_id of their own, so the form is what anchors them.
      const { data: scopedForms } = await supabaseAdmin
        .from('inspection_forms').select('id').in('company_id', scopedIds);
      const formIds = (scopedForms || []).map(f => f.id);
      const scopedFormIds = formIds.length ? formIds : [0];

      // ── Monthly answers ───────────────────────────────────────────────
      const answerIds = idsFor('monthly_answer');
      const answerMap = {}, recordMap = {}, siteMap = {}, qMap = {};
      if (answerIds.length > 0) {
        const { data: answers } = await supabaseAdmin.from('inspection_answers').select('id, record_id, question_id').in('id', answerIds);
        (answers || []).forEach(a => { answerMap[a.id] = a; });

        // Records are constrained to this company's forms, so an answer
        // reached through a cross-tenant source_id resolves to nothing and
        // renders as Unknown rather than leaking. Fail closed.
        const recordIds = [...new Set((answers || []).map(a => a.record_id).filter(Boolean))];
        const { data: records } = await supabaseAdmin
          .from('inspection_records').select('id, form_id, site_id, period_month, submitted_by')
          .in('id', recordIds.length ? recordIds : [0])
          .in('form_id', scopedFormIds);
        (records || []).forEach(r => { recordMap[r.id] = r; });

        const siteIds = [...new Set((records || []).map(r => r.site_id).filter(Boolean))];
        const { data: sites } = await supabaseAdmin
          .from('sites').select('id, name')
          .in('id', siteIds.length ? siteIds : [0])
          .in('company_id', scopedIds);
        (sites || []).forEach(s2 => { siteMap[s2.id] = s2.name; });

        const questionIds = [...new Set((answers || []).map(a => a.question_id).filter(Boolean))];
        const { data: questions } = await supabaseAdmin
          .from('inspection_form_questions').select('id, question_text')
          .in('id', questionIds.length ? questionIds : [0])
          .in('form_id', scopedFormIds);
        (questions || []).forEach(q => { qMap[q.id] = q.question_text; });
      }

      // ── Incidents and near misses ─────────────────────────────────────
      const incidentMap = {}, nearMissMap = {};
      const incidentIds = idsFor('incident');
      if (incidentIds.length > 0) {
        const { data: rows } = await supabaseAdmin
          .from('incidents').select('id, site, site_id, occurred_at, reporter_name, incident_type')
          .in('id', incidentIds).in('company_id', scopedIds);
        (rows || []).forEach(r => { incidentMap[r.id] = r; });
      }
      const nearMissIds = idsFor('near_miss');
      if (nearMissIds.length > 0) {
        const { data: rows } = await supabaseAdmin
          .from('near_misses').select('id, site, site_id, occurred_at, reporter_name')
          .in('id', nearMissIds).in('company_id', scopedIds);
        (rows || []).forEach(r => { nearMissMap[r.id] = r; });
      }

      // ── Equipment inspections ─────────────────────────────────────────
      const inspectionMap = {};
      const inspectionIds = idsFor('equipment_inspection');
      if (inspectionIds.length > 0) {
        const { data: rows } = await supabaseAdmin
          .from('inspections').select('id, equipment_label, worker_name, trip_type, created_at')
          .in('id', inspectionIds).in('company_id', scopedIds);
        (rows || []).forEach(r => { inspectionMap[r.id] = r; });
      }

      // Every action reports the same four display fields regardless of
      // where it came from, so the dashboard renders one list rather than
      // four. source_label is what a supervisor reads to know what this is
      // about; source_type is what the UI filters and badges on.
      const enriched = corrActions.map(ca => {
        const base = { ...ca, source_type: ca.source_type };
        if (ca.source_type === 'monthly_answer') {
          const ans = answerMap[ca.source_id];
          const rec = ans ? recordMap[ans.record_id] : null;
          return {
            ...base,
            source_label: 'Monthly site inspection',
            question_text: ans ? (qMap[ans.question_id] || 'Unknown question') : 'Unknown question',
            site_name: rec ? (siteMap[rec.site_id] || 'Unknown site') : 'Unknown site',
            // Break #2 — the analytics site tables key on the id when a row
            // has one. Without it here, an open corrective action bucketed
            // by NAME while the monthly record it came from bucketed by id,
            // splitting one site into two rows with the open-actions row
            // sorting to the top. Found by tenant-scope-reviewer.
            site_id: rec?.site_id ?? null,
            period_month: rec?.period_month || null,
            submitted_by: rec?.submitted_by || null,
          };
        }
        if (ca.source_type === 'incident' || ca.source_type === 'near_miss') {
          const r = ca.source_type === 'incident' ? incidentMap[ca.source_id] : nearMissMap[ca.source_id];
          return {
            ...base,
            source_label: ca.source_type === 'incident' ? 'Incident report' : 'Near miss report',
            question_text: r?.incident_type || null,
            site_name: r?.site || 'Unknown site',
            site_id: r?.site_id ?? null,
            period_month: r?.occurred_at || null,
            submitted_by: r?.reporter_name || null,
          };
        }
        if (ca.source_type === 'equipment_inspection') {
          const r = inspectionMap[ca.source_id];
          // The machine label now comes off the ACTION's own column, falling
          // back to the parent inspection only for rows written before
          // corrective-actions-equipment-recurrence-migration.sql. Reading
          // the parent first would break the moment an inspection is deleted
          // — the action survives, and "Unknown equipment" on a defect is
          // useless to the person who has to go and fix it.
          const machine = ca.equipment_label || r?.equipment_label || null;
          return {
            ...base,
            source_label: r?.trip_type === 'posttrip' ? 'Post-trip inspection' : 'Pre-use inspection',
            question_text: machine,
            equipment_label: machine,
            // site_name is deliberately null rather than the machine name.
            // The old code put a MACHINE in the site slot, so the dashboard
            // rendered "Cat 320 Excavator" where every other row shows a
            // jobsite — and the search box offered to search "site" while
            // actually matching machines. A machine is not a site; it gets
            // its own field and its own chip in the UI.
            site_name: null,
            site_id: null,
            period_month: r?.created_at || ca.created_at || null,
            submitted_by: r?.worker_name || null,
          };
        }
        return { ...base, source_label: 'Unknown source', question_text: null, site_name: 'Unknown', site_id: null, period_month: null, submitted_by: null };
      });

      // ── Recurrence ────────────────────────────────────────────────────
      //
      // "3 low tire corrective actions in a row should flag something as a
      // pattern" (Dillon, 2026-09-17). Computed here rather than in the
      // browser so the corrective-actions list and the maintenance screen
      // cannot disagree about what counts as a pattern — the same reason
      // server-lib/readings.js exists after break #1.
      //
      // Counted over the company's WHOLE set, not the page: a pattern is a
      // property of the machine's history, so it must not change depending
      // on what the caller happens to be looking at.
      const withRecurrence = annotateRecurrence(enriched);

      // The maintenance screen reads its per-machine repeat-offender list
      // from here rather than from api/maintenance.js. Deliberate: this is
      // the only handler that already resolves corrective actions
      // tenant-safely, and duplicating that resolution in a second endpoint
      // is precisely how the cross-tenant hazard documented above gets
      // reintroduced. It also costs no new Vercel function.
      return res.status(200).json({
        actions: withRecurrence,
        equipmentPatterns: patternsByEquipment(enriched),
        recurrenceRule: { threshold: RECURRENCE_THRESHOLD, windowDays: RECURRENCE_WINDOW_DAYS },
      });
    }

    if (action === 'update_corrective_action') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { actionId, responsibleName, targetDate, status } = req.body;
      if (!actionId) return res.status(400).json({ error: 'Missing action id.' });

      // Ownership now comes off the row itself. The old check walked
      // action -> answer -> record -> form -> company, which returns 404 the
      // moment answer_id is null — so leaving it would have made every
      // incident- and inspection-sourced action permanently unresolvable
      // for a supervisor, while still listing it on their dashboard.
      if (session.role === 'supervisor') {
        const { data: caRows } = await supabaseAdmin.from('corrective_actions').select('id, company_id').eq('id', actionId).limit(1);
        const ca = caRows && caRows[0];
        if (!ca) return res.status(404).json({ error: 'Not found.' });
        if (ca.company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });
      }

      // Two values that used to go straight from the request body into the
      // row, both found by tenant-scope-reviewer.
      //
      // `status` had no allow-list at all — it leaned entirely on a database
      // CHECK to reject nonsense, and the error path below RETRIES rather
      // than surfacing it, so a rejected value would have looked like a
      // successful save.
      if (status !== undefined && status !== 'open' && status !== 'resolved') {
        return res.status(400).json({ error: 'Unknown status.' });
      }

      const updates = {};
      if (responsibleName !== undefined) updates.responsible_name = responsibleName;
      if (targetDate !== undefined) updates.target_date = targetDate || null;
      if (status !== undefined) {
        updates.status = status;
        updates.resolved_at = status === 'resolved' ? new Date().toISOString() : null;
        // Who closed it and how. A post-trip resolution already records both
        // (resolution_source = 'posttrip'); without this a supervisor
        // closing one by hand left resolution_source null, so "resolved"
        // meant two different things and an audit could not tell a repair
        // that was actually performed from a row somebody ticked off.
        //
        // Reopening clears all three rather than leaving a stale repair note
        // attached to an action that is open again.
        updates.resolution_source = status === 'resolved' ? 'supervisor' : null;
        // And `resolved_by` fell through to the body's `responsibleName`
        // when the session carried no name — which is every company still on
        // a shared login. That is exactly what break #3 settled against: an
        // author a caller can choose is a suggestion, not attribution. It
        // degrades to the literal 'Supervisor' instead, the way
        // api/logs.js's repair log degrades to 'Worker'. Capped, because a
        // session value is not automatically a short one.
        updates.resolved_by = status === 'resolved'
          ? ((session.userName || '').trim().slice(0, 120) || 'Supervisor')
          : null;
        if (status !== 'resolved') updates.resolved_note = null;
      }

      // The ownership check above is correct, so this predicate changes
      // nothing today. It makes the WRITE self-defending rather than resting
      // on a check several lines above it staying there — one predicate for
      // a whole class of future mistake. Admins are cross-company by design,
      // here as everywhere else in this file.
      let updateQuery = supabaseAdmin.from('corrective_actions').update(updates).eq('id', actionId);
      if (session.role === 'supervisor') updateQuery = updateQuery.eq('company_id', session.companyId);
      const { error } = await updateQuery;
      if (error) {
        // Same deploy-window tolerance as the insert path in
        // server-lib/correctiveActions.js: if this code reaches production
        // before corrective-actions-equipment-recurrence-migration.sql runs,
        // a supervisor must still be able to close an action. Retry with
        // only the columns that have always existed.
        const legacy = { ...updates };
        delete legacy.resolution_source;
        delete legacy.resolved_by;
        delete legacy.resolved_note;
        let retryQuery = supabaseAdmin.from('corrective_actions').update(legacy).eq('id', actionId);
        if (session.role === 'supervisor') retryQuery = retryQuery.eq('company_id', session.companyId);
        const { error: retryErr } = await retryQuery;
        if (retryErr) return res.status(500).json({ error: "Couldn't update." });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
