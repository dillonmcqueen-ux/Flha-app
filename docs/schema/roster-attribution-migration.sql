-- docs/schema/roster-attribution-migration.sql
--
-- Break #3 in docs/feature-interaction-map.md: every submitted document
-- identifies its author by a free-text name, while roster login exists
-- precisely so a person is a real record. "Show me everything Rob
-- submitted" is string matching, and deactivating someone does not make
-- their history resolvable.
--
-- ── Why this one needs no frontend change at all ─────────────────────────
--
-- Unlike break #2, where the id lived in a dropdown and had to be threaded
-- through five forms and the offline queue, the id here is already in the
-- SESSION. Every submit handler calls verifySession, which carries
-- `userId` for individually-identified logins. The server can stamp it on
-- insert without the client sending anything — so it cannot be forged, and
-- a queued offline submission gets it at drain time from whoever is
-- actually logged in.
--
-- ── The part that matters most: anonymous near misses ────────────────────
--
-- near_misses.is_anonymous is a promise made to a worker in the UI:
-- src/NearMiss.jsx shows "This report will be submitted anonymously", takes
-- no signature, and files the report as "Anonymous". Three such reports
-- already exist, so the feature is genuinely used.
--
-- Stamping a roster id on one of those would silently break that promise:
-- the worker believes they are unidentifiable and the database would record
-- exactly who they are. That is a trust violation, not a data-quality
-- issue, and it is the single worst thing this change could get wrong.
--
-- So the CHECK below makes it structurally impossible rather than relying
-- on every writer remembering. Same discipline as
-- corrective_actions_answer_id_matches_source.
--
-- ── Safety ───────────────────────────────────────────────────────────────
--
-- Every column is NULLABLE. Existing writers keep working untouched, and
-- companies still on a shared login (2 of the 3 today) have no roster row
-- to point at, so their records stay text-only forever. That is the same
-- graceful degradation as break #2's "other site" path, not a gap.

alter table public.flhas               add column if not exists submitted_by_roster_id bigint references public.roster(id);
alter table public.inspections         add column if not exists submitted_by_roster_id bigint references public.roster(id);
alter table public.toolbox_talks       add column if not exists submitted_by_roster_id bigint references public.roster(id);
alter table public.daily_reports       add column if not exists submitted_by_roster_id bigint references public.roster(id);
alter table public.incidents           add column if not exists submitted_by_roster_id bigint references public.roster(id);
alter table public.near_misses         add column if not exists submitted_by_roster_id bigint references public.roster(id);
alter table public.inspection_records  add column if not exists submitted_by_roster_id bigint references public.roster(id);
alter table public.custom_form_records add column if not exists submitted_by_roster_id bigint references public.roster(id);
alter table public.fuel_logs           add column if not exists submitted_by_roster_id bigint references public.roster(id);

-- An anonymous near miss can never carry an author. Enforced here so no
-- future writer -- or a well-meaning backfill -- can undo the promise.
alter table public.near_misses
  drop constraint if exists near_misses_anonymous_has_no_author;
alter table public.near_misses
  add  constraint near_misses_anonymous_has_no_author
  check (not (is_anonymous is true and submitted_by_roster_id is not null));

-- ── Backfill, deliberately partial ───────────────────────────────────────
--
-- Operational records only: FLHAs, equipment inspections, toolbox talks,
-- daily reports and fuel logs. Exact case-insensitive name match, always
-- scoped to the row's own company.
--
-- incidents and near_misses are deliberately NOT backfilled, even though
-- the same match would resolve several rows. A text name matching a roster
-- name is an inference, and on an injury report or a near miss the cost of
-- being wrong is not symmetric with the benefit of being right: a handful
-- of historical rows gain a link, while one bad attribution puts the wrong
-- person's name on a legal record about an injury. Going forward both are
-- stamped from the session, which is authoritative rather than inferred, so
-- the gap closes on its own without guessing.
update public.flhas r set submitted_by_roster_id = m.id from public.roster m
  where r.submitted_by_roster_id is null and coalesce(r.worker_name,'') <> ''
    and m.company_id = r.company_id and lower(btrim(m.name)) = lower(btrim(r.worker_name));

update public.inspections r set submitted_by_roster_id = m.id from public.roster m
  where r.submitted_by_roster_id is null and coalesce(r.worker_name,'') <> ''
    and m.company_id = r.company_id and lower(btrim(m.name)) = lower(btrim(r.worker_name));

update public.toolbox_talks r set submitted_by_roster_id = m.id from public.roster m
  where r.submitted_by_roster_id is null and coalesce(r.presenter_name,'') <> ''
    and m.company_id = r.company_id and lower(btrim(m.name)) = lower(btrim(r.presenter_name));

update public.daily_reports r set submitted_by_roster_id = m.id from public.roster m
  where r.submitted_by_roster_id is null and coalesce(r.reporter_name,'') <> ''
    and m.company_id = r.company_id and lower(btrim(m.name)) = lower(btrim(r.reporter_name));

update public.fuel_logs r set submitted_by_roster_id = m.id from public.roster m
  where r.submitted_by_roster_id is null and coalesce(r.worker_name,'') <> ''
    and m.company_id = r.company_id and lower(btrim(m.name)) = lower(btrim(r.worker_name));

create index if not exists flhas_author_idx               on public.flhas (submitted_by_roster_id);
create index if not exists inspections_author_idx         on public.inspections (submitted_by_roster_id);
create index if not exists toolbox_talks_author_idx       on public.toolbox_talks (submitted_by_roster_id);
create index if not exists daily_reports_author_idx       on public.daily_reports (submitted_by_roster_id);
create index if not exists incidents_author_idx           on public.incidents (submitted_by_roster_id);
create index if not exists near_misses_author_idx         on public.near_misses (submitted_by_roster_id);
create index if not exists inspection_records_author_idx  on public.inspection_records (submitted_by_roster_id);
create index if not exists custom_form_records_author_idx on public.custom_form_records (submitted_by_roster_id);
create index if not exists fuel_logs_author_idx           on public.fuel_logs (submitted_by_roster_id);

-- The text name stays on every record, permanently. It is what the PDF
-- showed, it is the only author a shared-login company will ever have, and
-- it must not change retroactively because somebody was renamed or removed
-- from the roster.
