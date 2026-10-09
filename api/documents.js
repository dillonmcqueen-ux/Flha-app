// api/documents.js
// The unified document engine's API (work package 2 of
// docs/unified-document-engine-phase1-plan.md). Definitions, versions,
// per-company switches, records, signatures and review.
//
// Thin on purpose: the rules live in server-lib/documentEngine/ so they can
// be tested without a server. This file does three things only: verify the
// session, decide which company the call is about, and map errors to HTTP.
//
// Nothing in the app calls this yet. It ships dormant until the builder and
// worker form (WP6, WP7) are wired to it, and the tables behind it are empty.
//
// Access:
//   - Builder actions (definitions, drafts, publish, per-company switches)
//     are founder only (session.role === 'admin'), like api/portal.js.
//   - Worker actions use the session's own company. A body companyId is
//     honoured ONLY for a founder session; for anyone else it is ignored.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { sessionExpired } from '../server-lib/sessionTtl.js';
import { createUploadUrl, resolveUploadReceipt } from '../server-lib/uploadUrls.js';
import { resolveSiteId } from '../server-lib/siteScope.js';
import { sendEmail } from '../server-lib/email.js';
import { canManageCompany } from '../server-lib/ownerAccess.js';
import {
  EngineError,
  createDefinition,
  cloneTemplate,
  saveDraft,
  publishDraft,
  setCompanyDocument,
  listCompanyDocuments,
  getDefinitionForBuilder,
  getDocumentForWorker,
  listWorkerDocuments,
  submitRecord,
  resubmitRecord,
  signNow,
  getRecord,
  getRecordLinks,
  listRecords,
  reviewRecord,
  myInbox,
  listEscalations,
  actionEscalation,
  setOwnerMute,
} from '../server-lib/documentEngine/service.js';
import { ENGINE_FIELD_TYPES, ENGINE_RULE_TYPES } from '../server-lib/documentEngine/fieldTypes.js';
import { signTargets } from '../server-lib/documentEngine/links.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Same construction as every other api/*.js session check, duplicated rather
// than shared per this codebase's existing convention.
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
  if (sessionExpired(payload)) return null;
  // A login TICKET (purpose: 'roster' | 'master') is not a session.
  if (payload.purpose) return null;
  if (payload.role === 'admin') return payload;
  if (!payload.userId) return payload.founder === true ? payload : null;
  const { data: rows, error } = await supabaseAdmin
    .from('roster')
    .select('active, role, company_id, name, is_owner')
    .eq('id', payload.userId)
    .limit(1);
  if (error || !rows || rows.length === 0 || !rows[0].active) return null;
  if (rows[0].company_id !== payload.companyId) return null;
  // An auditor reads through api/audit.js only. Every other endpoint treats
  // an auditor session as no session at all.
  if (rows[0].role === 'auditor') return null;
  // isOwner comes from the roster row, never the token, so a demoted Owner
  // loses it on their next request.
  return { ...payload, role: rows[0].role, name: rows[0].name, isOwner: rows[0].is_owner === true };
}

// The company a call is about. A founder names it in the body; everyone else
// gets their own, whatever the body says.
function companyFor(session, body) {
  if (session.role === 'admin') return body.companyId != null ? Number(body.companyId) : null;
  return session.companyId != null ? Number(session.companyId) : null;
}

const UPLOAD_BUCKETS = {
  pdf: 'flha-reports',
  signature: 'signatures',
  attachment: 'portal-attachments',
};

