// server-lib/auditorAccess.js
// The auditor: an outside reader the Account Owner gives time-limited,
// read-only access to the documents of chosen types filed at chosen sites.
//
//   - role 'auditor' on a roster row. Every endpoint except api/audit.js
//     treats an auditor session as no session at all (each verifySession
//     returns null for the role), so an auditor can reach nothing by
//     accident: no submissions, no Brain, no Analytics, no roster, no reference
//     data.
//   - access ends at roster.auditor_access_expires_at (14 days after the
//     Owner sends it). Checked live on every request, so revoking takes
//     effect on the next call, and a stolen token dies with the access.
//   - scope is auditor_scopes: documents of the chosen types at the chosen
//     sites, plus every site of the chosen divisions. Nothing is the
//     default. A record with no site (an equipment inspection, a record from
//     before sites were linked) cannot be placed, so it is never shown.
//
// Auditors never count toward the seat cap, and sign in with a company code,
// their name, a PIN and an authenticator, exactly like everyone else.

import { AUDITABLE_BUILTIN_KEYS } from './documentSources.js';
import { listEngineDocuments, engineDocKey } from './documentEngine/companyDocs.js';
import { sanitizeDivisionIds } from './companyStructure.js';

export const AUDITOR_ACCESS_DAYS = 14;
export const AUDITOR_ACCESS_MS = AUDITOR_ACCESS_DAYS * 24 * 60 * 60 * 1000;

const MISSING = new Set(['42P01', 'PGRST205']);

/** Is access live right now? Pure. */
export function auditorAccessLive(expiresAt, now = Date.now()) {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t > now;
}

/**
 * Resolves the caller as an auditor with live access and their scope, from
 * the roster and scope rows (never the token). Returns `{ auditor }` or
 * `{ denied: { status, error } }`.
 *
 * auditor: { rosterId, companyId, name, expiresAt, siteIds:Set<number>,
 *            documentKeys:Set<string>, divisionIds:number[] }
 */
export async function loadAuditor(supabase, session) {
  if (!session || !session.userId) return { denied: { status: 403, error: 'Not allowed.' } };
  const { data: rows, error } = await supabase
    .from('roster')
    .select('id, name, role, active, company_id, auditor_access_expires_at')
    .eq('id', session.userId)
    .limit(1);
  if (error) return { denied: { status: 503, error: "Couldn't check your access. Please try again." } };
  const r = rows && rows[0];
  if (!r || r.role !== 'auditor' || r.active !== true || r.company_id !== session.companyId) {
    return { denied: { status: 403, error: 'Not allowed.' } };
  }
  if (!auditorAccessLive(r.auditor_access_expires_at)) {
    return { denied: { status: 401, error: 'Your audit access has ended. Ask the account owner to send you new access.' } };
  }

  const { data: scopeRows, error: scopeErr } = await supabase
    .from('auditor_scopes')
    .select('division_ids, site_ids, document_keys')
    .eq('roster_id', r.id)
    .limit(1);
  if (scopeErr && !MISSING.has(String(scopeErr.code || ''))) {
    return { denied: { status: 503, error: "Couldn't check your access. Please try again." } };
  }
  const scope = (scopeRows && scopeRows[0]) || { division_ids: [], site_ids: [], document_keys: [] };
  const divisionIds = (scope.division_ids || []).map(Number).filter(Number.isFinite);
  const siteIds = new Set((scope.site_ids || []).map(Number).filter(Number.isFinite));
  if (divisionIds.length > 0) {
    const { data: siteRows, error: siteErr } = await supabase
      .from('sites').select('id').eq('company_id', session.companyId).in('division_id', divisionIds);
    if (siteErr && !['42703', 'PGRST204'].includes(String(siteErr.code || ''))) {
      return { denied: { status: 503, error: "Couldn't check your access. Please try again." } };
    }
    (siteRows || []).forEach((s) => siteIds.add(Number(s.id)));
  }
  return {
    auditor: {
      rosterId: r.id, companyId: r.company_id, name: r.name, expiresAt: r.auditor_access_expires_at,
      divisionIds, siteIds, documentKeys: new Set(scope.document_keys || []),
    },
  };
}

