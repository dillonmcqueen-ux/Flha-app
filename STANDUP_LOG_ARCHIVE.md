# Daily Standup Log Archive

Completed days move here from `STANDUP_LOG.md` each morning after the 9am summary is sent.
Newest day on top.

## 2026-08-13 through 2026-08-24 (backfilled, rolled in from the previous "Today" section)

_The automated logger had stopped firing after 2026-08-13 (see the 2026-08-25 review entry in
STANDUP_LOG.md's Outstanding Items for how this was found and fixed), so this stretch never got
its own daily entries. Backfilled here from the commit history instead of leaving it blank:_

- Scoped a big future feature (this was the original "Today" entry, never archived): an AI
  "company brain" that learns each company's own habits and terminology over time from their own
  safety paperwork, never the outside internet, so generated documents fit that company better —
  with a ground rule that it can never lower the safety bar.
- Gave the logged-in app a real visual identity (black/orange/white FORA branding, replacing the
  generic default look) across the Dashboard, Worker Menu, the FLHA form, and Onboarding.
- Fixed a couple of legal/marketing accuracy issues: Terms wording clarified on IP and generated-
  content ownership, and a place where marketing copy contradicted the Terms' liability language.
- Fixed some real bugs: deleting a company could fail with a database error, and some admin input
  text was invisible (white-on-white); also added Slack notifications for new signups and fixed
  white-on-light dropdown text/harsh white headers.
- Cleaned up the public marketing website: consolidated it down to 5 pages, moved the live demo
  to a more prominent spot, rewrote the "About FORA" section as a personal bio, and removed every
  place the site incorrectly implied a customer could access "the Admin Panel" (that panel is
  founder-only).
- Added a daily Gmail inbox-organizing helper (labels and archives routine automated mail every
  morning, leaves real correspondence and unread/starred mail alone).
- Added logging so a silently-failing new-signup notification (missing API key/webhook config)
  now shows up in Vercel's logs instead of just vanishing — see STANDUP_LOG.md's Outstanding
  Items for the two manual steps still needed to actually turn those notifications on.

## 2026-08-13 (rolled in from the previous "Today" section)

- Fixed the hourly notes checker itself: it had been running on schedule all day but never
  actually saving anything. Turned out running it as a brand-new one-off each hour wasn't
  reliable, so it now runs inside a persistent, already-working session instead.
- Closed out a second, smaller bug in that same notes checker: it could have mistaken its
  own past notes for new project activity and kept re-reporting them forever. That's fixed
  too, so this system should now be fully reliable going forward.
- Double-checked the notes checker fix on a real scheduled run (not just a manual test) and
  confirmed it correctly logged real project activity on its own. Also switched it from
  checking every hour to every 4 hours, since that's plenty often for a running log like
  this.
- Finished automating new-customer signup end-to-end: qualifying signups can now get
  approved and set up automatically (specifically requested), new customers get a secure
  link to set their own login instead of an emailed password, and their starter equipment
  list and safety documents get AI-drafted for them to review before anything goes live. A
  data-privacy gap in the old signup form was also closed along the way.
- With the Vercel plan now on Pro, split two workaround files that only existed because of
  the old plan's limits back into their own clean files. One manual step is needed to
  finish this off — the Stripe webhook address (carried forward in Outstanding Items).

## 2026-08-12

_First day of the new daily-notes system — this recap covers recent activity, since the
hourly logger hadn't yet recorded anything by the time of this first morning summary._

- Set up a new daily notes system (this file and `STANDUP_LOG.md`) so project status is easy
  to pick back up in any new chat.
- Added automatic weekly competitor-research reports.
- Researched competitors and wrote a step-by-step plan for offline support, so workers on
  jobsites with spotty signal don't lose their work.
- Fixed a real privacy issue: preview versions of the site were viewable by anyone without
  logging in — that's locked down now.
- Added several automated helpers that continuously check the app's design, usability, and
  data-privacy for mistakes.
- Made solid progress on offline support: forms now save drafts automatically and survive
  interruptions; if a submission fails from no signal, it's saved and retried automatically
  instead of silently disappearing — done for most (not yet all) forms.
