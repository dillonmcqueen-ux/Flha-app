// Pure part of the hazard assist on a hazard_table field with config.aiAssist
// (the FLHA template). Given the AI's cleaned-up answer, works out which form
// fields change. The prompt, the clean-up rules and the baseline hazards are
// the FLHA's own (src/flhaHazardAi.js); this only decides where the results go.

import { ensureBaselineHazards } from '../flhaHazardAi.js';

const uniq = (list) => [...new Set(list.filter(Boolean))];
const asList = (v) => (Array.isArray(v) ? v : []);

/**
 * result: { parsed, tagged, groundedAlerts, groundedPPE } from parseHazardResponse.
 * cfg: the field's config.aiAssist { taskField, alertsField, ppeField, notesField, flagField }.
 * answers: the form's current answers. addingTask: true to add to what is there
 * (a second task on the same FLHA) instead of starting over.
 * Returns { patch, baseline } where patch is { fieldKey: newValue } and baseline
 * is the AI's hazards as generated (hazard and risk) for the edit signal.
 */
export function applyAiResult({ result, cfg, hazardKey, answers, taskLabel, addingTask = false }) {
  const { parsed, tagged, groundedAlerts, groundedPPE } = result;
  const patch = {};
  const existing = asList(answers[hazardKey]).filter((r) => r && String(r.hazard || '').trim());
  let hazards;
  if (addingTask && existing.length > 0) {
    const old = existing.map((h) => (h.task ? h : { ...h, task: answers[cfg.taskField] || 'Task 1' }));
    hazards = [...old, ...tagged];
    patch[hazardKey] = hazards;
    if (cfg.ppeField) patch[cfg.ppeField] = uniq([...asList(answers[cfg.ppeField]), ...groundedPPE]);
    if (cfg.alertsField) patch[cfg.alertsField] = uniq([...asList(answers[cfg.alertsField]), ...groundedAlerts]);
  } else {
    hazards = ensureBaselineHazards(tagged, parsed.taskSummary || taskLabel);
    patch[hazardKey] = hazards;
    if (cfg.taskField) patch[cfg.taskField] = parsed.taskSummary || taskLabel;
    if (cfg.ppeField) patch[cfg.ppeField] = groundedPPE;
    if (cfg.alertsField) patch[cfg.alertsField] = groundedAlerts;
    if (cfg.notesField && parsed.additionalNotes) patch[cfg.notesField] = String(parsed.additionalNotes);
  }
  if (cfg.flagField) patch[cfg.flagField] = 'yes';
  return { patch, baseline: tagged.map((h) => ({ hazard: h.hazard, risk: h.risk })) };
}

/** What the form fills in when the worker carries on without the AI: their own words, no hazards, flagged not-AI. */
export function withoutAiPatch({ cfg, description }) {
  const patch = {};
  if (cfg.taskField) patch[cfg.taskField] = String(description || '').trim();
  if (cfg.flagField) patch[cfg.flagField] = 'no';
  return patch;
}
