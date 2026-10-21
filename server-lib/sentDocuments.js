// server-lib/sentDocuments.js
// Send & Sign (docs/schema/sent-documents-migration.sql). A supervisor sends
// a PDF to roster members; each recipient signs it or taps "Got it".
//
// This file holds the rules and the data access. api/certifications.js only
// routes to handleSentDocument(). Signing and the signed copy are later PRs;
// this one covers send, list, open and cancel.
//
// Who may send to whom: the Owner and the founder to anyone in the company,
// any other supervisor to people who share one of their departments,
// divisions or sites (the same tags rule A uses to scope records), plus
// themselves. A worker never sends.

import crypto from 'crypto';
import { loadActor } from './documentAccess.js';
import { createUploadUrl, resolveUploadReceipt } from './uploadUrls.js';
import { appendSignaturePage, decodeSignatureDataUrl, sha256Hex } from './signaturePage.js';

export const SENT_DOCS_BUCKET = 'sent-documents';
export const CATEGORIES = ['training', 'onboarding', 'notices', 'policies', 'other'];
export const MODES = ['sign', 'read'];
export const MAX_RECIPIENTS = 100;
const MAX_TITLE = 200;
const MAX_NOTE = 1000;
const LIST_LIMIT = 500;

export const SENT_DOC_ACTIONS = new Set([
  'create_sent_document_upload_url',
  'list_sendable_people',
  'send_document',
  'list_sent_documents',
  'open_sent_document',
  'complete_sent_document',
  'cancel_sent_document',
]);

// ── Pure rules ────────────────────────────────────────────────────────────

/** Clean and validate a send request. Returns { value } or { error }. */
export function normalizeSendInput(body) {
  const title = String(body.title || '').trim().slice(0, MAX_TITLE);
  if (!title) return { error: 'Give the document a title.' };
  const category = CATEGORIES.includes(body.category) ? body.category : null;
  if (!category) return { error: 'Pick a category.' };
  const mode = MODES.includes(body.mode) ? body.mode : null;
  if (!mode) return { error: 'Pick Sign or Read only.' };
  const note = String(body.note || '').trim().slice(0, MAX_NOTE) || null;

  let dueAt = null;
  if (body.dueAt) {
    const ms = Date.parse(body.dueAt);
    if (!Number.isFinite(ms)) return { error: 'That due date is not valid.' };
    dueAt = new Date(ms).toISOString();
  }

  const ids = [...new Set((Array.isArray(body.rosterIds) ? body.rosterIds : []).map(Number))]
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return { error: 'Pick at least one person.' };
  if (ids.length > MAX_RECIPIENTS) return { error: `Send to ${MAX_RECIPIENTS} people or fewer at a time.` };

  if (!body.receipt || typeof body.receipt !== 'string') return { error: 'Upload the PDF first.' };

  return { value: { title, category, mode, note, dueAt, rosterIds: ids, receipt: body.receipt } };
}

/** May this sender send to this recipient? Pure. `target` is a roster row. */
export function senderMayTarget(actor, target) {
  if (!actor) return false;
  if (actor.bypass) return true;
  if (actor.rosterId != null && Number(target.id) === actor.rosterId) return true;
  const departments = Array.isArray(target.departments) ? target.departments : [];
  if (departments.some((d) => actor.departments.includes(d))) return true;
  const divisions = (Array.isArray(target.divisions) ? target.divisions : []).map(Number);
  if (divisions.some((d) => actor.divisionIds.includes(d))) return true;
  if (target.default_site_id != null && actor.siteIds.has(Number(target.default_site_id))) return true;
  return false;
}

/** The status a person sees. "Overdue" is derived, never stored. Pure. */
export function displayStatus(row, now = Date.now()) {
  if (row.status === 'completed' || row.status === 'cancelled') return row.status;
  if (row.due_at) {
    const due = Date.parse(row.due_at);
    if (Number.isFinite(due) && due < now) return 'overdue';
  }
  return row.status;
}

/** Can the sender still pull this back? Pure. */
export function canCancel(row) {
  return row.status === 'sent' || row.status === 'opened';
}

// ── Data access ───────────────────────────────────────────────────────────

const ROW_COLUMNS = 'id, roster_id, batch_id, sent_by_roster_id, sent_by_name, title, category, mode, note, due_at, status, opened_at, completed_at, cancelled_at, created_at';

function fail(status, error) {
  return { status, body: { error } };
}

