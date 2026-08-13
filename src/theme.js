// src/theme.js
//
// FORA's visual identity for the logged-in app (Dashboard first, then
// WorkerMenu/App/Onboarding/the worker-facing forms in later passes).
//
// v2 (2026-08). Replaces an earlier teal/light-mode draft (PR #29) that
// Dillon rejected for two reasons: (1) it wasn't the direction he wanted —
// FORA's brand colors are already established on the marketing site
// (`website/style.css`) as black/orange/white, and the right move is
// brand *consistency* with that, not a third unrelated palette; and
// (2) it kept the old flat-white-card layout and just recolored it —
// opaque fills, `0 1px 4px #0001` shadows, no depth. This version fixes
// both: it's the marketing site's black/orange/white system, carried
// into the app with real elevation (layered surfaces, glow, gradient
// accents) that the marketing site itself doesn't need but a dense
// data-heavy dashboard does.
//
// The exact black/panel/orange/line/muted values below are copied
// verbatim from `website/style.css`'s `:root` block — not reinvented —
// per Dillon's direction to use the marketing site's proven values as
// the base. The additions (panel2, panelInset, lineStrong, the status
// scale, glow/shadow tokens) are new: the marketing site is a mostly
// flat one-surface page, the app needs more layers than that.
//
// Once this file exists, later token-cleanup work (`design-token-builder`)
// should migrate any file still hardcoding hex onto *these* values —
// not reintroduce the old navy `#1E3A5F`/`#2D5F8A`/`#F0F4F8` app look.

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

// Copied 1:1 from website/style.css :root — this is the deliberate part of
// "brand consistency": these exact hex values are already proven on the
// public-facing site.
const brand = {
  black: "#0A0A0A",
  panel: "#141414",
  panel2: "#161616",
  line: "#242424",
  orange: "#F97316",
  orangeDim: "#F9731640", // 25% alpha, for borders/rings
  muted: "#9CA3AF",
  text: "#F5F5F4",
};

// New, app-only additions: the marketing site is a mostly single-surface
// page (panel sits directly on black); a dashboard needs more rungs on the
// elevation ladder — a sunken/inset tone for content nested a level deeper
// inside a card, a brighter panel tone for hover/active states, and a
// stronger border for things that need to visually separate more than a
// hairline (input focus rings, card outlines on hover).
const surface = {
  bg: brand.black,
  panel: brand.panel, // base card surface
  panelRaised: "#191919", // hover/active card state, popovers
  panelInset: "#1D1D1D", // content nested inside a card (quote blocks, disabled inputs, secondary buttons)
  line: brand.line, // hairline border / divider — matches website
  lineStrong: "#333333", // stronger border for emphasis/hover
};

const text = {
  primary: brand.text, // headings, values, primary content
  body: "#D4D4D8", // secondary/body copy
  muted: "#A1A1AA", // medium-emphasis captions, timestamps
  faint: "#71717A", // low-emphasis micro-labels, placeholders, disabled
  onOrange: "#0A0A0A", // text on solid-orange fills (matches website's .cta-btn — black-on-orange reads better than white-on-orange)
  onDark: "#FFFFFF",
};

// Status colors, redesigned for a dark surface (the rejected draft's status
// colors were light-mode pairs — a pale bg + dark text — which have very
// low contrast once the surrounding page is black). Each has a solid tone
// (for filled badges/buttons), a soft translucent background (for badges
// sitting on a dark card), and a border.
const status = {
  success: { solid: "#22C55E", text: "#4ADE80", bg: "rgba(34,197,94,0.14)", border: "rgba(34,197,94,0.4)" },
  danger: { solid: "#EF4444", text: "#F87171", bg: "rgba(239,68,68,0.14)", border: "rgba(239,68,68,0.4)" },
  warning: { solid: "#F59E0B", text: "#FBBF24", bg: "rgba(245,158,11,0.14)", border: "rgba(245,158,11,0.4)" },
  info: { solid: "#38BDF8", text: "#38BDF8", bg: "rgba(56,189,248,0.14)", border: "rgba(56,189,248,0.4)" },
};

