// api/audit.js
// The auditor's read-only window (server-lib/auditorAccess.js). The only
// endpoint an auditor session can reach: every other api file treats the role
// as no session. Nothing here writes.
//
//   get_audit_scope        who they are, when access ends, which sites and
//                          which kinds of document they may read
//   list_audit_documents   the documents inside that scope, each with a
//                          short-lived signed PDF link, newest first
//
// Scope is applied in the database query (site_id in the allowed sites, only
// the allowed document types), not by filtering afterwards, and is re-read
// from the roster and scope rows on every request: revoking access or editing
// the scope takes effect on the next call.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { sessionExpired } from '../server-lib/sessionTtl.js';
import { signRows } from '../server-lib/signedUrls.js';
import { isDocKeyActive } from '../server-lib/docKeyGate.js';
import { loadAuditor } from '../server-lib/auditorAccess.js';
import { DIRECT_SOURCES } from '../server-lib/documentSources.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a)).digest();
  const bh = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

// A signed, unexpired, non-ticket token for an individually-identified
// person. Whether that person is really an auditor with live access is
// decided by loadAuditor against the roster, never by the token.
function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  if (!process.env.SESSION_SECRET) return null;
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(data).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(data, 'base64url').toString()); } catch (e) { return null; }
  if (sessionExpired(payload)) return null;
  if (payload.purpose) return null; // a login ticket is not a session
  if (payload.role !== 'auditor' || !payload.userId || !payload.companyId) return null;
  return payload;
}

const LIMIT_PER_SOURCE = 150;
const MAX_RESULTS = 300;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { action, token } = req.body || {};

  const session = verifyToken(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    const { auditor, denied } = await loadAuditor(supabaseAdmin, session);
    if (denied) return res.status(denied.status).json({ error: denied.error });

    const companyId = auditor.companyId;
    const siteIdList = [...auditor.siteIds];

    const { data: siteRows } = siteIdList.length
      ? await supabaseAdmin.from('sites').select('id, name').eq('company_id', companyId).in('id', siteIdList)
      : { data: [] };
    const siteName = new Map((siteRows || []).map((s) => [Number(s.id), s.name]));

    // What each allowed key is called: built-ins by their source title, custom
    // forms by the form's own.
    const { data: customForms } = await supabaseAdmin.from('custom_forms').select('id, title').eq('company_id', companyId);
    const customTitle = new Map((customForms || []).map((f) => [`custom_${f.id}`, f.title]));
    const builtinTitle = new Map([...DIRECT_SOURCES.map((s) => [s.key, s.title]), ['monthly', 'Monthly Inspection']]);
    const labelFor = (key) => builtinTitle.get(key) || customTitle.get(key) || key;
    const allowedKeys = [...auditor.documentKeys].filter((k) => builtinTitle.has(k) || customTitle.has(k));

    if (action === 'get_audit_scope') {
      return res.status(200).json({
        name: auditor.name,
        expiresAt: auditor.expiresAt,
        sites: [...siteName.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        documents: allowedKeys.map((key) => ({ key, label: labelFor(key) })),
      });
    }

    if (action === 'list_audit_documents') {
      const wantKey = typeof req.body.documentKey === 'string' ? req.body.documentKey : null;
      const wantSite = req.body.siteId != null && req.body.siteId !== '' ? Number(req.body.siteId) : null;
      // A filter can only narrow what the scope already allows.
      const keys = wantKey ? allowedKeys.filter((k) => k === wantKey) : allowedKeys;
      let sites = siteIdList;
      if (wantSite != null) sites = siteIdList.filter((id) => id === wantSite);
      if (keys.length === 0 || sites.length === 0) return res.status(200).json({ documents: [] });

      const collected = [];

      for (const src of DIRECT_SOURCES) {
        if (!keys.includes(src.key)) continue;
        if (!(await isDocKeyActive(supabaseAdmin, companyId, src.key))) continue;
        const { data, error } = await supabaseAdmin.from(src.table).select(src.cols)
          .eq('company_id', companyId).in('site_id', sites).order('created_at', { ascending: false }).limit(LIMIT_PER_SOURCE);
        if (error) return res.status(500).json({ error: 'Could not load documents.' });
        (data || []).forEach((r) => collected.push({ r, type: src.type, title: src.title, subtitle: src.sub(r) || '' }));
      }

      // Monthly inspections and custom documents have no company_id of their
      // own, so they are reached through this company's forms.
      if (keys.includes('monthly') && (await isDocKeyActive(supabaseAdmin, companyId, 'monthly'))) {
        const { data: forms } = await supabaseAdmin.from('inspection_forms').select('id, title').eq('company_id', companyId);
        const formIds = (forms || []).map((f) => f.id);
        if (formIds.length) {
          const { data, error } = await supabaseAdmin.from('inspection_records')
            .select('id, form_id, site_id, created_at, pdf_url').in('form_id', formIds).in('site_id', sites)
            .order('created_at', { ascending: false }).limit(LIMIT_PER_SOURCE);
          if (error) return res.status(500).json({ error: 'Could not load documents.' });
          (data || []).forEach((r) => collected.push({ r, type: 'monthly', title: (forms.find((f) => f.id === r.form_id) || {}).title || 'Monthly Inspection', subtitle: '' }));
        }
      }
      const customIds = keys.map((k) => /^custom_(\d+)$/.exec(k)).filter(Boolean).map((m) => Number(m[1]))
        .filter((id) => (customForms || []).some((f) => f.id === id));
      if (customIds.length) {
        const { data, error } = await supabaseAdmin.from('custom_form_records')
          .select('id, form_id, site_id, created_at, pdf_url').in('form_id', customIds).in('site_id', sites)
          .order('created_at', { ascending: false }).limit(LIMIT_PER_SOURCE);
        if (error) return res.status(500).json({ error: 'Could not load documents.' });
        (data || []).forEach((r) => collected.push({ r, type: 'customform', title: customTitle.get(`custom_${r.form_id}`) || 'Custom Document', subtitle: '' }));
      }

      collected.sort((a, b) => new Date(b.r.created_at) - new Date(a.r.created_at));
      const top = collected.slice(0, MAX_RESULTS);
      const signed = await signRows(supabaseAdmin, top.map((c) => ({ id: `${c.type}:${c.r.id}`, pdf_url: c.r.pdf_url })), [{ key: 'pdf_url', bucket: 'flha-reports' }]);
      const pdfById = new Map(signed.map((s) => [s.id, s.pdf_url]));
      return res.status(200).json({
        documents: top.map((c) => ({
          id: c.r.id, type: c.type, title: c.title, subtitle: c.subtitle,
          site: siteName.get(Number(c.r.site_id)) || '', siteId: c.r.site_id,
          createdAt: c.r.created_at, pdf_url: pdfById.get(`${c.type}:${c.r.id}`) || null,
        })),
      });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
