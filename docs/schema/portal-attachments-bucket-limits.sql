-- Applied to production 2026-10-09 with Dillon's approval.
-- portal-attachments had no file size limit and no mime allow-list, so the
-- filename extension check in server-lib/uploadUrls.js was the only type gate
-- and the browser upload (signed token, straight to Storage) was unbounded.
-- Bucket stays private. Matches the extensions in ALLOWED_EXTENSIONS.
update storage.buckets
set file_size_limit = 10485760,  -- 10 MB, the builder's maximum per file
    allowed_mime_types = array[
      'image/png', 'image/jpeg', 'image/webp', 'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
where id = 'portal-attachments' and public = false;
