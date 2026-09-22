// api/companydata.js
// Protected access to company reference data: SOPs, Sites, Equipment, and
// Custom Fields. These were previously read/written directly from the
// browser with the anon key — this endpoint lets us lock down RLS on
// those tables without breaking the app, since everything now goes
// through session-verified server logic instead.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { renderTimeClockReportPdf, timeClockReportFilename } from '../server-lib/reportPdfs.js';
import { buildTimeClockReportForCompanyWeek } from './timeclockreports.js';
import { randomToken, isValidEmail } from '../server-lib/onboardingHelpers.js';
import { EXPIRY_WARNING_DAYS, expiryStatus } from '../server-lib/compliance.js';
import { retiredEquipmentIds, withoutRetiredEquipment } from '../server-lib/equipmentScope.js';
import { siteOrigin, sendEmail } from '../server-lib/email.js';
import { requireDocKey } from '../server-lib/docKeyGate.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const WALLET_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — matches SESSION_TTL_MS since redeeming just mints an ordinary session

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
  // instead of waiting out the token's TTL.
  // `name` comes from the roster row, never from the token payload: a token
  // minted before someone's name was corrected would otherwise stamp the
  // old one onto whatever they did today. Matches api/maintenance.js's
  // verifySession, which resolves it the same way and for the same reason —
  // retire_equipment records who took a machine out of the fleet.
  const { data: rows, error } = await supabaseAdmin
    .from('roster')
    .select('active, role, company_id, name')
    .eq('id', payload.userId)
    .limit(1);
  if (error || !rows || rows.length === 0 || !rows[0].active) return null;
  if (rows[0].company_id !== payload.companyId) return null;
  return { ...payload, role: rows[0].role, name: rows[0].name };
}

// For any read/write scoped to a company: admins may act on any company
// they specify; supervisors and workers are always locked to their own
// session.companyId, regardless of what companyId they send.
// Every column a fleet row exposes. One list, so the supervisor fleet
// editor, the worker-facing pickers and the maintenance screens can never
// drift into showing different versions of the same machine.
const EQUIPMENT_COLUMNS = 'id, year, make, model, type, unit_number, serial_number, notes, pm_interval, is_attachment, retired_at, retired_by';

// Trims and caps a fleet text field. Unit numbers and serials end up on
// generated PDFs and in weekly-report grouping keys, so an unbounded string
// is a layout problem as much as a storage one.
function fleetText(value, max = 120) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// Doc types the compliance UI suggests. Free text rather than a check
// constraint on purpose (see the migration): the list is open-ended by
// industry. This only bounds the length.
function complianceDocType(value) {
  const t = fleetText(value, 40).toLowerCase();
  return t || 'other';
}

// The one way a machine is named. Same shape as src/Dashboard.jsx's
// machineLabel and api/maintenance.js:187 — the same unit has to read the
// same on the Compliance tab, in the overview banner and on the weekly
// report, or a supervisor sees two machines where there is one.
function machineLabel(eq) {
  if (!eq) return 'Unknown machine';
  const base = [eq.year, eq.make, eq.model, eq.type].filter(Boolean).join(' ');
  return (base || `Machine #${eq.id}`) + (eq.unit_number ? ` (Unit ${eq.unit_number})` : '');
}

// Whether another ACTIVE machine in the same company already answers to
// this asset/unit number, returning that machine's label so the error can
// name it. Returns '' when the number is free.
//
// Retired rows are deliberately excluded: reusing the unit number of a
// machine that was sold or scrapped is normal fleet practice, and blocking
// it would push people back to editing the retired row instead, which is
// how two different machines end up sharing one service history.
//
// Uniqueness is enforced here rather than by a database constraint because
// unit_number is optional and blank on plenty of existing rows — a unique
// index would either need a partial predicate that silently stops matching
// on a stray space, or would reject the second blank. This check treats
// blank as "no asset ID" and skips it entirely, which is the behaviour the
// weekly-report grouping in api/equipmentreports.js already assumes.
async function activeUnitNumberClash(companyId, unitNumber, excludeId) {
  const unit = fleetText(unitNumber, 40);
  if (!unit) return '';
  const { data, error } = await supabaseAdmin
    .from('equipment')
    .select('id, year, make, model, type, unit_number')
    .eq('company_id', companyId)
    .is('retired_at', null);
  // Fail open on a read error rather than block a legitimate edit over an
  // outage — the cost is a duplicate that a supervisor can still fix.
  if (error || !data) return '';
  const hit = data.find(e => e.id !== excludeId && fleetText(e.unit_number, 40).toLowerCase() === unit.toLowerCase());
  if (!hit) return '';
  return [hit.year, hit.make, hit.model, hit.type].filter(Boolean).join(' ') || `equipment #${hit.id}`;
}

function resolveCompanyId(session, requestedCompanyId) {
  if (session.role === 'admin') return requestedCompanyId || null;
  return session.companyId;
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

// Renders + uploads the PDF server-side (service role key, no anon-key
// storage write involved at all) the first time a report is viewed, and
// caches the resulting path on the row so later views skip straight to
// signing it. Returns the stored ("public"-shaped, never handed to a
// client as-is) URL, or null if rendering/upload failed.
async function ensureTimeClockReportPdf(report, companyName, companyLogo) {
  if (report.pdf_url) return report.pdf_url;
  try {
    const buffer = await renderTimeClockReportPdf({ report, companyName, companyLogo });
    const filename = timeClockReportFilename({ companyName, report });
    const { error } = await supabaseAdmin.storage.from('flha-reports').upload(filename, buffer, { contentType: 'application/pdf', upsert: true });
    if (error) return null;
    const { data: pub } = supabaseAdmin.storage.from('flha-reports').getPublicUrl(filename);
    const url = pub?.publicUrl || null;
    if (url) await supabaseAdmin.from('timeclock_reports').update({ pdf_url: url }).eq('id', report.id);
    return url;
  } catch (e) {
    return null;
  }
}

// Total active roster seats a plan tier allows — workers and supervisors
// combined, since both count as a "user" for billing.
const SEAT_CAP_BY_TIER = { basic: 10, advanced: 50 };

function genSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString('hex');
}

// No cross-member uniqueness check — login always resolves a specific
// roster row by name before the PIN is ever checked, so two people sharing
// a 4-digit PIN has no security impact, and skipping the check keeps this
// O(1) instead of re-hashing against every existing member on the roster.
function genPin() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

// ── Time Clock helpers ────────────────────────────────────────────────
// mondayOf/toISODate/isUniqueViolation stay here — the client-facing
// time-clock actions below (clock in/out, get_timeclock_report, etc.) use
// them directly. buildTimeClockReportForCompanyWeek moved to
// api/timeclockreports.js (imported above) since both this file's
// generate_time_report_now action and the weekly cron need it.

