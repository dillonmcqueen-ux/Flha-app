// server-lib/aiEditSignal.js
// The "how the worker changed the AI's hazards" signal the FLHA sends with a
// submit (docs/scope-company-brain.md Phase 3). The client computes it
// (src/flhaHazardAi.js computeFlhaEditSignal); the server only keeps a bounded,
// string-only copy. Shared by api/flhas.js and the document engine so the two
// cannot drift. Returns null when there is nothing worth recording.
export function sanitizeAiEditSignal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const strList = (arr) => (Array.isArray(arr) ? arr : [])
    .filter((v) => typeof v === 'string' && v.trim())
    .slice(0, 20)
    .map((v) => v.trim().slice(0, 200));
  const riskChanged = (Array.isArray(raw.riskChanged) ? raw.riskChanged : [])
    .filter((r) => r && typeof r === 'object' && typeof r.hazard === 'string')
    .slice(0, 20)
    .map((r) => ({
      hazard: r.hazard.trim().slice(0, 200),
      from: typeof r.from === 'string' ? r.from.slice(0, 20) : null,
      to: typeof r.to === 'string' ? r.to.slice(0, 20) : null,
    }));
  const added = strList(raw.added);
  const removed = strList(raw.removed);
  if (added.length === 0 && removed.length === 0 && riskChanged.length === 0) return null;
  return { added, removed, riskChanged };
}
