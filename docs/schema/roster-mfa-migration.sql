-- Per-person authenticator (TOTP) for roster logins. Step 2 of the login
-- rework. app_settings still holds the founder's single global secret for
-- the admin and master-code paths; that is unchanged.
--
-- totp_secret is stored through server-lib/fieldCrypto.js (enc:v1:...), not
-- as plain base32 like app_settings.totp_secret: a database or backup leak
-- alone must not hand out every employee's second factor. The app still
-- reads the decrypted value server-side to verify a code, it is never sent
-- to the client after enrollment.
--
-- totp_backup_codes: [{hash, salt, used_at}, ...], hashed like PINs.
-- totp_last_step: the 30 second time step of the last accepted code. A code
-- is only accepted for a step strictly greater than this, so a code that
-- was shoulder-surfed or intercepted cannot be replayed inside its window.
-- totp_failed_attempts / totp_locked_until: per-person guess lockout,
-- mirroring failed_pin_attempts / pin_locked_until.

alter table roster
  add column if not exists totp_secret text,
  add column if not exists totp_enabled boolean not null default false,
  add column if not exists totp_backup_codes jsonb not null default '[]'::jsonb,
  add column if not exists totp_last_step bigint,
  add column if not exists totp_failed_attempts integer not null default 0,
  add column if not exists totp_locked_until timestamptz,
  add column if not exists totp_enrolled_at timestamptz;

-- Same claim-before-verify shape as claim_pin_attempt: counts the guess and
-- refuses it in one UPDATE that takes the row lock, so a burst of parallel
-- guesses gets exactly p_lockout_after tries, not one per request. A correct
-- code resets the counter from the app.
create or replace function claim_totp_attempt(
  p_roster_id bigint,
  p_lockout_after int,
  p_lockout_seconds int
)
returns table (totp_failed_attempts int, totp_locked_until timestamptz)
language sql
security definer
set search_path = public
as $$
  update roster
     set totp_failed_attempts = coalesce(roster.totp_failed_attempts, 0) + 1,
         totp_locked_until = case
           when coalesce(roster.totp_failed_attempts, 0) + 1 >= p_lockout_after
             then now() + make_interval(secs => p_lockout_seconds)
           else roster.totp_locked_until
         end
   where roster.id = p_roster_id
     and (roster.totp_locked_until is null or roster.totp_locked_until <= now())
  returning roster.totp_failed_attempts, roster.totp_locked_until;
$$;

revoke all on function claim_totp_attempt(bigint, int, int) from public;
revoke all on function claim_totp_attempt(bigint, int, int) from anon;
revoke all on function claim_totp_attempt(bigint, int, int) from authenticated;
grant execute on function claim_totp_attempt(bigint, int, int) to service_role;

-- Emailed setup link (added after review): the link's ticket carries a random
-- jti; only its SHA-256 is stored here, with an expiry. The enroll endpoints
-- require a match, so the link is single-use and dies on PIN reset, MFA
-- reset, email change, or a newer link. APPLIED live as "roster_mfa_setup_link".
alter table roster
  add column if not exists mfa_setup_jti_hash text,
  add column if not exists mfa_setup_expires_at timestamptz;
