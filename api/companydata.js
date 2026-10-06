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
import { isValidEmail, effectiveSeatCap } from '../server-lib/onboardingHelpers.js';
import { EXPIRY_WARNING_DAYS, expiryStatus } from '../server-lib/compliance.js';
import { retiredEquipmentIds, withoutRetiredEquipment } from '../server-lib/equipmentScope.js';
import { sendEmail } from '../server-lib/email.js';
import { requireDocKey, isDocKeyActive } from '../server-lib/docKeyGate.js';
import { signRows } from '../server-lib/signedUrls.js';
import { lastOnSiteByEquipment, mountedOnByAttachment, attachmentStats, pmAllowedFor, isTowedUnit } from '../server-lib/fleetActivity.js';
import { isFounder, canManageCompany } from '../server-lib/ownerAccess.js';
import {
  listDepartments, listDivisions, sanitizeDepartments, sanitizeDivisionIds, sanitizeDefaultSite,
  departmentKeyFromLabel, cleanLabel, cleanTitle, MAX_CUSTOM_DEPARTMENTS, MAX_DIVISIONS,
} from '../server-lib/companyStructure.js';
import { encryptField, withDecryptedEmail, keyProblemMessage } from '../server-lib/fieldCrypto.js';
import { applyRulesToNewRosterMember } from '../server-lib/portalAssignments.js';
import { issueAndEmailPinLink, issuePinSetupLink, MAX_LINKS_PER_BATCH } from '../server-lib/setupLinks.js';
import { checkIpThrottle } from '../server-lib/ipThrottle.js';
import { mfaStatus, requiresMfa, startEnrollment, confirmEnrollment, verifyLoginCode, resetMfa, canResetMfa } from '../server-lib/rosterMfa.js';
import { logAuditEvent } from '../server-lib/auditLog.js';
import { sessionExpired } from '../server-lib/sessionTtl.js';
import { listVisibleRecords, listVisibleRecordsMulti, readHideUnassigned } from '../server-lib/documentAccess.js';
import { listAssignableDocuments, validateAssignment, describeAssignments, assignmentsNamingAudience, MAX_ACTIVE_ASSIGNMENTS } from '../server-lib/assignmentAdmin.js';

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
  // `name` comes from the roster row, never from the token payload: a token
  // minted before someone's name was corrected would otherwise stamp the
  // old one onto whatever they did today. Matches api/maintenance.js's
  // verifySession, which resolves it the same way and for the same reason —
  // retire_equipment records who took a machine out of the fleet.
  const { data: rows, error } = await supabaseAdmin
    .from('roster')
    .select('active, role, company_id, name, is_owner')
    .eq('id', payload.userId)
    .limit(1);
  if (error || !rows || rows.length === 0 || !rows[0].active) return null;
  if (rows[0].company_id !== payload.companyId) return null;
  return { ...payload, role: rows[0].role, name: rows[0].name, isOwner: rows[0].is_owner === true };
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

// Total active roster seats a plan tier allows are defined once, in
// server-lib/onboardingHelpers.js (effectiveSeatCap): workers and supervisors
// combined, since both count as a "user" for billing.

function genSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString('hex');
}