// Which bucket a receipt must have been issued for, from what it is used as.
function bucketFor(field) {
  const t = field && field.field_type;
  if (t === 'pdf') return UPLOAD_BUCKETS.pdf;
  if (t === 'signature') return UPLOAD_BUCKETS.signature;
  return UPLOAD_BUCKETS.attachment;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const { action, token } = body;
  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  const founder = session.role === 'admin';
  const companyId = companyFor(session, body);
  const db = supabaseAdmin;
  const deps = {
    resolveFile: (value, field) => resolveUploadReceipt(value, bucketFor(field), companyId),
    resolveSiteId: (raw) => resolveSiteId(db, companyId, raw),
    // Without the mail key nothing is sent, like server-lib/notifyAudience.js.
    sendEmail: process.env.RESEND_API_KEY ? sendEmail : null,
  };

  try {
    // ══ Builder (founder only) ═══════════════════════════════════════════
    const builderActions = [
      'engine_info', 'list_company_documents', 'create_definition', 'clone_template',
      'get_definition', 'save_draft', 'publish', 'set_company_document',
    ];
    if (builderActions.includes(action) && !founder) return res.status(403).json({ error: 'Not allowed.' });

    // A FORA template is edited by naming scope 'template' and no company.
    // A missing company alone is never read as "template": forgetting the
    // company on a save would otherwise change the live form for every
    // company that has the template switched on.
    const templateActions = ['create_definition', 'get_definition', 'save_draft', 'publish'];
    if (templateActions.includes(action)) {
      if (companyId == null && body.scope !== 'template') return res.status(400).json({ error: 'Name a company, or set scope to template.' });
      if (companyId != null && body.scope === 'template') return res.status(400).json({ error: 'A template edit cannot also name a company.' });
    }

    if (action === 'engine_info') {
      return res.status(200).json({ fieldTypes: ENGINE_FIELD_TYPES, ruleTypes: ENGINE_RULE_TYPES });
    }
    if (action === 'list_company_documents') {
      return res.status(200).json(await listCompanyDocuments(db, { companyId }));
    }
    if (action === 'create_definition') {
      // No company named means a FORA template.
      const out = await createDefinition(db, { companyId, title: body.title, icon: body.icon, category: body.category, key: body.key });
      return res.status(200).json({ ok: true, ...out });
    }
    if (action === 'clone_template') {
      const out = await cloneTemplate(db, { companyId, templateId: body.templateId });
      return res.status(200).json({ ok: true, ...out });
    }
    if (action === 'get_definition') {
      return res.status(200).json(await getDefinitionForBuilder(db, { companyId, definitionId: body.definitionId }));
    }
    if (action === 'save_draft') {
      const out = await saveDraft(db, { companyId, definitionId: body.definitionId, title: body.title, fields: body.fields, layout: body.layout, rules: body.rules });
      return res.status(200).json({ ok: true, ...out });
    }
    if (action === 'publish') {
      const out = await publishDraft(db, { companyId, definitionId: body.definitionId });
      return res.status(200).json({ ok: true, ...out });
    }
    if (action === 'set_company_document') {
      const out = await setCompanyDocument(db, {
        companyId, definitionId: body.definitionId, isEnabled: body.isEnabled, brainEnabled: body.brainEnabled, ownerMuted: body.ownerMuted,
      });
      return res.status(200).json({ ok: true, setting: out });
    }

    // ══ Everyone signed in ═══════════════════════════════════════════════
    // A company is required from here on. A founder who names none gets a 400.
    if (companyId == null) return res.status(400).json({ error: 'Missing company id.' });

    if (action === 'list_worker_documents') {
      return res.status(200).json(await listWorkerDocuments(db, { companyId }));
    }
    if (action === 'get_document') {
      return res.status(200).json(await getDocumentForWorker(db, { companyId, definitionId: body.definitionId }));
    }
    if (action === 'create_upload_url') {
      const bucket = Object.hasOwn(UPLOAD_BUCKETS, body.kind) ? UPLOAD_BUCKETS[body.kind] : null;
      if (!bucket) return res.status(400).json({ error: 'Unknown upload kind.' });
      const result = await createUploadUrl(db, bucket, body.filename, companyId);
      if (result.error) return res.status(400).json({ error: result.error });
      return res.status(200).json({ ok: true, path: result.path, uploadToken: result.uploadToken, receipt: result.receipt });
    }
    if (action === 'submit') {
      const out = await submitRecord(db, {
        session, companyId, definitionId: body.definitionId, answers: body.answers, notes: body.notes, siteId: body.siteId,
        clientSubmissionId: body.clientSubmissionId, signLater: body.signLater, signature: body.signature, pdfReceipt: body.pdfReceipt, crew: body.crew, deps,
      });
      return res.status(200).json({ ok: true, id: out.record.id, status: out.record.status, duplicate: out.duplicate });
    }
    if (action === 'resubmit') {
      const out = await resubmitRecord(db, { session, companyId, recordId: body.recordId, answers: body.answers, notes: body.notes, pdfReceipt: body.pdfReceipt, deps });
      return res.status(200).json({ ok: true, ...out });
    }
    if (action === 'sign_now') {
      const out = await signNow(db, { session, companyId, recordId: body.recordId, signature: body.signature, pdfReceipt: body.pdfReceipt, deps });
      return res.status(200).json({ ok: true, ...out });
    }
    if (action === 'get_record_links') {
      const out = await getRecordLinks(db, { session, companyId, recordId: body.recordId, sign: (targets) => signTargets(supabaseAdmin, targets) });
      return res.status(200).json(out);
    }
    if (action === 'list_records') {
      return res.status(200).json(await listRecords(db, { session, companyId, definitionId: body.definitionId, status: body.status, limit: body.limit }));
    }
    if (action === 'get_record') {
      return res.status(200).json(await getRecord(db, { session, companyId, recordId: body.recordId }));
    }
    if (action === 'review') {
      const out = await reviewRecord(db, { session, companyId, recordId: body.recordId, decision: body.decision, reason: body.reason, deps });
      return res.status(200).json({ ok: true, ...out });
    }

    if (action === 'my_inbox') {
      return res.status(200).json(await myInbox(db, { session, companyId }));
    }
    if (action === 'list_escalations') {
      return res.status(200).json(await listEscalations(db, { session, companyId, status: body.status }));
    }
    if (action === 'action_escalation') {
      const out = await actionEscalation(db, { session, companyId, escalationId: body.escalationId });
      return res.status(200).json({ ok: true, ...out });
    }
    // The Account Owner (or the founder) can mute one document's email.
    // Everything else about a document stays founder only.
    if (action === 'set_owner_mute') {
      if (!canManageCompany(session)) return res.status(403).json({ error: 'Not allowed.' });
      const out = await setOwnerMute(db, { companyId, definitionId: body.definitionId, muted: body.muted });
      return res.status(200).json({ ok: true, ...out });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    if (err instanceof EngineError) return res.status(err.status).json({ error: err.message });
    console.error('api/documents error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
