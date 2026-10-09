// src/flhaHazardAi.js
// The FLHA hazard generation rules, shared by the built-in FLHA (src/App.jsx)
// and the unified document engine's hazard table (src/documentEngine/). It was
// moved out of App.jsx unchanged: the SOP relevance filter, the prompt, the
// deterministic clean-up of what the model returns (hedges, ungrounded
// categories, guaranteed baseline hazards) and the edit-signal diff.
import { buildCompanyContextBlock } from "./companyProfile.js";

// ── SOP relevance pre-filter ──────────────────────────────
const SOP_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "is", "are", "be", "must", "will", "all", "at", "by", "as", "this",
  "that", "it", "should", "may", "not", "before", "after", "any", "into",
  "from", "must", "when", "each", "such", "their", "has", "have",
]);

// Common construction/safety word families that should count as the same
// concept even when the exact word differs (e.g. a task that says "digging
// a ditch" should match an SOP titled "Excavation Procedures").
const SOP_SYNONYM_GROUPS = [
  ["excavat", "trench", "dig", "ditch"],
  ["fenc", "barricad", "barrier"],
  ["fall", "height"],
  ["lockout", "tagout", "loto", "isolat", "energiz", "energis"],
  ["confined", "enclosed"],
  ["electric", "power", "wire", "cable"],
  ["traffic", "vehicle", "flagg", "roadway"],
  ["crane", "lift", "rig", "hoist", "sling"],
  ["manual", "handl", "ergonom"],
  ["weather", "environment", "cold", "heat", "rain"],
  ["scaffold", "ladder", "platform"],
  ["chemical", "hazmat", "spill"],
];
const SOP_SYNONYM_MAP = new Map();
SOP_SYNONYM_GROUPS.forEach((group, idx) => {
  group.forEach(term => SOP_SYNONYM_MAP.set(term, `syn${idx}`));
});

// Light stemmer so "digging"/"dig", "fencing"/"fence" and
// "excavation"/"excavating" line up without needing an exact word match.
function stem(word) {
  if (word.length > 6 && word.endsWith("ation")) return word.slice(0, -5);
  if (word.length > 6 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 5 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function canonicalize(word) {
  const stemmed = stem(word);
  for (const [term, tag] of SOP_SYNONYM_MAP) {
    if (word.startsWith(term) || stemmed.startsWith(term)) return tag;
  }
  return stemmed;
}

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(w => w.length > 2 && !SOP_STOPWORDS.has(w))
    .map(canonicalize);
}

function scorePolicyRelevance(policy, taskWordsSet) {
  const policyWords = tokenize(policy);
  let score = 0;
  policyWords.forEach(w => { if (taskWordsSet.has(w)) score += 1; });
  return score;
}

export function selectRelevantPolicies(policies, taskText, maxCount = 25) {
  if (!policies || policies.length <= maxCount) return policies || [];
  const taskWords = new Set(tokenize(taskText));
  const scored = policies.map((p, i) => ({ p, i, score: scorePolicyRelevance(p, taskWords) }));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, maxCount).sort((a, b) => a.i - b.i).map(s => s.p);
}

// ── Deterministic safety net for boilerplate hazards ──────
// The AI keeps re-adding certain SOP-driven hazard categories (working
// alone, weather, overhead/underground utilities) even when the prompt
// explicitly says not to, because those SOPs are sitting right there in
// its context. Prompt wording alone hasn't reliably stopped this, so
// strip these categories out after the fact unless the worker's own
// words actually indicate the condition — this can't be talked out of
// working by any amount of prompt tuning.
const UNGROUNDED_HAZARD_RULES = [
  {
    // \w* after a stem lets it match inflected forms ("isolation", "isolated")
    // — a bare \b right after the stem would block those, since the next
    // letter is still a word character and never counts as a boundary.
    textMatch: /\b(alone|isolat\w*|remote location|unsupervised)\b/i,
    taskMatch: /\b(alone|by myself|on my own|no one else|nobody else|unsupervised|remote site|remote location|no cell service|no signal|no radio)\b/i,
  },
  {
    textMatch: /\b(weather|rain\w*|wind\w*|lightning|storm\w*|snow\w*|heat\w*|cold\w*|temperature|low light)\b/i,
    taskMatch: /\b(rain\w*|wind\w*|storm\w*|lightning|snow\w*|hot out|cold\w*|heat wave|freezing|humid|weather|dark out|nighttime|after dark)\b/i,
  },
  {
    textMatch: /\boverhead (power |electrical )?lines?\b/i,
    taskMatch: /\b(overhead|power line|hydro line|electrical line|wire|wires|pole|poles|aerial|transmission line)\b/i,
  },
  {
    textMatch: /\b(underground utilit\w*|buried (pipe|cable|line)\w*|utility strike\w*)\b/i,
    taskMatch: /\b(underground|buried|utilit\w*|pipe\w*|cable\w*|gas line|water line|conduit|call.?before.?you.?dig)\b/i,
  },
];

