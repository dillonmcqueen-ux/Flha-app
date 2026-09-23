-- docs/schema/corrective-actions-any-source-migration.sql
--
-- Break #5 in docs/feature-interaction-map.md: corrective actions only close
-- the loop for monthly site inspections.
--
-- APPLIED to production 2026-09-17 with Dillon's explicit approval, as
-- migration `corrective_actions_any_source`. Verified after: all 4 existing
-- rows backfilled to source_type='monthly_answer' with the right company_id,
-- answer_id now nullable, the three new columns NOT NULL, and both CHECK
-- constraints confirmed to reject bad rows in a rolled-back probe.
--
-- A SECOND migration, `corrective_actions_backfill_trigger`, was applied
-- immediately after — see the bottom of this file. It is not optional: this
-- migration breaks the code already running on main until the matching code
-- deploys.
--
-- ── Why a migration is unavoidable ───────────────────────────────────────
--
-- corrective_actions.answer_id is bigint NOT NULL with a foreign key to
-- inspection_answers.id. A corrective action therefore *structurally cannot*
-- exist without a monthly inspection answer behind it. An incident, a near
-- miss, or a failed equipment inspection has no answer row, so there is no
-- way to track one against any of them without changing the table.
--
-- The concept already exists on the other side, which is what makes this
-- easy to miss: incidents and near misses carry a `correctiveActions` array
-- inside report_json (AI-drafted, rendered on the PDF by
-- src/generateIncidentPDF.js). It looks complete on paper. But it is inert
-- text — no status, no owner, no target date, no aging, and it never appears
-- in the Open Corrective Actions count on the dashboard. Two incompatible
-- shapes of the same idea.
--
-- ── Why company_id has to come along ─────────────────────────────────────
--
-- corrective_actions has no company_id today. Tenancy is derived
-- transitively: answer -> inspection_record -> inspection_form -> company_id,
-- which is exactly the four-hop walk api/monthly.js's list_corrective_actions
-- performs. That walk only works because every row is a monthly answer. The
-- moment a row can come from an incident instead, there is no single join
-- that resolves the owner, so the column stops being a convenience and
-- becomes the only way to scope the table. This is not scope creep; the
-- polymorphic source cannot be made tenant-safe without it.
--
-- ── Why source_type/source_id, and not one column per source ─────────────
--
-- It matches company_signals, which already uses exactly this shape
-- (source_type + source_id, written by api/flhas.js, api/reports.js,
-- api/logs.js and api/monthly.js). A reader who understands one understands
-- the other, and adding a fifth source later is a CHECK constraint edit
-- rather than another nullable column.
--
-- answer_id is kept rather than folded into source_id so the real foreign
-- key to inspection_answers survives for the rows that have one. A CHECK
-- keeps the two in agreement.
--
-- ── Scale ────────────────────────────────────────────────────────────────
--
-- 4 corrective_actions rows across 3 companies at time of writing, so the
-- backfill is effectively instant. Re-check before running.

begin;

-- 1. New columns, all nullable to start so the backfill has somewhere to go.
alter table public.corrective_actions
  add column if not exists company_id  bigint references public.companies(id),
  add column if not exists source_type text,
  add column if not exists source_id   bigint;

-- 2. Backfill every existing row. All of them are monthly answers by
--    definition — that is the only kind that could have been created.
update public.corrective_actions ca
set source_type = 'monthly_answer',
    source_id   = ca.answer_id,
    company_id  = f.company_id
from public.inspection_answers a
join public.inspection_records r on r.id = a.record_id
join public.inspection_forms   f on f.id = r.form_id
where ca.answer_id = a.id
  and (ca.company_id is null or ca.source_type is null);

-- 3. Refuse to continue if anything failed to resolve an owner, rather than
--    letting the NOT NULL below fail with a less obvious error. An orphaned
--    row here would mean a corrective action nobody can scope to a tenant.
do $$
declare unresolved int;
begin
  select count(*) into unresolved
  from public.corrective_actions
  where company_id is null or source_type is null or source_id is null;

  if unresolved > 0 then
    raise exception
      'Backfill incomplete: % corrective_actions row(s) could not resolve company_id/source. Investigate before re-running.',
      unresolved;
  end if;
end $$;

-- 4. Now the new shape can be required.
alter table public.corrective_actions
  alter column answer_id   drop not null,
  alter column company_id  set  not null,
  alter column source_type set  not null,
  alter column source_id   set  not null;

-- 5. Only these four sources exist. Adding a fifth is an edit here.
alter table public.corrective_actions
  drop constraint if exists corrective_actions_source_type_check;
