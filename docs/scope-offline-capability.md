# Scope: offline capability

Status: scoped, not built. Picked from `TODO.md`'s "Offline capability or a
backup plan" item — see `docs/competitive-notes.md` for why this is the
highest-leverage gap to close (it's the single most-cited complaint about
SiteDocs-category tools, and FORA currently has nothing here at all, not
even a degraded fallback).

## Current state

Confirmed by reading the actual submission path, not assumed:

- **No offline handling exists anywhere.** Zero references to service
  workers, IndexedDB, `navigator.onLine`, or a web app manifest in `src/`
  or `api/`. There's also no `manifest.json` or `sw.js`.
- **The session token is not persisted client-side.** `src/Login.jsx` keeps
  `session` (which carries `token`) in a plain `useState` — no
  `localStorage`/`sessionStorage` write anywhere in `src/`. A hard refresh
  or an OS-killed backgrounded tab currently logs the user all the way back
  out to the login screen, and login itself requires a live network call
  (`api/login.js`). This matters a lot for offline: the token itself is
  valid for 7 days once issued (`SESSION_TTL_MS` in `api/flhas.js` and the
  other `api/*.js` files), but nothing today keeps it around past a page
  reload for the app to use it.
- **Every write goes through a fetch() to an `api/*.js` action-dispatcher**
  (e.g. `src/NearMiss.jsx` → `fetch("/api/reports", { body: JSON.stringify({
  action: "submit", token, ... }) })`), never a direct Supabase call from
  the browser — RLS is deny-by-default and the anon key has no table access
  (`README.md`). Any offline design has to replay through these same
  endpoints; it can't bypass them.
- **File uploads are a two-step, network-dependent flow.**
  `src/uploadViaSignedUrl.js`: ask the relevant `api/*.js` endpoint for a
  short-lived signed upload token, then upload the blob straight to
  Supabase Storage with that token. There's no offline story for this today
  — the signed token has to be minted live.
- **Most worker-facing forms call `/api/generate-flha` mid-flow, not just
  FLHA.** `AdminPanel.jsx`, `CustomForm.jsx`, `DailyReport.jsx`,
  `Incident.jsx`, `MonthlyInspection.jsx`, `NearMiss.jsx`, and
  `ToolboxTalk.jsx` all call it too (AI hazard/content assistance), so "the
  form needs network" isn't just true at final submit — it's true
  mid-fill on almost every document type. `README.md` already documents one
  seam for this: locally, if that endpoint isn't reachable, the app "falls
  back to demo hazard data" — that fallback exists today only as a
  local-dev convenience, not a real offline path, but it's the right seam
  to extend.
- **No submission is idempotent.** Checked `api/flhas.js`'s `submit`
  action: a fresh submission is a plain `.insert(...).select('id')` with no
  client-supplied identifier and no unique constraint to dedupe against. If
  a queued-and-replayed submission's response gets lost after the insert
  actually succeeded, retrying it today would create a duplicate record.
  This has to be fixed as part of building a queue, not after.
- **Vercel Hobby plan is already at the 12/12 serverless function cap**
  (per `.claude/agents/vercel-function-budget-guardian.md`). This plan adds
  zero new `api/` files — offline just means queuing and replaying calls to
  the endpoints that already exist.

## Why this, and why now

This is FORA's biggest structural gap against the SiteDocs-category bar,
and closing it well (not just "eventually") is the highest-leverage single
investment available right now — see `docs/competitive-notes.md`'s pros/
cons mapping. The upside of doing this as a solo operator: no offline sync
engine has shipped yet, so there's no legacy behavior to preserve — this
can be designed correctly the first time instead of retrofitted around
existing assumptions, which is exactly the trap the incumbents are stuck
in (their sync bugs are the #1 recurring complaint precisely because they
bolted this on late).

## Proposed approach: phased, cheapest-and-highest-value first

No new paid infrastructure at any phase — everything below is
browser-native (IndexedDB, the Cache API, service workers) or reuses
existing `api/*.js` endpoints. Costs nothing but engineering time, which
fits a one-person budget.

### Phase 0 — session persistence + local draft autosave

The prerequisite for everything else, and a real win on its own even if
nothing past this phase ships:

- Persist `session` (including `token`) to `localStorage` on login in
  `src/Login.jsx`, restore it on mount instead of always rendering the
  login screen first. Clear it on explicit logout and on a 7-day-expired
  token (matches the existing server-side `SESSION_TTL_MS`).
- Autosave in-progress form state (FLHA, Inspection, NearMiss, etc.) to
  `localStorage` keyed by session + form type, on a debounce, independent
  of whether the final submit succeeds. Restore it if the component
  remounts (crash, accidental navigation, connection drop mid-fill).
- This alone fixes "worker loses 20 minutes of typed-in hazard data because
  signal dropped" — the single most painful version of the offline problem
  — without needing a queue, a service worker, or any sync logic at all.

**This phase should ship first and alone if nothing else does.** It's the
best value-per-effort item in this whole plan.

### Phase 1 — submission queue for text-only forms

- Add a `client_submission_id` (UUID, generated in the browser) to every
  form's submit payload. On the server side, add a matching unique column
  per table (`flhas`, `toolbox_talks`, `near_misses`, etc.) and switch the
  insert to `upsert(..., { onConflict: 'client_submission_id',
  ignoreDuplicates: true })` or an equivalent existence check — this closes
  the idempotency gap found above and makes retries safe.