function isUngroundedText(text, lowerTask) {
  return UNGROUNDED_HAZARD_RULES.some(
    rule => rule.textMatch.test(text || "") && !rule.taskMatch.test(lowerTask)
  );
}

export function stripUngroundedHazards(hazards, taskText) {
  const lowerTask = (taskText || "").toLowerCase();
  // Check the cited SOP text too, not just the hazard's own wording — the
  // model can reword a hazard to dodge these keywords while still citing
  // the exact same working-alone/weather/utility SOP as its justification.
  return (hazards || []).filter(h => !isUngroundedText(`${h.hazard || ""} ${h.control || ""} ${h.sopRef || ""}`, lowerTask));
}

export function stripUngroundedAlerts(alerts, taskText) {
  const lowerTask = (taskText || "").toLowerCase();
  return (alerts || []).filter(a => !isUngroundedText(a, lowerTask));
}

// General backstop, independent of topic: a hedge is the model's own tell
// that it isn't sure the condition applies, so the item shouldn't be in the
// output at all (only optionally as a note) — this catches SOPs the four
// named categories above don't, like "face shield if driving pins," without
// needing a new named category every time a new company SOP triggers it.
const HEDGE_PATTERN = /\(if [^)]*\)|\bif (present|any|applicable|performing|using|required|needed|it applies)\b|\bwhen (performing|using)\b|\bshould (it|they|this) (exist|apply|occur)\b/i;

export function stripHedged(items, getText) {
  return (items || []).filter(item => !HEDGE_PATTERN.test(getText(item) || ""));
}

// The model doesn't reliably include these baseline items on its own even
// when told to, so guarantee them here rather than relying on prompt
// compliance — same reasoning as the exclusion filters above, just for
// inclusion instead.
const BASELINE_HAZARD_CHECKS = [
  {
    present: /\b(fit(ness)? for duty|fatigue|impair(ed|ment)?)\b/i,
    hazard: {
      hazard: "Fitness for duty",
      risk: "Low",
      control: "Confirm fitness for duty before starting — well-rested, not under the influence of drugs or alcohol, and free of any illness or medication that could affect safe performance of this task. Do not begin work if fatigued, ill, or impaired.",
      sopRef: null,
    },
  },
  {
    present: /\b(muster point|emergency response|assembly point|evacuation (plan|route))\b/i,
    hazard: {
      hazard: "Muster point and emergency response plan awareness",
      risk: "Low",
      control: "Confirm the site's muster/assembly point and emergency response plan with the supervisor before starting work, confirm 911/emergency services availability, and ensure a working communication method (two-way radio, cell phone, or land line) is on hand.",
      sopRef: null,
    },
  },
];

export function ensureBaselineHazards(hazards, taskLabel) {
  const result = [...(hazards || [])];
  BASELINE_HAZARD_CHECKS.forEach(({ present, hazard }) => {
    const covered = result.some(h => present.test(`${h.hazard || ""} ${h.control || ""}`));
    if (!covered) result.push({ ...hazard, task: taskLabel });
  });
  return result;
}

