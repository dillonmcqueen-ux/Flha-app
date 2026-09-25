-- Adds TOTP-based MFA storage to the app_settings singleton row (id=1),
-- the same row master_code_hash/master_code_salt already live on (see
-- master-code-throttle-migration.sql for the throttle counter this pairs
-- with). Backs the highest-priority finding in the 2026-09-25 FORA SOC 2
-- Security Posture Report: no MFA anywhere, including the master code.
--
-- Scope: MFA gates the two privileged login paths only (the `admin` role,
-- checked against ADMIN_CODE, and the master code, checked against
-- master_code_hash) — not ordinary roster PIN logins. A single shared TOTP
-- secret is proportionate here since FORA is currently a single-founder
-- operation with no per-user account system for these two paths; see
-- docs/security/soc2-readiness-gaps.md.
--
-- totp_secret is stored as plaintext base32, not hashed — TOTP verification
-- requires computing HOTP(secret, time) server-side to compare against the
-- entered code, which is impossible from a one-way hash. This is standard
-- for TOTP (the same reason authenticator apps hold the raw secret too);
-- it is never sent to the client after enrollment, and enrollment itself
-- is gated behind an already-authenticated admin session.
--
-- backup_codes is a JSON array of one-time recovery codes, each hashed the
-- same way PINs are (scrypt + per-code salt, see hashPin in
-- api/login.js / server-lib/onboardingApproval.js), with a used_at marker
-- so each one only works once: [{hash, salt, used_at}, ...].

alter table app_settings
  add column if not exists totp_secret text,
  add column if not exists totp_enabled boolean not null default false,
  add column if not exists backup_codes jsonb not null default '[]'::jsonb;

-- No new throttle table needed: checkIpThrottle/bump_ip_throttle already
-- share one table (master_code_ip_limits) across every login bucket via
-- key prefix (see server-lib/ipThrottle.js). TOTP guesses use the same
-- helper with a `totp:` prefix — needed because once someone has the
-- (long, separately rate-limited) master code or ADMIN_CODE, the 6-digit
-- TOTP code becomes the next thing worth guessing, and it's short enough
-- that unlimited attempts would matter.
--
-- APPLIED to the live FORA Supabase project (wzyvbtzxxdcxgvbkcqmt) via
-- mcp__Supabase__apply_migration, migration name "mfa_totp", on 2026-09-25.
