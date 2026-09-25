-- docs/schema/toolbox-supervisor-notes-migration.sql
--
-- Toolbox Talk sign-off request: a presenter can now edit the AI-generated
-- talk before submitting (src/ToolboxTalk.jsx's review step), and add their
-- own free-text "presenter notes" alongside it (stored inside the existing
-- talking_points_json blob as `presenterNotes` — no schema change needed for
-- that half).
--
-- The other half needs a real column: once a talk is submitted, a company
-- supervisor should be able to add a note to the record but never change the
-- generated document itself (api/logs.js's `update` action still lets the
-- founder-only admin role fix a genuine mistake, same as every other
-- document type — this only narrows what a company supervisor can do).
-- Notes are additive and append-only, so they live in their own column
-- rather than inside talking_points_json, which stays exactly what the
-- presenter generated/edited and submitted.
alter table public.toolbox_talks
  add column if not exists supervisor_notes_json jsonb not null default '[]'::jsonb;
