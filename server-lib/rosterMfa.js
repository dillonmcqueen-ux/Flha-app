// server-lib/rosterMfa.js
// Per-person authenticator (TOTP) for roster logins. The founder's single
// global secret in app_settings (admin role and master code paths) is a
// separate thing and lives in api/login.js's checkMfa.
//
// Schema: docs/schema/roster-mfa-migration.sql. The secret is stored through
// fieldCrypto (enc:v1:...), backup codes hashed like PINs.
//
// Lives outside api/ for the same reason as server-lib/uploadUrls.js: it is
// shared by api/login.js (login + forced enrollment) and api/companydata.js
// (optional self-service enrollment and resets).

import QRCode from 'qrcode';
import { encryptField, decryptField } from './fieldCrypto.js';
import { isFounder, isOwner } from './ownerAccess.js';
import {
  generateTotpSecret,
  totpEnrollmentUri,
  totpStepForCode,
  generateBackupCodes,
  consumeBackupCode,
} from './totp.js';

// Roles that must use an authenticator. The Account Owner is a supervisor-role
// row, so it is covered by 'supervisor'; requiresMfa also checks is_owner as a
// belt-and-braces guard.
export const MFA_REQUIRED_ROLES = ['supervisor', 'admin', 'auditor'];
// Departments (keys from server-lib/portalDepartments.js) that must use one
// regardless of role. The Owner will be able to extend this per company.
export const MFA_SENSITIVE_DEPARTMENTS = ['safety', 'hr', 'payroll'];

export const TOTP_LOCKOUT_AFTER_ATTEMPTS = 5;
export const TOTP_LOCKOUT_SECONDS = 15 * 60;

export function requiresMfa(member) {
  if (!member) return false;
  if (MFA_REQUIRED_ROLES.includes(member.role) || member.is_owner === true) return true;
  const depts = Array.isArray(member.departments) ? member.departments : [];
  return depts.some((d) => MFA_SENSITIVE_DEPARTMENTS.includes(d));
}

// What the UI may know. Never includes the secret or the backup codes.
export function mfaStatus(member) {
  return {
    enabled: !!(member && member.totp_enabled),
    required: requiresMfa(member),
  };
}

function secretOf(member) {
  try { return decryptField(member.totp_secret); } catch (e) { return null; }
}

// Generates a fresh secret and stores it (encrypted), but does NOT turn the
// authenticator on: confirmEnrollment does that once a real code from the
// scanned QR proves the person's app holds the same secret. Refused while
// already enabled, since overwriting the secret would break their very next
// login before the new one was ever confirmed.
export async function startEnrollment(supabaseAdmin, member) {
  if (member.totp_enabled) return { error: 'Authenticator is already set up. Ask for a reset to start over.', status: 400 };
  const secret = generateTotpSecret();
  // Conditional on totp_enabled = false so a start that read the row before
  // someone else finished enrolling cannot overwrite their live secret.
  const { data: started, error } = await supabaseAdmin
    .from('roster')
    .update({ totp_secret: encryptField(secret) })
    .eq('id', member.id)
    .eq('totp_enabled', false)
    .select('id');
  if (error) return { error: "Couldn't start setup. Try again.", status: 500 };
  if (!started || started.length === 0) return { error: 'Authenticator is already set up. Ask for a reset to start over.', status: 400 };
  const label = member.name || 'FORA';
  const otpauthUri = totpEnrollmentUri(secret, label);
  const qrDataUrl = await QRCode.toDataURL(otpauthUri);
  return { ok: true, secret, otpauthUri, qrDataUrl };
}

// Proves the QR was scanned, turns the authenticator on, and returns the
// backup codes in plain text exactly once.
export async function confirmEnrollment(supabaseAdmin, member, code) {
  if (member.totp_enabled) return { error: 'Authenticator is already set up.', status: 400 };
  const attempt = await claimAttempt(supabaseAdmin, member);
  if (attempt.blocked) return attempt;
  const secret = secretOf(member);
  if (!secret) return { error: 'Start setup again.', status: 400 };
  const step = totpStepForCode(secret, code);
  if (step === null) return { error: 'Incorrect code. Try again.', status: 401 };
  const { plain, hashed } = generateBackupCodes();
  const { data: enabled, error } = await supabaseAdmin
    .from('roster')
    .update({
      totp_enabled: true,
      totp_backup_codes: hashed,
      totp_last_step: step,
      totp_failed_attempts: 0,
      totp_locked_until: null,
      totp_enrolled_at: new Date().toISOString(),
      mfa_setup_jti_hash: null,
      mfa_setup_expires_at: null,
    })
    .eq('id', member.id)
    .eq('totp_enabled', false)
    .select('id');
  if (error) return { error: "Couldn't finish setup. Try again.", status: 500 };
  // Two parallel confirms: only the one that flipped the flag gets codes.
  if (!enabled || enabled.length === 0) return { error: 'Authenticator is already set up.', status: 400 };
  return { ok: true, backupCodes: plain };
}

