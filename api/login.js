// api/login.js
// Handles all login checks (admin / worker / supervisor) on the server,
// using the secret service role key instead of the public anon key.
// This means the actual database check can never be bypassed from someone's
// browser.
//
// Worker/supervisor login is now a per-company roster of individually
// PIN'd people, not two shared company-wide codes — but a company only
// moves onto that once its `roster_enabled` flag is flipped (from Admin
// Panel, once someone has built out that company's roster). Until then,
// this file's legacy branch behaves exactly as it always has, so no
// existing company is disrupted by this change landing.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import Stripe from 'stripe';
import { createUploadUrl } from '../server-lib/uploadUrls.js';
import { validateOnboardingIntake, randomToken } from '../server-lib/onboardingHelpers.js';
import { runOnboardingDrafts } from '../server-lib/onboardingDrafting.js';
import { sendEmail, siteOrigin } from '../server-lib/email.js';
import { sendSlackNotification } from '../server-lib/slack.js';
import { canAutoApprove, provisionCompanyFromRequest } from '../server-lib/onboardingApproval.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const ROSTER_TICKET_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PIN_LOCKOUT_AFTER_ATTEMPTS = 8;
const PIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

// Real company/worker/supervisor codes observed live top out at 13
// characters — anything at or above this length can't be a legitimate
// company code, so throttling attempts at this length can never catch
// ordinary worker/supervisor login traffic (see the comment on
// verifyMasterCode for why the shared login endpoint itself isn't
// rate-limited). Codes below this length are never counted at all.
const MASTER_CODE_THROTTLE_MIN_LENGTH = 14;
const MASTER_CODE_THROTTLE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MASTER_CODE_THROTTLE_MAX_ATTEMPTS = 20;

function clientIp(req) {
  // Vercel sets x-vercel-forwarded-for itself and a client cannot forge it,
  // so prefer it. Falling back to x-forwarded-for, take the RIGHTMOST entry:
  // the proxy appends the real peer, so the leftmost entry is whatever the
  // caller put there. Reading [0] let an attacker send a fresh random first
  // entry per request and get a brand-new throttle bucket every time,
  // nullifying every IP-based limit built on this helper.
  const vercelFwd = req.headers['x-vercel-forwarded-for'];
  if (typeof vercelFwd === 'string' && vercelFwd.trim()) {
    const parts = vercelFwd.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    const parts = fwd.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket?.remoteAddress || 'unknown';
}

// Fixed-window per-IP counter backed by master_code_ip_limits (see
// docs/schema/master-code-throttle-migration.sql). Originally master-code
// only; now shared by three buckets, kept apart by key prefix — a bare IP
// for master-code attempts, `code:<ip>` for failed company-code attempts,
// and `pin:<ip>` for PIN guesses. `ip` is the table's primary key, so the
// prefixes can never collide with a bare address.
//
// Still a non-atomic read-then-write, so a burst of simultaneous requests
// can slip a few attempts past the cap. That is acceptable here (these are
// coarse ceilings measured in dozens, not a precise lockout) and is not
// the same problem as the PIN lockout race, where the counter never
// advanced at all — that one is now atomic, see record_failed_pin_attempt.
async function checkIpThrottle(key, maxAttempts, windowMs) {
  const now = Date.now();
  const { data: rows } = await supabaseAdmin
    .from('master_code_ip_limits')
    .select('window_start, count')
    .eq('ip', key)
    .limit(1);
  const row = rows && rows[0];
  if (!row || now - new Date(row.window_start).getTime() > windowMs) {
    await supabaseAdmin
      .from('master_code_ip_limits')
      .upsert({ ip: key, window_start: new Date(now).toISOString(), count: 1 });
    return true;
  }
  if (row.count >= maxAttempts) return false;
  await supabaseAdmin.from('master_code_ip_limits').update({ count: row.count + 1 }).eq('ip', key);
  return true;
}

async function checkMasterCodeThrottle(ip) {
  return checkIpThrottle(ip, MASTER_CODE_THROTTLE_MAX_ATTEMPTS, MASTER_CODE_THROTTLE_WINDOW_MS);
}

// Counts only FAILED company-code attempts, and only short ones — the
// length band the master-code throttle above deliberately ignores. That
// exemption left auto-provisioned company codes (3 derivable initials +
// 3 random chars, so ~29,791 candidates) enumerable at full speed, and a
// valid code hands back a ticket that lists the whole roster. The cap is
// set high so a jobsite full of workers behind one NAT address never
// reaches it on ordinary typos; a scripted sweep does, immediately.
const COMPANY_CODE_THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const COMPANY_CODE_THROTTLE_MAX_FAILURES = 50;

// Per-IP ceiling on PIN guesses. The per-account lockout is the primary
// control; this is what stops an attacker spreading guesses across many
// roster ids to stay under it.
const PIN_IP_THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const PIN_IP_THROTTLE_MAX_FAILURES = 50;

// Per-IP ceilings on the two PUBLIC onboarding endpoints. Both sit above
// every auth check, by design — a prospect filling in the intake form has no
// account yet. But that left them fully unmetered:
//
//   submit_onboarding_intake  inserts a DB row, can call the Stripe API, and
//     sends mail via Resend to a CALLER-SUPPLIED address from FORA's verified
//     sending domain, plus a Slack ping. Scripted, that's a phishing relay
//     authenticated as forafieldsolutions.com (SPF/DKIM pass), a wrecked
//     sender reputation, an unusable Slack channel, and amplified spend.
//   create_onboarding_upload_url  mints a signed upload token for a
//     caller-chosen path, i.e. unauthenticated write access to storage.
//
// Caps are per-IP fixed windows, generous enough that a real prospect
// retrying a form never notices, low enough that a script dies immediately.
// A genuine submitter needs one or two attempts, not twenty.
const ONBOARDING_THROTTLE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const ONBOARDING_INTAKE_MAX_PER_HOUR = 10;
const ONBOARDING_UPLOAD_MAX_PER_HOUR = 40;

// Hash-then-compare so mismatched-length inputs never short-circuit —
// timingSafeEqual itself throws on unequal-length buffers, and fixed-length
// digests sidestep that while still comparing in constant time.
function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a)).digest();
  const bh = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

