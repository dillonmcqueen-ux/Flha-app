// server-lib/platformHealth.js
// The platform-health half of the founder dashboard: scheduled job results,
// email delivery, and AI generation success and cost, all from the
// platform_events table (docs/schema/platform-events-migration.sql,
// written by server-lib/platformEvents.js).
//
// Aggregates only. platform_events never holds a prompt, an output, an email
// address or a subject, and nothing here adds any. Company ids are turned
// into names for the founder's per-company AI cost list, nothing else.
//
// Pure and DB-free: server-lib/platformOverview.js loads the rows and calls
// buildPlatformHealth(). Reachable only through api/admin.js's founder-only
// handler (a test pins the import chain).
//
// What this cannot see, on purpose: storage growth, Supabase advisor
// findings and Vercel runtime errors live in connected services, not in
// FORA's own tables. They are reachable from a Claude Code session, not from
// the app, and the dashboard says so instead of showing a blank.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// USD per million tokens. Source: Anthropic's published API pricing as
// bundled with the claude-api skill, cached 2026-09-25. Cost is derived at
// read time from token counts, so changing a price here restates history
// correctly; nothing in platform_events stores a dollar figure. A model that
// is not listed is counted as "unpriced" rather than guessed at.
export const MODEL_PRICES = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};
// Prompt caching, as multiples of the model's input price: reads are about a
// tenth, a 5-minute cache write is about a quarter more.
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

// Every scheduled job in vercel.json, with how often it should fire. A job
// is overdue once it is 1.5 cadences late plus two hours of slack.
export const CRONS = [
  { subtype: 'equipment_reports', label: 'Weekly equipment and time clock reports', cadenceHours: 168 },
  { subtype: 'company_brain_summary', label: 'Company Brain summary', cadenceHours: 24 },
  { subtype: 'portal_reports', label: 'Portal department reports', cadenceHours: 24 },
  { subtype: 'notification_digest', label: 'Held-notice digest', cadenceHours: 10 / 60 },
];

export const AI_LABELS = {
  flha: 'FLHA', incident: 'Incident', near_miss: 'Near Miss', daily_report: 'Daily Report',
  monthly_inspection: 'Monthly Inspection', toolbox_talk: 'Toolbox Talk', custom_form: 'Custom Document',
  sop_condense: 'SOP condenser', other: 'Other', portal_ai_draft: 'Portal document draft',
  brain_summary: 'Company Brain summary', onboarding_drafts: 'Onboarding drafts',
};

export function costOf(metrics = {}) {
  const price = MODEL_PRICES[metrics.model];
  if (!price) return null;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const inputCost = n(metrics.input_tokens) + n(metrics.cache_read_tokens) * CACHE_READ_MULTIPLIER + n(metrics.cache_write_tokens) * CACHE_WRITE_MULTIPLIER;
  return (inputCost * price.input + n(metrics.output_tokens) * price.output) / 1e6;
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);