// Monday of the week containing `d` (ISO week, Monday start).
function mondayOf(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function isUniqueViolation(error) {
  return error && error.code === '23505';
}

// Normalises an employer's employee number. Trimmed and capped; the stored
// spelling is whatever the supervisor typed, because it is their number and
// it appears on their HRIS exports.
function employeeIdText(value) {
  return String(value == null ? '' : value).trim().slice(0, 60);
}

// Whether another roster row in the same company already carries this
// employee number, returning that person's name so the error can say who.
// Returns '' when the number is free.
//
// Unlike equipment asset IDs (activeUnitNumberClash above, which ignores
// retired machines because unit numbers get reused), this spans INACTIVE
// rows too: an employee number is not reused when someone leaves, and a
// future HRIS sync keying on it cannot tolerate two rows answering to one
// number. Somebody rehired keeps their row via reactivate_roster_member.
//
// A blank is not a collision — most rows will never have a number.
//
// The database enforces this as well (roster_company_employee_id_unique,
// partial and case-insensitive). This check exists to produce a message
// naming the person instead of a raw constraint error; the index is what
// makes it true under a race.
async function employeeIdClash(companyId, employeeId, excludeId) {
  const wanted = employeeIdText(employeeId).toLowerCase();
  if (!wanted) return '';
  const { data, error } = await supabaseAdmin
    .from('roster')
    .select('id, name, employee_id, active')
    .eq('company_id', companyId);
  // Fail open on a read error: the unique index still refuses a genuine
  // duplicate, so the cost is a worse error message, not a bad row.
  if (error || !data) return '';
  const hit = data.find(r => r.id !== excludeId && employeeIdText(r.employee_id).toLowerCase() === wanted);
  if (!hit) return '';
  return hit.active ? hit.name : `${hit.name} (deactivated)`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ══ COMPANY (branding-only, no codes/contact info) ═════════════════
    // These exist so the Dashboard and worker-facing forms never need to
    // query the companies table directly with the anon key — that table
    // also holds worker_code/supervisor_code (login credentials) and
    // contact info, none of which belong in these responses.

    // Admin: every company (for the multi-company selector). Supervisor:
    // just their own, as a one-element array — same shape either way so
    // Dashboard.jsx doesn't need to branch on role.
    if (action === 'list_companies_brief') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      let query = supabaseAdmin.from('companies').select('id, name, logo_url, plan_tier, roster_enabled').order('id');
      if (session.role === 'supervisor') query = query.eq('id', session.companyId);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: 'Could not load companies.' });
      return res.status(200).json({ companies: data || [] });
    }

    if (action === 'get_company_logo') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin.from('companies').select('logo_url').eq('id', companyId).limit(1);
      if (error) return res.status(500).json({ error: 'Could not load company.' });
      return res.status(200).json({ logo_url: (data && data[0] && data[0].logo_url) || '' });
    }

    // ══ ROSTER ═══════════════════════════════════════════════════════
    // Individually-named, individually-PIN'd workers and supervisors,
    // replacing the two shared company-wide codes. Deactivating one row
    // (below) cuts off exactly that person on their very next request —
    // verifySession live-checks `active` for any session carrying a
    // userId. Admins can manage any company's roster; supervisors only
    // their own, same resolveCompanyId pattern as everything else here.

    if (action === 'list_roster') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const { data: members, error } = await supabaseAdmin
        .from('roster')
        .select('id, name, role, active, last_login_at, deactivated_at, created_at, wallet_enabled, employee_id')
        .eq('company_id', companyId)
        .order('role', { ascending: true })
        .order('name', { ascending: true });
      if (error) return res.status(500).json({ error: 'Could not load roster.' });

      const { data: coRows, error: coErr } = await supabaseAdmin.from('companies').select('plan_tier').eq('id', companyId).limit(1);
      if (coErr) return res.status(500).json({ error: 'Could not load plan tier.' });
      const tier = (coRows && coRows[0] && coRows[0].plan_tier) || 'basic';
      const activeSeatCount = (members || []).filter(m => m.active).length;

      return res.status(200).json({ members: members || [], activeSeatCount, cap: SEAT_CAP_BY_TIER[tier] || SEAT_CAP_BY_TIER.basic, tier });
    }

    // Admin-only: { [companyId]: { total, active } } across all companies,
    // for the console's per-company seat-usage display.
    if (action === 'list_roster_counts') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { data, error } = await supabaseAdmin.from('roster').select('company_id, active');
      if (error) return res.status(500).json({ error: 'Could not load roster counts.' });
      const counts = {};
      (data || []).forEach(row => {
        if (!counts[row.company_id]) counts[row.company_id] = { total: 0, active: 0 };
        counts[row.company_id].total += 1;
        if (row.active) counts[row.company_id].active += 1;
      });
      return res.status(200).json({ counts });
    }

    if (action === 'add_roster_member') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const name = (req.body.name || '').trim();
      const role = req.body.role;
      if (!name) return res.status(400).json({ error: 'Enter a name.' });
      if (role !== 'worker' && role !== 'supervisor') return res.status(400).json({ error: 'Invalid role.' });

      const { data: coRows, error: coErr } = await supabaseAdmin.from('companies').select('plan_tier').eq('id', companyId).limit(1);
      if (coErr) return res.status(500).json({ error: 'Could not load plan tier.' });
      const tier = (coRows && coRows[0] && coRows[0].plan_tier) || 'basic';
      const cap = SEAT_CAP_BY_TIER[tier] || SEAT_CAP_BY_TIER.basic;

      const { data: activeRows, error: activeErr } = await supabaseAdmin.from('roster').select('id, name_normalized').eq('company_id', companyId).eq('active', true);
      if (activeErr) return res.status(500).json({ error: 'Could not check the roster.' });
      if ((activeRows || []).length >= cap) {
        return res.status(400).json({ error: `Seat limit reached for this plan (${cap} on ${tier === 'advanced' ? 'Advanced' : 'Basic'}). Upgrade the plan or deactivate someone first.` });
      }
      if ((activeRows || []).some(r => r.name_normalized === name.toLowerCase())) {
        return res.status(400).json({ error: `"${name}" is already active on this roster. Add a last initial to tell them apart.` });
      }

      // Optional. A company that has no employee numbers, or does not know
      // them yet, adds people exactly as before; set_roster_employee_id
      // below fills them in later, which is the path an existing roster
      // takes.
      const employeeId = employeeIdText(req.body.employeeId);
      if (employeeId) {
        const clash = await employeeIdClash(companyId, employeeId, null);
        if (clash) return res.status(409).json({ error: `Employee ID ${employeeId} already belongs to ${clash}.` });
      }

      const salt = genSalt();
      const pin = genPin();
      const { data, error } = await supabaseAdmin
        .from('roster')
        .insert({ company_id: companyId, name, role, pin_hash: hashPin(pin, salt), pin_salt: salt, employee_id: employeeId || null })
        .select('id, name, role, active, created_at, employee_id')
        .single();
      if (error) {
        if (isUniqueViolation(error)) return res.status(409).json({ error: `Employee ID ${employeeId} is already in use on this roster.` });
        console.error("roster add failed:", error.message);
        return res.status(500).json({ error: "Couldn't add to the roster. Try again." });
      }
      return res.status(200).json({ ok: true, member: data, pin });
    }

    // ── Onboarding wallet (Phase 4): a supervisor/admin creates the roster
    // row and emails the new hire a wallet-invite link directly — same seat
    // cap / name-collision checks as add_roster_member, plus an email
    // address and an auto-generated initial PIN the new hire replaces with
    // their own during onboarding (never emailed in plaintext). Delivery is
    // best-effort: sendEmail() is a no-op if RESEND_API_KEY isn't set, and a
    // send failure doesn't undo the roster row already created — the
    // supervisor can still fall back to the existing Admin Panel "Invite"
    // button for that person.
    if (action === 'onboard_new_employee') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const name = (req.body.name || '').trim();
      const role = req.body.role;
      const email = (req.body.email || '').trim();
      if (!name) return res.status(400).json({ error: 'Enter a name.' });
      if (role !== 'worker' && role !== 'supervisor') return res.status(400).json({ error: 'Invalid role.' });
      if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });

      const { data: coRows, error: coErr } = await supabaseAdmin.from('companies').select('name, plan_tier').eq('id', companyId).limit(1);
      if (coErr) return res.status(500).json({ error: 'Could not load plan tier.' });
      const companyName = (coRows && coRows[0] && coRows[0].name) || 'your employer';
      const tier = (coRows && coRows[0] && coRows[0].plan_tier) || 'basic';
      const cap = SEAT_CAP_BY_TIER[tier] || SEAT_CAP_BY_TIER.basic;

      const { data: activeRows, error: activeErr } = await supabaseAdmin.from('roster').select('id, name_normalized').eq('company_id', companyId).eq('active', true);
      if (activeErr) return res.status(500).json({ error: 'Could not check the roster.' });
      if ((activeRows || []).length >= cap) {
        return res.status(400).json({ error: `Seat limit reached for this plan (${cap} on ${tier === 'advanced' ? 'Advanced' : 'Basic'}). Upgrade the plan or deactivate someone first.` });
      }
      if ((activeRows || []).some(r => r.name_normalized === name.toLowerCase())) {
        return res.status(400).json({ error: `"${name}" is already active on this roster. Add a last initial to tell them apart.` });
      }

      // Same optional employee number as add_roster_member. A new hire is
      // the one moment somebody actually has the number to hand, so it is
      // offered here rather than only after the fact.
      const employeeId = employeeIdText(req.body.employeeId);
      if (employeeId) {
        const clash = await employeeIdClash(companyId, employeeId, null);
        if (clash) return res.status(409).json({ error: `Employee ID ${employeeId} already belongs to ${clash}.` });
      }

      const salt = genSalt();
      const pin = genPin(); // replaced by the new hire's own PIN during onboarding — never sent in this email
      const inviteToken = randomToken();
      const { data, error } = await supabaseAdmin
        .from('roster')
        .insert({
          company_id: companyId, name, role, email,
          employee_id: employeeId || null,
          pin_hash: hashPin(pin, salt), pin_salt: salt,
          wallet_enabled: true,
          wallet_invite_token: inviteToken,
          wallet_invite_token_expires_at: new Date(Date.now() + WALLET_INVITE_TTL_MS).toISOString(),
        })
        .select('id, name, role, email, created_at, employee_id')
        .single();
      if (error) {
        if (isUniqueViolation(error)) return res.status(409).json({ error: `Employee ID ${employeeId} is already in use on this roster.` });
        console.error("onboard_new_employee failed:", error.message);
        return res.status(500).json({ error: "Couldn't add to the roster. Try again." });
      }

      const inviteUrl = `${siteOrigin(req)}/wallet?token=${inviteToken}`;
      let emailSent = false;
      try {
        await sendEmail({
          to: email,
          subject: `Welcome to ${companyName} — let's get you set up with FORA`,
          text: `Hi ${name},\n\nWelcome to ${companyName}! Tap the link below to confirm your details and set up your own PIN — takes about a minute. You can add your safety tickets and a profile photo now, or anytime later.\n\nClick here to get started: ${inviteUrl}\n\nThis link is single-use and just for you. It doesn't require a password.\n\n— ${companyName}, via FORA`,
        });
        emailSent = true;
      } catch (e) {
        console.error('onboard_new_employee email failed:', e.message);
      }

      return res.status(200).json({ ok: true, member: data, inviteUrl, emailSent });
    }

    // Set or clear one person's employee number after the fact. This is the
    // path that matters: every roster already in production predates the
    // column, so the numbers get filled in on people who are already there
    // rather than at add time.
    //
    // Deliberately allowed on an INACTIVE member too. Somebody who left and
    // is coming back keeps their row and their number, and an HRIS export
    // being reconciled after the fact routinely names people who are no
    // longer active.
    if (action === 'set_roster_employee_id') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      const { data: rows, error: findErr } = await supabaseAdmin
        .from('roster').select('id, company_id, name').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Roster member not found.' });
      const member = rows[0];
      if (session.role === 'supervisor' && member.company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed to change this person.' });
      }

      // Blank clears it. That is a real thing to want: a number entered
      // against the wrong person has to be removable before it can be put
      // on the right one.
      const employeeId = employeeIdText(req.body.employeeId);
      if (employeeId) {
        const clash = await employeeIdClash(member.company_id, employeeId, member.id);
        if (clash) return res.status(409).json({ error: `Employee ID ${employeeId} already belongs to ${clash}.` });
      }

      const { data, error } = await supabaseAdmin
        .from('roster')
        .update({ employee_id: employeeId || null })
        .eq('id', member.id)
        .select('id, name, employee_id')
        .single();
      if (error) {
        if (isUniqueViolation(error)) return res.status(409).json({ error: `Employee ID ${employeeId} is already in use on this roster.` });
        console.error('set_roster_employee_id failed:', error.message);
        return res.status(500).json({ error: "Couldn't save that employee ID." });
      }
      return res.status(200).json({ ok: true, member: data });
    }

    if (action === 'deactivate_roster_member' || action === 'reactivate_roster_member') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      const { data: rows, error: findErr } = await supabaseAdmin.from('roster').select('id, company_id, role').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      const member = rows[0];
      if (session.role === 'supervisor' && member.company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed.' });
      }

      const activating = action === 'reactivate_roster_member';
      if (activating) {
        const { data: coRows, error: coErr } = await supabaseAdmin.from('companies').select('plan_tier').eq('id', member.company_id).limit(1);
        if (coErr) return res.status(500).json({ error: 'Could not load plan tier.' });
        const tier = (coRows && coRows[0] && coRows[0].plan_tier) || 'basic';
        const cap = SEAT_CAP_BY_TIER[tier] || SEAT_CAP_BY_TIER.basic;
        const { data: activeRows, error: activeErr } = await supabaseAdmin.from('roster').select('id').eq('company_id', member.company_id).eq('active', true);
        if (activeErr) return res.status(500).json({ error: 'Could not check the roster.' });
        if ((activeRows || []).length >= cap) {
          return res.status(400).json({ error: `Seat limit reached for this plan (${cap} on ${tier === 'advanced' ? 'Advanced' : 'Basic'}). Upgrade the plan or deactivate someone first.` });
        }
      }

      const updates = activating
        ? { active: true, deactivated_at: null, failed_pin_attempts: 0, pin_locked_until: null }
        : { active: false, deactivated_at: new Date().toISOString() };
      const { error } = await supabaseAdmin.from('roster').update(updates).eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't update." });
      return res.status(200).json({ ok: true });
    }

    if (action === 'reset_roster_pin') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      const { data: rows, error: findErr } = await supabaseAdmin.from('roster').select('id, company_id').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      if (session.role === 'supervisor' && rows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed.' });
      }

      const salt = genSalt();
      const pin = genPin();
      const { error } = await supabaseAdmin
        .from('roster')
        .update({ pin_hash: hashPin(pin, salt), pin_salt: salt, failed_pin_attempts: 0, pin_locked_until: null })
        .eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't reset the PIN." });
      return res.status(200).json({ ok: true, pin });
    }

    // ── Onboarding wallet (Phase 2): opt-in per roster row. Off by default
    // — see docs/schema/worker-certifications-migration.sql — so no
    // existing company suddenly exposes an upload flow it didn't ask for.
    if (action === 'toggle_wallet_enabled') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id, enabled } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      const { data: rows, error: findErr } = await supabaseAdmin.from('roster').select('id, company_id').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      if (session.role === 'supervisor' && rows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed.' });
      }

      const { error } = await supabaseAdmin.from('roster').update({ wallet_enabled: !!enabled }).eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't update." });
      return res.status(200).json({ ok: true });
    }

    // ── Generate a single-use onboarding-wallet invite link for one roster
    // member — same raw-token-stored-on-the-row pattern as
    // onboarding_requests.claim_token (see api/admin.js's get_claim_link).
    // The admin/supervisor copies and sends this themselves (roster has no
    // email address on file to send it to automatically); opening it
    // redeems the token for an ordinary session (api/login.js's
    // redeem_wallet_invite), same as if they'd typed their PIN.
    if (action === 'create_wallet_invite') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      const { data: rows, error: findErr } = await supabaseAdmin.from('roster').select('id, company_id, active, wallet_enabled').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      const member = rows[0];
      if (session.role === 'supervisor' && member.company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed.' });
      }
      if (!member.active) return res.status(400).json({ error: 'This person is deactivated.' });
      if (!member.wallet_enabled) return res.status(400).json({ error: 'Turn on the wallet for this person first.' });

      const inviteToken = randomToken();
      const { error } = await supabaseAdmin.from('roster').update({
        wallet_invite_token: inviteToken,
        wallet_invite_token_expires_at: new Date(Date.now() + WALLET_INVITE_TTL_MS).toISOString(),
      }).eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't create the invite link." });
      return res.status(200).json({ ok: true, inviteUrl: `${siteOrigin(req)}/wallet?token=${inviteToken}` });
    }

    // Admin-only: regenerate every active roster member's PIN in one shot
    // (e.g. after onboarding, or a security concern) — same one-time-reveal
    // rule as a single reset, just batched, with a plaintext PIN list handed
    // back exactly once and never persisted anywhere.
    if (action === 'regenerate_all_pins') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const { data: members, error: findErr } = await supabaseAdmin
        .from('roster')
        .select('id, name, role')
        .eq('company_id', companyId)
        .eq('active', true)
        .order('role', { ascending: true })
        .order('name', { ascending: true });
      if (findErr) return res.status(500).json({ error: 'Could not load roster.' });
      if (!members || members.length === 0) return res.status(400).json({ error: 'No active roster members to regenerate.' });

      const roster = [];
      for (const m of members) {
        const salt = genSalt();
        const pin = genPin();
        const { error } = await supabaseAdmin
          .from('roster')
          .update({ pin_hash: hashPin(pin, salt), pin_salt: salt, failed_pin_attempts: 0, pin_locked_until: null })
          .eq('id', m.id);
        if (error) return res.status(500).json({ error: `Couldn't regenerate the PIN for ${m.name}.` });
        roster.push({ id: m.id, name: m.name, role: m.role, pin });
      }
      return res.status(200).json({ ok: true, roster });
    }

    // Flips a company between the legacy shared-code login and the roster/PIN
    // login. Turning it ON requires at least one active worker and one
    // active supervisor already set up, so no one can strand a company with
    // no way to log in. Turning it OFF is always allowed — an instant,
    // lossless rollback since the legacy codes are never touched.
    if (action === 'set_roster_cutover') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const enabled = !!req.body.enabled;

      if (enabled) {
        const { data: activeRows, error: activeErr } = await supabaseAdmin.from('roster').select('role').eq('company_id', companyId).eq('active', true);
        if (activeErr) return res.status(500).json({ error: 'Could not check the roster.' });
        const hasWorker = (activeRows || []).some(r => r.role === 'worker');
        const hasSupervisor = (activeRows || []).some(r => r.role === 'supervisor');
        if (!hasWorker || !hasSupervisor) {
          return res.status(400).json({ error: 'Add at least one active worker and one active supervisor before switching over.' });
        }
      }

      const { error } = await supabaseAdmin.from('companies').update({ roster_enabled: enabled }).eq('id', companyId);
      if (error) return res.status(500).json({ error: "Couldn't update." });
      return res.status(200).json({ ok: true });
    }

    // ══ SOPs ═════════════════════════════════════════════════════════

    if (action === 'list_sops') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin.from('sops').select('id, policy_text').eq('company_id', companyId).order('id');
      if (error) return res.status(500).json({ error: 'Could not load SOPs.' });
      return res.status(200).json({ sops: data || [] });
    }

    if (action === 'add_sops') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { companyId, policies } = req.body;
      if (!companyId || !Array.isArray(policies) || policies.length === 0) return res.status(400).json({ error: 'Missing details.' });
      const rows = policies.filter(p => (p || '').trim()).map(policy_text => ({ company_id: companyId, policy_text: policy_text.trim() }));
      if (rows.length === 0) return res.status(400).json({ error: 'No valid policies.' });
      const { error } = await supabaseAdmin.from('sops').insert(rows);
      if (error) { console.error("sop policies add failed:", error.message); return res.status(500).json({ error: "Couldn't add policies. Try again." }); }
      return res.status(200).json({ ok: true, count: rows.length });
    }

    if (action === 'delete_sop') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });
      const { error } = await supabaseAdmin.from('sops').delete().eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't remove policy." });
      return res.status(200).json({ ok: true });
    }

    // Admin-only: returns { [companyId]: sopCount } across all companies,
    // for the console's completeness meter — avoids N calls to list_sops.
    if (action === 'list_sops_counts') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { data, error } = await supabaseAdmin.from('sops').select('company_id');
      if (error) return res.status(500).json({ error: 'Could not load SOP counts.' });
      const counts = {};
      (data || []).forEach(row => { counts[row.company_id] = (counts[row.company_id] || 0) + 1; });
      return res.status(200).json({ counts });
    }

    // ══ SITES ════════════════════════════════════════════════════════

    if (action === 'list_sites') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin.from('sites').select('id, name').eq('company_id', companyId).order('name');
      if (error) return res.status(500).json({ error: 'Could not load sites.' });
      return res.status(200).json({ sites: data || [] });
    }

    // Admins can add a site to any company. Workers/supervisors can add a
    // site to their OWN company only — this covers the "auto-save a newly
    // typed site" behavior in the worker-facing forms.
    if (action === 'add_site') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const name = (req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Enter a site name.' });

      const { data: existing } = await supabaseAdmin.from('sites').select('id, name').eq('company_id', companyId);
      if ((existing || []).some(s => (s.name || '').toLowerCase() === name.toLowerCase())) {
        return res.status(200).json({ ok: true, alreadyExists: true });
      }
      const { data, error } = await supabaseAdmin.from('sites').insert({ company_id: companyId, name }).select('id, name').single();
      if (error) { console.error("site add failed:", error.message); return res.status(500).json({ error: "Couldn't add site. Try again." }); }
      return res.status(200).json({ ok: true, site: data });
    }

    // Deleting a site used to fail with an unexplained 500 whenever anything
    // referenced it. Every foreign key into `sites` is NO ACTION (restrict),
    // so Postgres refused the delete and the generic error handler below
    // turned that into "Couldn't remove site." with no hint why. That was
    // already true for fuel logs, monthly inspections and custom documents
    // before break #2 added site_id to the five field forms; this widened it.
    //
    // Note the map originally recorded this as "delete_site leaves dangling
    // site_id references, where delete_equipment detaches first". That was
    // wrong: a restricting FK cannot leave a dangling reference. The real
    // failure was the opposite -- the delete simply never succeeded.
    //
    // So: detach what can be detached, and refuse clearly when it cannot.
    if (action === 'delete_site') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      // Establish which company the site belongs to before touching
      // anything. Admin is founder-only and cross-company by design, so this
      // is not a live hole today — but every detach below then filters on
      // that company too, so the loop cannot reach another tenant's rows
      // even if a future write path forgets the site guard. Without it the
      // detach relies on an invariant no constraint enforces.
      const { data: siteRows } = await supabaseAdmin.from('sites').select('id, company_id').eq('id', id).limit(1);
      const site = siteRows && siteRows[0];
      if (!site) return res.status(404).json({ error: 'Site not found.' });

      // These two columns are NOT NULL, so their records cannot be detached
      // from the site -- the site IS part of the record's identity there.
      // Refusing with a reason beats a 500, and beats deleting the records
      // out from under someone to satisfy a tidy-up.
      const blockers = [];
      const { count: monthlyCount } = await supabaseAdmin
        .from('inspection_records').select('id', { count: 'exact', head: true }).eq('site_id', id);
      if (monthlyCount) blockers.push(`${monthlyCount} monthly site inspection${monthlyCount === 1 ? '' : 's'}`);
      const { count: customCount } = await supabaseAdmin
        .from('custom_form_records').select('id', { count: 'exact', head: true }).eq('site_id', id);
      if (customCount) blockers.push(`${customCount} custom document${customCount === 1 ? '' : 's'}`);
      if (blockers.length > 0) {
        return res.status(400).json({
          error: `This site can't be removed — it has ${blockers.join(' and ')} filed against it. Those records would lose the site they belong to.`,
        });
      }

      // Everything else keeps its free-text site name, so detaching costs a
      // supervisor nothing visible: the record still says where it happened,
      // it just stops being joinable to a site that no longer exists. Same
      // shape as delete_equipment's inspections detach.
      // Non-atomic by nature: a failure partway through leaves some tables
      // detached and the site still present. That is recoverable — re-running
      // the delete finishes the job, and a detached row loses nothing a
      // supervisor can see because the text name survives — so it is
      // preferred over wrapping six statements in machinery this codebase
      // does not otherwise use. The error says to try again for that reason.
      for (const table of ['flhas', 'toolbox_talks', 'daily_reports', 'incidents', 'near_misses', 'fuel_logs']) {
        const { error: detachErr } = await supabaseAdmin
          .from(table).update({ site_id: null })
          .eq('site_id', id)
          .eq('company_id', site.company_id);
        if (detachErr) return res.status(500).json({ error: "Couldn't fully remove that site — try again." });
      }

      const { error } = await supabaseAdmin.from('sites').delete().eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't remove site." });
      return res.status(200).json({ ok: true });
    }

    // ══ EQUIPMENT ════════════════════════════════════════════════════

    // Retired machines are hidden unless the caller asks for them, so every
    // worker-facing picker (Inspection, DailyReport, FuelLog, FieldService)
    // drops a sold or scrapped unit the moment a supervisor retires it, with
    // no change needed on their side. Only the supervisor fleet editor and
    // the Admin Panel pass includeRetired — a retired machine keeps every
    // inspection, fuel log and service entry hanging off its id, which is
    // the entire reason retiring exists next to delete_equipment rather
    // than instead of it.
    if (action === 'list_equipment') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      let query = supabaseAdmin.from('equipment').select(EQUIPMENT_COLUMNS).eq('company_id', companyId);
      if (req.body.includeRetired !== true) query = query.is('retired_at', null);
      const { data, error } = await query.order('id');
      if (error) return res.status(500).json({ error: 'Could not load equipment.' });
      return res.status(200).json({ equipment: data || [] });
    }

    // Admins can add equipment to any company. Workers/supervisors can add
    // equipment to their OWN company only — this covers the "auto-save a
    // rental machine" behavior in Inspection.jsx.
    if (action === 'add_equipment') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { year, make, model, type, unitNumber } = req.body;
      if (!fleetText(make) && !fleetText(model) && !fleetText(type)) {
        return res.status(400).json({ error: 'Enter at least a make, model or type.' });
      }

      const unit = fleetText(unitNumber, 40);
      const clash = await activeUnitNumberClash(companyId, unit, null);
      if (clash) return res.status(409).json({ error: `Unit ${unit} is already used by ${clash}. Asset IDs have to be unique so readings and service history land on the right machine.` });

      const { data, error } = await supabaseAdmin.from('equipment').insert({
        company_id: companyId,
        year: fleetText(year, 10), make: fleetText(make), model: fleetText(model),
        type: fleetText(type), unit_number: unit,
        serial_number: fleetText(req.body.serialNumber, 60),
        notes: fleetText(req.body.notes, 500),
        is_attachment: req.body.isAttachment === true,
      }).select(EQUIPMENT_COLUMNS).limit(1);
      if (error) { console.error("equipment add failed:", error.message); return res.status(500).json({ error: "Couldn't add equipment. Try again." }); }
      return res.status(200).json({ ok: true, equipment: (data && data[0]) || null });
    }

    // Correcting a machine's details — the asset/unit number above all.
    //
    // Dillon, 2026-09-17: "the supervisor should be able to edit their fleet
    // including the asset id if needed." Until now the only way to fix a
    // typo'd unit number was delete_equipment + add_equipment, which detaches
    // every inspection filed against that machine and hard-deletes its whole
    // maintenance log. An edit keeps the row's id, so every reading, service
    // entry, corrective action and weekly report line stays attached.
    //
    // Only fields actually present in the body are written, so a caller that
    // knows about three columns cannot blank the two it has never heard of.
    if (action === 'update_equipment') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      const { data: eqRows, error: eqErr } = await supabaseAdmin
        .from('equipment').select('id, company_id, make, model, type, unit_number').eq('id', id).limit(1);
      if (eqErr || !eqRows || eqRows.length === 0) return res.status(404).json({ error: 'Equipment not found.' });
      const existing = eqRows[0];
      if (session.role === 'supervisor' && existing.company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed to change this equipment.' });
      }

      const has = (key) => Object.prototype.hasOwnProperty.call(req.body, key);
      const patch = {};
      if (has('year')) patch.year = fleetText(req.body.year, 10);
      if (has('make')) patch.make = fleetText(req.body.make);
      if (has('model')) patch.model = fleetText(req.body.model);
      if (has('type')) patch.type = fleetText(req.body.type);
      if (has('unitNumber')) patch.unit_number = fleetText(req.body.unitNumber, 40);
      if (has('serialNumber')) patch.serial_number = fleetText(req.body.serialNumber, 60);
      if (has('notes')) patch.notes = fleetText(req.body.notes, 500);
      if (has('isAttachment')) patch.is_attachment = req.body.isAttachment === true;
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to change.' });

      // A machine still needs something to call it by. Check the result of
      // the edit, not the body, so clearing `make` on a row that has a model
      // is fine and clearing the last one of the three is not.
      const after = { ...existing, ...patch };
      if (!fleetText(after.make) && !fleetText(after.model) && !fleetText(after.type)) {
        return res.status(400).json({ error: 'A machine needs at least a make, model or type.' });
      }

      if (patch.unit_number) {
        const clash = await activeUnitNumberClash(existing.company_id, patch.unit_number, existing.id);
        if (clash) return res.status(409).json({ error: `Unit ${patch.unit_number} is already used by ${clash}. Asset IDs have to be unique so readings and service history land on the right machine.` });
      }

      const { data, error } = await supabaseAdmin.from('equipment').update(patch).eq('id', existing.id).select(EQUIPMENT_COLUMNS).limit(1);
      if (error) { console.error('equipment update failed:', error.message); return res.status(500).json({ error: "Couldn't save this machine. Try again." }); }
      return res.status(200).json({ ok: true, equipment: (data && data[0]) || null });
    }

    // Retire / un-retire — the non-destructive half of removing a machine.
    //
    // Retiring takes a unit out of every worker-facing dropdown (see the
    // note on list_equipment) without touching a single row that references
    // it. Sold the skid steer, scrapped the trailer, gave the rental back:
    // this is that, and it is reversible by anyone who can do it.
    if (action === 'retire_equipment' || action === 'restore_equipment') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      const { data: eqRows, error: eqErr } = await supabaseAdmin
        .from('equipment').select('id, company_id, unit_number').eq('id', id).limit(1);
      if (eqErr || !eqRows || eqRows.length === 0) return res.status(404).json({ error: 'Equipment not found.' });
      if (session.role === 'supervisor' && eqRows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed to change this equipment.' });
      }

      const retiring = action === 'retire_equipment';

      // Bringing a machine back can collide with a unit number that was
      // reused after it left — which is a normal thing to do, and exactly
      // why the clash check only ever looks at ACTIVE rows.
      if (!retiring && eqRows[0].unit_number) {
        const clash = await activeUnitNumberClash(eqRows[0].company_id, eqRows[0].unit_number, eqRows[0].id);
        if (clash) return res.status(409).json({ error: `Unit ${eqRows[0].unit_number} is in use by ${clash} now. Change one of their asset IDs before bringing this machine back.` });
      }

      // `name` is the roster row's, never the request's — same rule as
      // api/maintenance.js's log_field_service attribution.
      const patch = retiring
        ? { retired_at: new Date().toISOString(), retired_by: fleetText(session.name || (session.role === 'admin' ? 'Admin' : 'Supervisor'), 80) }
        : { retired_at: null, retired_by: null };

      const { data, error } = await supabaseAdmin.from('equipment').update(patch).eq('id', eqRows[0].id).select(EQUIPMENT_COLUMNS).limit(1);
      if (error) return res.status(500).json({ error: retiring ? "Couldn't retire this machine." : "Couldn't bring this machine back." });
      return res.status(200).json({ ok: true, equipment: (data && data[0]) || null });
    }

    if (action === 'delete_equipment') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      // inspections.equipment_id is a real FK to this table (see the note
      // in api/maintenance.js). Deleting the equipment row out from under
      // it would either fail outright (FK violation, blocking the delete
      // entirely) or cascade-delete every inspection ever recorded against
      // this unit, depending on how the constraint is set up — neither is
      // acceptable, since a submitted inspection is a signed safety record
      // that must stay retrievable regardless of whether the equipment is
      // still in the fleet. Detach it explicitly first: each inspection
      // already carries its own equipment_label text snapshot (set at
      // submission time), so nulling the FK loses nothing the worker or
      // supervisor would see on that record, PDF, or in weekly reports.
      const { error: detachErr } = await supabaseAdmin.from('inspections').update({ equipment_id: null }).eq('equipment_id', id);
      if (detachErr) return res.status(500).json({ error: "Couldn't remove equipment." });

      // Maintenance log entries are meaningless without the equipment they
      // were serviced against and carry no equivalent label snapshot, so
      // remove them along with the unit rather than leave them stranded.
      await supabaseAdmin.from('equipment_maintenance_log').delete().eq('equipment_id', id);

      const { error } = await supabaseAdmin.from('equipment').delete().eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't remove equipment." });
      return res.status(200).json({ ok: true });
    }

    // ── Equipment compliance: CVIP, registration, insurance, anything ──
    //
    // The dates that take a machine off the road when they lapse. Nothing
    // in the product could warn about them before, because they had nowhere
    // to live — see docs/schema/equipment-fleet-management-migration.sql for
    // why this is its own table rather than three columns on `equipment`.
    //
    // Every action here scopes by company_id on the row itself, never by the
    // equipment_id the client sent: an id alone would let a caller read or
    // overwrite another company's expiry dates by guessing a number.

    if (action === 'list_equipment_compliance') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, 'equipment_compliance');
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin
        .from('equipment_compliance')
        .select('id, equipment_id, doc_type, label, expiry_date, notes, updated_at')
        .eq('company_id', companyId)
        .order('expiry_date', { ascending: true });
      if (error) return res.status(500).json({ error: 'Could not load compliance records.' });

      // Break #15: a sold machine's expired CVIP is not a compliance
      // problem the company still has. The add dropdown already offered
      // only active machines (src/Dashboard.jsx builds it from activeFleet)
      // while the list and its three stat tiles read everything, so
      // retiring a unit left its expiry rows counting against a fleet that
      // no longer includes it. Both of those tiles and the rows below them
      // are computed in the browser from this one array, so filtering here
      // keeps them agreeing by construction.
      //
      // The rows are not deleted and nothing is written: un-retiring the
      // machine brings its dates straight back.
      //
      // Asked only when there is something to filter, matching how
      // compliance_summary below resolves names only when there is
      // something to name: a company that tracks no expiry dates makes no
      // extra query and sees no change at all.
      const retired = (data && data.length) ? await retiredEquipmentIds(supabaseAdmin, companyId) : null;
      return res.status(200).json({ compliance: withoutRetiredEquipment(data || [], retired) });
    }

    // ── The same dates, as an alert instead of a screen ────────────────
    //
    // Break #14 in docs/feature-interaction-map.md: a CVIP that lapsed last
    // Tuesday was invisible unless somebody opened Equipment > Compliance.
    // This is the same shape as certification_summary in
    // api/certifications.js — expired + expiring-soon lists with counts,
    // names resolved in a second query only when there is something to
    // name — because FORA already solved this problem once for the other
    // expiry date it tracks, and the two should behave alike.
    //
    // Gated exactly like list_equipment_compliance above (supervisor or
    // admin, company-scoped): this surfaces data that was already readable
    // by the same callers, it does not widen who can see it. Since break
    // #19 gave compliance its own doc key and pricing module, and break #21
    // made the gate server-side, all four compliance actions also check
    // that the company actually has the module — see requireDocKey.
    if (action === 'compliance_summary') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, 'equipment_compliance');
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const { data, error } = await supabaseAdmin
        .from('equipment_compliance')
        .select('id, equipment_id, doc_type, label, expiry_date')
        .eq('company_id', companyId)
        .not('expiry_date', 'is', null)
        .order('expiry_date', { ascending: true });
      if (error) return res.status(500).json({ error: 'Could not load compliance status.' });

      // Filtered before anything is counted, using the same helper and the
      // same rule as list_equipment_compliance above -- see break #15. This
      // used to be the one place that deliberately did NOT filter retired
      // machines, because the Compliance tab did not either and a banner
      // counting 2 over a screen listing 3 is worse than either number
      // alone. Both sides filter now, so the two still answer the same.
      const retired = (data && data.length) ? await retiredEquipmentIds(supabaseAdmin, companyId) : null;
      const rows = withoutRetiredEquipment(data || [], retired);

      const expired = [];
      const expiringSoon = [];
      for (const row of rows) {
        const status = expiryStatus(row.expiry_date);
        if (status === 'expired') expired.push(row);
        else if (status === 'due_soon') expiringSoon.push(row);
      }

      // Named only when there is something to name, and only from THIS
      // company's fleet: the ids come off rows already scoped by
      // company_id, and the lookup is scoped again so a row pointing at
      // another company's machine (which the FK and the upsert's ownership
      // check both prevent, but which a hand-written row could still carry)
      // resolves to nothing rather than leaking that machine's name.
      let names = {};
      if (expired.length || expiringSoon.length) {
        const ids = [...new Set([...expired, ...expiringSoon].map(r => r.equipment_id).filter(id => id != null))];
        if (ids.length) {
          const { data: eqRows } = await supabaseAdmin
            .from('equipment')
            .select('id, year, make, model, type, unit_number')
            .eq('company_id', companyId)
            .in('id', ids);
          names = Object.fromEntries((eqRows || []).map(e => [String(e.id), machineLabel(e)]));
        }
      }

      const shape = (row) => ({
        id: row.id,
        equipmentId: row.equipment_id,
        equipmentName: names[String(row.equipment_id)] || 'Unknown machine',
        docType: row.doc_type,
        label: row.label,
        expiryDate: row.expiry_date,
      });

      return res.status(200).json({
        warningDays: EXPIRY_WARNING_DAYS,
        expiredCount: expired.length,
        expiringSoonCount: expiringSoon.length,
        expired: expired.map(shape),
        expiringSoon: expiringSoon.map(shape),
      });
    }

    if (action === 'upsert_equipment_compliance') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, 'equipment_compliance');
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { id, equipmentId, expiryDate } = req.body;

      // A date that isn't one would store as null and read back as "no
      // expiry", i.e. compliant — the wrong way for this to fail.
      const expiry = fleetText(expiryDate, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || Number.isNaN(new Date(expiry).getTime())) {
        return res.status(400).json({ error: 'Enter a valid expiry date.' });
      }

      const { data: eqRows, error: eqErr } = await supabaseAdmin
        .from('equipment').select('id, company_id').eq('id', equipmentId).limit(1);
      if (eqErr || !eqRows || eqRows.length === 0) return res.status(404).json({ error: 'Equipment not found.' });
      if (eqRows[0].company_id !== companyId) return res.status(403).json({ error: 'Not allowed.' });

      const row = {
        company_id: companyId,
        equipment_id: eqRows[0].id,
        doc_type: complianceDocType(req.body.docType),
        label: fleetText(req.body.label, 80) || null,
        expiry_date: expiry,
        notes: fleetText(req.body.notes, 300) || null,
        updated_at: new Date().toISOString(),
      };

      if (id) {
        // Scoped by company_id as well as id, so a guessed id updates
        // nothing rather than someone else's record.
        const { data, error } = await supabaseAdmin
          .from('equipment_compliance').update(row).eq('id', id).eq('company_id', companyId)
          .select('id, equipment_id, doc_type, label, expiry_date, notes, updated_at').limit(1);
        if (error) return res.status(500).json({ error: "Couldn't save that expiry date." });
        if (!data || data.length === 0) return res.status(404).json({ error: 'Compliance record not found.' });
        return res.status(200).json({ ok: true, record: data[0] });
      }

      const { data, error } = await supabaseAdmin
        .from('equipment_compliance').insert(row)
        .select('id, equipment_id, doc_type, label, expiry_date, notes, updated_at').limit(1);
      if (error) { console.error('compliance insert failed:', error.message); return res.status(500).json({ error: "Couldn't save that expiry date." }); }
      return res.status(200).json({ ok: true, record: (data && data[0]) || null });
    }

    if (action === 'delete_equipment_compliance') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, 'equipment_compliance');
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });
      const { error } = await supabaseAdmin
        .from('equipment_compliance').delete().eq('id', id).eq('company_id', companyId);
      if (error) return res.status(500).json({ error: "Couldn't remove that record." });
      return res.status(200).json({ ok: true });
    }

    // Turns preventative-maintenance tracking on/off for a piece of
    // equipment. Supervisors run this from the Dashboard's Maintenance tab
    // (whether that tab is even offered to them is controlled separately,
    // company-wide, by the admin's "Preventative Maintenance" toggle in the
    // Forms list — see BUILTIN_DOC_KEYS in api/customforms.js). Turning
    // tracking on for the first time requires a starting reading, which
    // becomes that equipment's maintenance-log baseline — status math in
    // api/maintenance.js never has to guess one.
    if (action === 'set_equipment_pm_interval') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, 'maintenance');
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const { id, pmInterval, startingReading, readingUnit } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      const { data: eqRows, error: eqErr } = await supabaseAdmin.from('equipment').select('id, company_id').eq('id', id).limit(1);
      if (eqErr || !eqRows || eqRows.length === 0) return res.status(404).json({ error: 'Equipment not found.' });
      if (session.role === 'supervisor' && eqRows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed to change this equipment.' });
      }

      const interval = pmInterval != null && pmInterval !== '' ? parseFloat(pmInterval) : null;
      if (interval != null && (Number.isNaN(interval) || interval <= 0)) {
        return res.status(400).json({ error: 'Enter a valid maintenance interval.' });
      }

      if (interval != null) {
        // Only a pm_service row counts as "already has a baseline". Without
        // this filter, a worker's field_service entry (a filter change, a
        // small repair) made before tracking was switched on would suppress
        // the starting baseline entirely: latestServiceByEquipment ignores
        // field entries, so the machine would report not_started forever
        // and never come due. Second of the two lines that make worker
        // logging safe — see docs/schema/equipment-field-service-migration.sql.
        const { data: existingLog } = await supabaseAdmin
          .from('equipment_maintenance_log')
          .select('id')
          .eq('equipment_id', id)
          .eq('entry_type', 'pm_service')
          .limit(1);
        if (!existingLog || existingLog.length === 0) {
          const reading = startingReading != null && startingReading !== '' ? parseFloat(startingReading) : null;
          if (reading == null || Number.isNaN(reading) || !(readingUnit || '').trim()) {
            return res.status(400).json({ error: 'Enter a starting reading and unit to begin tracking.' });
          }
          const { error: logErr } = await supabaseAdmin.from('equipment_maintenance_log').insert({
            company_id: eqRows[0].company_id,
            equipment_id: id,
            service_reading: reading,
            reading_unit: readingUnit.trim(),
            performed_by: `Baseline (tracking enabled by ${session.role === 'admin' ? 'Admin' : 'Supervisor'})`,
          });
          if (logErr) return res.status(500).json({ error: "Couldn't set starting reading." });
        }
      }

      const { error } = await supabaseAdmin.from('equipment').update({ pm_interval: interval }).eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't update maintenance tracking." });
      return res.status(200).json({ ok: true });
    }

    // ══ CUSTOM FIELDS ════════════════════════════════════════════════

    // docType is optional — when provided, filters to that document type
    // (used by worker-facing forms that only need their own fields).
    if (action === 'list_custom_fields') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      let query = supabaseAdmin.from('custom_fields').select('id, doc_type, label, field_type, options, required').eq('company_id', companyId).order('id');
      if (req.body.docType) query = query.eq('doc_type', req.body.docType);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: 'Could not load custom fields.' });
      return res.status(200).json({ fields: data || [] });
    }

    if (action === 'add_custom_field') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { companyId, docType, label, fieldType, options, required } = req.body;
      if (!companyId || !docType || !(label || '').trim()) return res.status(400).json({ error: 'Missing details.' });
      if (fieldType === 'dropdown' && !(options || '').trim()) return res.status(400).json({ error: 'Add dropdown options.' });
      const { error } = await supabaseAdmin.from('custom_fields').insert({
        company_id: companyId,
        doc_type: docType,
        label: label.trim(),
        field_type: fieldType || 'text',
        options: fieldType === 'dropdown' ? (options || '').trim() : '',
        required: !!required,
      });
      if (error) { console.error("custom field add failed:", error.message); return res.status(500).json({ error: "Couldn't add field. Try again." }); }
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete_custom_field') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });
      const { error } = await supabaseAdmin.from('custom_fields').delete().eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't remove field." });
      return res.status(200).json({ ok: true });
    }

    // ══ COMPANY PROFILE (docs/scope-company-brain.md, Phase 1) ═════════
    // company_profiles is written by two paths: the (not-yet-built) Phase 2
    // onboarding research pass, staged as status: 'draft'; and an admin's
    // own edit here, which is always authoritative and marks the row
    // 'confirmed'. Neither path may write hazard_emphasis directly to
    // anything that changes risk-rating logic — see the migration's column
    // comment and the Phase 4 note in the scope doc; this endpoint only
    // stores what it's given, the "never lowers the safety floor" rule is
    // enforced by how Phase 5's generation prompt consumes the field, not
    // here.

    if (action === 'get_company_profile') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin
        .from('company_profiles')
        .select('status, industry_inference, equipment_summary, terminology_notes, hazard_emphasis, last_summarized_at, updated_at')
        .eq('company_id', companyId)
        .limit(1);
      if (error) return res.status(500).json({ error: 'Could not load company profile.' });
      return res.status(200).json({ profile: (data && data[0]) || null });
    }

    if (action === 'update_company_profile') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      const { industryInference, equipmentSummary, terminologyNotes } = req.body;
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { error } = await supabaseAdmin
        .from('company_profiles')
        .upsert({
          company_id: companyId,
          status: 'confirmed',
          industry_inference: (industryInference || '').trim(),
          equipment_summary: (equipmentSummary || '').trim(),
          terminology_notes: (terminologyNotes || '').trim(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'company_id' });
      if (error) { console.error("company profile save failed:", error.message); return res.status(500).json({ error: "Couldn't save company profile. Try again." }); }
      return res.status(200).json({ ok: true });
    }

    // Phase 6 (docs/scope-company-brain.md) — a read-only aggregation of
    // company_signals for the Admin Panel's "Brain" tab: reuses the exact
    // same rows Phase 3 writes and Phase 4 reads, no separate pipeline.
    // Admin/supervisor only, like the other dashboard "list" actions in
    // this file — workers never see this (unlike get_company_profile
    // above, which worker-facing generation prompts also read).
    if (action === 'get_company_signal_trends') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const { data, error } = await supabaseAdmin
        .from('company_signals')
        .select('source_type, signal_json, created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) return res.status(500).json({ error: 'Could not load signal trends.' });

      // Every source_type any writer emits needs a key here, or the count
      // is silently dropped by the `!== undefined` guard below and the
      // signal becomes invisible in the Brain tab even though it is being
      // recorded and summarized. Writers today: api/flhas.js (flha_edit),
      // api/logs.js (toolbox_talk, equipment_inspection), api/reports.js
      // (incident, near_miss), api/monthly.js (monthly_inspection),
      // api/logs.js again (daily_report).
      const bySourceType = { flha_edit: 0, toolbox_talk: 0, incident: 0, near_miss: 0, equipment_inspection: 0, monthly_inspection: 0, daily_report: 0 };
      const tally = { addedHazards: {}, removedHazards: {}, toolboxTopics: {}, incidentCategories: {}, nearMissInvolved: {}, defectiveItems: {}, inspectedEquipment: {}, monthlyFailures: {}, workingConditions: {} };
      const bump = (map, key) => { if (key) map[key] = (map[key] || 0) + 1; };
      (data || []).forEach((row) => {
        const j = row.signal_json || {};
        if (bySourceType[row.source_type] !== undefined) bySourceType[row.source_type] += 1;
        if (row.source_type === 'flha_edit') {
          (j.added || []).forEach((h) => bump(tally.addedHazards, h));
          (j.removed || []).forEach((h) => bump(tally.removedHazards, h));
        } else if (row.source_type === 'toolbox_talk') {
          bump(tally.toolboxTopics, j.topic);
        } else if (row.source_type === 'incident') {
          bump(tally.incidentCategories, j.category);
        } else if (row.source_type === 'near_miss') {
          bump(tally.nearMissInvolved, j.involved);
        } else if (row.source_type === 'equipment_inspection') {
          // Defective and Monitor are tallied together: both are a check
          // that did not come back clean, and splitting them would halve
          // the counts that make a repeat offender visible.
          (j.defective || []).forEach((i) => bump(tally.defectiveItems, i));
          (j.monitor || []).forEach((i) => bump(tally.defectiveItems, i));
          bump(tally.inspectedEquipment, j.equipment);
        } else if (row.source_type === 'daily_report') {
          // Conditions and the temperature band are tallied together: both
          // answer "what does this company work in", and the band is what a
          // profile should emphasize rather than an average.
          (j.conditions || []).forEach((c) => bump(tally.workingConditions, c));
          if (j.tempBand && j.tempBand !== 'moderate') bump(tally.workingConditions, j.tempBand);
        } else if (row.source_type === 'monthly_inspection') {
          (j.failed || []).forEach((q) => bump(tally.monthlyFailures, q));
        }
      });
      const topN = (map, n = 8) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

      return res.status(200).json({
        totalSignals: (data || []).length,
        bySourceType,
        topAddedHazards: topN(tally.addedHazards),
        topRemovedHazards: topN(tally.removedHazards),
        topToolboxTopics: topN(tally.toolboxTopics),
        topIncidentCategories: topN(tally.incidentCategories),
        topWorkingConditions: topN(tally.workingConditions),
        topNearMissInvolved: topN(tally.nearMissInvolved),
        topDefectiveItems: topN(tally.defectiveItems),
        topInspectedEquipment: topN(tally.inspectedEquipment),
        topMonthlyFailures: topN(tally.monthlyFailures),
      });
    }

    // ── Time Clock: self-service (any registered roster user) ───────────
    //
    // Module gating here is deliberately partial (break #23). Everything that
    // creates or changes time-clock data requires the Time Clock + GPS module:
    // clock_in, edit/add/delete_time_entry and generate_time_report_now. Four
    // actions stay open on purpose:
    //   - clock_out and my_time_status, so a shift that was open when the
    //     company dropped the module can still be found and closed. Gating
    //     clock_out would leave it open forever.
    //   - list_time_entries, list_time_reports and get_time_report, so hours
    //     already recorded (payroll records) stay readable after cancelling.
    // Pinned by tests/unit/timeclock-gate.test.js.
    if (action === 'clock_in') {
      if (!session.userId) return res.status(403).json({ error: 'Not available for this login.' });
      const denied = await requireDocKey(supabaseAdmin, session, 'timeclock');
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const { lat, lng, accuracy } = req.body;
      const { error } = await supabaseAdmin.from('time_clock_entries').insert({
        company_id: session.companyId,
        roster_id: session.userId,
        clock_in_lat: typeof lat === 'number' ? lat : null,
        clock_in_lng: typeof lng === 'number' ? lng : null,
        clock_in_accuracy_m: typeof accuracy === 'number' ? accuracy : null,
      });
      if (error) {
        if (isUniqueViolation(error)) return res.status(400).json({ error: "You're already clocked in." });
        return res.status(500).json({ error: "Couldn't clock in." });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'clock_out') {
      if (!session.userId) return res.status(403).json({ error: 'Not available for this login.' });
      const { lat, lng, accuracy } = req.body;
      const { data: openRows, error: openErr } = await supabaseAdmin
        .from('time_clock_entries')
        .select('id')
        .eq('roster_id', session.userId)
        .is('clock_out', null)
        .limit(1);
      if (openErr) return res.status(500).json({ error: "Couldn't clock out." });
      if (!openRows || openRows.length === 0) return res.status(404).json({ error: "You're not clocked in." });
      const { error } = await supabaseAdmin.from('time_clock_entries').update({
        clock_out: new Date().toISOString(),
        clock_out_lat: typeof lat === 'number' ? lat : null,
        clock_out_lng: typeof lng === 'number' ? lng : null,
        clock_out_accuracy_m: typeof accuracy === 'number' ? accuracy : null,
      }).eq('id', openRows[0].id);
      if (error) return res.status(500).json({ error: "Couldn't clock out." });
      return res.status(200).json({ ok: true });
    }

    if (action === 'my_time_status') {
      if (!session.userId) return res.status(403).json({ error: 'Not available for this login.' });
      const { data: openRows } = await supabaseAdmin
        .from('time_clock_entries')
        .select('id, clock_in')
        .eq('roster_id', session.userId)
        .is('clock_out', null)
        .limit(1);
      const { data: recent, error: recentErr } = await supabaseAdmin
        .from('time_clock_entries')
        .select('id, clock_in, clock_out, clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng')
        .eq('roster_id', session.userId)
        .order('clock_in', { ascending: false })
        .limit(10);
      if (recentErr) return res.status(500).json({ error: "Couldn't load your time clock status." });
      return res.status(200).json({ open: (openRows && openRows[0]) || null, recent: recent || [] });
    }

    // ── Time Clock: supervisor / admin — view + edit everyone's entries ──
    if (action === 'list_time_entries') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const anchor = req.body.weekStart ? new Date(req.body.weekStart) : new Date();
      const monday = mondayOf(anchor);
      const nextMonday = new Date(monday); nextMonday.setDate(nextMonday.getDate() + 7);

      const { data: roster, error: rosterErr } = await supabaseAdmin
        .from('roster')
        .select('id, name, role, active')
        .eq('company_id', companyId)
        .order('name', { ascending: true });
      if (rosterErr) return res.status(500).json({ error: 'Could not load roster.' });

      const { data: entries, error: entriesErr } = await supabaseAdmin
        .from('time_clock_entries')
        .select('id, roster_id, clock_in, clock_out, edited_by_roster_id, edited_at, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_out_lat, clock_out_lng, clock_out_accuracy_m')
        .eq('company_id', companyId)
        .gte('clock_in', monday.toISOString())
        .lt('clock_in', nextMonday.toISOString())
        .order('clock_in', { ascending: true });
      if (entriesErr) return res.status(500).json({ error: 'Could not load time clock entries.' });

      return res.status(200).json({
        weekStart: toISODate(monday),
        weekEnd: toISODate(new Date(nextMonday.getTime() - 86400000)),
        roster: roster || [],
        entries: entries || [],
      });
    }

    if (action === 'edit_time_entry') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, 'timeclock');
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const { entryId, clockIn, clockOut } = req.body;
      if (!entryId || !clockIn) return res.status(400).json({ error: 'Missing entry details.' });
      const { data: rows, error: findErr } = await supabaseAdmin.from('time_clock_entries').select('id, company_id').eq('id', entryId).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Entry not found.' });
      if (session.role === 'supervisor' && rows[0].company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });

      const { error } = await supabaseAdmin.from('time_clock_entries').update({
        clock_in: clockIn,
        clock_out: clockOut || null,
        edited_by_roster_id: session.userId || null,
        edited_at: new Date().toISOString(),
        // A supervisor-edited time no longer matches the device's original
        // GPS fix (which was captured for the old clock_in/clock_out), so
        // clear it rather than showing a stale pin next to a corrected time.
        clock_in_lat: null,
        clock_in_lng: null,
        clock_in_accuracy_m: null,
        clock_out_lat: null,
        clock_out_lng: null,
        clock_out_accuracy_m: null,
      }).eq('id', entryId);
      if (error) {
        if (isUniqueViolation(error)) return res.status(400).json({ error: 'That person already has an open entry — close it first.' });
        return res.status(500).json({ error: "Couldn't save the change." });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'add_time_entry') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, 'timeclock');
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const companyId = resolveCompanyId(session, req.body.companyId);
      const { rosterId, clockIn, clockOut } = req.body;
      if (!companyId || !rosterId || !clockIn) return res.status(400).json({ error: 'Missing entry details.' });

      const { data: memberRows, error: memberErr } = await supabaseAdmin.from('roster').select('id, company_id').eq('id', rosterId).limit(1);
      if (memberErr || !memberRows || memberRows.length === 0 || memberRows[0].company_id !== companyId) {
        return res.status(400).json({ error: 'That person is not on this company\'s roster.' });
      }

      const { error } = await supabaseAdmin.from('time_clock_entries').insert({
        company_id: companyId,
        roster_id: rosterId,
        clock_in: clockIn,
        clock_out: clockOut || null,
        edited_by_roster_id: session.userId || null,
        edited_at: new Date().toISOString(),
      });
      if (error) {
        if (isUniqueViolation(error)) return res.status(400).json({ error: 'That person already has an open entry.' });
        return res.status(500).json({ error: "Couldn't add the entry." });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete_time_entry') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, 'timeclock');
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const { entryId } = req.body;
      if (!entryId) return res.status(400).json({ error: 'Missing entry id.' });
      const { data: rows, error: findErr } = await supabaseAdmin.from('time_clock_entries').select('id, company_id').eq('id', entryId).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Entry not found.' });
      if (session.role === 'supervisor' && rows[0].company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });
      const { error } = await supabaseAdmin.from('time_clock_entries').delete().eq('id', entryId);
      if (error) return res.status(500).json({ error: "Couldn't delete the entry." });
      return res.status(200).json({ ok: true });
    }

    // ── Time Clock: weekly PDF reports (same shape as equipment reports) ─
    if (action === 'list_time_reports') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin
        .from('timeclock_reports')
        .select('id, week_start, week_end, pdf_url, generated_by, created_at')
        .eq('company_id', companyId)
        .order('week_start', { ascending: false });
      if (error) return res.status(500).json({ error: 'Could not load reports.' });
      const reports = await Promise.all((data || []).map(async r => ({ ...r, pdf_url: await signStoredUrl(r.pdf_url, 'flha-reports') })));
      return res.status(200).json({ reports });
    }

    if (action === 'get_time_report') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { reportId } = req.body;
      if (!reportId) return res.status(400).json({ error: 'Missing report id.' });
      const { data, error } = await supabaseAdmin.from('timeclock_reports').select('*').eq('id', reportId).limit(1);
      if (error || !data || data.length === 0) return res.status(404).json({ error: 'Report not found.' });
      const report = data[0];
      if (session.role === 'supervisor' && report.company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });
      const { data: coRows } = await supabaseAdmin.from('companies').select('id, name, logo_url').eq('id', report.company_id).limit(1);
      const company = coRows && coRows[0];
      const storedUrl = await ensureTimeClockReportPdf(report, company?.name || '', company?.logo_url || '');
      report.pdf_url = await signStoredUrl(storedUrl, 'flha-reports');
      return res.status(200).json({ report, company });
    }

    // Optional `pullUntil`: a "request a manual pull" cutoff — see the
    // matching comment on equipmentreports.js's generate_now. Same rules:
    // must fall inside the resolved week, and the standard automated
    // Sunday-11:59pm pull (cron-equipment-reports.js) still overwrites this
    // once the week actually closes (same company_id+week_start upsert key).
    if (action === 'generate_time_report_now') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const denied = await requireDocKey(supabaseAdmin, session, 'timeclock');
      if (denied) return res.status(denied.status).json({ error: denied.error });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { weekStart, pullUntil } = req.body;

      const anchor = weekStart ? new Date(weekStart) : new Date();
      const monday = weekStart ? mondayOf(anchor) : mondayOf(new Date(anchor.getTime() - 7 * 86400000));
      const nextMonday = new Date(monday); nextMonday.setDate(nextMonday.getDate() + 7);

      let weekEndExclusiveISO = nextMonday.toISOString();
      if (pullUntil) {
        const until = new Date(pullUntil);
        if (isNaN(until.getTime())) return res.status(400).json({ error: 'Invalid pull-until time.' });
        if (until < monday || until > nextMonday) return res.status(400).json({ error: "Requested time must fall within that report's week." });
        weekEndExclusiveISO = until.toISOString();
      }

      const reportJson = await buildTimeClockReportForCompanyWeek(companyId, monday.toISOString(), weekEndExclusiveISO);
      reportJson.pulledUntil = pullUntil ? weekEndExclusiveISO : null;

      const { data, error } = await supabaseAdmin
        .from('timeclock_reports')
        .upsert(
          { company_id: companyId, week_start: reportJson.weekStart, week_end: reportJson.weekEnd, report_json: reportJson, pdf_url: null, generated_by: 'manual' },
          { onConflict: 'company_id,week_start' }
        )
        .select()
        .single();
      if (error) { console.error("time clock report save failed:", error.message); return res.status(500).json({ error: "Couldn't generate report. Try again." }); }

      const { data: coRows } = await supabaseAdmin.from('companies').select('name, logo_url').eq('id', companyId).limit(1);
      const company = coRows && coRows[0];
      const storedUrl = await ensureTimeClockReportPdf(data, company?.name || '', company?.logo_url || '');
      data.pdf_url = await signStoredUrl(storedUrl, 'flha-reports');
      return res.status(200).json({ ok: true, report: data });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