/** The email an auditor gets: what they may read, until when, and the setup link. */
export function auditorAccessEmail({ name: rawName, companyName: rawCompany, url, expiresAt, needsAuthenticator = true }) {
  const clean = (v, n) => String(v || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const name = clean(rawName, 60);
  const companyName = clean(rawCompany, 80) || 'a FORA customer';
  const until = new Date(expiresAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  return {
    subject: `Audit access to ${companyName} on FORA`,
    text: [
      `Hi ${name},`,
      '',
      `${companyName} gave you read-only audit access to some of their documents on FORA. It runs until ${until}.`,
      '',
      'Open this link to set up your sign-in:',
      '',
      url,
      '',
      needsAuthenticator
        ? 'You will pick your own 6-digit PIN, then set up an authenticator app on your phone. Signing in always needs both.'
        : 'You will pick your own 6-digit PIN.',
      '',
      'Their account owner will give you their company code, which you enter first when you sign in.',
      '',
      'The link works once and expires in 24 hours. It is just for you, so do not forward it. If you were not expecting this, ignore the email.',
      '',
      'FORA Field Solutions',
    ].join('\n'),
  };
}

/** Does a record fall inside the auditor's scope? Placed by site only. Pure. */
export function recordInAuditScope(record, auditor) {
  return record.site_id != null && auditor.siteIds.has(Number(record.site_id));
}

/**
 * The document keys an Owner may pick for an auditor in one company: the
 * built-ins placed by site, the company's own custom forms and its
 * unified-engine documents.
 * Returns [{ key, label }].
 */
export async function listAuditableDocuments(supabase, companyId, labels) {
  const { data: forms } = await supabase.from('custom_forms').select('id, title').eq('company_id', companyId).order('created_at', { ascending: true });
  const engine = await listEngineDocuments(supabase, companyId);
  return [
    ...AUDITABLE_BUILTIN_KEYS.map((key) => ({ key, label: labels[key] || key })),
    ...(forms || []).map((f) => ({ key: `custom_${f.id}`, label: f.title })),
    ...engine.map((d) => ({ key: engineDocKey(d.id), label: d.title })),
  ];
}

/**
 * Validates an Owner's scope for one auditor against that company. Every id is
 * checked: a division, site or custom form from another company is a tenancy
 * question, not a validation detail.
 * Returns `{ scope: { division_ids, site_ids, document_keys } }` or
 * `{ error, status }`.
 */
export async function validateAuditorScope(supabase, companyId, input, labels) {
  for (const k of ['divisionIds', 'siteIds', 'documentKeys']) {
    if (input[k] != null && !Array.isArray(input[k])) return { status: 400, error: 'Invalid selection.' };
  }
  const divisions = await sanitizeDivisionIds(supabase, companyId, input.divisionIds || []);
  if (!divisions) return { status: 400, error: 'Pick your own divisions.' };

  const wantedSites = [...new Set((input.siteIds || []).map(Number))];
  if (wantedSites.some((n) => !Number.isInteger(n) || n <= 0)) return { status: 400, error: 'Pick your own sites.' };
  if (wantedSites.length > 0) {
    const { data } = await supabase.from('sites').select('id').eq('company_id', companyId).in('id', wantedSites);
    if ((data || []).length !== wantedSites.length) return { status: 400, error: 'Pick your own sites.' };
  }

  const allowed = new Set((await listAuditableDocuments(supabase, companyId, labels)).map((d) => d.key));
  const keys = [...new Set((input.documentKeys || []).map(String))];
  if (keys.some((k) => !allowed.has(k))) return { status: 400, error: "One of those documents can't be shared with an auditor." };

  return { scope: { division_ids: divisions, site_ids: wantedSites, document_keys: keys } };
}
