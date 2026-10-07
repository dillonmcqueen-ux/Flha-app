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
    await recordPlatformEvent(supabaseAdmin, { eventType: 'cron_run', subtype: 'notification_digest', status: 'error', metrics: { skipped: 1, duration_ms: Date.now() - startedAt } });
    return res.status(200).json({ skipped: true });
  }
  const result = await runDigest(supabaseAdmin, { sendEmail });
  await recordPlatformEvent(supabaseAdmin, {
    eventType: 'cron_run', subtype: 'notification_digest', status: result.error || result.failed > 0 ? 'error' : 'ok',
    metrics: { claimed: result.claimed, sent: result.sent, dropped: result.dropped, failed: result.failed, duration_ms: Date.now() - startedAt },
  });
  // Counts only: no addresses, no names.
  return res.status(result.error ? 500 : 200).json({ claimed: result.claimed, sent: result.sent, dropped: result.dropped, failed: result.failed });
}
