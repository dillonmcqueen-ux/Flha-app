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
    if (!redirected) {
      // A visit can be more than one of the same charge (two minimum fees
      // on one load, two fridges, etc.), so pricing is a cart: any number
      // of {tierId, quantity} line items — not one base tier plus a set of
      // add-ons. Still exactly one receipt number for the whole visit.
      const cleanItems = Array.isArray(items)
        ? items
            .filter(it => it && it.tierId)
            .map(it => ({ tierId: it.tierId, quantity: Math.max(1, Math.floor(Number(it.quantity) || 1)) }))
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

      if (paymentMethod !== 'cash' && paymentMethod !== 'cheque') {
        return res.status(400).json({ error: 'Payment method must be cash or cheque.' });
      }
      if (paymentMethod === 'cheque' && !chequePhotoPath) {
        return res.status(400).json({ error: 'A cheque photo is required for cheque payments.' });
      }
    }

    // Supabase-js has no "SET x = x + 1" helper, so do the increment as a
    // fetch-then-conditional-update guarded by the unique index on
    // (company_id, station_id, receipt_number): if two requests raced and
    // both read the same next_receipt_number, the second insert below
    // fails the unique constraint and is retried once with a fresh read.
    async function claimNextReceiptNumber() {
      const { data: cur, error: curErr } = await supabaseAdmin
        .from('gatehouse_stations')
        .select('next_receipt_number')
        .eq('id', stationId)
        .eq('company_id', companyId) // defense-in-depth — station is already ownership-checked via loadOwnedStation above
        .limit(1);
      if (curErr || !cur || cur.length === 0) throw new Error('Could not read station counter.');
      const issued = cur[0].next_receipt_number;
      const { data: bumped, error: bumpErr } = await supabaseAdmin
        .from('gatehouse_stations')
        .update({ next_receipt_number: issued + 1 })
        .eq('id', stationId)
        .eq('company_id', companyId)
        .eq('next_receipt_number', issued) // only matches if nobody else already bumped it
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
          tier_id: redirected ? null : tierId,
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
  if (action === 'submit_reconciliation') {
    const { stationId, businessDate, cashCounted } = req.body;
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

    const { error } = await supabaseAdmin.from('gatehouse_reconciliations').upsert(
      {
        company_id: companyId, station_id: stationId, business_date: businessDate,
        expected_cash: expectedCash, cash_counted: Number(cashCounted), variance,
        submitted_by: session.userName || null,
      },
      { onConflict: 'company_id,station_id,business_date' }
    );
    if (error) return res.status(500).json({ error: 'Could not save reconciliation.' });
    return res.status(200).json({ ok: true, expectedCash, variance });
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
