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

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ROSTER_TICKET_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PIN_LOCKOUT_AFTER_ATTEMPTS = 8;
const PIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

// Hash-then-compare so mismatched-length inputs never short-circuit —
// timingSafeEqual itself throws on unequal-length buffers, and fixed-length
// digests sidestep that while still comparing in constant time.
function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a)).digest();
  const bh = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
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
function signTicket(companyId, companyName) {
  return signSession({ purpose: 'roster', companyId, companyName, issuedAt: Date.now() });
}

function verifyTicket(ticket) {
  if (!ticket || typeof ticket !== 'string' || !ticket.includes('.')) return null;
  const [data, sig] = ticket.split('.');
  const expectedSig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  if (sig !== expectedSig) return null;
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.body || {};

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
      const attempts = (member.failed_pin_attempts || 0) + 1;
      const updates = { failed_pin_attempts: attempts };
      if (attempts >= PIN_LOCKOUT_AFTER_ATTEMPTS) {
        updates.pin_locked_until = new Date(Date.now() + PIN_LOCKOUT_MS).toISOString();
      }
      await supabaseAdmin.from('roster').update(updates).eq('id', member.id);
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
      userId: member.id,
      userName: member.name,
      suspended,
      issuedAt: Date.now(),
    };
    const token = signSession(payload);
    return res.status(200).json({ session: payload, token });
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

  // ── Worker / Supervisor — look up the company ───────────────────────────
  // Try the role-specific legacy column first (byte-identical to the old
  // behavior for every company that hasn't cut over), then fall back to the
  // unified company_code — which is how brand-new companies (created with
  // no legacy codes at all) and post-cutover companies get found.
  const legacyColumn = role === 'supervisor' ? 'supervisor_code' : 'worker_code';
  const { data: legacyRows, error: legacyErr } = await supabaseAdmin
    .from('companies')
    .select('id, name, suspended, roster_enabled')
    .eq(legacyColumn, entered)
    .limit(1);
  if (legacyErr) return res.status(500).json({ error: 'Connection error. Please try again.' });

  let company = legacyRows && legacyRows[0];
  if (!company) {
    const { data: codeRows, error: codeErr } = await supabaseAdmin
      .from('companies')
      .select('id, name, suspended, roster_enabled')
      .eq('company_code', entered)
      .limit(1);
    if (codeErr) return res.status(500).json({ error: 'Connection error. Please try again.' });
    company = codeRows && codeRows[0];
  }

  if (!company) {
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
      suspended: !!company.suspended,
      issuedAt: Date.now(),
    };
    const token = signSession(payload);
    return res.status(200).json({ session: payload, token });
  }

  // Roster path — hand back a ticket instead of a session; the client moves
  // on to the name picker (list_roster_names) and then the PIN (roster_login).
  const companyTicket = signTicket(company.id, company.name);
  return res.status(200).json({ stage: 'need_identity', companyTicket, companyName: company.name });
}
