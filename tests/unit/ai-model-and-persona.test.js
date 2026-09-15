// Pins the model and the server-side safety persona used for every AI
// generation in the product.
//
// api/generate-flha.js is the single endpoint behind all eight document
// generators (FLHA, incident, near miss, daily report, monthly inspection,
// toolbox talk, custom form, and AdminPanel's SOP condenser), so everything
// asserted here applies to all of them at once — and a regression here
// silently degrades every compliance document the app produces rather than
// breaking one screen visibly.
//
// Two things these cases exist to stop coming back:
//   * a drop back to a cheaper model, or a model string with a date suffix
//     pinned to a snapshot that will later be retired;
//   * a persona that cites regulations. The operator base is Canadian, which
//     is the reason the rule is easy to talk yourself out of and must not be:
//     occupational health and safety law here is provincial, so an
//     authoritative-sounding clause number is wrong the moment a customer
//     works in another province, and the compensation board is not even named
//     the same across them. Regulatory judgment is wanted; regulatory
//     citation is not.
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { readFileSync } from 'fs';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SESSION_SECRET ||= 'test-session-secret';
process.env.ANTHROPIC_API_KEY ||= 'test-anthropic-key';

const handlerModule = await import('../../api/generate-flha.js');
const { MODEL, MAX_TOKENS, EFFORT, SAFETY_SYSTEM_PROMPT, default: handler } = handlerModule;

test('the model is a current Claude model, not a cheaper or date-pinned one', () => {
  assert.equal(MODEL, 'claude-opus-5');
  // A date suffix pins a snapshot that eventually retires and 404s in
  // production; the bare alias does not.
  assert.doesNotMatch(MODEL, /-\d{8}$/);
});

test('max_tokens leaves room for extended thinking', () => {
  // Opus 5 thinks by default and those tokens come out of max_tokens, so the
  // 6000 that was right for claude-haiku-4-5 would now truncate documents.
  assert.ok(MAX_TOKENS > 6000, `MAX_TOKENS is ${MAX_TOKENS}`);
});

