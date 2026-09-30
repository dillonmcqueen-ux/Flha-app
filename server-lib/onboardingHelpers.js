// server-lib/onboardingHelpers.js
// Shared parsing/validation for the onboarding intake flow. Used by both
// api/login.js (submit_onboarding_intake — validates before staging a row,
// and the public claim-link actions) and api/admin.js
// (approve_onboarding_request, and the richer Admin Panel review list) so
// the two can never silently drift on what counts as a "clean" site/user
// line. Lives outside api/ on purpose — see server-lib/uploadUrls.js for
// why (it doesn't count against Vercel's per-function budget there).

import crypto from 'crypto';

// One plain address: no whitespace, and none of the characters that let an
// address field parse as a display name or several recipients.
export const EMAIL_RE = /^[^\s@<>,;"()]+@[^\s@<>,;"()]+\.[^\s@<>,;"()]+$/;

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

// Structured roster rows from the intake form: [{ name, role, email }].
// Supervisors need an email (they receive Company Portal notifications and
// scheduled reports); a worker's email is optional but must be valid if
// given. Returns cleaned rows plus user-facing errors, the same shape the
// other validators here use. Emails are trimmed but NOT lowercased, so what
// the submitter typed is what gets stored.
export const MAX_ONBOARDING_PEOPLE = 200;

export function normalizePeople(people) {
  const errors = [];
  const clean = [];
  if (!Array.isArray(people)) return { people: clean, errors: ['List at least one person.'] };
  if (people.length > MAX_ONBOARDING_PEOPLE) {
    return { people: clean, errors: [`That is too many people for one request (max ${MAX_ONBOARDING_PEOPLE}).`] };
  }
  const seen = new Set();
  for (const raw of people) {
    const name = String((raw && raw.name) || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 100);
    const role = String((raw && raw.role) || '').toLowerCase();
    const email = String((raw && raw.email) || '').trim().slice(0, 254);
    if (!name && !email) continue; // a blank row is just formatting
    if (!name) { errors.push('Every person needs a name.'); continue; }
    if (role !== 'worker' && role !== 'supervisor') { errors.push(`Pick worker or supervisor for ${name}.`); continue; }
    if (role === 'supervisor' && !email) { errors.push(`${name} is a supervisor, so an email address is required.`); continue; }
    if (email && !isValidEmail(email)) { errors.push(`The email for ${name} doesn't look valid.`); continue; }
    const key = name.toLowerCase();
    if (seen.has(key)) { errors.push(`${name} is listed twice. Add a last initial to tell them apart.`); continue; }
    seen.add(key);
    clean.push({ name, role, email: email || null });
  }
  if (clean.length === 0 && errors.length === 0) errors.push('List at least one person.');
  return { people: clean, errors };
}

// The plain "Name - role" text the rest of the pipeline (admin review,
// canAutoApprove, parseUserLines) already understands. Emails never go in it.
export function peopleToUsersList(people) {
  return people.map((p) => `${p.name} - ${p.role}`).join('\n');
}

// Basic tier: up to 10 seats. Advanced: 11-50. See README's "Plan tiers".
export const PLAN_SEAT_CAPS = { basic: 10, advanced: 50 };

export function planSeatCap(planTier) {
  return PLAN_SEAT_CAPS[planTier] || null;
}

// The cap the app actually enforces when a company adds someone: an unknown
// or missing tier is treated as basic, never as unlimited. api/companydata.js
// enforces with this, and the founder dashboard's Seats card reads it, so the
// two cannot drift (map break #42). planSeatCap above stays for the places
// that want to know whether a tier is real at all.
export function effectiveSeatCap(planTier) {
  return planSeatCap(planTier) || PLAN_SEAT_CAPS.basic;
}

// Server-side mirror of the checks Onboarding.jsx already nudges the
// submitter to fix client-side, re-run here since the client can't be
// trusted. Returns a list of user-facing field errors — empty means clean.
export function validateOnboardingIntake({ companyName, contactEmail, sitesList, usersList, people }) {
  const errors = [];
  if (!companyName || !companyName.trim()) errors.push('Company name is required.');
  if (!isValidEmail(contactEmail)) errors.push('Enter a valid contact email address.');
  if (parseSiteLines(sitesList).length === 0) errors.push('List at least one site, yard, or location — one per line.');
  // Structured rows win when the form sends them; the free-text list stays
  // for older clients and for requests already in the queue.
  if (Array.isArray(people)) {
    const norm = normalizePeople(people);
    errors.push(...norm.errors);
    return { errors, skippedUserLines: [], people: norm.people, usersList: peopleToUsersList(norm.people) };
  }
  const { roster, skippedUserLines } = parseUserLines(usersList);
  if (roster.length === 0 && skippedUserLines.length === 0) {
    errors.push('List at least one person — one per line, e.g. "Mike Reyes — worker".');
  }
  return { errors, skippedUserLines, people: null, usersList };
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}