// Proves a given onboarding-uploads storage path was actually issued by
// THIS server's create_onboarding_upload_url call, not just supplied by
// the client — submit_onboarding_intake used to accept sopFilePaths
// as-is, which meant any string could be sent in, including another
// company's already-uploaded SOP path (paths aren't secret — they're
// shown back to admins as signed URLs in the Admin Panel, and the SOP
// drafting feature downloads and LLM-summarizes whatever path is on the
// request, so an unscoped path could pull another company's SOP content
// into a submitter's own claim page). create_onboarding_upload_url signs
// each path it hands out; submit_onboarding_intake only keeps paths whose
// token verifies, and silently drops anything else rather than failing
// the whole submission over it.
function signSopPathToken(path) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(`sop-path:${path}`).digest('base64url');
}

function verifySopPathToken(path, token) {
  if (!path || typeof path !== 'string' || !token || typeof token !== 'string') return false;
  return safeEqual(signSopPathToken(path), token);
}

// Keeps only the (path, token) pairs that verify, in the original order —
// `paths` and `pathTokens` are parallel arrays built client-side from
// successive create_onboarding_upload_url responses (see uploadSops() in
// src/Onboarding.jsx). Anything that doesn't verify (missing token,
// tampered path, a path never issued through this flow at all) is simply
// left out.
function filterVerifiedSopPaths(paths, pathTokens) {
  if (!Array.isArray(paths)) return [];
  const tokens = Array.isArray(pathTokens) ? pathTokens : [];
  return paths.filter((p, i) => typeof p === 'string' && verifySopPathToken(p, tokens[i]));
}

