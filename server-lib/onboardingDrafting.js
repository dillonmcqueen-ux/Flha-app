// server-lib/onboardingDrafting.js
// AI-assisted drafting for the onboarding claim-link flow: turns an
// onboarding request's free-text units_list into a structured, editable
// equipment draft, and the uploaded SOP files into a draft policy list.
// Neither ever writes to the real `equipment` or `sops` tables directly —
// both are staged as JSON on the onboarding_requests row and only become
// real rows once the company's own contact confirms them on the claim-link
// page (see the claim_confirm_equipment / claim_confirm_sops actions in
// api/login.js).
//
// Deliberately NOT called synchronously from submit_onboarding_intake or
// approve_onboarding_request — neither of those functions has a
// maxDuration override in vercel.json (Vercel Hobby's ~10s default
// applies), and an LLM call over several uploaded files risks blowing that
// budget on top of the DB writes those two functions already have to do.
// Instead this is called two ways, both best-effort:
//   1. Fire-and-forget right after approve_onboarding_request creates the
//      company (not awaited — see the comment there), so it's usually
//      already done by the time the contact opens their claim-link email.
//   2. A bounded fallback inside claim_get_details if it hasn't finished
//      yet by the time the claim page loads.
// If it fails or times out either way, draft_status stays/becomes
// 'failed' or 'none' and the claim page simply has nothing to show —
// the raw SOP files stay attached to the request exactly as before, and
// equipment can still be added by hand later. Nothing here ever blocks
// account creation or credential delivery.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

// Small, fast, cheap model + short prompts + capped inputs everywhere in
// this file — this is meant to fit inside a single ~10s Hobby invocation,
// not to be a thorough document-processing pipeline.
const MAX_SOP_FILES = 4;
const MAX_FILE_BYTES = 6 * 1024 * 1024; // 6MB — comfortably under Anthropic's per-doc limit
const SUPPORTED_SOP_EXT = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain' };

async function callAnthropic(content, maxTokens) {
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
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json();
  return data?.content?.[0]?.text || '';
}

function extractJson(text) {
  if (!text) return null;
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    return null;
  }
}

// units_list free text -> [{ year, make, model, unitNumber }]. A submitter
// might write "2005 John Deere 624H Loader — Unit 4" on one line, or a
// messier multi-line description — the LLM's job is exactly the "too easy
// to mis-parse from free text" gap the old comment in api/admin.js called
// out; the claim page's confirm-before-save step is what makes that safe.
export async function draftEquipment(unitsList) {
  const text = (unitsList || '').trim();
  if (!text) return [];
  const prompt = [
    'Parse this free-text list of vehicles/equipment into a JSON array.',
    'Each item: {"year": string, "make": string, "model": string, "unitNumber": string}.',
    'Use "" for any field you cannot determine. One array item per distinct piece of equipment.',
    'Respond with ONLY the JSON array, no other text.',
    '',
    'List:',
    text.slice(0, 4000),
  ].join('\n');
  const raw = await callAnthropic(prompt, 2000);
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((r) => r && typeof r === 'object')
    .slice(0, 100)
    .map((r) => ({
      year: String(r.year || '').slice(0, 20),
      make: String(r.make || '').slice(0, 100),
      model: String(r.model || '').slice(0, 100),
      unitNumber: String(r.unitNumber || '').slice(0, 50),
    }));
}

async function downloadFileAsBase64(supabaseAdmin, path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const mediaType = SUPPORTED_SOP_EXT[ext];
  if (!mediaType) return null; // unsupported (e.g. .doc/.docx) — skip, leave as raw attachment
  const { data, error } = await supabaseAdmin.storage.from('onboarding-uploads').download(path);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_FILE_BYTES) return null;
  return { mediaType, base64: buf.toString('base64'), isText: ext === 'txt' };
}

// Downloads up to MAX_SOP_FILES uploaded SOP files and asks the model to
// extract distinct, workable safety-policy statements from them — the
// same shape as api/companydata.js's `sops.policy_text` rows, so the
// claim page's confirm step can insert them verbatim.
export async function draftSops(supabaseAdmin, sopFilePaths) {
  const paths = (sopFilePaths || []).slice(0, MAX_SOP_FILES);
  if (paths.length === 0) return [];

  const blocks = [];
  for (const path of paths) {
    const file = await downloadFileAsBase64(supabaseAdmin, path);
    if (!file) continue; // unsupported/too large/missing — skipped, not fatal
    if (file.isText) {
      blocks.push({ type: 'text', text: Buffer.from(file.base64, 'base64').toString('utf8').slice(0, 6000) });
    } else if (file.mediaType === 'application/pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: file.mediaType, data: file.base64 } });
    } else {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.base64 } });
    }
  }
  if (blocks.length === 0) return [];

  blocks.push({
    type: 'text',
    text: [
      '',
      'The documents above are a company\'s safety SOPs/policies, however messy.',
      'Extract each distinct policy as a short, clear, standalone statement a field',
      'worker could follow (not a summary of the whole document).',
      'Respond with ONLY a JSON array of strings, no other text.',
    ].join('\n'),
  });

  const raw = await callAnthropic(blocks, 3000);
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((s) => typeof s === 'string' && s.trim())
    .slice(0, 60)
    .map((s) => s.trim().slice(0, 2000));
}

// Orchestrates both drafts for one onboarding request and persists the
// result. Never throws — every failure mode ends in a written
// draft_status so the claim page always has something definite to render
// instead of hanging.
export async function runOnboardingDrafts(supabaseAdmin, request) {
  const updates = { draft_status: 'ready' };
  try {
    updates.equipment_draft = await draftEquipment(request.units_list);
  } catch (e) {
    console.error('Equipment draft failed for onboarding request', request.id, e.message);
    updates.equipment_draft = [];
  }
  try {
    updates.sop_drafts = await draftSops(supabaseAdmin, request.sop_file_paths);
  } catch (e) {
    console.error('SOP draft failed for onboarding request', request.id, e.message);
    updates.sop_drafts = [];
  }
  if (!process.env.ANTHROPIC_API_KEY) updates.draft_status = 'none';

  await supabaseAdmin.from('onboarding_requests').update(updates).eq('id', request.id);
  return updates;
}