function shape(row, names, now) {
  return { ...row, recipientName: names.get(Number(row.roster_id)) || '', displayStatus: displayStatus(row, now) };
}

async function nameMap(supabase, companyId, ids) {
  const names = new Map();
  if (ids.length === 0) return names;
  const { data } = await supabase.from('roster').select('id, name').eq('company_id', companyId).in('id', ids);
  (data || []).forEach((r) => names.set(Number(r.id), r.name));
  return names;
}

// One document row the caller may act on, or a failure response.
async function loadRow(supabase, companyId, id) {
  const { data, error } = await supabase
    .from('sent_documents')
    .select(`${ROW_COLUMNS}, original_path, signed_path`)
    .eq('id', id)
    .eq('company_id', companyId)
    .limit(1);
  if (error) return { failure: fail(500, 'Connection error. Please try again.') };
  if (!data || !data[0]) return { failure: fail(404, 'Not found.') };
  return { row: data[0] };
}

// A supervisor sees documents they sent, plus documents sent to anyone in
// their scope. The Owner and the founder see the whole company.
async function supervisorMaySee(supabase, companyId, actor, row) {
  if (actor.bypass) return true;
  if (actor.rosterId != null && Number(row.sent_by_roster_id) === actor.rosterId) return true;
  const { data } = await supabase
    .from('roster')
    .select('id, departments, divisions, default_site_id')
    .eq('id', row.roster_id)
    .eq('company_id', companyId)
    .limit(1);
  return !!(data && data[0] && senderMayTarget(actor, data[0]));
}

