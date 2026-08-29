// api/gatehouse.js
// Protected access to Gatehouse (transfer-station receipts) data — the
// same session-verified, service-role pattern as api/companydata.js.
// A Gatehouse company never touches flhas/sops/roster/equipment; this file
// is the entire server surface for the gatehouse_* tables (see
// docs/schema/gatehouse-migration.sql).

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { createUploadUrl } from '../server-lib/uploadUrls.js';
import { sendEmail } from '../server-lib/email.js';
import { renderGatehouseDailyReportPdf, gatehouseReportFilename } from '../server-lib/gatehousePdf.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const UPLOAD_BUCKET = 'gatehouse-uploads'; // private — cheque photos only

// ── Session verification — identical shape/behavior to api/companydata.js's
// verifySession, duplicated rather than imported since these two files
// aren't meant to share a module boundary (kept each api/*.js file
// self-contained, matching this project's existing convention). ──────────
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

  if (payload.role === 'admin' || !payload.userId) return payload;

  const { data: rows, error } = await supabaseAdmin
    .from('roster')
    .select('active, role, company_id')
    .eq('id', payload.userId)
    .limit(1);
  if (error || !rows || rows.length === 0 || !rows[0].active) return null;
  if (rows[0].company_id !== payload.companyId) return null;
  return { ...payload, role: rows[0].role };
}

// Admins may act on any company they specify; worker/supervisor sessions
// are always locked to their own session.companyId, regardless of what
// companyId a request body sends.
function resolveCompanyId(session, requestedCompanyId) {
  if (session.role === 'admin') return requestedCompanyId || null;
  return session.companyId;
}

function pathFromStoredUrl(url, bucket) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

async function signStoredUrl(url, bucket, ttlSeconds = 3600) {
  const path = pathFromStoredUrl(url, bucket);
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  return error ? null : data.signedUrl;
}

// Confirms `stationId` actually belongs to `companyId` before any read or
// write touches it — never trusted from the client alone, same reasoning
// as api/login.js's claim-token ownership checks.
async function loadOwnedStation(companyId, stationId) {
  const { data, error } = await supabaseAdmin
    .from('gatehouse_stations')
    .select('id, name, company_id')
    .eq('id', stationId)
    .eq('company_id', companyId)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0];
}

// tier_label is a snapshotted string like "Minimum Fee" or, for a
// multi-item cart, "Minimum Fee + Fridge x2" (see log_transaction below) —
// parsed back into {label, quantity} parts so the daily report can show
// counts per charge type ("12 minimum charges, 3 fridges") without a
// separate per-line-item table.
function parseTierLabelParts(tierLabel) {
  if (!tierLabel) return [];
  return tierLabel.split(' + ').map(part => {
    const m = part.match(/^(.*) x(\d+)$/);
    return m ? { label: m[1], quantity: Number(m[2]) } : { label: part, quantity: 1 };
  });
}

