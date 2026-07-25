import { useState } from "react";

// Hex/typography ported verbatim from Dashboard.jsx's styles.groupHeaderPurple/Amber/Red/Green/Indigo,
// plus a new "blue" preset naming the Inspections tab's previously inline-only header color.
const PRESETS = {
  purple: { color: "#7C3AED", bg: "#F5F3FF" },
  amber: { color: "#B45309", bg: "#FFFBEB" },
  red: { color: "#991B1B", bg: "#FEF2F2" },
  green: { color: "#15803D", bg: "#F0FDF4" },
  indigo: { color: "#4338CA", bg: "#EEF2FF" },
  blue: { color: "#0369A1", bg: "#EFF6FF" },
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
