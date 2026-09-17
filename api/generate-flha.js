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

  // A login TICKET is not a session. api/login.js mints two roleless,
  // short-lived tokens with this same signature and secret — the roster
  // ticket (`purpose: 'roster'`, handed out after the company code alone,
  // BEFORE any PIN) and the master ticket (`purpose: 'master'`) — and the
  // comment there claims they can never be replayed as a session because
  // "every other protected endpoint in this app gates on session.role".
  // That was not true: a ticket carries no `userId`, so the roster
  // short-circuit below returned it as a valid session, and the handlers
  // that gate only on company scope rather than on role (list_equipment,
  // list_sops, list_sites, list_custom_fields, get_company_logo) answered
  // it — for this file's 7-day TTL, not the ticket's 5 minutes. Anyone
  // holding a company's worker code could read that company's reference
  // data without ever knowing a PIN.
  //
  // Nothing that is genuinely a session carries `purpose`, so rejecting it
  // outright is the whole fix, and it belongs here rather than in each
  // handler: the next endpoint added without a role check inherits it.
  if (payload.purpose) return null;

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

// Model routing, by document type.
//
// This endpoint is shared by all eight document generators (FLHA, incident,
// near miss, daily report, monthly inspection, toolbox talk, custom form, and
// AdminPanel's SOP condenser), and until now it ran one model for all of
// them. claude-haiku-4-5 was the original choice, from when this was a
// cost-sensitive side project rather than something a paying customer files
// compliance records with.
//
// Moving everything to claude-opus-5 fixed the accuracy concern and created a
// latency one: a live FLHA took 30-60 seconds. Lowering effort (see EFFORT
// below) took the thinking time out but could not make an Opus-tier model
// emit tokens at Haiku speed, and an FLHA is a multi-hazard JSON document
// generated from a very long prompt. Output-token generation is what
// dominates, so the only remaining lever is which model runs which document.
//
// The split follows how the documents are actually used:
//
//   * Incident and near-miss reports are legal records. They describe real
//     injuries and releases, they are read by a regulator or a workers'
//     compensation board long after the fact, and they are written rarely —
//     a handful a month, by someone sitting down to do it properly. Accuracy
//     is worth the wait here, so these stay on claude-opus-5.
//
//   * Everything else is written by a worker on a phone, often at the start
//     of a shift, and blocks them from starting work. claude-sonnet-5 is near
//     Opus quality and materially faster, and is still a large step up from
//     the claude-haiku-4-5 all eight ran on before this branch.
//
// Both entries are current aliases with no date suffix — a date-pinned
// snapshot eventually retires and 404s in production.
const OPUS = "claude-opus-5";
const SONNET = "claude-sonnet-5";

export const MODEL_BY_DOCUMENT_TYPE = {
  incident: OPUS,
  near_miss: OPUS,
  flha: SONNET,
  daily_report: SONNET,
  monthly_inspection: SONNET,
  toolbox_talk: SONNET,
  custom_form: SONNET,
  sop_condense: SONNET,
};

// An unknown or missing documentType falls back to the stronger model, not
// the faster one. The client supplies this field and a client can always be
// wrong — a caller added later that forgets it, or an older tab running
// yesterday's bundle. Failing toward Opus means such a bug shows up as a
// document that takes longer than expected, which someone notices and
// reports; failing toward Sonnet would show up as a quietly lower-tier model
// on an incident report, which nobody would ever see. The field only selects
// from this table, so nothing a client sends here widens what it can reach.
export const DEFAULT_MODEL = OPUS;

// documentType reaches the logs, and every other client-supplied field on
// this endpoint is bounded before it gets anywhere (`prompt` by
// MAX_PROMPT_CHARS). Unbounded it would let a caller pad the log volume or
// smuggle newlines in to forge plausible-looking extra log lines. It is only
// ever an identifier from a fixed table, so a short single-line slice loses
// nothing that would help debug a misspelling.
function logSafeDocumentType(documentType) {
  if (typeof documentType !== 'string' || documentType === '') return '(none)';
  return JSON.stringify(documentType.slice(0, 40));
}

export function modelForDocumentType(documentType) {
  if (typeof documentType !== 'string') return DEFAULT_MODEL;
  return Object.prototype.hasOwnProperty.call(MODEL_BY_DOCUMENT_TYPE, documentType)
    ? MODEL_BY_DOCUMENT_TYPE[documentType]
    : DEFAULT_MODEL;
}

// Thinking tokens are drawn from max_tokens alongside the visible answer, so
// the 6000 that comfortably held a claude-haiku-4-5 response is no longer the
// right ceiling — both models here think by default. The largest real output
// (an FLHA hazard set) is well under 2000 tokens; the rest is reasoning
// headroom. This is a truncation backstop, not a target — unused tokens cost
// nothing.
export const MAX_TOKENS = 16000;

// Reasoning effort, the same on both routes. Both models default to `high`,
// where they spend a large thinking budget before writing a single token.
// That default is sized for open-ended agentic work, which is not what this
// endpoint does — every caller hands the model a long, highly specified
// prompt and asks it to return one JSON object. Anthropic's own migration
// guidance names low/medium the primary latency lever and notes these models
// are unusually strong at the low end.
//
// Deliberately kept uniform: the model routing above is the one variable that
// changed in this round, and adding a second one would make a latency or
// quality complaint impossible to attribute. If the incident and near-miss
// reports later turn out to want more deliberation, raising effort on the
// Opus route alone is a one-line change — and the right one to test on its
// own.
//
// Do NOT pair a lower effort with a disabled `thinking.type`. Disabling
// thinking on claude-opus-5 is only valid at `high` effort or below, so a
// later raise to xhigh or max alongside a disabled setting would 400 every
// generation in the product at once. It is also the worse lever: low effort
// already captures most of the latency saving.
export const EFFORT = "low";