// Creates a signed "pass" (session token) that proves this login was checked
// and approved by our server. It cannot be faked without knowing SESSION_SECRET,
// which only lives in Vercel's settings.
function signSession(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

// A short-lived, roleless ticket that proves "this browser already knows a
// valid code for this company" without handing back a raw companyId (which
// would let the name-picker step be probed by guessing IDs) and without
// granting any of the access a real session would — every other protected
// endpoint in this app gates on session.role, which a ticket never has, so
// it can never be replayed as a session even within its 5-minute window.
function signTicket(companyId, companyName, appType) {
  return signSession({ purpose: 'roster', companyId, companyName, appType, issuedAt: Date.now() });
}

function verifyTicket(ticket) {
  if (!ticket || typeof ticket !== 'string' || !ticket.includes('.')) return null;
  const [data, sig] = ticket.split('.');
  const expectedSig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  if (!safeEqual(sig, expectedSig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.purpose !== 'roster') return null;
    if (!payload.issuedAt || Date.now() - payload.issuedAt > ROSTER_TICKET_TTL_MS) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// scrypt (Node builtin, no new dependency) + a per-user random salt. A
// 4-digit PIN is inherently low-entropy against a full database compromise,
// but scrypt raises that cost significantly — the actual defense against
// realistic online guessing is the per-account lockout below, which must
// hold regardless of hash strength.
function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString('hex');
}

function verifyPin(pin, salt, expectedHex) {
  const a = Buffer.from(hashPin(pin, salt), 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// A short-lived ticket proving "this browser already knows the master
// code" — carries no companyId (unlike a roster ticket), since the point
// of the master flow is picking any company after the fact.
function signMasterTicket() {
  return signSession({ purpose: 'master', issuedAt: Date.now() });
}

function verifyMasterTicket(ticket) {
  if (!ticket || typeof ticket !== 'string' || !ticket.includes('.')) return null;
  const [data, sig] = ticket.split('.');
  const expectedSig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  if (!safeEqual(sig, expectedSig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.purpose !== 'master') return null;
    if (!payload.issuedAt || Date.now() - payload.issuedAt > ROSTER_TICKET_TTL_MS) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// Checked against every worker/supervisor login attempt — it's compared
// on every normal login too, so a lockout on this shared endpoint would
// eventually catch ordinary traffic (real company/worker/supervisor
// codes, typos included). Instead, MASTER_CODE_THROTTLE_MIN_LENGTH above
// throttles per-IP only for attempts long enough to be a plausible
// master-code guess — see checkMasterCodeThrottle. Stored hashed,
// compared in constant time, and every successful use is logged in
// master_login_log — that log is the visibility backstop for whatever a
// throttle alone doesn't catch.
async function verifyMasterCode(entered) {
  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('master_code_hash, master_code_salt')
    .eq('id', 1)
    .limit(1);
  if (error || !data || data.length === 0) return false;
  const row = data[0];
  const a = Buffer.from(hashPin(entered, row.master_code_salt), 'hex');
  const b = Buffer.from(row.master_code_hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Best-effort notification for a new onboarding submission — silently
// skipped until RESEND_API_KEY / SLACK_ONBOARDING_WEBHOOK_URL is
// configured, and never allowed to fail the submission itself (the row is
// already saved by the time this runs). Email and Slack are independent —
// one failing (e.g. a bad webhook URL) doesn't skip the other.
async function sendOnboardingNotification(record) {
  const text = [
    `Company: ${record.company_name || '—'}`,
    `Contact: ${record.contact_name || '—'} · ${record.contact_email || '—'} · ${record.contact_phone || '—'}`,
    `Address: ${record.address || '—'}`,
    '',
    `Sites:\n${record.sites_list || '—'}`,
    '',
    `Units / Equipment:\n${record.units_list || '—'}`,
    '',
    `Users:\n${record.users_list || '—'}`,
    ...(record.skippedUserLines && record.skippedUserLines.length > 0
      ? [`Couldn't parse (submitter can self-fix via their edit link): ${record.skippedUserLines.join('; ')}`]
      : []),
    '',
    `Custom form / build request:\n${record.custom_request || '—'}`,
    '',
    `SOP files uploaded: ${record.sop_file_paths?.length || 0}`,
    '',
    'Review and mark status in the Admin Panel → Onboarding Requests tab.',
  ].join('\n');

  try {
    await sendEmail({
      to: 'forafieldsolutions@gmail.com',
      subject: `New onboarding request — ${record.company_name || 'Unnamed company'}`,
      text,
    });
  } catch (e) {
    console.error('Onboarding notification email failed:', e.message);
  }

  try {
    await sendSlackNotification(`:bell: *New onboarding request — needs review* — ${record.company_name || 'Unnamed company'}\n\n${text}`);
  } catch (e) {
    console.error('Onboarding notification Slack message failed:', e.message);
  }
}

// Best-effort confirmation to the submitter themselves, with a self-serve
// edit link — so if something needs fixing (either the admin flags it via
// admin_note/needs_info, or the submitter just wants to correct a typo)
// they can come back and update their own submission instead of emailing
// FORA and waiting on a manual relay. Only useful before a company has
// been created from the request — Onboarding.jsx hides the edit form once
// the record shows created_company_id.
async function sendSubmitterConfirmation(req, record, editToken) {
  const editUrl = `${siteOrigin(req)}/onboarding?edit=${editToken}`;
  const text = [
    `Thanks — we've got your submission for ${record.company_name || 'your company'}.`,
    "We'll email you within one business day once your company is live on FORA.",
    '',
    `Need to fix or add something first? Edit your submission any time before then: ${editUrl}`,
  ].join('\n');
  await sendEmail({
    to: record.contact_email,
    subject: `We've got your FORA onboarding request — ${record.company_name || ''}`,
    text,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.body || {};

  // ── Onboarding intake file uploads — public, no login required (same
  // reasoning as submit_onboarding_intake below). Restricted to the two
  // buckets the onboarding form actually uses. ───────────────────────────
  if (action === 'create_onboarding_upload_url') {
    const uploadAllowed = await checkIpThrottle(`onbup:${clientIp(req)}`, ONBOARDING_UPLOAD_MAX_PER_HOUR, ONBOARDING_THROTTLE_WINDOW_MS);
    if (!uploadAllowed) return res.status(429).json({ error: 'Too many uploads. Please wait and try again.' });

    const { bucket, filename } = req.body;
    if (bucket !== 'company-logos' && bucket !== 'onboarding-uploads') {
      return res.status(400).json({ error: 'Invalid bucket.' });
    }
    const result = await createUploadUrl(supabaseAdmin, bucket, filename);
    if (result.error) return res.status(500).json({ error: result.error });
    const response = { ok: true, path: result.path, uploadToken: result.uploadToken };
    // Only onboarding-uploads (SOP files) needs a scoping guarantee — that
    // path is later downloaded server-side and fed to an LLM (see
    // server-lib/onboardingDrafting.js), so submit_onboarding_intake below
    // must only ever accept a path this same call issued. company-logos
    // doesn't need this: a logoUrl is just displayed back, never read
    // server-side, so there's nothing sensitive to scope.
    if (bucket === 'onboarding-uploads') {
      response.pathToken = signSopPathToken(result.path);
    }
    return res.status(200).json(response);
  }

  // ── Step 2: name picker (ticket only, no PIN yet) ───────────────────────
  if (action === 'list_roster_names') {
    const { companyTicket } = req.body;
    const ticket = verifyTicket(companyTicket);
    if (!ticket) return res.status(401).json({ error: 'That took too long — please start over.' });

    const { data, error } = await supabaseAdmin
      .from('roster')
      .select('id, name, role')
      .eq('company_id', ticket.companyId)
      .eq('active', true)
      .order('role', { ascending: true })
      .order('name', { ascending: true });
    if (error) return res.status(500).json({ error: 'Could not load the roster.' });
    return res.status(200).json({ names: data || [] });
  }

  // ── Step 3: PIN ──────────────────────────────────────────────────────────
  if (action === 'roster_login') {
    const { companyTicket, rosterId, pin } = req.body;
    const ticket = verifyTicket(companyTicket);
    if (!ticket) return res.status(401).json({ error: 'That took too long — please start over.' });
    if (!rosterId || !pin) return res.status(400).json({ error: 'Missing details.' });

    const pinIpAllowed = await checkIpThrottle(`pin:${clientIp(req)}`, PIN_IP_THROTTLE_MAX_FAILURES, PIN_IP_THROTTLE_WINDOW_MS);
    if (!pinIpAllowed) return res.status(429).json({ error: 'Too many attempts. Please wait and try again.' });

    const { data: rows, error } = await supabaseAdmin
      .from('roster')
      .select('*')
      .eq('id', rosterId)
      .eq('company_id', ticket.companyId)
      .limit(1);
    if (error) return res.status(500).json({ error: 'Connection error. Please try again.' });
    const member = rows && rows[0];
    if (!member) return res.status(404).json({ error: 'Not found — please start over.' });

    if (!member.active) {
      return res.status(403).json({ error: 'This account is no longer active. Contact your administrator.' });
    }
    if (member.pin_locked_until && new Date(member.pin_locked_until) > new Date()) {
      return res.status(403).json({ error: 'Too many incorrect attempts. Try again in a few minutes.' });
    }

    const { data: coRows } = await supabaseAdmin.from('companies').select('suspended').eq('id', ticket.companyId).limit(1);
    const suspended = !!(coRows && coRows[0] && coRows[0].suspended);
    if (suspended && member.role === 'worker') {
      return res.status(403).json({ error: 'Access suspended. Please contact your administrator.' });
    }

    if (!verifyPin(pin, member.pin_salt, member.pin_hash)) {
      // Increment atomically in the database. The old read-then-write used
      // the `member` row fetched above, so N concurrent guesses all read
      // the same starting count and all wrote back count+1 — the lockout
      // never tripped and a 4-digit PIN space could be exhausted in a
      // single parallel burst. The UPDATE inside this function takes a row
      // lock, so concurrent attempts serialize and the threshold holds.
      const { data: lockRows, error: lockErr } = await supabaseAdmin.rpc('record_failed_pin_attempt', {
        p_roster_id: member.id,
        p_lockout_after: PIN_LOCKOUT_AFTER_ATTEMPTS,
        p_lockout_seconds: Math.round(PIN_LOCKOUT_MS / 1000),
      });
      if (lockErr) {
        // Fallback to the legacy non-atomic path so that a deploy landing
        // before docs/schema/pin-lockout-atomic-migration.sql is applied
        // degrades to the old behavior instead of locking everyone out.
        console.error('record_failed_pin_attempt RPC unavailable, using non-atomic fallback:', lockErr.message);
        const attempts = (member.failed_pin_attempts || 0) + 1;
        const updates = { failed_pin_attempts: attempts };
        if (attempts >= PIN_LOCKOUT_AFTER_ATTEMPTS) {
          updates.pin_locked_until = new Date(Date.now() + PIN_LOCKOUT_MS).toISOString();
        }
        await supabaseAdmin.from('roster').update(updates).eq('id', member.id);
      }
      void lockRows;
      return res.status(401).json({ error: 'Incorrect PIN.' });
    }

    await supabaseAdmin
      .from('roster')
      .update({ failed_pin_attempts: 0, pin_locked_until: null, last_login_at: new Date().toISOString() })
      .eq('id', member.id);

    const payload = {
      role: member.role,
      companyId: ticket.companyId,
      companyName: ticket.companyName,
      appType: ticket.appType || 'safety',
      userId: member.id,
      userName: member.name,
      suspended,
      issuedAt: Date.now(),
    };
    const token = signSession(payload);
    return res.status(200).json({ session: payload, token });
  }

  // ── Onboarding wallet (Phase 2): redeem a single-use invite link ────────
  // Opening the unique link a supervisor/admin generated and shared
  // (api/companydata.js's create_wallet_invite) is treated as proof of
  // identity, same as typing the right PIN — it mints an ordinary session,
  // scoped to the roster row the token belongs to, never to anything the
  // client itself sends. The token is single-use: cleared the moment it's
  // redeemed, so re-sharing the link after first use does nothing further.
  if (action === 'redeem_wallet_invite') {
    const { inviteToken } = req.body;
    if (!inviteToken) return res.status(400).json({ error: 'Missing invite link.' });

    const { data: rows, error } = await supabaseAdmin
      .from('roster')
      .select('id, name, email, role, company_id, active, wallet_enabled, wallet_invite_token_expires_at')
      .eq('wallet_invite_token', inviteToken)
      .limit(1);
    if (error) return res.status(500).json({ error: 'Connection error. Please try again.' });
    const member = rows && rows[0];
    if (!member) return res.status(404).json({ error: "That invite link isn't valid." });
    if (!member.active || !member.wallet_enabled) {
      return res.status(403).json({ error: 'This invite is no longer active. Contact your employer for a new one.' });
    }
    if (!member.wallet_invite_token_expires_at || new Date(member.wallet_invite_token_expires_at) < new Date()) {
      return res.status(400).json({ error: 'This invite link has expired — ask your employer to send a new one.' });
    }

    const { data: coRows } = await supabaseAdmin.from('companies').select('id, name, app_type, suspended').eq('id', member.company_id).limit(1);
    const company = coRows && coRows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });
    // Same suspension gate as roster_login: a suspended company's workers
    // don't get in even with a valid, unexpired invite link.
    if (company.suspended && member.role === 'worker') {
      return res.status(403).json({ error: 'Access suspended. Please contact your administrator.' });
    }

    // Conditioned on the token still matching (not just the row's id), so
    // two near-simultaneous redemptions of the same link can't both pass —
    // whichever request's update actually clears a row wins the race; the
    // loser's returned row is empty and it's rejected below instead of also
    // minting a session.
    const { data: cleared, error: clearError } = await supabaseAdmin
      .from('roster')
      .update({ wallet_invite_token: null, wallet_invite_token_expires_at: null })
      .eq('id', member.id)
      .eq('wallet_invite_token', inviteToken)
      .select('id');
    if (clearError || !cleared || cleared.length === 0) {
      return res.status(400).json({ error: 'This invite link was already used.' });
    }

    const payload = {
      role: member.role,
      companyId: company.id,
      companyName: company.name,
      appType: company.app_type || 'safety',
      userId: member.id,
      userName: member.name,
      suspended: !!company.suspended,
      issuedAt: Date.now(),
    };
    const token = signSession(payload);
    return res.status(200).json({ session: payload, token, email: member.email || '' });
  }

  // ── Master code, step 2: pick a company + role ──────────────────────────
  if (action === 'master_login') {
    const { masterTicket, companyId, role: pickedRole } = req.body;
    const ticket = verifyMasterTicket(masterTicket);
    if (!ticket) return res.status(401).json({ error: 'That took too long — please start over.' });
    if (!companyId || (pickedRole !== 'worker' && pickedRole !== 'supervisor')) {
      return res.status(400).json({ error: 'Missing details.' });
    }

    const { data: coRows, error: coErr } = await supabaseAdmin.from('companies').select('id, name, app_type').eq('id', companyId).limit(1);
    if (coErr) return res.status(500).json({ error: 'Connection error. Please try again.' });
    const company = coRows && coRows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    await supabaseAdmin.from('master_login_log').insert({ company_id: company.id, role: pickedRole });

    // Legacy-shaped session, same as any pre-cutover login — deliberately
    // ignores roster_enabled and the company's real suspended flag, since
    // the whole point of this path is unrestricted access regardless of a
    // given company's state.
    const payload = {
      role: pickedRole,
      companyId: company.id,
      companyName: company.name,
      appType: company.app_type || 'safety',
      suspended: false,
      issuedAt: Date.now(),
    };
    const token = signSession(payload);
    return res.status(200).json({ session: payload, token });
  }

  // ── Onboarding intake — public, no login required. A brand-new customer
  // fills this in right after paying, before they have any credentials.
  // Also handles a self-serve edit: if editToken matches an existing,
  // not-yet-approved request, this updates that row instead of creating a
  // new one — see get_onboarding_intake below for how the submitter gets
  // back to their own submission. ─────────────────────────────────────────
  if (action === 'submit_onboarding_intake') {
    const intakeAllowed = await checkIpThrottle(`onbint:${clientIp(req)}`, ONBOARDING_INTAKE_MAX_PER_HOUR, ONBOARDING_THROTTLE_WINDOW_MS);
    if (!intakeAllowed) return res.status(429).json({ error: 'Too many submissions. Please wait and try again.' });

    const {
      companyName, contactName, contactEmail, contactPhone, address,
      sitesList, unitsList, usersList, customRequest, sopFilePaths, sopPathTokens, logoUrl,
      stripeSessionId, editToken,
    } = req.body;

    const { errors, skippedUserLines } = validateOnboardingIntake({ companyName, contactEmail, sitesList, usersList });
    if (errors.length > 0) return res.status(400).json({ error: errors[0], errors });

    const record = {
      company_name: companyName,
      contact_name: contactName || null,
      contact_email: contactEmail,
      contact_phone: contactPhone || null,
      address: address || null,
      sites_list: sitesList || null,
      units_list: unitsList || null,
      users_list: usersList || null,
      custom_request: customRequest || null,
      // Only paths this submission's own create_onboarding_upload_url
      // calls actually issued survive here — anything else (a guessed or
      // otherwise-obtained path to another company's uploaded SOP) is
      // silently dropped rather than trusted from the client. See
      // filterVerifiedSopPaths / verifySopPathToken above.
      sop_file_paths: filterVerifiedSopPaths(sopFilePaths, sopPathTokens),
      logo_url: logoUrl || null,
    };

    // Claim what was purchased, staged by api/stripe-webhook.js when the
    // Payment Link checkout completed — carries plan tier + customer id
    // through to company creation without the admin retyping either.
    if (stripeSessionId) {
      const { data: checkoutRows } = await supabaseAdmin
        .from('stripe_checkouts')
        .select('customer_id, plan_tier, modules')
        .eq('session_id', stripeSessionId)
        .limit(1);
      const checkout = checkoutRows && checkoutRows[0];
      if (checkout) {
        record.stripe_checkout_session_id = stripeSessionId;
        record.stripe_customer_id = checkout.customer_id;
        record.plan_tier = checkout.plan_tier;
        // Which modules were paid for. provisionCompanyFromRequest turns
        // these into company_document_settings rows so the company sees
        // exactly what it bought and nothing else.
        record.modules = checkout.modules || null;
      }
    }

    let requestId;
    if (editToken) {
      const { data: existingRows, error: findErr } = await supabaseAdmin
        .from('onboarding_requests')
        .select('id, created_company_id')
        .eq('edit_token', editToken)
        .limit(1);
      if (findErr) return res.status(500).json({ error: 'Could not save your submission. Please try again.' });
      const existing = existingRows && existingRows[0];
      if (!existing) return res.status(404).json({ error: "That edit link isn't valid — please use the link from your confirmation email." });
      if (existing.created_company_id) {
        return res.status(400).json({ error: 'This request has already been approved — contact FORA support for changes.' });
      }
      // Back to "new" so it resurfaces at the top of the admin's queue —
      // this is the self-serve half of the loop; the admin doesn't have to
      // relay "please fix X" by hand, they just see the corrected version.
      const { error } = await supabaseAdmin.from('onboarding_requests').update({ ...record, status: 'new', admin_note: null }).eq('id', existing.id);
      if (error) return res.status(500).json({ error: 'Could not save your submission. Please try again.' });
      requestId = existing.id;
    } else {
      record.edit_token = randomToken();
      const { data, error } = await supabaseAdmin
        .from('onboarding_requests')
        .insert(record)
        .select('id')
        .limit(1);
      if (error) return res.status(500).json({ error: 'Could not save your submission. Please try again.' });
      requestId = data?.[0]?.id || null;
    }

    // ── Auto-approve: instantly provision the company if this request is
    // "clean" by every criterion in canAutoApprove — no custom request, no
    // unparseable user lines, a claimed+active Stripe subscription, and no
    // prior auto-approval already used up this same Stripe customer. Fails
    // safe: any error evaluating the criteria (a Stripe hiccup, an
    // unreadable dup-check) is treated as "not clean" and falls through to
    // the normal manual Admin Panel queue below, unchanged. This never
    // skips the checks themselves — it's a stricter, automated stand-in
    // for the admin's eyeball check, not a removal of gating.
    let autoApproveResult = null;
    try {
      const eligible = await canAutoApprove(supabaseAdmin, stripe, { id: requestId, ...record }, skippedUserLines);
      if (eligible) {
        const provisioned = await provisionCompanyFromRequest(supabaseAdmin, stripe, req, { id: requestId, ...record }, { autoApproved: true });
        if (!provisioned.error) autoApproveResult = provisioned;
        else console.error('Auto-approve provisioning failed, falling back to manual queue:', provisioned.error);
      }
    } catch (e) {
      console.error('Auto-approve check failed, falling back to manual queue:', e.message);
    }

    if (autoApproveResult) {
      // The claim-link email (with the actual company code + next steps)
      // was already sent by provisionCompanyFromRequest above — no need
      // for either the "we'll review within one business day" submitter
      // confirmation or an admin review-needed email, since there's
      // nothing left for either of them to do. Still worth a Slack FYI —
      // it's a new sign-up, just one that didn't need a human click.
      try {
        await sendSlackNotification(`:white_check_mark: *New company auto-approved* — ${record.company_name || 'Unnamed company'} (code ${autoApproveResult.companyCode}). No action needed.`);
      } catch (e) {
        console.error('Auto-approve Slack notification failed:', e.message);
      }
      return res.status(200).json({
        ok: true,
        id: requestId,
        editToken: editToken || record.edit_token,
        skippedUserLines,
        autoApproved: true,
        companyCode: autoApproveResult.companyCode,
      });
    }

    await sendOnboardingNotification({ ...record, skippedUserLines });
    try {
      await sendSubmitterConfirmation(req, record, editToken || record.edit_token);
    } catch (e) {
      console.error('Onboarding submitter confirmation email failed:', e.message);
    }

    return res.status(200).json({ ok: true, id: requestId, editToken: editToken || record.edit_token, skippedUserLines, autoApproved: false });
  }

  // ── Fetch an in-progress request for self-serve editing. Public, but
  // gated by the same unguessable edit_token issued at submission —
  // never accepts a raw request id from the client. ──────────────────────
  if (action === 'get_onboarding_intake') {
    const { editToken } = req.body;
    if (!editToken) return res.status(400).json({ error: 'Missing edit link.' });
    const { data: rows, error } = await supabaseAdmin
      .from('onboarding_requests')
      .select('company_name, contact_name, contact_email, contact_phone, address, sites_list, units_list, users_list, custom_request, sop_file_paths, logo_url, status, admin_note, created_company_id')
      .eq('edit_token', editToken)
      .limit(1);
    if (error) return res.status(500).json({ error: 'Could not load your submission.' });
    const request = rows && rows[0];
    if (!request) return res.status(404).json({ error: "That edit link isn't valid." });
    return res.status(200).json({ request });
  }

  // ═══ Claim-link — public, no login required. A brand-new company's
  // contact lands here from the email sent right after admin approval
  // (auto- or manually-approved, same flow either way) to assign their own
  // roster PINs, and confirm the AI-drafted equipment/SOPs, without FORA
  // ever emailing plaintext PINs or hand-typing them in. Every action here
  // resolves companyId strictly from the claim token server-side — never
  // from a client-supplied id. ═══════════════════════════════════════════

  async function resolveClaimRequest(claimToken) {
    if (!claimToken) return { error: 'Missing claim link.' };
    const { data: rows, error } = await supabaseAdmin
      .from('onboarding_requests')
      .select('*')
      .eq('claim_token', claimToken)
      .limit(1);
    if (error) return { error: 'Could not load your claim link.' };
    const request = rows && rows[0];
    if (!request || !request.created_company_id) return { error: "That claim link isn't valid." };
    if (!request.claim_token_expires_at || new Date(request.claim_token_expires_at) < new Date()) {
      return { error: 'This claim link has expired — contact FORA support for a new one.' };
    }
    return { request };
  }

  if (action === 'claim_get_details') {
    const { claimToken } = req.body;
    const { request, error } = await resolveClaimRequest(claimToken);
    if (error) return res.status(400).json({ error });

    // Best-effort fallback: if the fire-and-forget draft generation kicked
    // off at approval time hasn't finished (or never ran), try once more,
    // right here, bounded by this request's own short Hobby timeout. If it
    // doesn't finish in time either, draft_status just stays 'pending' and
    // the page shows nothing to review yet rather than blocking on it.
    let request2 = request;
    if (request.draft_status === 'pending') {
      try {
        const updates = await runOnboardingDrafts(supabaseAdmin, request);
        request2 = { ...request, ...updates };
      } catch (e) {
        console.error('Claim-page fallback draft generation failed:', e.message);
      }
    }

    const { data: companyRows } = await supabaseAdmin
      .from('companies')
      .select('id, name, company_code, account_number, plan_tier')
      .eq('id', request.created_company_id)
      .limit(1);
    const company = companyRows && companyRows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    const { data: roster } = await supabaseAdmin
      .from('roster')
      .select('id, name, role')
      .eq('company_id', company.id)
      .order('role', { ascending: true })
      .order('name', { ascending: true });

    return res.status(200).json({
      company,
      roster: roster || [],
      equipmentDraft: request2.equipment_draft || [],
      sopDrafts: request2.sop_drafts || [],
      draftStatus: request2.draft_status || 'pending',
      claimedAt: request.claimed_at || null,
    });
  }

  if (action === 'claim_set_roster_pin') {
    const { claimToken, rosterId, pin } = req.body;
    const { request, error } = await resolveClaimRequest(claimToken);
    if (error) return res.status(400).json({ error });
    if (!rosterId || !/^\d{4}$/.test(String(pin || ''))) {
      return res.status(400).json({ error: 'Enter a 4-digit PIN.' });
    }

    // Ownership check — this rosterId must actually belong to the company
    // this claim token resolved to, never trusted from the client alone.
    const { data: memberRows, error: memberErr } = await supabaseAdmin
      .from('roster')
      .select('id, company_id')
      .eq('id', rosterId)
      .limit(1);
    if (memberErr || !memberRows || memberRows.length === 0 || memberRows[0].company_id !== request.created_company_id) {
      return res.status(404).json({ error: 'Roster member not found.' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPin(pin, salt);
    const { error: updateErr } = await supabaseAdmin
      .from('roster')
      .update({ pin_hash: hash, pin_salt: salt, failed_pin_attempts: 0, pin_locked_until: null })
      .eq('id', rosterId);
    if (updateErr) return res.status(500).json({ error: "Couldn't save that PIN." });
    return res.status(200).json({ ok: true });
  }

  if (action === 'claim_confirm_equipment') {
    const { claimToken, items } = req.body;
    const { request, error } = await resolveClaimRequest(claimToken);
    if (error) return res.status(400).json({ error });
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Missing equipment list.' });

    const rows = items
      .filter((it) => it && ((it.make || '').trim() || (it.model || '').trim() || (it.type || '').trim() || (it.unitNumber || '').trim()))
      .map((it) => ({
        company_id: request.created_company_id,
        year: (it.year || '').trim(),
        make: (it.make || '').trim(),
        model: (it.model || '').trim(),
        type: (it.type || '').trim(),
        unit_number: (it.unitNumber || '').trim(),
      }));

    if (rows.length > 0) {
      const { error: insErr } = await supabaseAdmin.from('equipment').insert(rows);
      if (insErr) { console.error("claim equipment save failed:", insErr.message); return res.status(500).json({ error: "Couldn't save equipment. Try again." }); }
    }
    // Clear the draft either way (empty confirm = "skip equipment"), so a
    // page refresh doesn't re-offer the same draft for a second insert.
    await supabaseAdmin.from('onboarding_requests').update({ equipment_draft: [] }).eq('id', request.id);
    return res.status(200).json({ ok: true, added: rows.length });
  }

  if (action === 'claim_confirm_sops') {
    const { claimToken, policies } = req.body;
    const { request, error } = await resolveClaimRequest(claimToken);
    if (error) return res.status(400).json({ error });
    if (!Array.isArray(policies)) return res.status(400).json({ error: 'Missing policy list.' });

    const rows = policies.filter((p) => (p || '').trim()).map((policy_text) => ({ company_id: request.created_company_id, policy_text: policy_text.trim() }));
    if (rows.length > 0) {
      const { error: insErr } = await supabaseAdmin.from('sops').insert(rows);
      if (insErr) { console.error("claim sops save failed:", insErr.message); return res.status(500).json({ error: "Couldn't save SOPs. Try again." }); }
    }
    await supabaseAdmin.from('onboarding_requests').update({ sop_drafts: [] }).eq('id', request.id);
    return res.status(200).json({ ok: true, added: rows.length });
  }

  if (action === 'claim_finalize') {
    const { claimToken } = req.body;
    const { request, error } = await resolveClaimRequest(claimToken);
    if (error) return res.status(400).json({ error });
    await supabaseAdmin.from('onboarding_requests').update({ claimed_at: new Date().toISOString() }).eq('id', request.id);
    return res.status(200).json({ ok: true });
  }

  // ── Step 1: admin code, or company code ─────────────────────────────────
  const { role, code } = req.body || {};
  if (!role || !code) {
    return res.status(400).json({ error: 'Missing role or code.' });
  }

  const entered = String(code).trim();

  // ── Admin path — checked against the secret ADMIN_CODE in Vercel ──────
  if (role === 'admin') {
    if (process.env.ADMIN_CODE && safeEqual(entered, process.env.ADMIN_CODE)) {
      const payload = { role: 'admin', companyId: null, issuedAt: Date.now() };
      const token = signSession(payload);
      return res.status(200).json({ session: payload, token });
    }
    return res.status(401).json({ error: 'Incorrect admin code.' });
  }

  if (role !== 'worker' && role !== 'supervisor') {
    return res.status(400).json({ error: 'Invalid role.' });
  }

  // ── Master code — checked before any company lookup, for either role ────
  // Long-code throttle only (see MASTER_CODE_THROTTLE_MIN_LENGTH above) —
  // never applied to ordinary short company/worker/supervisor codes below.
  if (entered.length >= MASTER_CODE_THROTTLE_MIN_LENGTH) {
    const allowed = await checkMasterCodeThrottle(clientIp(req));
    if (!allowed) return res.status(429).json({ error: 'Too many attempts. Please wait and try again.' });
  }
  if (await verifyMasterCode(entered)) {
    const { data: companies, error: coErr } = await supabaseAdmin.from('companies').select('id, name').order('name', { ascending: true });
    if (coErr) return res.status(500).json({ error: 'Connection error. Please try again.' });
    const masterTicket = signMasterTicket();
    return res.status(200).json({ stage: 'pick_company', masterTicket, companies: companies || [] });
  }

  // ── Worker / Supervisor — look up the company ───────────────────────────
  // Try the role-specific legacy column first (byte-identical to the old
  // behavior for every company that hasn't cut over), then fall back to the
  // unified company_code — which is how brand-new companies (created with
  // no legacy codes at all) and post-cutover companies get found.
  const legacyColumn = role === 'supervisor' ? 'supervisor_code' : 'worker_code';
  const { data: legacyRows, error: legacyErr } = await supabaseAdmin
    .from('companies')
    .select('id, name, suspended, roster_enabled, app_type')
    .eq(legacyColumn, entered)
    .limit(1);
  if (legacyErr) return res.status(500).json({ error: 'Connection error. Please try again.' });

  let company = legacyRows && legacyRows[0];
  if (!company) {
    const { data: codeRows, error: codeErr } = await supabaseAdmin
      .from('companies')
      .select('id, name, suspended, roster_enabled, app_type')
      .eq('company_code', entered)
      .limit(1);
    if (codeErr) return res.status(500).json({ error: 'Connection error. Please try again.' });
    company = codeRows && codeRows[0];
  }

  if (!company) {
    // Count the failure before answering, so repeated wrong codes from one
    // address burn the budget even though a correct code never does.
    if (entered.length < MASTER_CODE_THROTTLE_MIN_LENGTH) {
      const allowed = await checkIpThrottle(`code:${clientIp(req)}`, COMPANY_CODE_THROTTLE_MAX_FAILURES, COMPANY_CODE_THROTTLE_WINDOW_MS);
      if (!allowed) return res.status(429).json({ error: 'Too many attempts. Please wait and try again.' });
    }
    return res.status(401).json({ error: 'Code not recognized. Check with your supervisor.' });
  }

  if (company.suspended && role === 'worker') {
    return res.status(403).json({ error: 'Access suspended. Please contact your administrator.' });
  }

  if (!company.roster_enabled) {
    // Legacy path — identical to this file's original behavior.
    const payload = {
      role,
      companyId: company.id,
      companyName: company.name,
      appType: company.app_type || 'safety',
      suspended: !!company.suspended,
      issuedAt: Date.now(),
    };
    const token = signSession(payload);
    return res.status(200).json({ session: payload, token });
  }

  // Roster path — hand back a ticket instead of a session; the client moves
  // on to the name picker (list_roster_names) and then the PIN (roster_login).
  const companyTicket = signTicket(company.id, company.name, company.app_type || 'safety');
  return res.status(200).json({ stage: 'need_identity', companyTicket, companyName: company.name });
}
