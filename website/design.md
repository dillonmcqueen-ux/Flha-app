# Design — FORA marketing site

A locked design system for `website/`. Every page redesign reads this file
before emitting code. Do not regenerate per page — extend or amend this file
when the system needs to grow.

## Genre
modern-minimal (B2B SaaS / dev-tool school — Stripe/Linear/Vercel nav and
component voice), applied to FORA's existing dark, industrial-adjacent brand.

## Macrostructure family
- Marketing pages (index, features, custom-builds, pricing, about): shared
  hero → section-rhythm shell, each page varies its own section content but
  keeps the same nav/footer/type/color system. The five-page structure
  replaced the earlier seven-page one — `what-is-fora.html`, `big-five.html`
  and `the-brain.html` were absorbed into `index.html` and `features.html`
  rather than kept as separate pages.
- Legal pages (privacy, terms): typography-only, out of scope for this pass
  (kept on their existing self-contained styling; do not fold them into the
  shared system without a dedicated review, since they're gated by the
  `legal-revision-date-updater` agent on substantive changes).

## Theme
Kept FORA's existing near-black + orange brand (this is a real, established
brand mark, not a catalog pick) but re-expressed in OKLCH and given a second
semantic accent for status/proof content:

- `--color-paper`     oklch(9% 0 0)         /* near-black ground */
- `--color-paper-2`    oklch(12% 0 0)        /* panel surface */
- `--color-paper-3`    oklch(13.5% 0 0)      /* hover/raised surface */
- `--color-ink`        oklch(96% 0.003 90)   /* primary text */
- `--color-ink-2`      oklch(66% 0.01 260)   /* muted text */
- `--color-rule`       oklch(24% 0 0)        /* hairlines/borders */
- `--color-accent`     oklch(70% 0.19 42)    /* FORA orange */
- `--color-accent-ink` oklch(9% 0 0)         /* text on accent */
- `--color-focus`      oklch(70% 0.19 42)

## Typography
- Display: Space Grotesk, weight 700, normal
- Body: Inter, weight 400/500/600, normal
- Display tracking: -0.02em
- Type scale anchor: `--text-display` = clamp(38px, 5.8vw, 72px) (existing
  hero scale, preserved)

## Spacing
Existing 4px-derived spacing already in `style.css` (24px gutter, 120px
section padding, 64px section-head margin) — preserved, not re-tokenized
this pass to limit blast radius on 9 already-working pages.

## Motion
- Easing: existing `ease`/`ease-out` transitions on hover/scroll — preserved
- Reveal pattern: fade + translateY(24px) on scroll (existing `[data-reveal]`)
- Reduced-motion fallback: not yet implemented — flagged as a follow-up

## Microinteractions stance
- Silent hover states (border-color + translateY(-3px) on cards) — no toasts
- Nav frosts on scroll past 20px (existing JS), unchanged behavior

## CTA voice
- Primary CTA: filled accent pill/rounded-rect, existing `.cta-btn` — unchanged
- Secondary CTA: outline/ghost, existing `.cta-ghost` — unchanged

## Icon system
Single custom line-icon set (24×24, `stroke="currentColor"`,
`stroke-width="1.75"`, round caps/joins, no fill) defined once as
`<symbol>` entries in `website/icons.svg` and referenced everywhere via
`<svg class="icon-svg"><use href="icons.svg#<name>"/></svg>`. Replaces every
emoji glyph previously used as a feature/document/flow icon across
every marketing page. No emoji-as-icon anywhere in the marketing site going
forward — new sections must draw from `icons.svg` or add a new symbol to it.
Symbols added for the five-page rebuild: `pin`, `lock`, `calendar`,
`offline`, `pdf`, `stack`.

## Nav archetype
N1b — canonical SaaS three-section: wordmark hard-left, link cluster
*centred* via CSS grid (`grid-template-columns: 1fr auto 1fr`), CTA
hard-right. Frost-on-scroll behavior (existing `.solid` class via JS)
preserved.

The cluster carries four categories, each with a dropdown of sub-items:
Platform, Custom Builds, Pricing, Company. The top-level item is itself a
link to that page, so the dropdown is additive rather than a gate. "Get
started" is the hard-right CTA. This replaced a flat two-link cluster,
because the sections people actually wanted (the Brain, the market
comparison, the six custom-build examples) were reachable only by scrolling
the right page and guessing.

Mechanics:
- Desktop dropdowns are CSS-only, on `:hover` **and** `:focus-within`, so
  they open for keyboard users with no JS.
- Under 860px the cluster is replaced by a hamburger (`.navtoggle`) opening
  a full-height accordion panel (`.mobilenav`). That part is the only nav
  JS: toggle, accordion, close on link click, close on Escape, close on
  resize past the breakpoint. It also locks body scroll while open.
- Sub-items anchor to real section ids. Every marketing section that the nav
  points at carries one (`#demo`, `#documents`, `#dashboard`, `#brain`,
  `#platform`, `#security`, `#examples`, `#tailored`, `#process`, `#cost`,
  `#plans`, `#build`, `#no-enterprise`, `#cancel`, `#market`,
  `#getting-started`, `#story`, `#tradeoffs`). Keep the id when moving a
  section; the nav is the only thing pointing at it.

The legal pages (privacy, terms) deliberately do **not** get this nav. They
keep their own minimal "Back to fora" header, consistent with them staying
out of the shared system.

## Footer archetype
Ft5 Statement (adapted) — a one-line closing statement leads the footer,
with the existing link row and copyright preserved beneath it in muted type.
Not a pure Ft5 (this site's footer still needs to carry real navigation +
legal links, so the link row stays) — it's Ft5's opening move grafted onto
the site's existing Ft3-ish link row, which keeps every page's footer links
reachable.

## Components added for the five-page rebuild

Extensions to `style.css`, all built from the existing tokens (no new
colors, no new type families):

- `.tagline` — the brand tagline lockup ("No suits. No bs. Just results.")
- `.ftable` / `.ftable-wrap` — dark data tables for comparison and spec
  content, horizontally scrollable under 560px
- `.statstrip` / `.stat` — the four-up number band
- `.versus` — the stacked-subscriptions vs FORA cost comparison
- `.specs` / `.spec` — feature detail cards with a badge slot
- `.cart` / `.mod` / `.cart-total` — the build-your-own plan calculator on
  `pricing.html` (vanilla JS, no dependency; the only stateful UI on the site)
- `.statement` — the large pull-quote block (anti-enterprise statement)
- `.ideas` / `.idea` — the Custom Builds niche-example cards
- `.bio-hero` — the About page portrait + body layout
- `.navitem` / `.dropdown` / `.navtoggle` / `.mobilenav` — the category nav

## Per-page allowances
- Marketing pages MAY use the existing CSS-only enrichment (grain texture,
  radial glow, `-webkit-text-stroke` outlined hero word) — Tier A.
- No new photography/illustration added this pass.

## What pages MUST share
- Wordmark/logotype, accent placement, nav/footer archetype, icon system,
  CTA voice, section-heading rhythm (kicker + h2).

## What pages MAY differ on
- Section content and ordering (each page already has a distinct set of
  sections — preserved, not restructured this pass beyond nav/footer/icons).

## Stamp
Pages carry: `/* Hallmark · genre: modern-minimal · design-system: design.md · designed-as-app */`
at the top of `style.css`.
