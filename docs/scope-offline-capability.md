# Scope: offline capability

Status: **all 5 phases built** (see Progress below). Phase 4 is the one
exception to the standing "not verified end-to-end" caveat below — it
needed no live backend or preview deploy, so it actually was verified in
this session via `vite build && vite preview` + Playwright on `localhost`.
Phases 0-3 are **partially verified end-to-end now, by the user on their
own phone against the PR #16 preview deploy** (this Claude Code session's
own network egress policy 403s all `*.vercel.app` requests, confirmed via
the agent proxy status log and a direct `curl`, so no in-session browser
could reach the real deploy — a human had to). Confirmed so far:

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

- **Phase 1: done — server-side idempotency and full auto-queue on all 8
  worker-facing forms.**
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
    path.
  - **`MonthlyInspection.jsx` and `CustomForm.jsx` now have full auto-queue
    too, closing out Phase 1 on all 8 forms.** Same mechanical
    `resubmitX` + `enqueueSubmission` + "queued" step treatment as the
    other 6, exported as `resubmitMonthly`/`resubmitCustomForm` and wired
    into `WorkerMenu.jsx`'s `RESUBMIT_HANDLERS` (keys `monthly`,
    `customform` — `customform` is a single shared queue bucket covering
    every custom document type a company runs; `formId` inside each queued
    item's payload is what routes it back to the right one on drain).
    **A real bug fixed along the way, not just mechanical wiring — and a
    second real bug found in the fix itself, caught by review before it
    shipped.** `submit_monthly` computed `period_month` from the server's
    own `now()` at insert time — correct for a live submission, but wrong
    for a queued one resynced after a delay that crosses a month boundary
    (an inspection actually completed on the last day of the month could
    land attributed to the next month if it happened to sync a day late).
    First fix: have the client capture `periodMonth` once at the original
    fill time and send it along, validated only for *string shape*
    (`YYYY-MM-01`). A tenant-scope review of that exact value — asked to
    look past cross-tenant concerns at data integrity specifically, since
    this was new client-controlled data landing in the database — found
    that shape-only validation let a client submit *any* date, not just a
    plausible one: pre-dating a submission into a future month would make
    `get_active_form`'s duplicate check silently treat a real future
    inspection as "already done," and submitting several records for the
    same real month under different `periodMonth` values would evade that
    same duplicate check entirely, since `submit_monthly` itself never
    checks for a duplicate — only `get_active_form` does, keyed to
    whatever month the client claims. (An earlier version of this note
    said the review "came back clean" — that was written before the review
    had actually finished and was wrong; corrected here.) Fixed by bounding
    `periodMonth` to the server's current month or the immediately
    preceding one (covers the real resync-a-day-late case without accepting
    an arbitrary client-chosen date) and tightening the month digits to
    01-12 in the format check.
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
    across all 8 forms — still has not been, and remains the single most
    important thing to check on a preview deploy (from a network that can
    actually reach it) before trusting this in front of a real worker.

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

