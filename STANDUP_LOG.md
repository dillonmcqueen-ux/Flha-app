# Daily Standup Log

<!-- last-logged-commit: 531e13bca1bf339bef4928d763d1eb5c54f64ea2 -->
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

## Repeating Issues

- None yet — this list fills in automatically once the same issue shows up more than once.

## Today

- 21:50 — Fixed the hourly notes checker itself: it had been running on schedule all day
  but never actually saving anything. Turned out running it as a brand-new one-off each
  hour wasn't reliable, so it now runs inside a persistent, already-working session
  instead.
- 03:18 — Closed out a second, smaller bug in that same notes checker: it could have
  mistaken its own past notes for new project activity and kept re-reporting them forever.
  That's fixed too, so this system should now be fully reliable going forward.
- 03:45 — Double-checked the notes checker fix on a real scheduled run (not just a manual
  test) and confirmed it correctly logged real project activity on its own. Also switched
  it from checking every hour to every 4 hours, since that's plenty often for a running
  log like this.
- 04:19 — Finished automating new-customer signup end-to-end: qualifying signups can now
  get approved and set up automatically (you specifically asked to turn this on), new
  customers get a secure link to set their own login instead of an emailed password, and
  their starter equipment list and safety documents get AI-drafted for them to review
  before anything goes live. A data-privacy gap in the old signup form was also closed
  along the way.
- 04:19 — With the Vercel plan now on Pro, split two workaround files that only existed
  because of the old plan's limits back into their own clean files. One manual step is
  needed to finish this off — see Outstanding Items above about the Stripe webhook address.
