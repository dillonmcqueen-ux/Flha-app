// Creates the FLHA template in the engine (a definition with no company).
// Run only when Dillon says so: it writes to whatever database the env names.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-flha-template.mjs
//
// Idempotent: an existing FLHA template is reported and left alone. It does not
// switch the template on for any company; cloning it to ABC Earthworks and
// turning it on is a separate, deliberate step in the Admin Panel.
import { createClient } from '@supabase/supabase-js';
import { seedFlhaTemplate } from '../server-lib/documentEngine/templates/flha.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
console.log(`Target database: ${new URL(url).host}`);
const out = await seedFlhaTemplate(createClient(url, key));
console.log(out.created ? `Created the FLHA template (definition ${out.definitionId}).` : `The FLHA template already exists (definition ${out.definitionId}). Nothing changed.`);