// Counts a guess BEFORE it is checked, atomically (claim_totp_attempt takes
// the row lock), so a burst of parallel guesses gets exactly
// TOTP_LOCKOUT_AFTER_ATTEMPTS tries. Fails closed if the function is
// missing: unlike the PIN path there is no legacy deploy to protect.
async function claimAttempt(supabaseAdmin, member) {
  if (member.totp_locked_until && new Date(member.totp_locked_until) > new Date()) {
    return { blocked: true, error: 'Too many incorrect codes. Try again in a few minutes.', status: 403 };
  }
  const { data, error } = await supabaseAdmin.rpc('claim_totp_attempt', {
    p_roster_id: member.id,
    p_lockout_after: TOTP_LOCKOUT_AFTER_ATTEMPTS,
    p_lockout_seconds: TOTP_LOCKOUT_SECONDS,
  });
  if (error) {
    console.error('claim_totp_attempt failed:', error.message);
    return { blocked: true, error: 'Connection error. Please try again.', status: 500 };
  }
  if (!data || data.length === 0) {
    return { blocked: true, error: 'Too many incorrect codes. Try again in a few minutes.', status: 403 };
  }
  return { blocked: false };
}

// Checks an authenticator code or a backup code for someone who is enrolled.
// Returns { ok: true } or { ok: false, error, status }.
export async function verifyLoginCode(supabaseAdmin, member, code) {
  const attempt = await claimAttempt(supabaseAdmin, member);
  if (attempt.blocked) return { ok: false, error: attempt.error, status: attempt.status };

  const secret = secretOf(member);
  const step = secret ? totpStepForCode(secret, code) : null;
  if (step !== null) {
    // Only accept a step newer than the last one used. The conditional
    // UPDATE is the replay check and the write in one statement.
    const { data: bumped, error } = await supabaseAdmin
      .from('roster')
      .update({ totp_last_step: step, totp_failed_attempts: 0, totp_locked_until: null })
      .eq('id', member.id)
      .or(`totp_last_step.is.null,totp_last_step.lt.${step}`)
      .select('id');
    if (error) return { ok: false, error: 'Connection error. Please try again.', status: 500 };
    if (bumped && bumped.length > 0) return { ok: true };
    return { ok: false, error: 'Incorrect code.', status: 401 };
  }

  const { matched, codes } = consumeBackupCode(code, member.totp_backup_codes);
  if (matched) {
    const { error } = await supabaseAdmin
      .from('roster')
      .update({ totp_backup_codes: codes, totp_failed_attempts: 0, totp_locked_until: null })
      .eq('id', member.id);
    if (error) return { ok: false, error: 'Connection error. Please try again.', status: 500 };
    return { ok: true, usedBackupCode: true };
  }
  return { ok: false, error: 'Incorrect code.', status: 401 };
}

// Wipes the authenticator so the person re-enrolls at their next login (or
// whenever they choose, if it is optional for them). Who may call this is
// decided by the caller, see canResetMfa.
export async function resetMfa(supabaseAdmin, rosterId) {
  const { error } = await supabaseAdmin
    .from('roster')
    .update({
      totp_secret: null,
      totp_enabled: false,
      totp_backup_codes: [],
      totp_last_step: null,
      totp_failed_attempts: 0,
      totp_locked_until: null,
      totp_enrolled_at: null,
      mfa_setup_jti_hash: null,
      mfa_setup_expires_at: null,
      pin_link_jti_hash: null,
      pin_link_expires_at: null,
    })
    .eq('id', rosterId);
  return { error };
}

// The reset pyramid: the founder resets anyone, an Owner resets supervisors
// and workers, a supervisor resets workers. Nobody resets their own (they
// would have to get past the authenticator to ask, and a reset by the same
// person defeats it). Only the founder resets an Owner.
export function canResetMfa(session, target) {
  if (!session || !target) return false;
  if (isFounder(session)) return true;
  if (session.userId && String(session.userId) === String(target.id)) return false;
  if (session.companyId !== target.company_id) return false;
  if (target.is_owner) return false;
  if (isOwner(session)) return target.role === 'worker' || target.role === 'supervisor';
  if (session.role === 'supervisor') return target.role === 'worker';
  return false;
}
