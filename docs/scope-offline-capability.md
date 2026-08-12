# Scope: offline capability

Status: Phase 0 built, Phase 1 mostly built, Phase 2 built (see Progress
below for all three). **Partially verified end-to-end now, by the user on
their own phone against the PR #16 preview deploy** (this Claude Code
session's own network egress policy 403s all `*.vercel.app` requests,
confirmed via the agent proxy status log and a direct `curl`, so no
in-session browser could do this — a human had to). Confirmed so far:

- Login succeeds when online (worker role, `abcworker` test company) —
  confirmed both from the user reaching the worker menu and from the
  deployment's own server logs (`get_runtime_logs`) showing two successful
  `POST /api/login` calls followed by a successful `/api/customforms` call,
  the exact signature of a real login reaching `WorkerMenu`.
- ToolboxTalk: going offline right at the final submit step correctly shows
  **"Saved — No Signal"**, not a false success and not a raw connection
  error — confirmed live by the user.
- Along the way, confirmed a real *scope* gap, not a bug: the AI-generation
  step mid-form (`/api/generate-flha`, e.g. ToolboxTalk's "what's the talk
  about" step) still hard-requires connectivity and had no fallback at the
  time — this is exactly what Phase 2 (built the same session, see Progress
  below) now addresses. The user hit this live ("couldn't generate the
  talk, check connection") while testing, which is what prompted scoping
  and then building Phase 2 in the same sitting.

**Not yet confirmed:** the other 5 forms' offline-submit-then-auto-send
(NearMiss, Incident, DailyReport, FLHA, Inspection), the actual
auto-send-on-reconnect landing in the database (only the offline-queue side
was confirmed above, not the drain side), the full-tab-close-then-reopen
session-persistence check specifically, Inspection/MonthlyInspection's
draft-restore-on-reload safety, and all of Phase 2 (the "Continue without
AI" fallback on any form). Still worth working through the rest of the
per-form checklist in Progress below.
Picked from `TODO.md`'s "Offline capability or a backup plan" item — see
`docs/competitive-notes.md` for why this is the highest-leverage gap to
close (it's the single most-cited complaint about SiteDocs-category tools,
and FORA had nothing here at all before this work, not even a degraded
fallback).

## Current state

Confirmed by reading the actual submission path, not assumed:

- **No offline handling exists anywhere.** Zero references to service
  workers, IndexedDB, `navigator.onLine`, or a web app manifest in `src/`
  or `api/`. There's also no `manifest.json` or `sw.js`.
- ~~The session token is not persisted client-side~~ **Correction: it is,
  but fragile.** `src/Login.jsx` originally persisted `session` (which
  carries `token`) in `window.name`, not a plain in-memory `useState` as
  first written here — that survives a same-tab reload but not a fully
  closed-and-reopened tab, which is exactly the case that matters most for
  a worker relaunching the app from a home-screen icon on a jobsite with no
  signal. Fixed in Phase 0 below by switching to `localStorage`, which
  survives that. The token itself is valid for 7 days once issued
  (`SESSION_TTL_MS` in `api/flhas.js` and the other `api/*.js` files); a
  stale local copy past that just fails on the next API call, same as
  before.
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

## Progress

- **Phase 0: done — session persistence and draft autosave across all 8
  worker-facing forms.**
  - `src/Login.jsx` now persists `session` to `localStorage`
    (`fora_session`) instead of `window.name`.
  - `src/useDraftAutosave.js` is the reusable piece: `loadDraft`/
    `clearDraft`/`useDraftAutosave(formType, scopeId, data, enabled)`,
    debounced localStorage writes keyed by form type + scope id (usually
    `companyId`; `CustomForm.jsx` additionally scopes by `formId` since a
    company can run several custom document types at once — see the
    hook's own file comment on the shared-device tradeoff of not scoping
    per worker).
  - Wired into all 8 worker-facing forms — `src/App.jsx` (FLHA) first as
    the reference implementation, then `NearMiss.jsx`, `Incident.jsx`,
    `Inspection.jsx`, `ToolboxTalk.jsx`, `DailyReport.jsx`,
    `MonthlyInspection.jsx`, and `CustomForm.jsx`. Each restores an
    in-progress, not-yet-submitted document on mount and debounce-saves it
    as the worker types; each clears its draft on successful submit.
    Deliberately excluded per form, and why:
    - The signature canvas everywhere — redrawing pixels back onto a
      `<canvas>` from a data URL is solvable but out of scope for this
      pass, and re-signing takes seconds anyway.
    - FLHA's amend flow (`amendingId`) and ToolboxTalk's "sign a talk you
      missed" flow (`lateSignTarget`) — both operate on an existing
      server record fetched live, not a fresh draft.
    - Inspection's `openPretrip`/`lastInspection` and MonthlyInspection's
      `existingRecord` — each is a live "does one already exist for
      today/this month" check; restoring a stale cached answer could be
      actively wrong (closed out or superseded since caching), so those
      steps (`choice`/`posttrip` for Inspection, `duplicate` for
      MonthlyInspection) are excluded from restore and always re-fetched.
    - Incident's in-flight photo uploads — a `File` object doesn't survive
      `JSON.stringify` and a `blob:` preview URL doesn't survive a reload;
      restoring already-uploaded photo URLs is real Phase 3 work, not this
      pass.
  - Verified: `npm run build` succeeds after each batch; every touched
    file was also individually round-tripped through Vite's dev transform
    (`GET /src/<File>.jsx` against a running `vite` dev server) to catch
    any import/syntax error that a production build might not surface the
    same way. A Playwright check confirmed the localStorage session
    round-trips correctly (fresh load → role picker;
    a session written to `localStorage` and reloaded → skips straight to
    the authenticated view; clearing it → back to the role picker). The
    draft-autosave logic itself could not be exercised end-to-end for any
    of the 8 forms in this environment — there's no Supabase/session
    credentials available to actually log in and reach an authenticated
    form, so all 8 were verified by code review and the dev-transform
    check above, not a live click-through. Worth a real run-through of
    each document type on a preview deploy before calling Phase 0 fully
    done — pay closest attention to Inspection and MonthlyInspection,
    where a wrong restore could crash the render (see the excluded-steps
    list above for why those two are the most delicate).

- **Phase 1: server-side idempotency done on all 6 forms with a suitable
  table; full auto-queue done for 6 of 8 forms; MonthlyInspection and
  CustomForm have idempotent endpoints now too but their frontends still
  need clientSubmissionId + auto-queue wired in (mechanical, unblocked).**
  - **A real bug found and fixed along the way, not just scoped:**
    `NearMiss.jsx`, `Incident.jsx`, `ToolboxTalk.jsx`, `DailyReport.jsx`,
    `MonthlyInspection.jsx`, and `CustomForm.jsx` all previously caught a
    failed submit's network error, logged it to `console.error`, and then
    **still moved on to the "done" screen** — telling the worker their
    report was safely in when it had never reached the server at all. A
    dropped connection right at Submit meant silent data loss with a false
    success message, which is a worse failure mode than anything on the
    original SiteDocs pain-point list. `App.jsx` (FLHA) and `Inspection.jsx`
    already handled this correctly (check the response, show an error, let
    the worker retry) — they were the model the other 6 needed to match.
  - **Server-side idempotency** (`api/flhas.js`, `api/reports.js`,
    `api/logs.js` — covering FLHA, NearMiss, Incident, Inspection,
    ToolboxTalk, DailyReport): a `clientSubmissionId` sent alongside a
    submission is checked for an existing row before inserting, and
    embedded into the record on insert, so a retried submission can't
    create a duplicate. No `client_submission_id` column exists on any of
    these tables — rather than requiring a manual schema migration this
    session couldn't apply anyway (no Supabase credentials/MCP access
    here), the id rides inside each table's existing jsonb column
    (`hazards_json`, `report_json`, `results_json`,
    `talking_points_json`) via PostgREST's `column->>key` filter syntax.
    Works today with zero migration; a dedicated indexed column would be
    a cleaner future upgrade if duplicate-check query volume ever
    justifies it, which is unlikely at this scale.
  - **`src/offlineQueue.js`** is the reusable queue: a small IndexedDB
    wrapper (`enqueueSubmission`, `listQueued`, `drainQueue`,
    `removeQueued`) storing plain JSON only — never a `File`/`Blob` — see
    the file's own header comment for why (PDF generation itself needs a
    network round trip for the signed-upload-URL step, so there's nothing
    useful to pre-generate while still offline; a drained item just redoes
    the whole submission later). Verified directly in a real browser
    (Playwright against a running `vite` dev server, no backend needed for
    this part): enqueue, ordered listing, a failing drain stops after the
    first failure and leaves everything queued rather than skipping ahead
    out of order, a succeeding drain clears items in order, and different
    form types don't interfere with each other.
  - **Full auto-queue wired into `NearMiss.jsx`, `Incident.jsx`,
    `ToolboxTalk.jsx`, `DailyReport.jsx`** (`DailyReport` first, as the
    reference — simplest payload, no signature, matching this doc's own
    original recommendation). Each exports a `resubmitX(payload,
    clientSubmissionId, token)` function that redoes signature/PDF upload
    + the final POST from plain data; `submit()` calls it directly when
    online, and falls back to `enqueueSubmission` on a network-level
    failure (distinguished from a real server rejection by whether
    `fetch()` itself threw vs. resolved with a non-ok status — a `!res.ok`
    shows an error and lets the worker retry manually instead of being
    silently queued and retried against what might be a real, non-transient
    rejection). `WorkerMenu.jsx` centrally drains all four queues on mount
    and on the browser's `online` event, via a small `RESUBMIT_HANDLERS`
    map — so a worker who reopens the app after reconnecting gets queued
    items sent automatically without needing to reopen the specific form.
    Each form gained a new "queued" step/screen ("Saved — No Signal") and
    a `saveError` banner + "Try Again" for real rejections.
  - **FLHA (`App.jsx`) and Inspection (`Inspection.jsx`) now have full
    auto-queue too**, same mechanical treatment as the first four: each
    exports a `resubmitX` function (`resubmitFLHA`, `resubmitInspection` —
    the latter covers both the pre-trip and post-trip submit flows) and
    gained a "queued" step; both are wired into `WorkerMenu.jsx`'s
    `RESUBMIT_HANDLERS` map (keys `flha`, `inspection`). FLHA's amend flow
    (`amendingId`) deliberately keeps its original direct-fetch path with no
    queueing — amendments are still out of offline scope (see open question
    4). Server-side idempotency for both `flhas` and `inspections` was
    already in place from the earlier pass, so no backend change was needed
    here.
  - **`MonthlyInspection.jsx` and `CustomForm.jsx`'s endpoints are now
    idempotent too, via a real schema change rather than the jsonb-embed
    trick** the other 4 tables use. `inspection_records` and
    `custom_form_records` have no jsonb column to piggyback on, so — with
    the user's explicit sign-off, since this touches the live Supabase
    project's schema — this session applied an additive migration (nullable
    `client_submission_id text` + a partial unique index on both tables,
    migration name `add_client_submission_id_monthly_customform`) and wired
    a check-before-insert into `api/monthly.js`'s `submit_monthly` and
    `api/customforms.js`'s `submit_custom`, with a unique-violation fallback
    (Postgres error code `23505`) in case a race between the check and the
    insert ever lets two concurrent retries both get past the check — the
    unique index is the real backstop, the app-level check is just the fast
    path. **The frontends (`MonthlyInspection.jsx`, `CustomForm.jsx`) don't
    send a `clientSubmissionId` yet and still don't have auto-queue** — that
    wiring is now unblocked and is the same mechanical `resubmitX` +
    `enqueueSubmission` + "queued" step treatment as the other 6 forms, left
    for a follow-up pass.
  - **Still not verified end-to-end against a live backend**, for a
    different reason than Phase 0's original gap. This pass had real
    Supabase/Vercel API access (via MCP tools) — enough to find a ready test
    company (`ABC Earthworks Company`, company code `abcworker`, worker
    login) and apply the migration above — but this session's own network
    egress policy blocked every request to `*.vercel.app` with a `403`
    (confirmed via the agent proxy's status endpoint and a direct `curl`),
    so no in-session browser could reach the preview deploy to click
    through it. The queue mechanics themselves
    (enqueue/list/drain/ordering/failure-handling) were verified for real in
    a browser in an earlier pass; the full "go offline in devtools, submit,
    come back online, watch it actually land in the database" path — now
    across 6 forms instead of 4 — still has not been, and remains the
    single most important thing to check on a preview deploy (from a
    network that can actually reach it) before trusting this in front of a
    real worker.

- **Phase 2: built, on all 7 forms that call `/api/generate-flha`** (see the
  Phase 2 section below for how each form was sized and why). Every form
  now offers "Continue without AI" when generation fails, flags the record
  `ai_assisted: false`, and shows a "not AI-reviewed" banner on the
  worker-facing side so a supervisor knows to look closer:
  - **DailyReport, MonthlyInspection, CustomForm** — trivial as scoped: the
    fallback reuses data that already exists (raw notes, or a plain
    client-built sentence from checklist answers) and drops straight into
    the existing editable review screen.
  - **FLHA, NearMiss, Incident** — small-medium as scoped: an empty
    skeleton object into the same already-editable review screen (FLHA's
    `+ Add hazard`, NearMiss/Incident's `updateList`/`addListItem`). FLHA's
    `addingTask` (mid-assessment "add another task") case needed no new
    state at all — the worker adds the task by hand via the same UI a
    fresh FLHA uses.
  - **ToolboxTalk — the one real exception, exactly as scoped.** Its review
    step still can't edit generated content, so this got new UI: a
    `manualtalk` step (added to `RESTORABLE_STEPS` for draft autosave) with
    one plain textarea for the presenter's own notes, which skips the
    structured `review` screen entirely and goes straight to `signoff` —
    `points = { summary: <typed text>, sections: [], discussion: [],
    ai_assisted: false }`.
  - **`ai_assisted` flag storage:** rides for free in the existing jsonb
    column on 5 tables (embedded directly in the `flha`/`report`/`points`
    state object, same trick as `client_submission_id`). For
    `inspection_records`/`custom_form_records` (no jsonb column), applied a
    second additive migration this session
    (`add_ai_assisted_monthly_customform` — `boolean not null default
    true`), again with explicit user sign-off first.
  - **Not built:** the "optional fast-follow" (background AI regeneration +
    supervisor accept/discard UI) — deliberately deferred per open question
    6, a materially bigger feature than the fallback itself.
  - **Not verified end-to-end** — same standing caveat as Phase 0/1. Passed
    `npm run build` and the vite dev-transform round-trip on all 7 touched
    forms plus both API files; the actual "go offline before the AI step,
    tap Continue without AI, fill it in, submit" click-through has not been
    done in a real browser.

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

### Phase 2 — graceful AI-assist fallback

**Correction on the premise this phase was originally scoped from:** README
claims "the app will fall back to demo hazard data if [`/api/generate-flha`]
isn't reachable" for local dev. That fallback does not exist anywhere in
`src/` — checked every caller (grep across `src/*.jsx`, read `App.jsx`'s
`generateFLHA` catch block in full). Every form's AI-generation catch block
does the same thing today: `setGenError(true)`, stop, show "Couldn't
generate ___. Check your connection and try again.", and the worker is
stuck — there's no path past that screen without a successful AI call. So
this phase isn't "extend an existing pattern," it's building the fallback
from scratch. Confirmed live on a preview deploy this session (ToolboxTalk,
offline at the "what's the talk about" step) — exactly this message, exactly
this dead end.

**Also worth reframing the trigger, not just the name:** the original scope
called this "offline AI-assist," implying `navigator.onLine` gates it. But
every form's `catch` block currently fires on *any* generation failure — a
genuinely offline device, but equally a flaky connection, an Anthropic
rate-limit/5xx, or a malformed response. All of those currently produce the
identical dead-end screen. The fallback should trigger on **generation
failure**, not specifically on offline detection — simpler (one code path,
not two), and it degrades gracefully in more situations than just "no
signal," which is the same reasoning Phase 1 already applied to the
submit-side `isNetworkFailure` vs. `isServerError` split (though here there's
no meaningful equivalent of "don't retry a real rejection" — a failed
*generation* has nothing to retry automatically, so this is simpler: just
offer the manual path immediately alongside "Try Again," not instead of it.

**7 worker forms call `/api/generate-flha` mid-flow** (confirmed via grep;
an 8th caller, `AdminPanel.jsx`, is an admin SOP-matching tool used from an
office context, not a jobsite offline scenario — out of scope here, same
reasoning as excluding Dashboard/Analytics elsewhere in this doc). Read each
one's generate function and review step to size this per form rather than
as one lump:

- **DailyReport — trivial, arguably nothing to build.** The AI call
  (`generateReport`) turns the worker's own rough notes (`workDone`,
  `delays`, `tomorrow`) into polished prose; the fallback is just using
  those raw notes as `workSummary`/`delaysSummary`/`tomorrowPlan` directly
  and jumping to `review`, where they're already editable textareas. No new
  UI at all — just a "Continue without AI" button next to "Generate Report"
  that skips straight to assembling that object.
- **MonthlyInspection, CustomForm — trivial.** The AI summary
  (`generateSummary`) is a supplementary write-up of checklist answers that
  already exist in `answers` before the AI call ever runs — nothing about
  the actual inspection data depends on it. Fallback: skip straight to
  `review` with `aiSummary: ""` (or a plain client-side-built sentence like
  "3 of 5 items flagged — see notes below," no AI needed), which is already
  a plain editable textarea the worker can type into or leave blank.
- **FLHA, NearMiss, Incident — small-medium.** All three already have a
  fully editable review step (FLHA: `openNewHazard`/`openEditHazard`;
  NearMiss/Incident: `updateList`/`addListItem`/`removeListItem`/
  `updateText` via a shared `ListEditor`-style pattern) — a worker can
  already add/edit/remove every field by hand once *on* that screen, they
  just can't currently reach it without a successful AI call. Fallback: on
  generation failure, offer "Continue without AI — I'll fill this in
  myself," which sets an empty/skeleton object of the same shape (e.g. FLHA:
  `{ taskSummary: cleanTranscript, hazards: [], sopAlerts: [], ppeRequired:
  [], additionalNotes: null }`) and proceeds straight to `review`. Needs one
  new addition beyond the skip button: a persistent banner on the review
  screen itself ("Not AI-reviewed — check this list carefully before
  submitting") so a worker filling this in cold doesn't mistake a truly
  empty hazard list for "AI found nothing."
- **ToolboxTalk — medium-large, the one real exception.** Confirmed by
  reading its `review` step in full: unlike the other 6, it renders
  `points.summary`/`sections`/`bullets`/`discussion` as **plain text**, no
  `onChange` handlers anywhere — a presenter can't currently edit a single
  word of a generated talk, only continue or go back. There's no existing
  "manual edit" path to fall back onto. Simplest fix, matching this doc's
  own "cheapest and highest-value" bias rather than rebuilding the
  structured sections/bullets editor: on generation failure, skip the
  structured `review` screen entirely and drop the presenter into one plain
  textarea ("Type your talking points/notes for this talk"), store whatever
  they type as `points.summary` with empty `sections`/`discussion` arrays —
  `talking_points_json` is a jsonb column with no server-side shape
  validation, so this is a client-only change. This matches how a real
  presenter would run a talk without AI help anyway (from written notes),
  not an attempt to replicate the structured format by hand.

**Flagging non-AI-assisted records (`ai_assisted: false`) needs a decision,
not just an implementation.** 6 of 8 tables already have a jsonb column from
Phase 1 (`hazards_json`, `report_json`, `talking_points_json`) — the flag
rides in there for free, zero migration, same trick as
`client_submission_id`. The 2 that don't (`inspection_records`,
`custom_form_records` — the same two Phase 1 needed a real migration for)
would need either a genuine `ai_assisted boolean default true` column (cheap
now that this session already has Supabase migration access and precedent
for touching these two tables) or a hacky text marker prefixed onto
`ai_summary`. **Recommend the real column, but that's a live-schema call —
same as the Phase 1 migration, worth explicit sign-off before building, not
assumed.**

**Deliberately not in this pass** (matches the doc's existing "optional
fast-follow" framing, just made concrete): background regeneration once
connectivity returns for a flagged record, plus a supervisor accept/discard
UI in `Dashboard.jsx` for the regenerated suggestion. This is a materially
bigger feature than the fallback itself — a new queue type (distinct from
Phase 1's submission queue, since these records are already submitted), a
PATCH-style update path into `api/flhas.js`/`api/reports.js`/`api/logs.js`
that doesn't exist today, and new Dashboard UI. Worth scoping separately if
it turns out supervisors actually want it, not bundled into the base
fallback.

**Revised size:** small-medium ~2-3 days holds for 6 of 7 forms (3 trivial,
3 small-medium, all reusing existing editable review UI); ToolboxTalk's new
plain-textarea fallback adds roughly a day on top. Call it **3-4 days**
total for the base pass (flag-storage decision + the 7 forms), with
background regen + supervisor accept/discard scoped and estimated
separately if pursued.

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
5. **Real `ai_assisted` column vs. a jsonb-embedded flag for
   `inspection_records`/`custom_form_records`?** (Phase 2.) The other 6
   tables get this for free via their existing jsonb column; these two
   don't. Recommend the real column, consistent with the
   `client_submission_id` migration already applied to both tables this
   session — but that was an explicit, asked-for sign-off each time, not a
   standing default to keep altering this schema without asking.
6. **Does anyone actually want background AI regeneration + a supervisor
   accept/discard UI for `ai_assisted: false` records** (Phase 2's original
   "optional fast-follow"), or is the fallback itself (worker fills it in,
   flagged for a supervisor's attention) enough? It's a materially bigger
   build — a second, different kind of queue, a record-PATCH path that
   doesn't exist in any `api/*.js` file today, and new `Dashboard.jsx` UI —
   worth confirming there's real demand before scoping it in detail.

## Out of scope for this pass

- Offline reads (Dashboard, Analytics) — this plan is submission-side only.
- Offline amendments/edits to existing records (see open question 4).
- Multi-device/multi-tab conflict resolution — not needed given the
  create-only scope above.
- Any new `api/` endpoint — everything replays existing action-dispatchers,
  respecting the current 12/12 Vercel function cap.

## Rough size and recommended sequencing

- **Phase 0 (session persistence + draft autosave): done** (see Progress
  above) — session persistence and draft autosave across all 8
  worker-facing forms. Still worth a real click-through on a preview
  deploy before treating it as fully verified, per the caveat above.
- **Phase 1 (submission queue, text-only): mostly done** (see Progress
  above) — server-side idempotency and the queue infrastructure are done on
  all 8 forms' tables now (including a schema migration for
  MonthlyInspection/CustomForm); 6 of 8 forms (NearMiss, Incident,
  ToolboxTalk, DailyReport, FLHA, Inspection) have full auto-queue.
  MonthlyInspection/CustomForm's endpoints are idempotent but their
  frontends still need the same mechanical `clientSubmissionId` +
  `resubmitX` + `enqueueSubmission` wiring — the last remaining piece of
  this phase. Not yet verified end-to-end against a real backend (blocked
  twice now for two different reasons — see Progress above).
- **Phase 2 (AI-assist fallback): done, on all 7 forms** (see Progress
  above). 6 of 7 forms (DailyReport, MonthlyInspection, CustomForm trivial;
  FLHA, NearMiss, Incident small-medium) reused an already-editable review
  step; ToolboxTalk needed new UI (a `manualtalk` step) since its review
  step is read-only. Background AI regeneration + supervisor accept/discard
  (the original "optional fast-follow") deliberately not built — see open
  question 6. Not yet verified end-to-end against a real backend.
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
