// server-lib/email.js
// Shared best-effort Resend sender — used by both api/login.js (onboarding
// notification + submitter confirmation) and api/admin.js (claim-link
// delivery). Silently a no-op until RESEND_API_KEY is set, and callers are
// expected to catch/log rather than let a failed email block a DB write
// that already succeeded. Lives outside api/ on purpose (see
// server-lib/uploadUrls.js) so it doesn't count against Vercel's
// per-function budget.

// `attachments` (optional) is Resend's own shape: [{ filename, content }]
// where content is a base64 string — used by Gatehouse's daily report
// email (api/gatehouse.js) to attach the generated PDF directly rather
// than linking out to it.
//
// The default `from` uses reports.forafieldsolutions.com, verified in
// Resend on 2026-08-28. Before that, every email this function sent
// (onboarding notifications and submitter confirmations included, not
// just Gatehouse) used Resend's unverified onboarding@resend.dev sender,
// which Resend restricts to the account owner's own address only — so
// onboarding notifications to real new customers were silently failing
// the same way Gatehouse's report email was, until this domain existed.
export async function sendEmail({ to, subject, text, from = 'FORA <notifications@reports.forafieldsolutions.com>', attachments }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`sendEmail skipped (RESEND_API_KEY not set): "${subject}" to ${to}`);
    return;
  }
  const body = { from, to, subject, text };
  if (attachments && attachments.length > 0) body.attachments = attachments;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body2 = await res.text();
    throw new Error(`Resend API error: ${res.status} ${body2}`);
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
