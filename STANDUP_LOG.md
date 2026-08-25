# Daily Standup Log

<!-- last-logged-commit: 61d9e101fae384116d12ebe0978632b1bc218e9f -->
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

- **The standup-logging automation itself had silently stopped.** The scheduled Routines that
  fire the hourly logger and the 9am reporter had been deleted or never survived some earlier
  cleanup — as of this review only the Gmail organizer, weekly competitive-intel, and 3-day
  privacy-audit Routines still existed. That's why this file's "Today" section hadn't moved in
  12 days despite 20+ real commits landing (visual redesign, marketing site consolidation, Terms
  fixes, Admin Panel wording cleanup, onboarding-notification logging, the Gmail organizer
  itself). **Fixed as part of this review: both Routines were recreated** (hourly logger every
  4 hours; daily reporter at 9am Mountain / 15:00 UTC). One catch on the daily reporter: this
  organization won't let a Routine created through this API path carry a Slack connector grant,
  so its first live firing may not be able to send the Slack DM — it's been instructed to still
  do the archive/reset/commit either way and say clearly in its summary if Slack was unavailable,
  but if that happens, recreate it from the claude.ai Routines UI instead (which can attach
  connectors) or run it manually.
- **Correction: offline support for FLHA and Inspection, and idempotent submission for
  MonthlyInspection/CustomForm, are already done** — a previous "Outstanding Items" entry said
  these were still needed. Checked the actual code directly: `WorkerMenu.jsx`'s
  `RESUBMIT_HANDLERS` map already covers all 8 worker-facing forms (`flha`, `inspection`,
  `monthly`, `customform` included alongside the other 4), and `docs/scope-offline-capability.md`
  confirms all 5 phases (session persistence, submission queue + idempotency, AI-assist fallback,
  offline photos on Incident, and the PWA shell/`sw.js`) are built. `TODO.md`'s offline-capability
  entry is stale on this point too and should be corrected to match. What's genuinely still open:
  most of this has only been verified by code review / automated tests, not a real click-through
  on a live phone — see next item.
- Test the offline-support work on a real live version of the app — nobody's clicked through
  it yet on the actual deploy, especially "go offline mid-form, submit, come back online" across
  all 8 forms, and the Incident offline-photo path.
- Manually walk through the automated signup flow start to finish (signup → auto-approval or
  manual approval → new customer's setup link → they set their own login → they review the
  AI-drafted equipment list and safety documents → done) — built and reviewed for data-isolation
  safety, but nobody's clicked through the real thing yet.
- New-signup notifications, two separate manual steps still open (code side is done — PR #52
  added visibility into Vercel logs when either send is skipped):
  - A fresh scoped Resend API key was generated and needs to be pasted into the `flha-app`
    Vercel project's env vars as `RESEND_API_KEY` (Production) — not yet done.
  - A `#onboarding-alerts` Slack channel exists, but its Incoming Webhook still needs to be
    created by hand at api.slack.com/apps and the URL added as `SLACK_ONBOARDING_WEBHOOK_URL`
    in Vercel — on hold until a desktop browser is available (that page redirects to app/store
    links on mobile).
- The Stripe billing dashboard's webhook address, RLS coverage, storage bucket privacy, and the
  Vercel Pro-plan function-cap unwind are all confirmed done — no action needed on any of those.

## Repeating Issues

- **STANDUP_LOG.md's own Outstanding Items list has now gone stale twice** (once on the company
  brain item, corrected in PR #37; now again on the offline-capability item, corrected in this
  review). Both times the underlying work actually finished before the log caught up. Worth
  the hourly logger being a little more willing to re-verify an existing Outstanding Item
  against the current code, not just add new ones, when a related commit lands.

## Today

- Reviewed this file and its archive against the actual repo state. Found and fixed a real
  problem: the automated hourly/daily standup-logging system had stopped running around
  2026-08-13 and nobody had noticed, because the file only auto-updates when it fires — it
  wasn't visibly broken, just silent. Recreated both scheduled jobs.
- Corrected a stale claim in Outstanding Items: offline support for FLHA, Inspection,
  MonthlyInspection, and CustomForm was already finished, not still pending — verified directly
  against the code rather than trusting the old note.
