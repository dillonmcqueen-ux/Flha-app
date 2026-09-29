// api/portal.js
// Company Portal (FORA Company Portal — Build Spec): the admin document
// builder (AI-assisted draft + manual editing + publish), the worker
// submission path, and supervisor/admin viewing, assignment, and
// escalation handling for
// portal_documents/portal_questions/portal_records/portal_answers/
// portal_assignment_rules/portal_assignments/portal_escalations.
//
// Deliberately a separate file from api/customforms.js rather than folded
// into it — custom_forms is a company self-service, yes/no-only builder
// that stays exactly as it is; Portal documents are Dillon-built, per the
// spec's "Admin document builder" section, with a generalized field-type
// engine. Sharing one file would mean every future edit to either has to
// reason about both.
//
// All 5 build-order phases are built here: departments (phase 1, in
// api/companydata.js/roster), document engine v2 (phase 2), document-level
// routing + notification (phase 3), assignment + compliance (phase 4), and
// question-level escalation (phase 5). Phases 1-4 are the sellable v1;
// phase 5 is a roadmap item on top of it, not sold as included until now.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { authorRosterId } from '../server-lib/authorStamp.js';
import { createUploadUrl, storedUrlFromClientReceipt, receiptWasDropped, resolveUploadReceipt } from '../server-lib/uploadUrls.js';
import { signRows } from '../server-lib/signedUrls.js';
import { sendEmail } from '../server-lib/email.js';
import { withDecryptedEmail } from '../server-lib/fieldCrypto.js';
import { applyRuleToExistingRoster } from '../server-lib/portalAssignments.js';
import { PORTAL_DEPARTMENTS } from '../server-lib/portalDepartments.js';
import { PORTAL_FIELD_TYPE_KEYS, fieldTypeNeedsOptions, fieldTypeCanEscalate } from '../server-lib/portalFieldTypes.js';

