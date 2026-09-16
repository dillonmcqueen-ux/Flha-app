# FORA marketing site

A standalone, static marketing site for FORA, completely separate from the
app in this repo (`src/`, `api/`). No build step, no dependencies.

Served at **`forafieldsolutions.com`**. That is the public address, and the
only one that belongs on outbound material (flyers, decks, ads, merch).
`portal.forafieldsolutions.com` is the app, for paying customers submitting
documents, and is never advertised as the way in. See `brand.md` for the
full rule.

## Pages

Five marketing pages, each answering the next question a visitor has.

- `index.html`: Home. The all-in-one pitch, the cost of the usual
  multi-vendor stack versus one FORA plan, every built-in feature at a
  glance, the Brain, and the founder.
- `features.html`: Everything that is built, in detail. The interactive
  FLHA demo, all ten built-in document types, the supervisor dashboard,
  the Brain in full (`#brain` anchor), the platform underneath, and the
  security model.
- `custom-builds.html`: What a custom build is versus a form builder, six
  niche worked examples, how scoping actually happens, and pricing-by-scope.
- `pricing.html`: The platform base fee, the module menu, the interactive
  calculator, the anti-enterprise statement, the cancel-any-time /
  seasonal-pause terms, and the market comparison tables. There is no plan
  and no discount: a company pays the base fee and adds only the modules it
  runs, each at its listed price.

  **The prices here MIRROR `server-lib/pricing.js` in the app.** This is a
  separate Vercel project and cannot import that module, so the two have to
  be changed together: the `BASE` and `SETUP` constants at the top of the
  calculator script, the `data-s` / `data-l` attributes on each module
  checkbox, and the `.price-card` figures. A mismatch shows a wrong estimate
  but can never produce a wrong charge, because what a customer is actually
  billed is built server-side from the module keys in the checkout URL.

  The Checkout button links to `api/checkout.js` on the app
  (`https://portal.forafieldsolutions.com/api/checkout?tier=...&modules=...`),
  which creates the Stripe session and redirects. That host is hardcoded in
  two places: the no-JS fallback `href` and the `CHECKOUT` constant in the
  script. A module with `data-requires` (currently only Preventative
  Maintenance, which needs Equipment Inspections) is disabled and greyed
  until its dependency is ticked, and unticked if the dependency is removed
  underneath it, so nobody can build a selection the server will reject.
- `about.html`: The founder page.
- `privacy.html` / `terms.html`: Legal pages (self-contained styling; gated
  by the `legal-revision-date-updater` agent on substantive changes).
- `style.css`: Shared styles for every page above.

The four marketing pages share a category nav with dropdowns (Platform,
Custom Builds, Pricing, Company). It is generated markup duplicated into
each page, since this site has no build step, so a nav change means editing
every page. Sub-items anchor to section ids listed in `design.md`.
- `icons.svg`: The single line-icon set. No emoji-as-icon anywhere.
- `demo.js` / `demo-data.js`: The interactive FLHA demo on `features.html`.
  Pre-authored scenarios, no network requests.

`what-is-fora.html`, `big-five.html` and `the-brain.html` were absorbed into
`index.html` and `features.html` in the five-page rebuild. Footer links on
the legal pages were updated to match.

## Preview locally

Just open `index.html`, or serve the folder:

```bash
cd website
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy

Point any static host (Vercel, Netlify, GitHub Pages, S3, etc.) at this
`website/` folder. It doesn't need Node, Vite, or any of the app's
environment variables. If deploying to Vercel, create it as its own project
with this folder as the root directory, separate from the app's project.

Deployed at the `fora-website` Vercel project, connected to this repo's
`main` branch with Root Directory set to `website`.

## Editing

Shared styles (colors, layout, components) live in `style.css`. Each page
is its own self-contained HTML file with a small amount of inline JS
(scroll-reveal, sticky nav). Brand colors match the app: black `#0A0A0A`
background, orange `#F97316` accent.

**Style rule: no em dashes.** Don't use `—` in any copy on this site. Use a
period, comma, colon, or parentheses instead. This applies to every page,
not just the ones already cleaned up.
