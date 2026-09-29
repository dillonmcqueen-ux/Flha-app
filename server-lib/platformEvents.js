// server-lib/platformEvents.js
// Records platform-health events (cron runs, outbound email, AI calls) to the
// platform_events table so the founder dashboard can answer "is the platform
// healthy and what does it cost" without reading Vercel logs. See
// docs/schema/platform-events-migration.sql for what the table holds and what
// it deliberately does not.
//
// Aggregates and outcomes only. Never a prompt, a model output, an email
// address, a subject line, or any document content: `metrics` is filtered to
// short strings and finite numbers below, and callers pass counts, not text.
//
// Best-effort and never allowed to fail the thing it is measuring, same
// discipline as server-lib/auditLog.js: a telemetry write failing is not a
// reason to fail a cron run, drop an email or break a document generation.
import { createClient } from '@supabase/supabase-js';

export const EVENT_TYPES = ['cron_run', 'email_send', 'ai_generation'];
export const EVENT_STATUSES = ['ok', 'error', 'skipped', 'refused', 'rate_limited', 'truncated'];

// Only these keys are ever stored. A length cap alone would let a future
// caller park a name or subject fragment under a new key; an allowlist makes
// adding one a deliberate edit here.
export const ALLOWED_METRIC_KEYS = [
  'model', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens',
  'stop_reason', 'latency_ms', 'http_status', 'has_attachment', 'duration_ms',
  'companies', 'summarized', 'failed', 'skipped', 'ran',
  'equipment_ok', 'equipment_failed', 'equipment_skipped',
  'timeclock_ok', 'timeclock_failed', 'timeclock_skipped',
];
// A hung Supabase call must not stall a user-facing response after the AI
// call already succeeded.
const WRITE_TIMEOUT_MS = 2000;
const MAX_METRIC_KEYS = 16;
const MAX_STRING_LEN = 80;

let fallbackClient = null;
function clientOrFallback(supabaseAdmin) {
  if (supabaseAdmin) return supabaseAdmin;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!fallbackClient) fallbackClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return fallbackClient;
}

// Keeps only finite numbers and short strings, capped in count. Anything
// else (objects, arrays, long text) is dropped rather than truncated, so a
// caller cannot accidentally park content in a telemetry column.
export function sanitizeMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(metrics)) {
    if (n >= MAX_METRIC_KEYS) break;
    if (!ALLOWED_METRIC_KEYS.includes(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) { out[String(k).slice(0, 40)] = v; n++; }
    else if (typeof v === 'string') { out[String(k).slice(0, 40)] = v.slice(0, MAX_STRING_LEN); n++; }
    else if (typeof v === 'boolean') { out[String(k).slice(0, 40)] = v; n++; }
  }
  return n > 0 ? out : null;
}

export async function recordPlatformEvent(supabaseAdmin, {
  eventType, status, subtype = null, companyId = null, metrics = null,
}) {
  try {
    if (!EVENT_TYPES.includes(eventType) || !EVENT_STATUSES.includes(status)) {
      console.error('platform_events skipped, unknown type/status:', eventType, status);
      return;
    }
    const client = clientOrFallback(supabaseAdmin);
    if (!client) return;
    const write = client.from('platform_events').insert({
      event_type: eventType,
      status,
      subtype: typeof subtype === 'string' ? subtype.slice(0, 60) : null,
      company_id: (companyId !== null && companyId !== undefined && companyId !== '' && Number.isInteger(Number(companyId))) ? Number(companyId) : null,
      metrics: sanitizeMetrics(metrics),
    });
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ error: { message: 'timed out' } }), WRITE_TIMEOUT_MS); });
    const { error } = await Promise.race([write, timeout]);
    clearTimeout(timer);
    if (error) console.error(`platform_events write failed for "${eventType}":`, error.message);
  } catch (e) {
    console.error(`platform_events write failed for "${eventType}":`, e.message);
  }
}

// Pulls the token counts out of an Anthropic /v1/messages response body.
// Cost is deliberately NOT computed here: prices change and belong in one
// place on the read side (the dashboard), not baked into old rows.
export function anthropicUsageMetrics(data, { model, startedAt } = {}) {
  const usage = (data && data.usage) || {};
  return {
    model: model || null,
    input_tokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : null,
    output_tokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : null,
    cache_read_tokens: Number.isFinite(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : null,
    cache_write_tokens: Number.isFinite(usage.cache_creation_input_tokens) ? usage.cache_creation_input_tokens : null,
    stop_reason: (data && typeof data.stop_reason === 'string') ? data.stop_reason : null,
    latency_ms: Number.isFinite(startedAt) ? Date.now() - startedAt : null,
  };
}
