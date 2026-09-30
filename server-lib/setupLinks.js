// server-lib/setupLinks.js
// The emailed "set your own PIN" link. One link per person, sent when a
// company is created, when an Owner adds someone, or when someone resends it.
//
// The link is a signed ticket (purpose 'pin_setup', so every verifySession in
// api/ rejects it as a session) carrying a random jti. Only the jti's SHA-256
// is stored on the roster row, with an expiry. api/login.js's pin_link_open /
// pin_link_set_pin require a match, so a link is single-use and dies on a PIN
// reset, authenticator reset, email change, or a newer link.
//
// Schema: docs/schema/roster-pin-setup-link-migration.sql.
// Lives outside api/ for the same reason as server-lib/uploadUrls.js.

import crypto from 'crypto';

export const PIN_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Most links one company creation sends. The rest are a "Send setup link"
// click away, so a large roster cannot stall the approval on email latency.
export const MAX_LINKS_AT_PROVISION = 25;

// The link carries a token, so its origin must never come from a request
// header a caller can set. Production uses the fixed portal host; previews use
// the deployment's own host from Vercel's environment.
export function setupOrigin() {
  if (process.env.VERCEL_ENV === 'production') return 'https://portal.forafieldsolutions.com';
  const host = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
  return host ? `https://${host}` : 'https://portal.forafieldsolutions.com';
}

export function hashJti(jti) {
  return crypto.createHash('sha256').update(String(jti)).digest('hex');
}

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function signPinLinkTicket({ rosterId, companyId, jti }) {
  return sign({ purpose: 'pin_setup', jti, rosterId, companyId, issuedAt: Date.now() });
}

// Returns the payload, or null for anything that is not a live, untampered
// pin_setup ticket.
export function verifyPinLinkTicket(ticket) {
  if (!ticket || typeof ticket !== 'string' || !ticket.includes('.')) return null;
  const [data, sig] = ticket.split('.');
  if (!data || !sig || !process.env.SESSION_SECRET) return null;
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(data).digest('base64url');
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.purpose !== 'pin_setup' || !payload.jti || !payload.rosterId || !payload.companyId) return null;
    if (!payload.issuedAt || Date.now() - payload.issuedAt > PIN_LINK_TTL_MS) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// Mints a fresh link for one roster row and stores its hash, replacing any
// earlier link. Returns { url } or { error }.
export async function issuePinSetupLink(supabaseAdmin, { id, company_id }) {
  const jti = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  const { data, error } = await supabaseAdmin
    .from('roster')
    .update({
      pin_link_jti_hash: hashJti(jti),
      pin_link_expires_at: new Date(now + PIN_LINK_TTL_MS).toISOString(),
      pin_link_sent_at: new Date(now).toISOString(),
    })
    .eq('id', id)
    .eq('company_id', company_id)
    .select('id');
  if (error || !data || data.length === 0) return { error: "Couldn't create the setup link." };
  const ticket = signPinLinkTicket({ rosterId: id, companyId: company_id, jti });
  return { url: `${setupOrigin()}/wallet?token=${encodeURIComponent(ticket)}` };
}

export function pinSetupEmail({ name, companyName, url, needsAuthenticator }) {
  const next = needsAuthenticator
    ? 'You will pick your own 6-digit PIN, then set up an authenticator app on your phone. It takes a few minutes.'
    : 'You will pick your own 6-digit PIN. It takes about a minute.';
  return {
    subject: `Set up your FORA sign-in for ${companyName}`,
    text: [
      `Hi ${name},`,
      '',
      `${companyName} added you to FORA. Open this link to get set up:`,
      '',
      url,
      '',
      next,
      '',
      'The link works once and expires in 7 days. It is just for you, so do not forward it. If you were not expecting this, ignore the email.',
      '',
      'FORA Field Solutions',
    ].join('\n'),
  };
}

// Issues a link and emails it to `email`. Best-effort: the roster row already
// exists, so a failed send is reported, never thrown. Returns
// { sent, url, error }.
export async function issueAndEmailPinLink({ supabaseAdmin, sendEmail, member, email, companyName, needsAuthenticator }) {
  const issued = await issuePinSetupLink(supabaseAdmin, member);
  if (issued.error) return { sent: false, error: issued.error };
  try {
    await sendEmail({ to: email, ...pinSetupEmail({ name: member.name, companyName, url: issued.url, needsAuthenticator }) });
    return { sent: true, url: issued.url };
  } catch (e) {
    console.error('PIN setup email failed:', e.message);
    return { sent: false, url: issued.url, error: 'email failed' };
  }
}
