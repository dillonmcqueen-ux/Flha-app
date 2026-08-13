// src/theme.js
//
// The visual identity for FORA's logged-in app (Dashboard, WorkerMenu, the
// worker-facing forms, Onboarding). This is deliberately NOT a port of the
// marketing site's dark/orange palette in `website/` — the two are allowed
// to diverge because they're solving different jobs: the marketing site
// sells the product, this file is the tool people use all day. Nor is it a
// dedup of the old navy-gradient/`#F0F4F8` look-and-feel that was already
// hardcoded across `src/*.jsx` — it's a new system.
//
// Anything added under `design-token-builder` or later token-cleanup work
// should migrate remaining files onto *these* values, not the old
// `#1E3A5F` / `#2D5F8A` / `#F0F4F8` ones.
//
// Rollout status (2026-08): applied to Dashboard.jsx. Not yet applied to
// WorkerMenu.jsx, App.jsx, Onboarding.jsx, or the other worker-facing
// forms — those still use the old navy/steel look until a follow-up pass.

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------
//
// Primary: deep teal. Distinct from the marketing site's near-black/orange
// and from the app's old navy-to-steel gradient — a color no other surface
// in this codebase currently owns. Teal reads as trustworthy/operational
// without being another "safety orange" or "corporate blue" (which is
// where MaintainX and most of the field-ops competitors already sit).
const teal = {
  50: "#EFFCFA",
  100: "#D8F5F0",
  200: "#B4EAE1",
  300: "#82D9CC",
  400: "#4CC0B0",
  500: "#279E90",
  600: "#1B8377", // primary
  700: "#186A62",
  800: "#175450",
  900: "#124542",
  950: "#062A29",
};

// Neutral gray scale — cool, slightly desaturated. Used for the app
// background, borders, and body text. Deliberately not blue-tinted the way
// the old `#F0F4F8` background was.
const gray = {
  50: "#F7F8F8",
  100: "#EEF0F1",
  200: "#E1E5E6",
  300: "#C9CFD2",
  400: "#A3ACB0",
  500: "#7A868B",
  600: "#5B676C",
  700: "#454F53",
  800: "#2E373A",
  900: "#1B2224",
  950: "#0F1315",
};

const status = {
  success: { text: "#166534", bg: "#F0FDF4", border: "#86EFAC", solid: "#16A34A" },
  danger: { text: "#991B1B", bg: "#FEF2F2", border: "#FCA5A5", solid: "#DC2626" },
  warning: { text: "#92400E", bg: "#FFFBEB", border: "#FCD34D", solid: "#D97706" },
  info: { text: "#0C4A6E", bg: "#F0F9FF", border: "#BAE6FD", solid: "#0284C7" },
  critical: { text: "#FFFFFF", bg: "#7F1D1D", border: "#7F1D1D", solid: "#7F1D1D" },
};

export const colors = {
  primary: teal[600],
  primaryDark: teal[800],
  primaryDarker: teal[900],
  primaryLight: teal[100],
  primarySoft: teal[50],
  accent: teal[500],
  teal,
  gray,
  status,
  // Surfaces
  background: gray[50],
  surface: "#FFFFFF",
  surfaceSunken: gray[100],
  border: gray[200],
  borderStrong: gray[300],
  // Text
  textPrimary: gray[900],
  textSecondary: gray[600],
  textMuted: gray[500],
  textOnPrimary: "#FFFFFF",
};

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------
//
// Inter, loaded via a Google Fonts <link> in index.html (see that file).
// Chosen deliberately for a dashboard-heavy product: a workhorse UI
// typeface designed for screens at small sizes, with real numeric tabular
// figures (matters for the stat tiles and analytics tables) — not the
// Windows-default Segoe UI fallback the app shipped with previously.
// Falls back to the platform UI stack if the font hasn't loaded yet or the
// network request fails, so nothing breaks offline.
const fontFamily =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const type = {
  fontFamily,
  fontFamilyMono: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
  size: {
    xs: 11,
    sm: 13,
    base: 14,
    md: 15,
    lg: 18,
    xl: 22,
    xxl: 28,
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    black: 800,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.6,
  },
};

// ---------------------------------------------------------------------------
// Spacing — 4px base unit
// ---------------------------------------------------------------------------

export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
};

// ---------------------------------------------------------------------------
// Radius / shadow / motion — shared surface treatment so cards, tiles and
// nav elements read as one system instead of ad hoc per-component values.
// ---------------------------------------------------------------------------

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  pill: 999,
};

export const shadow = {
  sm: "0 1px 2px rgba(15, 19, 21, 0.06)",
  md: "0 1px 3px rgba(15, 19, 21, 0.08), 0 1px 2px rgba(15, 19, 21, 0.04)",
  lg: "0 8px 24px rgba(15, 19, 21, 0.12)",
};

export const motion = {
  fast: "120ms ease",
  base: "180ms ease",
};

const theme = { colors, type, space, radius, shadow, motion };
export default theme;