function buildTierBreakdown(transactions) {
  const counts = new Map();
  for (const t of transactions) {
    if (t.redirected) continue;
    for (const { label, quantity } of parseTierLabelParts(t.tier_label)) {
      counts.set(label, (counts.get(label) || 0) + quantity);
    }
  }
  return [...counts.entries()]
    .map(([label, quantity]) => ({ label, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label));
}

async function buildDailyReport(companyId, companyName, station, businessDate) {
  const { data: txRows } = await supabaseAdmin
    .from('gatehouse_transactions')
    .select('*')
    .eq('company_id', companyId)
    .eq('station_id', station.id)
    .eq('business_date', businessDate)
    .order('receipt_number', { ascending: true });
  const transactions = txRows || [];

  const redirectedCount = transactions.filter(t => t.redirected).length;
  const cashTotal = transactions.filter(t => !t.redirected && t.payment_method === 'cash').reduce((s, t) => s + Number(t.amount || 0), 0);
  const chequeTotal = transactions.filter(t => !t.redirected && t.payment_method === 'cheque').reduce((s, t) => s + Number(t.amount || 0), 0);
  const grandTotal = cashTotal + chequeTotal;

  const { data: reconRows } = await supabaseAdmin
    .from('gatehouse_reconciliations')
    .select('*')
    .eq('company_id', companyId)
    .eq('station_id', station.id)
    .eq('business_date', businessDate)
    .limit(1);

  return {
    companyName,
    stationName: station.name,
    businessDate,
    transactions,
    redirectedCount,
    cashTotal,
    chequeTotal,
    grandTotal,
    tierBreakdown: buildTierBreakdown(transactions),
    reconciliation: (reconRows && reconRows[0]) || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, token } = req.body || {};
  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Session expired. Please log in again.' });

  const companyId = resolveCompanyId(session, req.body.companyId);
  if (!companyId) return res.status(400).json({ error: 'Missing company.' });

  // ── Booth config: stations + active price tiers ──────────────────────
  if (action === 'get_config') {
    const [{ data: stations, error: stErr }, { data: tiers, error: tierErr }] = await Promise.all([
      supabaseAdmin.from('gatehouse_stations').select('id, name, active').eq('company_id', companyId).eq('active', true).order('name', { ascending: true }),
      supabaseAdmin.from('gatehouse_price_tiers').select('id, label, price, is_addon').eq('company_id', companyId).eq('active', true).order('sort_order', { ascending: true }),
    ]);
    if (stErr || tierErr) return res.status(500).json({ error: 'Could not load station configuration.' });
    return res.status(200).json({ stations: stations || [], tiers: tiers || [] });
  }

  // ── Price-tier management — admin only. The county itself never gets an
  // admin login (per this project's model: customers only ever have a
  // worker or supervisor role), so this is deliberately gated to FORA's
  // own founder-only Admin Panel rather than exposed to the company. ────
  if (action === 'admin_list_price_tiers') {
    if (session.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    const { data, error } = await supabaseAdmin
      .from('gatehouse_price_tiers')
      .select('id, label, price, sort_order, is_addon, active')
      .eq('company_id', companyId)
      .order('sort_order', { ascending: true });
    if (error) return res.status(500).json({ error: 'Could not load price tiers.' });
    return res.status(200).json({ tiers: data || [] });
  }

  if (action === 'admin_upsert_price_tier') {
    if (session.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    const { id, label, price, sortOrder, isAddon } = req.body;
    if (!label || price === undefined || price === null || isNaN(Number(price))) {
      return res.status(400).json({ error: 'A label and a valid price are required.' });
    }
    const row = { company_id: companyId, label: String(label).trim(), price: Number(price), sort_order: sortOrder ?? 0, is_addon: !!isAddon };
    if (id) {
      // Ownership-checked by the .eq('company_id', ...) in the same update
      // — an id belonging to a different company simply matches nothing.
      const { error } = await supabaseAdmin.from('gatehouse_price_tiers').update(row).eq('id', id).eq('company_id', companyId);
      if (error) return res.status(500).json({ error: 'Could not save the price tier.' });
    } else {
      const { error } = await supabaseAdmin.from('gatehouse_price_tiers').insert(row);
      if (error) return res.status(500).json({ error: 'Could not save the price tier.' });
    }
    return res.status(200).json({ ok: true });
  }

  if (action === 'admin_delete_price_tier') {
    if (session.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing price tier.' });
    // Deactivate rather than hard-delete: existing transactions snapshot
    // tier_label/amount at write time, but tier_id still references this
    // row, so removing it outright would need to either cascade through
    // history or be blocked by the FK — deactivating just drops it from
    // get_config's active-only booth list without touching either.
    const { error } = await supabaseAdmin.from('gatehouse_price_tiers').update({ active: false }).eq('id', id).eq('company_id', companyId);
    if (error) return res.status(500).json({ error: 'Could not remove the price tier.' });
    return res.status(200).json({ ok: true });
  }

  // ── Plate memory lookup ────────────────────────────────────────────────
  if (action === 'lookup_vehicle') {
    const plate = String(req.body.plate || '').trim().toUpperCase();
    if (!plate) return res.status(200).json({ vehicle: null });
    const { data, error } = await supabaseAdmin
      .from('gatehouse_vehicles')
      .select('plate, email')
      .eq('company_id', companyId)
      .eq('plate', plate)
      .limit(1);
    if (error) return res.status(500).json({ error: 'Lookup failed.' });
    return res.status(200).json({ vehicle: (data && data[0]) || null });
  }

  // ── Plate typeahead — as the operator types, offer the company's own
  // previously-seen plates so they can tap one instead of retyping a plate
  // (and its saved email) that's already on file. `%`/`_` are escaped
  // before going into the ilike pattern since `prefix` is raw client text.
  if (action === 'search_vehicles') {
    const prefix = String(req.body.prefix || '').trim().toUpperCase();
    if (!prefix) return res.status(200).json({ vehicles: [] });
    const escaped = prefix.replace(/[%_\\]/g, (c) => `\\${c}`);
    const { data, error } = await supabaseAdmin
      .from('gatehouse_vehicles')
      .select('plate, email')
      .eq('company_id', companyId)
      .ilike('plate', `${escaped}%`)
      .order('updated_at', { ascending: false })
      .limit(6);
    if (error) return res.status(500).json({ error: 'Lookup failed.' });
    return res.status(200).json({ vehicles: data || [] });
  }

  // ── Cheque photo upload — fixed bucket, same signed-upload-token
  // pattern as every other upload flow in this app. ─────────────────────
  if (action === 'create_cheque_upload_url') {
    const { filename } = req.body;
    const result = await createUploadUrl(supabaseAdmin, UPLOAD_BUCKET, filename);
    if (result.error) return res.status(500).json({ error: result.error });
    return res.status(200).json({ ok: true, path: result.path, uploadToken: result.uploadToken });
  }

  // ── Log a transaction: a priced load, or a redirect ──────────────────
  // Idempotent on clientSubmissionId — the offline queue may retry a
  // resubmit after a dropped response, and a retry must never issue a
  // second receipt number for the same load (that would look exactly like
  // the fraud pattern this whole system exists to catch).
  if (action === 'log_transaction') {
    const {
      stationId, businessDate, items, redirected, plate, vehicleEmail,
      paymentMethod, chequePhotoPath, clientSubmissionId, operatorName,
    } = req.body;

    if (!stationId || !businessDate || !clientSubmissionId) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }
    const station = await loadOwnedStation(companyId, stationId);
    if (!station) return res.status(404).json({ error: 'Station not found.' });

    const { data: existingRows } = await supabaseAdmin
      .from('gatehouse_transactions')
      .select('*')
      .eq('company_id', companyId)
      .eq('client_submission_id', clientSubmissionId)
      .limit(1);
    if (existingRows && existingRows.length > 0) {
      return res.status(200).json({ ok: true, transaction: existingRows[0], alreadyLogged: true });
    }

    const cleanPlate = plate ? String(plate).trim().toUpperCase() : null;

    let tierLabel = null;
    let amount = null;
    let singleTierId = null; // set only when the cart is exactly one distinct tier — see the gatehouse_transactions.tier_id note below
    if (!redirected) {
      // A visit can be more than one of the same charge (two minimum fees
      // on one load, two fridges, etc.), so pricing is a cart: any number
      // of {tierId, quantity} line items — not one base tier plus a set of
      // add-ons. Still exactly one receipt number for the whole visit.
      // Quantity is clamped to [1, 50] — 0/negative/NaN/missing all become
      // 1 rather than being silently dropped or going negative, and 50 is
      // a sanity ceiling against a malformed value producing a nonsensical
      // total (no real visit needs more than 50 of one line item).
      const cleanItems = Array.isArray(items)
        ? items
            .filter(it => it && it.tierId)
            .map(it => ({ tierId: it.tierId, quantity: Math.min(50, Math.max(1, Math.floor(Number(it.quantity) || 1))) }))
        : [];
      if (cleanItems.length === 0) return res.status(400).json({ error: 'Select at least one price.' });

      const tierIds = [...new Set(cleanItems.map(it => it.tierId))];
      const { data: tierRows, error: tierErr } = await supabaseAdmin
        .from('gatehouse_price_tiers')
        .select('id, label, price')
        .in('id', tierIds)
        .eq('company_id', companyId);
      if (tierErr || !tierRows || tierRows.length !== tierIds.length) {
        return res.status(400).json({ error: 'Invalid price selected.' });
      }
      const tierById = Object.fromEntries(tierRows.map(t => [t.id, t]));

      tierLabel = cleanItems
        .map(it => { const t = tierById[it.tierId]; return it.quantity > 1 ? `${t.label} x${it.quantity}` : t.label; })
        .join(' + ');
      amount = cleanItems.reduce((sum, it) => sum + Number(tierById[it.tierId].price) * it.quantity, 0);
      // gatehouse_transactions.tier_id is a single nullable FK, predating
      // the cart — it can't represent a multi-item visit, so it's only
      // populated when the cart resolves to exactly one distinct tier
      // (any quantity), and left null otherwise. tier_label/amount above
      // are the source of truth for what was actually charged either way.
      if (tierIds.length === 1) singleTierId = tierIds[0];

      if (paymentMethod !== 'cash' && paymentMethod !== 'cheque') {
        return res.status(400).json({ error: 'Payment method must be cash or cheque.' });
      }
      if (paymentMethod === 'cheque' && !chequePhotoPath) {
        return res.status(400).json({ error: 'A cheque photo is required for cheque payments.' });
      }
    }

    // Supabase-js has no "SET x = x + 1" helper, so do the increment as a
    // fetch-then-conditional-update guarded by the unique index on
    // (company_id, station_id, business_date, receipt_number): if two
    // requests raced and both read the same next_receipt_number, the
    // second insert below fails the unique constraint and is retried once
    // with a fresh read.
    //
    // Receipt numbers reset to a fresh random 6-digit start
    // (100000-999999) at the first transaction of each new business_date
    // per station, tracked by counter_business_date, rather than counting
    // up forever from 1 — then count up gap-free from there for the rest
    // of that day exactly as before.
    async function claimNextReceiptNumber() {
      const { data: cur, error: curErr } = await supabaseAdmin
        .from('gatehouse_stations')
        .select('next_receipt_number, counter_business_date')
        .eq('id', stationId)
        .eq('company_id', companyId) // defense-in-depth — station is already ownership-checked via loadOwnedStation above
        .limit(1);
      if (curErr || !cur || cur.length === 0) throw new Error('Could not read station counter.');
      const row = cur[0];

      if (row.counter_business_date !== businessDate) {
        const start = 100000 + Math.floor(Math.random() * 900000);
        let rollover = supabaseAdmin
          .from('gatehouse_stations')
          .update({ next_receipt_number: start + 1, counter_business_date: businessDate })
          .eq('id', stationId)
          .eq('company_id', companyId);
        // Guard on the OLD counter_business_date (fresh station rows have
        // it as null) so only one of any racing requests wins the
        // rollover — the loser's update matches nothing, throws
        // LOST_RACE, and the caller's retry re-reads and finds the day
        // already rolled over.
        rollover = row.counter_business_date === null
          ? rollover.is('counter_business_date', null)
          : rollover.eq('counter_business_date', row.counter_business_date);
        const { data: bumped, error: bumpErr } = await rollover.select('id');
        if (bumpErr) throw new Error('Could not reserve a receipt number.');
        if (!bumped || bumped.length === 0) throw new Error('LOST_RACE');
        return start;
      }

      const issued = row.next_receipt_number;
      const { data: bumped, error: bumpErr } = await supabaseAdmin
        .from('gatehouse_stations')
        .update({ next_receipt_number: issued + 1 })
        .eq('id', stationId)
        .eq('company_id', companyId)
        .eq('next_receipt_number', issued) // only matches if nobody else already bumped it
        .eq('counter_business_date', businessDate) // only matches if nobody else already rolled the day over
        .select('id');
      if (bumpErr) throw new Error('Could not reserve a receipt number.');
      if (!bumped || bumped.length === 0) throw new Error('LOST_RACE'); // someone else claimed this number first — caller retries
      return issued;
    }

    let receiptNumber = null;
    let insertError = null;
    for (let attempt = 0; attempt < 5 && receiptNumber === null; attempt++) {
      let candidate;
      try {
        candidate = await claimNextReceiptNumber();
      } catch (e) {
        insertError = e; // LOST_RACE or a read/update failure — try again
        continue;
      }
      const { error: txErr } = await supabaseAdmin
        .from('gatehouse_transactions')
        .insert({
          company_id: companyId,
          station_id: stationId,
          receipt_number: candidate,
          business_date: businessDate,
          tier_id: redirected ? null : singleTierId,
          tier_label: tierLabel,
          amount,
          payment_method: redirected ? null : paymentMethod,
          cheque_photo_url: redirected ? null : (paymentMethod === 'cheque' ? chequePhotoPath : null),
          plate: cleanPlate,
          vehicle_email: vehicleEmail || null,
          redirected: !!redirected,
          operator_name: operatorName || session.userName || null,
          client_submission_id: clientSubmissionId,
        })
        .select('id')
        .limit(1);
      if (!txErr) { receiptNumber = candidate; insertError = null; break; }
      insertError = txErr; // unique-constraint race — loop retries with a fresh claim
    }
    if (receiptNumber === null) return res.status(500).json({ error: insertError?.message || 'Could not save transaction — please try again.' });

    if (cleanPlate) {
      await supabaseAdmin.from('gatehouse_vehicles').upsert(
        { company_id: companyId, plate: cleanPlate, email: vehicleEmail || null, updated_at: new Date().toISOString() },
        { onConflict: 'company_id,plate' }
      );
    }

    // The booth's vehicle-email field is labelled "for the receipt" — this
    // is that receipt. Best-effort (a failed send never fails a
    // transaction that's already committed above) but awaited, not
    // fire-and-forget — Vercel can freeze the function the instant the
    // response is sent, which would silently kill an un-awaited send. The
    // same flow this runs in (resubmitGatehouseTransaction) is also what
    // fires when a queued offline transaction finally syncs, so a receipt
    // still goes out once the operator is back online, not just for a
    // live submission.
    if (vehicleEmail) {
      const lines = redirected
        ? [`Your load at ${station.name} was redirected and not accepted at this station.`, `Receipt #${receiptNumber} — ${businessDate}`]
        : [`Receipt #${receiptNumber} — ${station.name}, ${businessDate}`, tierLabel, `Amount: $${Number(amount).toFixed(2)} (${paymentMethod})`];
      try {
        await sendEmail({
          to: vehicleEmail,
          subject: `Your receipt — ${session.companyName || 'Gatehouse'} #${receiptNumber}`,
          text: lines.join('\n'),
        });
      } catch (e) {
        console.warn(`Gatehouse receipt email failed for receipt #${receiptNumber}:`, e.message);
      }
    }

    const { data: finalRows } = await supabaseAdmin
      .from('gatehouse_transactions')
      .select('*')
      .eq('company_id', companyId)
      .eq('client_submission_id', clientSubmissionId)
      .limit(1);
    return res.status(200).json({ ok: true, transaction: finalRows && finalRows[0] });
  }

  // ── Dashboard: today's (or any day's) transactions for a station ──────
  if (action === 'list_transactions') {
    const { stationId, businessDate } = req.body;
    const station = await loadOwnedStation(companyId, stationId);
    if (!station) return res.status(404).json({ error: 'Station not found.' });
    const { data, error } = await supabaseAdmin
      .from('gatehouse_transactions')
      .select('*')
      .eq('company_id', companyId)
      .eq('station_id', stationId)
      .eq('business_date', businessDate)
      .order('receipt_number', { ascending: true });
    if (error) return res.status(500).json({ error: 'Could not load transactions.' });
    const withSignedPhotos = await Promise.all((data || []).map(async (t) => ({
      ...t,
      cheque_photo_url: t.cheque_photo_url ? await signStoredUrl(t.cheque_photo_url, UPLOAD_BUCKET) : null,
    })));
    return res.status(200).json({ transactions: withSignedPhotos });
  }

  // ── Cash reconciliation ────────────────────────────────────────────────
  if (action === 'get_reconciliation') {
    const { stationId, businessDate } = req.body;
    const station = await loadOwnedStation(companyId, stationId);
    if (!station) return res.status(404).json({ error: 'Station not found.' });
    const { data, error } = await supabaseAdmin
      .from('gatehouse_reconciliations')
      .select('*')
      .eq('company_id', companyId)
      .eq('station_id', stationId)
      .eq('business_date', businessDate)
      .limit(1);
    if (error) return res.status(500).json({ error: 'Could not load reconciliation.' });
    return res.status(200).json({ reconciliation: (data && data[0]) || null });
  }

  if (action === 'submit_reconciliation') {
    const { stationId, businessDate, cashCounted, reason } = req.body;
    const station = await loadOwnedStation(companyId, stationId);
    if (!station) return res.status(404).json({ error: 'Station not found.' });
    if (cashCounted === undefined || cashCounted === null || isNaN(Number(cashCounted))) {
      return res.status(400).json({ error: 'Enter the cash counted.' });
    }
    const { data: txRows } = await supabaseAdmin
      .from('gatehouse_transactions')
      .select('amount, payment_method, redirected')
      .eq('company_id', companyId)
      .eq('station_id', stationId)
      .eq('business_date', businessDate);
    const expectedCash = (txRows || [])
      .filter(t => !t.redirected && t.payment_method === 'cash')
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const variance = Number(cashCounted) - expectedCash;

    const { data: savedRows, error } = await supabaseAdmin.from('gatehouse_reconciliations').upsert(
      {
        company_id: companyId, station_id: stationId, business_date: businessDate,
        expected_cash: expectedCash, cash_counted: Number(cashCounted), variance,
        reason: reason ? String(reason).trim() : null,
        submitted_by: session.userName || null,
        // Any (re)submission clears a prior review — an edited count
        // always needs a fresh look, never keeps a stale supervisor
        // signoff from before the numbers changed.
        reviewed_by: null, reviewed_at: null,
      },
      { onConflict: 'company_id,station_id,business_date' }
    ).select('*').limit(1);
    if (error) return res.status(500).json({ error: 'Could not save reconciliation.' });
    return res.status(200).json({ ok: true, expectedCash, variance, reconciliation: savedRows && savedRows[0] });
  }

  // ── Supervisor review — a distinct action from submitting the count, so
  // the operator who counted the till can't also be the one who marks it
  // reviewed. Gated to supervisor/admin (workers get 403) AND, when the
  // company has individually-identified logins, to a different person
  // than whoever submitted it — a supervisor reviewing their own count
  // isn't a real second look. That identity check only applies when
  // submitted_by is actually a named person: this demo company logs in
  // with one shared code per role, so userName is empty for everyone and
  // there's no real identity to compare — enforcing it there would just
  // block review outright, not add a control.
  if (action === 'mark_reconciliation_reviewed') {
    if (session.role !== 'supervisor' && session.role !== 'admin') {
      return res.status(403).json({ error: 'Only a supervisor can mark a reconciliation reviewed.' });
    }
    const { stationId, businessDate } = req.body;
    const station = await loadOwnedStation(companyId, stationId);
    if (!station) return res.status(404).json({ error: 'Station not found.' });

    const { data: existingRows } = await supabaseAdmin
      .from('gatehouse_reconciliations')
      .select('submitted_by')
      .eq('company_id', companyId)
      .eq('station_id', stationId)
      .eq('business_date', businessDate)
      .limit(1);
    const existing = existingRows && existingRows[0];
    if (!existing) return res.status(404).json({ error: 'No reconciliation logged for that day yet.' });
    if (existing.submitted_by && session.userName && existing.submitted_by === session.userName) {
      return res.status(403).json({ error: "The person who counted the till can't also mark it reviewed — have someone else review it." });
    }

    const { data, error } = await supabaseAdmin
      .from('gatehouse_reconciliations')
      .update({ reviewed_by: session.userName || 'Supervisor', reviewed_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('station_id', stationId)
      .eq('business_date', businessDate)
      .select('*')
      .limit(1);
    if (error) return res.status(500).json({ error: 'Could not mark reviewed.' });
    if (!data || data.length === 0) return res.status(404).json({ error: 'No reconciliation logged for that day yet.' });
    return res.status(200).json({ ok: true, reconciliation: data[0] });
  }

  // ── Daily PDF report: generate + email it now (demo trigger — a real
  // deploy would call this from a scheduled job once the day's sync
  // completes, per the proposal's "daily, then rolls into the 15th/
  // month-end" cadence). ─────────────────────────────────────────────────
  if (action === 'send_daily_report') {
    const { stationId, businessDate, recipientEmail } = req.body;
    const station = await loadOwnedStation(companyId, stationId);
    if (!station) return res.status(404).json({ error: 'Station not found.' });
    if (!recipientEmail) return res.status(400).json({ error: 'Missing recipient email.' });

    const { data: coRows } = await supabaseAdmin.from('companies').select('name').eq('id', companyId).limit(1);
    const companyName = (coRows && coRows[0] && coRows[0].name) || 'Gatehouse';

    const report = await buildDailyReport(companyId, companyName, station, businessDate);
    const doc = renderGatehouseDailyReportPdf(report);
    const pdfBase64 = doc.output('datauristring').split(',')[1];

    try {
      await sendEmail({
        to: recipientEmail,
        from: 'FORA Reports <reports@reports.forafieldsolutions.com>',
        subject: `Gatehouse daily report — ${report.stationName} — ${businessDate}`,
        text: `Attached: ${report.stationName}'s report for ${businessDate}. ${report.transactions.length} loads logged, ${report.redirectedCount} redirected, grand total $${report.grandTotal.toFixed(2)}.`,
        attachments: [{ filename: gatehouseReportFilename(report), content: pdfBase64 }],
      });
    } catch (e) {
      return res.status(500).json({ error: `Report generated but the email failed to send: ${e.message}` });
    }
    return res.status(200).json({ ok: true });
  }

  // ── Trailer reconciliation (manual entry for the demo; see the
  // proposal's TRUX callout) ─────────────────────────────────────────────
  if (action === 'log_trailer_count') {
    const { stationId, periodStart, periodEnd, trailersOut } = req.body;
    const station = await loadOwnedStation(companyId, stationId);
    if (!station) return res.status(404).json({ error: 'Station not found.' });
    if (!periodStart || !periodEnd || trailersOut === undefined) return res.status(400).json({ error: 'Missing fields.' });
    const { error } = await supabaseAdmin.from('gatehouse_trailer_counts').insert({
      company_id: companyId, station_id: stationId, period_start: periodStart, period_end: periodEnd,
      trailers_out: Number(trailersOut), source: 'manual',
    });
    if (error) return res.status(500).json({ error: 'Could not save trailer count.' });
    return res.status(200).json({ ok: true });
  }

  if (action === 'get_trailer_check') {
    const { stationId, periodStart, periodEnd } = req.body;
    const station = await loadOwnedStation(companyId, stationId);
    if (!station) return res.status(404).json({ error: 'Station not found.' });
    const [{ data: counts }, { data: txRows }] = await Promise.all([
      supabaseAdmin.from('gatehouse_trailer_counts').select('*').eq('company_id', companyId).eq('station_id', stationId).eq('period_start', periodStart).eq('period_end', periodEnd).order('created_at', { ascending: false }).limit(1),
      supabaseAdmin.from('gatehouse_transactions').select('id, redirected').eq('company_id', companyId).eq('station_id', stationId).gte('business_date', periodStart).lte('business_date', periodEnd),
    ]);
    const loadsIn = (txRows || []).filter(t => !t.redirected).length;
    const trailerCount = counts && counts[0];
    return res.status(200).json({
      loadsIn,
      trailersOut: trailerCount ? trailerCount.trailers_out : null,
      hasTrailerData: !!trailerCount,
    });
  }

  return res.status(400).json({ error: 'Unknown action.' });
}
