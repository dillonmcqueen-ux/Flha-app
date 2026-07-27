# FORA marketing site

A standalone, static marketing page for FORA — completely separate from the
app in this repo (`src/`, `api/`). No build step, no dependencies, no shared
routing: it's a single self-contained `index.html`.

## Preview locally

Just open the file, or serve it:

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

Everything — HTML, CSS, and the small amount of JS (scroll-reveal, sticky
nav) — lives in `index.html`. Brand colors match the app: black `#0A0A0A`
background, orange `#F97316` accent.
