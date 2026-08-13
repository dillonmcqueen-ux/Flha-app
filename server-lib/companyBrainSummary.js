// server-lib/companyBrainSummary.js
// Phase 4 of docs/scope-company-brain.md: periodically rolls up new
// company_signals (Phase 3) into each company's company_profiles row —
// hazard_emphasis and terminology_notes only. Runs from api/cron-company-
// brain-summary.js on a schedule, never per-request, so generation-time
// cost/latency (Phase 5) stays flat — same "batch, not live" reasoning as
// the existing weekly equipment/timeclock report cron.
//
// Hard constraint, locked in with the user (see the scope doc's "Safety
// floor" decision): this step can only ever shift emphasis and
// terminology, never the risk-rating floor. Enforced structurally in two
// places — the output schema below has no field that could encode a risk
// level or "skip this category" instruction, and the prompt explicitly
// forbids the model from producing one. Phase 5 (not written yet) is
// responsible for actually wiring hazard_emphasis into the generation
// prompt as additive context appended after the existing grounding rules,
// never as a replacement for them — this file only produces the data.
//
// Signal content itself is untrusted (workers' own free text, submitted
// through worker-facing forms — see the Phase 3 tenant-scope review,
// which flagged this as a data-quality point for Phase 4 to be aware of,
// not a tenant-isolation issue). Treated the same way onboardingDrafting.js
// treats company_name/units_list: fed to the model as context, never
// trusted as instructions, and the model's own output is re-validated
// into a fixed shape before it's stored.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

// A company needs at least this many signals since its last summarization
// (or ever, if never summarized) before a batch/LLM call is worth running
// for it — avoids spending a call on a company with one or two edits that
// don't yet suggest a real pattern.
const MIN_NEW_SIGNALS = 5;

// company_signals is a new, low-volume table today. Fetching the most
// recent N rows across ALL companies in one query (rather than a
// per-company query, or a raw SQL/RPC call this codebase's Supabase
// client setup doesn't otherwise use) keeps this simple and matches the
// "best-effort batch job" bar the rest of this feature holds itself to —
// same tradeoff onboardingDrafting.js makes with MAX_SOP_FILES. Revisit
// with a real per-company query (or an RPC) if signal volume ever
// approaches this cap in practice.
const MAX_SIGNAL_ROWS = 5000;
const MAX_SIGNALS_PER_COMPANY_IN_PROMPT = 80;

async function callAnthropic(prompt, maxTokens) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json();
  return data?.content?.[0]?.text || '';
}

function extractJsonObject(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    return null;
  }
}

// Condenses one company's new signal rows into short, capped bullet lines
// grouped by source — this is what actually goes in the prompt, not the
// raw rows, keeping token usage predictable regardless of signal_json
// shape drift over time.
function summarizeSignalsForPrompt(signals) {
  const capped = signals.slice(0, MAX_SIGNALS_PER_COMPANY_IN_PROMPT);
  const lines = [];
  capped.forEach((s) => {
    const j = s.signal_json || {};
    if (s.source_type === 'flha_edit') {
      const parts = [];
      if (j.added?.length) parts.push(`added: ${j.added.join(', ')}`);
      if (j.removed?.length) parts.push(`removed: ${j.removed.join(', ')}`);
      if (j.riskChanged?.length) parts.push(`risk changed: ${j.riskChanged.map((r) => `${r.hazard} (${r.from}->${r.to})`).join(', ')}`);
      if (parts.length) lines.push(`- FLHA edit: ${parts.join('; ')}`);
    } else if (s.source_type === 'toolbox_talk' && j.topic) {
      lines.push(`- Toolbox talk topic: ${j.topic}`);
    } else if (s.source_type === 'incident' && j.category) {
      lines.push(`- Incident category: ${j.category}`);
    } else if (s.source_type === 'near_miss') {
      const parts = [j.involved, j.severity].filter(Boolean);
      if (parts.length) lines.push(`- Near miss: ${parts.join(', severity ')}`);
    }
  });
  return lines.slice(0, MAX_SIGNALS_PER_COMPANY_IN_PROMPT).join('\n').slice(0, 6000);
}

// Re-validates the model's output into a fixed shape before it's ever
// written to company_profiles — same discipline as sanitizeAiEditSignal
// in api/flhas.js. Structurally cannot carry a risk level or category-skip
// instruction: there's no field for one.
function sanitizeSummaryOutput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const hazardEmphasis = (Array.isArray(raw.hazardEmphasis) ? raw.hazardEmphasis : [])
    .filter((e) => e && typeof e === 'object' && typeof e.category === 'string' && e.category.trim())
    .slice(0, 15)
    .map((e) => ({
      category: e.category.trim().slice(0, 80),
      note: typeof e.note === 'string' ? e.note.trim().slice(0, 300) : '',
    }));
  const terminologyNotes = typeof raw.terminologyNotes === 'string' ? raw.terminologyNotes.trim().slice(0, 1000) : '';
  return { hazardEmphasis, terminologyNotes };
}

