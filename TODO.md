# To Do Later

Backlog of ideas not being actively worked — captured so they don't get lost, not yet scoped or scheduled.

- [ ] **More advanced analytics** — go beyond the current usage/issue counts on the dashboard: trends over time, per-site or per-worker breakdowns, hazard/defect frequency analysis, that kind of thing. Needs a follow-up conversation on which metrics actually matter before building anything.
- [ ] **PDF export of analytics** — let a supervisor/admin pull a PDF of the dashboard's analytics/stats view, not just the existing per-document PDFs (FLHA, inspection, etc.) and the weekly equipment report. Depends on the analytics work above being scoped first.
- [x] **Offline capability or a backup plan** — done, and correcting a stale note that was
  still on this list: worker-facing forms used to need a live connection; all 5 phases in
  `docs/scope-offline-capability.md` are now built — session persistence + draft autosave on
  all 8 forms, a submission queue with server-side idempotency on all 8 forms (confirmed
  directly in `WorkerMenu.jsx`'s `RESUBMIT_HANDLERS` map, not just the scope doc), the
  AI-assist "Continue without AI" fallback on all 7 forms that call it, offline photo capture
  on Incident (the only form that takes photos), and a PWA shell (`public/sw.js`,
  `public/manifest.json`) so the app opens with zero signal. A real bug was fixed along the
  way: several forms used to show a false "success" screen when a submit failed over the
  network instead of losing the work silently. **Still open:** none of this has been
  click-through-tested on a real phone against the live deploy — see `STANDUP_LOG.md`'s
  Outstanding Items.
- [ ] **Change the layout for submissions** — revisit the submitted-form layout. Needs more detail on which document type(s) and what specifically should change before scoping.
- [x] **Company "brain"** — done, and live. AI that learns each company over time (industry/equipment context at onboarding, then ongoing learning from FLHA edits, toolbox talks, and incidents) to improve document generation and analytics the longer a company uses FORA. Scoped as a 6-phase plan in `docs/scope-company-brain.md`, all 6 phases built: data model, onboarding research pass, signal capture, batch profile summarization (a daily Vercel cron, `api/cron-company-brain-summary.js`), generation-time prompt integration (7 of 8 document generators via `src/companyProfile.js`), and an Admin Panel "🧠 Brain" tab (profile view/editor + signal-based trending view). The `company_profiles`/`company_signals` migration is now applied to the production DB — caught and fixed a real bug first (the draft migration assumed `uuid` keys; this schema actually uses `bigint` identity columns everywhere, confirmed against the live `companies` table before applying).
- [x] **Clickable "documents this week" stat** — done. Clicking the stat opens a "This Week's Documents" modal covering every company-linked form (including custom docs), sorted newest first; tapping a row opens that document's own detail view.
- [x] **Upgrade Vercel to Pro + run `hobby-cap-unwinder`** — done. Vercel team confirmed on Pro; the Stripe-webhook-in-cron-file and timeclock-report-in-companydata-file workarounds were split back into their own files (`api/stripe-webhook.js`, `api/timeclockreports.js`). The Stripe Dashboard's webhook endpoint URL has since been updated to `/api/stripe-webhook` and confirmed live via the Stripe API — no remaining manual step.
- [ ] **Load/stress test the Brain's signal summarization at scale** — `server-lib/companyBrainSummary.js`'s daily cron job (`docs/scope-company-brain.md` Phase 4) finds "companies with new signals" by fetching the most recent `MAX_SIGNAL_ROWS` (5000) rows across *all* companies in one query and grouping in JavaScript, not a per-company query — a known, documented limitation, fine at today's low volume but untested at real scale. Now that the Brain is being positioned as FORA's flagship feature (see PR #48), volume will grow faster than it has so far. Needs a synthetic-data load test, pushed well past realistic near-term usage, to find the actual point where a company's signals fall outside that 5000-row window and it silently stops getting summarized — not just "does today's load work," but "where's the ceiling." Secondary: stress-test concurrent FLHA generation + `src/companyProfile.js`'s per-submission profile fetch (Phase 5) under simulated multi-company load, to check behavior against Vercel/Supabase connection limits. Should run against a disposable Supabase branch, not the production DB.
- [x] **Audit AI calls for cheaper model routing** — closed 2026-09-14, no action needed. Carried by the weekly competitive-intel pipeline for five straight weeks as "still open / unactioned," most recently as the concrete "hybrid AI routing" recommendation in `docs/marketing/reports/2026-09-13.md`. An audit of every AI call site found all three (`api/generate-flha.js`, `server-lib/onboardingDrafting.js`, `server-lib/companyBrainSummary.js`) already on `claude-haiku-4-5`, so there is no expensive bucket to route away from and no saving to capture. **That separate question is now answered** — see the next item.
- [x] **Move the customer-visible AI off the cheapest model** — done 2026-09-15 in PR #110, answering the question the audit item above deliberately left open. `api/generate-flha.js` is the single endpoint behind all eight document generators, and it now routes by document type: `claude-opus-5` for incident and near-miss reports (legal records, written rarely, read by a regulator years later), `claude-sonnet-5` for the six worker-facing forms (filled in on a phone at the start of a shift, blocking work from starting). An unknown or missing `documentType` falls back to Opus, so a client bug shows up as a slow document someone reports rather than a quietly lower-tier model on a legal record. All eight also now sit behind a server-side safety-manager system prompt that grounds every stated fact, treats item counts as maximums, and forbids citing any regulation or standard number — OH&S law here is provincial, so a clause correct in Alberta is wrong in BC or Ontario and the model is never told which province a worksite is in.

  Route selection was measured, not assumed: everything on Opus 5 at default `high` effort put a live FLHA at 30-60 seconds, and `output_config.effort: "low"` removed the thinking time but could not make an Opus-tier model emit tokens at Haiku speed. Effort is deliberately uniform across both routes so the routing stays the only variable; raising it on the Opus route alone is a one-line change if the legal records want more deliberation.

- [ ] **Decide whether the two non-document AI call sites follow** — PR #110 only moved calls that go through `api/generate-flha.js`. `server-lib/companyBrainSummary.js` and `server-lib/onboardingDrafting.js` are still on `claude-haiku-4-5`, and neither was considered as part of that change. `companyBrainSummary.js` is the one that actually matters: its output is what `src/companyProfile.js`'s `buildCompanyContextBlock` injects into all eight document prompts, so a weak summary quietly degrades every document the product generates, including the two now on Opus. It runs once a day per company on a cron, so cost is bounded and unrelated to document volume — which makes it a cheap place to spend. `onboardingDrafting.js` is founder-facing and runs once per company, so it matters less. Neither is urgent; both should be a deliberate decision rather than drift.

- [x] **Drop the last anon storage INSERT policy (`company-logos`)** — done 2026-09-25 as part of SOC 2 readiness remediation. `storage.objects` carried PUBLIC/anon INSERT policies on five buckets, letting anyone with the anon key from the client bundle write files with no session. Four were dropped on 2026-09-14; `company-logos` was deliberately left out of that scope. Confirmed nothing depends on it — onboarding (`api/login.js`'s `create_onboarding_upload_url`) and `AdminPanel.jsx` both upload through signed tokens, which don't consult RLS — dropped the policy and verified `storage.objects` now carries zero policies across all 8 buckets. Note the bucket being public for *read* is by design and unrelated. See `docs/schema/drop-anon-storage-insert-policies.sql`.
- [ ] **Namespace Supabase Storage objects by company** — `flha-reports` is one flat bucket shared by every tenant, and object names are deterministic (`FLHA_<CompanyName>_<ISO timestamp to the second>.pdf`). The 2026-09-14 security audit's findings 3 and 9 both root here: `create_upload_url` accepts a caller-chosen path, so any authenticated user can mint a write token for any path in the shared bucket, and there is no way to check ownership of a path on read because nothing in the path identifies the owner. The signed-URL oracle half is fixed (the server now signs the path stored on the row rather than one supplied in the request), but the real fix is deriving the path server-side as `<company_id>/<random>-<name>` and validating that prefix. Touches `server-lib/uploadUrls.js`, the four `create_upload_url` actions, all 10 PDF generators, and needs a read-path fallback so existing flat-path records keep resolving. `api/certifications.js:129-138` already does it right and is the reference.
- [x] **Apply `corrective-actions-equipment-recurrence-migration.sql`** — done 2026-09-17, before PR #121 merged, which is the order that matters (see below). Was the one manual step
  behind the supervisor-dashboard corrective-actions work. Adds five nullable columns to
  `corrective_actions` (`equipment_id`, `equipment_label`, `item_key`, `resolved_note`,
  `resolved_by`, `resolution_source`), backfills machine and checklist-item identity for the
  existing equipment-sourced rows, and adds two partial indexes. Every column is nullable
  with no default and no CHECK an existing writer could violate, so **the code on `main`
  keeps working byte-for-byte after it runs** — this is deliberately the opposite of
  `corrective-actions-any-source-migration.sql`, which added NOT NULL columns ahead of its
  code and silently stopped monthly corrective actions from being created. The reverse order
  is survivable too: `server-lib/correctiveActions.js` detects a missing column and retries
  the insert without the new fields, so a code deploy landing first degrades to today's
  behaviour rather than dropping a corrective action. **Applied before the code merged**
  anyway: had the code shipped first, a worker marking a post-trip item Fixed would have been
  told on screen that the corrective action was closed and the repair logged while neither
  happened — the fallback protects the data, not that message. Verification results are
  recorded in the migration file's header.
- [ ] **Two close-out mechanisms on one incident** — an incident or near miss carries a flat
  `reviewed` / `reviewed_by` / `review_notes` trio (`api/reports.js:94`) *and*, since break
  #5, real tracked corrective actions. Those answer different questions — "a supervisor has
  seen this" vs "somebody owns fixing it, by this date" — but nothing on the dashboard says
  so, so a supervisor who ticks "reviewed" can reasonably believe the report is closed while
  its corrective actions sit open in another tab. Same shape as the pre-trip/post-trip
  problem this note sits under: two records of one idea, in two places, neither aware of the
  other. Needs a conversation about which one is the close-out before anything is built.
- [ ] **Equipment Analytics still groups machines by label** — the last consumer keyed on
  `equipment_label` rather than `equipment_id` (`src/analyticsUtils.js:68,217`; break #7 in
  `docs/feature-interaction-map.md` fixed the weekly equipment report but not this). The
  visible consequence is that one machine sometimes picked from the fleet and sometimes typed
  by hand splits into two rows in Analytics while reading as one machine everywhere else —
  Maintenance, the weekly report, and now corrective actions and recurrence all key on the
  fleet id. A company comparing the two screens gets two different answers about the same
  machine. `tests/unit/equipment-report-grouping.test.js` is the reference for both
  directions of the fix, including the merge trap.
- [ ] **Set the Slack onboarding-notification webhook URL** — code is live (`server-lib/slack.js`, wired into `api/login.js`'s onboarding-submission and auto-approve paths) but silently a no-op until `SLACK_ONBOARDING_WEBHOOK_URL` is actually set. Manual step only Dillon can do: in Slack, create an Incoming Webhook for the target channel (api.slack.com/apps → Create App → From scratch → enable Incoming Webhooks → Add New Webhook to Workspace → pick a channel → copy the URL), then add it to the `flha-app` Vercel project as `SLACK_ONBOARDING_WEBHOOK_URL` (Project Settings → Environment Variables) and redeploy.
