// server-lib/onboardingHelpers.js
// Shared parsing/validation for the onboarding intake flow. Used by both
// api/login.js (submit_onboarding_intake — validates before staging a row,
// and the public claim-link actions) and api/admin.js
// (approve_onboarding_request, and the richer Admin Panel review list) so
// the two can never silently drift on what counts as a "clean" site/user
// line. Lives outside api/ on purpose — see server-lib/uploadUrls.js for
// why (it doesn't count against Vercel's per-function budget there).

import crypto from 'crypto';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return !!value && EMAIL_RE.test(String(value).trim());
}

// One site name per line. Blank lines are just formatting and dropped
// silently; nothing to flag the submitter about.
export function parseSiteLines(sitesList) {
  return (sitesList || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

// "Name — role" / "Name - role" (em dash or hyphen), case-insensitive role.
// Mirrors the parser api/admin.js's approve_onboarding_request has always
// used — kept in one place now so intake-side validation and the actual
// company-creation step can never see a line differently.
const USER_LINE_RE = /^(.+?)\s*[—-]\s*(worker|supervisor)$/i;

export function parseUserLines(usersList) {
  const lines = (usersList || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const roster = [];
  const skippedUserLines = [];
  for (const line of lines) {
    const m = line.match(USER_LINE_RE);
    const name = m && m[1].trim();
    if (!m || !name) {
      skippedUserLines.push(line);
      continue;
    }
    roster.push({ name, role: m[2].toLowerCase() });
  }
  return { roster, skippedUserLines };
}

// Basic tier: up to 10 seats. Advanced: 11-50. See README's "Plan tiers".
export const PLAN_SEAT_CAPS = { basic: 10, advanced: 50 };

export function planSeatCap(planTier) {
  return PLAN_SEAT_CAPS[planTier] || null;
}

// Server-side mirror of the checks Onboarding.jsx already nudges the
// submitter to fix client-side, re-run here since the client can't be
// trusted. Returns a list of user-facing field errors — empty means clean.
export function validateOnboardingIntake({ companyName, contactEmail, sitesList, usersList }) {
  const errors = [];
  if (!companyName || !companyName.trim()) errors.push('Company name is required.');
  if (!isValidEmail(contactEmail)) errors.push('Enter a valid contact email address.');
  if (parseSiteLines(sitesList).length === 0) errors.push('List at least one site, yard, or location — one per line.');
  const { roster, skippedUserLines } = parseUserLines(usersList);
  if (roster.length === 0 && skippedUserLines.length === 0) {
    errors.push('List at least one person — one per line, e.g. "Mike Reyes — worker".');
  }
  return { errors, skippedUserLines };
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}
