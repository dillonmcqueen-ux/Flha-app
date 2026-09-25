-- Removes three storage.objects INSERT policies that granted UNAUTHENTICATED
-- writes into private buckets.
--
-- Found during the 2026-09-14 security audit follow-up. server-lib/uploadUrls.js
-- documents an assumption that a direct anon .upload() fails RLS on these
-- buckets. It did not: storage.objects carried PUBLIC/anon INSERT policies, and
-- the anon key ships in the client bundle (src/supabaseClient.js), so anyone who
-- viewed source could write files into these buckets with no session at all.
-- That meant free file hosting on FORA's Supabase storage (an unbounded cost on
-- the project owner's bill) and a complete bypass of the signed-upload-token
-- design these buckets were supposed to be behind.
--
-- Dropped:
--   "Allow public insert signatures"   -> signatures
--   "public_insert_incident_photos"    -> incident-photos
--   "onboarding uploads anon insert"   -> onboarding-uploads
--
-- Verified safe before dropping: every upload to these three buckets goes
-- through src/uploadViaSignedUrl.js, and a signed upload token carries its own
-- authorization rather than consulting RLS, so signed uploads are unaffected.
-- There are zero direct anon .upload() calls to these buckets anywhere in src/.
-- Server-side writes in api/* use the service role, which bypasses RLS entirely.
--
-- Verified after dropping, with the published anon key against the live project:
-- all three now return 403 "new row violates row-level security policy". Note
-- that signatures and incident-photos also enforce an allowed_mime_types list
-- which rejects before RLS is reached, so the probe had to use image/png to
-- actually exercise the policy.
--
-- flha-reports was held back in the first pass and dropped in the second (see
-- the second statement block at the bottom of this file), once
-- src/generatePDF.js had been migrated onto uploadViaSignedUrl in #99 and a
-- real FLHA submit had proven the new path end to end.
--
-- Deliberately NOT dropped:
--   "Allow logo insert 1y3lpeg_0" -> company-logos. Same class, and nothing
--     depends on it either (onboarding and AdminPanel both use signed tokens),
--     but it was outside the agreed scope of this change. company-logos is
--     public for READ by design; that is unrelated to this write policy.
--     This is now the ONLY remaining unauthenticated write into storage.
--
-- APPLIED to the live FORA Supabase project (wzyvbtzxxdcxgvbkcqmt) on
-- 2026-09-14. Reversible: re-create any policy with the same name, command and
-- with_check expression to restore the previous behavior.

drop policy if exists "Allow public insert signatures" on storage.objects;
drop policy if exists "public_insert_incident_photos" on storage.objects;
drop policy if exists "onboarding uploads anon insert" on storage.objects;


-- ── Second pass, 2026-09-14, after #99 deployed ───────────────────────────
-- flha-reports' policy, held back above until src/generatePDF.js stopped
-- uploading with the anon key.
--
-- Proven before dropping, from a real FLHA submitted on the #99 deploy
-- (dpl_D5pTW9NUM5jEEQQ78zZ14Gx3UwSN):
--   01:35:06  POST /api/flhas 200   <- the new create_upload_url action
--   01:35:07  665,926-byte application/pdf written to flha-reports
--   01:35:08  flhas row 67 created with a matching pdf_url
--   01:35:14  POST /api/flhas 200   <- the submit
-- The /api/flhas call one second before the storage write is what proves the
-- signed-token path ran rather than a cached old bundle: the old anon path
-- uploaded straight to Supabase with no server round-trip at all.
--
-- Verified after dropping, with the published anon key: an anonymous write to
-- flha-reports returns 403 "new row violates row-level security policy".

drop policy if exists "Allow public insert 1ly6hwx_0" on storage.objects;


-- ── Third pass, 2026-09-25, as part of SOC 2 readiness remediation ────────
-- "Allow logo insert 1y3lpeg_0" -> company-logos, the one deliberately held
-- back above on 2026-09-14 as out of scope. Re-verified before dropping:
-- both onboarding (src/Onboarding.jsx) and AdminPanel (src/AdminPanel.jsx)
-- upload logos via createUploadUrl() (server-lib/uploadUrls.js, called from
-- api/admin.js and api/login.js) and uploadToSignedUrl() on the client side
-- — a signed upload token, not a direct anon .upload(). Nothing in the
-- codebase depends on an anon INSERT policy for this bucket either.
--
-- After this statement, storage.objects carries zero policies across all 8
-- buckets, meaning every unauthenticated write anywhere in Supabase Storage
-- is refused — matching CLAUDE.md's bar that only company-logos itself
-- (READ, by design, for logo display) should ever be reachable without
-- authentication.
--
-- APPLIED to the live FORA Supabase project (wzyvbtzxxdcxgvbkcqmt) on
-- 2026-09-25. Reversible: re-create the policy with the same name, INSERT
-- command and with_check expression `(bucket_id = 'company-logos'::text)`
-- to restore the previous behavior.

drop policy if exists "Allow logo insert 1y3lpeg_0" on storage.objects;