// docs/scope-company-brain.md Phase 3 — diffs the AI-generated hazard
// baseline against what actually got submitted, keyed on hazard name
// (case-insensitive), so a company_signals row only gets written for a
// *substantive* edit: a hazard added, removed, or its risk level changed.
// Wording-only edits (e.g. a reworded control with the same hazard name
// and risk) are deliberately invisible to this diff — not a real signal.
// Returns null when there's nothing worth recording (no baseline to
// compare against, or no substantive difference), so the caller can skip
// sending anything to the server at all.
export function computeFlhaEditSignal(baseline, finalHazards) {
  if (!baseline || baseline.length === 0) return null;
  const norm = h => (h.hazard || "").trim().toLowerCase();
  const baseMap = new Map(baseline.filter(h => norm(h)).map(h => [norm(h), h.risk]));
  const finalMap = new Map((finalHazards || []).filter(h => norm(h)).map(h => [norm(h), h.risk]));

  const removed = [...baseMap.keys()].filter(k => !finalMap.has(k));
  const added = [...finalMap.keys()].filter(k => !baseMap.has(k));
  const riskChanged = [...baseMap.keys()]
    .filter(k => finalMap.has(k) && finalMap.get(k) !== baseMap.get(k))
    .map(k => ({ hazard: k, from: baseMap.get(k), to: finalMap.get(k) }));

  if (removed.length === 0 && added.length === 0 && riskChanged.length === 0) return null;
  return {
    added: added.slice(0, 20),
    removed: removed.slice(0, 20),
    riskChanged: riskChanged.slice(0, 20),
  };
}

