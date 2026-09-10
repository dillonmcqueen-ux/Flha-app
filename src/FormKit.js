// src/FormKit.js
//
// Shared visual scaffolding for the worker-facing, step-through submission
// forms (CustomForm, Incident, Inspection, NearMiss, ToolboxTalk,
// MonthlyInspection, DailyReport) — presentation only, no form/business
// logic lives here. Pulled out so all seven forms read from one place and
// stay visually identical as a family (same card/button/banner shapes),
// the same way Dashboard.jsx's Overview panel established the pattern for
// the supervisor side of the app.
//
// Every color/radius/shadow value here comes from src/theme.js — nothing
// invented. These forms are used outdoors, often one-handed, sometimes
// with gloves — button/input padding stays large regardless of the accent
// color passed in.

// One accent per document type, all drawn from theme.js's existing status
// scale (no new hex). Inspection and MonthlyInspection intentionally share
// the "info" blue — they're the same inspection-report family, told apart
// by icon + title rather than color. CustomForm doesn't get an entry here:
// it already carries a per-company `form.accent_color` and keeps using that.
export function docAccent(C, docType) {
  switch (docType) {
    case "incident": return C.status.danger.solid;
    case "nearmiss": return C.status.warning.solid;
    case "daily": return C.status.success.solid;
    case "inspection":
    case "monthly": return C.status.info.solid;
    case "toolbox": return C.orange;
    default: return C.orange;
  }
}

// Shared style object every form builds its `s` from. Call once per render
// with that form's chosen accent (see docAccent above, or a dynamic
// per-record accent for CustomForm).
export function buildFormStyles(C, FONT, RAD, SHAD, accent) {
  return {
    wrap: { fontFamily: FONT.body, background: C.bg, minHeight: "100vh", padding: 16, color: C.text.primary },
    header: {
      background: `linear-gradient(135deg, ${accent}, ${accent}CC)`, borderRadius: RAD.lg,
      padding: "18px 20px", marginBottom: 16, color: "#fff", display: "flex",
      justifyContent: "space-between", alignItems: "center", boxShadow: SHAD.md,
    },
    card: { background: C.panel, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: 18, marginBottom: 14, boxShadow: SHAD.md },
    label: { display: "block", fontWeight: 700, fontSize: 12, color: C.text.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 },
    input: {
      width: "100%", padding: "12px 13px", borderRadius: RAD.md, border: `1.5px solid ${C.line}`,
      fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 11,
      background: C.panelInset, color: C.text.primary, fontFamily: "inherit",
    },
    // fg defaults to white — reads well against every accent this file set
    // uses (red/amber/green/blue/orange all pass comfortably at this size).
    btn: (bg, fg = "#fff") => ({
      background: bg, color: fg, border: "none", borderRadius: RAD.md, padding: "14px",
      fontWeight: 800, fontSize: 15, cursor: "pointer", width: "100%",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    }),
    ghost: {
      background: C.panelInset, color: C.text.body, border: `1px solid ${C.line}`, borderRadius: RAD.md,
      padding: "12px", fontWeight: 700, fontSize: 14, cursor: "pointer", width: "100%", marginTop: 10,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    },
    section: { fontWeight: 800, fontSize: 15, color: accent, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 },
  };
}

// Background for a disabled/"in progress" primary button — same muted tone
// Dashboard.jsx's own EditPanel save button uses (`colors.text.faint`) so a
// worker sees the same "not ready yet" gray everywhere in the app.
export function disabledBg(C) { return C.text.faint; }

// A themed banner (error/warning/success/info) replacing the old hardcoded
// light-mode #FEF2F2/#FFFBEB boxes — reuses theme.js's status scale.
export function bannerStyle(C, RAD, tone = "danger") {
  const t = C.status[tone] || C.status.danger;
  return {
    background: t.bg, border: `1.5px solid ${t.border}`, borderRadius: RAD.md,
    padding: "11px 14px", marginBottom: 12, fontSize: 13, color: t.text,
    display: "flex", alignItems: "flex-start", gap: 8, lineHeight: 1.4,
  };
}

// A signature canvas keeps a white surface regardless of theme — it's
// meant to read like a physical signature on paper, and the pen stroke
// color (#1E293B, set where each canvas draws) needs a light surface to
// show up against.
export function signatureCanvasStyle(C, RAD) {
  return { width: "100%", height: 150, border: `1.5px solid ${C.line}`, borderRadius: RAD.md, background: "#fff", touchAction: "none", display: "block" };
}
