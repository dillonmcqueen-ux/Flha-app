// api/flhas.js
// All FLHA database operations go through here now instead of straight from
// the browser. Every request must include a valid session token (the "pass"
// issued at login) and we double-check the caller is allowed to do what
// they're asking before touching the database.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { signRows } from '../server-lib/signedUrls.js';
import { createUploadUrl, storedUrlFromClientReceipt, receiptWasDropped } from '../server-lib/uploadUrls.js';

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
  // instead of waiting out the token's TTL. `name` rides along so the
  // resume/amend actions below can bind to the actual authenticated
  // identity instead of trusting whatever name the client sends, same as
  // api/logs.js's sign_late_toolbox.
  const { data: rows, error } = await supabaseAdmin
    .from('roster')
    .select('active, role, company_id, name')
    .eq('id', payload.userId)
    .limit(1);
  if (error || !rows || rows.length === 0 || !rows[0].active) return null;
  if (rows[0].company_id !== payload.companyId) return null;
  return { ...payload, role: rows[0].role, name: rows[0].name };
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

// docs/scope-company-brain.md Phase 3 — client-computed diff between the
// AI-generated hazard baseline and what actually got submitted. This is
// untrusted browser input (like `record` itself), so it's re-validated
// into a fixed shape here rather than trusted as-is before it's stored in
// company_signals — caps array lengths and coerces every value to a short
// string, same discipline as the AI-drafting code in
// server-lib/onboardingDrafting.js caps its own model output.
// Column allow-list for client-supplied record bodies (submit + amend).
// Without this, `{ ...record }` is a mass-assignment sink: a worker could
// set supervisor_signed_by/supervisor_signed_at to forge an approval the
// `approve` action is supposed to gate, or backdate created_at on an
// inspection that never happened. The `update` action has always
// whitelisted its fields for exactly this reason — submit and amend
// didn't, which is the drift this closes. Server-controlled columns
// (id, company_id, created_at, supervisor_signed_*) are absent on
// purpose: they are set by the server or not at all.
function pickAllowed(record, allowed) {
  const out = {};
  if (!record || typeof record !== 'object') return out;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
  }
  return out;
}

// `status` is deliberately absent: it is derived from hazards_json by
// deriveFlhaStatus() below, never taken from the client. The browser used to
// send it (src/App.jsx computes the same thing to drive its own UI), which
// meant the extreme-risk supervisor gate lived entirely in code the worker
// controls — posting `status: 'complete'` alongside an Extreme hazard marked
// the FLHA done and skipped sign-off. Server-side derivation is the gate.
const SUBMITTABLE_FIELDS = [
  'worker_name', 'job_site', 'task_description', 'hazards_json',
  'signed_by', 'pdf_url', 'worker_signature', 'crew_signatures',
];

// `hazards_json` arrives as untrusted client input. Coerce it to the plain
// `{ hazards: [...] }` object every reader expects (src/Dashboard.jsx,
// src/analyticsUtils.js, the PDF generators) before anything spreads it or
// derives status from it. Without this, a string or array payload spreads
// into a character-indexed object with no `hazards` key on the
// clientSubmissionId path below, and an Extreme-risk FLHA derives as
// 'complete' — the exact bypass deriveFlhaStatus exists to close.
// Returns { ok: false } for anything that isn't a plain object (or a string
// parsing to one); `value: null` means "no hazard payload supplied", which
// is a legitimate absence rather than malformed input.
// Exported for tests/unit/flha-status.test.js.
export function normalizeHazardsJson(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  let parsed = raw;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch (e) { return { ok: false, value: null }; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, value: null };
  return { ok: true, value: parsed };
}

// The extreme-risk approval rule, enforced server-side. Mirrors the client's
// `hasExtreme` check in src/App.jsx (resubmitFLHA + saveFLHA) — that copy
// still exists, but only to decide what the worker is shown; this one decides
// what is stored. An FLHA carrying any Extreme-risk hazard cannot reach
// 'complete' except through the `approve` action below, which is
// supervisor/admin-only. Matching is looser than the client's exact
// `=== "Extreme"` on purpose, so nothing the browser would gate slips past.
// Exported for tests/unit/flha-status.test.js.
export function deriveFlhaStatus(hazardsJson) {
  let parsed = hazardsJson;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch (e) { parsed = null; }
  }
  const hazards = parsed && Array.isArray(parsed.hazards) ? parsed.hazards : [];
  const hasExtreme = hazards.some(
    (h) => h && typeof h.risk === 'string' && h.risk.trim().toLowerCase() === 'extreme'
  );
  return hasExtreme ? 'pending_approval' : 'complete';
}