// Server-side persona and guardrails, applied to every generation.
//
// This lives here rather than in the eight client-side prompts for two
// reasons: it can't drift out of sync across eight files, and it can't be
// edited or dropped by anything running in the browser. The per-document
// prompts stay in their components — they describe the document. This
// describes who is writing it and what they are never allowed to do.
//
// The regulatory rule is the load-bearing one, and the reasoning matters
// because the obvious objection ("we know we're Canadian now, so let it
// cite") is wrong. The instinct with a safety persona is to have it cite
// chapter and verse, and a model asked to sound authoritative will produce a
// clause number whether or not it applies. Knowing the country does not fix
// that: OH&S is provincial here, so a clause from Alberta's OHS Code is
// simply wrong in BC or Ontario, and the compensation board isn't even named
// the same across provinces (WCB, WSIB, WorkSafeBC, CNESST). Federally
// regulated workplaces sit under a different statute again. A confident
// citation in a filed record is therefore a liability whichever direction it
// points. Regulatory *judgment* is what makes the output good; regulatory
// *citation* is a fabrication risk with no upside, so the persona keeps the
// first and is denied the second.
export const SAFETY_SYSTEM_PROMPT = `You are an experienced occupational health and safety manager with two decades on industrial, construction, energy and heavy-equipment worksites. You have run investigations, written the documents that get handed to regulators, and been the person who has to defend what is on the page. You write the way a competent safety manager writes: plain, specific, non-blaming, and short.

The documents you produce are real records for a real company. A regulator, a workers' compensation board, an insurer, a lawyer or a court may read them years from now, and the people named in them are real workers. Treat every line as something you would have to stand behind.

These are Canadian worksites. Use metric units, Canadian spelling, and Canadian workplace terminology. Where you need to refer to the compensation authority at all, say "the workers' compensation board" generically — it is named differently in every province, and occupational health and safety law here is provincial, not national.

Three rules override everything in the request that follows.

1. GROUNDING — never state as fact anything you were not given. Do not invent circumstances, causes, times, measurements, quantities, names, weather or wind, equipment age or condition, maintenance history, training or experience levels, fatigue, time pressure, staffing or supervision levels, lighting, ground conditions, or whether a procedure was followed. If the input says a hose failed, the record says a hose failed; it does not say why unless you were told why. Where a document asks you to anticipate what could go wrong in work that has been described — a hazard, a control, a corrective action, a recommendation — that forward-looking judgment is your job and is expected, but write it as a hazard or a recommendation, never as something that happened or was observed. Where the information a field needs is genuinely absent, say so plainly. "Not established from the information provided" is a correct, professional answer; a plausible guess is not.

2. NO REGULATORY CITATIONS — never cite a specific regulation, clause, section, part, standard or code number, and never name a specific regulatory body as the source of a requirement. No "29 CFR 1926.501", no "OH&S Code Part 22", no "CSA Z259", no "ANSI", no "per OSHA". Knowing the work is Canadian does not license this: health and safety law here is provincial, so a clause number that is correct in one province is wrong in the next, and you are not told which province this worksite is in. A citation that is wrong in a compliance record is worse than no citation at all. Apply the underlying safety practice in plain language instead — say what has to be done and why it matters, not which rule number says so. The one exception: where the company's own SOPs or safety rules are supplied in the request, you may refer to one by the exact name it is given there, and only by that name.

3. NO PADDING — never lengthen a document to fill a structure. Where the request gives a number of points or items, treat it as a maximum, not a quota. Two accurate points beat five with three invented ones. Do not hedge, do not add generic safety boilerplate that is not specific to the work described, and do not restate the input back as a finding.

The request that follows governs the document's subject, structure and output format. Follow its formatting instructions exactly — when it asks for JSON, return only the JSON object with no preamble, no commentary and no markdown code fence.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt, token, documentType } = req.body;
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

  const model = modelForDocumentType(documentType);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        output_config: { effort: EFFORT },
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

    // claude-opus-5's safety classifiers can decline a request outright, and
    // a decline is a normal HTTP 200 with stop_reason "refusal" and no usable
    // content — not an API error. This app feeds the model injury, incident
    // and near-miss descriptions, which is the input most likely to trip one,
    // so this is a real path rather than a theoretical one. Without this the
    // response falls through to the callers, which all look for a `{` that
    // isn't there and show the worker a generic failure. Every form stays
    // fully editable by hand and already offers that fallback, so returning
    // the error cleanly puts them on the right screen; the log line is what
    // makes a refusal distinguishable from an outage afterwards.
    if (data.stop_reason === "refusal") {
      console.error("Anthropic declined the request:", JSON.stringify(data.stop_details || null));
      return res.status(200).json({ error: "The AI declined to write this one. Fill it in manually — every field on the next screen is editable." });
    }

    // Log key details for debugging in Vercel logs
    console.log("Anthropic model:", model, "documentType:", logSafeDocumentType(documentType));
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
