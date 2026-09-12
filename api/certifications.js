// api/certifications.js
// Worker safety certification tracking ("onboarding wallet", Phase 1).
// Every read/write here is scoped to the caller's own company_id and, for
// worker sessions, to their own roster row — see the tenant-scope-reviewer
// checklist in .claude/agents/tenant-scope-reviewer.md, which this file was
// written against.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { createUploadUrl } from '../server-lib/uploadUrls.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BUCKET = 'worker-certifications';

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

  // Admin sessions and legacy (pre-cutover, shared-code) worker/supervisor
  // sessions carry no userId — there's no individual roster row to tie a
  // cert wallet to, so those callers can never use this endpoint for
  // anything but an admin-scoped list.
  if (payload.role === 'admin' || !payload.userId) return payload;

  const { data: rows, error } = await supabaseAdmin
    .from('roster')
    .select('active, role, company_id, wallet_enabled')
    .eq('id', payload.userId)
    .limit(1);
  if (error || !rows || rows.length === 0 || !rows[0].active) return null;
  if (rows[0].company_id !== payload.companyId) return null;
  return { ...payload, role: rows[0].role, walletEnabled: rows[0].wallet_enabled };
}

// Admins may act on any company they specify; supervisors/workers are
// always locked to their own session.companyId, regardless of what
// companyId a request body sends.
function resolveCompanyId(session, requestedCompanyId) {
  if (session.role === 'admin') return requestedCompanyId || null;
  return session.companyId;
}

// A worker may only ever touch their own roster row's certs. A supervisor
// or admin may touch any roster row within the resolved company.
async function canActOnRosterId(session, companyId, rosterId) {
  if (!companyId || !rosterId) return false;
  if (session.role === 'worker' && session.userId !== rosterId) return false;
  const { data, error } = await supabaseAdmin
    .from('roster')
    .select('id')
    .eq('id', rosterId)
    .eq('company_id', companyId)
    .limit(1);
  return !error && data && data.length > 0;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const { action, token } = req.body || {};
  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Please log in again.' });

  // Every action here is scoped to an individually-identified roster row —
  // a legacy/shared-code worker or supervisor session (no userId) has no
  // roster row to scope to, so it can't use this endpoint at all. Without
  // this, a falsy session.userId would fall through canActOnRosterId's
  // truthy-guarded checks in list_certifications and return the whole
  // company's certifications instead of "not allowed" or "none."
  if (session.role !== 'admin' && !session.userId) {
    return res.status(403).json({ error: 'Not available for this login.' });
  }

  try {
    // ── Step 1: request a signed upload slot for one cert file ──────────
    if (action === 'create_certification_upload_url') {
      const { companyId: requestedCompanyId, rosterId, filename } = req.body;
      const companyId = resolveCompanyId(session, requestedCompanyId);
      if (!(await canActOnRosterId(session, companyId, rosterId))) {
        return res.status(403).json({ error: 'Not allowed.' });
      }
      // Namespaced by company/roster so one company's uploads can never
      // collide with (or be pointed at) another's inside the shared bucket.
      const namespacedName = `${companyId}/${rosterId}/${Date.now()}-${filename}`;
      const result = await createUploadUrl(supabaseAdmin, BUCKET, namespacedName);
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true, path: result.path, uploadToken: result.uploadToken });
    }

    // ── Step 2: record the cert once the file itself has been uploaded ──
    if (action === 'add_certification') {
      const { companyId: requestedCompanyId, rosterId, certType, certName, issueDate, expiryDate, filePath } = req.body;
      const companyId = resolveCompanyId(session, requestedCompanyId);
      if (!(await canActOnRosterId(session, companyId, rosterId))) {
        return res.status(403).json({ error: 'Not allowed.' });
      }
      if (!certType || !certName || !filePath) {
        return res.status(400).json({ error: 'Missing details.' });
      }
      // The uploaded path must actually live under this company/roster's
      // own namespace — stops a caller from recording a cert that points
      // at a path it never uploaded (or one from another company/roster).
      if (!filePath.startsWith(`${companyId}/${rosterId}/`)) {
        return res.status(400).json({ error: 'Invalid file path.' });
      }
      const { data, error } = await supabaseAdmin
        .from('worker_certifications')
        .insert({
          company_id: companyId,
          roster_id: rosterId,
          cert_type: certType,
          cert_name: certName,
          issue_date: issueDate || null,
          expiry_date: expiryDate || null,
          file_path: filePath,
          uploaded_by_role: session.role,
        })
        .select('id')
        .limit(1);
      if (error) return res.status(500).json({ error: 'Could not save the certification.' });
      return res.status(200).json({ ok: true, id: data[0].id });
    }

    // ── List certs: a worker sees their own; a supervisor/admin sees the
    // whole company, or one roster member's if rosterId is passed ───────
    if (action === 'list_certifications') {
      const { companyId: requestedCompanyId, rosterId } = req.body;
      const companyId = resolveCompanyId(session, requestedCompanyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company.' });

      let targetRosterId = rosterId || null;
      if (session.role === 'worker') targetRosterId = session.userId;
      if (targetRosterId && !(await canActOnRosterId(session, companyId, targetRosterId))) {
        return res.status(403).json({ error: 'Not allowed.' });
      }

      let query = supabaseAdmin
        .from('worker_certifications')
        .select('id, roster_id, cert_type, cert_name, issue_date, expiry_date, file_path, created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });
      if (targetRosterId) query = query.eq('roster_id', targetRosterId);

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: 'Could not load certifications.' });

      const certs = await Promise.all(
        (data || []).map(async (row) => {
          const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(row.file_path, 3600);
          return { ...row, fileUrl: signed?.signedUrl || null };
        })
      );
      return res.status(200).json({ certifications: certs });
    }

    // ── Delete a cert: worker may remove their own; supervisor/admin may
    // remove any within their company ────────────────────────────────────
    if (action === 'delete_certification') {
      const { companyId: requestedCompanyId, certId } = req.body;
      const companyId = resolveCompanyId(session, requestedCompanyId);
      if (!companyId || !certId) return res.status(400).json({ error: 'Missing details.' });

      const { data: rows, error: fetchError } = await supabaseAdmin
        .from('worker_certifications')
        .select('id, roster_id, company_id, file_path')
        .eq('id', certId)
        .eq('company_id', companyId)
        .limit(1);
      if (fetchError) return res.status(500).json({ error: 'Connection error. Please try again.' });
      const cert = rows && rows[0];
      if (!cert) return res.status(404).json({ error: 'Not found.' });
      if (session.role === 'worker' && session.userId !== cert.roster_id) {
        return res.status(403).json({ error: 'Not allowed.' });
      }

      await supabaseAdmin.storage.from(BUCKET).remove([cert.file_path]);
      const { error } = await supabaseAdmin.from('worker_certifications').delete().eq('id', certId);
      if (error) return res.status(500).json({ error: 'Could not delete the certification.' });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Unexpected error.' });
  }
}
