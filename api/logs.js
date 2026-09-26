// api/logs.js
// Handles Equipment Inspections (pre-trip + post-trip), Toolbox Talks, and
// Daily Reports — submitting, viewing, and deleting — with the same
// session checks as the other protected endpoints.

import { createClient } from '@supabase/supabase-js';
import { authorRosterId } from '../server-lib/authorStamp.js';
import { resolveSiteId } from '../server-lib/siteScope.js';
import { resolveEquipmentId, resolveEquipmentIds } from '../server-lib/equipmentScope.js';
import { sanitizeSignerRosterIds } from '../server-lib/rosterSignerScope.js';
import { openCorrectiveActions, correctiveActionsFromInspection, resolvedItemsFromPosttrip, resolveCorrectiveActionsForItems, groupFindingsByMachine } from '../server-lib/correctiveActions.js';
import crypto from 'crypto';
import { createUploadUrl, storedUrlFromClientReceipt, receiptWasDropped } from '../server-lib/uploadUrls.js';
import { signRows } from '../server-lib/signedUrls.js';
import { requireDocKey } from '../server-lib/docKeyGate.js';

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
    docKey: 'inspection',
    jsonColumn: 'results_json',
    listColumns: 'id, worker_name, equipment_label, created_at, results_json, signed_by, company_id, pdf_url, trip_type, linked_inspection_id, start_reading, end_reading, reading_unit, has_changes, submitted_by_roster_id',
  },
  toolbox: {
    name: 'toolbox_talks',
    docKey: 'toolbox',
    jsonColumn: 'talking_points_json',
    listColumns: 'id, presenter_name, meeting_type, site, site_id, topic, talking_points_json, attendees_json, supervisor_notes_json, company_id, pdf_url, created_at, submitted_by_roster_id',
  },
  daily: {
    name: 'daily_reports',
    docKey: 'daily',
    jsonColumn: 'report_json',
    listColumns: 'id, reporter_name, site, site_id, report_date, weather, temperature, crew, equipment, equipment_ids, visitors, report_json, company_id, pdf_url, created_at, submitted_by_roster_id',
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
  // `equipment` (the comma-joined text the form built) stays authoritative
  // for display and PDFs; `equipment_ids` is the joinable half, vetted
  // against the caller's own fleet below exactly like site_id and
  // equipment_id are. Same producer/consumer split as break #2.
  daily: ['reporter_name', 'site', 'site_id', 'report_date', 'weather', 'temperature', 'crew', 'equipment', 'equipment_ids', 'visitors', 'report_json', 'pdf_url'],
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

  // A post-trip now carries a full checklist, so this reads both halves of a
  // trip where it used to see only the pre-trip (a post-trip's results_json
  // had no `items` at all). That is a real gain — the Brain finally sees
  // what breaks DURING a shift, not just what was already broken before it
  // started — but it brings a double-count with it: a defect the pre-trip
  // reported and the post-trip confirms is still there is ONE fault on ONE
  // machine, and tallying it twice would make whatever a machine breaks most
  // often look twice as common as it is.
  //
  // So a carried-forward item is only signal when its condition CHANGED
  // during the shift. Unchanged means the pre-trip already told the Brain.
  // Same rule server-lib/correctiveActions.js applies to opening a second
  // action for the same unfixed fault, for the same reason.
  const contributes = (i) => !i.carriedFrom || i.condition !== i.carriedCondition;

  const named = (condition) => items
    .filter((i) => i && i.condition === condition && typeof i.item === 'string' && i.item.trim() && contributes(i))
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

// The conditions a company actually works in — break #4's daily-report half.
//
// PR #118 left daily reports out, and the reasoning held: their content is
// crew, visitor and narrative free text with no structured finding to
// extract, and feeding raw prose to the Brain dilutes the signal that makes
// a profile company-specific.
//
// Two of their fields are not prose. `weather` is a pick from a fixed
// seven-value list in src/DailyReport.jsx, joined for storage; `temperature`
// is typed but parses to a number. Together they are the ONE thing no other
// document type tells the Brain: a company working at -35 in an Alberta
// winter should get cold-stress hazards in its generated FLHAs, and today
// nothing anywhere carries that.
//
// Crew, visitors and the narrative stay out, deliberately. This is the
// structured half of a mostly-unstructured document, not the whole thing.
const WEATHER_VOCAB = ['Clear', 'Cloudy', 'Rain', 'Snow', 'Windy', 'Hot', 'Cold'];

// Mirrors src/DailyReport.jsx's WEATHER list. Anything outside it is
// dropped rather than tallied, so a future free-text weather field cannot
// quietly turn this into a prose signal.
export function dailyConditionsSignal(record) {
  if (!record) return null;
  const raw = typeof record.weather === 'string' ? record.weather : '';
  const conditions = raw
    .split(',')
    .map((w) => w.trim())
    .filter((w) => WEATHER_VOCAB.includes(w));

  // Free text like "18°C", "-35", "minus 20". Take the first signed number
  // and nothing else; a value that does not parse is simply absent rather
  // than guessed at.
  const tempRaw = typeof record.temperature === 'string' ? record.temperature : '';
  const match = tempRaw.match(/-?\d+(?:\.\d+)?/);
  const temperature = match ? parseFloat(match[0]) : null;
  // Sanity bound: a typo like "180" is not a jobsite temperature, and a
  // tallied nonsense band would be worse than no band at all.
  const inRange = temperature != null && temperature >= -60 && temperature <= 60;

  if (conditions.length === 0 && !inRange) return null;

  const signal = {};
  // Deduped: the vocabulary is closed, so "Snow, Snow, Snow" carries no more
  // information than "Snow" — but api/companydata.js bumps the tally once per
  // element, so without this one daily report could add 12 to a single
  // condition's count and skew its own company's Brain profile.
  if (conditions.length > 0) signal.conditions = [...new Set(conditions)].slice(0, MAX_SIGNAL_ITEMS);
  if (inRange) {
    signal.temperature = temperature;
    // Banded as well as raw, because what a profile should emphasize is
    // "they work in extreme cold", not "the mean was -18.4".
    signal.tempBand = temperature <= -20 ? 'extreme_cold'
      : temperature <= 0 ? 'freezing'
      : temperature >= 30 ? 'extreme_heat'
      : 'moderate';
  }
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
      // Deliberately ungated: this mints a signed upload slot inside the
      // caller's own company namespace and is reached before the record
      // type is known, so there is no doc key to check. The submit that
      // would use the uploaded file IS gated, which is where a company
      // without the module is stopped.
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
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
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
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
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

      // Same question again for the daily report's list of machines. A
      // daily report names everything that was on site that day, so the
      // joinable half is an array — one unowned id in it is the same
      // tenancy problem as one unowned id on an inspection.
      if (Object.prototype.hasOwnProperty.call(recordToInsert, 'equipment_ids')) {
        const resolvedEquipmentIds = await resolveEquipmentIds(supabaseAdmin, session.companyId, recordToInsert.equipment_ids);
        if (resolvedEquipmentIds === false) return res.status(403).json({ error: 'Not allowed for this equipment.' });
        recordToInsert.equipment_ids = resolvedEquipmentIds;
      }

      // Break #31 — a Toolbox Talk attendee's rosterId is client-asserted;
      // strip any that don't actually belong to this company's roster
      // before it's stored and treated as verified. See rosterSignerScope.js.
      if (Object.prototype.hasOwnProperty.call(recordToInsert, 'attendees_json')) {
        recordToInsert.attendees_json = await sanitizeSignerRosterIds(supabaseAdmin, session.companyId, recordToInsert.attendees_json);
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

      // Break #4's daily-report half — see dailyConditionsSignal above for
      // what is extracted and what is deliberately left out. Same
      // best-effort discipline as every other writer here: the report is
      // already saved, and a failure below is logged, never turned into a
      // failed submit.
      if (newId && type === 'daily') {
        const signal = dailyConditionsSignal(recordToInsert);
        if (signal) {
          const { error: signalErr } = await supabaseAdmin.from('company_signals').insert({
            company_id: session.companyId,
            source_type: 'daily_report',
            source_id: String(newId),
            signal_json: signal,
          });
          if (signalErr) console.error('company_signals insert failed for daily report', newId, signalErr.message);
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
        // recordToInsert.equipment_id is the VETTED id — resolveEquipmentId
        // above already rejected another company's machine and nulled a
        // non-existent one. Reading record.equipment_id here instead would
        // put a client-supplied id straight into the column that decides
        // which machine a pattern belongs to.
        const host = { equipmentId: recordToInsert.equipment_id ?? null, equipmentLabel: recordToInsert.equipment_label ?? null };
        const findings = correctiveActionsFromInspection(record.results_json, record.equipment_label);
        const fixed = recordToInsert.trip_type === 'posttrip' ? resolvedItemsFromPosttrip(record.results_json) : [];

        // Break #17: an attachment's defect belongs to the attachment. Its
        // id comes from results_json, which is client jsonb, so it is vetted
        // against this company's fleet the same way daily reports vet theirs.
        // A foreign or unknown id is dropped to null (label only), never
        // stored; a failed lookup does the same rather than failing a submit.
        const attachmentIds = [...findings, ...fixed].map(f => f.attachment?.id).filter(id => id != null);
        const vetted = attachmentIds.length > 0 ? await resolveEquipmentIds(supabaseAdmin, session.companyId, attachmentIds) : null;
        const vettedIds = new Set(Array.isArray(vetted) ? vetted.map(String) : []);

        for (const group of groupFindingsByMachine(findings, host, vettedIds)) {
          await openCorrectiveActions(supabaseAdmin, {
            companyId: session.companyId,
            sourceType: 'equipment_inspection',
            sourceId: newId,
            descriptions: group.findings,
            equipmentId: group.equipmentId,
            equipmentLabel: group.equipmentLabel,
          });
        }

        // ── The other half of the loop: a post-trip that clears a defect ──
        //
        // Dillon, 2026-09-17: "if the person marks the post trip as the issue
        // no longer exists, it can be marked in corrective actions as
        // resolved and logged as a repair."
        //
        // Two writes, in this order and not the other way round. The
        // corrective action is the supervisor-facing record and the one that
        // must be right; the repair line is the machine's history. If the
        // repair log fails we would rather have a closed action with no
        // service line than an open action the worker was told they had
        // closed.
        // Resolved per machine, for the same reason actions are opened per
        // machine: the forks' fixed tine closes the forks' action and logs
        // the repair on the forks, not on the loader that carried them.
        for (const { equipmentId: machineId, equipmentLabel: machineLabel, findings: fixedHere } of groupFindingsByMachine(fixed, host, vettedIds)) {
          if (fixedHere.length > 0) {
            // session.name / session.userName, never a name from the body.
            // Who repaired a machine is attribution, and attribution a
            // caller can choose is a suggestion — the same rule break #3
            // settled for document authorship.
            const who = (session.name || session.userName || '').trim() || 'Worker';
            const noteText = fixedHere
              .map((f) => (f.note ? `${f.item} — ${f.note}` : f.item))
              .join('; ');

            const closed = await resolveCorrectiveActionsForItems(supabaseAdmin, {
              companyId: session.companyId,
              equipmentId: machineId,
              equipmentLabel: machineLabel,
              itemKeys: fixedHere.map((f) => f.itemKey),
              resolvedBy: who,
              note: noteText,
              resolutionSource: 'posttrip',
            });

            // The repair line only exists for a fleet-registered machine:
            // equipment_maintenance_log.equipment_id is a real FK and a
            // free-text machine has no row to point at. That machine's
            // history still lives on its corrective actions, which is the
            // same graceful degradation equipment_id has everywhere else.
            //
            // entry_type is 'field_service', NEVER 'pm_service'. A worker
            // saying "the tire's fixed" must not reset the machine's
            // preventative-maintenance clock — see
            // docs/scope-equipment-service-log.md for why that would be
            // strictly worse than not logging it at all.
            if (closed.length > 0 && machineId != null) {
              const { error: repairErr } = await supabaseAdmin.from('equipment_maintenance_log').insert({
                company_id: session.companyId,
                equipment_id: machineId,
                entry_type: 'field_service',
                service_date: new Date().toISOString().slice(0, 10),
                // Deliberately no reading. The post-trip's end_reading is a
                // meter reading for the trip, not for the repair, and
                // service_reading is what a PM baseline would be measured
                // from if one ever read these rows by mistake.
                service_reading: null,
                reading_unit: null,
                performed_by: who,
                logged_by_roster_id: session.userId || null,
                notes: `Repaired on post-trip: ${noteText}`.slice(0, 1000),
              });
              if (repairErr) console.error('post-trip repair log insert failed for inspection', newId, repairErr.message);
            }
          }
        }
      }

      return res.status(200).json({ id: newId, pdfLinked });
    }

    // ── Supervisor / Admin: load records for the dashboard ──────────
    if (action === 'list') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
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
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
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
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const { id, fields, pdfUrl } = req.body;
      if (!id || !fields || typeof fields !== 'object') return res.status(400).json({ error: 'Missing details.' });

      // A company supervisor can no longer correct the generated document
      // itself on a toolbox talk — only add a note (see `add_toolbox_note`
      // below). The presenter already gets a real edit pass before
      // submitting (src/ToolboxTalk.jsx's review step), so a supervisor
      // silently rewriting the talk afterward would make the submitted
      // record no longer the one the crew actually signed. The founder-only
      // admin role (session.role === 'admin') is unaffected — it keeps the
      // same "fix a mistake" edit every other document type has.
      if (type === 'toolbox' && session.role === 'supervisor') {
        return res.status(403).json({ error: 'Supervisors can add a note to a toolbox talk but can\'t edit the generated document. Use "Add Note" instead.' });
      }

      if (session.role === 'supervisor') {
        const { data: existing, error: findErr } = await supabaseAdmin.from(table.name).select('id, company_id').eq('id', id).limit(1);
        if (findErr || !existing || existing.length === 0 || existing[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed to edit this record.' });
        }
      }

      const EDITABLE_FIELDS = {
        inspection: ['results_json', 'start_reading', 'end_reading', 'has_changes'],
        toolbox: ['presenter_name', 'meeting_type', 'site', 'topic', 'talking_points_json'],
        // `equipment_ids` is deliberately NOT editable here. This edit is a
        // supervisor correcting the free-text summary on a submitted
        // report; the ids record which fleet machines the worker actually
        // picked in the field, and letting a text edit silently rewrite
        // that would make the joinable half less trustworthy than the text
        // it exists to back up. A wrong machine is a re-submit, not a typo.
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
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
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
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
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

    // ── Toolbox Talk: supervisor/admin adds a note (never edits the talk) ──
    // Deliberately separate from `update` above: a note is always additive
    // and never touches talking_points_json, presenter_name, site, etc. —
    // the generated (and presenter-edited-before-submit) document stays
    // exactly what was submitted. Both roles can add one; only `update`
    // distinguishes admin from supervisor.
    if (action === 'add_toolbox_note') {
      if (type !== 'toolbox') return res.status(400).json({ error: 'Not applicable for this record type.' });
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const { id, note } = req.body;
      if (!id || typeof note !== 'string' || !note.trim()) return res.status(400).json({ error: 'Missing note.' });

      const { data: rows, error: findErr } = await supabaseAdmin.from('toolbox_talks').select('id, company_id, supervisor_notes_json').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Toolbox talk not found.' });
      const existing = rows[0];
      // Admin sessions carry companyId: null (api/login.js) — same reason
      // `delete`/`update` above only re-check company_id for `supervisor`.
      if (session.role === 'supervisor' && existing.company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed.' });
      }

      const notes = [...(existing.supervisor_notes_json || []), {
        // session.name rides along for individually-identified roster
        // sessions (see verifySession above) — never trust a name from the
        // request body for who wrote the note.
        author: (session.name || '').trim() || (session.role === 'admin' ? 'Admin' : 'Supervisor'),
        role: session.role,
        note: note.trim().slice(0, 2000),
        at: new Date().toISOString(),
      }];
      const { error } = await supabaseAdmin.from('toolbox_talks').update({ supervisor_notes_json: notes }).eq('id', id);
      if (error) return res.status(500).json({ error: 'Could not save note.' });
      return res.status(200).json({ ok: true, notes });
    }

    // ── Toolbox Talk: add a late signature to an existing talk ──────
    if (action === 'sign_late_toolbox') {
      if (type !== 'toolbox') return res.status(400).json({ error: 'Not applicable for this record type.' });
      const denied = await requireDocKey(supabaseAdmin, session, table.docKey);
      if (denied) return res.status(denied.status).json({ error: denied.error });
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
