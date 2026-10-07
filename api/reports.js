// api/reports.js
// Handles Incident and Near Miss reports — submitting, viewing, reviewing,
// and deleting — all with the same session checks as api/flhas.js. One file
// covers both report types since they work the same way.

import { createClient } from '@supabase/supabase-js';
import { authorRosterId, stampAuthorName } from '../server-lib/authorStamp.js';
import { resolveSiteId } from '../server-lib/siteScope.js';
import { openCorrectiveActions, correctiveActionsFromReport } from '../server-lib/correctiveActions.js';
import crypto from 'crypto';
import { createUploadUrl, storedUrlFromClientReceipt, storedUrlsFromClientReceipts, receiptWasDropped } from '../server-lib/uploadUrls.js';
import { signRows } from '../server-lib/signedUrls.js';
import { requireDocKey } from '../server-lib/docKeyGate.js';
import { requireAssignment, requireRecordsAccess, listVisibleRecords, SUBMIT, queuedAsOf } from '../server-lib/documentAccess.js';
import { sessionExpired } from '../server-lib/sessionTtl.js';
import { unsignedFields, missingSignColumns, completeSignature, loadSignState } from '../server-lib/signLater.js';
import { notifyAudience } from '../server-lib/notifyAudience.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


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
  if (sessionExpired(payload)) return null;

  // A login TICKET is not a session. api/login.js mints two roleless,
  // short-lived tokens with this same signature and secret — the roster
  // ticket (`purpose: 'roster'`, handed out after the company code alone,
  // BEFORE any PIN) and the master ticket (`purpose: 'master'`) — and the
  // comment there claims they can never be replayed as a session because
  // "every other protected endpoint in this app gates on session.role".
  // That was not true: a ticket carries no `userId`, so the roster
  // short-circuit below returned it as a valid session, and the handlers
  // that gate only on company scope rather than on role (list_equipment,
  // list_sops, list_sites, list_custom_fields, get_company_logo) answered
  // it — for this file's 7-day TTL, not the ticket's 5 minutes. Anyone
  // holding a company's worker code could read that company's reference
  // data without ever knowing a PIN.
  //
  // Nothing that is genuinely a session carries `purpose`, so rejecting it
  // outright is the whole fix, and it belongs here rather than in each
  // handler: the next endpoint added without a role check inherits it.
  if (payload.purpose) return null;

  // Admin sessions and legacy (pre-cutover) worker/supervisor sessions carry
  // no userId — nothing to live-check beyond the signature+TTL above.
  // Founder sessions (the admin code, and the master code opening a company)
  // carry no userId and nothing to live-check. A worker or supervisor token
  // with no userId is a leftover from the retired shared company codes and is
  // refused: it never passed a PIN or an authenticator.
  if (payload.role === 'admin') return payload;
  if (!payload.userId) return payload.founder === true ? payload : null;

  // Individually-identified (roster) sessions: re-check `active` on every
  // request, so deactivating someone takes effect on their very next call
  // instead of waiting out the token's TTL.
  const { data: rows, error } = await supabaseAdmin
    .from('roster')
    .select('active, role, company_id, name')
    .eq('id', payload.userId)
    .limit(1);
  if (error || !rows || rows.length === 0 || !rows[0].active) return null;
  if (rows[0].company_id !== payload.companyId) return null;
  // An auditor reads through api/audit.js only. Every other endpoint treats
  // an auditor session as no session at all, so a handler that never checked
  // the role still cannot answer one.
  if (rows[0].role === 'auditor') return null;
  return { ...payload, role: rows[0].role, name: rows[0].name };
}

// What a named incident or near miss sets in motion once it counts: its
// company_signals row (docs/scope-company-brain.md Phase 3) and the trackable
// corrective actions (Break #5). Run at submit for a signed report and from
// sign_now for one saved to sign afterwards. `record` carries incident_type,
// involved and report_json. Best-effort: the report is already saved, so a
// failure here is logged and never turned into a failed request. Safe to run
// twice for one report: the signal is checked first and
// openCorrectiveActions skips descriptions it already holds.
async function runReportFollowUps(session, type, id, record) {
  try {
    await runReportFollowUpsUnguarded(session, type, id, record);
  } catch (e) {
    console.error('report follow-ups failed for', type, id, e && e.message);
  }
}

