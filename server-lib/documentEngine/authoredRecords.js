// server-lib/documentEngine/authoredRecords.js
// Engine documents one person filed, shaped like the rows the built-in
// "my documents" and member profile lists already return. Scoped to the
// company and the author, held to each document's view assignments and the
// caller's scope, and the PDF link is signed only inside the company's folder.
// A failed read gives an empty list, never someone else's records.

import { listVisibleRecordsMulti } from '../documentAccess.js';
import { engineDocKey } from './companyDocs.js';
import { linkTargets, signTargets } from './links.js';

export async function listAuthoredEngineDocuments(supabaseAdmin, session, { companyId, authorId, limit = 100 }) {
  try {
    const author = Number(authorId);
    if (!Number.isFinite(author) || companyId == null) return [];
    const { data: recs, error } = await supabaseAdmin.from('document_records')
      .select('id, definition_id, site_id, created_at, pdf_path, status, awaiting_signature, unsigned_closed_at, submitted_by_roster_id')
      .eq('company_id', companyId).eq('submitted_by_roster_id', author).order('created_at', { ascending: false }).limit(limit);
    if (error || !recs || recs.length === 0) return [];
    const visible = await listVisibleRecordsMulti(supabaseAdmin, session, recs, (r) => engineDocKey(r.definition_id));
    if (visible.denied || visible.records.length === 0) return [];
    const { data: defs } = await supabaseAdmin.from('document_definitions').select('id, title')
      .in('id', [...new Set(visible.records.map((r) => r.definition_id))]);
    const title = new Map((defs || []).map((d) => [Number(d.id), d.title]));
    const targets = visible.records.flatMap((r) => linkTargets({ companyId, record: { pdf_path: r.pdf_path }, answers: [], signatures: [] }).map((t) => ({ ...t, id: `engine:${r.id}` })));
    const urls = await signTargets(supabaseAdmin, targets, 300);
    return visible.records.map((r) => ({
      id: r.id, type: 'engine', title: title.get(Number(r.definition_id)) || 'Document', subtitle: '',
      createdAt: r.created_at, pdf_url: urls.get(`engine:${r.id}`) || null, status: r.status || null,
      awaitingSignature: r.awaiting_signature === true, unsignedClosed: !!r.unsigned_closed_at,
    }));
  } catch (e) {
    console.error('engine authored documents failed:', e && e.message);
    return [];
  }
}
