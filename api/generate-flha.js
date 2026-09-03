// Vercel serverless function — calls Anthropic API securely server-side.
// Set ANTHROPIC_API_KEY in Vercel: Project Settings -> Environment Variables

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Extend Vercel function timeout to 30 seconds (requires Pro on Vercel,
// but maxDuration up to 10s works on Hobby — we'll also shorten the prompt)
export const config = {
  maxDuration: 30,
};

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Hash-then-compare so mismatched-length inputs never short-circuit —
// timingSafeEqual itself throws on unequal-length buffers, and fixed-length
// digests sidestep that while still comparing in constant time.
function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a)).digest();
  const bh = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

// Nothing legitimate sent through this endpoint gets close to this — the
// largest observed caller (AdminPanel.jsx's SOP condenser) already caps its
// pasted-document input at 12,000 characters client-side before adding its
// own ~1,500 characters of instructions. This is a server-side backstop
// against an arbitrary-length prompt run up for cost/DoS, not a tuned limit.
const MAX_PROMPT_CHARS = 40000;

// Fixed-window rate limit (see docs/schema/ai-rate-limit-migration.sql) —
// every call to this endpoint spends real Anthropic API cost, and unlike
// every other endpoint in this app, nothing else here bounds how often a
// single valid session can call it. Keyed by roster userId when the
// session identifies one, else by companyId (shared-code sessions share a
// bucket, same granularity the session itself carries).
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX_REQUESTS = 20;

async function checkRateLimit(key) {
  const now = Date.now();
  const { data: rows } = await supabaseAdmin
    .from('ai_rate_limits')
    .select('window_start, count')
    .eq('key', key)
    .limit(1);
  const row = rows && rows[0];
  if (!row || now - new Date(row.window_start).getTime() > RATE_LIMIT_WINDOW_MS) {
    await supabaseAdmin
      .from('ai_rate_limits')
      .upsert({ key, window_start: new Date(now).toISOString(), count: 1 });
    return true;
  }
  if (row.count >= RATE_LIMIT_MAX_REQUESTS) return false;
  await supabaseAdmin.from('ai_rate_limits').update({ count: row.count + 1 }).eq('key', key);
  return true;
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt, token } = req.body;
  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }
  if (typeof prompt !== 'string' || prompt.length > MAX_PROMPT_CHARS) {
    return res.status(400).json({ error: "Prompt too long." });
  }

  const rateLimitKey = session.userId ? `user:${session.userId}` : `company:${session.companyId}`;
  const allowed = await checkRateLimit(rateLimitKey);
  if (!allowed) {
    return res.status(429).json({ error: "Too many AI requests. Please wait a few minutes and try again." });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 6000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    // Rate-limit headroom, logged on every call (success or failure) so it's
    // visible in Vercel logs without needing to reproduce a 429 to see it.
    console.log("Anthropic rate limits:", JSON.stringify({
      requests: `${response.headers.get("anthropic-ratelimit-requests-remaining")}/${response.headers.get("anthropic-ratelimit-requests-limit")}`,
      requestsReset: response.headers.get("anthropic-ratelimit-requests-reset"),
      inputTokens: `${response.headers.get("anthropic-ratelimit-input-tokens-remaining")}/${response.headers.get("anthropic-ratelimit-input-tokens-limit")}`,
      outputTokens: `${response.headers.get("anthropic-ratelimit-output-tokens-remaining")}/${response.headers.get("anthropic-ratelimit-output-tokens-limit")}`,
      retryAfter: response.headers.get("retry-after"),
    }));

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Anthropic API error: ${response.status} ${errText}`);
      return res.status(500).json({ error: 'AI generation failed. Try again.' });
    }

    const data = await response.json();

    // Log key details for debugging in Vercel logs
    console.log("Anthropic stop_reason:", data.stop_reason);
    console.log("Anthropic usage:", JSON.stringify(data.usage));
    console.log("Response text length:", data.content?.[0]?.text?.length);

    res.status(200).json(data);
  } catch (err) {
    console.error('generate-flha handler failed:', err.message);
    res.status(500).json({ error: 'AI generation failed. Try again.' });
  }
}