async function runReportFollowUpsUnguarded(session, type, id, record) {
  if (type !== 'incident' && type !== 'nearmiss') return;
  const sourceType = type === 'incident' ? 'incident' : 'near_miss';
  const shortStr = (v) => (typeof v === 'string' && v.trim()) ? v.trim().slice(0, 200) : null;
  const reportJson = record && record.report_json;
  const signalJson = type === 'incident'
    ? { category: shortStr(record && record.incident_type) }
    : { involved: shortStr(record && record.involved), severity: shortStr(reportJson && reportJson.severity) };
  if (Object.values(signalJson).some((v) => v !== null)) {
    const { data: have } = await supabaseAdmin.from('company_signals').select('id')
      .eq('company_id', session.companyId).eq('source_type', sourceType).eq('source_id', String(id)).limit(1);
    if (!have || have.length === 0) {
      const { error: signalErr } = await supabaseAdmin.from('company_signals').insert({
        company_id: session.companyId,
        source_type: sourceType,
        source_id: String(id),
        signal_json: signalJson,
      });
      if (signalErr) console.error('company_signals insert failed for', type, id, signalErr.message);
    }
  }
  await openCorrectiveActions(supabaseAdmin, {
    companyId: session.companyId,
    sourceType,
    sourceId: id,
    descriptions: correctiveActionsFromReport(reportJson),
  });
}

// flha-reports/signatures/incident-photos are private buckets — the DB
// still stores a "public"-shaped URL (upload code never changed), but that
// string is never itself a working link. Every value handed to a client is
// swapped for a short-lived signed URL first.
function pathFromStoredUrl(url, bucket) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = decodeURIComponent(url.slice(idx + marker.length));
  // The bucket name is not a boundary. Supabase's createSignedUrl builds
  // `object/sign/<bucket>/<path>` as a URL string, and WHATWG URL parsing
  // collapses dot segments before the request goes out, so a stored path of
  // `../flha-reports/x.pdf` in the incident-photos bucket resolves to
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

const TABLES = {
  incident: {
    name: 'incidents',
    docKey: 'incident',
    jsonColumn: 'report_json',
    listColumns: 'id, reporter_name, site, site_id, occurred_at, incident_type, injured_person, body_part, treatment, medical_attention, witnesses, evidence, report_json, photo_urls, company_id, pdf_url, signature_url, created_at, reviewed, reviewed_by, reviewed_at, review_notes, submitted_by_roster_id',
  },
  nearmiss: {
    name: 'near_misses',
    docKey: 'nearmiss',
    jsonColumn: 'report_json',
    // submitted_by_roster_id rides along here like everywhere else, and the
    // reasoning for that is worth stating because an earlier version of this
    // file withheld it for the wrong reason.
    //
    // The worry was that selecting a column which is always null for
    // anonymous rows would make "this one is null" readable beside rows
    // where it is set, turning anonymity into a property a supervisor can
    // spot. That protects nothing: `is_anonymous` is selected on this very
    // line, and src/Dashboard.jsx renders it as the literal word "Anonymous"
    // (:816, :957, :3166). Anonymity is a designed, visible property of a
    // near miss, not an inference to be denied.
    //
    // What the promise actually rests on is structural and unaffected by
    // what this list selects: authorRosterId() nulls the column at write
    // time when is_anonymous is true, and a CHECK constraint
    // (docs/schema/roster-attribution-migration.sql:58) makes an anonymous
    // row carrying an author impossible. There is no row where this column
    // could betray an identity. Withholding it only cost the break-#8
    // certification badge on the non-anonymous near misses, which are most
    // of them.
    listColumns: 'id, reporter_name, is_anonymous, site, site_id, occurred_at, involved, report_json, company_id, pdf_url, signature_url, created_at, reviewed, reviewed_by, reviewed_at, review_notes, submitted_by_roster_id',
  },
};

// Column allow-list for client-supplied `record` bodies on submit. The
// `update` action has always whitelisted its fields so a client "can't
// smuggle company_id, status, or supervisor sign-off fields through
// `fields`" — submit never got the same treatment, so `{ ...record }`
// let a worker set reviewed/reviewed_by to self-clear an injury report
// off a supervisor's action list, or backdate created_at. Server-owned
// columns (id, company_id, created_at, reviewed*) are absent on purpose.
function pickAllowed(record, allowed) {
  const out = {};
  if (!record || typeof record !== 'object') return out;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
  }
  return out;
}

