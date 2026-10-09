-- WP7c-2: let the Owner assign unified-engine documents.
-- document_assignments.document_key only allowed the built-ins, custom_<n> and
-- portal_<n>, so saving an assignment for engine_<definitionId> failed the
-- CHECK (same shape as the notification state CHECK fixed in the WP3
-- migration). Not applied until approved.
alter table public.document_assignments
  drop constraint if exists document_assignments_document_key_check;
alter table public.document_assignments
  add constraint document_assignments_document_key_check
  check (document_key ~ '^(flha|inspection|toolbox|nearmiss|incident|daily|monthly|fuellog|custom_[0-9]+|portal_[0-9]+|engine_[0-9]+)$');
