// api/admin.js
// Handles company management for the Admin Console — listing, creating,
// editing, suspending, and deleting companies. Admin-only, same session
// check pattern as the other protected endpoints.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import Stripe from 'stripe';
import QRCode from 'qrcode';
import { createUploadUrl } from '../server-lib/uploadUrls.js';
import { parseSiteLines, parseUserLines, planSeatCap, randomToken } from '../server-lib/onboardingHelpers.js';
import { allDocumentSettingsOn } from '../server-lib/pricing.js';
import { sendEmail, siteOrigin } from '../server-lib/email.js';
import {
  CLAIM_TOKEN_TTL_MS,
  genAccountNumber,
  genSalt,
  hashPin,
  provisionCompanyFromRequest,
} from '../server-lib/onboardingApproval.js';
import {
  generateTotpSecret,
  totpEnrollmentUri,
  verifyTotpCode,
  generateBackupCodes,
  consumeBackupCode,
} from '../server-lib/totp.js';
import { logAuditEvent } from '../server-lib/auditLog.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

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
  // instead of waiting out the token's TTL.
  const { data: rows, error } = await supabaseAdmin
    .from('roster')
    .select('active, role, company_id')
    .eq('id', payload.userId)
    .limit(1);
  if (error || !rows || rows.length === 0 || !rows[0].active) return null;
  if (rows[0].company_id !== payload.companyId) return null;
  return { ...payload, role: rows[0].role };
}