async function summarizeOneCompany(existingProfile, signals) {
  const prompt = [
    'You maintain a brief internal profile of a construction/field-services',
    "company for a safety documentation app, based on that company's own",
    'recent activity. Your job is ONLY to note what topics, hazard',
    'categories, and terminology this company\'s own submissions emphasize —',
    'you are NEVER deciding or suggesting any risk level, and you must NEVER',
    'suggest skipping, downgrading, or de-prioritizing any safety category.',
    'If the activity below suggests a hazard is being under-reported, do NOT',
    'reflect that as lower emphasis — simply omit it rather than encode a',
    'lower priority.',
    '',
    'Current profile (may be empty if this is the first pass):',
    `Equipment summary: ${existingProfile.equipment_summary || '(none)'}`,
    `Current terminology notes: ${existingProfile.terminology_notes || '(none)'}`,
    `Current hazard emphasis: ${JSON.stringify(existingProfile.hazard_emphasis || [])}`,
    '',
    "Recent activity since the last review (worker-submitted, may be messy or informal):",
    summarizeSignalsForPrompt(signals) || '(no notable activity)',
    '',
    'Respond with ONLY a JSON object, no other text, describing the FULL',
    'updated state (not just what changed):',
    '{',
    '  "hazardEmphasis": [{ "category": "short hazard/topic category", "note": "one short sentence on what this company\'s own activity shows about it, phrased as emphasis/context only, never a risk level or an instruction to skip something" }],',
    '  "terminologyNotes": "any company-specific terms, abbreviations, or phrasing patterns worth reusing in generated documents, or \\"\\" if none stand out"',
    '}',
  ].join('\n');

  const raw = await callAnthropic(prompt, 800);
  return sanitizeSummaryOutput(extractJsonObject(raw));
}

// Orchestrates the whole batch: finds companies with enough new signals,
// summarizes each, and updates company_profiles. Never throws — a
// per-company failure is caught and logged so one bad company can't stop
// the rest of the batch, same discipline as runOnboardingDrafts.
export async function runCompanyBrainSummary(supabaseAdmin) {
  const results = [];
  if (!process.env.ANTHROPIC_API_KEY) return { skipped: true, reason: 'no ANTHROPIC_API_KEY' };

  const { data: signalRows, error: signalErr } = await supabaseAdmin
    .from('company_signals')
    .select('company_id, source_type, signal_json, created_at')
    .order('created_at', { ascending: false })
    .limit(MAX_SIGNAL_ROWS);
  if (signalErr) return { error: 'Could not load company_signals: ' + signalErr.message };
  if (!signalRows || signalRows.length === 0) return { ok: true, processed: 0, results };

  const companyIds = [...new Set(signalRows.map((r) => r.company_id))];
  const { data: profiles, error: profileErr } = await supabaseAdmin
    .from('company_profiles')
    .select('company_id, equipment_summary, terminology_notes, hazard_emphasis, last_summarized_at')
    .in('company_id', companyIds);
  if (profileErr) return { error: 'Could not load company_profiles: ' + profileErr.message };
  const profileByCompany = new Map((profiles || []).map((p) => [p.company_id, p]));

  const byCompany = new Map();
  signalRows.forEach((row) => {
    if (!byCompany.has(row.company_id)) byCompany.set(row.company_id, []);
    byCompany.get(row.company_id).push(row);
  });

  for (const [companyId, allSignals] of byCompany.entries()) {
    const existingProfile = profileByCompany.get(companyId) || {};
    const cutoff = existingProfile.last_summarized_at ? new Date(existingProfile.last_summarized_at) : null;
    const newSignals = cutoff ? allSignals.filter((s) => new Date(s.created_at) > cutoff) : allSignals;
    if (newSignals.length < MIN_NEW_SIGNALS) {
      results.push({ companyId, skipped: true, reason: 'not enough new signals', count: newSignals.length });
      continue;
    }

    try {
      const summary = await summarizeOneCompany(existingProfile, newSignals);
      const update = {
        company_id: companyId,
        last_summarized_at: new Date().toISOString(),
      };
      // status defaults to 'draft' on first insert (no profile existed
      // yet — a company with signals but no Phase 2 profile, e.g. one
      // onboarded before this feature existed). An existing row's status
      // ('draft' or admin-'confirmed') is left untouched either way —
      // this upsert never writes a status column at all, and Postgres
      // upsert-on-conflict only touches the columns listed here.
      if (summary) {
        update.hazard_emphasis = summary.hazardEmphasis;
        update.terminology_notes = summary.terminologyNotes || existingProfile.terminology_notes || '';
      }
      const { error: upsertErr } = await supabaseAdmin
        .from('company_profiles')
        .upsert(update, { onConflict: 'company_id' });
      results.push({ companyId, ok: !upsertErr, error: upsertErr?.message, signalsProcessed: newSignals.length });
    } catch (e) {
      console.error('Company brain summary failed for company', companyId, e.message);
      results.push({ companyId, ok: false, error: e.message });
    }
  }

  return { ok: true, processed: results.length, results };
}
