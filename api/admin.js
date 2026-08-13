// api/admin.js
// Handles company management for the Admin Console — listing, creating,
// editing, suspending, and deleting companies. Admin-only, same session
// check pattern as the other protected endpoints.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import Stripe from 'stripe';
import { createUploadUrl } from '../server-lib/uploadUrls.js';
import { parseSiteLines, parseUserLines, planSeatCap, randomToken } from '../server-lib/onboardingHelpers.js';
import { runOnboardingDrafts } from '../server-lib/onboardingDrafting.js';
import { sendEmail, siteOrigin } from '../server-lib/email.js';

const CLAIM_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  if (sig !== expectedSig) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString());
  } catch (e) {
    return null;
  }
  if (!payload.issuedAt || Date.now() - payload.issuedAt > SESSION_TTL_MS) return null;

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

function genAccountNumber() {
  return Math.floor(100000 + Math.random() * 900000);
}

function genSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString('hex');
}

// Same shape as the manual "Onboard Company" flow's suggested code, for
// when a company is created automatically from an onboarding request
// instead of typed in by hand.
function randomSuffix(len = 3) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function codePrefix(name) {
  const clean = (name || '').trim().toUpperCase();
  if (!clean) return 'CO';
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3);
  return words.map(w => w[0]).join('').slice(0, 3);
}
function genPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

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
        .select('id, name, worker_code, supervisor_code, company_code, roster_enabled, contact_name, contact_email, contact_phone, address, logo_url, suspended, account_number, plan_tier')
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
      return res.status(200).json({ ok: true });
    }

    // ── Set the master login code — logs into any company, either role,
    // straight from the public worker/supervisor login screen. No "confirm
    // old code" step needed: only an authenticated admin session can even
    // reach this action. ────────────────────────────────────────────────
    if (action === 'set_master_code') {
      const { newCode } = req.body;
      if (!newCode || !String(newCode).trim()) return res.status(400).json({ error: 'Enter a code.' });
      const salt = genSalt();
      const hash = hashPin(String(newCode).trim(), salt);
      const { error } = await supabaseAdmin
        .from('app_settings')
        .upsert({ id: 1, master_code_hash: hash, master_code_salt: salt, updated_at: new Date().toISOString() });
      if (error) return res.status(500).json({ error: "Couldn't update the master code." });
      return res.status(200).json({ ok: true });
    }

    // ── Recent master-code logins, newest first — the visibility backstop
    // in place of rate-limiting the master code itself (see api/login.js).
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

        return {
          ...r,
          sop_file_urls,
          siteCount: siteNames.length,
          seatCount,
          seatCap,
          overSeatCap: seatCap != null && seatCount > seatCap,
          skippedUserLines,
        };
      }));

      return res.status(200).json({ requests: enriched });
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
    // role" / "Name - role" and get a random 4-digit PIN each — but unlike
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

      const prefix = codePrefix(request.company_name);
      let companyCode = '';
      for (let tries = 0; tries < 8; tries++) {
        const candidate = `${prefix}${randomSuffix()}`;
        const { data: clash } = await supabaseAdmin.from('companies').select('id').eq('company_code', candidate).limit(1);
        if (!clash || clash.length === 0) { companyCode = candidate; break; }
      }
      if (!companyCode) return res.status(500).json({ error: "Couldn't generate a unique company code. Try again." });

      let acct = genAccountNumber();
      for (let tries = 0; tries < 5; tries++) {
        const { data: clash } = await supabaseAdmin.from('companies').select('id').eq('account_number', acct).limit(1);
        if (!clash || clash.length === 0) break;
        acct = genAccountNumber();
      }

      const { data: companyRows, error: coErr } = await supabaseAdmin.from('companies').insert({
        name: request.company_name.trim(),
        company_code: companyCode,
        account_number: acct,
        contact_name: request.contact_name || null,
        contact_email: request.contact_email || null,
        contact_phone: request.contact_phone || null,
        address: request.address || null,
        logo_url: request.logo_url || null,
        ...(['basic', 'advanced'].includes(request.plan_tier) ? { plan_tier: request.plan_tier } : {}),
        stripe_customer_id: request.stripe_customer_id || null,
      }).select('id').limit(1);
      if (coErr) return res.status(500).json({ error: "Couldn't create company: " + coErr.message });
      const companyId = companyRows[0].id;

      // Best-effort: this request came from a paid checkout, so pick up the
      // subscription it created and stamp its status — lets the webhook
      // (api/stripe-webhook.js) start syncing this company on the very next
      // subscription event instead of only after one arrives from scratch.
      if (stripe && request.stripe_customer_id) {
        try {
          const subs = await stripe.subscriptions.list({ customer: request.stripe_customer_id, limit: 1 });
          const sub = subs.data[0];
          if (sub) {
            await supabaseAdmin.from('companies').update({
              stripe_subscription_id: sub.id,
              stripe_subscription_status: sub.status,
            }).eq('id', companyId);
          }
        } catch (e) {
          console.error('Could not look up Stripe subscription for approved company:', e.message);
        }
      }

      const siteNames = parseSiteLines(request.sites_list);
      if (siteNames.length > 0) {
        await supabaseAdmin.from('sites').insert(siteNames.map(name => ({ company_id: companyId, name })));
      }

      const { roster: parsedRoster, skippedUserLines } = parseUserLines(request.users_list);
      const roster = parsedRoster.map(({ name, role }) => {
        const salt = genSalt();
        // Randomly generated and never surfaced anywhere below — this row
        // only exists so the company has an active roster from minute one;
        // the actual PIN a person will use is whatever the contact sets for
        // them on the claim-link page.
        return { company_id: companyId, name, role, pin_hash: hashPin(genPin(), salt), pin_salt: salt, active: true };
      });
      if (roster.length > 0) {
        const { error: rosterErr } = await supabaseAdmin.from('roster').insert(roster);
        if (!rosterErr) await supabaseAdmin.from('companies').update({ roster_enabled: true }).eq('id', companyId);
      }

      const claimToken = randomToken();
      const claimTokenExpiresAt = new Date(Date.now() + CLAIM_TOKEN_TTL_MS).toISOString();
      await supabaseAdmin.from('onboarding_requests').update({
        status: 'in_progress',
        created_company_id: companyId,
        claim_token: claimToken,
        claim_token_expires_at: claimTokenExpiresAt,
        draft_status: 'pending',
      }).eq('id', id);

      // Credential delivery — a self-serve claim link, not emailed PINs.
      // Best-effort: the company is already created either way, so a
      // failed email here doesn't undo anything — the admin can still see
      // the claim link never went out and resend/relay manually as a
      // fallback.
      let claimEmailSent = false;
      if (request.contact_email) {
        try {
          await sendEmail({
            to: request.contact_email,
            subject: `Your FORA account is ready — ${request.company_name}`,
            text: [
              `Your company code: ${companyCode}`,
              '',
              `Finish setup — assign PINs to your team, and review the equipment/SOPs we drafted from what you sent:`,
              `${siteOrigin(req)}/claim?token=${claimToken}`,
              '',
              'This link works for the next 14 days.',
            ].join('\n'),
          });
          claimEmailSent = true;
        } catch (e) {
          console.error('Claim-link email failed:', e.message);
        }
      }

      // Post-approval automation, fire-and-forget: kicks off the AI draft
      // of equipment (from units_list) and SOPs (from the uploaded files)
      // now that the company exists, without making the admin's approve
      // click wait on an LLM call. Deliberately not awaited — see the
      // top-of-file comment in server-lib/onboardingDrafting.js for why,
      // and for the claim page's own fallback if this doesn't finish in
      // time. Errors are caught inside runOnboardingDrafts itself.
      runOnboardingDrafts(supabaseAdmin, { ...request, id }).catch(e => {
        console.error('Background onboarding draft generation failed:', e.message);
      });

      return res.status(200).json({
        ok: true,
        companyId,
        companyCode,
        sitesCreated: siteNames.length,
        rosterCreated: roster.length,
        skippedUserLines,
        claimEmailSent,
      });
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

      const { error } = await supabaseAdmin.from('companies').insert({
        name: name.trim(),
        company_code: companyCode.trim(),
        account_number: acct,
      });
      if (error) return res.status(500).json({ error: "Couldn't add company: " + error.message });
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
      if (error) return res.status(500).json({ error: "Couldn't update codes: " + error.message });
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
      if (error) return res.status(500).json({ error: "Couldn't save: " + error.message });
      return res.status(200).json({ ok: true });
    }

    // ── Suspend / reactivate a company ──────────────────────────────────
    if (action === 'toggle_suspend') {
      const { companyId, suspended } = req.body;
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { error } = await supabaseAdmin.from('companies').update({ suspended: !!suspended }).eq('id', companyId);
      if (error) return res.status(500).json({ error: "Couldn't update: " + error.message });
      return res.status(200).json({ ok: true });
    }

    // ── Delete a company ─────────────────────────────────────────────────
    // Fixed to check EVERY record type, not just FLHAs, so a company with
    // only inspections/toolbox talks/near misses/incidents/daily reports
    // can no longer be deleted and orphan those records.
    if (action === 'delete_company') {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const tables = ['flhas', 'incidents', 'near_misses', 'inspections', 'toolbox_talks', 'daily_reports'];
      const counts = {};
      for (const t of tables) {
        const { data, error } = await supabaseAdmin.from(t).select('id').eq('company_id', companyId);
        if (error) return res.status(500).json({ error: `Could not check ${t.replace('_', ' ')} records.` });
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
      if (inspFormIds.length > 0) {
        await supabaseAdmin.from('inspection_form_questions').delete().in('form_id', inspFormIds);
        await supabaseAdmin.from('inspection_forms').delete().eq('company_id', companyId);
      }
      if (custFormIds.length > 0) {
        await supabaseAdmin.from('custom_form_questions').delete().in('form_id', custFormIds);
        await supabaseAdmin.from('custom_forms').delete().eq('company_id', companyId);
      }
      await supabaseAdmin.from('company_document_settings').delete().eq('company_id', companyId);
      await supabaseAdmin.from('equipment_reports').delete().eq('company_id', companyId);
      await supabaseAdmin.from('roster').delete().eq('company_id', companyId);
      await supabaseAdmin.from('sops').delete().eq('company_id', companyId);
      await supabaseAdmin.from('sites').delete().eq('company_id', companyId);
      await supabaseAdmin.from('equipment').delete().eq('company_id', companyId);
      await supabaseAdmin.from('custom_fields').delete().eq('company_id', companyId);
      const { error } = await supabaseAdmin.from('companies').delete().eq('id', companyId);
      if (error) return res.status(500).json({ error: "Couldn't delete: " + error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
