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
  4-digit PIN (managed from the Admin Panel's Roster tab), so deactivating
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
  collapsible for high-volume companies, plus equipment/preventative-
  maintenance tracking, a tiered Analytics view, and SOP management.
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
| `CRON_SECRET` | No | Secures the weekly equipment-report cron job (`vercel.json`) |
| `STRIPE_SECRET_KEY` | Yes (for billing) | `/api/cron-equipment-reports` (Stripe webhook handling) and `/api/admin.js` (subscription lookup on onboarding approval) |
| `STRIPE_WEBHOOK_SECRET` | Yes (for billing) | `/api/cron-equipment-reports` — verifies the `Stripe-Signature` header on incoming Stripe events |

## Stripe billing

The pricing page (`website/index.html`) links to two live Stripe Payment
Links (Basic, Advanced), each bundling a recurring plan price + one-time
setup fee. The Stripe webhook is registered at `/api/cron-equipment-reports`
— it shares that file (not a dedicated `/api/stripe-webhook`) to stay under
Vercel's 12 serverless function cap on the Hobby plan, the same reason the
time clock report logic lives in `companydata.js` instead of its own file.
Requests are told apart by the `stripe-signature` header, which only Stripe
sends. It listens for `checkout.session.completed` (stages the purchased
plan tier + Stripe customer id, keyed by Checkout Session id) and
`customer.subscription.updated`/`deleted` (keeps an existing company's
`suspended` flag and `stripe_subscription_status` in sync — a canceled/
unpaid subscription suspends access automatically).

A checkout finishes before the customer has a company in the app: the
Payment Link redirects to `/onboarding?session_id={CHECKOUT_SESSION_ID}`,
and `submit_onboarding_intake` (`api/login.js`) claims the staged row so the
plan tier and customer id carry through to `approve_onboarding_request`
(`api/admin.js`) when an admin approves the request and the company is
created. Approval still requires an admin's click — nothing auto-approves.

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
`https://<your-domain>/api/cron-equipment-reports` for
`checkout.session.completed`, `customer.subscription.updated`, and
`customer.subscription.deleted`, and set the resulting signing secret as
`STRIPE_WEBHOOK_SECRET` on Vercel.

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