- **Phase 3: built, on `Incident.jsx` — the only worker form that captures
  photos** (see the Phase 3 section below for the scoping that narrowed
  this from "offline photos across the app" down to one form). No
  `api/*.js` changes — everything is client-side.
  - **`src/offlineQueue.js`** gains a second IndexedDB object store,
    `photos` (bumped `DB_VERSION` to 2, `withStore` generalized to take a
    store name), keeping the original `queue` store's plain-JSON-only
    guarantee intact. New `storePhoto`/`getPhoto`/`deletePhoto`/
    `listPhotos`/`totalPhotoBytes` functions, same style as the existing
    queue functions.
  - **`Incident.jsx`'s `handlePhotoSelect`**: an immediate-upload failure
    (offline, or just a bad moment for the connection) no longer shows a
    silent "Failed" badge and drops the photo — the blob is persisted via
    `storePhoto` instead, and the tile shows a new "📶 Queued" state,
    distinct from a hard `error` (only reachable now if IndexedDB itself is
    unavailable — private browsing, quota). A fixed `PHOTO_BUDGET_BYTES`
    (28MB) blocks new offline photo capture past that cap with a clear
    message, rather than letting a multi-day offline stretch silently fill
    device storage — deliberately a fixed number over
    `navigator.storage.estimate()`, simpler to reason about and test (open
    question 7).
  - **`resubmitIncident`** (already exported for Phase 1's queue) gained a
    new first step: upload every `pendingPhotoIds` entry now that there's
    connectivity (via the same `uploadViaSignedUrl` call, just deferred),
    merge the results into `photo_urls` alongside whatever was already
    uploaded live, and delete each blob from the `photos` store once
    confirmed-uploaded. A photo upload that still fails at resubmit time
    throws, which — matching `resubmitX`'s existing contract — leaves the
    whole item queued for the next drain attempt; no new queue-semantics
    work was needed, `drainQueue` already handles this correctly.
  - **Draft-restore extended to cover pending photos**, the piece flagged
    as the most delicate to get right (open question 8) — and built in the
    same pass rather than deferred. The draft now stores only
    `{ id, uploadedUrl, pending, pendingPhotoId }` metadata per photo
    (never the `File` object); on restore, an already-uploaded photo just
    needs its remote URL back (works fine as an `<img src>`, no blob
    needed), and a `pending` photo has its blob loaded back from the
    `photos` store with a fresh `previewUrl` regenerated via
    `URL.createObjectURL` — a blob missing from storage (cleared, etc.) is
    skipped silently rather than crashing the restore. This closes a gap
    Phase 0 explicitly couldn't: before Phase 3, an accidental reload
    between "photo captured offline" and "incident submitted" would have
    lost the photo even though the rest of the form's draft survived.
  - **Not built:** the "adjacent, cheap" manual retry button for a hard
    `error` tile (same-session-only UX fix flagged in the Phase 3 section
    below, not offline-resilience work, doesn't block anything above) —
    left for a follow-up if it turns out to matter.
  - **Not verified end-to-end** — same standing caveat as every other
    phase. Passed `npm run build` and the vite dev-transform round-trip on
    both touched files (`offlineQueue.js`, `Incident.jsx`); no `api/*.js`
    files touched, so no tenant-scope review was triggered this pass
    (nothing here reads or writes a company-scoped table server-side — the
    `photos` IndexedDB store is purely local to the device).

- **Phase 4: built.** `public/sw.js` (hand-rolled, no Workbox, ~95 lines),
  `public/manifest.json`, a set of generated icons, and the corresponding
  `index.html`/`src/main.jsx` wiring. Genuinely **verified end-to-end this
  time** — unlike every other phase, this one could be tested for real
  from inside the session, since it needs no live backend or preview
  deploy: `npm run build && vite preview` gives a real production bundle
  with actually-hashed filenames, servable on `localhost` (unaffected by
  this session's network-egress restriction on `*.vercel.app`). A
  Playwright run against that confirmed: the service worker installs and
  activates; a second page load is SW-controlled; the shell (`index.html`,
  the JS bundle, the logo, the manifest, all three icons) is precached
  during `install`, not left to opportunistic runtime caching alone; a
  **fully offline reload renders the actual Login screen** ("Select your
  role to continue" visible, not just a non-empty `<body>`) — the
  phase's actual goal, the app opening with zero signal, confirmed working
  rather than assumed; and a simulated offline `/api/login` fetch still
  throws a network error rather than getting served a fabricated cached
  response, confirming the "never touch `/api/`" rule holds and every
  offline-detection path from Phases 0–3 is undisturbed.
  - **Design deviated from the original plan in one way, found during
    testing, not anticipated in the scoping pass:** pure opportunistic
    runtime caching (cache a request the first time the SW happens to
    intercept it) turned out to miss the shell's *own first load* — a page
    isn't controlled by its service worker until after that worker
    installs, activates, and claims clients, so the very first
    index.html/JS/CSS requests are never routed through the `fetch`
    handler at all. Fixed by having `install` explicitly fetch `/`, parse
    out which script/link URLs Vite actually emitted for the current
    build, and precache those directly (plus the manifest's icon list) —
    still no build-time manifest file needed, just doing the equivalent
    read at runtime instead. This is exactly the kind of gap that live
    testing (even against a local preview server, not a real deploy)
    catches and a code-only review wouldn't have.
  - **Icons are a real limitation, flagged rather than hidden:** the only
    source asset is `fora-logo.png`, a wide wordmark (960×394, no square
    mark or symbol version exists in the repo). Generated 192×192, 512×512,
    a maskable 512×512 (extra safe-zone padding for Android's adaptive-icon
    cropping), an apple-touch-icon, and a 48×48 favicon by centering the
    wordmark on the app's actual dark background (`#0A0A0A`, confirmed from
    `Login.jsx`). The larger sizes read fine; the 48×48 favicon is legible
    but soft — a dense multi-line wordmark doesn't compress to a tiny icon
    as cleanly as a dedicated symbol mark would. Not broken, just not
    crisp — worth swapping if a proper square mark/symbol asset exists or
    gets made, per open question 9.
  - **Update-lifecycle design as scoped:** `self.skipWaiting()` in
    `install` and `clients.claim()` in `activate`, plus `activate` deleting
    any cache not matching the current `CACHE_VERSION` string — a new
    deploy's SW takes over on the next navigation rather than requiring
    every open tab to close first, safe here specifically because the SW
    only ever touches the static shell, never `/api/` calls or the
    IndexedDB queues from Phases 1–3.

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

**Correction on scope, same as Phase 2's premise correction:** this was
framed as "offline photos across the app." Checked every worker form
(`grep` for `type="file"` and `uploadViaSignedUrl` across `src/*.jsx`) —
**only `Incident.jsx` actually captures photos.** `NearMiss.jsx` uses
`uploadViaSignedUrl` too, but only for the signature PNG at submit/resubmit
time, which is already a plain data URL string in the queue payload today
(no blob, no Phase 3 needed there — Phase 1 already handles it correctly).
`AdminPanel.jsx`/`Onboarding.jsx` have file inputs but are office-context,
same exclusion reasoning as Dashboard/Analytics elsewhere in this doc. So
this phase is really "fix Incident's photo evidence for spotty connectivity
on-site," not an app-wide feature — much narrower than the original
estimate assumed.

**Current behavior, read from the code (`handlePhotoSelect`,
`Incident.jsx:202-231`):** every selected photo starts uploading
*immediately* via `uploadViaSignedUrl` (a two-step flow: ask
`/api/reports`'s `create_upload_url` for a signed token, then PUT the blob
straight to Supabase Storage — both steps need a live connection). If that
fails — offline, or just a flaky connection at the wrong moment — the tile
shows a "Failed" badge and the photo is silently dropped: `uploadedPhotoUrls()`
only collects photos with a confirmed `uploadedUrl`, and nothing blocks the
worker from continuing past `Continue →` (only `uploadingCount > 0`, actively
uploading, blocks that button — an `error` tile doesn't). So today, a photo
taken in the exact moment connectivity drops — arguably the single most
likely time for that to happen on a real incident, e.g. right after an
accident in a dead zone — just vanishes from the record with no queuing and
no clear warning that it never made it in.

**Design:**

- Add a second IndexedDB object store to `src/offlineQueue.js` (same
  database, bump `DB_VERSION`, new `onupgradeneeded` branch) — `photos`,
  keyed by a local id, storing `{ id, blob, contentType, createdAt }`.
  Keeps the existing `queue` store's "plain JSON only" guarantee intact
  (per its own header comment) by keeping blobs in a store built for them,
  rather than retrofitting the submission queue itself.
  `storePhoto`/`getPhoto`/`deletePhoto`/`listPhotos`/`totalPhotoBytes`
  functions, same style as the existing `enqueueSubmission`/`listQueued`/etc.
- `handlePhotoSelect`: on the same network-failure-vs-server-rejection split
  Phase 1 already established elsewhere (`fetch()` throwing vs. resolving
  non-ok), a network-level failure stores the blob via the new `photos`
  store instead of marking the tile `error`. Tile gets a new `pending`
  state ("📶 queued" badge, distinct from `error`) — doesn't block
  `Continue →`, same as `error` doesn't today, but now the photo isn't
  silently lost.
- Submit payload gains `pendingPhotoIds` (local blob ids) alongside the
  existing `uploadedPhotoUrls`. `resubmitIncident` (already exported from
  `Incident.jsx` for Phase 1's queue) gets one addition: before assembling
  `photo_urls` for the record, upload any `pendingPhotoIds` now that
  there's connectivity (same `uploadViaSignedUrl` call, just deferred),
  merge the resulting URLs into `photo_urls`, and delete each blob from the
  `photos` store once confirmed-uploaded. If a photo upload still fails at
  resubmit time, throwing (matching `resubmitX`'s existing contract) leaves
  the whole item queued for the next drain attempt — no new queue-semantics
  work needed, `drainQueue` already handles this correctly.
- `removePhoto`: for a `pending` tile, also delete the blob from the
  `photos` store (currently just revokes the object URL and drops the
  React state entry) — otherwise a removed-then-never-synced photo leaks in
  IndexedDB forever.
- **Storage budget cap**, per the original bullet: track total bytes across
  all pending blobs (`totalPhotoBytes()`) and block new offline photo
  capture past a fixed threshold — proposing **~25-30MB** (roughly 15-20
  phone photos) as a starting point, with a clear message rather than a
  silent failure, until the pending ones sync. A fixed cap is simpler and
  more predictable to test than querying `navigator.storage.estimate()` for
  actual available device space; worth revisiting only if the fixed number
  turns out wrong in practice.
- **Newly worth including, not originally in scope:** extend Incident's
  Phase 0 draft restore to cover pending photos. The scope doc's Phase 0
  section explicitly excluded "Incident's in-flight photo uploads" from
  restore because "a `File` object doesn't survive `JSON.stringify` anyway
  ... restoring already-uploaded photo URLs is real Phase 3 work, not this
  pass." With blobs now persisted in IndexedDB (not the draft's plain-JSON
  snapshot), that's no longer strictly true — the draft can store just
  `{ id, pending, uploadedUrl }` metadata per photo, and on restore, for any
  `pending` entry, load the blob back from the `photos` store and
  regenerate a fresh `previewUrl` via `URL.createObjectURL`. Without this,
  Phase 3 only protects a photo between "captured offline" and "later
  synced" — an accidental reload or crash in between would still lose it,
  which undercuts the point. Flagging as the most delicate part to test
  (same caution this doc already gives Inspection/MonthlyInspection's
  restore logic) — a wrong restore here means either a broken thumbnail or
  a lost blob reference, not just a missing field.
- **Adjacent, cheap, but not core to this phase:** a manual "Retry" on a
  tile that shows `error` (a genuine server-side rejection, not a network
  failure — e.g. an oversized file or an unexpected content-type). The
  `File` object is already sitting in the component's in-memory state for
  the current session, so retrying needs no persistence at all, just a
  button that re-runs the same upload call. Worth doing alongside this
  phase since it's nearly free, but it's a same-session UX fix, not an
  offline-resilience one — doesn't depend on anything above and could ship
  independently.

**Revised size: ~2-3 days**, not the original "medium-large, ~1-2 weeks" —
that estimate assumed offline photo handling across the whole app; in
reality it's one form, and the existing upload/queue/drain infrastructure
from Phase 1 already does most of the work. No `api/*.js` changes needed —
`create_upload_url` already works identically whether called at capture
time or later at resubmit time.

**Open questions to settle before building** (added to the list below):
the exact storage-budget number, and whether the draft-restore extension
ships in the same pass or as an explicit fast-follow.

### Phase 4 — PWA shell

**Small correction:** the original bullet said "exactly 4 runtime
dependencies" — it's actually **5** today (`@supabase/supabase-js`,
`jspdf`, `react`, `react-dom`, `stripe` — `stripe` was added since that
line was written, for the billing work). Doesn't change the recommendation
(still genuinely small, still no reason to add Workbox as a build
dependency), just correcting the number rather than repeating it.

**Read the actual app shell before designing the service worker** — it's
simpler than a typical PWA because there's no client-side router at all:
`src/main.jsx` does one `pathname === '/onboarding'` check and renders
either `Onboarding.jsx` or `Login.jsx`; every other "page" (worker menu,
supervisor dashboard, admin panel, the `/dashboard` link on FLHA's done
screen) is the *same* SPA shell, switched entirely by client-side state
inside `Login.jsx` once a session is loaded from `localStorage` — never a
second URL/route. `vercel.json` already rewrites every path to
`/index.html` (`"source": "/(.*)", "destination": "/index.html"`). So a
service worker here only ever needs to cache **one HTML shell** — no
per-route caching logic, no route table to keep in sync with the React
side. That's a meaningful simplification versus a typical multi-page PWA.

**Design — deliberately runtime-caching, not a build-time precache
manifest:** Vite content-hashes the built JS/CSS filenames
(`index-XXXXXXXX.js`), which change every deploy. A hand-rolled SW with a
precache list would need a build step to generate that list and inject it
into `sw.js` — exactly the kind of build-tooling addition the "skip
Workbox" reasoning already argues against. Simpler alternative: the SW's
`fetch` handler caches same-origin static responses **opportunistically**
(cache-first for anything already cached — safe, since a hashed filename's
content never changes once published; network-first-then-cache for
`index.html` itself, so a returning-online visit picks up a new deploy's
updated script tag). Trade-off: the app has to be opened online *once*
after each deploy to pick up the new bundle into the cache — acceptable
for "install once with signal, then keep working," which is what this is
actually for.

**The one rule that matters most, unchanged from the original bullet but
worth restating as the central constraint, not a footnote:** the SW must
never intercept or cache anything under `/api/`. Every fetch to
`/api/*.js` has to reach the real network and fail naturally when it
can't — that's the exact signal Phases 0–3's `!navigator.onLine` /
`isNetworkFailure` handling and IndexedDB queue already depend on. A
service worker that got clever and tried to cache or short-circuit an API
response would silently break every offline-detection path already built.
Concretely: the `fetch` handler's first check should be "does this URL
path start with `/api/`? If so, `return` immediately without touching the
cache at all" — same instinct as `create_upload_url`'s bucket allowlist or
`api/monthly.js`'s `periodMonth` bound, just applied to routing instead of
data.

**What gets cached:** `index.html`, the built JS/CSS bundle under
`/assets/`, and `fora-logo.png` (the only static asset today — confirmed
via `ls public/`). `manifest.json` and any new icon files (see below) join
that same list once they exist.

**Assets that don't exist yet and need real creation, not just code:**
checked `index.html` and `public/` — there's currently no
`<link rel="icon">` at all (no favicon), no `manifest.json`, and the only
image asset is `fora-logo.png` at its source resolution (arbitrary
dimensions, not sized for app icons). A real web app manifest needs
properly sized icons (192×192 and 512×512 PNGs at minimum, ideally a
maskable variant for Android's adaptive-icon masking) generated from the
logo — asset work, not something to hand-wave as "add a manifest."
`theme_color`/`background_color` should match the app's actual dark theme
(`#0A0A0A` background, `#F97316` orange accent — confirmed from
`Login.jsx`'s own style object). iOS needs its own meta tags separately
(`apple-touch-icon`, `apple-mobile-web-app-capable`) since Safari doesn't
fully follow the Web App Manifest spec for "Add to Home Screen."

**Update-lifecycle risk, specific to how hard this app already leans on
long-lived offline sessions:** the classic PWA foot-gun is a service
worker that refuses to update, silently serving stale JS indefinitely —
worth taking seriously here given how much of Phases 0–3 is designed
around a worker staying on one page for a long stretch with no
connectivity. Recommend `self.skipWaiting()` in `install` and
`clients.claim()` in `activate`, so a new deploy's SW takes over on the
next navigation rather than requiring every open tab to fully close first
— simpler mental model for a one-person-maintained app, and safe here
specifically because the SW only ever touches the *static shell*, never
API calls or the IndexedDB queue/photo stores, so an update mid-session
can't corrupt in-flight offline data. `activate` should also clear any
cache not matching the current cache-name version, so stale cached bundles
don't accumulate release over release.

**Registration:** `src/main.jsx` registers `/sw.js`, gated to
`import.meta.env.PROD` — registering against Vite's dev server would just
create confusing caching behavior for no benefit during development.

**Testing note:** a service worker can't be meaningfully exercised against
`vite dev` (no real hashed production bundle to cache) — verification
needs `vite build && vite preview` at minimum, ideally the actual preview
deploy once one can be reached. Worth flagging alongside every other phase's
same standing caveat about live verification in this doc.

**Revised size: still ~2-3 days for the code**, matching the original
estimate — the router-simplicity finding above roughly cancels out against
the extra care the update-lifecycle risk deserves. The icon/asset creation
is separate, real design work outside a pure code estimate.

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
7. **What's the right offline photo storage cap** (Phase 3)? Proposed
   ~25-30MB as a starting, easily-adjustable number — a fixed cap is
   simpler to reason about and test than querying actual device storage via
   `navigator.storage.estimate()`, but worth confirming that's a sane
   number for how many photos a real incident report tends to have.
8. **Does the Incident draft-restore extension (Phase 3) ship in the same
   pass as the core photo-queueing work, or as an explicit fast-follow?**
   It's the most delicate piece to get right (a wrong restore risks a
   broken thumbnail or an orphaned blob reference, not just a missing
   field) — worth deciding whether to derisk it separately.
9. **Who produces the actual icon assets for Phase 4's manifest** (192×192,
   512×512, a maskable variant) — resized/exported from the existing
   `fora-logo.png`, or a fresh export from wherever the source logo file
   actually lives? This is real design work, not something to generate as
   a byproduct of writing the manifest JSON.

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
- **Phase 1 (submission queue, text-only): done** (see Progress above) —
  server-side idempotency and full auto-queue on all 8 worker-facing forms,
  including a schema migration for MonthlyInspection/CustomForm (the two
  tables with no jsonb column) and a real correctness fix found along the
  way (`period_month` attribution for a delayed offline resync). Not yet
  verified end-to-end against a real backend (blocked twice now for two
  different reasons — see Progress above).
- **Phase 2 (AI-assist fallback): done, on all 7 forms** (see Progress
  above). 6 of 7 forms (DailyReport, MonthlyInspection, CustomForm trivial;
  FLHA, NearMiss, Incident small-medium) reused an already-editable review
  step; ToolboxTalk needed new UI (a `manualtalk` step) since its review
  step is read-only. Background AI regeneration + supervisor accept/discard
  (the original "optional fast-follow") deliberately not built — see open
  question 6. Not yet verified end-to-end against a real backend.
- **Phase 3 (offline photos): done, on `Incident.jsx`** (see Progress
  above) — the only worker form that captures photos at all (checked every
  form), so this ended up much smaller than the original "medium-large,
  ~1-2 weeks" estimate. Includes the draft-restore extension in the same
  pass rather than as a deferred fast-follow.
- **Phase 4 (PWA shell): done, and actually verified end-to-end** (see
  Progress above) — the one phase in this whole plan that could be, since
  it needs no live backend. Simpler router-wise than a typical PWA (no
  client-side router at all), and testing caught a real gap the scoping
  pass didn't anticipate: pure runtime caching misses the shell's own
  first load, fixed with an explicit install-time precache instead.

Actual build order ended up **0 → 1 → 2 → 3 → 4** rather than the
originally-recommended **0 → 1 → 4 → 2 → 3** — Phase 4 got scoped last
because live-testing feedback surfaced Phase 2's gap (the AI-assist dead
end) organically while using the app, which made it the natural next thing
to build rather than sticking to the original sequencing. The reasoning
behind the original recommendation (ship the shell early for an
installable milestone) still holds if useful going forward — this is just
what actually happened, not a claim that the new order was planned.
