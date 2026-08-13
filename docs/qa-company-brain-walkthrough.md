# QA: company brain browser walkthrough

Companion to `docs/scope-company-brain.md`. That doc's Phase 1-6 work is
**live in production** as of this writing — deployed, migration applied,
and verified at the database/code level (tenant-scope reviews, RLS checks,
adversarial input fuzzing on the sanitizer functions, direct DB round-trip
tests — see the scope doc and the session that produced it for details).

**What this script covers that the DB-level testing couldn't**: an actual
interactive browser session — real login, real AI generation calls, real
UI rendering — clicking through the app the way a worker, supervisor, or
admin actually would. Run this from a session/machine that can reach
`https://portal.forafieldsolutions.com` (the environment that built this
feature could not — see the "known gap" note in `docs/scope-company-brain.md`).

Every test company created here uses a `ZZZ_CLAUDE_QA_` prefix so it's
unambiguous which rows are disposable. **Delete them all at the end** —
see Cleanup.

## Prerequisites

- Admin access to the Admin Panel (master code, or an existing admin login).
- About 20-30 minutes.
- A way to open two browser sessions that don't share cookies (e.g. a
  normal window + an incognito/private window) for the tenant-isolation
  test.

## Setup: two disposable test companies

1. Log into the Admin Panel.
2. **Onboard Company** → create `ZZZ_CLAUDE_QA_A` with a company code you'll
   remember (e.g. `QATESTA`). Leave roster login off (use the shared
   company code) to keep this simple — worker/supervisor/admin all log in
   with the same code + role picker.
3. Repeat for `ZZZ_CLAUDE_QA_B` / code `QATESTB` — this second company only
   exists for Test 6 (tenant isolation); everything else uses company A.
4. For company A: Admin Panel → manage → SOPs tab → add 2-3 short policies
   (anything plausible, e.g. "Wear a hard hat on active job sites.",
   "Use a spotter when backing up equipment."). This gives the FLHA
   generator something to work with, closer to real usage than an empty
   SOP list.

## Test 1 — Cold start (Phase 5 graceful degradation)

Company A has no `company_profiles` row yet (nothing has run Phase 2/4 for
it — those only fire from real onboarding-request/cron flows, not the
"Onboard Company" quick-create path used above).