// No cross-member uniqueness check — login always resolves a specific
// roster row by name before the PIN is ever checked, so two people sharing
// a 6-digit PIN has no security impact, and skipping the check keeps this
// O(1) instead of re-hashing against every existing member on the roster.
// 6 digits, not 4, as of 2026-09-25 — see docs/security/soc2-readiness-gaps.md
// item 8.
function genPin() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
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
    // also holds contact info, which does not belong in these responses.

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
        .select('id, name, role, active, last_login_at, deactivated_at, created_at, wallet_enabled, employee_id, departments, totp_enabled, is_owner, title, divisions, default_site_id, pin_set_at, pin_link_sent_at, pin_locked_until, totp_locked_until')
        .eq('company_id', companyId)
        .order('role', { ascending: true })
        .order('name', { ascending: true });
      if (error) return res.status(500).json({ error: 'Could not load roster.' });

      const { data: coRows, error: coErr } = await supabaseAdmin.from('companies').select('plan_tier').eq('id', companyId).limit(1);
      if (coErr) return res.status(500).json({ error: 'Could not load plan tier.' });
      const tier = (coRows && coRows[0] && coRows[0].plan_tier) || 'basic';
      const activeSeatCount = (members || []).filter(m => m.active).length;

      const nowMs = Date.now();
      const withMfa = (members || []).map(({ pin_locked_until, totp_locked_until, ...m }) => ({
        ...m,
        mfa: mfaStatus(m),
        // Only whether they are locked out right now, never the timestamps.
        locked: [pin_locked_until, totp_locked_until].some(t => t && new Date(t).getTime() > nowMs),
      }));
      return res.status(200).json({ members: withMfa, activeSeatCount, cap: effectiveSeatCap(tier), tier });
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
      // Adding a supervisor is granting authority: Owner or founder only.
      if (role === 'supervisor' && !canManageCompany(session)) return res.status(403).json({ error: 'Only the account owner can add a supervisor.' });

      const { data: coRows, error: coErr } = await supabaseAdmin.from('companies').select('plan_tier').eq('id', companyId).limit(1);
      if (coErr) return res.status(500).json({ error: 'Could not load plan tier.' });
      const tier = (coRows && coRows[0] && coRows[0].plan_tier) || 'basic';
      const cap = effectiveSeatCap(tier);

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
      // Company Portal phase 4: "auto-applies to new hires". Best-effort —
      // see server-lib/portalAssignments.js's header for why a failure here
      // must never undo the roster row that already saved.
      try { await applyRulesToNewRosterMember(supabaseAdmin, companyId, data); } catch (e) { console.error('applyRulesToNewRosterMember failed:', e.message); }

      return res.status(200).json({ ok: true, member: data, pin });
    }

    // ── Add a person and email them a link to set their own PIN. Same seat
    // cap / name-collision checks as add_roster_member, plus a required email
    // address. The initial PIN is random and never shown or sent: the person
    // chooses their own through the link (server-lib/setupLinks.js), and is
    // taken on into an authenticator setup if their role needs one. Delivery is
    // best-effort: sendEmail() is a no-op if RESEND_API_KEY isn't set, and a
    // send failure doesn't undo the roster row already created. The row then
    // shows as waiting, and "Send setup link" on the roster tries again.
    if (action === 'onboard_new_employee') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const name = (req.body.name || '').trim();
      const role = req.body.role;
      const email = (req.body.email || '').trim();
      if (!name) return res.status(400).json({ error: 'Enter a name.' });
      if (role !== 'worker' && role !== 'supervisor') return res.status(400).json({ error: 'Invalid role.' });
      // Adding a supervisor is granting authority: Owner or founder only.
      if (role === 'supervisor' && !canManageCompany(session)) return res.status(403).json({ error: 'Only the account owner can add a supervisor.' });
      if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });

      const { data: coRows, error: coErr } = await supabaseAdmin.from('companies').select('name, plan_tier').eq('id', companyId).limit(1);
      if (coErr) return res.status(500).json({ error: 'Could not load plan tier.' });
      const companyName = (coRows && coRows[0] && coRows[0].name) || 'your employer';
      const tier = (coRows && coRows[0] && coRows[0].plan_tier) || 'basic';
      const cap = effectiveSeatCap(tier);

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

      // Every add sends a branded email, and the seat cap only counts active
      // rows, so add-then-deactivate could otherwise send without limit.
      const addAllowed = await checkIpThrottle(supabaseAdmin, `addhire:${companyId}`, 30, 60 * 60 * 1000);
      if (!addAllowed) return res.status(429).json({ error: 'Too many people added this hour. Try again later.' });

      const salt = genSalt();
      const pin = genPin(); // placeholder: the new hire chooses their own PIN through the emailed link, this one is never shown or sent
      const { data, error } = await supabaseAdmin
        .from('roster')
        .insert({
          company_id: companyId, name, role, email: encryptField(email),
          employee_id: employeeId || null,
          pin_hash: hashPin(pin, salt), pin_salt: salt,
          wallet_enabled: true,
        })
        .select('id, company_id, name, role, is_owner, departments, totp_enabled, email, created_at, employee_id')
        .single();
      if (error) {
        if (isUniqueViolation(error)) return res.status(409).json({ error: `Employee ID ${employeeId} is already in use on this roster.` });
        console.error("onboard_new_employee failed:", error.message);
        return res.status(500).json({ error: "Couldn't add to the roster. Try again." });
      }
      // The row holds the encrypted value; hand the caller the plain address
      // they just typed, never the ciphertext.
      data.email = email;

      // Company Portal phase 4: "auto-applies to new hires".
      try { await applyRulesToNewRosterMember(supabaseAdmin, companyId, data); } catch (e) { console.error('applyRulesToNewRosterMember failed:', e.message); }

      const sentLink = await issueAndEmailPinLink({
        supabaseAdmin, sendEmail, member: data, email, companyName, needsAuthenticator: requiresMfa(data),
      });
      const { company_id: _c, is_owner: _o, departments: _d, totp_enabled: _t, ...memberOut } = data;
      // A link handed back to the caller lets the caller choose that person's
      // PIN, so only a worker's comes back (a supervisor already resets worker
      // PINs). A supervisor's goes to their own inbox only.
      const inviteUrl = sentLink.url && (role === 'worker' || isFounder(session)) ? sentLink.url : null;
      return res.status(200).json({ ok: true, member: memberOut, inviteUrl, emailSent: sentLink.sent });
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

      const { data: rows, error: findErr } = await supabaseAdmin.from('roster').select('id, company_id, role, is_owner').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      const member = rows[0];
      if (session.role === 'supervisor' && member.company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed.' });
      }
      // A supervisor manages workers; switching a peer supervisor or an Owner
      // off is Owner or founder territory.
      if (!canManageCompany(session) && member.role !== 'worker') {
        return res.status(403).json({ error: 'Only the account owner can deactivate a supervisor.' });
      }
      // Only the founder switches an owner off. A co-owner could otherwise
      // deactivate a peer owner, then reset and take over the account.
      if (action === 'deactivate_roster_member' && member.is_owner && !isFounder(session)) {
        return res.status(403).json({ error: 'Only FORA support can deactivate an owner.' });
      }

      const activating = action === 'reactivate_roster_member';
      if (activating) {
        const { data: coRows, error: coErr } = await supabaseAdmin.from('companies').select('plan_tier').eq('id', member.company_id).limit(1);
        if (coErr) return res.status(500).json({ error: 'Could not load plan tier.' });
        const tier = (coRows && coRows[0] && coRows[0].plan_tier) || 'basic';
        const cap = effectiveSeatCap(tier);
        const { data: activeRows, error: activeErr } = await supabaseAdmin.from('roster').select('id').eq('company_id', member.company_id).eq('active', true);
        if (activeErr) return res.status(500).json({ error: 'Could not check the roster.' });
        if ((activeRows || []).length >= cap) {
          return res.status(400).json({ error: `Seat limit reached for this plan (${cap} on ${tier === 'advanced' ? 'Advanced' : 'Basic'}). Upgrade the plan or deactivate someone first.` });
        }
      }

      const updates = activating
        ? { active: true, deactivated_at: null, failed_pin_attempts: 0, pin_locked_until: null }
        : { active: false, deactivated_at: new Date().toISOString(), pin_link_jti_hash: null, pin_link_expires_at: null }; // a link issued before deactivation must not revive on reactivation
      const { error } = await supabaseAdmin.from('roster').update(updates).eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't update." });
      return res.status(200).json({ ok: true });
    }

    if (action === 'reset_roster_pin') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      const { data: rows, error: findErr } = await supabaseAdmin.from('roster').select('id, company_id, role, is_owner').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      if (session.role === 'supervisor' && rows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed.' });
      }
      // Same pyramid as reset_roster_mfa: a supervisor resets workers, an Owner
      // resets supervisors and workers, the founder resets anyone. Your own PIN
      // is always yours to reset. A new PIN plus a reset authenticator is a
      // full account takeover, so a peer never gets this.
      if (String(rows[0].id) !== String(session.userId) && !canResetMfa(session, rows[0])) {
        return res.status(403).json({ error: "You can't reset that person's PIN." });
      }

      const salt = genSalt();
      const pin = genPin();
      const { error } = await supabaseAdmin
        .from('roster')
        .update({ pin_hash: hashPin(pin, salt), pin_salt: salt, failed_pin_attempts: 0, pin_locked_until: null, mfa_setup_jti_hash: null, mfa_setup_expires_at: null, pin_link_jti_hash: null, pin_link_expires_at: null })
        .eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't reset the PIN." });
      return res.status(200).json({ ok: true, pin });
    }

    // ── Per-person authenticator (TOTP). Supervisors and anyone in a sensitive
    // department are forced to enroll at login (api/login.js); everyone else
    // can opt in here. See server-lib/rosterMfa.js.
    if (action === 'get_my_mfa_status' || action === 'mfa_self_enroll_start'
        || action === 'mfa_self_enroll_confirm' || action === 'mfa_self_disable') {
      // The founder session has no roster row; its authenticator is the
      // global one managed in the Admin Panel.
      if (!session.userId) return res.status(200).json({ applicable: false });
      const { data: meRows, error: meErr } = await supabaseAdmin
        .from('roster').select('*').eq('id', session.userId).eq('company_id', session.companyId).limit(1);
      const me = meRows && meRows[0];
      if (meErr || !me || !me.active) return res.status(403).json({ error: 'Not allowed.' });

      if (action === 'get_my_mfa_status') return res.status(200).json({ applicable: true, ...mfaStatus(me) });

      if (action === 'mfa_self_enroll_start') {
        const r = await startEnrollment(supabaseAdmin, me);
        if (r.error) return res.status(r.status || 500).json({ error: r.error });
        return res.status(200).json({ ok: true, secret: r.secret, qrDataUrl: r.qrDataUrl });
      }
      if (action === 'mfa_self_enroll_confirm') {
        const r = await confirmEnrollment(supabaseAdmin, me, req.body.code);
        if (r.error) return res.status(r.status || 500).json({ error: r.error });
        return res.status(200).json({ ok: true, backupCodes: r.backupCodes });
      }
      // mfa_self_disable: optional users only, and only with a current code.
      if (requiresMfa(me)) return res.status(403).json({ error: 'Your role requires an authenticator. Ask for a reset instead.' });
      if (!me.totp_enabled) return res.status(400).json({ error: 'Authenticator is not set up.' });
      const v = await verifyLoginCode(supabaseAdmin, me, req.body.code);
      if (!v.ok) return res.status(v.status || 401).json({ error: v.error });
      const { error: offErr } = await resetMfa(supabaseAdmin, me.id);
      if (offErr) return res.status(500).json({ error: "Couldn't turn it off." });
      await logAuditEvent(supabaseAdmin, { actorRole: session.role, action: 'mfa_self_disable', companyId: session.companyId, targetType: 'roster', targetId: me.id });
      return res.status(200).json({ ok: true });
    }

    // Reset pyramid: founder resets anyone (only the founder resets an Owner),
    // an Owner resets supervisors and workers, a supervisor resets workers.
    // The person re-enrolls at their next login.
    if (action === 'reset_roster_mfa') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });
      const { data: rows, error: findErr } = await supabaseAdmin.from('roster').select('id, company_id, role, is_owner').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      if (!canResetMfa(session, rows[0])) return res.status(403).json({ error: 'Not allowed.' });
      const { error } = await resetMfa(supabaseAdmin, id);
      if (error) return res.status(500).json({ error: "Couldn't reset the authenticator." });
      await logAuditEvent(supabaseAdmin, {
        actorRole: session.role,
        action: 'reset_roster_mfa', companyId: rows[0].company_id, targetType: 'roster', targetId: id,
        details: { by_roster_id: session.userId || null },
      });
      return res.status(200).json({ ok: true });
    }

    // Unlocks someone locked out by wrong PINs (or wrong authenticator codes).
    // Same rank rule as the authenticator reset: founder anyone, an Owner
    // supervisors and workers, a supervisor workers, never yourself. Names are
    // searchable before login, so anyone can lock anyone for 15 minutes; this
    // is how the people above them clear it without waiting.
    if (action === 'unlock_roster_pin') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });
      const { data: rows, error: findErr } = await supabaseAdmin.from('roster').select('id, company_id, role, is_owner').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      if (!canResetMfa(session, rows[0])) return res.status(403).json({ error: 'Not allowed.' });
      const { error } = await supabaseAdmin
        .from('roster')
        .update({ failed_pin_attempts: 0, pin_locked_until: null, totp_failed_attempts: 0, totp_locked_until: null })
        .eq('id', id)
        .eq('company_id', rows[0].company_id);
      if (error) return res.status(500).json({ error: "Couldn't unlock." });
      await logAuditEvent(supabaseAdmin, {
        actorRole: session.role,
        action: 'unlock_roster_pin', companyId: rows[0].company_id, targetType: 'roster', targetId: id,
        details: { by_roster_id: session.userId || null },
      });
      return res.status(200).json({ ok: true });
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

    // ── "Send setup links": emails a set-your-PIN link to everyone in the
    // company who has an email on file and has never chosen a PIN or signed in.
    // Owner or founder only. Each link goes to that person's own inbox and is
    // never handed back, so this cannot be used to take anyone's account. This
    // is where the rest of a new company's people get theirs; approval only
    // emails the Owner. Capped per click and per hour.
    if (action === 'send_pin_setup_links_all') {
      if (!canManageCompany(session)) return res.status(403).json({ error: 'Only the account owner can send setup links to everyone.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const { data: people, error: listErr } = await supabaseAdmin
        .from('roster')
        .select('id, company_id, name, role, is_owner, departments, totp_enabled, email, pin_set_at, last_login_at, pin_link_sent_at')
        .eq('company_id', companyId)
        .eq('active', true);
      if (listErr) return res.status(500).json({ error: 'Could not load the roster.' });

      // Same pyramid as the single send: an Owner reaches workers and supervisors,
      // never another Owner (only the founder does). Someone emailed in the last
      // hour is left alone, so a second click cannot kill a link still in flight.
      const recentlySent = Date.now() - 60 * 60 * 1000;
      const waiting = (people || []).filter((m) => !m.pin_set_at && !m.last_login_at
        && canResetMfa(session, m)
        && !(m.pin_link_sent_at && new Date(m.pin_link_sent_at).getTime() > recentlySent));
      const withEmail = waiting.filter((m) => (withDecryptedEmail(m).email || '').trim());
      const skippedNoEmail = waiting.length - withEmail.length;
      // Never-sent first, then the longest since their last link.
      withEmail.sort((a, b) => (a.pin_link_sent_at ? new Date(a.pin_link_sent_at).getTime() : 0) - (b.pin_link_sent_at ? new Date(b.pin_link_sent_at).getTime() : 0));
      const batch = withEmail.slice(0, MAX_LINKS_PER_BATCH);
      if (batch.length === 0) return res.status(200).json({ ok: true, sent: 0, failed: 0, skippedNoEmail, remaining: 0 });

      // Counted only once there is something to send, so an empty click costs nothing.
      const allowed = await checkIpThrottle(supabaseAdmin, `pinlinkbulk:${companyId}`, 3, 60 * 60 * 1000);
      if (!allowed) return res.status(429).json({ error: 'Setup links were already sent to everyone a few times this hour. Try again later.' });

      const { data: coRows } = await supabaseAdmin.from('companies').select('name').eq('id', companyId).limit(1);
      const companyName = (coRows && coRows[0] && coRows[0].name) || 'your employer';

      let sent = 0;
      let failed = 0;
      const queue = [...batch];
      const worker = async () => {
        for (let m = queue.shift(); m; m = queue.shift()) {
          const r = await issueAndEmailPinLink({
            supabaseAdmin, sendEmail, member: m, email: (withDecryptedEmail(m).email || '').trim(), companyName,
            needsAuthenticator: requiresMfa(m) && !m.totp_enabled,
          });
          if (r.sent) sent++; else failed++;
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      return res.status(200).json({ ok: true, sent, failed, skippedNoEmail, remaining: withEmail.length - batch.length });
    }

    // ── Send (or resend) one person's set-your-PIN link. A new link replaces
    // any earlier one. Same pyramid as reset_roster_pin: a link lets its holder
    // choose the PIN, so it is only offered to someone who could reset that
    // PIN anyway, plus the person themselves. It is emailed to the address on
    // file. It is handed back to the caller only for a worker (or to the
    // founder), so a supervisor's link never passes through someone else.
    if (action === 'send_pin_setup_link') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      const { data: rows, error: findErr } = await supabaseAdmin
        .from('roster').select('id, company_id, name, role, is_owner, departments, totp_enabled, active, email').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      const member = rows[0];
      const self = !!session.userId && String(session.userId) === String(member.id) && session.companyId === member.company_id;
      if (!self && !canResetMfa(session, member)) return res.status(403).json({ error: "You can't send that person a setup link." });
      if (!member.active) return res.status(400).json({ error: 'This person is deactivated.' });

      const email = (withDecryptedEmail(member).email || '').trim();
      const handBack = isFounder(session) || member.role === 'worker';
      if (!email && !handBack) return res.status(400).json({ error: 'Add an email address for this person first. A supervisor setup link is only ever sent to their own inbox.' });

      const allowed = await checkIpThrottle(supabaseAdmin, `pinlinkmail:${member.id}`, 5, 60 * 60 * 1000);
      if (!allowed) return res.status(429).json({ error: 'A setup link was already sent a few times this hour. Try again later.' });

      const { data: coRows } = await supabaseAdmin.from('companies').select('name').eq('id', member.company_id).limit(1);
      const companyName = (coRows && coRows[0] && coRows[0].name) || 'your employer';

      if (!email) {
        const issued = await issuePinSetupLink(supabaseAdmin, member);
        if (issued.error) return res.status(500).json({ error: issued.error });
        return res.status(200).json({ ok: true, emailSent: false, inviteUrl: issued.url });
      }
      const sent = await issueAndEmailPinLink({ supabaseAdmin, sendEmail, member, email, companyName, needsAuthenticator: requiresMfa(member) && !member.totp_enabled });
      if (sent.error && !sent.url) return res.status(500).json({ error: sent.error });
      return res.status(200).json({ ok: true, emailSent: sent.sent, inviteUrl: handBack ? sent.url : null });
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
          .update({ pin_hash: hashPin(pin, salt), pin_salt: salt, failed_pin_attempts: 0, pin_locked_until: null, mfa_setup_jti_hash: null, mfa_setup_expires_at: null, pin_link_jti_hash: null, pin_link_expires_at: null })
          .eq('id', m.id);
        if (error) return res.status(500).json({ error: `Couldn't regenerate the PIN for ${m.name}.` });
        roster.push({ id: m.id, name: m.name, role: m.role, pin });
      }
      return res.status(200).json({ ok: true, roster });
    }

    // ── Worker profile: everything this one roster row has signed their
    // name to, plus their own copy of the punch-location map, behind the
    // name-click in the Roster tab. Only pulls a table when the company has
    // switched that document type on (isDocKeyActive), never the hard
    // requireDocKey 403 — one missing module should thin out this profile,
    // not fail the whole thing for a company running six of nine modules.
    //
    // Joins on submitted_by_roster_id (docs/schema/roster-attribution-migration.sql)
    // rather than name-matching, unlike api/customforms.js's get_my_documents:
    // that endpoint is a worker looking up their own name, this one is a
    // supervisor looking up someone else's, so a name collision or a rename
    // must not surface a stranger's signed document. incidents/near_misses
    // predating that migration will simply be missing here for the same
    // reason the migration deliberately left them unbackfilled.
    if (action === 'get_worker_profile') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      const { data: rows, error: findErr } = await supabaseAdmin
        .from('roster')
        .select('id, company_id, name, role, active, email, phone, employee_id, wallet_enabled, last_login_at, created_at, onboarding_completed_at, departments, is_owner, title, divisions, default_site_id, totp_enabled')
        .eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      const member = withDecryptedEmail(rows[0]);
      if (session.role === 'supervisor' && member.company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed.' });
      }
      const companyId = member.company_id;

      const [flhaOn, toolboxOn, incidentOn, nearmissOn, inspectionOn, monthlyOn, dailyOn, timeclockOn] = await Promise.all(
        ['flha', 'toolbox', 'incident', 'nearmiss', 'inspection', 'monthly', 'daily', 'timeclock']
          .map(key => isDocKeyActive(supabaseAdmin, companyId, key))
      );

      const FETCH_LIMIT = 200;
      const [flhaRows, inspectionRows, toolboxRows, dailyRows, incidentRows, nearMissRows] = await Promise.all([
        flhaOn ? supabaseAdmin.from('flhas').select('id, job_site, site_id, created_at, pdf_url')
          .eq('company_id', companyId).eq('submitted_by_roster_id', id).order('created_at', { ascending: false }).limit(FETCH_LIMIT) : { data: [] },
        inspectionOn ? supabaseAdmin.from('inspections').select('id, equipment_label, trip_type, created_at, pdf_url')
          .eq('company_id', companyId).eq('submitted_by_roster_id', id).order('created_at', { ascending: false }).limit(FETCH_LIMIT) : { data: [] },
        toolboxOn ? supabaseAdmin.from('toolbox_talks').select('id, topic, site_id, created_at, pdf_url')
          .eq('company_id', companyId).eq('submitted_by_roster_id', id).order('created_at', { ascending: false }).limit(FETCH_LIMIT) : { data: [] },
        dailyOn ? supabaseAdmin.from('daily_reports').select('id, site, site_id, report_date, created_at, pdf_url')
          .eq('company_id', companyId).eq('submitted_by_roster_id', id).order('created_at', { ascending: false }).limit(FETCH_LIMIT) : { data: [] },
        incidentOn ? supabaseAdmin.from('incidents').select('id, site, site_id, incident_type, created_at, pdf_url')
          .eq('company_id', companyId).eq('submitted_by_roster_id', id).order('created_at', { ascending: false }).limit(FETCH_LIMIT) : { data: [] },
        nearmissOn ? supabaseAdmin.from('near_misses').select('id, site, site_id, created_at, pdf_url')
          .eq('company_id', companyId).eq('submitted_by_roster_id', id).order('created_at', { ascending: false }).limit(FETCH_LIMIT) : { data: [] },
      ]);

      // Monthly inspections and custom form records carry no company_id of
      // their own — scoped through their parent form, same as
      // get_my_documents in api/customforms.js.
      let monthlyRows = [], monthlyFormMap = {};
      if (monthlyOn) {
        const { data: forms } = await supabaseAdmin.from('inspection_forms').select('id, title').eq('company_id', companyId);
        (forms || []).forEach(f => { monthlyFormMap[f.id] = f.title; });
        const formIds = (forms || []).map(f => f.id);
        if (formIds.length) {
          const { data } = await supabaseAdmin.from('inspection_records').select('id, created_at, pdf_url, form_id, site_id')
            .in('form_id', formIds).eq('submitted_by_roster_id', id).order('created_at', { ascending: false }).limit(FETCH_LIMIT);
          monthlyRows = data || [];
        }
      }

      const { data: customForms } = await supabaseAdmin.from('custom_forms').select('id, title').eq('company_id', companyId);
      const customFormMap = {}; (customForms || []).forEach(f => { customFormMap[f.id] = f.title; });
      const customFormIds = (customForms || []).map(f => f.id);
      const { data: customRows } = customFormIds.length
        ? await supabaseAdmin.from('custom_form_records').select('id, created_at, pdf_url, form_id, site_id')
            .in('form_id', customFormIds).eq('submitted_by_roster_id', id).order('created_at', { ascending: false }).limit(FETCH_LIMIT)
        : { data: [] };

      // The profile is a second door to every document this person filed, so
      // it goes through the same view rows and supervisor scope as the lists
      // (a supervisor outside a document's scope must not get a signed PDF
      // link here either). A refusal or a failed check means "show none of
      // that type", never the whole profile and never the unfiltered rows.
      // Every row below was filed by `id`, so that is its author.
      const asAuthor = (rows) => (rows || []).map(r => ({ ...r, submitted_by_roster_id: Number(id) }));
      const keepVisible = async (docKey, rows) => {
        const out = await listVisibleRecords(supabaseAdmin, session, docKey, asAuthor(rows));
        return out.denied ? [] : out.records;
      };
      const [flhaVis, inspectionVis, toolboxVis, dailyVis, incidentVis, nearMissVis, monthlyVis] = await Promise.all([
        keepVisible('flha', flhaRows.data),
        keepVisible('inspection', inspectionRows.data),
        keepVisible('toolbox', toolboxRows.data),
        keepVisible('daily', dailyRows.data),
        keepVisible('incident', incidentRows.data),
        keepVisible('nearmiss', nearMissRows.data),
        keepVisible('monthly', monthlyRows),
      ]);
      const customOut = await listVisibleRecordsMulti(supabaseAdmin, session, asAuthor(customRows), (r) => `custom_${r.form_id}`);
      const customVis = customOut.denied ? [] : customOut.records;

      const documents = [
        ...flhaVis.map(r => ({ id: r.id, type: 'flha', title: 'FLHA', subtitle: r.job_site || '', createdAt: r.created_at, pdf_url: r.pdf_url })),
        ...inspectionVis.map(r => ({ id: r.id, type: 'inspection', title: 'Equipment Inspection', subtitle: r.equipment_label || '', createdAt: r.created_at, pdf_url: r.pdf_url })),
        ...toolboxVis.map(r => ({ id: r.id, type: 'toolbox', title: 'Toolbox Talk', subtitle: r.topic || '', createdAt: r.created_at, pdf_url: r.pdf_url })),
        ...dailyVis.map(r => ({ id: r.id, type: 'daily', title: 'Daily Report', subtitle: r.site || '', createdAt: r.created_at, pdf_url: r.pdf_url })),
        ...incidentVis.map(r => ({ id: r.id, type: 'incident', title: 'Incident Report', subtitle: r.site || '', createdAt: r.created_at, pdf_url: r.pdf_url })),
        ...nearMissVis.map(r => ({ id: r.id, type: 'nearmiss', title: 'Near Miss Report', subtitle: r.site || '', createdAt: r.created_at, pdf_url: r.pdf_url })),
        ...monthlyVis.map(r => ({ id: r.id, type: 'monthly', title: monthlyFormMap[r.form_id] || 'Monthly Inspection', subtitle: '', createdAt: r.created_at, pdf_url: r.pdf_url })),
        ...customVis.map(r => ({ id: r.id, type: 'customform', title: customFormMap[r.form_id] || 'Custom Document', subtitle: '', createdAt: r.created_at, pdf_url: r.pdf_url })),
      ];
      documents.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const signedDocuments = await signRows(supabaseAdmin, documents.slice(0, 150), [{ key: 'pdf_url', bucket: 'flha-reports' }]);

      // Punch locations: last 60 days, not just the currently-viewed week on
      // the Time Clock tab, so a profile opened from the Roster tab (which
      // never loads that tab's week-scoped state) is self-contained.
      let timeClockEntries = [];
      if (timeclockOn) {
        const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
        const { data } = await supabaseAdmin.from('time_clock_entries')
          .select('id, roster_id, clock_in, clock_out, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_out_lat, clock_out_lng, clock_out_accuracy_m')
          .eq('company_id', companyId).eq('roster_id', id).gte('clock_in', since).order('clock_in', { ascending: true });
        timeClockEntries = data || [];
      }

      return res.status(200).json({
        member: {
          id: member.id, name: member.name, role: member.role, active: member.active,
          email: member.email, phone: member.phone, employeeId: member.employee_id,
          walletEnabled: member.wallet_enabled, lastLoginAt: member.last_login_at,
          createdAt: member.created_at, onboardingCompletedAt: member.onboarding_completed_at,
          departments: member.departments || [],
          isOwner: member.is_owner === true, title: member.title || '',
          divisions: member.divisions || [], defaultSiteId: member.default_site_id || null,
          hideUnassigned: await readHideUnassigned(supabaseAdmin, companyId, member.id),
          mfaEnabled: member.totp_enabled === true,
        },
        documents: signedDocuments,
        timeClockEntries,
        timeclockActive: timeclockOn,
      });
    }

    // Editable-from-the-profile fields, excluding name (identity, never
    // edited here) and employee_id (already has its own inline editor and
    // clash-checking on the Roster row via set_roster_employee_id) and
    // active (already has its own seat-cap-checked toggle via
    // deactivate_roster_member/reactivate_roster_member).
    //
    // Two tiers. Contact fields (email, phone) stay with supervisors for
    // workers. Structural fields (role, owner, title, departments,
    // divisions, default site) are the Account Owner's and the founder's
    // alone. Departments and divisions are routing tags: changing them never
    // widens what someone can open, it only changes where documents are
    // routed and how reports are filtered.
    if (action === 'update_worker_profile') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id.' });

      const { data: rows, error: findErr } = await supabaseAdmin.from('roster').select('id, company_id, role, is_owner, active').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Not found.' });
      if (session.role === 'supervisor' && rows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed.' });
      }
      const target = rows[0];
      const manager = canManageCompany(session);
      const structural = ['role', 'isOwner', 'title', 'departments', 'divisions', 'defaultSiteId', 'hideUnassigned'].filter(k => k in req.body);
      if (structural.length > 0 && !manager) {
        return res.status(403).json({ error: 'Only the account owner can change roles, titles, departments, divisions or default sites.' });
      }

      const updates = {};
      if ('email' in req.body) {
        // The emailed authenticator setup link goes to this address, so whoever
        // can change a supervisor's email can take the account over. Same rank
        // rule as role and PIN: a supervisor edits workers (or themselves).
        if (!manager && target.role !== 'worker' && String(target.id) !== String(session.userId)) {
          return res.status(403).json({ error: "Only the account owner can change a supervisor's email." });
        }
        const email = (req.body.email || '').trim();
        if (email && !isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
        updates.email = encryptField(email) || null;
        updates.mfa_setup_jti_hash = null;
        updates.mfa_setup_expires_at = null;
        updates.pin_link_jti_hash = null;
        updates.pin_link_expires_at = null;
      }
      if ('phone' in req.body) {
        if (!manager && target.role !== 'worker' && String(target.id) !== String(session.userId)) {
          return res.status(403).json({ error: "Only the account owner can change a supervisor's phone number." });
        }
        updates.phone = (req.body.phone || '').trim().slice(0, 40) || null;
      }

      const effectiveRole = 'role' in req.body ? req.body.role : target.role;
      if ('role' in req.body) {
        if (req.body.role !== 'worker' && req.body.role !== 'supervisor') return res.status(400).json({ error: 'Invalid role.' });
        // Demoting an Owner would leave an Owner who is not a supervisor, which
        // the gates do not recognise. Remove ownership first.
        const staysOwner = 'isOwner' in req.body ? req.body.isOwner === true : target.is_owner === true;
        if (req.body.role === 'worker' && staysOwner) {
          return res.status(400).json({ error: 'Remove ownership before changing an owner to a worker.' });
        }
        updates.role = req.body.role;
      }
      if ('isOwner' in req.body) {
        const makeOwner = req.body.isOwner === true;
        if (makeOwner && effectiveRole !== 'supervisor') return res.status(400).json({ error: 'An owner must be a supervisor.' });
        // Ownership is taken away by the founder, or given up by the owner
        // themselves. A co-owner cannot demote another owner: that would make
        // them an ordinary supervisor, open to the PIN and authenticator
        // resets that only the founder may do to an owner.
        if (!makeOwner && target.is_owner && !isFounder(session) && String(target.id) !== String(session.userId)) {
          return res.status(403).json({ error: 'Only FORA support can remove another owner.' });
        }
        if (!makeOwner && target.is_owner && !isFounder(session)) {
          const { data: otherOwners } = await supabaseAdmin.from('roster').select('id')
            .eq('company_id', target.company_id).eq('is_owner', true).eq('active', true).neq('id', target.id).limit(1);
          if (!otherOwners || otherOwners.length === 0) return res.status(400).json({ error: 'A company needs at least one owner. Make someone else an owner first.' });
        }
        if (makeOwner && !target.active) return res.status(400).json({ error: 'Reactivate this person before making them an owner.' });
        updates.is_owner = makeOwner;
        // The hide switch does nothing on an Owner, so clear it when someone
        // becomes one. Otherwise a later demotion would silently hide every
        // document from them. Only written when it is actually on, so a
        // database without the column is never asked to write it.
        if (makeOwner && !('hideUnassigned' in req.body) && await readHideUnassigned(supabaseAdmin, target.company_id, target.id)) {
          updates.hide_unassigned = false;
        }
      }
      if ('title' in req.body) updates.title = cleanTitle(req.body.title) || null;
      if ('departments' in req.body) {
        const departments = await sanitizeDepartments(supabaseAdmin, target.company_id, req.body.departments);
        if (!departments) return res.status(400).json({ error: 'Invalid department.' });
        updates.departments = departments;
      }
      if ('divisions' in req.body) {
        const divisions = await sanitizeDivisionIds(supabaseAdmin, target.company_id, req.body.divisions);
        if (!divisions) return res.status(400).json({ error: 'Invalid division.' });
        updates.divisions = divisions;
      }
      if ('hideUnassigned' in req.body) {
        if (typeof req.body.hideUnassigned !== 'boolean') return res.status(400).json({ error: 'Invalid setting.' });
        updates.hide_unassigned = req.body.hideUnassigned;
      }
      if ('defaultSiteId' in req.body) {
        const siteId = await sanitizeDefaultSite(supabaseAdmin, target.company_id, req.body.defaultSiteId);
        if (siteId === false) return res.status(403).json({ error: 'Not allowed for this site.' });
        updates.default_site_id = siteId;
      }
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update.' });

      const { data, error } = await supabaseAdmin.from('roster').update(updates).eq('id', id)
        .select('id, name, role, email, phone, departments, is_owner, title, divisions, default_site_id').single();
      if (error) {
        console.error('update_worker_profile failed:', error.message);
        return res.status(500).json({ error: "Couldn't save those changes." });
      }
      if (structural.length > 0) {
        await logAuditEvent(supabaseAdmin, {
          actorRole: session.role, action: 'update_worker_profile', companyId: target.company_id,
          targetType: 'roster', targetId: id, details: { fields: structural, by_roster_id: session.userId || null },
        });
      }
      return res.status(200).json({ ok: true, member: withDecryptedEmail(data) });
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

    // Worker-facing roster lookup — deliberately separate from `list_roster`
    // above (supervisor/admin only, richer columns). This is for picking an
    // attendee/crew-member signer by name (ToolboxTalk.jsx, App.jsx's FLHA
    // crew sign-off) so a second signature on a submission is tied to a real
    // roster_id instead of a typed name nobody can verify later. Same
    // no-role-check, company-scoped-only pattern as list_sites/list_equipment
    // below — any logged-in session (worker included) can call it, but only
    // ever sees its own company's active members, and only id+name+role.
    if (action === 'list_roster_names') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin
        .from('roster')
        .select('id, name, role')
        .eq('company_id', companyId)
        .eq('active', true)
        .order('name');
      if (error) return res.status(500).json({ error: 'Could not load roster.' });
      return res.status(200).json({ members: data || [] });
    }

    // ══ SITES ════════════════════════════════════════════════════════

    if (action === 'list_sites') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      // division_id arrived later; a database without it answers the old shape.
      let { data, error } = await supabaseAdmin.from('sites').select('id, name, division_id').eq('company_id', companyId).order('name');
      if (error && ['42703', 'PGRST204'].includes(String(error.code || ''))) {
        ({ data, error } = await supabaseAdmin.from('sites').select('id, name').eq('company_id', companyId).order('name'));
      }
      if (error) return res.status(500).json({ error: 'Could not load sites.' });
      // The signed-in person's own default site, so forms can preselect it.
      // Only ever their own row in their own company.
      let defaultSiteId = null;
      if (session.userId && String(companyId) === String(session.companyId)) {
        const { data: me } = await supabaseAdmin.from('roster').select('default_site_id').eq('id', session.userId).limit(1);
        defaultSiteId = (me && me[0] && me[0].default_site_id) || null;
      }
      return res.status(200).json({ sites: (data || []).map(s => ({ id: s.id, name: s.name, divisionId: s.division_id || null })), defaultSiteId });
    }

    // ══ DEPARTMENTS, DIVISIONS AND THE SIGNED-IN PERSON'S PROFILE ════════
    // Tags for routing, filtering and reporting. Reading is open to anyone
    // in the company (forms and filters need the lists); changing them is
    // the Account Owner's and the founder's.

    if (action === 'list_departments') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      try {
        return res.status(200).json({ departments: await listDepartments(supabaseAdmin, companyId) });
      } catch (e) {
        console.error('list_departments failed:', e.message);
        return res.status(500).json({ error: 'Could not load departments.' });
      }
    }

    if (action === 'list_divisions') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      try {
        return res.status(200).json({ divisions: await listDivisions(supabaseAdmin, companyId) });
      } catch (e) {
        console.error('list_divisions failed:', e.message);
        return res.status(500).json({ error: 'Could not load divisions.' });
      }
    }

    if (action === 'add_department' || action === 'delete_department'
        || action === 'add_division' || action === 'rename_division' || action === 'delete_division') {
      if (!canManageCompany(session)) return res.status(403).json({ error: 'Only the account owner can change departments and divisions.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      if (action === 'add_department') {
        const label = cleanLabel(req.body.label);
        const key = departmentKeyFromLabel(label);
        if (!label || !key) return res.status(400).json({ error: 'Enter a department name.' });
        const existing = await listDepartments(supabaseAdmin, companyId);
        if (existing.some(d => d.key === key || d.label.toLowerCase() === label.toLowerCase())) return res.status(409).json({ error: `"${label}" already exists.` });
        if (existing.filter(d => !d.builtin).length >= MAX_CUSTOM_DEPARTMENTS) return res.status(400).json({ error: 'Department limit reached.' });
        const { error } = await supabaseAdmin.from('company_departments').insert({ company_id: companyId, key, label });
        if (error) return res.status(500).json({ error: "Couldn't add the department." });
        await logAuditEvent(supabaseAdmin, { actorRole: session.role, action: 'add_department', companyId, targetType: 'department', targetId: key, details: { by_roster_id: session.userId || null } });
        return res.status(200).json({ ok: true, departments: await listDepartments(supabaseAdmin, companyId) });
      }

      if (action === 'delete_department') {
        // Only custom departments can go. Built-ins are fixed for everyone.
        const key = String(req.body.key || '');
        if (!key.startsWith('c_')) return res.status(400).json({ error: "Built-in departments can't be removed." });
        // Refuse while anything still routes to it: a document, an escalation
        // rule or a report schedule pointing at a deleted department would
        // email nobody, silently.
        const { data: docsUsing } = await supabaseAdmin.from('portal_documents').select('id, title')
          .eq('company_id', companyId).contains('departments', [key]).limit(5);
        const { data: schedulesUsing } = await supabaseAdmin.from('portal_report_schedules').select('id')
          .eq('company_id', companyId).eq('department', key).limit(1);
        const { data: companyDocs } = await supabaseAdmin.from('portal_documents').select('id').eq('company_id', companyId);
        const docIds = (companyDocs || []).map(d => d.id);
        const { data: questionsUsing } = docIds.length
          ? await supabaseAdmin.from('portal_questions').select('id').in('document_id', docIds).eq('escalation_department', key).limit(1)
          : { data: [] };
        if ((docsUsing || []).length || (schedulesUsing || []).length || (questionsUsing || []).length) {
          const names = (docsUsing || []).map(d => `"${d.title}"`).join(', ');
          return res.status(409).json({ error: `This department is still used by ${names || 'a Portal report schedule or escalation'}. Remove it there first.` });
        }
        const deptNamed = await assignmentsNamingAudience(supabaseAdmin, companyId, 'department', key);
        if (deptNamed.error) return res.status(500).json({ error: "Couldn't check the department's assignments. Try again." });
        if (deptNamed.rows.length) {
          return res.status(409).json({ error: `This department is still named by ${deptNamed.rows.length} document assignment${deptNamed.rows.length === 1 ? '' : 's'}. Remove ${deptNamed.rows.length === 1 ? 'it' : 'them'} under Document assignments first, or the document would open to everyone.` });
        }
        const { data: gone, error } = await supabaseAdmin.from('company_departments').delete().eq('company_id', companyId).eq('key', key).select('key');
        if (error) return res.status(500).json({ error: "Couldn't remove the department." });
        if (!gone || gone.length === 0) return res.status(404).json({ error: 'Not found.' });
        // Drop the tag from everyone who held it so no row keeps a dead key.
        const { data: holders } = await supabaseAdmin.from('roster').select('id, departments').eq('company_id', companyId).contains('departments', [key]);
        for (const h of holders || []) {
          await supabaseAdmin.from('roster').update({ departments: (h.departments || []).filter(d => d !== key) }).eq('id', h.id).eq('company_id', companyId);
        }
        await logAuditEvent(supabaseAdmin, { actorRole: session.role, action: 'delete_department', companyId, targetType: 'department', targetId: key, details: { by_roster_id: session.userId || null } });
        return res.status(200).json({ ok: true, departments: await listDepartments(supabaseAdmin, companyId) });
      }

      if (action === 'add_division') {
        const name = cleanLabel(req.body.name);
        if (!name) return res.status(400).json({ error: 'Enter a division name.' });
        const existing = await listDivisions(supabaseAdmin, companyId);
        if (existing.some(d => d.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: `"${name}" already exists.` });
        if (existing.length >= MAX_DIVISIONS) return res.status(400).json({ error: 'Division limit reached.' });
        const { error } = await supabaseAdmin.from('company_divisions').insert({ company_id: companyId, name });
        if (error) return res.status(500).json({ error: "Couldn't add the division." });
        await logAuditEvent(supabaseAdmin, { actorRole: session.role, action: 'add_division', companyId, targetType: 'division', targetId: name, details: { by_roster_id: session.userId || null } });
        return res.status(200).json({ ok: true, divisions: await listDivisions(supabaseAdmin, companyId) });
      }

      if (action === 'rename_division') {
        const name = cleanLabel(req.body.name);
        const divisionId = Number(req.body.id);
        if (!name || !Number.isInteger(divisionId)) return res.status(400).json({ error: 'Enter a division name.' });
        const existing = await listDivisions(supabaseAdmin, companyId);
        if (!existing.some(d => d.id === divisionId)) return res.status(404).json({ error: 'Not found.' });
        if (existing.some(d => d.id !== divisionId && d.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: `"${name}" already exists.` });
        const { error } = await supabaseAdmin.from('company_divisions').update({ name }).eq('id', divisionId).eq('company_id', companyId);
        if (error) return res.status(500).json({ error: "Couldn't rename the division." });
        return res.status(200).json({ ok: true, divisions: await listDivisions(supabaseAdmin, companyId) });
      }

      // delete_division
      const divisionId = Number(req.body.id);
      if (!Number.isInteger(divisionId)) return res.status(400).json({ error: 'Missing id.' });
      const divNamed = await assignmentsNamingAudience(supabaseAdmin, companyId, 'division', divisionId);
      if (divNamed.error) return res.status(500).json({ error: "Couldn't check the division's assignments. Try again." });
      if (divNamed.rows.length) {
        return res.status(409).json({ error: `This division is still named by ${divNamed.rows.length} document assignment${divNamed.rows.length === 1 ? '' : 's'}. Remove ${divNamed.rows.length === 1 ? 'it' : 'them'} under Document assignments first, or the document would open to everyone.` });
      }
      const { data: gone, error } = await supabaseAdmin.from('company_divisions').delete().eq('id', divisionId).eq('company_id', companyId).select('id');
      if (error) return res.status(500).json({ error: "Couldn't remove the division." });
      if (!gone || gone.length === 0) return res.status(404).json({ error: 'Not found.' });
      const { data: holders } = await supabaseAdmin.from('roster').select('id, divisions').eq('company_id', companyId).contains('divisions', [divisionId]);
      for (const h of holders || []) {
        await supabaseAdmin.from('roster').update({ divisions: (h.divisions || []).filter(d => d !== divisionId) }).eq('id', h.id).eq('company_id', companyId);
      }
      await logAuditEvent(supabaseAdmin, { actorRole: session.role, action: 'delete_division', companyId, targetType: 'division', targetId: divisionId, details: { by_roster_id: session.userId || null } });
      return res.status(200).json({ ok: true, divisions: await listDivisions(supabaseAdmin, companyId) });
    }

    // ══ DOCUMENT ASSIGNMENTS (the Owner's screen) ═══════════════════════════
    // Who may submit or view which document. Rows only ever narrow access;
    // enforcement is server-lib/documentAccess.js. Owner and founder only,
    // and every id is checked against the company in
    // server-lib/assignmentAdmin.js.
    if (action === 'list_document_assignments' || action === 'create_document_assignment'
        || action === 'end_document_assignment' || action === 'set_site_division') {
      if (!canManageCompany(session)) return res.status(403).json({ error: 'Only the account owner can change document assignments.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const missingTable = (e) => !!e && ['42P01', 'PGRST205'].includes(String(e.code || ''));
      const SETUP_MSG = "Document assignments aren't switched on for this database yet. Contact FORA support.";

      if (action === 'list_document_assignments') {
        const [documents, rowsRes, peopleRes] = await Promise.all([
          listAssignableDocuments(supabaseAdmin, companyId),
          supabaseAdmin.from('document_assignments')
            .select('id, document_key, audience_type, audience_value, action, due_at, created_at')
            .eq('company_id', companyId).is('ended_at', null).order('created_at', { ascending: true }),
          supabaseAdmin.from('roster').select('id, role, departments, divisions, default_site_id').eq('company_id', companyId).eq('active', true),
        ]);
        if (rowsRes.error && !missingTable(rowsRes.error)) return res.status(500).json({ error: 'Could not load assignments.' });
        if (peopleRes.error) return res.status(500).json({ error: 'Could not load assignments.' });
        let siteRes = await supabaseAdmin.from('sites').select('id, division_id').eq('company_id', companyId);
        if (siteRes.error) siteRes = { data: [] };
        const siteDivision = new Map((siteRes.data || []).map(s => [s.id, s.division_id]));
        return res.status(200).json({
          documents,
          needsSetup: missingTable(rowsRes.error),
          assignments: describeAssignments(rowsRes.data || [], peopleRes.data || [], siteDivision),
        });
      }

      if (action === 'create_document_assignment') {
        // `action` on the request is this endpoint's own verb, so the assignment's
        // verb (submit or view) arrives as `assignAction`.
        const checked = await validateAssignment(supabaseAdmin, companyId, { ...req.body, action: req.body.assignAction });
        if (checked.error) return res.status(checked.status).json({ error: checked.error });
        const { data: active, error: readErr } = await supabaseAdmin.from('document_assignments')
          .select('id, document_key, audience_type, audience_value, action').eq('company_id', companyId).is('ended_at', null);
        if (readErr) return res.status(500).json({ error: missingTable(readErr) ? SETUP_MSG : "Couldn't save the assignment." });
        if ((active || []).length >= MAX_ACTIVE_ASSIGNMENTS) return res.status(400).json({ error: 'Assignment limit reached.' });
        const r = checked.row;
        if ((active || []).some(a => a.document_key === r.document_key && a.action === r.action
            && a.audience_type === r.audience_type && (a.audience_value || null) === (r.audience_value || null))) {
          return res.status(409).json({ error: 'That assignment already exists.' });
        }
        const { data: created, error } = await supabaseAdmin.from('document_assignments')
          .insert({ ...r, company_id: companyId, created_by: session.userId || null }).select('id').single();
        if (error) {
          console.error('create_document_assignment failed:', error.message);
          return res.status(500).json({ error: missingTable(error) ? SETUP_MSG : "Couldn't save the assignment." });
        }
        await logAuditEvent(supabaseAdmin, { actorRole: session.role, action: 'create_document_assignment', companyId, targetType: 'document_assignment', targetId: created.id, details: { document_key: r.document_key, audience_type: r.audience_type, audience_value: r.audience_value, assignment_action: r.action, by_roster_id: session.userId || null } });
        return res.status(200).json({ ok: true, id: created.id });
      }

      if (action === 'end_document_assignment') {
        const id = Number(req.body.id);
        if (!Number.isInteger(id)) return res.status(400).json({ error: 'Missing id.' });
        const { data: ended, error } = await supabaseAdmin.from('document_assignments')
          .update({ ended_at: new Date().toISOString() }).eq('id', id).eq('company_id', companyId).is('ended_at', null).select('id');
        if (error) return res.status(500).json({ error: missingTable(error) ? SETUP_MSG : "Couldn't remove the assignment." });
        if (!ended || ended.length === 0) return res.status(404).json({ error: 'Not found.' });
        await logAuditEvent(supabaseAdmin, { actorRole: session.role, action: 'end_document_assignment', companyId, targetType: 'document_assignment', targetId: id, details: { by_roster_id: session.userId || null } });
        return res.status(200).json({ ok: true });
      }

      if (action === 'set_site_division') {
        const siteId = Number(req.body.siteId);
        if (!Number.isInteger(siteId)) return res.status(400).json({ error: 'Pick a site.' });
        const { data: siteRows } = await supabaseAdmin.from('sites').select('id').eq('id', siteId).eq('company_id', companyId).limit(1);
        if (!siteRows || siteRows.length === 0) return res.status(403).json({ error: 'Not allowed for this site.' });
        let divisionId = null;
        if (req.body.divisionId !== null && req.body.divisionId !== undefined && req.body.divisionId !== '') {
          const ids = await sanitizeDivisionIds(supabaseAdmin, companyId, [req.body.divisionId]);
          if (!ids || ids.length !== 1) return res.status(400).json({ error: 'Pick one of your divisions.' });
          divisionId = ids[0];
        }
        const { error } = await supabaseAdmin.from('sites').update({ division_id: divisionId }).eq('id', siteId).eq('company_id', companyId);
        if (error) {
          console.error('set_site_division failed:', error.message);
          return res.status(500).json({ error: ['42703', 'PGRST204'].includes(String(error.code || '')) ? SETUP_MSG : "Couldn't save the site's division." });
        }
        await logAuditEvent(supabaseAdmin, { actorRole: session.role, action: 'set_site_division', companyId, targetType: 'site', targetId: siteId, details: { division_id: divisionId, by_roster_id: session.userId || null } });
        return res.status(200).json({ ok: true });
      }
    }

    // The signed-in person's own profile, for auto-filling forms and showing
    // "Filling in as" details. Their own row only; no id accepted.
    if (action === 'get_my_profile') {
      if (!session.userId) return res.status(200).json({ applicable: false });
      const { data: me, error } = await supabaseAdmin
        .from('roster')
        .select('id, name, role, is_owner, title, departments, divisions, default_site_id')
        .eq('id', session.userId).eq('company_id', session.companyId).limit(1);
      if (error || !me || !me[0]) return res.status(403).json({ error: 'Not allowed.' });
      const [departments, divisions] = await Promise.all([
        listDepartments(supabaseAdmin, session.companyId), listDivisions(supabaseAdmin, session.companyId),
      ]);
      const deptLabel = new Map(departments.map(d => [d.key, d.label]));
      const divName = new Map(divisions.map(d => [d.id, d.name]));
      return res.status(200).json({
        applicable: true,
        name: me[0].name, role: me[0].role, isOwner: me[0].is_owner === true, title: me[0].title || '',
        departments: (me[0].departments || []).map(k => ({ key: k, label: deptLabel.get(k) || k })),
        divisions: (me[0].divisions || []).map(id => ({ id, name: divName.get(id) || '' })).filter(d => d.name),
        defaultSiteId: me[0].default_site_id || null,
      });
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
      const siteNamed = await assignmentsNamingAudience(supabaseAdmin, site.company_id, 'site', id);
      if (siteNamed.error) return res.status(500).json({ error: "Couldn't check the site's assignments. Try again." });
      if (siteNamed.rows.length) blockers.push(`${siteNamed.rows.length} document assignment${siteNamed.rows.length === 1 ? '' : 's'} (remove ${siteNamed.rows.length === 1 ? 'it' : 'them'} first, or the document would open to everyone)`);
      const { count: monthlyCount } = await supabaseAdmin
        .from('inspection_records').select('id', { count: 'exact', head: true }).eq('site_id', id);
      if (monthlyCount) blockers.push(`${monthlyCount} monthly site inspection${monthlyCount === 1 ? '' : 's'}`);
      const { count: customCount } = await supabaseAdmin
        .from('custom_form_records').select('id', { count: 'exact', head: true }).eq('site_id', id);
      if (customCount) blockers.push(`${customCount} custom document${customCount === 1 ? '' : 's'}`);
      // Company Portal records point at their site the same way (NOT NULL
      // portal_records.site_id, no cascade), so they block it too. Without
      // this check the delete hit the foreign key and returned the generic
      // "Couldn't remove site." with no reason (parity sweep break P3).
      const { count: portalCount } = await supabaseAdmin
        .from('portal_records').select('id', { count: 'exact', head: true }).eq('site_id', id);
      if (portalCount) blockers.push(`${portalCount} Company Portal submission${portalCount === 1 ? '' : 's'}`);
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

    // ── Fleet activity (breaks #13 and #18) ───────────────────────────────
    //
    // Last day on site from daily reports, what each attachment was last
    // mounted on from pre-trips, and the most used / most repaired
    // attachments. Read-only and supervisor/admin only. Not module-gated:
    // Fleet Overview is BASE, and every source here is the company's own
    // records, so a company without Daily Reports simply has no last-on-site
    // lines rather than being refused the screen.
    if (action === 'fleet_activity') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const [fleetRes, dailyRes, inspRes, logRes] = await Promise.all([
        supabaseAdmin.from('equipment').select(EQUIPMENT_COLUMNS).eq('company_id', companyId),
        supabaseAdmin.from('daily_reports').select('equipment_ids, site, report_date, created_at').eq('company_id', companyId).not('equipment_ids', 'is', null),
        supabaseAdmin.from('inspections').select('equipment_id, equipment_label, trip_type, results_json, created_at').eq('company_id', companyId),
        supabaseAdmin.from('equipment_maintenance_log').select('equipment_id, entry_type').eq('company_id', companyId),
      ]);
      if (fleetRes.error || dailyRes.error || inspRes.error || logRes.error) {
        return res.status(500).json({ error: 'Could not load fleet activity.' });
      }
      const fleet = (fleetRes.data || []).map(eq => ({
        ...eq,
        label: [eq.year, eq.make, eq.model, eq.type].filter(Boolean).join(' ') + (eq.unit_number ? ` (Unit ${eq.unit_number})` : ''),
      }));
      return res.status(200).json({
        lastOnSite: lastOnSiteByEquipment(dailyRes.data || []),
        // results_json is client jsonb, so only report attachments that
        // are actually in this company's fleet.
        mountedOn: Object.fromEntries(Object.entries(mountedOnByAttachment(inspRes.data || []))
          .filter(([id]) => fleet.some(eq => String(eq.id) === id))),
        attachments: attachmentStats(fleet, inspRes.data || [], logRes.data || []),
      });
    }

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

      const { data: eqRows, error: eqErr } = await supabaseAdmin.from('equipment').select('id, company_id, is_attachment, type, make, model').eq('id', id).limit(1);
      if (eqErr || !eqRows || eqRows.length === 0) return res.status(404).json({ error: 'Equipment not found.' });
      if (session.role === 'supervisor' && eqRows[0].company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed to change this equipment.' });
      }

      const interval = pmInterval != null && pmInterval !== '' ? parseFloat(pmInterval) : null;
      if (interval != null && (Number.isNaN(interval) || interval <= 0)) {
        return res.status(400).json({ error: 'Enter a valid maintenance interval.' });
      }
      // Break #18 (Dillon, 2026-09-23): attachments get no PM schedule
      // unless they are a trailer, and a trailer's clock runs on towed
      // distance (api/maintenance.js), so its interval has to be in KM.
      // Turning tracking OFF (interval null) is always allowed, so a legacy
      // interval on a set of forks can still be cleared.
      if (interval != null && !pmAllowedFor(eqRows[0])) {
        return res.status(400).json({ error: "Attachments don't get a maintenance schedule unless they're a trailer." });
      }
      // By type, not the flag (#28): an unflagged trailer has no meter either.
      if (interval != null && isTowedUnit(eqRows[0]) && readingUnit !== 'KM') {
        return res.status(400).json({ error: 'A trailer has no meter; set its interval in KM towed.' });
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
      // api/logs.js again (daily_report), api/portal.js (portal_escalation).
      const bySourceType = { flha_edit: 0, toolbox_talk: 0, incident: 0, near_miss: 0, equipment_inspection: 0, monthly_inspection: 0, daily_report: 0, portal_escalation: 0 };
      const tally = { portalFlagged: {}, addedHazards: {}, removedHazards: {}, toolboxTopics: {}, incidentCategories: {}, nearMissInvolved: {}, defectiveItems: {}, inspectedEquipment: {}, monthlyFailures: {}, workingConditions: {} };
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
        } else if (row.source_type === 'portal_escalation') {
          // Question and document only. The answer and the worker are never
          // in the signal, so they cannot be in this list either.
          if (j.question && j.document) bump(tally.portalFlagged, `${j.question} (${j.document})`);
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
        topPortalFlagged: topN(tally.portalFlagged),
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
      // The most recent punch in any week (break #27). A company without the
      // Time Clock module keeps a read-only tab only while it has recorded
      // hours, and a week that never became a report (the cron skips a
      // company once the module is off) would otherwise be invisible. A
      // failed lookup just leaves it null; the reports still come back.
      const { data: latest } = await supabaseAdmin
        .from('time_clock_entries')
        .select('clock_in')
        .eq('company_id', companyId)
        .order('clock_in', { ascending: false })
        .limit(1);
      return res.status(200).json({ reports, latestEntryAt: (latest && latest[0] && latest[0].clock_in) || null });
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
    return res.status(500).json({ error: keyProblemMessage(e) || 'Server error. Please try again.' });
  }
}
