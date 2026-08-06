# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FORA: AI-assisted field safety paperwork. Workers describe a task by voice or
text and the app cross-references it against the company's uploaded SOPs to
generate hazards, controls, PPE, and compliance alerts, alongside seven other
document types (equipment inspections, toolbox talks, near miss/incident
reports, daily reports, monthly site inspections, custom documents).
Multi-tenant: every company's data, forms, and users are isolated from every
other company's. Three roles: **worker**, **supervisor**, **admin**. See
`README.md` for the full breakdown of login modes (company code vs. per-person
roster PIN vs. master code) and plan tiers (Basic/Advanced).

`website/` is a separate, static marketing site (no Node/Vite, no shared code
with the app) — see `website/README.md`. Don't treat it as part of the app's
build.

## Commands

```bash
npm install
npm run dev       # Vite dev server at localhost:5173
npm run build     # production build
npm run preview   # preview the production build locally
```

No lint script or config is configured in this repo.

### Tests (Playwright, end-to-end)

```bash
npx playwright test                       # full suite (spins up `npm run dev` automatically)
npx playwright test tests/flha.spec.js    # single file
npx playwright test -g "some test name"   # by title
npx playwright test --headed              # watch it run in a browser
```

Tests run against Chromium only, fully in the browser against a real Vite dev
server — there is no separate unit-test runner. All backend calls are stubbed
via `page.route(...)` in `tests/helpers.js` (`mockWorkerApis`,
`mockExternalServices`), so tests run offline/deterministically without
Supabase or Anthropic access. When adding a form or endpoint that a worker
flow depends on, add its stub to `tests/helpers.js` rather than hitting the
network in a test.

`/api/generate-flha` (and other AI calls) only work when deployed to Vercel
or run via `vercel dev` — a plain `npm run dev` falls back to demo hazard
data if the endpoint isn't reachable. This is expected for manual UI checks
outside Playwright.

## Architecture

React (Vite, no router — plain `useState` view-switching) frontend in `src/`,
Vercel serverless functions in `api/`, Supabase (Postgres + Storage) for
persistence.

```
src/main.jsx        renders Login or Onboarding based on pathname (only two entry points)
  Login.jsx          role picker -> code/PIN entry -> session -> renders WorkerMenu / Dashboard / AdminPanel
  WorkerMenu.jsx      worker's document-type picker -> renders one form component (App.jsx == FLHA form, Inspection.jsx, ToolboxTalk.jsx, etc.)
  Dashboard.jsx       supervisor's review/analytics/SOP-management surface
  AdminPanel.jsx      admin's company/roster/codes/plan-tier console
  generate*.js        one PDF generator per document type (jsPDF, loaded from a CDN at runtime, not bundled)
```

### The real access-control boundary is `api/`, not Supabase RLS

Every `api/*.js` file is a single Vercel serverless function reachable from
the Hobby plan's 12-function cap — **do not casually add a new file under
`api/`**; check whether the endpoint belongs inside an existing file first
(this is why Stripe webhook handling lives in `cron-equipment-reports.js` and
time-clock logic lives in `companydata.js` rather than each getting its own
file). Within a file, requests are dispatched by an `action` field in the
POST body, not by HTTP method/route — e.g. `flhas.js` handles
`resume`/`submit`/`list`/`delete`/`approve`/`count` all through one handler.

Each protected `api/*.js` function repeats the same shape:
1. Reject non-POST.
2. `verifySession(token)` — HMAC-signed (`SESSION_SECRET`) session token,
   checked for signature + 7-day TTL. Roster (per-person PIN) sessions are
   additionally re-checked against the `roster` table's `active` flag on
   *every* request, so deactivating someone takes effect immediately instead
   of waiting out the token.
3. Check `session.role` is allowed to perform the requested `action`.
4. For supervisor-scoped actions, verify the target row's `company_id`
   matches `session.companyId` before reading/writing it (admins bypass this
   check; supervisors never do).
5. Use `supabaseAdmin` (service-role key) for all queries — this bypasses RLS
   by design. RLS is enabled table-wide only as a deny-by-default backstop
   with no policies defined; it is not where access control lives. Never add
   RLS policies as a substitute for the checks above.

This `verifySession`/session-signing logic is currently duplicated per file
(`api/flhas.js`, `api/generate-flha.js`, `api/login.js`, etc.) rather than
shared — match the existing pattern in whichever file you're editing rather
than silently refactoring it into a shared module.

Private Storage buckets (`flha-reports`, signatures, incident-photos, etc.)
never hand back a working public URL from the DB — `server-lib/signedUrls.js`
(`signRows`) batch-converts stored paths into short-lived signed URLs for
list endpoints, and `pathFromStoredUrl`/`createSignedUrl` do the same
one-off in single-record responses. Follow this pattern for any new endpoint
that returns a stored file URL.

`src/supabaseClient.js` hardcodes the Supabase URL and **anon publishable
key** on purpose — it has no table access under RLS and is only used for
things like Storage; it is not a secret.

### Stripe billing

The Stripe webhook is registered at `/api/cron-equipment-reports` (shared
with the weekly equipment-report cron, again to stay under the 12-function
cap) and told apart from the cron trigger by the `stripe-signature` header.
It handles `checkout.session.completed` (stages plan tier + customer id,
keyed by Checkout Session id) and `customer.subscription.updated`/`deleted`
(keeps `suspended`/`stripe_subscription_status` in sync). A checkout
completes before the company exists in-app: `/onboarding?session_id=...`
-> `submit_onboarding_intake` (`api/login.js`) stages the row ->
`approve_onboarding_request` (`api/admin.js`) creates the company when an
admin approves it. See `README.md` for the full webhook event list and the
required env vars.

## Environment variables

See the table in `README.md` — set on Vercel (Project Settings ->
Environment Variables), not committed. Locally, features gated on
`ANTHROPIC_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY` (i.e. anything under `api/`)
only work via `vercel dev`, not plain `npm run dev`.