1. Log in to company A as a worker.
2. Start a new FLHA, describe a simple task (e.g. "operating an excavator
   to strip topsoil on a level site").
3. Generate.

**Expected:** hazards generate normally, same as before this feature
existed — no error, no visible difference, no "loading company context"
delay. This confirms a company with an empty/missing profile degrades
cleanly rather than breaking.

- [ ] Pass

## Test 2 — Company profile view/edit (Phase 1 + Phase 6 UI)

1. Admin Panel → manage company A → **🧠 Brain** tab (next to
   Profile/SOPs/Sites/Equipment).
2. Confirm the "Company profile" card loads with empty fields and no
   status badge issue (no profile row yet — fields should just be blank,
   page shouldn't error).
3. Fill in:
   - Industry: `earthworks / heavy civil`
   - Equipment summary: `Fleet is mostly excavators and dozers for surface work.`
   - Terminology notes: `This company calls a spotter a "signaller."`
4. Click **Save company profile**.
5. Reload the page, reopen the Brain tab.

**Expected:** all three fields persisted exactly as entered, status badge
now reads **Confirmed** (green), a "Last refreshed from activity" line may
or may not appear (only set by Phase 4's batch job, not by this manual
save).

- [ ] Pass

## Test 3 — FLHA-edit signal capture (Phase 3)

1. Log in to company A as a worker, start a new FLHA.
2. Describe a task, generate hazards with AI.
3. Before submitting: remove one hazard, and change the risk level on
   another (e.g. Medium → High) using the edit controls.
4. Submit the FLHA (sign and complete).
5. Back in Admin Panel → company A → Brain tab → **Activity trends** card.

**Expected:** "FLHA edits" count is at least 1, and under "Hazards most
often removed by workers" / a risk-change reflected somewhere in the
tallies, you should see the hazard name you removed. (Wording-only edits
— e.g. just retyping a control's text without changing the hazard name or
risk — deliberately do **not** show up here; that's by design, not a bug.)

- [ ] Pass

## Test 4 — Toolbox talk / incident / near-miss signal capture (Phase 3)

1. As a worker in company A, submit one Toolbox Talk (any topic, e.g.
   "Trench safety").
2. Submit one Near Miss report (any description).
3. Submit one Incident report (any type/description).
4. Admin Panel → company A → Brain tab → Activity trends.

**Expected:** counts for "Toolbox talks", "Near misses", "Incidents" each
increment by 1, and the topic/category you entered appears in the
matching "Common ___" list below. (Near-miss "involvement" is free text by
design — see the label in the UI — so it may show as a one-off entry
rather than a repeated pattern; that's expected, not a bug.)

- [ ] Pass

## Test 5 — Generation reflects the saved profile (Phase 5 qualitative check)

This one is qualitative — AI output isn't deterministic, so look for a
directional effect, not an exact match.

1. With company A's profile still showing the terminology note from Test 2
   ("calls a spotter a 'signaller'"), start a new FLHA or Toolbox Talk
   describing a task that would naturally involve a spotter (e.g. "backing
   up a dump truck near other workers, using a spotter").
2. Generate.

**Expected:** reasonable chance the generated content uses "signaller"
somewhere, or at least doesn't contradict the note. This is a soft signal
— the LLM isn't guaranteed to use it every time — so don't treat one
miss as a failure; try 2-3 times if the first generation doesn't show it.

- [ ] Pass / soft signal observed

## Test 6 — Tenant isolation (the highest-stakes test in this list)

1. In your primary browser window: log into company A as admin, open the
   Brain tab, leave it open.
2. In a second, cookie-isolated window (incognito/private): log into
   company B as admin.
3. Open company B's Brain tab.

**Expected:** company B's profile is completely empty/independent — none
of company A's industry/equipment/terminology text, no shared trend
counts. Company B should have zero FLHA edits / toolbox talks / etc.
logged, since nothing has been submitted under it.

4. As a stronger check if you're comfortable with it: try directly editing
   the URL or intercepting a request (browser dev tools → Network tab) to
   see the `companyId` a request sends, and try changing it to company A's
   id while logged in as company B's admin session. This should fail (403
   or scoped to company B regardless) — this exact scenario is what
   `tenant-scope-reviewer` already checked at the code level for every
   action in this feature, so this step is a live confirmation of that
   analysis, not new ground.

- [ ] Pass — no cross-contamination, no cross-tenant access possible

## Test 7 — Batch summarization (Phase 4) — optional, needs either patience or the CRON_SECRET

The daily cron (`/api/cron-company-brain-summary`, 4:00 UTC) needs **5+
signals** since a company's last summarization before it does anything for
that company. Tests 3-4 above only produced a handful of signals for
company A — submit a few more of each type if you want to cross the
threshold (5 total is the minimum, spread across types is fine).

Two ways to verify this phase:
- **Wait**: after 4:00 UTC with 5+ signals logged, check company A's Brain
  tab the next day — `hazard_emphasis` should be populated and
  "Last refreshed from activity" should show a recent timestamp.
- **Trigger manually**, if you have the `CRON_SECRET` value (Vercel
  project env vars): `POST https://portal.forafieldsolutions.com/api/cron-company-brain-summary`
  with header `Authorization: Bearer <CRON_SECRET>`. Response is JSON with
  a per-company results array — check company A's entry.

**Expected:** `hazard_emphasis` on company A's profile gets populated with
`{category, note}` entries that plausibly reflect the signals submitted
(e.g. if you removed a "Fall hazard" in Test 3, don't expect the emphasis
to encourage *less* caution about falls — re-read the "Safety floor"
section of `docs/scope-company-brain.md` if anything here looks like it's
softening risk language, since that would be a real bug worth reporting).

- [ ] Pass / Skipped (documented why)

## Cleanup — do this even if some tests failed

1. Admin Panel → delete company `ZZZ_CLAUDE_QA_A` and `ZZZ_CLAUDE_QA_B`
   entirely (this should cascade-delete their `company_profiles` and
   `company_signals` rows along with everything else, per the migration's
   `on delete cascade`).
2. If the Admin Panel doesn't offer full company deletion, at minimum
   deactivate/suspend both test companies and note in the results below
   that manual DB cleanup is still needed (whoever has direct DB access
   can run the same pattern used during the earlier DB-level testing:
   `delete from companies where name like 'ZZZ_CLAUDE_QA_%';` and confirm
   zero rows remain in `companies`, `company_profiles`, and
   `company_signals` for those names).

## Results summary

| Test | Result | Notes |
|---|---|---|
| 1. Cold start | | |
| 2. Profile view/edit | | |
| 3. FLHA-edit signal | | |
| 4. Toolbox/incident/near-miss signal | | |
| 5. Generation reflects profile (qualitative) | | |
| 6. Tenant isolation | | |
| 7. Batch summarization | | |
| Cleanup done | | |

Report back anything that fails Test 6 immediately regardless of the
others — that's the one where a failure means real cross-tenant data
exposure, not just a feature bug.
