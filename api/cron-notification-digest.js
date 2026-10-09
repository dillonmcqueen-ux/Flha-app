// api/cron-notification-digest.js
// Hit automatically by Vercel Cron, every 10 minutes. Sends the held-notice
// digest (server-lib/notifyDigest.js): people who reached their per-document
// email limit get one "N more were submitted" email once the window ends, so a
// held notice is never silently lost. Its own function on purpose, same
// reasoning as the other crons: different cadence and trigger source, and this
// repo is on Vercel's Pro plan. Protected by CRON_SECRET, same as the other crons.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { sendEmail } from '../server-lib/email.js';
import { runDigest } from '../server-lib/notifyDigest.js';
import { alertOverdueUnsigned, closeStaleUnsigned } from '../server-lib/unsignedSweep.js';
import { alertOverdueUnsignedEngine, closeStaleUnsignedEngine, escalateStalePending, retryFailedFollowUps } from '../server-lib/documentEngine/sweeps.js';
import { recordPlatformEvent } from '../server-lib/platformEvents.js';
import { encryptionKeyProblem } from '../server-lib/fieldCrypto.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a)).digest();
  const bh = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (!process.env.CRON_SECRET || !authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const startedAt = Date.now();
  // The claim zeroes held counts before anything is sent, so never claim when
  // sending cannot work: without the mail key the sends would silently no-op and
  // the counts would be lost, and with a bad encryption key no address can be read.
  if (!process.env.RESEND_API_KEY || encryptionKeyProblem()) {
    console.error('notification digest skipped: email or encryption key not configured');
    // Closing a record unsigned needs no email, so it still runs.
    const closedOnly = (await closeStaleUnsigned(supabaseAdmin)) + (await closeStaleUnsignedEngine(supabaseAdmin));
    await recordPlatformEvent(supabaseAdmin, { eventType: 'cron_run', subtype: 'notification_digest', status: 'error', metrics: { skipped: 1, closed: closedOnly, duration_ms: Date.now() - startedAt } });
    return res.status(200).json({ skipped: true });
  }
  const result = await runDigest(supabaseAdmin, { sendEmail });
  // Records that stayed unsigned: a heads-up at 24 hours, closed at 10 days.
  // Hourly, not every run: one email per person per document type per hour is plenty
  // and a worker saving many records cannot turn it into a stream of emails.
  const alerts = new Date().getUTCMinutes() < 10
    ? await alertOverdueUnsigned(supabaseAdmin, { sendEmail })
    : { alerted: 0, emailed: 0, failed: 0 };
  // The unified document engine's records follow the same two rules, and a
  // record waiting more than 48 hours for a reviewer escalates to the Owner.
  const hourly = new Date().getUTCMinutes() < 10;
  const engineAlerts = hourly ? await alertOverdueUnsignedEngine(supabaseAdmin, { sendEmail }) : { alerted: 0, emailed: 0, failed: 0 };
  const engineReview = hourly ? await escalateStalePending(supabaseAdmin, { sendEmail }) : { escalated: 0, emailed: 0, failed: 0 };
  // A record whose escalations, notifications or Brain signal failed when it was filed is tried again.
  if (hourly) await retryFailedFollowUps(supabaseAdmin, { sendEmail });
  const closed = (await closeStaleUnsigned(supabaseAdmin)) + (await closeStaleUnsignedEngine(supabaseAdmin));
  const failed = result.failed + alerts.failed + engineAlerts.failed + engineReview.failed;
  await recordPlatformEvent(supabaseAdmin, {
    eventType: 'cron_run', subtype: 'notification_digest', status: result.error || failed > 0 ? 'error' : 'ok',
    metrics: { claimed: result.claimed, sent: result.sent, dropped: result.dropped, failed: result.failed, alerted: alerts.alerted + engineAlerts.alerted, escalated: engineReview.escalated, closed, duration_ms: Date.now() - startedAt },
  });
  // Counts only: no addresses, no names.
  return res.status(result.error ? 500 : 200).json({ claimed: result.claimed, sent: result.sent, dropped: result.dropped, failed: result.failed, alerted: alerts.alerted + engineAlerts.alerted, escalated: engineReview.escalated, closed });
}
