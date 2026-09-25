# FORA

AI-assisted field safety paperwork. Workers describe a task by voice or text
and the app cross-references it against the company's uploaded SOPs to
generate hazards, controls, required PPE, and compliance alerts — alongside
seven other document types (equipment inspections, toolbox talks, near
miss/incident reports, daily reports, monthly site inspections, and custom
documents). Multi-tenant: every company's data, forms, and users are
isolated from every other company's.

## Roles & login

Three roles: **worker**, **supervisor**, and **admin**.

- **Company login** — each company gets its own login code(s). New
  companies start on a single shared `company_code`; some companies
  predate that and still use separate legacy `worker_code`/`supervisor_code`
  values. Admin can edit any of these from the Admin Panel's Codes tab.
- **Individual roster login** — a company can opt into per-person logins
  instead of a shared code: each worker/supervisor gets their own name and a
  6-digit PIN (managed from the Admin Panel's Roster tab), so deactivating
  one person cuts off exactly that person, immediately. This is what
  auto-fills a person's name on the paperwork they submit.
- **Master code** — a single admin-settable code that logs into any
  company as either role, for admin use. Every use is logged
  (Admin Panel → All Codes → recent master-code logins).

## Plan tiers

Each company is set to **Basic** (up to 10 seats) or **Advanced** (11–50
seats) from the Admin Panel. This caps how many active roster
workers+supervisors a company can have, and controls how much detail shows
on that company's Analytics tab.

## What's in the app

- **Worker forms**: FLHA, Equipment Inspection, Toolbox Talk, Near Miss,
  Incident, Daily Report, Monthly Site Inspection, and admin-defined Custom
  Documents — each toggleable per company from the Admin Panel.
- **Supervisor Dashboard**: reviews every submission type, groupable and
  collapsible for high-volume companies, plus an Equipment hub (editable
  fleet, preventative maintenance, service records, weekly hours, expiry
  dates, fuel logs and the weekly usage report, each gated on the modules
  that company bought), a tiered Analytics view, and SOP management.
- **Admin Panel**: onboard and configure companies, manage plan tier,
  manage each company's login codes and roster, toggle which document
  types a company uses, and view cross-company code/login activity.

## Architecture

React (Vite) frontend, Vercel serverless functions in `api/`, Supabase
(Postgres) for storage. The service-role key used by the `api/` functions
is the real access-control boundary — every request is checked against a
signed session before it touches the database. Row Level Security is
enabled on every table as a deny-by-default backstop (no policies are
defined, so direct anon-key access is refused), not the primary gate.

## Environment variables

Set these on Vercel (Project Settings → Environment Variables):

| Variable | Required | Used for |
|---|---|---|
| `SUPABASE_URL` | Yes | Every `api/*.js` function |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Every `api/*.js` function — bypasses RLS, the real access-control layer |
| `SESSION_SECRET` | Yes | Signs session and login-ticket tokens |
| `ANTHROPIC_API_KEY` | Yes | `/api/generate-flha` (AI hazard generation); also `api/admin.js`/`api/login.js` via `server-lib/onboardingDrafting.js` (AI-drafted equipment/SOPs on the claim-link page) — silently skipped (draft_status `'none'`) if unset |
| `ADMIN_CODE` | No | A bootstrap admin login code, separate from the in-app admin-settable master code |
| `CRON_SECRET` | No | Secures both cron jobs in `vercel.json` (`/api/cron-equipment-reports`, `/api/cron-company-brain-summary`) |
| `STRIPE_SECRET_KEY` | Yes (for billing) | `/api/stripe-webhook` (Stripe webhook handling) and `/api/admin.js` (subscription lookup on onboarding approval) |
| `STRIPE_WEBHOOK_SECRET` | Yes (for billing) | `/api/stripe-webhook` — verifies the `Stripe-Signature` header on incoming Stripe events |
| `APP_ORIGIN` | No | `/api/checkout` — where Stripe sends a buyer after a successful checkout. Falls back to the request host, then `https://portal.forafieldsolutions.com`, so leaving it unset is safe; set it only when a preview deployment should redirect to itself rather than to production |
| `RESEND_API_KEY` | No | `server-lib/email.js` (Resend transactional email API) — onboarding/claim-link and certification-expiry email delivery. `sendEmail()` is silently a no-op and logs a warning if unset |
| `SLACK_ONBOARDING_WEBHOOK_URL` | No | `server-lib/slack.js` — Slack Incoming Webhook for onboarding-submission and auto-approve notifications from `api/login.js`. Silently a no-op if unset |

## Stripe billing

The pricing page (`website/pricing.html`) has no Payment Links. Its
calculator builds a link to `api/checkout.js`, which creates a Stripe
Checkout Session on the fly from the module keys in the query string and
303-redirects the buyer to it. Every amount comes from
`server-lib/pricing.js` server-side, so the URL chooses which modules, never
what they cost, and there is no amount or total parameter to tamper with.
Stripe needs no Product or Price objects configured: the line items are
built inline with `price_data`, so changing a price is a one-line change in
`server-lib/pricing.js` (mirrored in the calculator on the pricing page,
which is a separate Vercel project and cannot import it).

Line items are the platform base plus one per purchased module, all monthly
recurring, each carrying the 3% card surcharge. The one-time setup fee goes
through `subscription_data.add_invoice_items` so it lands on the first
invoice only. Stripe anchors the billing cycle to the moment the
subscription is created, which is the "monthly from signup date" behaviour,
so no `billing_cycle_anchor` is set.

Note the cross-project coupling: `website/pricing.html` hardcodes
`https://portal.forafieldsolutions.com/api/checkout` in two places (the
no-JS fallback `href` and the `CHECKOUT` constant in its script). Renaming
`api/checkout.js` breaks every Checkout button on the live pricing page
until the website project is separately redeployed, and `vercel.json`'s
production ignore filter excludes `website/`, so a commit touching only
those two lines will not trigger an app-project build. The Stripe webhook is registered at its own dedicated endpoint,
`api/stripe-webhook.js` — it used to share `api/cron-equipment-reports.js`
with the weekly cron job (the same reason time clock report logic used to
live in `companydata.js` instead of its own file) to stay under Vercel's
12 serverless function cap on the Hobby plan; both were split back into
their own files once the project moved to the Pro plan. It listens for
`checkout.session.completed` (stages the purchased plan tier, module list
and Stripe customer id, keyed by Checkout Session id) and
`customer.subscription.updated`/`deleted` (keeps an existing company's
`suspended` flag and `stripe_subscription_status` in sync — a canceled/
unpaid subscription suspends access automatically).

A Checkout Session id is effectively a bearer token: it travels in a
redirect URL, and whoever holds it can present it to
`submit_onboarding_intake` as proof of purchase. Three things keep that from
becoming an account takeover:

1. `api/checkout.js` builds the success URL from `APP_ORIGIN` or a hardcoded
   production origin, never from a request header. An earlier draft fell back
   to `x-forwarded-host`, which a non-browser client can set, so curling the
   endpoint would mint a genuine FORA-branded Checkout Session redirecting to
   an attacker's host. Do not reintroduce a header-derived origin here.
   (`server-lib/email.js`'s `siteOrigin()` still has that shape for
   claim/edit/wallet links and deserves the same treatment.)
2. A session can be claimed once. `api/login.js` refuses a session another
   request already holds, and a unique index
   (`onboarding_requests_stripe_session_unique`) enforces it against a race;
   losing that race drops the purchase and lands the submission in the manual
   queue rather than failing it.
3. Auto-approval requires the submitted contact email to match the email
   Stripe recorded on the checkout. A mismatch is not rejected, since a
   company legitimately pays from accounts@ and onboards from the site
   contact, but it never auto-provisions.

`companies.stripe_customer_id` also carries a unique index, because
`api/stripe-webhook.js` syncs subscription status by customer id alone and
two companies sharing one would let a subscription event write onto the
wrong tenant's row.

A checkout finishes before the customer has a company in the app:
`api/checkout.js` sets the success URL to
`/onboarding?session_id={CHECKOUT_SESSION_ID}`, and
`submit_onboarding_intake` (`api/login.js`) claims the staged row so the
plan tier, module list and customer id carry through to
`approve_onboarding_request` (`api/admin.js`) when an admin approves the
request and the company is created.

The module list is what makes modular pricing real rather than cosmetic.
`api/customforms.js` treats a missing `company_document_settings` row as
"active", so a company with no rows sees every built-in document type. On
approval, `provisionCompanyFromRequest` (`server-lib/onboardingApproval.js`)
therefore writes an explicit row for every document key any module can
unlock: true for the ones the purchase covers, false for the rest. A
request whose `modules` is NULL (an admin-created company, or a checkout
predating modular pricing) keeps the old everything-on default rather than
being silently stripped back.

Once approved, credentials are delivered via a self-serve **claim link**
(`/claim?token=...`, `src/ClaimAccount.jsx`) instead of the admin emailing
PINs: the contact assigns their own roster PINs, and reviews an AI-drafted
equipment list (parsed from `units_list`) and AI-drafted SOPs (extracted
from the uploaded files) before either is saved — SOPs stay unpublished
until then. That drafting runs asynchronously after company creation
(`server-lib/onboardingDrafting.js`), not inside `approve_onboarding_request`
itself, since there's no `maxDuration` override in `vercel.json` for it to
safely run inside. A submitter can also fix and resubmit their own request
via `/onboarding?edit=<token>` — either on their own, or after an admin
flags something via `update_onboarding_status`'s `needs_info` status.

In the Stripe Dashboard, register the webhook endpoint at
`https://<your-domain>/api/stripe-webhook` for
`checkout.session.completed`, `customer.subscription.updated`, and
`customer.subscription.deleted`, and set the resulting signing secret as
`STRIPE_WEBHOOK_SECRET` on Vercel. **If you're updating an existing
registration that pointed at `/api/cron-equipment-reports`, change the URL
by hand** — that configuration lives in the Stripe Dashboard, outside this
repo, and nothing in code updates it automatically.

`src/supabaseClient.js` separately hardcodes the Supabase project URL and
**anon publishable key** — that's expected, not a leaked secret: it's a
public key with no table access (see the RLS note above), used only for
things like file storage.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Go to vercel.com → New Project → Import your GitHub repo.
3. Before deploying, add the environment variables listed above.
4. Click Deploy. Vercel gives you a live link like `flha-app.vercel.app`.

## Local development

```bash
npm install
npm run dev
```

Note: the AI generation step (`/api/generate-flha`) only works once deployed
to Vercel (or run via `vercel dev`), since it's a serverless function. Locally
with plain `npm run dev`, the app will fall back to demo hazard data if that
endpoint isn't reachable — this is expected and fine for UI testing.
