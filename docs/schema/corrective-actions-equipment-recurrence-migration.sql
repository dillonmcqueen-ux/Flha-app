-- docs/schema/corrective-actions-equipment-recurrence-migration.sql
--
-- STATUS: written 2026-09-17, NOT YET APPLIED. Needs Dillon's explicit
-- approval before it runs against production, like every migration in this
-- folder.
--
-- ── What this is for ─────────────────────────────────────────────────────
--
-- Dillon, 2026-09-17, after submitting a pre-trip with a flat tire and then
-- a post-trip on the same machine:
--
--   "there was no log for it anywhere that that unit had a flat tire
--    previously to see if it becomes a pattern. 3 low tire corrective
--    actions in a row should flag something as a pattern to say 'hey maybe
--    this tire needs to be repaired or replaced'"
--
-- corrective_actions can say WHAT was wrong (description), WHERE it came
-- from (source_type + source_id) and WHO owns it (responsible_name). It
-- cannot say which MACHINE or which CHECKLIST ITEM, so "has this unit had
-- this fault before?" has no answer. The only pointer to a machine is
-- source_id -> inspections.id, which is one single inspection.
--
-- ── Why this is safe to apply BEFORE the code deploys ────────────────────
--
-- Every column below is nullable with no default and no CHECK that an
-- existing writer could violate. The code currently on main inserts
-- (company_id, source_type, source_id, answer_id, description, status) and
-- keeps working byte-for-byte unchanged after this runs.
--
-- That is deliberate, and it is the lesson from
-- corrective-actions-any-source-migration.sql written down as a property of
-- the schema rather than a comment. That migration added three NOT NULL
-- columns ahead of its code, api/monthly.js inserted without them and never
-- checked the error, and monthly corrective actions silently stopped being
-- created. Nothing here can do that.
--
-- The reverse order is also survivable: server-lib/correctiveActions.js
-- detects a missing column (PGRST204 / 42703) and retries the insert
-- without the five new fields, so a code deploy that lands first degrades
-- to today's behaviour instead of dropping the corrective action. Belt and
-- braces, because silently losing a corrective action is the one failure
-- mode this table cannot have.
--
-- ── Scale ────────────────────────────────────────────────────────────────
--
-- Single-digit corrective_actions rows across 3 companies at time of
-- writing. Re-check with
--   select source_type, count(*) from public.corrective_actions group by 1;
-- before running; the backfill below is a join over that handful of rows.

begin;

