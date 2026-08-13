# Scope: company brain

Status: **Phase 1 (data model) and Phase 2 (onboarding research) built and
tenant-scope-reviewed.** Phase 1: no cross-tenant issue found; one
low-severity defense-in-depth suggestion applied. Phase 2: no findings at
all — `company_id` is always server-derived (a freshly-inserted company
row's own id, or a value gated behind claim-token validation), never
client-supplied, even accounting for the attacker-influenced free text
(`company_name`, `units_list`) that flows into the drafting prompt.
**Migration not yet applied to the live DB** — needs a human with Supabase
access. Phases 3-6 not started.

Goal (from the user, verbatim): when a company onboards, do preliminary
research on it so the AI has a head start — different earthworks companies
do different things — then keep learning from that company's FLHA edits,
toolbox talks, and incidents so document generation and analytics get
better the longer they use FORA. Different companies have different
equipment lists, divisions, etc.

## Current state (confirmed by reading the actual code, not assumed)

- **FLHA generation is stateless per-request.** `src/App.jsx`'s
  `generateFLHA` builds one prompt per submission from the worker's task
  text plus a pre-filtered slice of that company's `sops.policies`
  (`selectRelevantPolicies`), sends it to `/api/generate-flha.js`, which is
  a thin pass-through to Anthropic (Haiku). No company profile, no memory
  of past FLHAs, no equipment/division context beyond what's already in
  SOPs. All 8 document-generator components share this same endpoint.
- **Onboarding already does light one-shot AI extraction**
  (`server-lib/onboardingDrafting.js`): parses `units_list` free text into
  structured equipment and pulls SOP statements out of uploaded files, both
  staged as JSON on `onboarding_requests` and only become real `equipment`/
  `sops` rows once the company's contact confirms them on the claim-link
  page. Capped at 4 SOP files, 6MB each, Haiku, best-effort — this is the
  existing pattern Phase 2 below extends, not something built from
  scratch.
- **Nothing persists signal from usage back into generation.** No
  embeddings/vector store, no company-profile table, no link between a
  supervisor's edit to an AI-generated FLHA (or a toolbox talk topic, or an
  incident) and any future generation. Every company gets identical prompt
  logic today regardless of how long they've used the app.

## Plan

**Phase 1 — Data model.** Two new tables, both company-scoped and
RLS-enabled deny-by-default exactly like every other tenant table (README's
access-control model): `company_profiles` (one row per company — industry
inference, equipment summary, terminology notes, `hazard_emphasis` jsonb,
draft/confirmed status) and `company_signals` (append-only — one row per
substantive FLHA edit, toolbox talk, incident, or near-miss). See
`docs/schema/company-brain-migration.sql`. Basic admin-scoped
get/update actions added to `api/companydata.js` (same file that already
owns SOPs/sites/equipment/custom fields — this is the same kind of
company reference data, not a new serverless function, keeping the
Vercel function count flat).

**Phase 2 — Onboarding research (data-only, no web lookups). Built.**
Extended `runOnboardingDrafts` (`server-lib/onboardingDrafting.js`) to also
produce a first-pass `company_profiles` row from `company_name`,
`units_list`, and the SOP excerpts the existing `draftSops` step already
extracts — same Haiku-and-cap discipline as the equipment/SOP drafting it
sits alongside (`draftCompanyProfile`, capped prompt, 600 max tokens).
Staged as `status: 'draft'`; an admin's own edit via
`update_company_profile` (Phase 1) always wins — the drafting step checks
for an existing `status: 'confirmed'` row and skips writing if one exists,
so it can never clobber a human's correction. Deliberately **no
external/web research on the company or its industry** — profile is built
only from what the company itself submitted at onboarding. (There's no
"division" field in `onboarding_requests` today, so unlike the original
plan wording, the profile draws on company name + equipment list + SOP
content only — division-level context can be layered on later if that
becomes a real field.)

Fixed a real gap along the way: the existing fire-and-forget call site in
`server-lib/onboardingApproval.js` passed `runOnboardingDrafts` the
in-memory `request` object from *before* that function's own
company-creation step, which never had `created_company_id` set — so
nothing at that call site could have written a company-scoped row even if
it tried. Now passes `created_company_id: companyId` explicitly.

**Phase 3 — Signal capture (passive, cheap).** Insert a `company_signals`
row only on a *substantive* FLHA edit (a hazard added/removed, or a risk
level changed between the AI-generated version and what the supervisor
actually submitted) — not on wording/typo edits. Toolbox talks, incidents,
and near-misses log their topic/category as a signal on normal submission.
All writes are plain inserts alongside existing submission handlers; no
synchronous LLM call and no added latency on the worker-facing path.

**Phase 4 — Profile summarization (batch, not live).** A scheduled Routine
(same shape as the existing standup/security-audit triggers) periodically
rolls up new `company_signals` into `company_profiles.hazard_emphasis` /
`terminology_notes` via one batched LLM call per company with enough new
signals — never per-request, so generation-time cost and latency stay
flat. **Hard constraint (locked in with the user):** this step can only
ever shift emphasis and terminology, never the risk-rating floor. It is
never allowed to lower confidence in a hazard category or skip a baseline
category that the existing grounding rules in `App.jsx`'s FLHA prompt
already require — `hazard_emphasis` is additive context appended after
those rules, never a replacement for them. This matters because a
company's own edit history could reflect an unsafe habit (routinely
downgrading a real hazard) rather than a legitimate operational
difference, and the model must not learn to be less cautious from that.

