// server-lib/inspectionAttachments.js
// One reader for "what was hooked to this machine on this trip".
//
// The shape changed once, and both spellings are live at the same time:
//
//   * `results_json.attachedTrailer` — { id, label } or null. Written by
//     every inspection submitted before attachments became a flag on the
//     fleet row (equipment.is_attachment). Those records are signed safety
//     documents that get re-read, re-rendered and re-reported for years, so
//     this is not a shape that can be migrated away by rewriting rows.
//
//   * `results_json.attachments` — [{ id, label }]. Written from the point
//     a machine can carry more than one attachment: a loader with a bucket
//     and a set of forks, a truck with a pup and a trailer.
//
// Every consumer that needs the answer calls this instead of reaching into
// results_json itself, because the failure mode of getting it wrong is
// silent: a defect lands on the wrong machine, or a towed unit's hours
// quietly read zero forever. results_json is free-form client jsonb
// (api/logs.js whitelists the COLUMN, never its contents), so nothing in
// here may assume a type it has not checked.
//
// IMPORTANT: this file is imported by the BROWSER bundle as well as by
// api/ — src/generateInspectionPDF.js pulls it in so the PDF and the weekly
// report answer this question identically. It must therefore stay
// dependency-free: no imports, no `process.env`, no node builtins. Adding
// any of those (the way server-lib/uploadUrls.js uses crypto and
// SESSION_SECRET) would not fail the build — it would throw at runtime,
// when a worker taps Submit at the end of a shift and gets no document.

/**
 * Normalises either shape to an array of { id, label }. Entries without a
 * label are dropped — a label is the minimum needed to name a machine on a
 * report, and an id alone can be a stale or foreign number.
 *
 * `attachments` wins when present, including when it is an empty array:
 * a record written by the new client that says "nothing attached" means it.
 */
export function inspectionAttachments(resultsJson) {
  if (!resultsJson || typeof resultsJson !== 'object') return [];
  if (Array.isArray(resultsJson.attachments)) {
    return resultsJson.attachments.filter(a => a && typeof a === 'object' && a.label);
  }
  const legacy = resultsJson.attachedTrailer;
  if (legacy && typeof legacy === 'object' && legacy.label) return [legacy];
  return [];
}

/**
 * Which attachment a checklist item belongs to, or null for an item that
 * belongs to the machine itself.
 *
 * Items carry `unit`: 'truck' for the machine, 'trailer' on legacy records,
 * 'attachment' on new ones. Matching goes by id first and label second,
 * for the same reason the weekly report groups by id first: two machines
 * can share a label, and only one of them broke.
 */
export function attachmentForItem(item, attachments) {
  if (!item || !Array.isArray(attachments) || attachments.length === 0) return null;
  if (item.unit !== 'trailer' && item.unit !== 'attachment') return null;
  if (item.attachmentId != null) {
    const byId = attachments.find(a => a.id != null && String(a.id) === String(item.attachmentId));
    if (byId) return byId;
  }
  if (item.unitLabel) {
    const byLabel = attachments.find(a => a.label === item.unitLabel);
    if (byLabel) return byLabel;
  }
  // A legacy record has exactly one attachment and tags its items only
  // `unit: 'trailer'`, with no id to match on — that one is unambiguous.
  return attachments.length === 1 ? attachments[0] : null;
}
