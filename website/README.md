# FORA marketing site

A standalone, static marketing site for FORA — completely separate from the
app in this repo (`src/`, `api/`). No build step, no dependencies.

## Pages

- `index.html` — Home. Introduces FORA and presents the Big 5 and Custom
  Builds as equally weighted offerings, plus onboarding, "why FORA," and an
  About section.
- `big-five.html` — The Big 5 in full: all five standard documents, how each
  one works, and the Get Started / pricing section.
- `custom-builds.html` — Custom Builds in full: example builds, how the
  process works, affordability messaging, and a quote CTA.
- `privacy.html` / `terms.html` — Legal pages.
- `style.css` — Shared styles for every page above.

## Preview locally

Just open `index.html`, or serve the folder:

```bash
cd website
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy

Point any static host (Vercel, Netlify, GitHub Pages, S3, etc.) at this
`website/` folder — it doesn't need Node, Vite, or any of the app's
environment variables. If deploying to Vercel, create it as its own project
with this folder as the root directory, separate from the app's project.

Deployed at the `fora-website` Vercel project, connected to this repo's
`main` branch with Root Directory set to `website`.

## Editing

Shared styles — colors, layout, components — live in `style.css`. Each page
is its own self-contained HTML file with a small amount of inline JS
(scroll-reveal, sticky nav). Brand colors match the app: black `#0A0A0A`
background, orange `#F97316` accent.
