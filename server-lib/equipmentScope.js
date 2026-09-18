// server-lib/equipmentScope.js
// One place to validate a client-supplied equipment_id, the companion to
// server-lib/siteScope.js and with deliberately identical semantics.
//
// api/fuellogs.js already carried this guard inline, with a comment
// explaining exactly why it exists. api/logs.js's inspection submit never
// got it, even though `equipment_id` has been in SUBMITTABLE_FIELDS.inspection
// the whole time — so a worker could file their own company's inspection
// against another company's machine. Nothing read that column until break
// #7 in docs/feature-interaction-map.md made it the grouping key for weekly
// equipment reports, which is what turned a dormant inconsistency into a
// column the product actually depends on.
//
// Rather than copy the fuel-log guard into a second handler and let the two
// drift, both now call this.

/**
 * Returns the equipment's own id when it belongs to `companyId`, `null`
 * when there is nothing to link, or `false` when it belongs to another
 * company. A caller treats `false` as a 403 and `null` as "no fleet
 * machine" — legitimate, because every form that offers a fleet dropdown
 * also offers a free-text "not in the list" path that stores only the
 * label.
 *
 * An id that does not exist returns `null`, NOT `false`. That distinction
 * is load-bearing, for the same reason it is in siteScope.js:
 * src/offlineQueue.js's drainQueue marks an attempt and `break`s on any
 * throw, with no attempt cap and no drop path, so a submission that can
 * never succeed is retried forever AND blocks every later submission of
 * that form type behind it. Both callers here are offline-queued
 * (src/Inspection.jsx:389, src/FuelLog.jsx:164) and api/companydata.js's
 * delete_equipment really does remove fleet rows, so "worker inspects a
 * machine offline, admin retires that machine, worker's queue silently
 * stops draining" is a live scenario rather than a hypothetical.
 *
 * A stale or guessed id therefore stores a label-only record — what the
 * free-text path already does — while a genuine cross-tenant attempt still
 * 403s, keeping that tripwire for a real client bug or a probe. The cost is
 * a narrow enumeration signal: a caller learns whether some equipment id
 * exists, and nothing about what or whose it is.
 */
export async function resolveEquipmentId(supabaseAdmin, companyId, rawEquipmentId) {
  if (rawEquipmentId === undefined || rawEquipmentId === null || rawEquipmentId === '') return null;
  const { data: rows, error } = await supabaseAdmin
    .from('equipment')
    .select('id, company_id')
    .eq('id', rawEquipmentId)
    .limit(1);
  // A database error must not be read as "wrong company". Fail toward the
  // label-only record rather than 403ing a worker over an outage — and, per
  // the note above, rather than wedging their queue over one.
  if (error) return null;
  if (!rows || rows.length === 0) return null;
  if (rows[0].company_id !== companyId) return false;
  // The row's own id, not the caller's value, so no coercion surprise can
  // survive the round trip.
  return rows[0].id;
}

/**
 * An index of the company's own equipment, keyed by `String(id)` so a
 * lookup can't miss on type alone, with each entry's value the fleet row's
 * OWN id — the same discipline as resolveEquipmentId returning `rows[0].id`
 * rather than the caller's value.
 *
 * That matters here because one of the ids being checked arrives from
 * client JSON (`results_json.attachedTrailer.id`) and has round-tripped
 * through jsonb. The code this replaces keyed on `` `eq:${id}` ``, which
 * string-coerced, so a plain Set of numbers would have quietly stopped
 * matching a string id and dropped a legitimate trailer back to label
 * grouping — a regression with no error and no failing test.
 *
 * Returns `null` (not an empty Map) when the fleet can't be loaded, so a
 * caller can tell "this company owns nothing" — a real answer, and a real
 * state for a company that has added no equipment — from "I don't know".
 * The two must not collapse: treating an unreadable fleet as an empty one
 * would quietly strip every legitimate id off a week of inspections and
 * write the result to a stored report.
 */
export async function companyEquipmentIndex(supabaseAdmin, companyId) {
  const { data: rows, error } = await supabaseAdmin
    .from('equipment')
    .select('id')
    .eq('company_id', companyId);
  if (error || !rows) return null;
  return new Map(rows.map(r => [String(r.id), r.id]));
}

/**
 * The array form, for a record that names SEVERAL machines — a daily report
 * lists everything that was on site that day, not one unit.
 *
 * Semantics are deliberately identical to `resolveEquipmentId` above,
 * because the failure modes are the same and a second set of rules here
 * would be a second set of bugs: an id belonging to another company returns
 * `false` (the caller 403s, keeping the cross-tenant tripwire), an id that
 * simply does not exist is DROPPED rather than rejected (so a machine
 * retired while a worker's report sat in the offline queue can't wedge that
 * queue forever — see the note above), and what survives is the fleet row's
 * OWN id rather than the value that arrived.
 *
 * Returns `null` for "nothing to link", matching the single-id form, so a
 * report submitted with an empty list stores null instead of `[]` — one
 * spelling of "no machines", not two.
 *
 * Capped at 50 ids: a daily report naming more machines than that is a
 * malformed or hostile payload, not a jobsite. Over the cap the whole list
 * is REJECTED rather than truncated — truncating would drop ids before the
 * ownership loop below ever sees them, which means padding the array past
 * 50 would silence the cross-tenant 403 this function exists to raise.
 *
 * Anything that is not a plain integer id is dropped BEFORE the query, per
 * id, rather than being sent and allowed to fail the batch. `.in()` on a
 * bigint column 400s on a value it cannot coerce, and a single `"none"`
 * from a client bug would otherwise take every legitimately-picked machine
 * on that report down with it — silently, since the fallback is a
 * label-only record with no error anywhere.
 */
export async function resolveEquipmentIds(supabaseAdmin, companyId, rawIds) {
  if (!Array.isArray(rawIds) || rawIds.length === 0) return null;
  if (rawIds.length > 50) return false;

  const wanted = [];
  const seen = new Set();
  for (const raw of rawIds) {
    if (raw === undefined || raw === null || raw === '') continue;
    const key = String(raw).trim();
    if (!/^\d+$/.test(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push(key);
  }
  if (wanted.length === 0) return null;

  const { data: rows, error } = await supabaseAdmin
    .from('equipment')
    .select('id, company_id')
    .in('id', wanted);
  // Fail toward the label-only record rather than 403ing a worker over an
  // outage, and rather than wedging their offline queue over one.
  if (error || !rows) return null;

  const byId = new Map(rows.map(r => [String(r.id), r]));
  const resolved = [];
  for (const key of wanted) {
    const row = byId.get(key);
    if (!row) continue;
    if (row.company_id !== companyId) return false;
    resolved.push(row.id);
  }
  return resolved.length > 0 ? resolved : null;
}