-- ── 1. Machine identity ──────────────────────────────────────────────────
--
-- Two columns, not one, and for the same reason the weekly equipment report
-- ended up with two (break #7 in docs/feature-interaction-map.md):
-- equipment_id is set only when a worker picked the machine from the
-- registered fleet dropdown, and is null when they typed a free-text label.
-- Keying recurrence purely on the id would silently stop counting for every
-- free-text machine; keying purely on the label cannot tell two machines
-- apart when add_equipment lets them share one. So a fleet-picked row counts
-- on its id, a typed one counts on its normalized label, and the two key
-- spaces are namespaced in server-lib/recurrence.js so they can never merge.
alter table public.corrective_actions
  add column if not exists equipment_id    bigint references public.equipment(id),
  add column if not exists equipment_label text;

-- ── 2. Item identity ─────────────────────────────────────────────────────
--
-- The normalized checklist line: lower-cased, whitespace-collapsed,
-- trimmed. NOT the description — the description carries the machine label
-- and the operator's free-text note, both of which differ on every report of
-- the same fault, so grouping on it would count every recurrence as a
-- distinct problem.
--
-- The normalizer here MUST stay identical to normalizeItemKey() in
-- server-lib/recurrence.js. If they drift, a row backfilled below and a row
-- written by the application describe the same checklist line under two
-- different keys and never count together — which reads exactly like "no
-- pattern", the failure this whole change exists to fix.
alter table public.corrective_actions
  add column if not exists item_key text;

-- ── 3. How it was closed ─────────────────────────────────────────────────
--
-- A post-trip that clears a defect writes down what was done rather than
-- flipping a status. resolution_source distinguishes a worker clearing it
-- in the field from a supervisor closing it on the dashboard; without it,
-- "resolved" means two different things and an audit cannot tell them apart.
alter table public.corrective_actions
  add column if not exists resolved_note     text,
  add column if not exists resolved_by       text,
  add column if not exists resolution_source text;

alter table public.corrective_actions
  drop constraint if exists corrective_actions_resolution_source_check;
alter table public.corrective_actions
  add  constraint corrective_actions_resolution_source_check
  check (resolution_source is null or resolution_source in ('supervisor', 'posttrip'));

-- ── 4. Backfill: machine identity ────────────────────────────────────────
--
-- A clean join through the inspection the action already points at. No
-- inference: source_id IS the inspection row, and the inspection carries
-- both the fleet id (when there is one) and the label the PDF printed.
-- Constrained to the same company on both sides so a corrupt source_id
-- cannot pull another tenant's machine in.
update public.corrective_actions ca
set equipment_id    = i.equipment_id,
    equipment_label = i.equipment_label
from public.inspections i
where ca.source_type = 'equipment_inspection'
  and ca.source_id   = i.id
  and ca.company_id  = i.company_id
  and ca.equipment_id is null
  and ca.equipment_label is null;

-- ── 5. Backfill: item identity ───────────────────────────────────────────
--
-- Exact, not fuzzy. server-lib/correctiveActions.js builds every
-- equipment-sourced description as "<label>: <item text>[ — note]", with the
-- item text copied verbatim out of results_json, so a containment match
-- against the same row's own Defective items recovers the key with no
-- guessing. An action whose item text cannot be found in its own inspection
-- keeps a null item_key and simply never counts toward a pattern, which is
-- the honest outcome.
update public.corrective_actions ca
set item_key = lower(btrim(regexp_replace(it->>'item', '\s+', ' ', 'g')))
from public.inspections i,
     lateral jsonb_array_elements(
       case when jsonb_typeof(i.results_json->'items') = 'array'
            then i.results_json->'items'
            else '[]'::jsonb end
     ) it
where ca.source_type  = 'equipment_inspection'
  and ca.source_id    = i.id
  and ca.company_id   = i.company_id
  and ca.item_key    is null
  and it->>'condition' = 'Defective'
  and coalesce(btrim(it->>'item'), '') <> ''
  and position(btrim(it->>'item') in ca.description) > 0;

-- ── 6. Indexes ───────────────────────────────────────────────────────────
--
-- The two lookups the application performs. The first is the recurrence
-- count and the per-machine defect list on the maintenance screen; the
-- second is resolveCorrectiveActionsForItems() closing a free-text machine's
-- open defects from a post-trip. Both are partial — every monthly answer,
-- incident and near miss has nulls here and has no business in either index.
create index if not exists corrective_actions_recurrence_idx
  on public.corrective_actions (company_id, equipment_id, item_key)
  where equipment_id is not null and item_key is not null;

create index if not exists corrective_actions_recurrence_label_idx
  on public.corrective_actions (company_id, equipment_label, item_key)
  where equipment_id is null and equipment_label is not null and item_key is not null;

commit;

-- RLS is already enabled on corrective_actions with zero policies
-- (deny-by-default, per README's access-control model). Adding columns does
-- not change that, and nothing here adds a policy.
--
-- ── Verification after applying ──────────────────────────────────────────
--
-- -- every equipment-sourced action should now carry a machine:
-- select count(*) filter (where equipment_id is null and equipment_label is null) as no_machine,
--        count(*) filter (where item_key is null)                                as no_item,
--        count(*)                                                                as total
-- from public.corrective_actions where source_type = 'equipment_inspection';
--
-- -- and nothing else should have picked one up:
-- select count(*) from public.corrective_actions
-- where source_type <> 'equipment_inspection'
--   and (equipment_id is not null or equipment_label is not null or item_key is not null);
--
-- ── Rollback ─────────────────────────────────────────────────────────────
-- Safe: these columns are additive and nothing outside them depends on them.
-- Dropping them loses recorded repair notes on resolved actions, so export
-- resolved_note/resolved_by first if any post-trip resolutions have landed.
--
-- begin;
--   drop index if exists public.corrective_actions_recurrence_idx;
--   drop index if exists public.corrective_actions_recurrence_label_idx;
--   alter table public.corrective_actions
--     drop constraint if exists corrective_actions_resolution_source_check;
--   alter table public.corrective_actions
--     drop column if exists resolution_source,
--     drop column if exists resolved_by,
--     drop column if exists resolved_note,
--     drop column if exists item_key,
--     drop column if exists equipment_label,
--     drop column if exists equipment_id;
-- commit;
