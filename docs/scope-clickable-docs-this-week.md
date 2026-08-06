# Scope: clickable "Docs This Week" stat

Status: scoped, not built. Picked from `TODO.md` as the most self-contained item on the list.

## Current state

The stat already exists — `src/Dashboard.jsx:1633-1636` computes it, `2212-2215` renders it:

```js
const startOfWeek = (() => { const d = new Date(); const day = d.getDay(); d.setDate(d.getDate() - day); d.setHours(0, 0, 0, 0); return d; })();
const docsThisWeek = [
  ...companyFlhas, ...companyInspections, ...companyToolbox, ...companyNearMisses, ...companyIncidents, ...companyDaily, ...companyMonthlyRecords,
].filter(x => x.created_at && new Date(x.created_at) >= startOfWeek).length;
```

It's one of four stat cards in a 2×2 grid. The other three (Awaiting Sign-Off, Needs Review, Open Corrective Actions) are already clickable — each jumps to a document-type tab via `setActiveTab(...)`. "Docs This Week" is the only one of the four with no `onClick`.

Two things worth fixing while this gets built, not just the click behavior:

- **`customDocRecords` (custom form submissions) aren't in the sum.** Every other document type is included; custom forms are silently left out. Looks like an oversight rather than intentional — flagging for a decision, not assuming the fix.
- **The count isn't kept as a list anywhere**, only a `.length`. A drill-down needs the actual filtered array, which is a trivial change (keep the array, compute `.length` from it) but touches the same lines.

## Why "jump to a tab" (the existing pattern) doesn't fit

The other three stats each resolve to *one* document type, so "jump to that tab" is a clean answer. "Docs This Week" is a cross-type aggregate — FLHAs, inspections, toolbox talks, near-misses, incidents, daily reports, and monthly records all mixed together, sorted by nothing in particular right now. There's no single tab to jump to.

## Proposed approach

Add a dedicated "This Week's Documents" modal, opened by clicking the stat card:

- Reuse the existing fixed-overlay modal shell already used 10× in this file (one per document-type detail card, e.g. `FLHACard`, `InspectionCard` — same `position: fixed; inset: 0; background: #00000080` wrapper each already uses).
- List rows sorted by `created_at` descending, each showing document type + a short label (worker/site/whatever that type's list rows already show) + date.
- Clicking a row closes the "this week" modal and opens that document's own existing detail modal (`setSelectedFlha`, `setSelectedInspection`, etc. — all already wired up, just need to be called from here too).

This is additive: no changes to the 8 existing per-type detail modals, no changes to how tabs work. The new piece is one modal component plus the list-building logic (which is most of the existing `docsThisWeek` computation, just kept as an array instead of reduced to a count).

## Open questions to settle before building

1. **Include custom form submissions in the count?** Recommend yes (matches every other type), but confirm — could be deliberate if custom forms are meant to be excluded for some reason.
2. **Does the drill-down need search/filter, or is a flat chronological list enough?** The per-type tabs all have search + sort; a first pass probably doesn't need that for a "this week" scope (small dataset by definition), but worth confirming before deciding not to build it.
3. **Row label per type** — each document type's existing tab row shows different fields (worker name for FLHAs, equipment label for inspections, etc.). Needs a small per-type "what to show in a compact row" mapping; existing tab rows are the reference for what fields matter per type.

## Out of scope for this pass

- Changing what counts as "this week" (Sunday-start local time, matches the existing computation).
- Any change to the other three stat cards.
- A standalone "Activity" tab or anything beyond the one modal.

## Rough size

Small-to-medium. One new modal component, a handful of lines changing `docsThisWeek` from `.length` to a kept array, and wiring the `onClick`. No schema or API changes — everything needed is already loaded client-side in the dashboard's mount effect.