- Build a small IndexedDB-backed queue: on submit, if `navigator.onLine` is
  false or the fetch throws/times out, write the full request payload to
  the queue instead of failing. Listen for the browser's `online` event and
  a periodic retry timer to drain the queue in order, with exponential
  backoff per item.
- Surface queue state in the UI — a worker needs to see "saved, will send
  when back online" vs. "sent," not silence.
- Scope this phase to forms/actions that don't depend on a photo upload or
  the AI-assist call (see Phase 2 and 3) — start with whichever of NearMiss/
  Incident/ToolboxTalk/DailyReport has the simplest payload, confirm the
  queue+idempotency mechanism end-to-end, then extend to the rest.

### Phase 2 — graceful offline AI-assist

- Extend the existing local-dev fallback pattern (README's "falls back to
  demo hazard data") into a real offline path: if `/api/generate-flha` is
  unreachable, let the worker fill hazards/controls in manually instead of
  blocking the form, and flag the record (e.g. `ai_assisted: false`) so a
  supervisor knows it wasn't AI-cross-referenced against the SOP.
- Optional fast-follow: queue a background regeneration attempt for
  flagged records once connectivity returns, and let a supervisor accept/
  discard the AI suggestion after the fact rather than losing it entirely.

### Phase 3 — offline photo/attachment support

The hardest piece, deliberately sequenced last:

- Store selected photo `File`/`Blob` objects in IndexedDB alongside their
  queued record (not `localStorage` — no size ceiling problem that way).
- Defer the two-step signed-upload flow (`uploadViaSignedUrl.js`) until the
  device is back online; keep the queued record in a "pending attachments"
  state until every photo for it has confirmed-uploaded.
- Cap total queued blob storage (e.g. warn or block new offline photo
  capture past some IndexedDB budget) so a multi-day offline stretch on a
  remote site can't silently exhaust device storage.

### Phase 4 — PWA shell

- Add a minimal web app manifest and a hand-rolled service worker (skip
  Workbox — this project has exactly 4 runtime dependencies today per
  `package.json`; a small SW you can read end-to-end fits the "one person,
  low overhead" constraint better than an added build-tool dependency).
- Cache-first for the static app shell (JS/CSS bundle, fonts, logo) only —
  never cache `api/*.js` responses. This is what lets the app actually open
  with zero signal (not just survive a signal drop mid-session) so the
  IndexedDB queue from Phase 1–3 has something to run inside.

## Open questions to settle before building

1. **Which forms get the queue first?** Recommend starting with whichever
   of NearMiss/Incident/ToolboxTalk/DailyReport has the simplest payload
   and no required photo, to prove the idempotency + queue mechanism before
   extending it everywhere. FLHA is the flagship but also the form most
   entangled with the AI-assist dependency (Phase 2), so it's a reasonable
   one to defer slightly, not because it matters less.
2. **How long does a queued item live before it's considered stale/
   abandoned?** Needs a decision — e.g. surface a warning after 24h
   unsynced rather than queuing silently forever.
3. **Do supervisors need offline too, or just workers?** Supervisors review
   from the Dashboard, which is closer to an office/truck-with-signal
   context most of the time — recommend scoping v1 to worker-facing
   submission forms only and revisiting Dashboard offline reads later if it
   turns out to matter.
4. **What happens to an amendment (`amendingId` in `api/flhas.js`) made
   offline to a record that was also changed server-side in the meantime?**
   This is the one place a real conflict is possible (new submissions never
   conflict, they're pure creates). Recommend excluding amendments from the
   offline queue in v1 and requiring connectivity for them, rather than
   building conflict resolution for an edge case up front.

## Out of scope for this pass

- Offline reads (Dashboard, Analytics) — this plan is submission-side only.
- Offline amendments/edits to existing records (see open question 4).
- Multi-device/multi-tab conflict resolution — not needed given the
  create-only scope above.
- Any new `api/` endpoint — everything replays existing action-dispatchers,
  respecting the current 12/12 Vercel function cap.

## Rough size and recommended sequencing

- **Phase 0 (session persistence + draft autosave): small, ~1–2 days.**
  Ship this alone first — it's the best return on effort in the whole plan
  and needs nothing else to be useful.
- **Phase 1 (submission queue, text-only): medium, ~1 week**, including the
  idempotency/schema change across the relevant tables.
- **Phase 2 (offline AI-assist fallback): small-medium, ~2-3 days**, mostly
  UI state + flagging, reusing an existing fallback pattern.
- **Phase 3 (offline photos): medium-large, ~1-2 weeks** — the IndexedDB
  blob handling and storage-budget logic is the fiddliest part of this
  whole plan.
- **Phase 4 (PWA shell): small, ~2-3 days** once Phases 1–3 give it
  something real to do.

Recommended order for a solo dev: **0 → 1 → 4 → 2 → 3.** Get the shell
installable and the text-form queue working behind it before tackling the
AI-assist fallback and the harder photo-storage problem — that way there's
a genuinely useful "offline submit works" release milestone partway
through, instead of one big all-or-nothing offline release.
