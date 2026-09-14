# Daily Standup Log

<!-- last-logged-commit: 473fe2199cbde16d20d32d3f1ed8be9034f41c67 -->
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

- **The automated standup logging has stopped running again — second time.** The scheduled
  jobs that are supposed to update this file every few hours and send the 9am summary do not
  exist. Only three scheduled jobs are actually registered right now: the Gmail inbox
  organizer, the weekly competitor report, and the 3-day security audit. The previous entry
  in this file claimed both standup jobs had been recreated on 2026-08-25; they are not there
  now. Consequence: this file sat 101 real commits out of date, and the "Today" section still
  showed early-September work. Needs someone to recreate them and then actually confirm they
  fire — last time they were recreated and silently went away again.
- **Set the Slack notification link for new signups.** Still the one genuinely unfinished
  manual step. The code is live but does nothing until an Incoming Webhook is created by hand
  at api.slack.com/apps and its URL added to the hosting settings. Needs a desktop browser —
  that page redirects to app-store links on mobile.
- **Nobody has click-tested offline mode on a real phone.** The offline work is built and now
  covered by automated tests, but "go offline mid-form, submit, come back online" has never
  been done on an actual phone against the live site, across all 8 forms plus the incident
  photo path.
- **Four security items left open on purpose** (full detail in `TODO.md`):
  - Uploaded files aren't separated by company in storage. Everything works and nothing is
    exposed today, but it's the root cause behind two findings that were patched around rather
    than fixed properly. The biggest remaining piece of work.
  - One last storage permission still lets anyone upload a company logo without logging in.
    Nothing depends on it; it's a one-line change whenever wanted.
  - A worker can still mark their own highest-risk hazard assessment as "complete" and skip
    supervisor approval, because that decision is made in the app rather than on the server.
  - The app loads its PDF tool from a public code library that allows more than it needs to.
- **Done since the last update, removed from this list:** the new-customer signup flow has now
  been walked end-to-end on the live site with a real test company (signup → invite email →
  set own PIN → log back in), which also confirms the email sending key is set and working.

## Repeating Issues

- **The standup logging keeps dying quietly — this is the second confirmed time.** It stops,
  nothing looks broken (the file just doesn't move), and it's only noticed when someone reads
  the file and finds it months behind. First caught 2026-08-25 after a 12-day gap; caught again
  2026-09-14 after roughly a 3-week gap and 101 unlogged commits. The recreate-it fix has now
  failed to stick once. Next time it's fixed, it needs a way to confirm it's actually firing
  rather than assuming.
- **This file's Outstanding Items list keeps carrying things that are already finished** — now
  three separate times (the company brain item, the offline-capability item, and today the
  signup-walkthrough and email-key items, both of which were quietly completed on 2026-09-13).
  Anything on this list should be checked against the real code or commit history before being
  carried forward, not just copied along.

## Today

- Ran the full security audit. Most of it came back clean — storage privacy, database access
  rules across all 43 tables, no passwords or keys sitting in the code, preview-site protection,
  and payment webhook verification all fine.
- **Found and fixed a serious set of login weaknesses.** In combination they would have let
  someone with no account at all guess a company's code, pull that company's full employee list,
  and then break into a worker's account by guessing PINs — the lockout that was supposed to
  stop that never actually triggered. All closed, and the database change behind the fix is live.
- **Fixed a forgery hole in every form submission.** A worker could have made a document look
  like a supervisor had signed off on it, marked their own injury report as already reviewed,
  back-dated an inspection that never happened, or filed paperwork under a coworker's name. Now
  only the fields a form is actually meant to set can be set.
- **Fixed a leak where one company could pull another company's PDFs.** Reports live in one
  shared storage area with predictable file names, and the app would hand out a working link to
  any file name it was given. It now only ever links the file that document actually points at.
- **Closed unauthenticated file uploads.** Anyone who viewed the website's source could upload
  files into four private storage areas without logging in — free storage on our bill, and it
  bypassed the upload security that was supposed to be there. Four of five now closed; the last
  one is deliberately left and noted above.
- **Put limits on the public signup form.** It could previously be scripted to send unlimited
  emails from our own verified email domain (a phishing risk that would wreck our sending
  reputation), flood Slack, and run up costs. Now capped per visitor.
- **Repaired the automated test suite — it had been almost entirely broken.** 24 of its 25
  tests were failing, so it was catching nothing. Every failure was the tests describing an older
  version of the app (buttons renamed, the worker menu reorganised, the time clock now asking for
  location). All 25 pass now, confirmed twice. This matters because a mistake made earlier tonight
  reached the live site precisely because nothing was there to catch it.
- **Honest note: one of tonight's own fixes briefly broke something.** The forgery fix
  accidentally dropped three pieces of information forms were meant to save — who signed an
  injury report, and which machine an inspection was for. Caught and fixed within the hour, and
  no real data was lost because nobody submitted anything in that window. The verification method
  was tightened afterwards so the same mistake can't repeat silently.
- Corrected the weekly competitor report. It recommended switching AI models to cut costs, but
  a check of the actual code showed we're already on the cheap model everywhere — there was no
  saving to be had. That suggestion had been rolling over unactioned for five weeks without
  anyone checking whether it applied.
- Also updated the app's build tooling to clear two security warnings in its dependencies.
