# Daily Standup Log Archive

Completed days move here from `STANDUP_LOG.md` each morning after the 9am summary is sent.
Newest day on top.

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