export async function handleSentDocument({ supabase, session, companyId: rawCompanyId, action, body }) {
  // A founder session names the company in the request body. It goes into
  // storage paths and receipts, so it must be a plain positive integer.
  const companyId = /^[1-9][0-9]*$/.test(String(rawCompanyId ?? '')) ? Number(rawCompanyId) : null;
  if (!companyId) return fail(400, 'Missing company.');
  const { actor, error: actorError } = await loadActor(supabase, session);
  if (actorError) return fail(503, 'Connection error. Please try again.');
  if (!actor) return fail(403, 'Not allowed.');
  const isWorker = session.role === 'worker';
  const now = Date.now();

  // ── Step 1: a signed upload slot for the PDF ────────────────────────────
  if (action === 'create_sent_document_upload_url') {
    if (isWorker) return fail(403, 'Not allowed.');
    const base = String(body.filename || '').split('/').pop();
    // Namespaced <companyId>/originals/... by createUploadUrl, and bound to
    // the company by the receipt, which send_document verifies.
    const result = await createUploadUrl(supabase, SENT_DOCS_BUCKET, `originals/${base}`, companyId);
    if (result.error) return fail(400, result.error);
    return { status: 200, body: { ok: true, path: result.path, uploadToken: result.uploadToken, receipt: result.receipt } };
  }

  // ── The people this sender may pick: the same rule send_document applies,
  // so the picker never offers someone the server would refuse.
  if (action === 'list_sendable_people') {
    if (isWorker) return fail(403, 'Not allowed.');
    const { data, error } = await supabase
      .from('roster')
      .select('id, name, role, departments, divisions, default_site_id')
      .eq('company_id', companyId)
      .eq('active', true)
      .neq('role', 'auditor')
      .order('name', { ascending: true });
    if (error) return fail(500, 'Could not load the roster.');
    const people = (data || [])
      .filter((p) => senderMayTarget(actor, p))
      .map(({ id, name, role }) => ({ id, name, role }));
    return { status: 200, body: { people } };
  }

  // ── Step 2: record one row per recipient ────────────────────────────────
  if (action === 'send_document') {
    if (isWorker) return fail(403, 'Not allowed.');
    const parsed = normalizeSendInput(body);
    if (parsed.error) return fail(400, parsed.error);
    const input = parsed.value;

    const originalPath = resolveUploadReceipt(input.receipt, SENT_DOCS_BUCKET, companyId);
    if (!originalPath) return fail(400, 'That upload could not be verified. Upload the PDF again.');

    const { data: targets, error: targetError } = await supabase
      .from('roster')
      .select('id, name, departments, divisions, default_site_id')
      .eq('company_id', companyId)
      .eq('active', true)
      .in('id', input.rosterIds);
    if (targetError) return fail(500, 'Connection error. Please try again.');
    const found = new Map((targets || []).map((t) => [Number(t.id), t]));
    // Refuse the whole send rather than quietly dropping someone: the sender
    // believes everyone on their list has it.
    for (const id of input.rosterIds) {
      const target = found.get(id);
      if (!target || !senderMayTarget(actor, target)) {
        return fail(403, 'One of those people is outside your scope or no longer active.');
      }
    }

    let senderName = 'FORA';
    if (actor.rosterId != null) {
      const { data: me } = await supabase.from('roster').select('name').eq('id', actor.rosterId).eq('company_id', companyId).limit(1);
      senderName = (me && me[0] && me[0].name) || '';
    }

    const rows = input.rosterIds.map((rosterId) => ({
      company_id: companyId,
      roster_id: rosterId,
      sent_by_roster_id: actor.rosterId,
      sent_by_name: senderName,
      title: input.title,
      category: input.category,
      mode: input.mode,
      note: input.note,
      due_at: input.dueAt,
      original_path: originalPath,
    }));
    const batchId = crypto.randomUUID();
    const { data, error } = await supabase
      .from('sent_documents')
      .insert(rows.map((r) => ({ ...r, batch_id: batchId })))
      .select('id');
    if (error) return fail(500, 'Could not send the document.');
    return { status: 200, body: { ok: true, batchId, sent: (data || []).length } };
  }

  // ── List: a worker gets their own, a supervisor gets their scope ────────
  if (action === 'list_sent_documents') {
    let query = supabase
      .from('sent_documents')
      .select(ROW_COLUMNS)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      // A scoped supervisor is filtered after the read, so read deeper to
      // keep in-scope documents from falling off the end.
      .limit(isWorker || actor.bypass ? LIST_LIMIT : LIST_LIMIT * 4);
    if (isWorker) {
      query = query.eq('roster_id', session.userId).neq('status', 'cancelled');
    } else {
      if (CATEGORIES.includes(body.category)) query = query.eq('category', body.category);
      if (body.rosterId) query = query.eq('roster_id', Number(body.rosterId));
    }
    const { data, error } = await query;
    if (error) return fail(500, 'Could not load documents.');

    let rows = data || [];
    if (!isWorker && !actor.bypass) {
      const ids = [...new Set(rows.map((r) => Number(r.roster_id)))];
      const { data: people, error: peopleError } = ids.length === 0
        ? { data: [], error: null }
        : await supabase.from('roster').select('id, departments, divisions, default_site_id').eq('company_id', companyId).in('id', ids);
      if (peopleError) return fail(500, 'Could not load documents.');
      const byId = new Map((people || []).map((p) => [Number(p.id), p]));
      rows = rows.filter((r) =>
        (actor.rosterId != null && Number(r.sent_by_roster_id) === actor.rosterId)
        || (byId.has(Number(r.roster_id)) && senderMayTarget(actor, byId.get(Number(r.roster_id)))));
    }
    rows = rows.slice(0, LIST_LIMIT);
    const names = await nameMap(supabase, companyId, [...new Set(rows.map((r) => Number(r.roster_id)))]);
    return { status: 200, body: { documents: rows.map((r) => shape(r, names, now)) } };
  }

  // ── Open: a signed link to the PDF, and sent -> opened for the recipient
  if (action === 'open_sent_document') {
    const { row, failure } = await loadRow(supabase, companyId, body.id);
    if (failure) return failure;
    const isRecipient = session.userId != null && Number(row.roster_id) === Number(session.userId);
    if (isWorker && !isRecipient) return fail(403, 'Not allowed.');
    if (!isWorker && !isRecipient && !(await supervisorMaySee(supabase, companyId, actor, row))) {
      return fail(403, 'Not allowed.');
    }
    if (row.status === 'cancelled' && isRecipient) return fail(404, 'Not found.');

    // Only the recipient opening it counts as "opened".
    if (isRecipient && row.status === 'sent') {
      await supabase.from('sent_documents')
        .update({ status: 'opened', opened_at: new Date(now).toISOString() })
        .eq('id', row.id).eq('company_id', companyId).eq('status', 'sent');
      row.status = 'opened';
    }
    const path = row.signed_path || row.original_path;
    // Every stored path was issued under this company's prefix. A row that
    // says otherwise is inert rather than signed.
    if (!String(path).startsWith(`${companyId}/`)) return fail(404, 'Not found.');
    const { data: signed } = await supabase.storage.from(SENT_DOCS_BUCKET).createSignedUrl(path, 3600);
    return { status: 200, body: { document: shape(row, new Map(), now), fileUrl: signed?.signedUrl || null } };
  }

  // ── Complete: the recipient signs, or taps Got it ───────────────────────
  // Only the person it was sent to, and only after they opened it. The server
  // builds the signed copy (original + one record page) and files it under
  // <company>/<recipient>/<category>/, so nothing about the signed file comes
  // from the browser except the drawn signature.
  if (action === 'complete_sent_document') {
    if (session.userId == null) return fail(403, 'Not allowed.');
    const { row, failure } = await loadRow(supabase, companyId, body.id);
    if (failure) return failure;
    if (Number(row.roster_id) !== Number(session.userId)) return fail(403, 'Not allowed.');
    if (row.status === 'completed') return fail(400, 'You already finished this one.');
    if (row.status === 'cancelled') return fail(404, 'Not found.');
    if (row.status !== 'opened') return fail(400, 'Open the document first.');

    let signatureBytes = null;
    if (row.mode === 'sign') {
      const decoded = decodeSignatureDataUrl(body.signature);
      if (decoded.error) return fail(400, decoded.error);
      signatureBytes = decoded.bytes;
    }

    if (!String(row.original_path).startsWith(`${companyId}/`)) return fail(404, 'Not found.');
    const { data: file, error: downloadError } = await supabase.storage.from(SENT_DOCS_BUCKET).download(row.original_path);
    if (downloadError || !file) return fail(500, 'Could not load the document. Please try again.');
    const originalBytes = Buffer.from(await file.arrayBuffer());

    const { data: people } = await supabase.from('roster').select('name').eq('id', session.userId).eq('company_id', companyId).limit(1);
    const { data: companies } = await supabase.from('companies').select('name').eq('id', companyId).limit(1);
    const signerName = (people && people[0] && people[0].name) || 'Unknown';

    let signed;
    try {
      signed = await appendSignaturePage({
        originalBytes, signerName, title: row.title, mode: row.mode, signatureBytes,
        companyName: (companies && companies[0] && companies[0].name) || '', signedAt: new Date(now),
      });
    } catch (e) {
      console.error('sent document signing failed:', e.message);
      return fail(422, 'This PDF could not be signed. Ask the sender to send it again as a standard PDF.');
    }

    const signedPath = `${companyId}/${Number(row.roster_id)}/${row.category}/${now}-${crypto.randomBytes(8).toString('hex')}-signed.pdf`;
    const { error: uploadError } = await supabase.storage.from(SENT_DOCS_BUCKET)
      .upload(signedPath, signed.bytes, { contentType: 'application/pdf', upsert: false });
    if (uploadError) return fail(500, 'Could not save the signed copy. Please try again.');

    const { data: updated, error: updateError } = await supabase.from('sent_documents')
      .update({
        status: 'completed',
        completed_at: new Date(now).toISOString(),
        signed_path: signedPath,
        signed_sha256: sha256Hex(signed.bytes),
        original_sha256: signed.originalSha256,
      })
      .eq('id', row.id).eq('company_id', companyId).eq('roster_id', session.userId).eq('status', 'opened')
      .select('id');
    if (updateError || !updated || updated.length === 0) {
      // Lost a race (cancelled or finished in the meantime) or the write
      // failed: do not leave an orphaned signed file behind.
      await supabase.storage.from(SENT_DOCS_BUCKET).remove([signedPath]);
      return fail(updateError ? 500 : 409, updateError ? 'Could not save the signed copy. Please try again.' : 'This document changed. Reload and try again.');
    }
    return { status: 200, body: { ok: true } };
  }

  // ── Cancel: the sender or the Owner pulls back an unfinished document ───
  if (action === 'cancel_sent_document') {
    if (isWorker) return fail(403, 'Not allowed.');
    const { row, failure } = await loadRow(supabase, companyId, body.id);
    if (failure) return failure;
    const isSender = actor.rosterId != null && Number(row.sent_by_roster_id) === actor.rosterId;
    if (!actor.bypass && !isSender) return fail(403, 'Only the sender or the Owner can cancel this.');
    if (!canCancel(row)) return fail(400, 'This document is already finished.');
    const { error } = await supabase.from('sent_documents')
      .update({ status: 'cancelled', cancelled_at: new Date(now).toISOString() })
      .eq('id', row.id).eq('company_id', companyId).in('status', ['sent', 'opened']);
    if (error) return fail(500, 'Could not cancel the document.');
    return { status: 200, body: { ok: true } };
  }

  return fail(400, 'Unknown action.');
}
