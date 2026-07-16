// api/login.js
// Handles all login checks (worker / supervisor / admin) on the server,
// using the secret service role key instead of the public anon key.
// This means the actual database check can never be bypassed from someone's browser.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { role, code } = req.body || {};
  if (!role || !code) {
    return res.status(400).json({ error: 'Missing role or code.' });
  }

  const entered = String(code).trim();

  // ── Admin path — checked against the secret ADMIN_CODE in Vercel ──────
  if (role === 'admin') {
    if (entered === process.env.ADMIN_CODE) {
      const payload = { role: 'admin', companyId: null, issuedAt: Date.now() };
      const token = signSession(payload);
      return res.status(200).json({ session: payload, token });
    }
    return res.status(401).json({ error: 'Incorrect admin code.' });
  }

  if (role !== 'worker' && role !== 'supervisor') {
    return res.status(400).json({ error: 'Invalid role.' });
  }

  // ── Worker / Supervisor — look up company by code ──────────────────────
  const column = role === 'supervisor' ? 'supervisor_code' : 'worker_code';
  const { data, error } = await supabaseAdmin
    .from('companies')
    .select('id, name, worker_code, supervisor_code, suspended')
    .eq(column, entered)
    .limit(1);

  if (error) {
    return res.status(500).json({ error: 'Connection error. Please try again.' });
  }
  if (!data || data.length === 0) {
    return res.status(401).json({ error: 'Code not recognized. Check with your supervisor.' });
  }

  const company = data[0];

  if (company.suspended && role === 'worker') {
    return res.status(403).json({ error: 'Access suspended. Please contact your administrator.' });
  }

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