// genAccountNumber / genSalt / hashPin are imported from
// server-lib/onboardingApproval.js (still used below by set_master_code
// and create_company) — kept in one place so this file and the
// onboarding auto-approve path in api/login.js can never drift on how a
// PIN gets hashed or an account number gets generated.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = await verifySession(token);
  if (!session || session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });

  try {
    // ── Company logo upload (company setup) ─────────────────────────────
    if (action === 'create_logo_upload_url') {
      const { filename } = req.body;
      const result = await createUploadUrl(supabaseAdmin, 'company-logos', filename);
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true, path: result.path, uploadToken: result.uploadToken });
    }

    // ── List all companies (includes codes + contact info) ─────────────
    if (action === 'list_companies') {
      const { data, error } = await supabaseAdmin
        .from('companies')
        .select('id, name, app_type, worker_code, supervisor_code, company_code, roster_enabled, contact_name, contact_email, contact_phone, address, logo_url, suspended, account_number, plan_tier')
        .order('id');
      if (error) return res.status(500).json({ error: 'Could not load companies.' });
      return res.status(200).json({ companies: data || [] });
    }

    // ── Set a company's plan tier (basic/advanced) — drives both the
    // Analytics dashboard's depth and the roster's seat cap ──────────
    if (action === 'set_plan_tier') {
      const { companyId, tier } = req.body;
      if (!companyId || !['basic', 'advanced'].includes(tier)) {
        return res.status(400).json({ error: 'Missing or invalid tier.' });
      }
      const { error } = await supabaseAdmin.from('companies').update({ plan_tier: tier }).eq('id', companyId);
      if (error) return res.status(500).json({ error: "Couldn't update plan tier." });
      await logAuditEvent(supabaseAdmin, { actorRole: 'admin', action: 'set_plan_tier', companyId, targetType: 'company', targetId: companyId, details: { tier } });
      return res.status(200).json({ ok: true });
    }

    // ── Set the master login code — logs into any company, either role,
    // straight from the public worker/supervisor login screen. No "confirm
    // old code" step needed: only an authenticated admin session can even
    // reach this action. ────────────────────────────────────────────────
    if (action === 'set_master_code') {
      const { newCode } = req.body;
      const trimmedCode = String(newCode || '').trim();
      if (!trimmedCode) return res.status(400).json({ error: 'Enter a code.' });
      // No lockout guards this code on the login side (see api/login.js's
      // verifyMasterCode comment) — its length/entropy is the real defense
      // against brute force, so it needs to actually be long. Matches the
      // MASTER_CODE_THROTTLE_MIN_LENGTH threshold api/login.js throttles
      // at, with margin above it.
      if (trimmedCode.length < 20) {
        return res.status(400).json({ error: 'Master code must be at least 20 characters — it has no login attempt limit, so its length is what keeps it safe from guessing.' });
      }
      const salt = genSalt();
      const hash = hashPin(trimmedCode, salt);
      const { error } = await supabaseAdmin
        .from('app_settings')
        .upsert({ id: 1, master_code_hash: hash, master_code_salt: salt, updated_at: new Date().toISOString() });
      if (error) return res.status(500).json({ error: "Couldn't update the master code." });
      await logAuditEvent(supabaseAdmin, { actorRole: 'admin', action: 'set_master_code' });
      return res.status(200).json({ ok: true });
    }

    // ── Recent master-code logins, newest first — the visibility backstop
    // alongside the per-IP long-code throttle (see api/login.js).
    if (action === 'list_master_login_log') {
      const { data: logs, error: logErr } = await supabaseAdmin
        .from('master_login_log')
        .select('id, company_id, role, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (logErr) return res.status(500).json({ error: 'Could not load the login log.' });

      const companyIds = [...new Set((logs || []).map(l => l.company_id))];
      const { data: companies } = await supabaseAdmin.from('companies').select('id, name').in('id', companyIds.length ? companyIds : [0]);
      const nameById = {}; (companies || []).forEach(c => { nameById[c.id] = c.name; });

      const enriched = (logs || []).map(l => ({ ...l, company_name: nameById[l.company_id] || 'Unknown company' }));
      return res.status(200).json({ logs: enriched });
    }

    // ── Administrative audit log — who changed what config/access, when.
    // See docs/schema/audit-log-migration.sql and server-lib/auditLog.js
    // for scope (config/access changes, not every read or form submission).
    if (action === 'list_audit_log') {
      const { data: logs, error: logErr } = await supabaseAdmin
        .from('audit_log')
        .select('id, created_at, actor_role, action, company_id, target_type, target_id, details')
        .order('created_at', { ascending: false })
        .limit(200);
      if (logErr) return res.status(500).json({ error: 'Could not load the audit log.' });

      const companyIds = [...new Set((logs || []).map(l => l.company_id).filter(Boolean))];
      const { data: companies } = await supabaseAdmin.from('companies').select('id, name').in('id', companyIds.length ? companyIds : [0]);
      const nameById = {}; (companies || []).forEach(c => { nameById[c.id] = c.name; });

      const enriched = (logs || []).map(l => ({ ...l, company_name: l.company_id ? (nameById[l.company_id] || 'Unknown company') : null }));
      return res.status(200).json({ logs: enriched });
    }

    // ── MFA (TOTP) — gates the admin role and master code login paths in
    // api/login.js once enrolled. See docs/schema/mfa-totp-migration.sql.
    if (action === 'get_mfa_status') {
      const { data, error } = await supabaseAdmin.from('app_settings').select('totp_enabled').eq('id', 1).limit(1);
      if (error) return res.status(500).json({ error: 'Could not load MFA status.' });
      return res.status(200).json({ enabled: !!(data && data[0] && data[0].totp_enabled) });
    }

    // Generates a new secret and QR code but does NOT enable MFA yet —
    // enroll_mfa_confirm below does that, only after proving the admin can
    // actually generate a valid code from it. Re-calling this before
    // confirming overwrites any in-progress (unconfirmed) secret, which is
    // fine — nothing depends on it until it's confirmed.
    //
    // Blocked while MFA is already enabled: overwriting totp_secret here
    // would start failing every login immediately (checkMfa reads it live),
    // before the new secret is ever confirmed — disable_mfa first, then
    // re-enroll.
    if (action === 'enroll_mfa_start') {
      const { data: existing, error: readErr } = await supabaseAdmin.from('app_settings').select('totp_enabled').eq('id', 1).limit(1);
      if (readErr) return res.status(500).json({ error: 'Could not check current MFA status.' });
      if (!existing || existing.length === 0) {
        // app_settings is a singleton row that set_master_code creates —
        // master_code_hash/master_code_salt are NOT NULL with no default,
        // so nothing here can create the row from scratch. In practice
        // this only happens on a deployment where a master code has never
        // been set.
        return res.status(400).json({ error: 'Set a master login code first, then enable MFA.' });
      }
      if (existing[0].totp_enabled) {
        return res.status(400).json({ error: 'MFA is already enabled. Disable it first to re-enroll.' });
      }
      const secret = generateTotpSecret();
      // update(), not upsert() — the row already exists (checked above),
      // and upsert's INSERT-attempt path validates the NOT NULL columns
      // it wasn't given (master_code_hash/master_code_salt) even when the
      // row will actually be reached via the UPDATE branch, so it fails
      // every time with a 500 that never reaches this comment's fix.
      const { error } = await supabaseAdmin
        .from('app_settings')
        .update({ totp_secret: secret, updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (error) return res.status(500).json({ error: "Couldn't start MFA enrollment." });
      const otpauthUri = totpEnrollmentUri(secret);
      const qrDataUrl = await QRCode.toDataURL(otpauthUri);
      return res.status(200).json({ ok: true, secret, otpauthUri, qrDataUrl });
    }

    // Proves the QR code was scanned correctly, then turns MFA on and
    // issues backup codes — shown to the admin exactly once, here.
    if (action === 'enroll_mfa_confirm') {
      const { code } = req.body;
      const { data, error } = await supabaseAdmin.from('app_settings').select('totp_secret').eq('id', 1).limit(1);
      if (error) return res.status(500).json({ error: 'Could not load MFA settings.' });
      const secret = data && data[0] && data[0].totp_secret;
      if (!secret) return res.status(400).json({ error: 'Start enrollment first.' });
      if (!verifyTotpCode(secret, code)) return res.status(400).json({ error: 'Incorrect code. Try again.' });

      const { plain, hashed } = generateBackupCodes();
      const { error: updErr } = await supabaseAdmin
        .from('app_settings')
        .update({ totp_enabled: true, backup_codes: hashed, updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (updErr) return res.status(500).json({ error: "Couldn't enable MFA." });
      await logAuditEvent(supabaseAdmin, { actorRole: 'admin', action: 'enroll_mfa_confirm' });
      return res.status(200).json({ ok: true, backupCodes: plain });
    }

    // Requires a current valid code (or backup code) rather than just the
    // admin session, since disabling MFA is a security-lowering action and
    // the session that reaches this action could itself be stale/shared.
    if (action === 'disable_mfa') {
      const { code } = req.body;
      const { data, error } = await supabaseAdmin.from('app_settings').select('totp_secret, backup_codes').eq('id', 1).limit(1);
      if (error) return res.status(500).json({ error: 'Could not load MFA settings.' });
      const row = data && data[0];
      const validTotp = row && row.totp_secret && verifyTotpCode(row.totp_secret, code);
      const validBackup = row && consumeBackupCode(code, row.backup_codes).matched;
      if (!validTotp && !validBackup) return res.status(400).json({ error: 'Incorrect code.' });

      const { error: updErr } = await supabaseAdmin
        .from('app_settings')
        .update({ totp_enabled: false, totp_secret: null, backup_codes: [], updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (updErr) return res.status(500).json({ error: "Couldn't disable MFA." });
      await logAuditEvent(supabaseAdmin, { actorRole: 'admin', action: 'disable_mfa' });
      return res.status(200).json({ ok: true });
    }

    // ── Onboarding intake — submissions from the public /onboarding form,
    // newest first, with short-lived signed links for any uploaded SOP
    // files (the storage bucket is private, so a plain public URL won't
    // work) ──────────────────────────────────────────────────────────
    if (action === 'list_onboarding_requests') {
      const { data: requests, error: reqErr } = await supabaseAdmin
        .from('onboarding_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (reqErr) return res.status(500).json({ error: 'Could not load onboarding requests.' });

      // Flag duplicate company submissions (same normalized name showing up
      // more than once) so the admin catches a second/accidental submission
      // from the same company before approving it into a second company.
      // Counted across archived rows too — archiving hides a request from
      // the default view, it doesn't erase the fact that it happened.
      const nameCounts = {};
      (requests || []).forEach(r => {
        const key = (r.company_name || '').trim().toLowerCase();
        if (!key) return;
        nameCounts[key] = (nameCounts[key] || 0) + 1;
      });

      const enriched = await Promise.all((requests || []).map(async (r) => {
        let sop_file_urls = [];
        if (r.sop_file_paths && r.sop_file_paths.length > 0) {
          const { data: signed } = await supabaseAdmin.storage
            .from('onboarding-uploads')
            .createSignedUrls(r.sop_file_paths, 60 * 60); // 1 hour
          sop_file_urls = (signed || []).map(s => s.signedUrl).filter(Boolean);
        }

        // Surface at-a-glance what the admin needs for the approve/reject
        // call — plan tier + seat count vs. cap, and a clean/skipped site
        // and user parse preview — instead of them re-deriving it by eye
        // from the raw sites_list/units_list/users_list text every time.
        const siteNames = parseSiteLines(r.sites_list);
        const { roster, skippedUserLines } = parseUserLines(r.users_list);
        const seatCount = roster.length;
        const seatCap = planSeatCap(r.plan_tier);

        const key = (r.company_name || '').trim().toLowerCase();
        const duplicateCount = key ? (nameCounts[key] || 1) - 1 : 0;

        return {
          ...r,
          sop_file_urls,
          siteCount: siteNames.length,
          seatCount,
          seatCap,
          overSeatCap: seatCap != null && seatCount > seatCap,
          skippedUserLines,
          duplicateCount,
        };
      }));

      return res.status(200).json({ requests: enriched });
    }

    // ── Onboarding intake — archive / unarchive. Purely a "hide from the
    // default list" toggle, separate from the new/in_progress/needs_info/
    // done workflow status above — an archived request can be any status.
    // Nothing is deleted, so it can always be brought back. ─────────────
    if (action === 'archive_onboarding_request') {
      const { id, archived } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing request id.' });
      const { error } = await supabaseAdmin
        .from('onboarding_requests')
        .update({ archived: !!archived })
        .eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't update archive state." });
      return res.status(200).json({ ok: true });
    }

    // ── Onboarding intake — permanently delete. Blocked once a request has
    // already created a company: that row is still what get_claim_link
    // looks up by created_company_id to resend/refresh the claim link, so
    // deleting it would strand that lookup. Archive it instead. ─────────
    if (action === 'delete_onboarding_request') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing request id.' });
      const { data: rows, error: reqErr } = await supabaseAdmin
        .from('onboarding_requests')
        .select('id, created_company_id')
        .eq('id', id)
        .limit(1);
      if (reqErr) return res.status(500).json({ error: 'Could not look up this request.' });
      if (!rows || rows.length === 0) return res.status(404).json({ error: 'Request not found.' });
      if (rows[0].created_company_id) {
        return res.status(400).json({ error: "This request already created a company — archive it instead of deleting so the claim link stays available." });
      }
      const { error } = await supabaseAdmin.from('onboarding_requests').delete().eq('id', id);
      if (error) return res.status(500).json({ error: "Couldn't delete this request." });
      await logAuditEvent(supabaseAdmin, { actorRole: 'admin', action: 'delete_onboarding_request', targetType: 'onboarding_request', targetId: id });
      return res.status(200).json({ ok: true });
    }

    // ── Onboarding intake — mark a submission new / in progress / needs
    // more info from the submitter / done. needs_info carries an optional
    // note; the submitter sees it (and can fix + resubmit themselves via
    // their edit link) rather than the admin relaying "please fix X" by
    // hand over email. ───────────────────────────────────────────────────
    if (action === 'update_onboarding_status') {
      const { id, status, note } = req.body;
      if (!id || !['new', 'in_progress', 'needs_info', 'done'].includes(status)) {
        return res.status(400).json({ error: 'Missing or invalid status.' });
      }
      const updates = { status };
      if (status === 'needs_info') updates.admin_note = (note || '').trim() || null;
      const { data: reqRows, error } = await supabaseAdmin.from('onboarding_requests').update(updates).eq('id', id).select('contact_email, company_name, edit_token').limit(1);
      if (error) return res.status(500).json({ error: "Couldn't update status." });

      if (status === 'needs_info' && reqRows?.[0]?.contact_email && reqRows[0].edit_token) {
        const r = reqRows[0];
        try {
          await sendEmail({
            to: r.contact_email,
            subject: `A quick fix needed on your FORA onboarding — ${r.company_name || ''}`,
            text: [
              updates.admin_note || 'A team member flagged something on your onboarding submission that needs a quick fix.',
              '',
              `Update it here: ${siteOrigin(req)}/onboarding?edit=${r.edit_token}`,
            ].join('\n'),
          });
        } catch (e) {
          console.error('needs_info notification email failed:', e.message);
        }
      }
      return res.status(200).json({ ok: true });
    }

    // ── Onboarding intake — approve: create the company from the
    // submission in one click. Sites (one per line) are created outright
    // since they're a single plain field. Users are parsed as "Name —
    // role" / "Name - role" and get a random 6-digit PIN each — but unlike
    // before, those PINs are never returned here or emailed anywhere: the
    // contact assigns their own real PINs on the claim-link page (see
    // claim_set_roster_pin in api/login.js), so this handler doesn't even
    // hand them back to the admin. Equipment and SOPs are deliberately NOT
    // auto-created here either — an AI-drafted, editable version of each is
    // generated after this returns (see runOnboardingDrafts) and only ever
    // saved once the contact confirms it on the claim-link page.
    // created_company_id is stamped on the request so this can't be run
    // twice into duplicate companies.
    if (action === 'approve_onboarding_request') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing request id.' });

      const { data: reqRows, error: reqErr } = await supabaseAdmin
        .from('onboarding_requests')
        .select('*')
        .eq('id', id)
        .limit(1);
      if (reqErr || !reqRows || reqRows.length === 0) return res.status(404).json({ error: 'Request not found.' });
      const request = reqRows[0];

      if (request.created_company_id) {
        return res.status(400).json({ error: 'Already approved — a company was already created from this request.' });
      }
      if (!request.company_name?.trim()) {
        return res.status(400).json({ error: 'This request has no company name to onboard.' });
      }

      // Actual provisioning (company/sites/roster/claim-link/draft kickoff)
      // is shared with the auto-approve path in api/login.js's
      // submit_onboarding_intake — see server-lib/onboardingApproval.js —
      // so a manual click and the system's own "clean request" check can
      // never silently create a company differently.
      const result = await provisionCompanyFromRequest(supabaseAdmin, stripe, req, request, { autoApproved: false });
      if (result.error) return res.status(500).json({ error: result.error });

      await logAuditEvent(supabaseAdmin, { actorRole: 'admin', action: 'approve_onboarding_request', companyId: result.companyId || null, targetType: 'onboarding_request', targetId: id });
      return res.status(200).json({ ok: true, ...result });
    }

    // ── Fetch (or refresh) a company's claim link — the admin-facing
    // fallback for when claim_email wasn't sent (no contact email on file)
    // or needs resending. Regenerates the token if it's missing/expired,
    // rather than ever handing back PINs directly as a substitute.
    if (action === 'get_claim_link') {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data: rows, error } = await supabaseAdmin
        .from('onboarding_requests')
        .select('id, claim_token, claim_token_expires_at')
        .eq('created_company_id', companyId)
        .limit(1);
      if (error) return res.status(500).json({ error: 'Could not load claim link.' });
      const request = rows && rows[0];
      if (!request) return res.status(404).json({ error: 'This company was not created from an onboarding request.' });

      let claimToken = request.claim_token;
      const expired = !request.claim_token_expires_at || new Date(request.claim_token_expires_at) < new Date();
      if (!claimToken || expired) {
        claimToken = randomToken();
        await supabaseAdmin.from('onboarding_requests').update({
          claim_token: claimToken,
          claim_token_expires_at: new Date(Date.now() + CLAIM_TOKEN_TTL_MS).toISOString(),
        }).eq('id', request.id);
      }
      return res.status(200).json({ ok: true, claimUrl: `${siteOrigin(req)}/claim?token=${claimToken}` });
    }

    // ── Onboard a new company ───────────────────────────────────────────
    // New companies get only the unified company_code — no legacy
    // worker_code/supervisor_code, since roster login is how they'll work
    // from day one. roster_enabled defaults false until the admin (the
    // only one with a session for a company with no roster yet) has added
    // at least one active worker and supervisor and flips the cutover.
    if (action === 'create_company') {
      const { name, companyCode } = req.body;
      if (!name?.trim() || !companyCode?.trim()) {
        return res.status(400).json({ error: 'Missing company details.' });
      }
      const { data: existing } = await supabaseAdmin
        .from('companies')
        .select('id')
        .eq('company_code', companyCode.trim());
      if (existing && existing.length > 0) {
        return res.status(400).json({ error: 'That code is already in use. Edit and try again.' });
      }

      let acct = genAccountNumber();
      for (let tries = 0; tries < 5; tries++) {
        const { data: clash } = await supabaseAdmin.from('companies').select('id').eq('account_number', acct).limit(1);
        if (!clash || clash.length === 0) break;
        acct = genAccountNumber();
      }

      const { data: created, error } = await supabaseAdmin.from('companies').insert({
        name: name.trim(),
        company_code: companyCode.trim(),
        account_number: acct,
      }).select('id').single();
      if (error) { console.error("create_company failed:", error.message); return res.status(500).json({ error: "Couldn't add company. Try again." }); }

      // Switch every document type on, as explicit rows.
      //
      // No checkout chose modules for a company created here, so it gets
      // everything — which is what it got before `edd7a41`, when it got it by
      // having no rows at all and a missing row resolving as active. A missing
      // row resolves OFF now, so without this the founder would create a
      // company and hand over an empty worker menu: no documents, no error,
      // nothing on screen saying why (break #20).
      //
      // Switch keys off per company from the Admin Panel's document toggles.
      const { error: settingsErr } = await supabaseAdmin
        .from('company_document_settings')
        .upsert(allDocumentSettingsOn(created.id), { onConflict: 'company_id,document_key' });
      if (settingsErr) {
        // The company row is already in. Deleting it to roll back would be a
        // destructive fix for a recoverable problem, so say what happened
        // instead: the toggles are all reachable in the Admin Panel, but
        // somebody has to be told they are currently all off.
        console.error('create_company: could not write document settings:', settingsErr.message);
        return res.status(200).json({
          ok: true,
          warning: 'Company created, but its document types could not be switched on. Set them from the document toggles before anyone logs in.',
        });
      }
      await logAuditEvent(supabaseAdmin, { actorRole: 'admin', action: 'create_company', companyId: created.id, targetType: 'company', targetId: created.id, details: { name: name.trim() } });
      return res.status(200).json({ ok: true });
    }

    // ── Edit a company's login code(s) ──────────────────────────────────
    // company_code is always required. worker_code/supervisor_code are only
    // validated/updated when actually sent with a non-empty value — this is
    // a pure edit of an existing legacy code, never a way to clear one to
    // null and strand that company's logins.
    if (action === 'update_company_codes') {
      const { companyId, companyCode, workerCode, supervisorCode } = req.body;
      if (!companyId || !companyCode?.trim()) {
        return res.status(400).json({ error: 'Missing company code.' });
      }

      const { data: codeClash } = await supabaseAdmin
        .from('companies')
        .select('id')
        .eq('company_code', companyCode.trim())
        .neq('id', companyId);
      if (codeClash && codeClash.length > 0) {
        return res.status(400).json({ error: 'That company code is already in use.' });
      }

      const updates = { company_code: companyCode.trim() };

      if (workerCode?.trim() || supervisorCode?.trim()) {
        // These values are interpolated into a PostgREST `.or()` filter
        // string, the one place in the codebase that bypasses the
        // parameterized query builder. A `,` or `)` in the input would
        // alter the filter's semantics and could defeat this very
        // uniqueness check, so reject anything that isn't a plain code.
        const CODE_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;
        for (const candidate of [workerCode, supervisorCode]) {
          if (candidate?.trim() && !CODE_SHAPE.test(candidate.trim())) {
            return res.status(400).json({ error: 'Codes may only contain letters, numbers, hyphens and underscores.' });
          }
        }
        const orParts = [];
        if (workerCode?.trim()) orParts.push(`worker_code.eq.${workerCode.trim()}`, `supervisor_code.eq.${workerCode.trim()}`);
        if (supervisorCode?.trim()) orParts.push(`worker_code.eq.${supervisorCode.trim()}`, `supervisor_code.eq.${supervisorCode.trim()}`);
        const { data: legacyClash } = await supabaseAdmin
          .from('companies')
          .select('id')
          .or(orParts.join(','))
          .neq('id', companyId);
        if (legacyClash && legacyClash.length > 0) {
          return res.status(400).json({ error: 'One of those codes is already in use.' });
        }
        if (workerCode?.trim()) updates.worker_code = workerCode.trim();
        if (supervisorCode?.trim()) updates.supervisor_code = supervisorCode.trim();
      }

      const { error } = await supabaseAdmin.from('companies').update(updates).eq('id', companyId);
      if (error) { console.error("update codes failed:", error.message); return res.status(500).json({ error: "Couldn't update codes. Try again." }); }
      await logAuditEvent(supabaseAdmin, { actorRole: 'admin', action: 'update_company_codes', companyId, targetType: 'company', targetId: companyId });
      return res.status(200).json({ ok: true });
    }

    // ── Edit a company's profile ────────────────────────────────────────
    if (action === 'update_profile') {
      const { companyId, profile } = req.body;
      if (!companyId || !profile?.name?.trim()) return res.status(400).json({ error: 'Missing details.' });
      const { error } = await supabaseAdmin.from('companies').update({
        name: profile.name.trim(),
        contact_name: (profile.contact_name || '').trim(),
        contact_email: (profile.contact_email || '').trim(),
        contact_phone: (profile.contact_phone || '').trim(),
        address: (profile.address || '').trim(),
        logo_url: profile.logo_url || null,
      }).eq('id', companyId);
      if (error) { console.error("company field save failed:", error.message); return res.status(500).json({ error: "Couldn't save. Try again." }); }
      return res.status(200).json({ ok: true });
    }

    // ── Suspend / reactivate a company ──────────────────────────────────
    if (action === 'toggle_suspend') {
      const { companyId, suspended } = req.body;
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { error } = await supabaseAdmin.from('companies').update({ suspended: !!suspended }).eq('id', companyId);
      if (error) { console.error("company update failed:", error.message); return res.status(500).json({ error: "Couldn't update. Try again." }); }
      await logAuditEvent(supabaseAdmin, { actorRole: 'admin', action: 'toggle_suspend', companyId, targetType: 'company', targetId: companyId, details: { suspended: !!suspended } });
      return res.status(200).json({ ok: true });
    }

    // ── Delete a company ─────────────────────────────────────────────────
    // Fixed to check EVERY record type, not just FLHAs, so a company with
    // only inspections/toolbox talks/near misses/incidents/daily reports/
    // time clock entries/time clock reports can no longer be deleted and
    // orphan those records.
    if (action === 'delete_company') {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const tables = ['flhas', 'incidents', 'near_misses', 'inspections', 'toolbox_talks', 'daily_reports', 'time_clock_entries', 'timeclock_reports'];
      const counts = {};
      for (const t of tables) {
        const { data, error } = await supabaseAdmin.from(t).select('id').eq('company_id', companyId);
        if (error) return res.status(500).json({ error: `Could not check ${t.replace(/_/g, ' ')} records.` });
        counts[t] = (data || []).length;
      }

      // Monthly inspection and custom document submissions are reached
      // through their form definitions, not a direct company_id column —
      // same two-hop check delete_form (api/customforms.js) uses for one form.
      const { data: inspForms, error: inspFormsErr } = await supabaseAdmin.from('inspection_forms').select('id').eq('company_id', companyId);
      if (inspFormsErr) return res.status(500).json({ error: 'Could not check monthly inspection forms.' });
      const inspFormIds = (inspForms || []).map(f => f.id);
      let inspectionRecordsCount = 0;
      if (inspFormIds.length > 0) {
        const { data: records, error: recErr } = await supabaseAdmin.from('inspection_records').select('id').in('form_id', inspFormIds);
        if (recErr) return res.status(500).json({ error: 'Could not check monthly inspection submissions.' });
        inspectionRecordsCount = (records || []).length;
      }
      counts['monthly inspection submissions'] = inspectionRecordsCount;

      const { data: custForms, error: custFormsErr } = await supabaseAdmin.from('custom_forms').select('id').eq('company_id', companyId);
      if (custFormsErr) return res.status(500).json({ error: 'Could not check custom document forms.' });
      const custFormIds = (custForms || []).map(f => f.id);
      let customRecordsCount = 0;
      if (custFormIds.length > 0) {
        const { data: records, error: recErr } = await supabaseAdmin.from('custom_form_records').select('id').in('form_id', custFormIds);
        if (recErr) return res.status(500).json({ error: 'Could not check custom document submissions.' });
        customRecordsCount = (records || []).length;
      }
      counts['custom document submissions'] = customRecordsCount;

      const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
      if (totalRecords > 0) {
        const parts = Object.entries(counts)
          .filter(([, n]) => n > 0)
          .map(([t, n]) => `${n} ${t.replace(/_/g, ' ')}`);
        return res.status(400).json({
          error: `Couldn't delete: this company has ${parts.join(', ')}. Companies with submitted records can't be deleted.`,
        });
      }

      // No submitted records remain — safe to clean up company-scoped
      // config/settings. Children before parents where FK-constrained.
      // onboarding_requests.created_company_id is set on approval (see
      // server-lib/onboardingApproval.js) and isn't cleared on delete —
      // null it out first so the FK doesn't block the company row itself.
      const cleanupSteps = [
        () => supabaseAdmin.from('onboarding_requests').update({ created_company_id: null }).eq('created_company_id', companyId),
        ...(inspFormIds.length > 0 ? [
          () => supabaseAdmin.from('inspection_form_questions').delete().in('form_id', inspFormIds),
          () => supabaseAdmin.from('inspection_forms').delete().eq('company_id', companyId),
        ] : []),
        ...(custFormIds.length > 0 ? [
          () => supabaseAdmin.from('custom_form_questions').delete().in('form_id', custFormIds),
          () => supabaseAdmin.from('custom_forms').delete().eq('company_id', companyId),
        ] : []),
        () => supabaseAdmin.from('company_document_settings').delete().eq('company_id', companyId),
        () => supabaseAdmin.from('equipment_reports').delete().eq('company_id', companyId),
        () => supabaseAdmin.from('roster').delete().eq('company_id', companyId),
        () => supabaseAdmin.from('sops').delete().eq('company_id', companyId),
        () => supabaseAdmin.from('sites').delete().eq('company_id', companyId),
        () => supabaseAdmin.from('equipment').delete().eq('company_id', companyId),
        () => supabaseAdmin.from('custom_fields').delete().eq('company_id', companyId),
      ];
      for (const step of cleanupSteps) {
        const { error: stepError } = await step();
        if (stepError) { console.error("company delete cleanup step failed:", stepError.message); return res.status(500).json({ error: "Couldn't delete. Try again." }); }
      }
      const { data: companyRow } = await supabaseAdmin.from('companies').select('name').eq('id', companyId).limit(1);
      const { error } = await supabaseAdmin.from('companies').delete().eq('id', companyId);
      if (error) { console.error("company delete failed:", error.message); return res.status(500).json({ error: "Couldn't delete. Try again." }); }
      // The company's name is captured in details rather than looked up
      // later by companyId, since the row itself is gone by the time
      // anyone reads this log entry.
      await logAuditEvent(supabaseAdmin, { actorRole: 'admin', action: 'delete_company', targetType: 'company', targetId: companyId, details: { name: companyRow?.[0]?.name || null } });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
