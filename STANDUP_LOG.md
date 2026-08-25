# Daily Standup Log

<!-- last-logged-commit: e80fd52a240ba51cbea7b777ebab67dee6fe7bde -->
<!-- The line above is a watermark the hourly logger uses to find new commits since it last
     ran (git log <sha>..origin/main). Update it to the new HEAD SHA only after a successful
     push — leaving it unchanged on failure lets the next hourly run catch the same commits
     instead of losing them. Don't remove this comment. -->

This file is auto-updated by two scheduled agents (see `.claude/agents/standup-hourly-logger.md`
and `.claude/agents/standup-daily-reporter.md`). It is the running memory of what's happening on
this project day to day.

**To pick up outstanding work in a new chat:** say "read STANDUP_LOG.md and complete these
outstanding items" and point Claude at this file. The "Outstanding Items" list below is always
kept current.

Older days are moved to `STANDUP_LOG_ARCHIVE.md` each morning after the 9am summary is sent, so
this file stays short and easy to scan.

## Outstanding Items

- Correction: the Stripe billing dashboard's webhook address is already pointing to
  `/api/stripe-webhook` and confirmed enabled/live via the Stripe API (checkout +
  subscription lifecycle events) — this is done, not outstanding.
- Manually walk through the new automated signup flow start to finish (signup →
  auto-approval or manual approval → new customer's setup link → they set their own login →
  they review the AI-drafted equipment list and safety documents → done) — built and
  reviewed for data-isolation safety, but nobody's clicked through the real thing yet.
- Finish offline support for the last two form types (FLHA and Inspection) so they save
  drafts and retry failed submissions automatically like the others already do.
- Make two more form types' (MonthlyInspection, CustomForm) submissions safe to retry
  automatically, so they can get the same offline treatment.
- Test the offline-support work on a real live version of the app — nobody's clicked through
  it yet, especially the "go offline, fill out a form, come back online" path.
- Correction: the "company brain" feature (AI that learns each company over time from
  their own safety paperwork, never outside web lookups, to make generated documents fit
  that company better) is fully built — all 6 planned phases — and live in production,
  not just the first step. The database piece is turned on and in use. Ongoing tuning
  (thresholds, prompt wording, which document types get which context) is expected as
  real usage data comes in, but it's not a blocker. See `docs/scope-company-brain.md`.
- The small older pending items previously noted here (analytics installs, a Terms wording
  tweak) are done — Vercel Web Analytics is installed, and the marketing-copy-vs-Terms
  contradiction was fixed and merged (PR #33). Two more small PRs also merged since: a QA
  walkthrough script for the company brain feature (PR #27) and a quiet-mode fix for the
  standup logger itself (PR #25).
- New-signup notifications: `RESEND_API_KEY` was missing on the `flha-app` Vercel project
  (it only existed on the separate `fora-website` project), so real onboarding-notification
  emails to forafieldsolutions@gmail.com were silently never sending — PR #52 (merged) added
  logging so this is now visible in Vercel logs instead of failing silently. A fresh scoped
  Resend API key was generated and needs to be pasted into `flha-app`'s Vercel env vars as
  `RESEND_API_KEY` (Production) — not yet done. Separately, a `#onboarding-alerts` Slack
  channel was created, but the Incoming Webhook to post to it still needs to be set up by
  hand at api.slack.com/apps (blocked on mobile — that page redirects to the Slack app/App
  Store instead of loading; needs a desktop browser) and the resulting URL added as
  `SLACK_ONBOARDING_WEBHOOK_URL`. On hold until a computer is available.

## Repeating Issues

- None yet — this list fills in automatically once the same issue shows up more than once.

## Today

- 17:03 — Scoped out a big future feature: an AI "company brain" that learns each
  company's own habits and terminology over time from their own safety paperwork (never
  from outside the internet) to make generated documents fit that company better, with
  ground rules locked in that it can never lower the safety bar. Only the first small
  building block is actually built so far — the rest is a multi-phase plan for later.
