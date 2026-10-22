// src/inbox.js
// Pure rules for the inbox on the worker home screen and the supervisor
// Overview. Each screen builds a flat list of items from data it already
// loads; this file only decides what needs action, what is done, and the
// order. No React, so it can be unit tested (tests/unit/inbox.test.js).
//
// An item: { key, title, subtitle, status, dueAt?, doneAt?, ... }
//   status "overdue" | "open"  -> needs action (or review, for a supervisor)
//   status "done"              -> completed
// Anything else on the item (icon, accent, onOpen) is passed through.

export const DONE_LIMIT = 30;

const rank = (item) => (item.status === "overdue" ? 0 : item.dueAt ? 1 : 2);
const time = (iso, fallback) => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : fallback;
};

/** Split into { needs, done }: overdue first, then soonest due, then the rest;
 *  completed newest first, capped so the page stays short. */
export function splitInbox(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const needs = list
    .filter((i) => i.status !== "done")
    .sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return time(a.dueAt, Infinity) - time(b.dueAt, Infinity);
    });
  const done = list
    .filter((i) => i.status === "done")
    .sort((a, b) => time(b.doneAt, 0) - time(a.doneAt, 0))
    .slice(0, DONE_LIMIT);
  return { needs, done };
}

/** One row per send for the sender's tracking view: a batch is "done" when
 *  every recipient has finished it. Cancelled rows are ignored. Pure. */
export function summariseSentBatches(rows) {
  const batches = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.displayStatus === "cancelled") continue;
    const id = r.batch_id || `single-${r.id}`;
    const b = batches.get(id) || { id, title: r.title, mode: r.mode, total: 0, finished: 0, overdue: 0, createdAt: r.created_at, dueAt: r.due_at, lastDoneAt: null };
    b.total += 1;
    if (r.displayStatus === "completed") {
      b.finished += 1;
      if (!b.lastDoneAt || time(r.completed_at, 0) > time(b.lastDoneAt, 0)) b.lastDoneAt = r.completed_at;
    } else if (r.displayStatus === "overdue") {
      b.overdue += 1;
    }
    batches.set(id, b);
  }
  return [...batches.values()].map((b) => ({
    ...b,
    outstanding: b.total - b.finished,
    status: b.finished === b.total ? "done" : b.overdue > 0 ? "overdue" : "open",
  }));
}

/** "3 of 8 still to sign, 2 overdue" for a batch from summariseSentBatches. */
export function describeBatch(b) {
  if (b.status === "done") return `All ${b.total} ${b.mode === "sign" ? "signed" : "read"}`;
  const verb = b.mode === "sign" ? "to sign" : "to read";
  return `${b.outstanding} of ${b.total} still ${verb}${b.overdue > 0 ? `, ${b.overdue} overdue` : ""}`;
}
