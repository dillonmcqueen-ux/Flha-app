// server-lib/slack.js
// Shared best-effort Slack Incoming Webhook sender for onboarding
// notifications — silently a no-op until SLACK_ONBOARDING_WEBHOOK_URL is
// set, same pattern as server-lib/email.js's RESEND_API_KEY gate. Callers
// are expected to catch/log rather than let a failed Slack post block a DB
// write that already succeeded. Lives outside api/ on purpose (see
// server-lib/uploadUrls.js) so it doesn't count against Vercel's
// per-function budget.

export async function sendSlackNotification(text) {
  const url = process.env.SLACK_ONBOARDING_WEBHOOK_URL;
  if (!url) {
    console.warn('sendSlackNotification skipped (SLACK_ONBOARDING_WEBHOOK_URL not set)');
    return;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack webhook error: ${res.status} ${body}`);
  }
}
