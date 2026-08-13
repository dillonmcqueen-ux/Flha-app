// Shared brand tokens for the dashboard UI (Dashboard.jsx, Analytics.jsx).
// PDF generators intentionally do NOT import this — exported documents stay
// plain white/professional regardless of on-screen branding.
export const COLORS = {
  navy: "#1E3A5F",
  navyLight: "#2D5F8A",
  orange: "#F97316",
  orangeLight: "#FDBA74",
  bg: "#F0F4F8",
  white: "#FFFFFF",
  slate: "#6B7280",
  slateDark: "#334155",
  border: "#E5E7EB",
  good: "#16A34A",
  warn: "#D97706",
  bad: "#DC2626",
  critical: "#7F1D1D",
};

export const HEADER_GRADIENT = `linear-gradient(135deg, ${COLORS.navy}, ${COLORS.navyLight})`;

// Ordered brand-first palette for multi-series charts (trend lines, pies).
export const CHART_PALETTE = [
  COLORS.navy,
  COLORS.orange,
  COLORS.navyLight,
  COLORS.orangeLight,
  COLORS.slate,
  COLORS.critical,
];
