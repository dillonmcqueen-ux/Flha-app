# Design — FORA marketing site

A locked design system for `website/`. Every page redesign reads this file
before emitting code. Do not regenerate per page — extend or amend this file
when the system needs to grow.

## Genre
modern-minimal (B2B SaaS / dev-tool school — Stripe/Linear/Vercel nav and
component voice), applied to FORA's existing dark, industrial-adjacent brand.

## Macrostructure family
- Marketing pages (index, what-is-fora, big-five, custom-builds, the-brain,
  pricing, about): shared hero → section-rhythm shell, each page varies its
  own section content but keeps the same nav/footer/type/color system.
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
index.html, big-five.html, custom-builds.html, the-brain.html, and
what-is-fora.html. No emoji-as-icon anywhere in the marketing site going
forward — new sections must draw from `icons.svg` or add a new symbol to it.

## Nav archetype
N1b — canonical SaaS three-section: wordmark hard-left, link cluster
*centred* via CSS grid (`grid-template-columns: 1fr auto 1fr`), CTA
hard-right. Same links/CTA content as before per page — only the layout
changed from flex `space-between` (links visually off-center) to a true
centred cluster. Frost-on-scroll behavior (existing `.solid` class via JS)
preserved.

## Footer archetype
Ft5 Statement (adapted) — a one-line closing statement leads the footer,
with the existing link row and copyright preserved beneath it in muted type.
Not a pure Ft5 (this site's footer still needs to carry real navigation +
legal links, so the link row stays) — it's Ft5's opening move grafted onto
the site's existing Ft3-ish link row, which keeps every page's footer links
reachable.

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
