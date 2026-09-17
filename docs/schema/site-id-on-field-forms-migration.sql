-- docs/schema/site-id-on-field-forms-migration.sql
--
-- Break #2 in docs/feature-interaction-map.md: "site" is three different
-- column shapes across ten features, so no screen can answer "what happened
-- at North Yard" across all of them.
--
--   site_id  FK -> sites : fuel_logs (nullable), custom_form_records (NOT
--                          NULL), inspection_records (NOT NULL)
--   site     text        : toolbox_talks, daily_reports, incidents, near_misses
--   job_site text        : flhas   (same concept, third column name)
--   nothing              : inspections, time_clock_entries
--
-- ── What this actually is ────────────────────────────────────────────────
--
-- Not "workers type site names freely". All five free-text forms ALREADY
-- render a dropdown of the company's real sites with an "other" fallback --
-- App.jsx, ToolboxTalk.jsx, DailyReport.jsx, NearMiss.jsx and Incident.jsx
-- each load list_sites and carry a siteMode of list|other. The worker picks
-- a real site, and the form then stores the resolved NAME and throws the id
-- away.
--
-- Measured before writing this: 55 of the 62 existing free-text rows (89%)
-- match a real site row by case-insensitive name within their own company.
-- The link is there in the data; nothing was ever persisted to carry it.
--
-- ── Why the text columns stay ────────────────────────────────────────────
--
-- Two reasons, both permanent. The "other / not in the list" path is real --
-- a crew works somewhere that is not a registered site and must still be
-- able to file. And the text is what was on the PDF at the time, which for
-- an incident report is a legal record that must not retroactively change
-- because somebody renamed a site afterwards.
--
-- So site_id is additive: the id when we have it, the text always.
-- src/analyticsUtils.js's fieldSiteActivity currently refuses to merge the
-- two systems, with a comment explaining that casing drift and "Unknown
-- site" fallbacks would collide. That objection is exactly what this fixes:
-- once a row carries an id, it groups by id, and only the genuine
-- free-text stragglers fall back to normalized text.
--
-- ── Safety ───────────────────────────────────────────────────────────────
--
-- Every column added here is NULLABLE. Unlike corrective_actions_any_source
-- earlier in this branch, there is no way for this to break a writer that
-- does not yet set it -- which is the whole reason it is shaped this way.
-- Existing inserts keep working untouched; they just leave site_id null
-- until the matching code deploys, and the backfill below picks those up
-- the next time it is run.

alter table public.flhas          add column if not exists site_id bigint references public.sites(id);
alter table public.toolbox_talks  add column if not exists site_id bigint references public.sites(id);
alter table public.daily_reports  add column if not exists site_id bigint references public.sites(id);
alter table public.incidents      add column if not exists site_id bigint references public.sites(id);
alter table public.near_misses    add column if not exists site_id bigint references public.sites(id);

-- Backfill by exact case-insensitive name match, ALWAYS scoped to the row's
-- own company. Matching across companies would attach one tenant's record to
-- another tenant's site -- two companies both having a "Main Yard" is the
-- obvious way that happens, so company_id is load-bearing here, not
-- decoration.
--
-- Deliberately exact-after-trim-and-lower: no fuzzy matching, no prefix
-- matching. A wrong link is worse than no link, because a supervisor cannot
-- see that it happened. The 7 rows that do not match stay text-only and
-- still group by normalized text in analytics.
update public.flhas r set site_id = s.id from public.sites s
  where r.site_id is null and coalesce(r.job_site,'') <> ''
    and s.company_id = r.company_id and lower(btrim(s.name)) = lower(btrim(r.job_site));

update public.toolbox_talks r set site_id = s.id from public.sites s
  where r.site_id is null and coalesce(r.site,'') <> ''
    and s.company_id = r.company_id and lower(btrim(s.name)) = lower(btrim(r.site));

update public.daily_reports r set site_id = s.id from public.sites s
  where r.site_id is null and coalesce(r.site,'') <> ''
    and s.company_id = r.company_id and lower(btrim(s.name)) = lower(btrim(r.site));

update public.incidents r set site_id = s.id from public.sites s
  where r.site_id is null and coalesce(r.site,'') <> ''
    and s.company_id = r.company_id and lower(btrim(s.name)) = lower(btrim(r.site));

update public.near_misses r set site_id = s.id from public.sites s
  where r.site_id is null and coalesce(r.site,'') <> ''
    and s.company_id = r.company_id and lower(btrim(s.name)) = lower(btrim(r.site));

create index if not exists flhas_site_idx         on public.flhas (site_id);
create index if not exists toolbox_talks_site_idx on public.toolbox_talks (site_id);
create index if not exists daily_reports_site_idx on public.daily_reports (site_id);
create index if not exists incidents_site_idx     on public.incidents (site_id);
create index if not exists near_misses_site_idx   on public.near_misses (site_id);

-- ── The other half of #2, handled in code ────────────────────────────────
--
-- api/companydata.js's delete_site just deletes the row. Compare
-- delete_equipment, which explicitly nulls inspections.equipment_id first.
-- With real foreign keys now pointing at sites, deleting one would fail
-- outright rather than silently orphan -- so delete_site detaches first.
-- The text name survives on every record either way, which is why detaching
-- loses nothing a supervisor can see.
