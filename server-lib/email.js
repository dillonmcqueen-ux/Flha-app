// server-lib/email.js
// Shared best-effort Resend sender — used by both api/login.js (onboarding
// notification + submitter confirmation) and api/admin.js (claim-link
// delivery). Silently a no-op until RESEND_API_KEY is set, and callers are
// expected to catch/log rather than let a failed email block a DB write
// that already succeeded. Lives outside api/ on purpose (see
// server-lib/uploadUrls.js) so it doesn't count against Vercel's
// per-function budget.

export async function sendEmail({ to, subject, text, from = 'FORA Onboarding <onboarding@resend.dev>' }) {
  if (!process.env.RESEND_API_KEY) return;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error: ${res.status} ${body}`);
  }
}

// Best-effort origin resolution for links embedded in emails — prefers the
// deployment's own host (works for prod + any preview URL) over a
// hardcoded domain, falling back to the production marketing domain only
// if headers are ever missing (e.g. a non-HTTP invocation).
export function siteOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return 'https://forafieldsolutions.com';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}