function sanitizeAiEditSignal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const strList = (arr) => (Array.isArray(arr) ? arr : [])
    .filter((v) => typeof v === 'string' && v.trim())
    .slice(0, 20)
    .map((v) => v.trim().slice(0, 200));
  const riskChanged = (Array.isArray(raw.riskChanged) ? raw.riskChanged : [])
    .filter((r) => r && typeof r === 'object' && typeof r.hazard === 'string')
    .slice(0, 20)
    .map((r) => ({
      hazard: r.hazard.trim().slice(0, 200),
      from: typeof r.from === 'string' ? r.from.slice(0, 20) : null,
      to: typeof r.to === 'string' ? r.to.slice(0, 20) : null,
    }));
  const added = strList(raw.added);
  const removed = strList(raw.removed);
  if (added.length === 0 && removed.length === 0 && riskChanged.length === 0) return null;
  return { added, removed, riskChanged };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ── Generated PDF uploads ────────────────────────────────────────
    // Mirrors the same action in api/logs.js, api/monthly.js,
    // api/customforms.js and api/reports.js. Added so src/generatePDF.js
    // can stop uploading with the browser's anon key: it was the last
    // caller in the codebase still doing a direct storage .upload(), and
    // it only worked because flha-reports carried a PUBLIC INSERT policy
    // on storage.objects — i.e. anyone could write to that bucket with no
    // session at all. Routing it through a service-role signed token here
    // lets that policy be dropped.
    if (action === 'create_upload_url') {
      const result = await createUploadUrl(supabaseAdmin, 'flha-reports', req.body.filename, session.companyId);
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true, path: result.path, uploadToken: result.uploadToken, receipt: result.receipt });
    }

    // ── Worker: find today's FLHA to resume/amend ─────────────────────
    if (action === 'resume') {
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { workerName } = req.body;
      // Individually-identified (roster) sessions have a real authenticated
      // name — use that instead of whatever the client sent, so a signed-in
      // worker can't resume/view a coworker's FLHA by typing their name. A
      // shared-code session has no such identity to bind to, so it keeps
      // the typed name (same pattern as api/logs.js's sign_late_toolbox).
      const matchName = session.name ? session.name.trim() : (workerName || '').trim();
      if (!matchName) return res.status(400).json({ error: 'Enter your name.' });

      const start = new Date(); start.setHours(0, 0, 0, 0);
      const { data, error } = await supabaseAdmin
        .from('flhas')
        .select('id, worker_name, job_site, hazards_json, created_at, worker_signature')
        .eq('company_id', session.companyId)
        .gte('created_at', start.toISOString())
        .order('created_at', { ascending: false });

      if (error) return res.status(500).json({ error: 'Something went wrong. Try again.' });
      const matches = (data || []).filter(
        f => (f.worker_name || '').trim().toLowerCase() === matchName.toLowerCase()
      );
      return res.status(200).json({ matches });
    }

    // ── Worker: submit a new FLHA or save an amendment ─────────────────
    if (action === 'submit') {
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { data: coRows } = await supabaseAdmin.from('companies').select('suspended').eq('id', session.companyId).limit(1);
      if (coRows && coRows[0] && coRows[0].suspended) {
        return res.status(403).json({ error: "Your company's access is suspended. Contact your administrator." });
      }
      const { amendingId, record, clientSubmissionId, aiEditSignal, workerName } = req.body;
      if (!record) return res.status(400).json({ error: 'Missing record.' });

      if (amendingId) {
        // Confirm this record actually belongs to the worker's own company first.
        const { data: existing, error: findErr } = await supabaseAdmin
          .from('flhas').select('id, company_id, worker_name, hazards_json, created_at').eq('id', amendingId).limit(1);
        if (findErr || !existing || existing.length === 0 || existing[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed to amend this record.' });
        }
        // Same-day only, matching the window `resume` above will even offer:
        // it lists today's records and nothing older, so the real client
        // never amends anything else. Enforced here because this action
        // takes `amendingId` directly — without it a worker could reach an
        // arbitrarily old record of their own and, now that an amendment
        // reverting to pending_approval clears the sign-off below, wipe a
        // supervisor signature off a months-old compliance record.
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        if (!existing[0].created_at || new Date(existing[0].created_at) < dayStart) {
          return res.status(403).json({ error: 'This FLHA is no longer open for amendment.' });
        }
        // Same identity check the `resume` action already applies when
        // deciding which of today's records a worker is even shown to amend
        // (only those matching their real name) — enforced here too, so a
        // worker can't reach a coworker's FLHA by supplying its id directly
        // instead of going through `resume`. Individually-identified
        // (roster) sessions are bound to their authenticated name, not
        // whatever `workerName` the client sends — a shared-code session
        // has no such identity, so it falls back to the typed name.
        const claimedName = session.name ? session.name.trim().toLowerCase() : (workerName || '').trim().toLowerCase();
        const ownerName = (existing[0].worker_name || '').trim().toLowerCase();
        if (!claimedName || claimedName !== ownerName) {
          return res.status(403).json({ error: 'Not allowed to amend this record.' });
        }
        const amendUpdate = pickAllowed(record, SUBMITTABLE_FIELDS);
        // Derive from the hazards being written; fall back to the hazards
        // already on the row when an amendment doesn't touch them.
        let amendedHazards;
        if (Object.prototype.hasOwnProperty.call(amendUpdate, 'hazards_json')) {
          const normalized = normalizeHazardsJson(amendUpdate.hazards_json);
          if (!normalized.ok) return res.status(400).json({ error: 'Invalid hazard data.' });
          amendUpdate.hazards_json = normalized.value;
          amendedHazards = normalized.value;
        } else {
          amendedHazards = normalizeHazardsJson(existing[0].hazards_json).value;
        }
        let amendPdfLinked = true;
        if (Object.prototype.hasOwnProperty.call(amendUpdate, 'pdf_url')) {
          const submitted = amendUpdate.pdf_url;
          amendUpdate.pdf_url = storedUrlFromClientReceipt(submitted, session.companyId);
          amendPdfLinked = !receiptWasDropped(submitted, amendUpdate.pdf_url);
        }
        amendUpdate.status = deriveFlhaStatus(amendedHazards);
        if (amendUpdate.status === 'pending_approval') {
          // An amendment that (re)introduces Extreme risk sends the record
          // back for sign-off, so any earlier supervisor signature no longer
          // applies to what the record now says. Leaving it in place would
          // show a supervisor's name against content they never approved.
          amendUpdate.supervisor_signed_by = null;
          amendUpdate.supervisor_signed_at = null;
        }
        // The 403 above already proved this row belongs to the caller's
        // company; the redundant company_id filter is so a future reordering
        // of that check can't silently turn this into a cross-tenant write.
        const { error } = await supabaseAdmin
          .from('flhas').update(amendUpdate).eq('id', amendingId).eq('company_id', session.companyId);
        if (error) return res.status(500).json({ error: 'Save failed. Try again.' });
        return res.status(200).json({ id: amendingId, status: amendUpdate.status, pdfLinked: amendPdfLinked });
      } else {
        // Idempotency (docs/scope-offline-capability.md Phase 1) — a queued
        // offline FLHA gets retried, possibly more than once. Only applies
        // to a fresh submission, not an amendment (amendments are out of
        // offline scope — see the scope doc's open question 4). Embedded in
        // hazards_json rather than a new column, same reasoning as
        // api/reports.js and api/logs.js.
        if (clientSubmissionId) {
          const { data: existingRows } = await supabaseAdmin
            .from('flhas')
            .select('id')
            .eq('company_id', session.companyId)
            .eq('hazards_json->>client_submission_id', clientSubmissionId)
            .limit(1);
          if (existingRows && existingRows.length > 0) {
            return res.status(200).json({ id: existingRows[0].id });
          }
        }
        const recordToInsert = pickAllowed(record, SUBMITTABLE_FIELDS);
        const normalized = normalizeHazardsJson(recordToInsert.hazards_json);
        if (!normalized.ok) return res.status(400).json({ error: 'Invalid hazard data.' });
        if (clientSubmissionId) {
          recordToInsert.hazards_json = { ...(normalized.value || {}), client_submission_id: clientSubmissionId };
        } else if (Object.prototype.hasOwnProperty.call(recordToInsert, 'hazards_json')) {
          recordToInsert.hazards_json = normalized.value;
        }
        // pdf_url arrives as an upload receipt, not a URL the browser
        // assembled. storedUrlFromClientReceipt turns it into the path this
        // server actually issued, so a caller can't store another company's
        // report path and have a list endpoint sign it for them later.
        let pdfLinked = true;
        if (Object.prototype.hasOwnProperty.call(recordToInsert, 'pdf_url')) {
          const submitted = recordToInsert.pdf_url;
          recordToInsert.pdf_url = storedUrlFromClientReceipt(submitted, session.companyId);
          pdfLinked = !receiptWasDropped(submitted, recordToInsert.pdf_url);
        }
        recordToInsert.status = deriveFlhaStatus(recordToInsert.hazards_json);
        const { data, error } = await supabaseAdmin
          .from('flhas')
          .insert({ ...recordToInsert, company_id: session.companyId })
          .select('id, status')
          .limit(1);
        if (error) return res.status(500).json({ error: 'Save failed. Try again.' });
        const newId = data?.[0]?.id || null;

        // docs/scope-company-brain.md Phase 3 — best-effort signal capture,
        // never allowed to affect the FLHA submission itself: the worker's
        // record is already saved above by the time this runs, and a
        // failure here is swallowed (logged, not thrown) rather than
        // turned into a 500 on an otherwise-successful submit.
        const signal = sanitizeAiEditSignal(aiEditSignal);
        if (signal && newId) {
          const { error: signalErr } = await supabaseAdmin.from('company_signals').insert({
            company_id: session.companyId,
            source_type: 'flha_edit',
            source_id: String(newId),
            signal_json: signal,
          });
          if (signalErr) console.error('company_signals insert failed for FLHA', newId, signalErr.message);
        }

        return res.status(200).json({ id: newId, status: data?.[0]?.status || null, pdfLinked });
      }
    }

    // ── Supervisor / Admin: load FLHAs for the dashboard ────────────────
    if (action === 'list') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      let query = supabaseAdmin
        .from('flhas')
        .select('id, worker_name, job_site, created_at, hazards_json, signed_by, company_id, pdf_url, status, supervisor_signed_by, supervisor_signed_at, worker_signature')
        .order('created_at', { ascending: false });
      if (session.role === 'supervisor') query = query.eq('company_id', session.companyId);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: 'Could not load records.' });
      const flhas = await signRows(supabaseAdmin, data, [{ key: 'pdf_url', bucket: 'flha-reports' }]);
      return res.status(200).json({ flhas });
    }

    // ── Supervisor / Admin: correct an existing FLHA's content ──────────
    // Distinct from the `submit` + `amendingId` path above, which is the
    // worker-only, same-day, additive "amend" flow (restricted only by the
    // client only ever offering today's own-name matches — see `resume`).
    // This is the general fix-a-mistake tool: any supervisor/admin, any
    // record in their company, any day. Only the fields that actually feed
    // the PDF are whitelisted, so a client can't smuggle company_id,
    // status, or supervisor sign-off fields through `fields`.
    if (action === 'update') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id, fields, pdfUrl } = req.body;
      if (!id || !fields || typeof fields !== 'object') return res.status(400).json({ error: 'Missing details.' });

      // Fetched for every caller now, not just supervisors: the approval
      // re-derivation below needs to know whether this record already carries
      // a supervisor signature.
      const { data: existing, error: findErr } = await supabaseAdmin
        .from('flhas').select('id, company_id, supervisor_signed_at').eq('id', id).limit(1);
      // One indistinguishable 403 for "no such record" and "not your
      // company's record", same as before — a supervisor shouldn't be able to
      // probe which ids exist outside their own company.
      if (findErr || !existing || existing.length === 0
          || (session.role === 'supervisor' && existing[0].company_id !== session.companyId)) {
        return res.status(403).json({ error: 'Not allowed to edit this record.' });
      }

      const EDITABLE_FIELDS = ['worker_name', 'job_site', 'hazards_json'];
      const update = {};
      for (const key of EDITABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(fields, key)) update[key] = fields[key];
      }
      if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No editable fields provided.' });
      const resolvedPdfUrl = storedUrlFromClientReceipt(pdfUrl, session.companyId);
      if (resolvedPdfUrl) update.pdf_url = resolvedPdfUrl;
      const pdfLinked = !receiptWasDropped(pdfUrl, resolvedPdfUrl);

      // `hazards_json` is the column the approval gate reads, so an edit here
      // has to re-derive status the same way a worker's submit does —
      // otherwise a supervisor raising a hazard to Extreme leaves the record
      // sitting at 'complete' with nobody ever signing it. Escalate only:
      // a record that already carries a supervisor signature keeps its
      // approval, so fixing a typo on an approved extreme-risk FLHA doesn't
      // silently revoke the sign-off that's already on it.
      if (Object.prototype.hasOwnProperty.call(update, 'hazards_json')) {
        const normalized = normalizeHazardsJson(update.hazards_json);
        if (!normalized.ok) return res.status(400).json({ error: 'Invalid hazard data.' });
        update.hazards_json = normalized.value;
        const derived = deriveFlhaStatus(normalized.value);
        if (derived === 'complete' || !existing[0].supervisor_signed_at) update.status = derived;
      }

      const { error } = await supabaseAdmin.from('flhas').update(update).eq('id', id);
      if (error) return res.status(500).json({ error: 'Update failed.' });
      // Sign the pdf_url now stored on the row, not the `pdfUrl` string the
      // client sent. Signing a request-supplied path turned this endpoint
      // into an oracle: `flha-reports` is one flat bucket shared by every
      // tenant with deterministic, second-granularity filenames, so a
      // caller could hand over another company's report path and get a
      // working signed URL back for it. Re-reading the row means the only
      // path that can be signed is the one this record actually points at.
      const { data: afterRows } = await supabaseAdmin.from('flhas').select('pdf_url, status').eq('id', id).limit(1);
      const storedPdfUrl = afterRows?.[0]?.pdf_url || null;
      const signedPdfUrl = storedPdfUrl ? await signStoredUrl(storedPdfUrl, 'flha-reports') : null;
      return res.status(200).json({ ok: true, pdfUrl: signedPdfUrl, status: afterRows?.[0]?.status || null, pdfLinked });
    }

    // ── Supervisor / Admin: delete one or more FLHAs ────────────────────
    if (action === 'delete') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { ids } = req.body;
      if (!ids || !ids.length) return res.status(400).json({ error: 'No records specified.' });

      if (session.role === 'supervisor') {
        const { data: existing, error: findErr } = await supabaseAdmin.from('flhas').select('id, company_id').in('id', ids);
        if (findErr) return res.status(500).json({ error: 'Delete failed.' });
        const notOwned = (existing || []).some(r => r.company_id !== session.companyId);
        if (notOwned) return res.status(403).json({ error: 'Not allowed to delete some of these records.' });
      }
      const { error } = await supabaseAdmin.from('flhas').delete().in('id', ids);
      if (error) return res.status(500).json({ error: 'Delete failed.' });
      return res.status(200).json({ ok: true });
    }

    // ── Supervisor / Admin: approve an extreme-risk FLHA ────────────────
    if (action === 'approve') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id, supName, supSignature, pdfUrl } = req.body;
      if (!id || !supName || !supSignature) return res.status(400).json({ error: 'Missing approval details.' });

      if (session.role === 'supervisor') {
        const { data: existing, error: findErr } = await supabaseAdmin.from('flhas').select('id, company_id').eq('id', id).limit(1);
        if (findErr || !existing || existing.length === 0 || existing[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed to approve this record.' });
        }
      }
      const now = new Date().toISOString();
      const update = { status: 'complete', supervisor_signed_by: supName, supervisor_signed_at: now };
      const resolvedPdfUrl = storedUrlFromClientReceipt(pdfUrl, session.companyId);
      if (resolvedPdfUrl) update.pdf_url = resolvedPdfUrl;
      const pdfLinked = !receiptWasDropped(pdfUrl, resolvedPdfUrl);
      const { error } = await supabaseAdmin.from('flhas').update(update).eq('id', id);
      if (error) return res.status(500).json({ error: 'Approval failed.' });
      // Sign the pdf_url now stored on the row, not the `pdfUrl` string the
      // client sent. Signing a request-supplied path turned this endpoint
      // into an oracle: `flha-reports` is one flat bucket shared by every
      // tenant with deterministic, second-granularity filenames, so a
      // caller could hand over another company's report path and get a
      // working signed URL back for it. Re-reading the row means the only
      // path that can be signed is the one this record actually points at.
      const { data: afterRows } = await supabaseAdmin.from('flhas').select('pdf_url').eq('id', id).limit(1);
      const storedPdfUrl = afterRows?.[0]?.pdf_url || null;
      const signedPdfUrl = storedPdfUrl ? await signStoredUrl(storedPdfUrl, 'flha-reports') : null;
      return res.status(200).json({ ok: true, supervisor_signed_at: now, pdfUrl: signedPdfUrl, pdfLinked });
    }

    // ── Admin: count FLHAs per company (used on the onboarding console) ─
    if (action === 'count') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { data, error } = await supabaseAdmin.from('flhas').select('id, company_id');
      if (error) return res.status(500).json({ error: 'Could not load counts.' });
      const counts = {};
      (data || []).forEach(f => { counts[f.company_id] = (counts[f.company_id] || 0) + 1; });
      return res.status(200).json({ counts });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
