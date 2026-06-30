# SafeField FLHA

AI-powered Field Level Hazard Assessment app. Workers describe a task by voice
or text, and the app cross-references it against the company's uploaded SOPs
to generate hazards, controls, required PPE, and compliance alerts.

## Before you deploy

1. **Add your Supabase credentials** in `src/supabaseClient.js`
   (Project URL and anon public key — find these in Supabase under
   Project Settings -> API).

2. **Add at least one company + SOP row** in Supabase so the app has
   real policies to load:
   - Table Editor -> `companies` -> insert a row (id auto-generates, name = your company)
   - Table Editor -> `sops` -> insert a row per policy (company_id = the id you just created, policy_text = the policy)

3. **Get an Anthropic API key** at console.anthropic.com (you'll add this
   as an environment variable on Vercel, never in the code itself).

## Deploy to Vercel (free)

1. Push this whole folder to a GitHub repo.
2. Go to vercel.com -> New Project -> Import your GitHub repo.
3. Before deploying, add an environment variable:
   - Name: `ANTHROPIC_API_KEY`
   - Value: your key from console.anthropic.com
4. Click Deploy. Vercel will give you a live link like `flha-app.vercel.app`.

That link is shareable with anyone — no login needed to view the demo.

## Local development

```bash
npm install
npm run dev
```

Note: the AI generation step (`/api/generate-flha`) only works once deployed
to Vercel (or run via `vercel dev`), since it's a serverless function. Locally
with plain `npm run dev`, the app will fall back to demo hazard data if that
endpoint isn't reachable — this is expected and fine for UI testing.