test('effort is set below the model default, and thinking is not disabled', () => {
  // claude-opus-5 defaults to `high` effort, which is what made the first
  // live FLHA on this branch unusably slow. This is the latency lever.
  assert.ok(['low', 'medium'].includes(EFFORT), `EFFORT is ${EFFORT}`);

  // Disabling thinking is only valid at `high` effort or below on this model,
  // so a future raise to xhigh/max alongside a disabled-thinking setting
  // would 400 every generation in the product. Neither half is present.
  const src = readFileSync(new URL('../../api/generate-flha.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('"disabled"'), 'thinking should stay on; lower effort instead');
});

test('a refusal is handled rather than parsed', () => {
  // claude-opus-5 can decline with a normal HTTP 200 and stop_reason
  // "refusal". Incident and near-miss descriptions are the likeliest inputs
  // to trip that, and without this the callers look for a `{` that is not
  // there.
  const src = readFileSync(new URL('../../api/generate-flha.js', import.meta.url), 'utf8');
  assert.match(src, /stop_reason === "refusal"/);
});

test('no deprecated thinking budget is configured', () => {
  // claude-opus-5 rejects `thinking: { budget_tokens: N }` with a 400, which
  // would take every AI generation in the product down at once. Read the
  // handler source rather than the request body — a `budget_tokens` added in
  // a branch this test doesn't drive would still ship.
  const src = readFileSync(new URL('../../api/generate-flha.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('budget_tokens:'), 'budget_tokens is rejected by this model');
});

test('the persona forbids regulatory citations', () => {
  assert.match(SAFETY_SYSTEM_PROMPT, /NO REGULATORY CITATIONS/);
  // The US shape, which would be wrong in a Canadian record...
  assert.match(SAFETY_SYSTEM_PROMPT, /29 CFR/);
  assert.match(SAFETY_SYSTEM_PROMPT, /per OSHA/);
  // ...and the Canadian shapes, which are wrong outside the one province they
  // came from. Naming the country is not a licence to cite.
  assert.match(SAFETY_SYSTEM_PROMPT, /OH&S Code Part 22/);
  assert.match(SAFETY_SYSTEM_PROMPT, /CSA Z259/);
  assert.match(SAFETY_SYSTEM_PROMPT, /provincial/);
  // The one permitted exception: the company's own SOPs, by their own name.
  assert.match(SAFETY_SYSTEM_PROMPT, /SOPs/);
});

test('the persona is pinned to Canadian units and terminology', () => {
  // The SOPs this product ships are already metric ("deeper than 1.5
  // metres"), and a US-defaulting model writing feet into a filed record
  // would contradict them.
  assert.match(SAFETY_SYSTEM_PROMPT, /Canadian worksites/);
  assert.match(SAFETY_SYSTEM_PROMPT, /metric units/);
  // Generic, because the board is WCB, WSIB, WorkSafeBC or CNESST depending
  // on the province and the model is not told which.
  assert.match(SAFETY_SYSTEM_PROMPT, /the workers' compensation board/);
});

test('the persona grounds facts without disabling forward-looking hazard work', () => {
  assert.match(SAFETY_SYSTEM_PROMPT, /GROUNDING/);
  assert.match(SAFETY_SYSTEM_PROMPT, /never state as fact anything you were not given/);
  // The FLHA carve-out. A blanket "never introduce anything not stated" would
  // break the app's primary document, where naming hazards that have NOT
  // happened for a described task is the entire feature.
  assert.match(SAFETY_SYSTEM_PROMPT, /forward-looking judgment is your job and is expected/);
  // The answer that replaces a plausible guess.
  assert.match(SAFETY_SYSTEM_PROMPT, /Not established from the information provided/);
});

test('the persona treats item counts as maximums rather than quotas', () => {
  // The invented wind gust came from a thin description meeting a prompt that
  // demanded 2-4 contributing factors. Fixed in src/Incident.jsx; this makes
  // it a rule for every document type, including ones added later.
  assert.match(SAFETY_SYSTEM_PROMPT, /NO PADDING/);
  assert.match(SAFETY_SYSTEM_PROMPT, /maximum, not a quota/);
});

test('the persona defers to each document prompt on output format', () => {
  // Every caller slices between the first `{` and the last `}` and parses it,
  // so a persona that made the model chatty or wrapped JSON in a fence would
  // break all eight generators.
  assert.match(SAFETY_SYSTEM_PROMPT, /no markdown code fence/);
});

test('the request actually sends the model, max_tokens and system prompt', async () => {
  // Exporting the constants is not the same as wiring them in. This drives
  // the real handler and reads the outgoing Anthropic request body.
  const data = Buffer.from(
    JSON.stringify({ role: 'admin', companyId: 'c1', issuedAt: Date.now() })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('base64url');

  let anthropicBody = null;
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('api.anthropic.com')) {
      anthropicBody = JSON.parse(init.body);
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: {} }),
      };
    }
    // Supabase REST (the rate-limit read/upsert) — an empty result opens a
    // fresh window, which is the path a first request takes anyway.
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => [], text: async () => '[]' };
  };

  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };

  try {
    await handler({ method: 'POST', body: { prompt: 'test prompt', token: `${data}.${sig}` } }, res);
  } finally {
    global.fetch = realFetch;
  }

  assert.equal(res.statusCode, 200, `handler returned ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.ok(anthropicBody, 'the Anthropic API should have been called');
  assert.equal(anthropicBody.model, MODEL);
  assert.equal(anthropicBody.max_tokens, MAX_TOKENS);
  assert.equal(anthropicBody.system, SAFETY_SYSTEM_PROMPT);
  // Top-level, not nested under `thinking` — the wrong placement is silently
  // ignored rather than rejected, so the latency fix would just not apply.
  assert.deepEqual(anthropicBody.output_config, { effort: EFFORT });
  // The shape that 400s on this model.
  assert.ok(!('budget_tokens' in (anthropicBody.thinking || {})));
});
