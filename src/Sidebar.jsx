import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, LayoutGrid, Crosshair } from "lucide-react";
import { colors as C, font as FONT, radius as RAD, sidebar as SB } from "./theme";

// Persistent left nav rail, replacing the old two-row (category pills, then
// tab pills) horizontal bar Dashboard.jsx used to render inline. Pattern
// pulled from the next-shadcn-admin-dashboard template's AppSidebar/NavMain:
// grouped sections with a static group label, an icon+label+badge row per
// item, active-state highlighting, and a collapsible icon-only rail — built
// here with FORA's own tokens (`theme.js`'s new `sidebar` export) and
// content (`categories`/`tabIcon`/`tabLabel` all still come from
// Dashboard.jsx, this component only renders them).
//
// `categories`: [{ key, label, tabs: [tabKey, ...] }] — already filtered by
// the caller to categories that have at least one visible tab.
// `tabVisible`/`tabCounts`: { [tabKey]: bool } / { [tabKey]: number }.
// `tabIcon`/`tabLabel`: { [tabKey]: LucideIcon } / { [tabKey]: string }.
// `tabDots`: { [tabKey]: color } for a status pip with no number (e.g. an
// expired certification), matching the supervisor dashboard mockup.
// `brand`: { roleLabel } renders the FORA mark at the top of the rail, for
// screens (Dashboard) that no longer carry it in a top header on desktop.
// `topOffset`: px the rail sits below, i.e. the height of any sticky header
// above it (0 when there isn't one).
export default function Sidebar({
  categories, categoryIcon, tabIcon, tabLabel, tabVisible, tabCounts = {}, tabDots = {},
  activeTab, onSelectTab, mobileOpen = false, onMobileClose, brand = null, topOffset = 57,
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem("fora_sidebar_collapsed");
      if (stored != null) return stored === "1";
    } catch (e) { /* localStorage unavailable — fall through to viewport check */ }
    return typeof window !== "undefined" && window.innerWidth < 880;
  });

  useEffect(() => {
    try { localStorage.setItem("fora_sidebar_collapsed", collapsed ? "1" : "0"); } catch (e) { /* ignore */ }
  }, [collapsed]);

  const overviewActive = activeTab === "overview";

  // Below 768px (see the .fora-sidebar / .fora-sidebar-backdrop media query
  // Dashboard.jsx injects) this rail becomes a fixed off-canvas drawer
  // instead of a permanent column — a 60-224px rail eating into a
  // 375-414px phone screen was the "bad on mobile" complaint. `mobileOpen`
  // is only meaningful at that width; the .fora-sidebar-open class (added
  // by the caller) is what actually slides it in, this component just
  // needs to stay expanded (not icon-only) while acting as a drawer so a
  // tap target has a label, not just a glyph.
  // While acting as a mobile drawer, always render expanded (labels
  // visible) regardless of the persisted desktop collapsed state — a
  // 60px icon-only rail makes a poor overlay tap target.
  const effectiveCollapsed = mobileOpen ? false : collapsed;

  const selectTab = (key) => {
    onSelectTab(key);
    if (mobileOpen) onMobileClose?.();
  };

  return (
    <>
      {onMobileClose && (
        <div
          className="fora-sidebar-backdrop"
          onClick={onMobileClose}
          style={{
            display: mobileOpen ? "block" : "none",
            position: "fixed", inset: 0, top: 57, zIndex: 55,
            background: "rgba(0,0,0,0.55)",
          }}
        />
      )}
      <div
        className={`fora-sidebar${mobileOpen ? " fora-sidebar-open" : ""}`}
        style={{
          width: effectiveCollapsed ? 60 : 240, flexShrink: 0, transition: "width 160ms ease",
          background: SB.bg, borderRight: `1px solid ${SB.border}`,
          display: "flex", flexDirection: "column",
          position: "sticky", top: topOffset, alignSelf: "flex-start",
          height: `calc(100vh - ${topOffset}px)`, overflowY: "auto", overflowX: "hidden",
        }}>
        {brand && (
          <div className="fora-sidebar-brand" style={{
            display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
            justifyContent: effectiveCollapsed ? "center" : "flex-start",
            padding: effectiveCollapsed ? "16px 6px" : "16px 16px", borderBottom: `1px solid ${SB.border}`,
          }}>
            <span style={{
              width: 30, height: 30, borderRadius: RAD.sm, flexShrink: 0,
              background: `linear-gradient(135deg, ${SB.accent} 0%, #B34700 100%)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 18px -4px rgba(249,115,22,0.6)",
            }}><Crosshair size={16} color="#FFFFFF" strokeWidth={2.5} /></span>
            {!effectiveCollapsed && (
              <>
                <span style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 17, color: C.text.primary, letterSpacing: "0.04em" }}>FORA</span>
                <span style={{
                  fontFamily: FONT.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase",
                  color: SB.accent, background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.3)",
                  borderRadius: 4, padding: "2px 6px",
                }}>{brand.roleLabel}</span>
                <span title="Live" style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: C.status.success.solid, boxShadow: "0 0 8px rgba(34,197,94,0.6)" }} />
              </>
            )}
          </div>
        )}
        <div style={{ flex: 1, padding: effectiveCollapsed ? "12px 6px" : "14px 12px" }}>

          {/* Overview — the landing page every supervisor sees on login. Its
              own top-level link (not inside a category) since it's the "go
              home" affordance once they've clicked into a document tab. */}
          <button
            title={effectiveCollapsed ? "Overview" : undefined}
            onClick={() => selectTab("overview")}
            style={{
              display: "flex", alignItems: "center", gap: 9,
              justifyContent: effectiveCollapsed ? "center" : "flex-start",
              width: "100%", padding: effectiveCollapsed ? "9px 0" : "9px 10px",
              borderRadius: RAD.sm, cursor: "pointer", marginBottom: 20,
              border: `1px solid ${overviewActive ? "rgba(249,115,22,0.35)" : "transparent"}`,
              background: overviewActive ? SB.bgActive : "transparent",
              color: overviewActive ? SB.accent : C.text.primary,
              fontFamily: FONT.heading, fontWeight: 600, fontSize: 14, letterSpacing: "0.02em", textAlign: "left",
            }}
          >
            <LayoutGrid size={16} strokeWidth={2.25} style={{ flexShrink: 0 }} />
            {!effectiveCollapsed && <span>Overview</span>}
          </button>

          {categories.map(cat => {
            const CatIcon = categoryIcon[cat.key];
            const visibleTabs = cat.tabs.filter(t => tabVisible[t]);
            if (visibleTabs.length === 0) return null;
            return (
              <div key={cat.key} style={{ marginBottom: 20 }}>
                {!effectiveCollapsed && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "0 10px 6px",
                    fontFamily: FONT.mono, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em",
                    color: C.text.muted,
                  }}>
                    {CatIcon && <CatIcon size={14} strokeWidth={2.25} color={SB.accent} />}
                    {cat.label}
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {visibleTabs.map(tabKey => {
                    const Icon = tabIcon[tabKey];
                    const active = activeTab === tabKey;
                    const count = tabCounts[tabKey] || 0;
                    const dot = tabDots[tabKey];
                    return (
                      <button
                        key={tabKey}
                        title={effectiveCollapsed ? tabLabel[tabKey] : undefined}
                        onClick={() => selectTab(tabKey)}
                        style={{
                          display: "flex", alignItems: "center", gap: 9,
                          justifyContent: effectiveCollapsed ? "center" : "flex-start",
                          width: "100%", padding: effectiveCollapsed ? "9px 0" : "8px 10px",
                          borderRadius: RAD.sm, border: "none", cursor: "pointer",
                          background: active ? SB.bgActive : "transparent",
                          color: active ? SB.itemTextActive : SB.itemText,
                          fontWeight: 500, fontSize: 13.5, textAlign: "left",
                        }}
                        onMouseEnter={(e) => { if (!active) { e.currentTarget.style.color = SB.itemTextHover; e.currentTarget.style.background = C.panelRaised; } }}
                        onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = SB.itemText; e.currentTarget.style.background = "transparent"; } }}
                      >
                        {Icon && <Icon size={16} strokeWidth={2} color={dot && !active ? dot : undefined} style={{ flexShrink: 0, opacity: active || dot ? 1 : 0.8 }} />}
                        {!effectiveCollapsed && (
                          <>
                            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {tabLabel[tabKey]}
                            </span>
                            {count > 0 && (
                              <span style={{
                                flexShrink: 0, fontFamily: FONT.mono, fontSize: 10.5, fontWeight: 700, borderRadius: 4,
                                padding: "1px 6px", background: C.panelInset, color: C.text.body,
                              }}>{count}</span>
                            )}
                            {count === 0 && dot && (
                              <span style={{ flexShrink: 0, width: 8, height: 8, borderRadius: "50%", background: dot }} />
                            )}
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* The width-collapse toggle is a desktop-density affordance — on a
            mobile drawer there's no adjacent content competing for width,
            so it's just noise. */}
        {!mobileOpen && (
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{
              display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 8,
              padding: "12px 14px", borderTop: `1px solid ${SB.border}`, border: "none", borderTopWidth: 1,
              borderTopStyle: "solid", borderTopColor: SB.border,
              background: "transparent", color: C.text.muted, cursor: "pointer",
              fontFamily: FONT.mono, fontSize: 12, fontWeight: 500,
            }}
          >
            {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /> Collapse</>}
          </button>
        )}
      </div>
    </>
  );
}