// `photo_urls` and `signature_url` are absent on purpose, alongside the
// `status`-shaped fields every other endpoint already withholds. They used
// to ride in on `record` as raw client strings, which made photo_urls the
// widest read oracle in the app: it's an *array*, and the `list` action
// batch-signs every element in one Storage call, so a single submission
// carrying thousands of guessed incident-photos paths came back with a
// signed URL for each one that existed and null for each that didn't.
// Both now come from upload receipts resolved below.
const SUBMITTABLE_FIELDS = {
  incident: ['reporter_name', 'site', 'site_id', 'occurred_at', 'incident_type', 'injured_person', 'body_part', 'treatment', 'medical_attention', 'witnesses', 'evidence', 'report_json', 'signed_by', 'pdf_url'],
  nearmiss: ['reporter_name', 'is_anonymous', 'site', 'site_id', 'occurred_at', 'involved', 'report_json', 'signed_by', 'pdf_url'],
};

// Which company a report belongs to, for the founder/admin path that has none
// of its own. null when the row is not found.
async function companyOfRecord(tableName, id) {
  const { data } = await supabaseAdmin.from(tableName).select('company_id').eq('id', id).limit(1);
  return (data && data[0] && data[0].company_id) || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, action, token } = req.body || {};

  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ── Photo/signature/PDF uploads for incident + near-miss reports ────
    if (action === 'create_upload_url') {
      // Deliberately ungated: this mints a signed upload slot inside the
      // caller's own company namespace and is reached before the record
      // type is known, so there is no doc key to check. The submit that
      // would use the uploaded file IS gated, which is where a company
      // without the module is stopped.
      const { bucket, filename } = req.body;
      if (!['incident-photos', 'signatures', 'flha-reports'].includes(bucket)) {
        return res.status(400).json({ error: 'Invalid bucket.' });
      }
      const result = await createUploadUrl(supabaseAdmin, bucket, filename, session.companyId);
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true, path: result.path, uploadToken: result.uploadToken, receipt: result.receipt });
    }

    const table = TABLES[type];
    if (!table) return res.status(400).json({ error: 'Unknown report type.' });

    // ── Worker: submit a new report ─────────────────────────────────
    if (action === 'submit') {
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const notAssigned = await requireAssignment(supabaseAdmin, session, table.docKey, SUBMIT, { asOf: queuedAsOf(req.body) });
      if (notAssigned) return res.status(notAssigned.status).json({ error: notAssigned.error });
      const { data: coRows } = await supabaseAdmin.from('companies').select('suspended').eq('id', session.companyId).limit(1);
      if (coRows && coRows[0] && coRows[0].suspended) {
        return res.status(403).json({ error: "Your company's access is suspended. Contact your administrator." });
      }
      const { record, clientSubmissionId } = req.body;
      if (!record) return res.status(400).json({ error: 'Missing record.' });

      // Idempotency (docs/scope-offline-capability.md Phase 1): a queued
      // offline submission gets retried, possibly more than once. If an
      // earlier attempt actually reached the database but the client never
      // saw the response (dropped connection right after), retrying it
      // blindly would create a duplicate report. There's no dedicated
      // column for this — every table here already has a jsonb column, so
      // the id rides along inside that instead of a schema migration.
      if (clientSubmissionId && table.jsonColumn) {
        let replay = supabaseAdmin
          .from(table.name)
          .select('id')
          .eq('company_id', session.companyId)
          .eq(`${table.jsonColumn}->>client_submission_id`, clientSubmissionId);
        // A retry is the same person's. (An anonymous near miss has no author
        // to compare, so its lookup stays by company and submission id.)
        if (session.userId && record.is_anonymous !== true) replay = replay.eq('submitted_by_roster_id', Number(session.userId));
        const { data: existingRows } = await replay.limit(1);
        if (existingRows && existingRows.length > 0) {
          const state = await loadSignState(supabaseAdmin, table.name, existingRows[0].id, session.companyId);
          return res.status(200).json({ id: existingRows[0].id, awaitingSignature: !!(state && state.found && state.awaiting) });
        }
      }

        // pdf_url arrives as an upload receipt, not a URL the browser
        // assembled. storedUrlFromClientReceipt turns it into the path this
        // server actually issued, so a caller can't store another company's
        // report path and have a list endpoint sign it for them later.
      const recordToInsert = pickAllowed(record, SUBMITTABLE_FIELDS[type] || []);
      // A strict boolean, never a string the database would cast: the
      // anonymity checks below test `=== true`.
      if (Object.prototype.hasOwnProperty.call(recordToInsert, 'is_anonymous')) recordToInsert.is_anonymous = recordToInsert.is_anonymous === true;
      // The name on the report is the signed-in person's, not the request's
      // (server-lib/authorStamp.js). An anonymous near miss keeps its label.
      stampAuthorName(session, recordToInsert, ['reporter_name', 'signed_by'], { isAnonymous: recordToInsert.is_anonymous === true });

      // Break #2 — a client-supplied site_id is a tenancy question, not a
      // validation detail: unchecked, a worker could file their own
      // company's record against another company's site row. Rejecting
      // rather than silently nulling, so a real bug surfaces instead of
      // quietly producing unjoinable records. Same guard api/fuellogs.js
      // already applied to fuel logs, now shared.
      if (Object.prototype.hasOwnProperty.call(recordToInsert, 'site_id')) {
        const resolvedSiteId = await resolveSiteId(supabaseAdmin, session.companyId, recordToInsert.site_id);
        if (resolvedSiteId === false) return res.status(403).json({ error: 'Not allowed for this site.' });
        recordToInsert.site_id = resolvedSiteId;
      }
      let pdfLinked = true;
      if (Object.prototype.hasOwnProperty.call(recordToInsert, 'pdf_url')) {
        const submittedPdf = recordToInsert.pdf_url;
        recordToInsert.pdf_url = storedUrlFromClientReceipt(submittedPdf, session.companyId);
        pdfLinked = !receiptWasDropped(submittedPdf, recordToInsert.pdf_url);
      }
      // Photos and the signature come in as receipts at the top level, never
      // as URLs inside `record` — see the SUBMITTABLE_FIELDS comment above.
      const { photoReceipts, signatureReceipt } = req.body;
      let photosLinked = true;
      if (type === 'incident') {
        recordToInsert.photo_urls = storedUrlsFromClientReceipts(photoReceipts, session.companyId, 'incident-photos');
        const sent = Array.isArray(photoReceipts) ? photoReceipts.length : 0;
        photosLinked = recordToInsert.photo_urls.length === sent;
      }
      recordToInsert.signature_url = storedUrlFromClientReceipt(signatureReceipt, session.companyId, 'signatures');
      const signatureLinked = !receiptWasDropped(signatureReceipt, recordToInsert.signature_url);
      if (clientSubmissionId && table.jsonColumn) {
        recordToInsert[table.jsonColumn] = { ...(recordToInsert[table.jsonColumn] || {}), client_submission_id: clientSubmissionId };
      }

      // "I'll sign afterwards": saved now, signed later by the person it is
      // stamped to. A report with no signature on it (none sent, or the
      // signature upload failed) is saved the same way rather than as a
      // finished-looking record nobody signed. An anonymous near miss takes no
      // signature by design and is never one of these: it has no author who
      // could sign it later.
      const anonymous = recordToInsert.is_anonymous === true;
      let signLater = record.sign_later === true;
      if (signLater && anonymous) return res.status(400).json({ error: "An anonymous report can't be signed afterwards." });
      // A named near miss follows the same rule as an incident: no signature on
      // it means it waits for one. Anonymous never does.
      if (!signLater && !anonymous && (type === 'incident' || type === 'nearmiss') && !recordToInsert.signature_url) signLater = true;
      if (signLater) {
        if (!session.userId) return res.status(400).json({ error: 'Signing afterwards needs your own sign-in.' });
        recordToInsert.signature_url = null;
        Object.assign(recordToInsert, unsignedFields(new Date().toISOString()));
      }

      const { data, error } = await supabaseAdmin
        .from(table.name)
        // Break #3 — author from the session, never the request. The
        // is_anonymous flag is read off the record being written, so an
        // anonymous near miss records no author at all; the database
        // refuses one too (near_misses_anonymous_has_no_author).
        .insert({
          ...recordToInsert,
          company_id: session.companyId,
          submitted_by_roster_id: authorRosterId(session, { isAnonymous: recordToInsert.is_anonymous === true }),
        })
        .select('id')
        .limit(1);
      if (error && signLater && missingSignColumns(error)) {
        return res.status(503).json({ error: "Signing afterwards isn't switched on yet. Sign now, or ask your Owner." });
      }
      if (error) return res.status(500).json({ error: 'Save failed. Try again.' });
      const newId = data?.[0]?.id || null;

      // The Brain signal and the corrective actions follow the author's
      // signature: a report nobody has signed yet opens nothing, and a
      // sign-later one runs them from sign_now instead.
      if (newId && !signLater) {
        await runReportFollowUps(session, type, newId, record);
        await notifyAudience(supabaseAdmin, session, type, {
          siteId: recordToInsert.site_id ?? null,
          authorId: authorRosterId(session, { isAnonymous: recordToInsert.is_anonymous === true }),
        });
      }

      return res.status(200).json({ id: newId, pdfLinked, photosLinked, signatureLinked, awaitingSignature: signLater });
    }

    // ── Worker: my reports saved to sign afterwards ──────────────────
    // The caller's OWN unsigned reports only (roster id from the session). The
    // full report comes back because signing regenerates the PDF with the
    // signature on it.
    if (action === 'my_unsigned') {
      if ((session.role !== 'worker' && session.role !== 'supervisor') || !session.userId) return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const { data, error } = await supabaseAdmin
        .from(table.name)
        .select(table.listColumns + ', signature_requested_at')
        .eq('company_id', session.companyId)
        .eq('submitted_by_roster_id', Number(session.userId))
        .eq('awaiting_signature', true)
        .is('unsigned_closed_at', null)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) {
        if (missingSignColumns(error)) return res.status(200).json({ records: [] });
        return res.status(500).json({ error: 'Could not load your unsigned reports.' });
      }
      const records = await signRows(supabaseAdmin, data || [], [
        { key: 'pdf_url', bucket: 'flha-reports' },
        { key: 'photo_urls', bucket: 'incident-photos' },
      ]);
      return res.status(200).json({ records });
    }

    // ── Worker: sign a report I saved to sign afterwards ─────────────
    // Only the roster member it is stamped to, checked against the row. The
    // signature arrives as an upload receipt like everywhere else here, and
    // the signed PDF must have uploaded too before the record counts as
    // signed.
    if (action === 'sign_now') {
      if ((session.role !== 'worker' && session.role !== 'supervisor') || !session.userId) return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const { id, signatureReceipt, pdfUrl } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing record id.' });
      const signatureUrl = storedUrlFromClientReceipt(signatureReceipt, session.companyId, 'signatures');
      if (!signatureUrl) return res.status(400).json({ error: "Your signature didn't upload. Check your connection and sign again." });
      const resolvedPdfUrl = storedUrlFromClientReceipt(pdfUrl, session.companyId);
      if (!resolvedPdfUrl) return res.status(400).json({ error: "Your signed copy didn't upload. Check your connection and sign again." });
      const done = await completeSignature(supabaseAdmin, {
        table: table.name, id, session,
        update: { signature_url: signatureUrl, pdf_url: resolvedPdfUrl },
        nowIso: new Date().toISOString(),
      });
      if (done.denied) return res.status(done.denied.status).json({ error: done.denied.error });
      const afterCols = type === 'incident' ? 'pdf_url, site_id, submitted_by_roster_id, incident_type, report_json' : 'pdf_url, site_id, submitted_by_roster_id, involved, report_json';
      const { data: after } = await supabaseAdmin.from(table.name).select(afterCols).eq('id', id).eq('company_id', session.companyId).limit(1);
      const row = after && after[0];
      // Now that it counts: its Brain signal and corrective actions.
      if (row) {
        await runReportFollowUps(session, type, id, row);
        // A sign-later report tells its audience now that it counts, not when it was saved.
        await notifyAudience(supabaseAdmin, session, type, { siteId: row.site_id ?? null, authorId: row.submitted_by_roster_id ?? null });
      }
      const stored = row && row.pdf_url;
      const signedPdfUrl = stored ? await signStoredUrl(stored, 'flha-reports') : null;
      return res.status(200).json({ ok: true, pdfUrl: signedPdfUrl });
    }

    // ── Supervisor / Admin: load reports for the dashboard ──────────
    if (action === 'list') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const runList = (columns) => {
        let q = supabaseAdmin.from(table.name).select(columns).order('created_at', { ascending: false });
        if (session.role === 'supervisor') q = q.eq('company_id', session.companyId);
        return q;
      };
      // The sign-later columns ride along; a database without them has no
      // unsigned reports, so the read is retried without.
      let { data: allRows, error } = await runList(`${table.listColumns}, awaiting_signature, signature_requested_at, worker_signed_at, unsigned_closed_at`);
      if (error && missingSignColumns(error)) ({ data: allRows, error } = await runList(table.listColumns));
      if (error) return res.status(500).json({ error: 'Could not load records.' });
      const visible = await listVisibleRecords(supabaseAdmin, session, table.docKey, allRows || []);
      if (visible.denied) return res.status(visible.denied.status).json({ error: visible.denied.error });
      const records = await signRows(supabaseAdmin, visible.records, [
        { key: 'pdf_url', bucket: 'flha-reports' },
        { key: 'signature_url', bucket: 'signatures' },
        { key: 'photo_urls', bucket: 'incident-photos' },
      ]);
      return res.status(200).json({ records });
    }

    // ── Supervisor / Admin: mark a report reviewed ───────────────────
    if (action === 'review') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const { id, notes, pdfUrl, reviewedBy: reviewedByInput } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing record id.' });

      // Nobody marks a report reviewed before its author has signed it.
      {
        const reviewCompany = session.role === 'admin' ? await companyOfRecord(table.name, id) : session.companyId;
        // An admin's lookup that finds nothing is a 404, never a pass.
        if (!reviewCompany) return res.status(404).json({ error: 'Record not found.' });
        const signState = await loadSignState(supabaseAdmin, table.name, id, reviewCompany);
        if (signState.error) return res.status(503).json({ error: "Couldn't check that record. Please try again." });
        if (signState.found && signState.awaiting) return res.status(409).json({ error: "The author hasn't signed this report yet." });
      }

      if (session.role === 'supervisor') {
        const { data: existing, error: findErr } = await supabaseAdmin.from(table.name).select('id, company_id, site_id, submitted_by_roster_id').eq('id', id).limit(1);
        if (findErr || !existing || existing.length === 0 || existing[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed to review this record.' });
        }
        const reviewDenied = await requireRecordsAccess(supabaseAdmin, session, table.docKey, [existing[0]]);
        if (reviewDenied) return res.status(reviewDenied.status).json({ error: reviewDenied.error });
      }
      const now = new Date().toISOString();
      const reviewedBy = (typeof reviewedByInput === 'string' && reviewedByInput.trim())
        ? reviewedByInput.trim()
        : (session.role === 'admin' ? 'Admin' : 'Supervisor');
      const update = { reviewed: true, reviewed_by: reviewedBy, reviewed_at: now, review_notes: notes || null };
      const resolvedPdfUrl = storedUrlFromClientReceipt(pdfUrl, session.companyId);
      if (resolvedPdfUrl) update.pdf_url = resolvedPdfUrl;
      const pdfLinked = !receiptWasDropped(pdfUrl, resolvedPdfUrl);
      let reviewWrite = supabaseAdmin.from(table.name).update(update).eq('id', id);
      if (session.role === 'supervisor') reviewWrite = reviewWrite.eq('company_id', session.companyId);
      const { error } = await reviewWrite;
      if (error) return res.status(500).json({ error: 'Review failed.' });
      // Sign the pdf_url now stored on the row, not the `pdfUrl` string the
      // client sent. Signing a request-supplied path turned this endpoint
      // into an oracle: `flha-reports` is one flat bucket shared by every
      // tenant with deterministic, second-granularity filenames, so a
      // caller could hand over another company's report path and get a
      // working signed URL back for it. Re-reading the row means the only
      // path that can be signed is the one this record actually points at.
      const { data: afterRows } = await supabaseAdmin.from(table.name).select('pdf_url').eq('id', id).limit(1);
      const storedPdfUrl = afterRows?.[0]?.pdf_url || null;
      const signedPdfUrl = storedPdfUrl ? await signStoredUrl(storedPdfUrl, 'flha-reports') : null;
      return res.status(200).json({ ok: true, reviewed_by: reviewedBy, reviewed_at: now, pdfUrl: signedPdfUrl, pdfLinked });
    }

    // ── Supervisor / Admin: correct the submitted content of a report ──
    // General "fix a mistake" edit — distinct from `review` (which only
    // ever touches reviewed/reviewed_by/reviewed_at/review_notes). Only
    // the fields that actually feed the PDF are whitelisted per type, so a
    // client can never smuggle company_id, reviewed status, etc. through
    // `fields`. Same tenant-ownership re-check as `review`/`delete` above.
    if (action === 'update') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const { id, fields, pdfUrl } = req.body;
      if (!id || !fields || typeof fields !== 'object') return res.status(400).json({ error: 'Missing details.' });

      // A report waiting for its author's signature is not edited under them:
      // they would sign content they never saw. Edit it once it is signed.
      {
        const editCompany = session.role === 'admin' ? await companyOfRecord(table.name, id) : session.companyId;
        if (!editCompany) return res.status(404).json({ error: 'Record not found.' });
        const signState = await loadSignState(supabaseAdmin, table.name, id, editCompany);
        if (signState.error) return res.status(503).json({ error: "Couldn't check that record. Please try again." });
        if (signState.found && signState.awaiting) return res.status(409).json({ error: "The author hasn't signed this report yet. Edit it once they have." });
      }

      if (session.role === 'supervisor') {
        const { data: existing, error: findErr } = await supabaseAdmin.from(table.name).select('id, company_id, site_id, submitted_by_roster_id').eq('id', id).limit(1);
        if (findErr || !existing || existing.length === 0 || existing[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed to edit this record.' });
        }
        const editDenied = await requireRecordsAccess(supabaseAdmin, session, table.docKey, [existing[0]]);
        if (editDenied) return res.status(editDenied.status).json({ error: editDenied.error });
      }

      const EDITABLE_FIELDS = {
        incident: ['reporter_name', 'site', 'occurred_at', 'incident_type', 'injured_person', 'body_part', 'treatment', 'medical_attention', 'witnesses', 'evidence', 'report_json'],
        nearmiss: ['reporter_name', 'is_anonymous', 'site', 'occurred_at', 'involved', 'report_json'],
      };
      const allowed = EDITABLE_FIELDS[type] || [];
      const update = {};
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(fields, key)) update[key] = fields[key];
      }
      if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No editable fields provided.' });
      const resolvedPdfUrl = storedUrlFromClientReceipt(pdfUrl, session.companyId);
      if (resolvedPdfUrl) update.pdf_url = resolvedPdfUrl;
      const pdfLinked = !receiptWasDropped(pdfUrl, resolvedPdfUrl);

      let editWrite = supabaseAdmin.from(table.name).update(update).eq('id', id);
      if (session.role === 'supervisor') editWrite = editWrite.eq('company_id', session.companyId);
      const { error } = await editWrite;
      if (error) return res.status(500).json({ error: 'Update failed.' });
      // Sign the pdf_url now stored on the row, not the `pdfUrl` string the
      // client sent. Signing a request-supplied path turned this endpoint
      // into an oracle: `flha-reports` is one flat bucket shared by every
      // tenant with deterministic, second-granularity filenames, so a
      // caller could hand over another company's report path and get a
      // working signed URL back for it. Re-reading the row means the only
      // path that can be signed is the one this record actually points at.
      const { data: afterRows } = await supabaseAdmin.from(table.name).select('pdf_url').eq('id', id).limit(1);
      const storedPdfUrl = afterRows?.[0]?.pdf_url || null;
      const signedPdfUrl = storedPdfUrl ? await signStoredUrl(storedPdfUrl, 'flha-reports') : null;
      return res.status(200).json({ ok: true, pdfUrl: signedPdfUrl, pdfLinked });
    }

    // ── Supervisor / Admin: delete a report ──────────────────────────
    if (action === 'delete') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing record id.' });

      if (session.role === 'supervisor') {
        const { data: existing, error: findErr } = await supabaseAdmin.from(table.name).select('id, company_id, site_id, submitted_by_roster_id').eq('id', id).limit(1);
        if (findErr || !existing || existing.length === 0 || existing[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed to delete this record.' });
        }
        const delDenied = await requireRecordsAccess(supabaseAdmin, session, table.docKey, [existing[0]]);
        if (delDenied) return res.status(delDenied.status).json({ error: delDenied.error });
      }
      let deleteWrite = supabaseAdmin.from(table.name).delete().eq('id', id);
      if (session.role === 'supervisor') deleteWrite = deleteWrite.eq('company_id', session.companyId);
      const { error } = await deleteWrite;
      if (error) return res.status(500).json({ error: 'Delete failed.' });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
