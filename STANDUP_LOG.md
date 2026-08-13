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

- **Time-sensitive:** update the Stripe billing dashboard's webhook address (it needs to
  point to the new `/api/stripe-webhook` instead of the old shared address) — until that's
  changed, payment webhook events stop arriving.
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
- A few small, older pending items are sitting open on GitHub (analytics installs, a Terms
  wording tweak) — low priority, not urgent.
- New: a big future feature was scoped out — an AI that gets to know each company over
  time (from their own safety paperwork, never outside web lookups) to make its generated
  documents fit that company better. The plan and ground rules are written down; only the
  first small step (the underlying data storage) is built so far, and even that still needs
  to be turned on in the database by a human before it does anything.

## Repeating Issues

- None yet — this list fills in automatically once the same issue shows up more than once.

## Today

- 17:03 — Scoped out a big future feature: an AI "company brain" that learns each
  company's own habits and terminology over time from their own safety paperwork (never
  from outside the internet) to make generated documents fit that company better, with
  ground rules locked in that it can never lower the safety bar. Only the first small
  building block is actually built so far — the rest is a multi-phase plan for later.
