-- Emailed "set your own PIN" link, one per person. Replaces the plaintext
-- wallet_invite_token path (those columns stay in place, unused).
--
-- The link carries a signed ticket with a random jti. Only the SHA-256 of the
-- jti is stored here, plus an expiry, so a database read cannot be turned into
-- a working link. Single-use: the set-PIN step clears the hash in the same
-- UPDATE that checks it. A PIN reset, authenticator reset, email change or a
-- newer link also clears it.
--
-- pin_link_sent_at: last time a link was issued for this person.
-- pin_set_at: last time the person chose their own PIN through a link, so the
-- Owner can see who is still waiting.

alter table roster
  add column if not exists pin_link_jti_hash text,
  add column if not exists pin_link_expires_at timestamptz,
  add column if not exists pin_link_sent_at timestamptz,
  add column if not exists pin_set_at timestamptz;