alter table public.corrective_actions
  add  constraint corrective_actions_source_type_check
  check (source_type in ('monthly_answer', 'incident', 'near_miss', 'equipment_inspection'));

-- 6. answer_id is set if and only if the source is a monthly answer, so the
--    surviving foreign key can never disagree with source_type. Without
--    this, a row could claim source_type='incident' while still pointing
--    answer_id at someone's inspection answer.
alter table public.corrective_actions
  drop constraint if exists corrective_actions_answer_id_matches_source;
alter table public.corrective_actions
  add  constraint corrective_actions_answer_id_matches_source
  check ((source_type = 'monthly_answer') = (answer_id is not null));

-- 7. The two lookups the application actually performs: everything for one
--    company, and "does this source already have an action?" (the duplicate
--    guard, so re-submitting a queued offline report cannot open a second
--    action for the same finding).
create index if not exists corrective_actions_company_idx
  on public.corrective_actions (company_id);
create index if not exists corrective_actions_source_idx
  on public.corrective_actions (source_type, source_id);

commit;

-- RLS is already enabled on corrective_actions with zero policies
-- (deny-by-default, per README's access-control model) and nothing here
-- changes that. Verified 2026-09-17.
--
-- ── Rollback ─────────────────────────────────────────────────────────────
-- Safe while no row has a non-monthly source yet. Once incidents or
-- inspections have opened actions, dropping these columns deletes the only
-- pointer back to what the action was about — export first.
--
-- begin;
--   alter table public.corrective_actions
--     drop constraint if exists corrective_actions_answer_id_matches_source,
--     drop constraint if exists corrective_actions_source_type_check;
--   delete from public.corrective_actions where source_type <> 'monthly_answer';
--   alter table public.corrective_actions alter column answer_id set not null;
--   alter table public.corrective_actions
--     drop column if exists source_id,
--     drop column if exists source_type,
--     drop column if exists company_id;
-- commit;


-- ═══════════════════════════════════════════════════════════════════════
-- FOLLOW-UP: corrective_actions_backfill_trigger (applied 2026-09-17)
-- ═══════════════════════════════════════════════════════════════════════
--
-- The migration above has a deploy-window hazard that is easy to miss and
-- was missed here until it was checked: making three columns NOT NULL
-- breaks every writer that does not yet set them, and the writers on main
-- insert only (answer_id, description, status). Worse, api/monthly.js
-- awaits those inserts without checking the error, so the failure is
-- completely silent — a monthly inspection with a failed answer simply
-- stops opening a corrective action, the submit still returns 200, and
-- nothing is logged.
--
-- The trigger below derives the three columns from answer_id whenever a
-- caller omits them, so old and new code both work. It cannot produce a
-- cross-tenant row: company_id is read from the answer's own form, never
-- from anything the caller supplied.
--
-- Keep it after the code ships. One indexed lookup on a rare insert, and it
-- makes the column contract self-healing instead of something every future
-- writer has to remember.
--
-- create or replace function public.corrective_actions_fill_source()
-- returns trigger language plpgsql security definer set search_path = public
-- as $$
-- begin
--   if new.source_type is null and new.answer_id is not null then
--     new.source_type := 'monthly_answer';
--   end if;
--   if new.source_id is null and new.source_type = 'monthly_answer' then
--     new.source_id := new.answer_id;
--   end if;
--   if new.company_id is null and new.answer_id is not null then
--     select f.company_id into new.company_id
--     from public.inspection_answers a
--     join public.inspection_records r on r.id = a.record_id
--     join public.inspection_forms   f on f.id = r.form_id
--     where a.id = new.answer_id;
--   end if;
--   return new;
-- end $$;
--
-- drop trigger if exists corrective_actions_fill_source_trg on public.corrective_actions;
-- create trigger corrective_actions_fill_source_trg
--   before insert on public.corrective_actions
--   for each row execute function public.corrective_actions_fill_source();
--
-- LESSON for the next migration that adds a NOT NULL column to a table an
-- already-deployed writer touches: either ship the code first, or land the
-- compatibility path in the same migration. Do not rely on noticing it
-- afterwards.

-- 2026-09-23 security sweep, rls-coverage-auditor: the corrective_actions BEFORE INSERT
-- trigger function was executable by anon/authenticated through PostgREST
-- (advisor: *_security_definer_function_executable). Triggers do not check
-- the inserting role's EXECUTE privilege, so revoking it changes nothing
-- for the trigger itself. APPLIED live 2026-09-23 as migration
-- "revoke_corrective_actions_fill_source_execute"; the advisor WARN cleared.
revoke execute on function public.corrective_actions_fill_source() from public, anon, authenticated;
