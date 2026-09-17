// api/logs.js
// Handles Equipment Inspections (pre-trip + post-trip), Toolbox Talks, and
// Daily Reports — submitting, viewing, and deleting — with the same
// session checks as the other protected endpoints.

import { createClient } from '@supabase/supabase-js';
import { authorRosterId } from '../server-lib/authorStamp.js';
import { resolveSiteId } from '../server-lib/siteScope.js';
import { resolveEquipmentId } from '../server-lib/equipmentScope.js';
import { openCorrectiveActions, correctiveActionsFromInspection } from '../server-lib/correctiveActions.js';
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
  // instead of waiting out the token's TTL. `name` rides along so
  // sign_late_toolbox below can bind a late signature to the actual
  // authenticated identity instead of trusting whatever name the client
  // sends, for companies where the session actually identifies a person.
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

const TABLES = {
  inspection: {
    name: 'inspections',
    jsonColumn: 'results_json',
    listColumns: 'id, worker_name, equipment_label, created_at, results_json, signed_by, company_id, pdf_url, trip_type, linked_inspection_id, start_reading, end_reading, reading_unit, has_changes',
  },
  toolbox: {
    name: 'toolbox_talks',
    jsonColumn: 'talking_points_json',
    listColumns: 'id, presenter_name, meeting_type, site, site_id, topic, talking_points_json, attendees_json, company_id, pdf_url, created_at',
  },
  daily: {
    name: 'daily_reports',
    jsonColumn: 'report_json',
    listColumns: 'id, reporter_name, site, site_id, report_date, weather, temperature, crew, equipment, visitors, report_json, company_id, pdf_url, created_at',
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

const SUBMITTABLE_FIELDS = {
  inspection: ['worker_name', 'equipment_label', 'equipment_id', 'results_json', 'signed_by', 'pdf_url', 'trip_type', 'linked_inspection_id', 'start_reading', 'end_reading', 'reading_unit', 'has_changes'],
  // Break #2 — `site` (the text the form resolved from its dropdown) stays;
  // `site_id` is the joinable half, validated against the caller's company
  // in the submit path before it is trusted.
  toolbox: ['presenter_name', 'meeting_type', 'site', 'site_id', 'topic', 'talking_points_json', 'attendees_json', 'pdf_url'],
  daily: ['reporter_name', 'site', 'site_id', 'report_date', 'weather', 'temperature', 'crew', 'equipment', 'visitors', 'report_json', 'pdf_url'],
};

// Extracts the exceptions from one inspection's results_json for the Brain.
// `items` carries every checklist line as { item, category, condition },
// where condition is one of Good / Monitor / Defective / N/A — only the
// last two are worth learning from. Returns null when the machine came
// back clean, so a spotless inspection writes no row at all rather than a
// row full of empty arrays.
//
// Caps mirror the other signal writers: short strings, bounded arrays, so
// one inspection of a long checklist can never dominate the batch prompt
// in server-lib/companyBrainSummary.js.
const MAX_SIGNAL_ITEMS = 12;

export function inspectionFindingSignal(record) {
  const results = record && typeof record.results_json === 'object' ? record.results_json : null;
  if (!results) return null;
  const items = Array.isArray(results.items) ? results.items : [];

  const named = (condition) => items
    .filter((i) => i && i.condition === condition && typeof i.item === 'string' && i.item.trim())
    .map((i) => i.item.trim().slice(0, 200))
    .slice(0, MAX_SIGNAL_ITEMS);

  const defective = named('Defective');
  const monitor = named('Monitor');
  if (defective.length === 0 && monitor.length === 0) return null;

  const signal = { defective, monitor };
  // The machine is the whole point of the signal — "hydraulic leak" means
  // something different on an excavator than on a pickup. equipment_label
  // is free text, which is why break #7 in docs/feature-interaction-map.md
  // exists, but it is what the record carries and it is still the best
  // available description of what was inspected.
  const label = typeof record.equipment_label === 'string' ? record.equipment_label.trim().slice(0, 200) : '';
  if (label) signal.equipment = label;
  return signal;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, action, token } = req.body || {};

  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ── Generated PDF uploads for inspections, toolbox talks, daily reports ─
    if (action === 'create_upload_url') {
      const result = await createUploadUrl(supabaseAdmin, 'flha-reports', req.body.filename, session.companyId);
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true, path: result.path, uploadToken: result.uploadToken, receipt: result.receipt });
    }

    const table = TABLES[type];
    if (!table) return res.status(400).json({ error: 'Unknown record type.' });

    // ── Worker: check a piece of equipment before starting an inspection ─
    // Only applies to inspections. Returns:
    //  - openPretrip: a pre-trip from TODAY on this machine with no matching
    //    post-trip yet (so the worker can be offered "do the post-trip")
    //  - lastInspection: the most recent inspection of any kind on this
    //    machine, so we can flag if it had defects/monitor items
    if (action === 'check_equipment') {
      if (type !== 'inspection') return res.status(400).json({ error: 'Not applicable for this record type.' });
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { equipmentLabel } = req.body;
      if (!equipmentLabel) return res.status(400).json({ error: 'Missing equipment.' });

      const { data, error } = await supabaseAdmin
        .from('inspections')
        .select('id, worker_name, equipment_label, created_at, results_json, trip_type, linked_inspection_id, start_reading, end_reading, reading_unit, has_changes')
        .eq('company_id', session.companyId)
        .eq('equipment_label', equipmentLabel)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) return res.status(500).json({ error: 'Could not check equipment history.' });

      const rows = data || [];
      const lastInspection = rows[0] || null;

      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const pretripsToday = rows.filter(r => (r.trip_type || 'pretrip') === 'pretrip' && new Date(r.created_at) >= startOfDay);
      const openPretrip = pretripsToday.find(pt =>
        !rows.some(r => r.trip_type === 'posttrip' && r.linked_inspection_id === pt.id)
      ) || null;

      return res.status(200).json({ openPretrip, lastInspection });
    }

    // ── Worker: submit a new record ─────────────────────────────────
    if (action === 'submit') {
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { data: coRows } = await supabaseAdmin.from('companies').select('suspended').eq('id', session.companyId).limit(1);
      if (coRows && coRows[0] && coRows[0].suspended) {
        return res.status(403).json({ error: "Your company's access is suspended. Contact your administrator." });
      }
      const { record, clientSubmissionId } = req.body;
      if (!record) return res.status(400).json({ error: 'Missing record.' });

      // Idempotency (docs/scope-offline-capability.md Phase 1) — see the
      // matching comment in api/reports.js for why this rides inside the
      // existing jsonb column instead of a new one.
      if (clientSubmissionId && table.jsonColumn) {
        const { data: existingRows } = await supabaseAdmin
          .from(table.name)
          .select('id')
          .eq('company_id', session.companyId)
          .eq(`${table.jsonColumn}->>client_submission_id`, clientSubmissionId)
          .limit(1);
        if (existingRows && existingRows.length > 0) {
          return res.status(200).json({ id: existingRows[0].id });
        }
      }

        // pdf_url arrives as an upload receipt, not a URL the browser
        // assembled. storedUrlFromClientReceipt turns it into the path this
        // server actually issued, so a caller can't store another company's
        // report path and have a list endpoint sign it for them later.
      const recordToInsert = pickAllowed(record, SUBMITTABLE_FIELDS[type] || []);

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

      // Same question for equipment_id, which has been submittable on an
      // inspection all along but unchecked — api/fuellogs.js guarded its
      // copy of this column, this handler never did. Break #7 made the
      // column load-bearing (it is now the grouping key for weekly
      // equipment reports), so an unowned id here would attach one
      // company's inspection to another company's machine and carry that
      // id into a stored report. See server-lib/equipmentScope.js.
      if (Object.prototype.hasOwnProperty.call(recordToInsert, 'equipment_id')) {
        const resolvedEquipmentId = await resolveEquipmentId(supabaseAdmin, session.companyId, recordToInsert.equipment_id);
        if (resolvedEquipmentId === false) return res.status(403).json({ error: 'Not allowed for this equipment.' });
        recordToInsert.equipment_id = resolvedEquipmentId;
      }
      let pdfLinked = true;
      if (Object.prototype.hasOwnProperty.call(recordToInsert, 'pdf_url')) {
        const submittedPdf = recordToInsert.pdf_url;
        recordToInsert.pdf_url = storedUrlFromClientReceipt(submittedPdf, session.companyId);
        pdfLinked = !receiptWasDropped(submittedPdf, recordToInsert.pdf_url);
      }
      if (clientSubmissionId && table.jsonColumn) {
        recordToInsert[table.jsonColumn] = { ...(recordToInsert[table.jsonColumn] || {}), client_submission_id: clientSubmissionId };
      }

      const { data, error } = await supabaseAdmin
        .from(table.name)
        // Break #3 — the author comes from the session, never the request.
        // Deliberately not in SUBMITTABLE_FIELDS: an author a caller can
        // choose is a suggestion, not attribution.
        .insert({ ...recordToInsert, company_id: session.companyId, submitted_by_roster_id: authorRosterId(session) })
        .select('id')
        .limit(1);
      if (error) return res.status(500).json({ error: 'Save failed. Try again.' });
      const newId = data?.[0]?.id || null;

      // docs/scope-company-brain.md Phase 3 — log each toolbox talk's topic
      // as a company_signals row, same best-effort discipline as
      // api/flhas.js's FLHA-edit signal: never allowed to affect the
      // submission itself, which is already saved by the time this runs.
      if (newId && type === 'toolbox') {
        const topic = (typeof record.topic === 'string' && record.topic.trim()) ? record.topic.trim().slice(0, 200) : null;
        if (topic) {
          const { error: signalErr } = await supabaseAdmin.from('company_signals').insert({
            company_id: session.companyId,
            source_type: 'toolbox_talk',
            source_id: String(newId),
            signal_json: { topic },
          });
          if (signalErr) console.error('company_signals insert failed for toolbox talk', newId, signalErr.message);
        }
      }

      // Equipment inspections were left out of Phase 3's original signal
      // set. They are the richest company-specific signal the product
      // collects — which checks actually fail, on which machines — and the
      // Brain was blind to all of it while learning from FLHA edits and
      // toolbox talks submitted through this very same handler.
      //
      // Only the exceptions are signal. A checklist of thirty "Good" items
      // says nothing a profile should emphasize; the two that came back
      // Defective do. Same best-effort discipline as every other writer
      // here: the inspection is already saved, and a failure below is
      // logged, never turned into a failed submit.
      //
      // Daily reports still produce no signal: their content is weather,
      // crew and visitor free text with no structured finding to extract.
      if (newId && type === 'inspection') {
        const signal = inspectionFindingSignal(record);
        if (signal) {
          const { error: signalErr } = await supabaseAdmin.from('company_signals').insert({
            company_id: session.companyId,
            source_type: 'equipment_inspection',
            source_id: String(newId),
            signal_json: signal,
          });
          if (signalErr) console.error('company_signals insert failed for inspection', newId, signalErr.message);
        }
      }

      // Break #5 — a Defective item on an inspection is a finding somebody
      // has to act on, and until now there was nowhere for it to go: it sat
      // in results_json and showed on the inspection record, but never
      // became an assignable, ageable item the way a failed monthly
      // question does.
      //
      // Only Defective opens an action. "Monitor" is an operator saying
      // "keep an eye on this", and turning every one of those into a tracked
      // row would bury the real defects — see the note in
      // server-lib/correctiveActions.js. Monitor items still reach the Brain
      // and still show on the inspection itself.
      //
      // Best-effort, same as the signal writer above: the inspection is
      // already saved, and failures are logged inside the helper.
      if (newId && type === 'inspection') {
        await openCorrectiveActions(supabaseAdmin, {
          companyId: session.companyId,
          sourceType: 'equipment_inspection',
          sourceId: newId,
          descriptions: correctiveActionsFromInspection(record.results_json, record.equipment_label),
        });
      }

      return res.status(200).json({ id: newId, pdfLinked });
    }

    // ── Supervisor / Admin: load records for the dashboard ──────────
    if (action === 'list') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      let query = supabaseAdmin.from(table.name).select(table.listColumns).order('created_at', { ascending: false });
      if (session.role === 'supervisor') query = query.eq('company_id', session.companyId);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: 'Could not load records.' });
      const records = await signRows(supabaseAdmin, data, [{ key: 'pdf_url', bucket: 'flha-reports' }]);
      return res.status(200).json({ records });
    }

    // ── Supervisor / Admin: delete a record ──────────────────────────
    if (action === 'delete') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing record id.' });

      if (session.role === 'supervisor') {
        const { data: existing, error: findErr } = await supabaseAdmin.from(table.name).select('id, company_id').eq('id', id).limit(1);
        if (findErr || !existing || existing.length === 0 || existing[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed to delete this record.' });
        }
      }
      const { error } = await supabaseAdmin.from(table.name).delete().eq('id', id);
      if (error) return res.status(500).json({ error: 'Delete failed.' });
      return res.status(200).json({ ok: true });
    }

    // ── Supervisor / Admin: correct the submitted content of a record ──
    // General "fix a mistake" edit, distinct from the toolbox-only
    // sign_late_toolbox action below (which only ever appends a signature).
    // Only the fields that actually feed the PDF are whitelisted per type,
    // so a client can never smuggle company_id, attendees_json (signatures),
    // etc. through `fields`. Same tenant-ownership re-check as
    // `delete`/`sign_late_toolbox`.
    if (action === 'update') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id, fields, pdfUrl } = req.body;
      if (!id || !fields || typeof fields !== 'object') return res.status(400).json({ error: 'Missing details.' });

      if (session.role === 'supervisor') {
        const { data: existing, error: findErr } = await supabaseAdmin.from(table.name).select('id, company_id').eq('id', id).limit(1);
        if (findErr || !existing || existing.length === 0 || existing[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed to edit this record.' });
        }
      }

      const EDITABLE_FIELDS = {
        inspection: ['results_json', 'start_reading', 'end_reading', 'has_changes'],
        toolbox: ['presenter_name', 'meeting_type', 'site', 'topic', 'talking_points_json'],
        daily: ['reporter_name', 'site', 'report_date', 'weather', 'temperature', 'crew', 'equipment', 'visitors', 'report_json'],
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

      const { error } = await supabaseAdmin.from(table.name).update(update).eq('id', id);
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

    // ── Toolbox Talk: list recent talks someone can still sign ──────
    // Anyone who missed a talk (or a supervisor helping them find it) picks
    // from the last two weeks for their own company — no pre-registered
    // "expected attendees" list, so this works the same for shared-code and
    // individually-identified companies alike.
    if (action === 'list_open_toolbox') {
      if (type !== 'toolbox') return res.status(400).json({ error: 'Not applicable for this record type.' });
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabaseAdmin
        .from('toolbox_talks')
        .select('id, presenter_name, meeting_type, site, topic, attendees_json, created_at')
        .eq('company_id', session.companyId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) return res.status(500).json({ error: 'Could not load recent toolbox talks.' });
      const talks = (data || []).map(t => ({ ...t, signedCount: (t.attendees_json || []).length }));
      return res.status(200).json({ talks });
    }

    // ── Toolbox Talk: full detail for the sign-later confirm screen ─
    if (action === 'get_toolbox_detail') {
      if (type !== 'toolbox') return res.status(400).json({ error: 'Not applicable for this record type.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing record id.' });
      const { data, error } = await supabaseAdmin.from('toolbox_talks').select('*').eq('id', id).limit(1);
      if (error || !data || data.length === 0) return res.status(404).json({ error: 'Toolbox talk not found.' });
      const record = data[0];
      if (record.company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });
      record.pdf_url = await signStoredUrl(record.pdf_url, 'flha-reports');
      const { data: coRows } = await supabaseAdmin.from('companies').select('id, name, logo_url').eq('id', record.company_id).limit(1);
      return res.status(200).json({ record, company: coRows && coRows[0] });
    }

    // ── Toolbox Talk: add a late signature to an existing talk ──────
    if (action === 'sign_late_toolbox') {
      if (type !== 'toolbox') return res.status(400).json({ error: 'Not applicable for this record type.' });
      const { id, name, signature, pdfUrl } = req.body;
      if (!id || !name || !signature) return res.status(400).json({ error: 'Missing details.' });

      const { data: rows, error: findErr } = await supabaseAdmin.from('toolbox_talks').select('id, company_id, attendees_json').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Toolbox talk not found.' });
      const existing = rows[0];
      if (existing.company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });

      // Individually-identified (roster) sessions have a real authenticated
      // name — use that instead of whatever the client sent, so a signed-in
      // worker can't attach a late signature under a coworker's name. A
      // shared-code session has no such identity to bind to (same as the
      // paper sign-in sheet this replaces), so it keeps the typed name.
      const attendeeName = session.name ? session.name : name.trim();
      const attendees = [...(existing.attendees_json || []), {
        name: attendeeName,
        signature,
        signedLate: true,
        signedAt: new Date().toISOString(),
      }];
      const update = { attendees_json: attendees };
      const resolvedPdfUrl = storedUrlFromClientReceipt(pdfUrl, session.companyId);
      if (resolvedPdfUrl) update.pdf_url = resolvedPdfUrl;
      const pdfLinked = !receiptWasDropped(pdfUrl, resolvedPdfUrl);
      const { error } = await supabaseAdmin.from('toolbox_talks').update(update).eq('id', id);
      if (error) return res.status(500).json({ error: 'Could not save your signature. Try again.' });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