export function buildPlatformHealth({ events = [], companies = [] } = {}, now = new Date()) {
  const t = now.getTime();
  const nameOf = new Map(companies.map((c) => [c.id, c.name]));
  const recent = events.filter((e) => e.created_at && new Date(e.created_at).getTime() >= t - 30 * DAY);
  const firstAt = events.length ? Math.min(...events.map((e) => new Date(e.created_at).getTime())) : null;

  // ── scheduled jobs ───────────────────────────────────────────────────
  const crons = CRONS.map((c) => {
    const runs = recent.filter((e) => e.event_type === 'cron_run' && e.subtype === c.subtype)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const last = runs[0] || null;
    const lastAt = last ? new Date(last.created_at).getTime() : null;
    const limit = c.cadenceHours * 1.5 * HOUR + 2 * HOUR;
    // With no run on record, only call it overdue once telemetry has been
    // collecting for longer than the job's own window; before that it is
    // simply not observed yet.
    const overdue = lastAt !== null ? t - lastAt > limit : (firstAt !== null && t - firstAt > limit);
    return {
      subtype: c.subtype, label: c.label, cadenceHours: c.cadenceHours,
      runs30: runs.length, failed30: runs.filter((r) => r.status === 'error').length,
      lastAt: lastAt ? new Date(lastAt).toISOString() : null,
      lastStatus: last ? last.status : null,
      lastDurationMs: last && last.metrics ? (last.metrics.duration_ms ?? null) : null,
      overdue,
      state: lastAt === null ? (overdue ? 'overdue' : 'not_observed_yet') : (last.status === 'error' ? 'failed' : (overdue ? 'overdue' : 'ok')),
    };
  });

  // ── email ────────────────────────────────────────────────────────────
  const emails = recent.filter((e) => e.event_type === 'email_send');
  const emailOk = emails.filter((e) => e.status === 'ok').length;
  const emailFailed = emails.filter((e) => e.status === 'error');
  const emailSkipped = emails.filter((e) => e.status === 'skipped').length;
  const failureKinds = {};
  for (const e of emailFailed) failureKinds[e.subtype || 'unknown'] = (failureKinds[e.subtype || 'unknown'] || 0) + 1;
  const email = {
    sent: emailOk, failed: emailFailed.length, skipped: emailSkipped,
    failureRatePct: pct(emailFailed.length, emailOk + emailFailed.length),
    failureKinds: Object.entries(failureKinds).map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    lastFailureAt: emailFailed.length ? emailFailed.map((e) => e.created_at).sort().slice(-1)[0] : null,
  };

  // ── AI generation ────────────────────────────────────────────────────
  const ai = recent.filter((e) => e.event_type === 'ai_generation');
  const bySubtype = {}, byModel = {}, byCompany = {}, perDay = {};
  for (let i = 29; i >= 0; i--) { const k = new Date(t - i * DAY).toISOString().slice(0, 10); perDay[k] = { date: k, calls: 0, failed: 0 }; }
  let totalCost = 0, unpriced = 0, inTok = 0, outTok = 0;
  for (const e of ai) {
    const m = e.metrics || {};
    const cost = costOf(m);
    if (cost === null && (m.input_tokens || m.output_tokens)) unpriced += 1;
    if (cost !== null) totalCost += cost;
    inTok += Number.isFinite(m.input_tokens) ? m.input_tokens : 0;
    outTok += Number.isFinite(m.output_tokens) ? m.output_tokens : 0;

    const key = e.subtype || 'other';
    const s = bySubtype[key] || (bySubtype[key] = { subtype: key, label: AI_LABELS[key] || key, calls: 0, ok: 0, failed: 0, refused: 0, truncated: 0, rateLimited: 0, inputTokens: 0, outputTokens: 0, cost: 0, latencySum: 0, latencyN: 0 });
    s.calls += 1;
    if (e.status === 'ok') s.ok += 1;
    else if (e.status === 'error') s.failed += 1;
    else if (e.status === 'refused') s.refused += 1;
    else if (e.status === 'truncated') s.truncated += 1;
    else if (e.status === 'rate_limited') s.rateLimited += 1;
    s.inputTokens += Number.isFinite(m.input_tokens) ? m.input_tokens : 0;
    s.outputTokens += Number.isFinite(m.output_tokens) ? m.output_tokens : 0;
    if (cost !== null) s.cost += cost;
    if (Number.isFinite(m.latency_ms)) { s.latencySum += m.latency_ms; s.latencyN += 1; }

    if (m.model) {
      const b = byModel[m.model] || (byModel[m.model] = { model: m.model, calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, priced: !!MODEL_PRICES[m.model] });
      b.calls += 1;
      b.inputTokens += Number.isFinite(m.input_tokens) ? m.input_tokens : 0;
      b.outputTokens += Number.isFinite(m.output_tokens) ? m.output_tokens : 0;
      if (cost !== null) b.cost += cost;
    }
    if (e.company_id != null) {
      const c = byCompany[e.company_id] || (byCompany[e.company_id] = { id: e.company_id, name: nameOf.get(e.company_id) || `Company ${e.company_id}`, calls: 0, cost: 0 });
      c.calls += 1;
      if (cost !== null) c.cost += cost;
    }
    const day = new Date(e.created_at).toISOString().slice(0, 10);
    if (perDay[day]) { perDay[day].calls += 1; if (e.status !== 'ok') perDay[day].failed += 1; }
  }
  const attempted = ai.filter((e) => e.status !== 'rate_limited');
  const aiOk = attempted.filter((e) => e.status === 'ok').length;

  // ── recent trouble across everything ─────────────────────────────────
  const recentFailures = recent
    .filter((e) => e.status && e.status !== 'ok' && e.status !== 'skipped')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10)
    .map((e) => ({ at: e.created_at, type: e.event_type, subtype: e.subtype || null, status: e.status, httpStatus: e.metrics && Number.isFinite(e.metrics.http_status) ? e.metrics.http_status : null }));

  return {
    empty: events.length === 0,
    collectingSince: firstAt ? new Date(firstAt).toISOString() : null,
    crons,
    email,
    ai: {
      calls: ai.length,
      successRatePct: pct(aiOk, attempted.length),
      rateLimited: ai.length - attempted.length,
      inputTokens: inTok, outputTokens: outTok,
      estimatedCost: Math.round(totalCost * 100) / 100,
      unpricedCalls: unpriced,
      bySubtype: Object.values(bySubtype).map((s) => ({ ...s, cost: Math.round(s.cost * 10000) / 10000, avgLatencyMs: s.latencyN ? Math.round(s.latencySum / s.latencyN) : null })).sort((a, b) => b.calls - a.calls),
      byModel: Object.values(byModel).map((b) => ({ ...b, cost: Math.round(b.cost * 10000) / 10000 })).sort((a, b) => b.cost - a.cost),
      topCompanies: Object.values(byCompany).map((c) => ({ ...c, cost: Math.round(c.cost * 10000) / 10000 })).sort((a, b) => b.cost - a.cost || b.calls - a.calls).slice(0, 10),
      perDay: Object.values(perDay),
    },
    recentFailures,
    notInApp: ['Storage growth', 'Supabase advisor findings', 'Vercel runtime errors'],
    pricingNote: 'Cost is an estimate from token counts and published list prices (cached 2026-09-25). Batch discounts and any negotiated rate are not reflected.',
  };
}
