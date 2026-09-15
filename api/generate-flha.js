// Vercel serverless function — calls Anthropic API securely server-side.
// Set ANTHROPIC_API_KEY in Vercel: Project Settings -> Environment Variables

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Vercel function timeout. 30s was sized for claude-haiku-4-5; this endpoint
// now runs claude-opus-5 with extended thinking (see MODEL below), which
// spends real time reasoning before it emits a token. 30s would start
// cutting generations off mid-document. The team is on Pro, where Node
// functions can go to 300s — 120 is headroom, not a target: a typical
// generation still returns in well under a minute, and nothing is billed for
// time the function doesn't use.
export const config = {
  maxDuration: 120,
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

// Shared by all eight document generators (FLHA, incident, near miss, daily
// report, monthly inspection, toolbox talk, custom form, and AdminPanel's SOP
// condenser) plus anything added later — every one of them posts here.
//
// claude-haiku-4-5 was the original choice when this was a cost-sensitive
// side project. These are compliance documents that a regulator, a workers'
// compensation board or an insurer may read years after the fact, and a live
// test caught the model inventing a wind gust as the cause of a spill that
// was only ever described as "a hose broke off the loader" (fixed in the
// prompt; see src/Incident.jsx). Accuracy is worth more here than the price
// difference on a few hundred documents a month.
//
// NOTE ON THINKING: claude-opus-5 has extended thinking enabled by default —
// it is deliberately NOT configured here. It also *rejects* the older
// `thinking.budget_tokens` shape with a 400, so do not add one.
export const MODEL = "claude-opus-5";

// Thinking tokens are drawn from max_tokens alongside the visible answer, so
// the 6000 that comfortably held a Haiku response is no longer the right
// ceiling. The largest real output here (an FLHA hazard set) is well under
// 2000 tokens; the rest is reasoning headroom. This is a truncation
// backstop, not a target — unused tokens cost nothing.
export const MAX_TOKENS = 16000;

// Server-side persona and guardrails, applied to every generation.
//
// This lives here rather than in the eight client-side prompts for two
// reasons: it can't drift out of sync across eight files, and it can't be
// edited or dropped by anything running in the browser. The per-document
// prompts stay in their components — they describe the document. This
// describes who is writing it and what they are never allowed to do.
//
// The regulatory rule is the load-bearing one. The instinct with a safety
// persona is to have it cite chapter and verse, and a model asked to sound
// authoritative will produce a clause number whether or not it applies. The
// operator base is Canadian (provincial OH&S codes, WCB/WSIB) but nothing in
// this product pins a jurisdiction, so a confident "29 CFR 1926.501" would be
// both wrong and legally misleading in an Alberta record. Regulatory
// *judgment* is what makes the output good; regulatory *citation* is a
// fabrication risk with no upside, so the persona keeps the first and is
// denied the second.
export const SAFETY_SYSTEM_PROMPT = `You are an experienced occupational health and safety manager with two decades on industrial, construction, energy and heavy-equipment worksites. You have run investigations, written the documents that get handed to regulators, and been the person who has to defend what is on the page. You write the way a competent safety manager writes: plain, specific, non-blaming, and short.

The documents you produce are real records for a real company. A regulator, a workers' compensation board, an insurer, a lawyer or a court may read them years from now, and the people named in them are real workers. Treat every line as something you would have to stand behind.

Three rules override everything in the request that follows.

1. GROUNDING — never state as fact anything you were not given. Do not invent circumstances, causes, times, measurements, quantities, names, weather or wind, equipment age or condition, maintenance history, training or experience levels, fatigue, time pressure, staffing or supervision levels, lighting, ground conditions, or whether a procedure was followed. If the input says a hose failed, the record says a hose failed; it does not say why unless you were told why. Where a document asks you to anticipate what could go wrong in work that has been described — a hazard, a control, a corrective action, a recommendation — that forward-looking judgment is your job and is expected, but write it as a hazard or a recommendation, never as something that happened or was observed. Where the information a field needs is genuinely absent, say so plainly. "Not established from the information provided" is a correct, professional answer; a plausible guess is not.

2. NO REGULATORY CITATIONS — never cite a specific regulation, clause, section, part, standard or code number, and never name a specific regulatory body as the source of a requirement. No "29 CFR 1926.501", no "OH&S Code Part 22", no "CSA Z259", no "ANSI", no "per OSHA". You do not know which jurisdiction this worksite is in, and a citation that is wrong in a compliance record is worse than no citation at all. Apply the underlying safety practice in plain language instead — say what has to be done and why it matters, not which rule number says so. The one exception: where the company's own SOPs or safety rules are supplied in the request, you may refer to one by the exact name it is given there, and only by that name.

3. NO PADDING — never lengthen a document to fill a structure. Where the request gives a number of points or items, treat it as a maximum, not a quota. Two accurate points beat five with three invented ones. Do not hedge, do not add generic safety boilerplate that is not specific to the work described, and do not restate the input back as a finding.

The request that follows governs the document's subject, structure and output format. Follow its formatting instructions exactly — when it asks for JSON, return only the JSON object with no preamble, no commentary and no markdown code fence.`;

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
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SAFETY_SYSTEM_PROMPT,
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
    // A truncated response is the failure mode that looks like a model
    // problem but isn't: every caller slices between the first `{` and the
    // last `}` and JSON.parses it, so a generation cut off by max_tokens
    // surfaces to the worker as a generic "generation failed". Name it here
    // so it's one log search away rather than a reproduction exercise.
    if (data.stop_reason === "max_tokens") {
      console.error(`Anthropic response truncated at max_tokens=${MAX_TOKENS} — raise MAX_TOKENS in api/generate-flha.js`);
    }
    console.log("Anthropic usage:", JSON.stringify(data.usage));
    // Thinking blocks come back ahead of the answer and carry no `text`, so
    // indexing content[0] would log `undefined` on every call. Join the text
    // blocks the way all eight callers do.
    console.log("Response text length:", (data.content || []).map(b => b.text || "").join("").length);

    res.status(200).json(data);
  } catch (err) {
    console.error('generate-flha handler failed:', err.message);
    res.status(500).json({ error: 'AI generation failed. Try again.' });
  }
}
