import { useState } from "react";

// Translucent-on-dark versions of the original light-mode pastel presets
// (Dashboard.jsx's old styles.groupHeaderPurple/Amber/Red/Green/Indigo) —
// the near-white fills read as jarring bright rectangles against the app's
// dark theme (src/theme.js), so these use a soft rgba fill over the dark
// surface instead, same pattern as theme.js's status/risk badge colors.
const PRESETS = {
  purple: { color: "#C4B5FD", bg: "rgba(124,58,237,0.16)" },
  amber: { color: "#FCD34D", bg: "rgba(245,158,11,0.16)" },
  red: { color: "#FCA5A5", bg: "rgba(239,68,68,0.16)" },
  green: { color: "#86EFAC", bg: "rgba(34,197,94,0.16)" },
  indigo: { color: "#A5B4FC", bg: "rgba(99,102,241,0.16)" },
  blue: { color: "#38BDF8", bg: "rgba(56,189,248,0.16)" },
};

export default function CollapsibleGroup({
  icon, label, count, colorPreset = "purple",
  open: openProp, onToggle, defaultOpen = false, children,
}) {
  const [openState, setOpenState] = useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  const toggle = isControlled ? onToggle : () => setOpenState(o => !o);
  const c = PRESETS[colorPreset] || PRESETS.purple;

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        style={{
          fontSize: 12, fontWeight: 700, color: c.color, background: c.bg,
          padding: "6px 10px", borderRadius: 6, marginTop: 8,
          marginBottom: open ? 4 : 0, cursor: "pointer", userSelect: "none",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}
      >
        <span>{icon} {label} ({count})</span>
        <span style={{ fontSize: 11 }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && children}
    </div>
  );
}
