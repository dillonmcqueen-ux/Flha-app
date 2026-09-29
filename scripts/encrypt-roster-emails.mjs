// One-time backfill: encrypts every plaintext roster.email in place.
// Safe to re-run (already-encrypted values are skipped). Dry run by default.
//
//   FIELD_ENCRYPTION_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/encrypt-roster-emails.mjs           # counts only
//   ... node scripts/encrypt-roster-emails.mjs --apply # writes
//
// Run it AFTER the code that reads encrypted emails is deployed, and with the
// same FIELD_ENCRYPTION_KEY that is set in Vercel. Each row is decrypted back
// and compared to the original before it counts as done.
import { createClient } from '@supabase/supabase-js';
import { encryptField, decryptField, isEncrypted } from '../server-lib/fieldCrypto.js';

const apply = process.argv.includes('--apply');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await db.from('roster').select('id, email').not('email', 'is', null);
if (error) { console.error(error.message); process.exit(1); }

const todo = data.filter((r) => r.email && !isEncrypted(r.email));
console.log(`${data.length} rows with an email, ${todo.length} still plaintext.`);
if (!apply) { console.log('Dry run. Re-run with --apply to encrypt.'); process.exit(0); }

let done = 0;
for (const r of todo) {
  const enc = encryptField(r.email);
  if (decryptField(enc) !== r.email) { console.error(`Round trip failed for ${r.id}, skipped.`); continue; }
  const { error: upErr } = await db.from('roster').update({ email: enc }).eq('id', r.id).eq('email', r.email);
  if (upErr) console.error(`Row ${r.id}: ${upErr.message}`); else done++;
}
console.log(`Encrypted ${done} of ${todo.length}.`);
