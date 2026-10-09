-- docs/schema/document-engine-wp1-migration.sql
--
-- Unified document engine, work package 1 (see
-- docs/unified-document-engine-spec.md and the phase 1 plan). Adds the tables
-- the engine stores definitions, versions, records, signatures and files in.
-- APPLIED to the production FORA project on 2026-10-09 (migration name
-- document_engine_wp1_schema). Idempotent and safe to re-run. Nothing reads or writes these tables yet:
-- until WP2 ships a handler, this migration changes nothing for any customer.
--
-- Conventions kept from the rest of the schema:
--   * Every table has RLS enabled and NO policies (deny by default). All
--     access goes through api/*.js with the service role key.
--   * Company-owned rows carry company_id, set server-side from the session.
--   * ids are bigint identity, matching companies, roster and sites.
--
-- Deliberate choices:
--   * field_type, rule_type and status are plain text with no CHECK on the
--     full list. The application validates them (the way
--     server-lib/portalFieldTypes.js does), so adding a field type is a code
--     change, not a migration. Only the small, stable lists are CHECKed.
--   * A version is immutable once published. Records point at a version and
--     answers copy the question text, so editing a document never changes
--     what an old record shows.
--   * document_definitions.company_id is NULL for a FORA template. A company
--     gets its own clone (company_id set, template_id pointing back) the
--     first time anything is customized.

-- ── Definitions ─────────────────────────────────────────────────────────────
create table if not exists public.document_definitions (
  id bigint generated always as identity primary key,
  company_id bigint references public.companies(id) on delete cascade,
  key text not null,
  title text not null,
  icon text,
  category text,
  origin text not null check (origin in ('template', 'custom')),
  template_id bigint references public.document_definitions(id) on delete set null,
  current_version_id bigint,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One definition per key per company, and one template per key.
create unique index if not exists document_definitions_company_key_uidx
  on public.document_definitions (company_id, key) where company_id is not null;
create unique index if not exists document_definitions_template_key_uidx
  on public.document_definitions (key) where company_id is null;
create index if not exists document_definitions_company_idx
  on public.document_definitions (company_id);

-- ── Versions ────────────────────────────────────────────────────────────────
create table if not exists public.document_versions (
  id bigint generated always as identity primary key,
  definition_id bigint not null references public.document_definitions(id) on delete cascade,
  version_number integer not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  title text not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (definition_id, version_number)
);

-- At most one open draft per definition.
create unique index if not exists document_versions_one_draft_uidx
  on public.document_versions (definition_id) where status = 'draft';

alter table public.document_definitions
  drop constraint if exists document_definitions_current_version_fk;
alter table public.document_definitions
  add constraint document_definitions_current_version_fk
  foreign key (current_version_id) references public.document_versions(id) on delete set null;

-- ── Fields (per version) ────────────────────────────────────────────────────
-- field_key is stable across versions of the same document, so the recurrence
-- and corrective-action logic can follow one checklist line through edits
-- (what today's item_key does for equipment inspections).
create table if not exists public.document_fields (
  id bigint generated always as identity primary key,
  version_id bigint not null references public.document_versions(id) on delete cascade,
  field_key text not null,
  sort_order integer not null default 0,
  section text,
  label text not null,
  field_type text not null,
  config jsonb not null default '{}'::jsonb,
  required boolean not null default false,
  help_text text,
  attachment_rules jsonb not null default '{}'::jsonb,
  unique (version_id, field_key)
);
create index if not exists document_fields_version_idx
  on public.document_fields (version_id, sort_order);

-- ── Layout (per version, drives the PDF) ────────────────────────────────────
create table if not exists public.document_layouts (
  id bigint generated always as identity primary key,
  version_id bigint not null unique references public.document_versions(id) on delete cascade,
  layout_schema_version integer not null default 1,
  page_size text not null default 'A4',
  layout_json jsonb not null default '{}'::jsonb,
  background_path text,
  created_at timestamptz not null default now()
);

-- ── Rules (per version): routing, signatures, notifications, side effects ──
create table if not exists public.document_rules (
  id bigint generated always as identity primary key,
  version_id bigint not null references public.document_versions(id) on delete cascade,
  rule_type text not null,
  sort_order integer not null default 0,
  config jsonb not null default '{}'::jsonb
);
create index if not exists document_rules_version_idx
  on public.document_rules (version_id, rule_type, sort_order);

-- ── Reference files shown to the worker (per version, document or field) ───
create table if not exists public.document_reference_files (
  id bigint generated always as identity primary key,
  version_id bigint not null references public.document_versions(id) on delete cascade,
  field_key text,
  path text not null,
  filename text not null,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);
create index if not exists document_reference_files_version_idx
  on public.document_reference_files (version_id);

-- ── Per-company switch: which documents are on, mute, Brain ─────────────────
create table if not exists public.company_documents (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  definition_id bigint not null references public.document_definitions(id) on delete cascade,
  is_enabled boolean not null default false,
  brain_enabled boolean not null default true,
  owner_muted boolean not null default false,
  enabled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, definition_id)
);
create index if not exists company_documents_company_idx
  on public.company_documents (company_id) where is_enabled;

-- ── Records ─────────────────────────────────────────────────────────────────
-- The sign-later columns mirror docs/schema/sign-later-migration.sql so
-- server-lib/signLater.js and the unsigned sweep can serve engine records.
create table if not exists public.document_records (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  definition_id bigint not null references public.document_definitions(id),
  version_id bigint not null references public.document_versions(id),
  status text not null default 'submitted'
    check (status in ('draft', 'submitted', 'pending_approval', 'returned', 'approved', 'closed')),
  site_id bigint references public.sites(id) on delete set null,
  submitted_by_roster_id bigint references public.roster(id) on delete set null,
  entered_by_roster_id bigint references public.roster(id) on delete set null,
  client_submission_id text,
  pdf_path text,
  ai_summary text,
  returned_reason text,
  awaiting_signature boolean not null default false,
  signature_requested_at timestamptz,
  worker_signed_at timestamptz,
  unsigned_closed_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now()
);
-- A replayed offline submit must not create a second record.
create unique index if not exists document_records_client_submission_uidx
  on public.document_records (company_id, definition_id, client_submission_id)
  where client_submission_id is not null;
create index if not exists document_records_company_def_idx
  on public.document_records (company_id, definition_id, created_at desc);
create index if not exists document_records_author_idx
  on public.document_records (company_id, submitted_by_roster_id);
create index if not exists document_records_awaiting_signature_idx
  on public.document_records (company_id, submitted_by_roster_id) where awaiting_signature;
create index if not exists document_records_pending_idx
  on public.document_records (company_id, status) where status in ('pending_approval', 'returned');

-- ── Answers ─────────────────────────────────────────────────────────────────
-- question_text and field_type are copied at submit time so an answer never
-- depends on a later edit. The field_id reference is NO ACTION (not cascade)
-- so deleting a field that has answers fails loudly instead of losing data.
create table if not exists public.document_answers (
  id bigint generated always as identity primary key,
  record_id bigint not null references public.document_records(id) on delete cascade,
  field_id bigint not null references public.document_fields(id),
  field_key text not null,
  question_text text not null,
  field_type text not null,
  value_text text,
  value_json jsonb,
  file_path text,
  notes text,
  unique (record_id, field_id)
);
create index if not exists document_answers_record_idx
  on public.document_answers (record_id);

-- ── Signatures, stored as data (not only baked into the PDF) ───────────────
-- signer_roster_id lets the server validate a crew member or reviewer against
-- the roster instead of trusting a client-sent name.
create table if not exists public.document_signatures (
  id bigint generated always as identity primary key,
  record_id bigint not null references public.document_records(id) on delete cascade,
  kind text not null check (kind in ('worker', 'crew', 'reviewer', 'approval')),
  step_key text,
  signer_roster_id bigint references public.roster(id) on delete set null,
  signer_name text not null,
  signer_role text,
  signature_path text,
  signed_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);
create index if not exists document_signatures_record_idx
  on public.document_signatures (record_id);

-- ── Attachments on a record ─────────────────────────────────────────────────
create table if not exists public.document_attachments (
  id bigint generated always as identity primary key,
  record_id bigint not null references public.document_records(id) on delete cascade,
  field_key text,
  kind text not null default 'file' check (kind in ('photo', 'file')),
  path text not null,
  filename text not null,
  content_type text,
  size_bytes bigint,
  uploaded_by_roster_id bigint references public.roster(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists document_attachments_record_idx
  on public.document_attachments (record_id);

-- ── RLS: enabled everywhere, no policies (deny by default) ─────────────────
alter table public.document_definitions enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_fields enable row level security;
alter table public.document_layouts enable row level security;
alter table public.document_rules enable row level security;
alter table public.document_reference_files enable row level security;
alter table public.company_documents enable row level security;
alter table public.document_records enable row level security;
alter table public.document_answers enable row level security;
alter table public.document_signatures enable row level security;
alter table public.document_attachments enable row level security;