export const config = {
  // Matches api/generate-flha.js — the AI draft step (ai_draft_document)
  // sends a whole source document to a thinking-capable model and can
  // legitimately take longer than Vercel's default.
  maxDuration: 120,
};

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Same construction as every other api/*.js file's session check
// (api/customforms.js, api/generate-flha.js, ...) — duplicated rather than
// shared, matching this codebase's existing per-file pattern.
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
  // See api/customforms.js's verifySession for why this check exists — a
  // login TICKET (purpose: 'roster' | 'master') must never be accepted here.
  if (payload.purpose) return null;
  if (payload.role === 'admin' || !payload.userId) return payload;
  const { data: rows, error } = await supabaseAdmin
    .from('roster')
    .select('active, role, company_id')
    .eq('id', payload.userId)
    .limit(1);
  if (error || !rows || rows.length === 0 || !rows[0].active) return null;
  if (rows[0].company_id !== payload.companyId) return null;
  return { ...payload, role: rows[0].role };
}

function resolveCompanyId(session, requestedCompanyId) {
  if (session.role === 'admin') return requestedCompanyId || null;
  return session.companyId;
}

function pathFromStoredUrl(url, bucket) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = decodeURIComponent(url.slice(idx + marker.length));
  // Same traversal guard as api/customforms.js's pathFromStoredUrl.
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

// Validates a builder-submitted question list against the field-type
// engine before anything is written. Returns an error string, or null if
// the list is well-formed.
function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return 'Add at least one question.';
  for (const q of questions) {
    if (!q || typeof q.questionText !== 'string' || !q.questionText.trim()) return 'Every question needs text.';
    if (!PORTAL_FIELD_TYPE_KEYS.includes(q.fieldType)) return `Unknown field type: ${q.fieldType}.`;
    if (fieldTypeNeedsOptions(q.fieldType)) {
      if (!Array.isArray(q.options) || q.options.filter(o => (o || '').trim()).length < 2) {
        return `"${q.questionText}" needs at least two options.`;
      }
    }
    // Phase 5: escalation is only ever set alongside a target department AND
    // a trigger value, on a field type that has a fixed set of possible
    // answers to compare against — see server-lib/portalFieldTypes.js.
    if (q.escalationDepartment) {
      if (!PORTAL_DEPARTMENTS.includes(q.escalationDepartment)) return `Invalid escalation department for "${q.questionText}".`;
      if (!fieldTypeCanEscalate(q.fieldType)) return `"${q.questionText}" can't escalate — only Yes/No, Dropdown, or Multi-select questions can.`;
      if (!q.escalationTriggerValue || !String(q.escalationTriggerValue).trim()) return `"${q.questionText}" needs a value that triggers the escalation.`;
      if (q.fieldType !== 'yesno' && !(q.options || []).includes(q.escalationTriggerValue)) {
        return `"${q.questionText}"'s escalation trigger must be one of its own options.`;
      }
    }
  }
  return null;
}

function validDepartments(departments) {
  return Array.isArray(departments) && departments.every(d => PORTAL_DEPARTMENTS.includes(d));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ══ ADMIN (founder-only): document builder ═══════════════════════════
    // Every action in this section requires session.role === 'admin' — the
    // spec is explicit that a Portal document is Dillon-built per company,
    // never a customer self-service feature (unlike custom_forms).

    if (action === 'create_source_upload_url') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { companyId, filename } = req.body;
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const result = await createUploadUrl(supabaseAdmin, 'portal-sources', filename, companyId);
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true, path: result.path, uploadToken: result.uploadToken, receipt: result.receipt });
    }

    // Reads an uploaded source file (PDF or photo of a paper form) and asks
    // Claude to propose a document structure. Nothing is written to
    // portal_documents/portal_questions here — the draft is handed back for
    // Dillon to review and edit client-side; only publish_document (below)
    // writes anything, per the spec's "AI draft never auto-publishes" rule.
    if (action === 'ai_draft_document') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { companyId, sourceReceipt, structureNotes } = req.body;
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      if (!sourceReceipt && !structureNotes) {
        return res.status(400).json({ error: 'Upload a file or describe the document.' });
      }

      const existingCategories = await distinctCategories();

      let contentBlocks = [];
      if (sourceReceipt) {
        // Same receipt model as every other upload in this app
        // (server-lib/uploadUrls.js) — never trust a client-supplied path
        // directly, even from an admin session, so this can't be pointed at
        // an arbitrary bucket path by a malformed request.
        const path = resolveUploadReceipt(sourceReceipt, 'portal-sources', companyId);
        if (!path) return res.status(400).json({ error: 'Upload receipt not recognized. Try uploading again.' });
        const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage.from('portal-sources').download(path);
        if (dlErr || !fileBlob) return res.status(400).json({ error: "Couldn't read the uploaded file. Try uploading again." });
        const buf = Buffer.from(await fileBlob.arrayBuffer());
        const ext = (path.split('.').pop() || '').toLowerCase();
        const isPdf = ext === 'pdf';
        const mediaType = isPdf ? 'application/pdf' : (ext === 'png' ? 'image/png' : 'image/jpeg');
        contentBlocks.push({
          type: isPdf ? 'document' : 'image',
          source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') },
        });
      }

      const instructions = `You are helping FORA (a field-documentation SaaS) turn a customer's own paper form into a structured digital document. ${sourceReceipt ? 'The attached file is a photo or PDF of that paper form — read it carefully.' : `No file was provided. Here is a short description of the document instead:\n${String(structureNotes).slice(0, 4000)}`}

Propose a JSON object with this exact shape and nothing else (no markdown fence, no commentary):
{
  "title": "short document title",
  "icon": "one emoji that fits the document",
  "category": "a short category label for this document type (e.g. 'Vehicle Pre-Trip Inspection')",
  "departments": ["zero or more of: hr, payroll, safety, maintenance, operations_manager — whichever department(s) would primarily receive this document"],
  "questions": [
    { "questionText": "exact or lightly cleaned-up field label from the form", "fieldType": "one of: yesno, short_text, number, date, dropdown, multiselect, signature, file_upload", "options": ["only for dropdown/multiselect — the choices"], "escalationDepartment": "only if this exact question has a clear fail/flag condition on the source form — one of: hr, payroll, safety, maintenance, operations_manager — else omit/null", "escalationTriggerValue": "only alongside escalationDepartment — the exact answer value (a yesno of 'no', or one of this question's own options) that means it's flagged — else omit/null" }
  ]
}

Existing categories already in use by other companies (prefer reusing one of these over inventing a near-duplicate, if one genuinely matches): ${existingCategories.length ? existingCategories.join(', ') : '(none yet)'}

Rules:
- One question per field on the source form. Do not invent fields that aren't there.
- Pick "yesno" only for genuine yes/no or pass/fail items. Use "dropdown" for a fixed set of choices, "short_text" for open text, "number" for a quantity/measurement, "date" for a date field, "signature" for a sign-off line, "file_upload" for an attachment field.
- "departments" is a best guess from the form's subject matter (e.g. a vehicle inspection likely goes to "maintenance"; an HR form to "hr"). Leave it empty if unclear — Dillon will set it by hand either way.
- escalationDepartment/escalationTriggerValue: only set these on a yesno/dropdown/multiselect question where the source form ITSELF marks a clear fail/flag/reject condition (e.g. a pass/fail column, a defect checkbox, an "N/A" that means something needs follow-up). Never guess or invent one on an ordinary field just because a department seems related — leave both null far more often than not. Dillon reviews and can add one by hand either way.
- Respond with ONLY the JSON object.`;

      contentBlocks.push({ type: 'text', text: instructions });

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-5',
          max_tokens: 4000,
          messages: [{ role: 'user', content: contentBlocks }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Anthropic API error (portal draft): ${response.status} ${errText}`);
        return res.status(500).json({ error: "Couldn't read this document. Try again, or start from scratch." });
      }
      const data = await response.json();
      if (data.stop_reason === 'refusal') {
        return res.status(200).json({ error: "The AI declined to read this one. Start from scratch instead — every field is editable." });
      }
      const text = (data.content || []).map(b => b.text || '').join('');
      const a = text.indexOf('{'), b = text.lastIndexOf('}');
      if (a === -1 || b === -1) return res.status(500).json({ error: "Couldn't parse a document structure from that. Start from scratch instead." });
      let draft;
      try {
        draft = JSON.parse(text.slice(a, b + 1));
      } catch (e) {
        return res.status(500).json({ error: "Couldn't parse a document structure from that. Start from scratch instead." });
      }

      // Sanitize the model's output against the same rules publish_document
      // will enforce, so the builder never shows a draft it can't actually
      // publish unedited.
      const departments = Array.isArray(draft.departments) ? draft.departments.filter(d => PORTAL_DEPARTMENTS.includes(d)) : [];
      const questions = Array.isArray(draft.questions) ? draft.questions
        .filter(q => q && typeof q.questionText === 'string' && q.questionText.trim())
        .map(q => {
          const fieldType = PORTAL_FIELD_TYPE_KEYS.includes(q.fieldType) ? q.fieldType : 'short_text';
          const options = Array.isArray(q.options) ? q.options.filter(o => typeof o === 'string' && o.trim()).slice(0, 20) : [];
          // Same rules publish_document enforces (validateQuestions) — a
          // model-proposed escalation the builder couldn't actually publish
          // unedited is worse than no suggestion at all, so drop anything
          // that wouldn't survive it rather than showing it and having
          // Publish reject it later.
          let escalationDepartment = null, escalationTriggerValue = null;
          if (typeof q.escalationDepartment === 'string' && PORTAL_DEPARTMENTS.includes(q.escalationDepartment) && fieldTypeCanEscalate(fieldType)) {
            const trigger = typeof q.escalationTriggerValue === 'string' ? q.escalationTriggerValue.trim() : '';
            if (trigger && (fieldType === 'yesno' ? (trigger === 'yes' || trigger === 'no') : options.includes(trigger))) {
              escalationDepartment = q.escalationDepartment;
              escalationTriggerValue = trigger;
            }
          }
          return {
            questionText: q.questionText.trim().slice(0, 300),
            fieldType, options, escalationDepartment, escalationTriggerValue,
          };
        }) : [];

      return res.status(200).json({
        draft: {
          title: (typeof draft.title === 'string' ? draft.title : '').trim().slice(0, 150) || 'Untitled Document',
          icon: typeof draft.icon === 'string' ? draft.icon.trim().slice(0, 8) : '',
          category: typeof draft.category === 'string' ? draft.category.trim().slice(0, 100) : '',
          departments,
          questions,
        },
      });
    }

    async function distinctCategories() {
      const { data } = await supabaseAdmin.from('portal_documents').select('category').not('category', 'is', null);
      return [...new Set((data || []).map(r => (r.category || '').trim()).filter(Boolean))].sort();
    }

    if (action === 'list_portal_categories') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      return res.status(200).json({ categories: await distinctCategories() });
    }

    if (action === 'list_documents') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin
        .from('portal_documents')
        .select('id, title, icon, category, departments, is_active, created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: 'Could not load documents.' });
      return res.status(200).json({ documents: data || [] });
    }

    // Phase 3's read-only "Portal document library" (FORA Company Portal —
    // Build Spec, "Company Admin" — reframed per Dillon's 2026-09-29 call as
    // any supervisor-tier login, not a new customer-facing admin role: this
    // app has no customer admin, only worker/supervisor logins — see
    // server-lib/docKeyGate.js's comment on why founder-only `admin` is
    // never a customer role). Deliberately separate from `list_documents`
    // above: that one is the founder's builder listing (admin-only, used to
    // decide what's editable); this is a read-only company-scoped view any
    // supervisor can see, same "view only, editing goes through Dillon's
    // builder" boundary the spec draws.
    if (action === 'list_portal_documents_for_dashboard') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin
        .from('portal_documents')
        .select('id, title, icon, category, departments, is_active')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: 'Could not load documents.' });
      return res.status(200).json({ documents: data || [] });
    }

    if (action === 'get_document') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { documentId } = req.body;
      if (!documentId) return res.status(400).json({ error: 'Missing document id.' });
      const { data: docRows, error: docErr } = await supabaseAdmin.from('portal_documents').select('*').eq('id', documentId).limit(1);
      if (docErr || !docRows || docRows.length === 0) return res.status(404).json({ error: 'Document not found.' });
      const { data: questions, error: qErr } = await supabaseAdmin
        .from('portal_questions').select('*').eq('document_id', documentId).order('sort_order', { ascending: true });
      if (qErr) return res.status(500).json({ error: 'Could not load questions.' });
      return res.status(200).json({ document: docRows[0], questions: questions || [] });
    }

    // Creates a new document (no documentId) or replaces an existing one's
    // title/category/departments/questions wholesale (documentId given) —
    // the spec's "re-open it in the builder, change questions or
    // department routing, republish" path. Existing portal_records stay
    // exactly as they were; only new submissions see the republished
    // structure, same as the spec calls for.
    if (action === 'publish_document') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { documentId, companyId, title, icon, category, departments, questions } = req.body;
      if (!title || !String(title).trim()) return res.status(400).json({ error: 'Give this document a title.' });
      if (!validDepartments(departments)) return res.status(400).json({ error: 'Invalid department.' });
      const qErrorMsg = validateQuestions(questions);
      if (qErrorMsg) return res.status(400).json({ error: qErrorMsg });

      let docId = documentId;
      if (docId) {
        const { data: existing, error: findErr } = await supabaseAdmin.from('portal_documents').select('id').eq('id', docId).limit(1);
        if (findErr || !existing || existing.length === 0) return res.status(404).json({ error: 'Document not found.' });
        const { error: updErr } = await supabaseAdmin.from('portal_documents').update({
          title: String(title).trim(), icon: icon || null, category: category ? String(category).trim() : null,
          departments,
        }).eq('id', docId);
        if (updErr) return res.status(500).json({ error: "Couldn't update document." });
        // Wholesale question replacement — simplest correct behavior for a
        // builder that edits the whole list at once. A document with
        // existing portal_records keeps them (portal_answers.question_id
        // still points at whichever question rows existed at submit time,
        // and old rows are only deleted here, not reused), so old answers
        // remain readable against the question text/type they were
        // actually answered against even after a republish changes the
        // live set.
        const { error: delErr } = await supabaseAdmin.from('portal_questions').delete().eq('document_id', docId);
        if (delErr) return res.status(500).json({ error: "Couldn't update questions." });
      } else {
        if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
        const { data: created, error: createErr } = await supabaseAdmin.from('portal_documents').insert({
          company_id: companyId, title: String(title).trim(), icon: icon || null,
          category: category ? String(category).trim() : null, departments, is_active: true,
        }).select('id').single();
        if (createErr) return res.status(500).json({ error: "Couldn't create document." });
        docId = created.id;
      }

      const rows = questions.map((q, i) => ({
        document_id: docId,
        question_text: q.questionText.trim(),
        field_type: q.fieldType,
        options: fieldTypeNeedsOptions(q.fieldType) ? q.options.filter(o => (o || '').trim()) : null,
        sort_order: i,
        escalation_department: q.escalationDepartment || null,
        escalation_trigger_value: q.escalationDepartment ? String(q.escalationTriggerValue).trim() : null,
      }));
      const { error: insErr } = await supabaseAdmin.from('portal_questions').insert(rows);
      if (insErr) return res.status(500).json({ error: "Couldn't save questions." });

      return res.status(200).json({ ok: true, documentId: docId });
    }

    if (action === 'toggle_document') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { documentId, isActive } = req.body;
      if (!documentId) return res.status(400).json({ error: 'Missing document id.' });
      const { error } = await supabaseAdmin.from('portal_documents').update({ is_active: !!isActive }).eq('id', documentId);
      if (error) return res.status(500).json({ error: "Couldn't update document." });
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete_document') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { documentId } = req.body;
      if (!documentId) return res.status(400).json({ error: 'Missing document id.' });
      const { data: records, error: recErr } = await supabaseAdmin.from('portal_records').select('id').eq('document_id', documentId).limit(1);
      if (recErr) return res.status(500).json({ error: 'Could not check submissions.' });
      if (records && records.length > 0) {
        return res.status(400).json({ error: "Couldn't delete: this document already has submitted records." });
      }
      await supabaseAdmin.from('portal_questions').delete().eq('document_id', documentId);
      const { error } = await supabaseAdmin.from('portal_documents').delete().eq('id', documentId);
      if (error) return res.status(500).json({ error: "Couldn't delete document." });
      return res.status(200).json({ ok: true });
    }

    // ══ WORKER: submission ═══════════════════════════════════════════════

    // Not yet department- or assignment-scoped (phase 3/4) — every active
    // document for the company is shown to every worker, same interim
    // behavior custom_forms already has.
    if (action === 'get_worker_portal_documents') {
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { data, error } = await supabaseAdmin
        .from('portal_documents')
        .select('id, title, icon')
        .eq('company_id', session.companyId)
        .eq('is_active', true)
        .order('created_at', { ascending: true });
      if (error) return res.status(500).json({ error: 'Could not load documents.' });
      return res.status(200).json({ documents: data || [] });
    }

    if (action === 'get_active_portal_document') {
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { siteId, documentId } = req.body;
      if (!siteId || !documentId) return res.status(400).json({ error: 'Missing details.' });

      const { data: siteRows } = await supabaseAdmin.from('sites').select('id, company_id').eq('id', siteId).limit(1);
      if (!siteRows || siteRows.length === 0 || siteRows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed for this site.' });
      }
      const { data: docRows } = await supabaseAdmin.from('portal_documents').select('*').eq('id', documentId).limit(1);
      const document = docRows && docRows[0];
      if (!document || document.company_id !== session.companyId || !document.is_active) {
        return res.status(404).json({ error: 'This document is not available.' });
      }
      const { data: questions, error: qErr } = await supabaseAdmin
        .from('portal_questions').select('*').eq('document_id', documentId).order('sort_order', { ascending: true });
      if (qErr) return res.status(500).json({ error: 'Could not load questions.' });
      return res.status(200).json({ document, questions: questions || [] });
    }

    // Signed upload URL for a signature/file_upload answer, or the final
    // generated PDF — same signed-upload-token pattern as
    // api/customforms.js's create_upload_url, just against the two Portal
    // buckets instead of flha-reports.
    if (action === 'create_portal_upload_url') {
      const { bucket, filename, companyId } = req.body;
      if (bucket !== 'portal-attachments' && bucket !== 'flha-reports') {
        return res.status(400).json({ error: 'Invalid bucket.' });
      }
      const scopeCompanyId = resolveCompanyId(session, companyId) || session.companyId;
      const result = await createUploadUrl(supabaseAdmin, bucket, filename, scopeCompanyId);
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true, path: result.path, uploadToken: result.uploadToken, receipt: result.receipt });
    }

    if (action === 'submit_portal') {
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { data: coRows } = await supabaseAdmin.from('companies').select('suspended').eq('id', session.companyId).limit(1);
      if (coRows && coRows[0] && coRows[0].suspended) {
        return res.status(403).json({ error: "Your company's access is suspended. Contact your administrator." });
      }
      const { siteId, documentId, answers, submittedBy, aiSummary, aiAssisted, pdfUrl, clientSubmissionId } = req.body;
      const resolvedPdfUrl = storedUrlFromClientReceipt(pdfUrl, session.companyId);
      const pdfLinked = !receiptWasDropped(pdfUrl, resolvedPdfUrl);
      if (!siteId || !documentId || !Array.isArray(answers) || !submittedBy) {
        return res.status(400).json({ error: 'Missing details.' });
      }

      const { data: siteRows } = await supabaseAdmin.from('sites').select('id, company_id').eq('id', siteId).limit(1);
      if (!siteRows || siteRows.length === 0 || siteRows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed for this site.' });
      }
      const { data: docRows } = await supabaseAdmin.from('portal_documents').select('id, company_id, title, is_active, departments').eq('id', documentId).limit(1);
      if (!docRows || docRows.length === 0 || docRows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed for this document.' });
      }
      if (!docRows[0].is_active) {
        return res.status(403).json({ error: 'This document has been switched off for your company.' });
      }

      if (clientSubmissionId) {
        const { data: existingRows } = await supabaseAdmin
          .from('portal_records').select('id').eq('document_id', documentId).eq('client_submission_id', clientSubmissionId).limit(1);
        if (existingRows && existingRows.length > 0) return res.status(200).json({ id: existingRows[0].id });
      }

      const { data: record, error: recErr } = await supabaseAdmin
        .from('portal_records')
        .insert({
          document_id: documentId, site_id: siteId, submitted_by: submittedBy,
          submitted_by_roster_id: authorRosterId(session),
          ai_summary: aiSummary || null, pdf_url: resolvedPdfUrl, status: 'complete',
          client_submission_id: clientSubmissionId || null,
        })
        .select().single();
      if (recErr) {
        if (recErr.code === '23505' && clientSubmissionId) {
          const { data: raceRows } = await supabaseAdmin
            .from('portal_records').select('id').eq('document_id', documentId).eq('client_submission_id', clientSubmissionId).limit(1);
          if (raceRows && raceRows.length > 0) return res.status(200).json({ id: raceRows[0].id });
        }
        return res.status(500).json({ error: 'Save failed. Try again.' });
      }

      // Only ever accept an answer whose question actually belongs to this
      // document — same guard as api/customforms.js's submit_custom.
      const { data: docQuestions } = await supabaseAdmin.from('portal_questions').select('id, field_type, question_text, escalation_department, escalation_trigger_value').eq('document_id', documentId);
      const questionById = new Map((docQuestions || []).map(q => [String(q.id), q]));

      for (const a of answers) {
        const q = questionById.get(String(a.questionId));
        if (!q) continue;
        const row = { record_id: record.id, question_id: a.questionId, notes: a.note || null };
        if (q.field_type === 'multiselect') {
          row.value_json = Array.isArray(a.value) ? a.value : [];
        } else if (q.field_type === 'signature' || q.field_type === 'file_upload') {
          row.file_url = storedUrlFromClientReceipt(a.value, session.companyId, 'portal-attachments');
        } else {
          row.value_text = a.value != null ? String(a.value).slice(0, 2000) : null;
        }
        await supabaseAdmin.from('portal_answers').insert(row);

        // Phase 5: question-level escalation. A narrow, separate record —
        // never the whole document — spun off to a different department
        // when this specific answer matches the question's configured
        // trigger. Snapshots question_text/answer_value at creation time
        // rather than joining live, because publish_document's
        // wholesale-replace on a republish can delete the question row out
        // from under an escalation raised against an earlier version (see
        // the phase 5 migration's header comment). Best-effort like the
        // submission email below — the record and its answers are already
        // saved either way, so a failure here must not fail the submission.
        if (q.escalation_department && q.escalation_trigger_value) {
          const matches = q.field_type === 'multiselect'
            ? Array.isArray(a.value) && a.value.includes(q.escalation_trigger_value)
            : String(a.value) === q.escalation_trigger_value;
          if (matches) {
            let escalationInserted = false;
            try {
              await supabaseAdmin.from('portal_escalations').insert({
                record_id: record.id, document_id: documentId, question_id: q.id,
                question_text: q.question_text, answer_value: String(a.value),
                target_department: q.escalation_department, status: 'open',
              });
              escalationInserted = true;
            } catch (e) {
              console.error('portal escalation insert failed:', e.message);
            }

            // Break #34 fix: an escalation is meant to reach a DIFFERENT
            // department than the one that already got the phase-3
            // submission email below, so it needs its own notification
            // keyed on the escalation's own target_department rather than
            // the document's departments. Same best-effort, non-blocking
            // posture as every other side effect in this handler — a send
            // failure must never affect the already-saved escalation row,
            // so this only runs (and only logs on failure) after the
            // insert above has actually succeeded.
            if (escalationInserted) {
              try {
                const { data: escRecipients } = await supabaseAdmin
                  .from('roster')
                  .select('email, departments')
                  .eq('company_id', session.companyId)
                  .eq('role', 'supervisor')
                  .eq('active', true)
                  .not('email', 'is', null);
                const escToAddresses = [...new Set(
                  (escRecipients || [])
                    .filter(r => (r.departments || []).includes(q.escalation_department))
                    .map(r => withDecryptedEmail(r).email)
                    .filter(Boolean)
                )];
                if (escToAddresses.length > 0) {
                  await sendEmail({
                    to: escToAddresses,
                    subject: `Escalation: ${q.question_text}`,
                    text: `An answer to "${q.question_text}" on "${docRows[0].title}" was flagged for escalation to your department.\n\nLog in to FORA to view it.`,
                  });
                }
              } catch (e) {
                console.error('portal escalation email failed:', e.message);
              }
            }
          }
        }
      }

      // Phase 3: "email fires on submission" (build spec, "Build order").
      // Best-effort and non-blocking, same posture as every other email in
      // this app (api/companydata.js's onboard_new_employee) — a send
      // failure must never undo or fail the submission that already saved.
      // Recipients are every active supervisor-tier roster member holding
      // one of this document's routed department(s), same population the
      // department-scoped dashboard above shows this document to. Silently
      // sends nothing when the document has no departments set, or nobody
      // in them has an email on file — there is no "everyone" fallback,
      // since a document with no department is also invisible to every
      // individually-identified supervisor's Portal Inbox.
      if ((docRows[0].departments || []).length > 0) {
        try {
          const { data: recipients } = await supabaseAdmin
            .from('roster')
            .select('email, departments')
            .eq('company_id', session.companyId)
            .eq('role', 'supervisor')
            .eq('active', true)
            .not('email', 'is', null);
          const toAddresses = [...new Set(
            (recipients || [])
              .filter(r => (r.departments || []).some(dep => docRows[0].departments.includes(dep)))
              .map(r => withDecryptedEmail(r).email)
              .filter(Boolean)
          )];
          if (toAddresses.length > 0) {
            await sendEmail({
              to: toAddresses,
              subject: `New submission: ${docRows[0].title}`,
              text: `${submittedBy} just submitted "${docRows[0].title}".\n\nLog in to FORA to view it.`,
            });
          }
        } catch (e) {
          console.error('portal submission email failed:', e.message);
        }
      }

      return res.status(200).json({ id: record.id, pdfLinked });
    }

    // ══ SUPERVISOR / ADMIN: viewing submissions ═════════════════════════
    // Wired into Dashboard.jsx's Portal tab (phase 3). These two actions
    // are department-scoped for a supervisor session, same shape as
    // api/customforms.js's list_records/get_record_detail.

    if (action === 'list_portal_records') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      let docsQuery = supabaseAdmin.from('portal_documents').select('id, company_id, title, icon, departments');
      if (session.role === 'supervisor') docsQuery = docsQuery.eq('company_id', session.companyId);
      const { data: documents, error: docsErr } = await docsQuery;
      if (docsErr) return res.status(500).json({ error: 'Could not load documents.' });

      // Department-scoped dashboard (phase 3, FORA Company Portal — Build
      // Spec's "Role-based dashboards"). An individually-identified
      // supervisor (a real roster row, session.userId) sees only documents
      // routed to a department their own row holds — a supervisor holding
      // every department therefore sees everything, which is the "Company
      // Admin" behavior the spec describes, without a new role (2026-09-29
      // decision — this app has no customer admin login, only
      // worker/supervisor, see server-lib/docKeyGate.js). A shared-code
      // supervisor login (no per-person roster row — pre-cutover companies)
      // has no individual departments to scope by, so it falls back to
      // unfiltered, same as every other document type already shows it.
      let visibleDocuments = documents || [];
      if (session.role === 'supervisor' && session.userId) {
        const { data: rosterRows } = await supabaseAdmin.from('roster').select('departments').eq('id', session.userId).limit(1);
        const myDepartments = rosterRows?.[0]?.departments || [];
        visibleDocuments = visibleDocuments.filter(d => (d.departments || []).some(dep => myDepartments.includes(dep)));
      }

      const docIds = visibleDocuments.map(d => d.id);
      if (docIds.length === 0) return res.status(200).json({ records: [] });

      const { data: records, error: recErr } = await supabaseAdmin
        .from('portal_records').select('*').in('document_id', docIds).order('created_at', { ascending: false });
      if (recErr) return res.status(500).json({ error: 'Could not load records.' });

      const siteIds = [...new Set((records || []).map(r => r.site_id))];
      const { data: sites } = await supabaseAdmin.from('sites').select('id, name').in('id', siteIds.length ? siteIds : [0]);
      const siteMap = {}; (sites || []).forEach(s => { siteMap[s.id] = s.name; });
      const docMap = {}; visibleDocuments.forEach(d => { docMap[d.id] = d; });

      const signedRecords = await signRows(supabaseAdmin, records, [{ key: 'pdf_url', bucket: 'flha-reports' }]);
      const enriched = signedRecords.map(r => ({
        ...r, site_name: siteMap[r.site_id] || 'Unknown site',
        document_title: docMap[r.document_id]?.title || 'Unknown document',
        document_icon: docMap[r.document_id]?.icon || '📄',
        company_id: docMap[r.document_id]?.company_id,
      }));
      return res.status(200).json({ records: enriched });
    }

    if (action === 'get_portal_record_detail') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { recordId } = req.body;
      if (!recordId) return res.status(400).json({ error: 'Missing record id.' });

      const { data: recordRows, error: recErr } = await supabaseAdmin.from('portal_records').select('*').eq('id', recordId).limit(1);
      if (recErr || !recordRows || recordRows.length === 0) return res.status(404).json({ error: 'Record not found.' });
      const record = { ...recordRows[0], pdf_url: await signStoredUrl(recordRows[0].pdf_url, 'flha-reports') };

      const { data: docRows } = await supabaseAdmin.from('portal_documents').select('id, company_id, title, icon, departments').eq('id', record.document_id).limit(1);
      const document = docRows && docRows[0];
      if (!document) return res.status(404).json({ error: 'Document not found.' });
      if (session.role === 'supervisor' && document.company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });
      // Same department scoping as list_portal_records — a saved link must
      // not reach into a record outside a supervisor's own department(s).
      // Same generic message as the cross-company check above: a distinct
      // message here would let a supervisor tell "exists, wrong company"
      // apart from "exists, same company, wrong department" purely from
      // error text (tenant-scope-reviewer finding, 2026-09-29).
      if (session.role === 'supervisor' && session.userId) {
        const { data: rosterRows } = await supabaseAdmin.from('roster').select('departments').eq('id', session.userId).limit(1);
        const myDepartments = rosterRows?.[0]?.departments || [];
        if (!(document.departments || []).some(dep => myDepartments.includes(dep))) {
          return res.status(403).json({ error: 'Not allowed.' });
        }
      }

      const { data: siteRows } = await supabaseAdmin.from('sites').select('id, name').eq('id', record.site_id).limit(1);
      const { data: answers, error: ansErr } = await supabaseAdmin.from('portal_answers').select('*').eq('record_id', recordId);
      if (ansErr) return res.status(500).json({ error: 'Could not load answers.' });
      const signedAnswers = await signRows(supabaseAdmin, answers, [{ key: 'file_url', bucket: 'portal-attachments' }]);

      const { data: questions } = await supabaseAdmin.from('portal_questions').select('id, question_text, field_type, sort_order').eq('document_id', record.document_id).order('sort_order', { ascending: true });
      const questionMap = {}; (questions || []).forEach(q => { questionMap[q.id] = q; });

      const items = signedAnswers
        .map(a => ({ ...a, question_text: questionMap[a.question_id]?.question_text || 'Unknown question', field_type: questionMap[a.question_id]?.field_type, sort_order: questionMap[a.question_id]?.sort_order ?? 0 }))
        .sort((a, b) => a.sort_order - b.sort_order);

      return res.status(200).json({ record, document, site: siteRows && siteRows[0], items });
    }

    // ══ ADMIN (founder-only): assignment rules ═══════════════════════════
    // Phase 4 (assignment + compliance). Building a document stays
    // founder-only, but WHO has to complete it is a supervisor's call (their
    // people, their departments), so the three rule actions below are open
    // to a supervisor too, scoped to their own company and, for an
    // individually-identified supervisor, to documents routed to their own
    // department(s) (the same rule get_assignment_rollup applies). See
    // server-lib/portalAssignments.js for the materialization logic.

    // Loads the document and answers "may this session manage its
    // assignment rules?". An admin may manage any document. A supervisor
    // needs the document to be in their own company and, when they are an
    // individually-identified supervisor, to share a department with it.
    async function loadManageableDocument(documentId) {
      const { data: docRows } = await supabaseAdmin
        .from('portal_documents').select('id, company_id, departments').eq('id', documentId).limit(1);
      const doc = docRows && docRows[0];
      if (!doc) return { status: 404, error: 'Document not found.' };
      if (session.role === 'admin') return { doc };
      if (doc.company_id !== session.companyId) return { status: 403, error: 'Not allowed.' };
      if (session.userId) {
        const { data: me } = await supabaseAdmin.from('roster').select('departments').eq('id', session.userId).eq('company_id', session.companyId).limit(1);
        const mine = (me && me[0] && me[0].departments) || [];
        if (!(doc.departments || []).some(dep => mine.includes(dep))) return { status: 403, error: 'Not allowed.' };
      }
      return { doc };
    }

    if (action === 'list_assignment_rules') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { documentId } = req.body;
      if (!documentId) return res.status(400).json({ error: 'Missing document id.' });
      const scope = await loadManageableDocument(documentId);
      if (scope.error) return res.status(scope.status).json({ error: scope.error });
      const { data, error } = await supabaseAdmin.from('portal_assignment_rules').select('*').eq('document_id', documentId).order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: 'Could not load assignment rules.' });
      return res.status(200).json({ rules: data || [] });
    }

    if (action === 'create_assignment_rule') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { documentId, targetType, targetRole, targetRosterId, dueDays, autoApplyNewHires } = req.body;
      if (!documentId) return res.status(400).json({ error: 'Missing document id.' });
      const scope = await loadManageableDocument(documentId);
      if (scope.error) return res.status(scope.status).json({ error: scope.error });
      if (!['everyone', 'role', 'individual'].includes(targetType)) return res.status(400).json({ error: 'Invalid target.' });
      if (targetType === 'role' && targetRole !== 'worker' && targetRole !== 'supervisor') {
        return res.status(400).json({ error: 'Invalid role.' });
      }
      if (targetType === 'individual' && !targetRosterId) {
        return res.status(400).json({ error: 'Pick a person.' });
      }
      if (dueDays !== null && dueDays !== undefined && dueDays !== '' && !(Number.isInteger(Number(dueDays)) && Number(dueDays) >= 0 && Number(dueDays) <= 365)) {
        return res.status(400).json({ error: 'Due days must be a whole number from 0 to 365.' });
      }
      // Not a tenant-isolation gap (applyRuleToExistingRoster below always
      // re-scopes to the document's own company, so a mismatched id just
      // matches nobody) — but worth catching here so a rule naming the
      // wrong company's roster row fails loudly instead of silently never
      // assigning anyone (tenant-scope-reviewer finding, 2026-09-29).
      if (targetType === 'individual') {
        const { data: docForRoster } = await supabaseAdmin.from('portal_documents').select('company_id').eq('id', documentId).limit(1);
        const { data: rosterForRule } = await supabaseAdmin.from('roster').select('company_id').eq('id', targetRosterId).limit(1);
        if (!docForRoster?.[0] || !rosterForRule?.[0] || docForRoster[0].company_id !== rosterForRule[0].company_id) {
          return res.status(400).json({ error: 'That person is not on this document\'s company roster.' });
        }
      }
      const { data: rule, error } = await supabaseAdmin
        .from('portal_assignment_rules')
        .insert({
          document_id: documentId, target_type: targetType,
          target_role: targetType === 'role' ? targetRole : null,
          target_roster_id: targetType === 'individual' ? targetRosterId : null,
          due_days: (dueDays === null || dueDays === undefined || dueDays === '') ? null : Number(dueDays),
          auto_apply_new_hires: autoApplyNewHires !== false,
        })
        .select().single();
      if (error) return res.status(500).json({ error: "Couldn't create assignment rule." });

      // Materialize against the company's CURRENT roster right away — see
      // server-lib/portalAssignments.js. Best-effort: the rule itself is
      // already saved either way.
      try { await applyRuleToExistingRoster(supabaseAdmin, rule); } catch (e) { console.error('applyRuleToExistingRoster failed:', e.message); }

      return res.status(200).json({ ok: true, rule });
    }

    if (action === 'delete_assignment_rule') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { ruleId } = req.body;
      if (!ruleId) return res.status(400).json({ error: 'Missing rule id.' });
      const { data: ruleRows } = await supabaseAdmin.from('portal_assignment_rules').select('document_id').eq('id', ruleId).limit(1);
      if (!ruleRows || !ruleRows[0]) return res.status(404).json({ error: 'Rule not found.' });
      const scope = await loadManageableDocument(ruleRows[0].document_id);
      if (scope.error) return res.status(scope.status).json({ error: scope.error });
      // Deleting a rule does not retract assignments it already created —
      // someone already told to complete a document should not have that
      // silently vanish because the rule that generated it was removed;
      // portal_assignments.rule_id just goes null (on delete set null).
      const { error } = await supabaseAdmin.from('portal_assignment_rules').delete().eq('id', ruleId);
      if (error) return res.status(500).json({ error: "Couldn't delete assignment rule." });
      return res.status(200).json({ ok: true });
    }

    // ══ SUPERVISOR / ADMIN: assignment rollup ════════════════════════════
    // "Per-person completion tracking, rollup view" (build spec). Status
    // is computed here, not stored — see the migration's header comment.
    // Department-scoped the same way list_portal_records is: an
    // individually-identified supervisor sees only assignments for
    // documents routed to their own department(s); a shared-code
    // supervisor falls back to unfiltered-within-company.
    if (action === 'get_assignment_rollup') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      let docsQuery = supabaseAdmin.from('portal_documents').select('id, company_id, title, departments');
      if (session.role === 'supervisor') docsQuery = docsQuery.eq('company_id', session.companyId);
      const { data: documents, error: docsErr } = await docsQuery;
      if (docsErr) return res.status(500).json({ error: 'Could not load documents.' });

      let visibleDocuments = documents || [];
      if (session.role === 'supervisor' && session.userId) {
        const { data: rosterRows } = await supabaseAdmin.from('roster').select('departments').eq('id', session.userId).limit(1);
        const myDepartments = rosterRows?.[0]?.departments || [];
        visibleDocuments = visibleDocuments.filter(d => (d.departments || []).some(dep => myDepartments.includes(dep)));
      }
      const docIds = visibleDocuments.map(d => d.id);
      if (docIds.length === 0) return res.status(200).json({ rows: [] });
      const docMap = {}; visibleDocuments.forEach(d => { docMap[d.id] = d; });

      const { data: assignments, error: asgErr } = await supabaseAdmin
        .from('portal_assignments').select('*').in('document_id', docIds).order('due_at', { ascending: true, nullsFirst: false });
      if (asgErr) return res.status(500).json({ error: 'Could not load assignments.' });
      if (!assignments || assignments.length === 0) return res.status(200).json({ rows: [] });

      const rosterIds = [...new Set(assignments.map(a => a.roster_id))];
      const { data: rosterRows } = await supabaseAdmin.from('roster').select('id, name, active').in('id', rosterIds);
      const rosterMap = {}; (rosterRows || []).forEach(r => { rosterMap[r.id] = r; });

      // A submission satisfies the assignment when it's the same document
      // and person, submitted any time at or after the assignment was
      // created — there is no other link between a portal_records row and
      // the assignment that asked for it.
      const { data: records } = await supabaseAdmin
        .from('portal_records').select('document_id, submitted_by_roster_id, created_at').in('document_id', docIds);
      const submittedAt = (documentId, rosterId, since) => {
        const hit = (records || [])
          .filter(r => r.document_id === documentId && r.submitted_by_roster_id === rosterId && new Date(r.created_at) >= new Date(since))
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
        return hit ? hit.created_at : null;
      };

      const now = new Date();
      const rows = assignments
        .filter(a => rosterMap[a.roster_id]?.active)
        .map(a => {
          const completedAt = submittedAt(a.document_id, a.roster_id, a.created_at);
          const status = completedAt ? 'submitted' : (a.due_at && new Date(a.due_at) < now ? 'overdue' : 'not_started');
          return {
            id: a.id, document_id: a.document_id, document_title: docMap[a.document_id]?.title || 'Unknown document',
            company_id: docMap[a.document_id]?.company_id,
            roster_id: a.roster_id, roster_name: rosterMap[a.roster_id]?.name || 'Unknown',
            due_at: a.due_at, status, completed_at: completedAt,
          };
        });
      return res.status(200).json({ rows });
    }

    // ══ SUPERVISOR / ADMIN: escalations ══════════════════════════════════
    // Phase 5 (question-level escalation). Deliberately NOT scoped by the
    // source document's own departments() — that's the whole point of an
    // escalation: it can route to a DIFFERENT department than the document
    // it came from (spec's Maintenance-from-a-Safety-inspection example).
    // Scoped instead by portal_escalations.target_department directly,
    // same individually-identified-supervisor-vs-shared-code-login split as
    // every other Portal read above.

    if (action === 'list_escalations') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { status } = req.body;

      let escQuery = supabaseAdmin.from('portal_escalations').select('*').order('created_at', { ascending: false });
      if (status === 'open' || status === 'actioned') escQuery = escQuery.eq('status', status);
      const { data: escalations, error: escErr } = await escQuery;
      if (escErr) return res.status(500).json({ error: 'Could not load escalations.' });
      if (!escalations || escalations.length === 0) return res.status(200).json({ escalations: [] });

      const docIds = [...new Set(escalations.map(e => e.document_id))];
      const { data: documents } = await supabaseAdmin.from('portal_documents').select('id, company_id, title, icon').in('id', docIds);
      const docMap = {}; (documents || []).forEach(d => { docMap[d.id] = d; });

      let visible = escalations.filter(e => {
        const doc = docMap[e.document_id];
        if (!doc) return false;
        if (session.role === 'supervisor' && doc.company_id !== session.companyId) return false;
        return true;
      });

      if (session.role === 'supervisor' && session.userId) {
        const { data: rosterRows } = await supabaseAdmin.from('roster').select('departments').eq('id', session.userId).limit(1);
        const myDepartments = rosterRows?.[0]?.departments || [];
        visible = visible.filter(e => myDepartments.includes(e.target_department));
      }

      const recordIds = [...new Set(visible.map(e => e.record_id))];
      const { data: records } = await supabaseAdmin.from('portal_records').select('id, site_id, submitted_by, created_at').in('id', recordIds.length ? recordIds : [0]);
      const recordMap = {}; (records || []).forEach(r => { recordMap[r.id] = r; });
      const siteIds = [...new Set((records || []).map(r => r.site_id))];
      const { data: sites } = await supabaseAdmin.from('sites').select('id, name').in('id', siteIds.length ? siteIds : [0]);
      const siteMap = {}; (sites || []).forEach(s => { siteMap[s.id] = s.name; });

      const enriched = visible.map(e => ({
        ...e,
        document_title: docMap[e.document_id]?.title || 'Unknown document',
        document_icon: docMap[e.document_id]?.icon || '📄',
        company_id: docMap[e.document_id]?.company_id,
        submitted_by: recordMap[e.record_id]?.submitted_by || 'Unknown',
        site_name: siteMap[recordMap[e.record_id]?.site_id] || 'Unknown site',
        submitted_at: recordMap[e.record_id]?.created_at,
      }));
      return res.status(200).json({ escalations: enriched });
    }

    if (action === 'action_escalation') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { escalationId } = req.body;
      if (!escalationId) return res.status(400).json({ error: 'Missing escalation id.' });

      const { data: escRows } = await supabaseAdmin.from('portal_escalations').select('*').eq('id', escalationId).limit(1);
      const escalation = escRows && escRows[0];
      if (!escalation) return res.status(404).json({ error: 'Escalation not found.' });

      const { data: docRows } = await supabaseAdmin.from('portal_documents').select('company_id').eq('id', escalation.document_id).limit(1);
      const document = docRows && docRows[0];
      if (!document) return res.status(404).json({ error: 'Document not found.' });
      // Same generic 403 as every other cross-tenant/cross-department check
      // above — a distinct message would leak existence/department info.
      if (session.role === 'supervisor' && document.company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });
      if (session.role === 'supervisor' && session.userId) {
        const { data: rosterRows } = await supabaseAdmin.from('roster').select('departments').eq('id', session.userId).limit(1);
        const myDepartments = rosterRows?.[0]?.departments || [];
        if (!myDepartments.includes(escalation.target_department)) return res.status(403).json({ error: 'Not allowed.' });
      }

      const { error: updErr } = await supabaseAdmin.from('portal_escalations').update({
        status: 'actioned', actioned_by_roster_id: authorRosterId(session), actioned_at: new Date().toISOString(),
      }).eq('id', escalationId);
      if (updErr) return res.status(500).json({ error: "Couldn't update escalation." });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    console.error('portal handler failed:', e.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