// Risk scale — reuses website/style.css's --risk-* tokens exactly (same
// reasoning as `brand` above: don't invent a second risk-color language
// when marketing already has one). Note "High" intentionally shares the
// brand orange hue with the accent color, same as the marketing site;
// badges use a soft translucent fill so they read as a risk level rather
// than competing with solid-orange CTAs for attention.
const risk = {
  low: { solid: "#22C55E", text: "#4ADE80", bg: "rgba(34,197,94,0.14)", border: "rgba(34,197,94,0.4)" },
  medium: { solid: "#EAB308", text: "#FDE047", bg: "rgba(234,179,8,0.14)", border: "rgba(234,179,8,0.4)" },
  high: { solid: "#F97316", text: "#FB923C", bg: "rgba(249,115,22,0.14)", border: "rgba(249,115,22,0.4)" },
  extreme: { solid: "#DC2626", text: "#FFFFFF", bg: "#DC2626", border: "#DC2626" }, // deliberately solid/alarming, not translucent — this is the "stop work" state
};

export const colors = {
  ...surface,
  orange: brand.orange,
  orangeDim: brand.orangeDim,
  orangeSoft: "#F9731614", // very soft accent fill, chips/icon tiles
  text,
  status,
  risk,
};

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------
//
// Same pairing as website/style.css: Inter for body copy, Space Grotesk for
// headings and numerals. Chosen for the app for the same reason it's
// unavoidable now that colors match the marketing site — a visitor going
// from the marketing site to the logged-in app should recognize it as the
// same product, and typography is as much a part of that as color.
// Space Grotesk's slightly geometric, faceted numerals also read well at
// the large sizes stat tiles need (better than Inter's numerals, which are
// designed for body-copy density, not a 32px hero figure). Loaded via the
// same Google Fonts <link> as website/*.html (see index.html); falls back
// to the system stack if the network request fails or hasn't resolved yet,
// so the app never looks broken offline.
export const font = {
  heading: "'Space Grotesk', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'SFMono-Regular', ui-monospace, Consolas, monospace",
};

// ---------------------------------------------------------------------------
// Spacing — 4px base unit
// ---------------------------------------------------------------------------

export const spacing = {
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64,
};

// ---------------------------------------------------------------------------
// Radius / shadow / glow / motion
// ---------------------------------------------------------------------------
//
// This is the piece the rejected draft skipped entirely — real elevation
// instead of a flat `0 1px 4px #0001` on every card. Two-part shadows (a
// tight contact shadow + a soft ambient one) read as physically "lifted"
// off the black background in a way a single soft shadow doesn't. `glow.*`
// is the orange accent glow Dillon asked for — used sparingly, behind the
// hero card and featured/alert tiles, not on every surface.
export const radius = { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 };

export const shadow = {
  sm: "0 1px 2px rgba(0,0,0,0.5)",
  md: "0 1px 2px rgba(0,0,0,0.4), 0 8px 20px -8px rgba(0,0,0,0.55)",
  lg: "0 4px 6px rgba(0,0,0,0.35), 0 24px 48px -16px rgba(0,0,0,0.65)",
  inset: "inset 0 1px 0 rgba(255,255,255,0.03)",
};

export const glow = {
  orange: "0 0 0 1px rgba(249,115,22,0.35), 0 20px 60px -20px rgba(249,115,22,0.55)",
  orangeSoft: "0 0 32px -8px rgba(249,115,22,0.4)",
  ring: "0 0 0 3px rgba(220,38,38,0.28)", // used for the "extreme risk" alarm state
};

export const motion = { fast: "120ms ease", base: "200ms ease" };

const theme = { colors, font, spacing, radius, shadow, glow, motion };
export default theme;
