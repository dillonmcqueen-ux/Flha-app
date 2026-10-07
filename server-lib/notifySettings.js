// server-lib/notifySettings.js
// The Account Owner's side of notification routing: which documents notify, and
// who is always told on top of whoever can already see the record. The routing
// itself is server-lib/notifyRouting.js; this only reads and writes the
// `document_notifications` rows it reads.
//
// Owner and founder only (the caller checks), every id checked against the
// company here. A document is notifiable when a notice is actually sent for it:
// the wired built-ins and the company's own custom forms. Portal documents email
// their own departments already and are not in this list.

import { listAssignableDocuments } from './assignmentAdmin.js';
import { WIRED_DOCUMENT_KEYS } from './notifyAudience.js';

export const MAX_EXTRAS = 10;

const isNotifiable = (d) => d.kind === 'custom' || (d.kind === 'builtin' && WIRED_DOCUMENT_KEYS.has(d.key));

/**
 * The documents this company can switch notifications on for, each with its
 * current switch and "always tell" people. Also says which active people have no
 * email on file (they cannot be told), by id and name only: never an address.
 */
export async function listNotifySettings(supabase, companyId) {
  const [docs, rowsRes, peopleRes] = await Promise.all([
    listAssignableDocuments(supabase, companyId),
    supabase.from('document_notifications').select('document_key, enabled, extra_roster_ids').eq('company_id', companyId),
    supabase.from('roster').select('id, name, role, email, active').eq('company_id', companyId).eq('active', true),
  ]);
  if (peopleRes.error) return { error: true };
  const missing = String(rowsRes.error?.code || '');
  const rows = missing === '42P01' || missing === 'PGRST205' ? [] : (rowsRes.data || []);
  if (rowsRes.error && rows.length === 0 && !['42P01', 'PGRST205'].includes(missing)) return { error: true };
  const byKey = new Map(rows.map((r) => [r.document_key, r]));
  const people = peopleRes.data || [];
  return {
    documents: docs.filter(isNotifiable).map((d) => {
      const r = byKey.get(d.key);
      return { key: d.key, label: d.label, enabled: r ? r.enabled === true : false, extraRosterIds: r ? (r.extra_roster_ids || []).map(Number) : [] };
    }),
    noEmail: people.filter((p) => !p.email).map((p) => ({ id: p.id, name: p.name })),
  };
}

/**
 * Validates and saves one document's switch and/or "always tell" list.
 * `enabled` and `extraRosterIds` are each optional: what is left out is left as
 * it was. Returns { ok: true, document } or { error, status }.
 */
export async function saveNotifySetting(supabase, companyId, { documentKey, enabled, extraRosterIds, updatedBy }) {
  if (typeof documentKey !== 'string') return { error: 'Pick a document.', status: 400 };
  if (enabled !== undefined && typeof enabled !== 'boolean') return { error: 'Invalid setting.', status: 400 };
  const docs = await listAssignableDocuments(supabase, companyId);
  const doc = docs.filter(isNotifiable).find((d) => d.key === documentKey);
  if (!doc) return { error: 'That document cannot send notifications.', status: 400 };

  const row = { company_id: companyId, document_key: documentKey, updated_by: updatedBy ?? null, updated_at: new Date().toISOString() };
  if (enabled !== undefined) row.enabled = enabled;

  if (extraRosterIds !== undefined) {
    if (!Array.isArray(extraRosterIds)) return { error: 'Invalid list of people.', status: 400 };
    const ids = [...new Set(extraRosterIds.map(Number))];
    if (ids.some((n) => !Number.isInteger(n) || n <= 0)) return { error: 'Invalid list of people.', status: 400 };
    if (ids.length > MAX_EXTRAS) return { error: `You can name up to ${MAX_EXTRAS} people.`, status: 400 };
    if (ids.length > 0) {
      const { data, error } = await supabase.from('roster').select('id').eq('company_id', companyId).eq('active', true).in('id', ids);
      if (error) return { error: "Couldn't check those people. Try again.", status: 500 };
      if ((data || []).length !== ids.length) return { error: 'Pick people who work at your company.', status: 400 };
    }
    row.extra_roster_ids = ids;
  }

  const { error } = await supabase.from('document_notifications').upsert(row, { onConflict: 'company_id,document_key' });
  if (error) {
    console.error('save notify setting failed:', error.message);
    return { error: "Couldn't save that. Try again.", status: 500 };
  }
  return { ok: true, document: doc, row };
}