/** The prompt sent to /api/generate-flha for one task description. */
export function buildHazardPrompt({ companyName, workerName, jobSite, cleanTranscript, relevantPolicies, companyProfile }) {
  return `You are an experienced field safety officer reviewing a worker's task description before they begin work. Your job is to identify ONLY the hazards that are genuinely relevant to what this specific worker has described — not a generic list.

Company: ${companyName}
Worker: ${workerName}
Job Site: ${jobSite}
Task Description: "${cleanTranscript}"

Company SOPs and Policies (pre-filtered to those most likely relevant to this task):
${relevantPolicies.map((p, i) => `${i + 1}. ${p}`).join("\n")}

INSTRUCTIONS:
- Read the task description carefully. Only flag hazards that are directly present or likely given what the worker described.
- Do NOT include generic hazards that have nothing to do with this task.
- If the worker mentions excavation, flag excavation hazards. If they don't mention heights, don't flag fall hazards.
- Do NOT confuse the "excavator" (a piece of equipment — same as a dozer, loader, or grader) with an "excavation" (a dug hole, trench, or pit with walls that could collapse). Operating an excavator to strip topsoil, grade, load material, or clean up spoil is SURFACE work, not excavation work, even though the machine's name contains "excavat-". Only cite excavation/trenching/shoring SOPs (cave-in, wall collapse, depth-based shoring requirements) when the task actually describes digging a hole, trench, or pit that a worker could fall into or that could collapse on someone — not merely because the machine operating is called an excavator.
- MANY company SOPs are phrased as a conditional procedure: "when doing X, do Y", "before X, confirm Y", "if performing X, wear/use Y". This is a GENERAL pattern, not specific to any one topic — it applies just as much to a pin-driving/hammer SOP or a hot-work SOP as it does to an overhead-power-line or underground-utility SOP. The fact that a conditional SOP appears in the pre-filtered list above does NOT mean its condition (X) is happening on this task. Before citing ANY such SOP — in a hazard's sopRef, in sopAlerts, or in ppeRequired — check: does the task description actually describe doing X? If not, the SOP is not triggered, full stop. This applies regardless of topic: overhead lines, underground utilities, hammer/punch/pin-driving, hot work, confined space, working at height, chemical handling, etc. — the topic doesn't matter, only whether the task actually describes that specific activity or condition.
  - If X isn't actually described in the task: do NOT add a hazard row for it, do NOT add it to sopAlerts, and do NOT add its associated gear to ppeRequired — not even in hedged/conditional form. Banned patterns anywhere in the output (hazard names, sopAlerts strings, ppeRequired items): "(if present)", "if any", "if applicable", "if performing", "if using", "when using", "should they exist" — a hedge is proof the condition isn't actually confirmed, which means it doesn't belong in the output at all, only optionally as one line in additionalNotes.
  - Example 1: task = "installing fencing around an excavated hole" with no mention of power lines. WRONG: a hazard row titled "Contact with overhead power lines (if present near hole)". RIGHT: no overhead-power-line hazard row, no sopAlerts entry for it.
  - Example 2: task = "operating an excavator to strip topsoil" with no mention of pins, hammers, punches, or repair work. WRONG: citing a "wear a face shield when driving pins with a hammer/punch" SOP in sopAlerts or adding "Face shield (if performing hydraulic pin-driving)" to ppeRequired. RIGHT: that SOP is not mentioned anywhere in the output, because nothing about pin-driving is happening on this task.
- For sopAlerts and sopRef, only cite a policy if it is SPECIFICALLY and clearly triggered by a concrete detail in the task description (a named piece of equipment, a specific hazard type, or a specific procedure) — not because it's broadly applicable to almost any task. Do NOT default to citing general catch-all policies (e.g. a blanket "PPE is mandatory" or "conduct an FLHA before starting" policy) as the reason for a hazard's control unless the hazard specifically calls for PPE or a procedure beyond the baseline. Every citation should feel like it was picked FOR this task, not reused from the last one.
- For ppeRequired, only list PPE actually needed for this specific task, using CSA-approved terminology where applicable (e.g. "CSA-approved eye protection", "CSA-approved foot protection", "CSA-approved head protection", "CSA-approved hearing protection", "CSA-approved respiratory protection", "High-visibility clothing") rather than generic brand-neutral phrasing.
- Use this standard hazard-category taxonomy as a scanning checklist so nothing gets missed — for each category below, ask whether it genuinely applies to this task per the inclusion tests further down, and include it if so (do not skip a category just because it's not the most dramatic one, but do not force an item that doesn't apply either):
  - Ergonomic: congested work area, parts of body in the line of fire, repetitive motion, over-extension, static work position, pinch points.
  - Environmental: housekeeping, dust/mist/fumes, extreme temperatures, other workers in the area, SDS/chemical safety review, biohazardous materials, communication, noise, weather conditions, working alone, unknown materials, wildlife, equipment or traffic in the area.
  - Access/egress: ladders, elevated work platforms, evacuation routes.
  - Overhead: harness/lanyard inspection, barricades and signage, falling objects, overhead utility lines.
  - Equipment: struck-by, mechanical failure, communication with equipment operators, cuts/abrasion/laceration, vehicle traffic, burns, fire, line-of-sight/visual contact, pinch points/crushing, mounting/dismounting, hot work.
  - Electrical: lockout/tagout, working on or near energized equipment, electrical cords/tools.
  This taxonomy is a memory aid for coverage, not a license to override the grounding rules above or below — the circumstantial categories (working alone, weather, overhead lines, underground utilities) still need an actual signal in the task description per the EXCEPTION rule below, and everything else still needs to pass test (a) or (b) below.
- Identify all hazards genuinely relevant to this task — aim for a THOROUGH assessment, typically 10-15 hazards, not a minimal one. A short list is not a sign of quality here; a real FLHA covers the whole workday around the task, including the routine Low-risk items, not just the one or two most dramatic risks. Low-risk hazards are just as important to document as High ones — do not trim them for brevity. A hazard belongs on the list if ANY of these is true:
  (a) It's inherent to the actual work, equipment, or environment described — a competent safety officer would expect it just from knowing what the worker is doing, even if the worker didn't use the specific word for it and even if no company SOP covers it. Example: a task description that says "operate an excavator and dozer" foreseeably involves restricted cab visibility/blind spots, 3-point contact when mounting/dismounting the machine, mechanical breakdown or hydraulic/fuel leaks and spill response, and working near other equipment or personnel on an active site — include hazards like these even with no matching SOP (sopRef: null is completely normal and expected for this kind of hazard — do not skip a real hazard just because you have nothing to cite).
  (b) It's tied to a specific circumstantial detail the worker actually described (a named piece of equipment, a specific procedure, a stated site condition).
  (c) It's a standard baseline hazard that belongs on virtually every field FLHA regardless of the specific task — worker fitness for duty (fatigue, illness, medication, impairment); awareness of the site's muster point and emergency response plan, including confirming 911/emergency services availability; and having a working communication method on hand (two-way radio, cell phone, or land line, whichever the task or site implies) are always worth including (typically Low risk) even when nothing in the task description calls them out specifically. Unlike (a) and (b), these don't need to be "inherent to the described work" — they're baseline readiness items for anyone on site.
  Do NOT pad the list with hazards that belong to a DIFFERENT kind of job than the one described (e.g. don't add fall-from-height hazards to ground-level work) just to hit a count. The test for (a)/(b) is "would this hazard actually occur doing the described work" — not "is there a literal keyword match in the task text," and not "is there an SOP to cite."
  - EXCEPTION — a few hazard categories depend on a circumstance that may or may not exist today, so they need an actual signal in the task description before you add them (a keyword match IS required here, unlike the general case above):
    - Do NOT add a "working alone" / isolation / communication-check hazard unless the task explicitly says the worker is alone, unsupervised, or in a remote/no-signal location. The mere absence of any mention of coworkers is NOT evidence of solo work.
    - Do NOT add a weather/environmental hazard unless the task explicitly mentions a weather, temperature, precipitation, wind, or lighting/visibility condition. "End of day" or a location name alone does not imply weather or darkness.
    - Do NOT add an overhead-power-line, underground-utility, or excavation-collapse hazard, or infer a hazard purely from the type of site named (e.g. "gas station," "roadway," "warehouse"), unless the task gives a concrete indication of that specific condition — see the rules above.
- Risk levels — rate the RESIDUAL risk (the risk that REMAINS after accounting for the safeguards and controls the worker has already described). Apply STRICTLY:
  - CRITICAL RULE: If the worker has described a control that properly manages a hazard (e.g. "using a trench box" for excavation collapse, "locked out the equipment" for energized machinery, "using a fall arrest harness" for heights), then the residual risk is REDUCED — usually to High or Medium — NOT Extreme. A well-controlled hazard is not Extreme.
  - "Extreme" = even WITH normal controls in place, a single mistake or equipment failure could realistically be CATASTROPHIC or FATAL, with almost no margin for error. Reserve ONLY for inherently life-threatening work where the danger persists despite safeguards: working on an energized high-voltage source, entry into a confined space with a hazardous atmosphere, work on a LIVE (un-isolated) pressurized water/gas main, a critical/complex crane lift over people, or hot work in a confirmed explosive atmosphere. Extreme is rare. If a proper safeguard is described, it is almost never Extreme.
  - "High" = could cause serious injury or death, but is either routine work or a serious hazard that is being actively controlled by the worker's described safeguards (e.g. excavation collapse WITH a trench box, work at height WITH fall protection). This is where most managed high-risk work lands.
  - "Medium" = could cause injury.
  - "Low" = minor risk.
- Read the task description for controls the worker already mentioned, and lower the risk accordingly. Do not rate the raw hazard — rate what could still realistically happen given their approach.
- If a hazard is already well-controlled by the worker's described approach, rate it Lower.
${buildCompanyContextBlock(companyProfile, { includeHazardEmphasis: true })}
Respond ONLY with a valid JSON object (no markdown, no backticks):
{
  "taskSummary": "one sentence summary of what the worker is doing",
  "hazards": [
    { "hazard": "specific hazard name", "risk": "Low|Medium|High|Extreme", "control": "specific control measure for this task", "sopRef": "exact SOP text this references, or null" }
  ],
  "sopAlerts": ["only SOPs specifically triggered by this task"],
  "ppeRequired": ["only PPE needed for this specific task"],
  "additionalNotes": "any task-specific safety notes the worker should know, or null"
}`;
}

/**
 * Turns the model's text into hazards the way the FLHA always has: pull out
 * the JSON, drop hedged and ungrounded items, tag each hazard with its task.
 * Throws on a response with no JSON. Returns { parsed, tagged, groundedAlerts, groundedPPE }.
 */
export function parseHazardResponse(text, cleanTranscript, taskLabel) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("Invalid response format");
  }
  const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
  const unhedgedHazards = stripHedged(parsed.hazards, h => `${h.hazard || ""} ${h.control || ""}`);
  const groundedHazards = stripUngroundedHazards(unhedgedHazards, cleanTranscript);
  const tagged = groundedHazards.map(h => ({ ...h, task: parsed.taskSummary || taskLabel }));
  const groundedAlerts = stripUngroundedAlerts(stripHedged(parsed.sopAlerts, a => a), cleanTranscript);
  const groundedPPE = stripHedged(parsed.ppeRequired, p => p);
  return { parsed, tagged, groundedAlerts, groundedPPE };
}
