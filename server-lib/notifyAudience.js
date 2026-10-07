// server-lib/notifyAudience.js
// The one place a submit handler tells a document's audience that a new record
// exists once it counts (signed). Shared by api/reports.js, api/logs.js and
// api/flhas.js so every document type follows the same rules; the audience
// itself is worked out by server-lib/notifyRouting.js.
//
//   - Off unless the company's Owner switched Notify on for the document.
//   - companyId is the session's, never the request's.
//   - authorId is null for an anonymous record, so it is placed by its site alone.
//   - The site name in the email is looked up here from the validated site id,
//     never taken from what the worker typed; notifyRouting uses it only when it
//     is plain.
//   - Skipped without the mail key (sendEmail would no-op and an email slot would
//     be spent on nothing) and for a suspended company (sign_now does not run
//     submit's suspended-company check).
//   - Best effort: nothing here can fail the request, the record is already saved.
//
// Only the document types a handler has wired in are accepted; add a key here in
// the same change that adds its call site.

import { notifyOnSubmit } from './notifyRouting.js';
import { sendEmail } from './email.js';

export const WIRED_DOCUMENT_KEYS = new Set(['incident', 'nearmiss', 'flha', 'inspection', 'toolbox', 'daily']);

export async function notifyAudience(supabase, session, documentKey, { siteId, authorId, skipId } = {}) {
  try {
    if (!WIRED_DOCUMENT_KEYS.has(documentKey)) return;
    if (!session || !session.companyId) return;
    if (!process.env.RESEND_API_KEY) return;
    const { data: co } = await supabase.from('companies').select('suspended').eq('id', session.companyId).limit(1);
    if (co && co[0] && co[0].suspended) return;
    let siteName = null;
    if (siteId != null) {
      const { data } = await supabase.from('sites').select('name').eq('id', siteId).eq('company_id', session.companyId).limit(1);
      siteName = data && data[0] ? data[0].name : null;
    }
    await notifyOnSubmit(supabase, {
      sendEmail,
      companyId: session.companyId,
      documentKey,
      record: { site_id: siteId ?? null, submitted_by_roster_id: authorId ?? null, skip_roster_id: skipId ?? null },
      siteName,
    });
  } catch (e) {
    console.error('report notification failed:', e && e.message);
  }
}
