import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, LayoutDashboard } from "lucide-react";
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
export default function Sidebar({
  categories, categoryIcon, tabIcon, tabLabel, tabVisible, tabCounts = {},
  activeTab, onSelectTab, mobileOpen = false, onMobileClose,
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
          width: effectiveCollapsed ? 60 : 224, flexShrink: 0, transition: "width 160ms ease",
          background: SB.bg, borderRight: `1px solid ${SB.border}`,
          display: "flex", flexDirection: "column",
          position: "sticky", top: 57, alignSelf: "flex-start",
          height: "calc(100vh - 57px)", overflowY: "auto", overflowX: "hidden",
        }}>
        <div style={{ flex: 1, padding: effectiveCollapsed ? "10px 6px" : "14px 10px" }}>

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
              borderRadius: RAD.md, border: "none", cursor: "pointer", marginBottom: 16,
              background: overviewActive ? SB.bgActive : "transparent",
              color: overviewActive ? SB.itemTextActive : C.text.primary,
              fontWeight: 700, fontSize: 13.5, textAlign: "left",
            }}
          >
            <LayoutDashboard size={16} strokeWidth={2.25} style={{ flexShrink: 0 }} />
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
                    display: "flex", alignItems: "center", gap: 8, padding: "0 8px 8px",
                    marginBottom: 4, borderBottom: `1px solid ${SB.border}`,
                    fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em",
                    color: C.text.body,
                  }}>
                    {CatIcon && <CatIcon size={16} strokeWidth={2.5} color={SB.accent} />}
                    {cat.label}
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {visibleTabs.map(tabKey => {
                    const Icon = tabIcon[tabKey];
                    const active = activeTab === tabKey;
                    const count = tabCounts[tabKey] || 0;
                    return (
                      <button
                        key={tabKey}
                        title={effectiveCollapsed ? tabLabel[tabKey] : undefined}
                        onClick={() => selectTab(tabKey)}
                        style={{
                          display: "flex", alignItems: "center", gap: 9,
                          justifyContent: effectiveCollapsed ? "center" : "flex-start",
                          width: "100%", padding: effectiveCollapsed ? "9px 0" : "8px 10px",
                          borderRadius: RAD.md, border: "none", cursor: "pointer",
                          background: active ? SB.bgActive : "transparent",
                          color: active ? SB.itemTextActive : SB.itemText,
                          fontWeight: 600, fontSize: 13, textAlign: "left",
                        }}
                        onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = SB.itemTextHover; }}
                        onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = SB.itemText; }}
                      >
                        {Icon && <Icon size={15} strokeWidth={2.25} style={{ flexShrink: 0 }} />}
                        {!effectiveCollapsed && (
                          <>
                            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {tabLabel[tabKey]}
                            </span>
                            {count > 0 && (
                              <span style={{
                                flexShrink: 0, fontSize: 10.5, fontWeight: 800, borderRadius: RAD.pill,
                                padding: "1px 6px", background: SB.badgeBg, color: SB.badgeText,
                              }}>{count}</span>
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
              background: "transparent", color: SB.groupLabel, cursor: "pointer", fontSize: 12, fontWeight: 700,
            }}
          >
            {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /> Collapse</>}
          </button>
        )}
      </div>
    </>
  );
}
