-- Size and MIME limits for the two worker buckets.
--
-- Found by storage-exposure-auditor in the 2026-09-23 sweep:
-- worker-certifications and worker-photos were the only buckets with no
-- file_size_limit and no allowed_mime_types, so a signed upload token for
-- either accepted any file type at any size. Both stay private; this only
-- narrows what an upload may contain. The lists mirror the extension
-- allowlist in server-lib/uploadUrls.js (ALLOWED_EXTENSIONS), and the sizes
-- match onboarding-uploads (20 MB) and incident-photos (15 MB).
--
-- Checked before applying: every existing object in both buckets already
-- fits (largest was a ~4 MB JPEG in worker-photos). Limits only apply to
-- new uploads anyway.
--
-- APPLIED to the live FORA Supabase project (wzyvbtzxxdcxgvbkcqmt) via
-- mcp__Supabase__apply_migration, migration name "worker_bucket_limits",
-- 2026-09-23.

update storage.buckets
   set file_size_limit = 20971520,
       allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']
 where id = 'worker-certifications';

update storage.buckets
   set file_size_limit = 15728640,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif']
 where id = 'worker-photos';