**Phase 5 — Generation-time integration.** `generate-flha` (and by
extension all 8 document generators that call it) fetch the company's
`company_profiles` row by `company_id` — a plain DB read, no extra model
call — and splice `industry_inference` / `terminology_notes` /
`hazard_emphasis` into the existing prompt next to the current
SOP-filtering block. **Cold start:** a company with no profile yet (or one
still in `draft`) behaves exactly as today's stateless prompt does — pure
graceful degradation, no special-casing required.

**Phase 6 — Analytics + admin visibility (built alongside Phase 1-5, per
the user's answer, not deferred).** Admin Panel gets a section showing the
live `company_profiles` row, fully visible and editable by the admin (same
pattern as the existing SOP/equipment claim-review flow), plus a trending
view sourced from `company_signals` (recurring hazard categories,
incident/near-miss clusters) — reuses the same signal store Phase 3
writes to, no separate pipeline. An admin's manual edit to the profile
takes precedence over the next Phase 4 batch summarization until new
signals justify a change.

## Five concerns raised and answered before building

1. **Tenant isolation** — the highest-stakes part of this feature; a
   "brain" is exactly the kind of thing that leaks across companies if a
   query is scoped wrong once. Every signal/profile row carries
   `company_id` and goes through the same session-checked `api/*.js`
   pattern as the rest of the app. `tenant-scope-reviewer` runs on every
   new/changed action here before merge, per CLAUDE.md — no exception.
2. **Garbage in, garbage out** — rubber-stamped AI output (no real edit)
   would reinforce whatever the model already does, including mistakes.
   Only *substantive* edits count as signal (Phase 3); the profile
   *biases toward*, never *overrides*, the existing grounding rules.
3. **Cost/latency creep** — 8 generators already call `generate-flha` per
   submission; profile summarization is precomputed on a schedule (Phase
   4) and generation-time lookup is a cheap DB read (Phase 5), not a live
   model call, so per-submission cost/latency stays flat.
4. **Cold start** — a brand-new company has no usage history. Phase 2's
   onboarding-data-only research pass covers the gap before real signals
   exist; with zero signals the profile degrades gracefully to today's
   behavior (Phase 5), never worse.
5. **Trust/transparency** — a safety product silently changing its output
   over time is a black box liability-sensitive customers won't accept.
   Profile is admin-visible and editable (Phase 6), same as `sopRef`
   already shows per-hazard provenance today.

## Two "what ifs" raised, and how they were resolved

- **What if a company's culture under-reports real hazards** (supervisors
  habitually downgrade risk to move faster)? Resolved: the safety floor is
  structural, not a policy the model is trusted to infer — Phase 4's
  constraint above means the loop can never lower risk ratings or drop a
  baseline hazard category no matter what the edit history shows.
- **What if two customers are direct competitors** (e.g. two earthworks
  companies)? Cross-tenant data stays hard-isolated per concern #1 with no
  exception; the separate question of anonymized, aggregate cross-company
  benchmarking was raised but **not** adopted as part of this plan — out
  of scope unless raised again deliberately.

## Decisions locked in with the user

- Onboarding research pass: **from onboarding data only** (company name,
  uploaded SOPs, equipment list, division) — no web/external lookups on
  the company or its industry.
- Safety floor: **never lowered** by the learning loop — see Phase 4.
- Admin visibility: **fully visible and editable**, same pattern as
  existing SOP/equipment review flows.
- Analytics: **built alongside generation from the start** (Phase 6 is not
  deferred to a later round).

## Progress

- [x] Phase 1: `company_profiles` / `company_signals` migration written
      (`docs/schema/company-brain-migration.sql`, **not yet applied** — no
      DB credentials in this environment, same caveat as the onboarding-
      automation migration) + `get_company_profile` / `update_company_profile`
      actions added to `api/companydata.js`. `tenant-scope-reviewer` ran
      against both actions: no cross-tenant issue found; `update_company_profile`
      now resolves `companyId` through `resolveCompanyId` (was reading it
      raw from the request body, safe only because of the admin-role check
      on the line above — tightened for defense-in-depth per the review).
- [x] Phase 2: onboarding research pass (`draftCompanyProfile` in
      `server-lib/onboardingDrafting.js`, wired into `runOnboardingDrafts`;
      fixed `onboardingApproval.js`'s fire-and-forget call site to actually
      pass the new company's id through). `tenant-scope-reviewer` ran
      against both call sites and the write path: no findings.
- [ ] Phase 3: signal capture on FLHA edits / toolbox talks / incidents /
      near-misses.
- [ ] Phase 4: batch profile-summarization Routine.
- [ ] Phase 5: generation-time prompt integration.
- [ ] Phase 6: Admin Panel profile view/editor + signal-based trending
      view.
