import { useState, useEffect } from "react";
import App, { resubmitFLHA } from "./App.jsx";
import Inspection, { resubmitInspection } from "./Inspection.jsx";
import ToolboxTalk, { resubmitToolboxTalk } from "./ToolboxTalk.jsx";
import NearMiss, { resubmitNearMiss } from "./NearMiss.jsx";
import Incident, { resubmitIncident } from "./Incident.jsx";
import DailyReport, { resubmitDaily } from "./DailyReport.jsx";
import MonthlyInspection, { resubmitMonthly } from "./MonthlyInspection.jsx";
import CustomForm, { resubmitCustomForm } from "./CustomForm.jsx";
import TimeClock from "./TimeClock.jsx";
import FuelLog, { resubmitFuelLog } from "./FuelLog.jsx";
import FieldService, { resubmitFieldService } from "./FieldService.jsx";
import MyDocuments from "./MyDocuments.jsx";
import WorkerCertifications from "./WorkerCertifications.jsx";
import { drainQueue } from "./offlineQueue.js";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD, glow as GLOW } from "./theme";
import {
  ClipboardList, ClipboardCheck, Hammer, AlertTriangle, Siren, CalendarClock,
  Clock, LogOut, ChevronRight, ChevronLeft, FileText, Inbox, FolderClock, Fuel,
  HardHat, Wrench, Layers, ShieldCheck,
} from "lucide-react";

// Which form types have a queue-drain function wired up (offlineQueue.js +
// docs/scope-offline-capability.md Phase 1) — now all 8 worker-facing forms
// plus fuel logging (docs/scope-fuel-log-tracker.md Phase 1).
const RESUBMIT_HANDLERS = {
  daily: resubmitDaily,
  nearmiss: resubmitNearMiss,
  incident: resubmitIncident,
  toolbox: resubmitToolboxTalk,
  flha: resubmitFLHA,
  inspection: resubmitInspection,
  monthly: resubmitMonthly,
  customform: resubmitCustomForm,
  fuellog: resubmitFuelLog,
  fieldservice: resubmitFieldService,
};

// Built-in document types. `ready: false` shows a "coming soon" state.
// Icons match Dashboard.jsx's TAB_ICON for the same document type — a
// worker and a supervisor should see the same glyph for "FLHA", etc.
// Accent colors are untouched from the pre-redesign version (existing
// precedent per-doc-type — not part of this pass's scope).
//
// `category` buckets each type into one of the three worker-facing menu
// groups below. Timeclock has no category — it gets its own top-and-centered
// button rather than living inside a category (see WorkerMenu below).
const BUILTIN_TYPES = [
  { key: "flha", icon: ClipboardList, title: "FLHA", desc: "Field Level Hazard Assessment", ready: true, accent: "#F97316", category: "safety" },
  { key: "toolbox", icon: Hammer, title: "Toolbox Talk", desc: "Crew safety meeting record", ready: true, accent: "#7C3AED", category: "safety" },
  { key: "nearmiss", icon: AlertTriangle, title: "Near Miss Report", desc: "Report a close call", ready: true, accent: "#D97706", category: "safety" },
  { key: "incident", icon: Siren, title: "Incident Report", desc: "Report an injury or event", ready: true, accent: "#DC2626", category: "safety" },
  { key: "inspection", icon: ClipboardCheck, title: "Equipment Inspection", desc: "Pre-use machine inspection", ready: true, accent: "#0369A1", category: "equipment" },
  { key: "fuellog", icon: Fuel, title: "Log Fuel", desc: "Record a fuel-up", ready: true, accent: "#F59E0B", category: "equipment" },
  // Rides the existing `maintenance` doc key rather than introducing a new
  // one, so it needs no BUILTIN_DOC_KEYS or pricing-module change (which is
  // break #6 territory — an unlisted key defaults to active and ships free).
  // A company that bought Preventative Maintenance gets the worker-facing
  // half of it; one that did not sees nothing.
  { key: "maintenance", icon: Wrench, title: "Log Service", desc: "Record work you did on a machine", ready: true, accent: "#0D9488", category: "equipment" },
  { key: "daily", icon: ClipboardList, title: "Daily Report", desc: "End-of-day site summary", ready: true, accent: "#16A34A", category: "general" },
  { key: "monthly", icon: CalendarClock, title: "Monthly Site Inspection", desc: "Monthly compliance checklist", ready: true, accent: "#4338CA", category: "general" },
  { key: "timeclock", icon: Clock, title: "Time Clock", desc: "Clock in and out", ready: true, accent: "#0891B2", category: null },
  { key: "certifications", icon: ShieldCheck, title: "My Certifications", desc: "View and add your safety tickets", ready: true, accent: "#0D9488", category: "safety" },
];

// The three worker-facing menu categories. `formCategory` is the same
// safety/operations/workforce value already set on custom forms in
// CustomFormBuilder.jsx (drives Dashboard.jsx's admin tabs) — reusing it
// here means an admin who tags a custom form "Operations" there sees it
// land under "Equipment" here, with no second place to configure it.
const CATEGORIES = [
  { key: "safety", formCategory: "safety", label: "Safety", icon: HardHat, accent: "#DC2626", blurb: "Hazard assessments, toolbox talks, near miss & incident reports" },
  { key: "equipment", formCategory: "operations", label: "Equipment", icon: Wrench, accent: "#0369A1", blurb: "Equipment inspections, fuel and service logging" },
  { key: "general", formCategory: "workforce", label: "General", icon: Layers, accent: "#7C3AED", blurb: "Daily reports and site inspections" },
];

export default function WorkerMenu({ companyId, companyName, userName = "", userId = null, onLogout, token, backLabel = "Sign out" }) {
  const [doc, setDoc] = useState(null);
  const [customFormId, setCustomFormId] = useState(null);
  const [builtinActive, setBuiltinActive] = useState(null); // null = loading
  const [customForms, setCustomForms] = useState([]);
  const [showMyDocs, setShowMyDocs] = useState(false);
  const [activeCategory, setActiveCategory] = useState(null); // null = home screen; else a CATEGORIES key
  const [certAlerts, setCertAlerts] = useState({ expiredCount: 0, expiringSoonCount: 0 });

  useEffect(() => {
    async function loadDocs() {
      try {
        const res = await fetch("/api/customforms", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_worker_documents", token }),
        });
        const data = await res.json();
        if (res.ok) {
          setBuiltinActive(data.builtinActive || {});
          setCustomForms(data.customForms || []);
        } else {
          // If the endpoint fails, default to showing everything so workers
          // aren't locked out by a transient error.
          setBuiltinActive({});
          setCustomForms([]);
        }
      } catch (e) {
        setBuiltinActive({});
        setCustomForms([]);
      }
    }
    loadDocs();
  }, [token]);

  // Certification expiry notification (onboarding wallet, Phase 3) — only
  // an individually-identified roster login (real userId) has a wallet to
  // check; a shared-code login has no roster row to scope one to.
  useEffect(() => {
    if (!token || !userId) return;
    if (builtinActive === null) return; // still loading — wait, rather than fetching before we know if the feature is even on
    if (builtinActive.certifications === false) { setCertAlerts({ expiredCount: 0, expiringSoonCount: 0 }); return; } // admin turned the feature off for this company
    (async () => {
      try {
        const res = await fetch("/api/certifications", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "certification_summary", token, companyId }),
        });
        const data = await res.json();
        if (res.ok) setCertAlerts(data);
      } catch (e) { /* leave alert as-is if the request fails */ }
    })();
  }, [token, userId, companyId, builtinActive]);

  // Drain any queued offline submissions (docs/scope-offline-capability.md
  // Phase 1) whenever a worker lands back on this menu — covers reopening
  // the app after reconnecting, not just staying on the same form — and
  // again on the browser's `online` event for whoever leaves the menu open.
  // Best-effort: a drain failure here just leaves the item queued for the
  // next opportunity, same as offlineQueue.drainQueue already handles.
  // Set when a drained submission saved fine but its PDF couldn't be
  // attached. The record itself is safe; only the link to its PDF is
  // missing, and a supervisor can regenerate it from the dashboard. Shown
  // here rather than swallowed because the alternative is a server log
  // nobody reads (see receiptWasDropped in server-lib/uploadUrls.js).
  const [pdfUnlinkedCount, setPdfUnlinkedCount] = useState(0);

  // Queued submissions the server rejected for good (a 4xx — see
  // isPermanentRejection in offlineQueue.js). They are removed from the
  // queue, because leaving one there wedges every later submission of the
  // same form behind it, but they are REAL lost work: shown here with the
  // server's own reason so the worker knows their entry went nowhere and
  // why, rather than it vanishing between two app opens.
  const [droppedSubmissions, setDroppedSubmissions] = useState([]);

  useEffect(() => {
    if (!token) return;
    const drainAll = () => {
      Object.entries(RESUBMIT_HANDLERS).forEach(([formType, resubmit]) => {
        drainQueue(formType, (payload, clientSubmissionId) => resubmit(payload, clientSubmissionId, token))
          .then(({ pdfUnlinked, dropped }) => {
            if (pdfUnlinked > 0) setPdfUnlinkedCount(prev => prev + pdfUnlinked);
            if (dropped && dropped.length > 0) setDroppedSubmissions(prev => [...prev, ...dropped]);
          })
          .catch(() => { /* best-effort — stays queued, tried again next time */ });
      });
    };
    drainAll();
    window.addEventListener("online", drainAll);
    return () => window.removeEventListener("online", drainAll);
  }, [token]);

  if (showMyDocs) {
    return (
      <MyDocuments
        companyId={companyId}
        userName={userName}
        userId={userId}
        token={token}
        onBack={() => setShowMyDocs(false)}
        onResume={(type, formId) => {
          setShowMyDocs(false);
          if (type === "customform") { setCustomFormId(formId); setDoc("custom"); }
          else setDoc(type);
        }}
      />
    );
  }

  if (doc === "flha") {
    return <App forcedCompanyId={companyId} companyName={companyName} userName={userName} onLogout={() => setDoc(null)} token={token} />;
  }
  if (doc === "inspection") {
    return <Inspection companyId={companyId} companyName={companyName} userName={userName} onBack={() => setDoc(null)} onLogout={onLogout} token={token} />;
  }
  if (doc === "toolbox") {
    return <ToolboxTalk companyId={companyId} companyName={companyName} userName={userName} onBack={() => setDoc(null)} onLogout={onLogout} token={token} />;
  }
  if (doc === "nearmiss") {
    return <NearMiss companyId={companyId} companyName={companyName} userName={userName} onBack={() => setDoc(null)} onLogout={onLogout} token={token} />;
  }
  if (doc === "incident") {
    return <Incident companyId={companyId} companyName={companyName} userName={userName} onBack={() => setDoc(null)} onLogout={onLogout} token={token} />;
  }
  if (doc === "daily") {
    return <DailyReport companyId={companyId} companyName={companyName} userName={userName} onBack={() => setDoc(null)} onLogout={onLogout} token={token} />;
  }
  if (doc === "monthly") {
    return <MonthlyInspection companyId={companyId} companyName={companyName} userName={userName} onBack={() => setDoc(null)} onLogout={onLogout} token={token} />;
  }
  if (doc === "custom" && customFormId) {
    return <CustomForm companyId={companyId} companyName={companyName} userName={userName} formId={customFormId} onBack={() => { setDoc(null); setCustomFormId(null); }} onLogout={onLogout} token={token} />;
  }
  if (doc === "timeclock") {
    return <TimeClock companyId={companyId} companyName={companyName} userName={userName} userId={userId} onBack={() => setDoc(null)} token={token} />;
  }
  if (doc === "maintenance") {
    return <FieldService companyId={companyId} userName={userName} onBack={() => setDoc(null)} token={token} />;
  }
  if (doc === "fuellog") {
    return <FuelLog companyId={companyId} userName={userName} onBack={() => setDoc(null)} token={token} />;
  }
  if (doc === "certifications") {
    return <WorkerCertifications companyId={companyId} userId={userId} userName={userName} token={token} onBack={() => setDoc(null)} />;
  }

  // Same design system as Dashboard.jsx (src/theme.js) — dark surfaces,
  // two-part shadows for real elevation, orange glow accent. This screen
  // is the first thing a worker sees on a phone in the field, so the card
  // list keeps large tap targets (full-row tap, min 72px tall) rather than
  // trading that away for density.
  const s = {
    wrap: { fontFamily: FONT.body, background: C.bg, minHeight: "100vh", color: C.text.primary },
    body: { padding: "18px 16px 40px", maxWidth: 640, margin: "0 auto" },
    card: (accent, ready) => ({
      background: `linear-gradient(160deg, ${C.panelRaised} 0%, ${C.panel} 100%)`,
      border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: "16px 18px",
      boxShadow: SHAD.md, cursor: ready ? "pointer" : "default",
      display: "flex", alignItems: "center", gap: 14,
      opacity: ready ? 1 : 0.5, minHeight: 72, boxSizing: "border-box",
      borderLeft: `3px solid ${accent}`,
    }),
    iconTile: (accent) => ({
      width: 46, height: 46, borderRadius: RAD.md, flexShrink: 0,
      background: `${accent}1F`, border: `1px solid ${accent}40`,
      display: "flex", alignItems: "center", justifyContent: "center",
    }),
  };

  const visibleBuiltins = builtinActive
    ? BUILTIN_TYPES.filter(d => builtinActive[d.key] !== false)
    : BUILTIN_TYPES; // show everything while loading, then narrow once loaded

  const timeclockItem = visibleBuiltins.find(d => d.key === "timeclock" && userId); // needs a real per-person identity, regardless of loading state
  // Certifications also needs a real per-person identity — a shared-code
  // login has no roster row for a cert wallet to belong to.
  const categorizedBuiltins = visibleBuiltins.filter(d => d.category && (d.key !== "certifications" || userId));

  const loading = builtinActive === null;

  // Bucket each category's items (built-in + matching custom forms) once,
  // so both the home screen's subtitle and the sub-menu screen read off the
  // same list.
  const categoryItems = (cat) => ({
    builtins: categorizedBuiltins.filter(d => d.category === cat.key),
    forms: customForms.filter(f => (f.category || "operations") === cat.formCategory),
  });

  const visibleCategories = CATEGORIES
    .map(cat => ({ ...cat, ...categoryItems(cat) }))
    .filter(cat => cat.builtins.length > 0 || cat.forms.length > 0);

  const totalItems = categorizedBuiltins.length + customForms.length + (timeclockItem ? 1 : 0);

  const renderItemCard = (d) => {
    const Icon = d.icon;
    return (
      <div key={d.key} style={s.card(d.accent, d.ready)} onClick={() => d.ready && setDoc(d.key)}>
        <div style={s.iconTile(d.accent)}>
          <Icon size={22} color={d.accent} strokeWidth={2.25} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: C.text.primary }}>{d.title}</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginTop: 1 }}>{d.desc}</div>
        </div>
        {d.ready
          ? <ChevronRight size={20} color={C.text.faint} style={{ flexShrink: 0 }} />
          : <span style={{ fontSize: 11, fontWeight: 700, color: C.text.muted, background: C.panelInset, border: `1px solid ${C.line}`, padding: "4px 9px", borderRadius: RAD.pill, flexShrink: 0 }}>SOON</span>}
      </div>
    );
  };

  const renderFormCard = (f) => (
    <div key={f.id} style={s.card(f.accent_color || "#4338CA", true)} onClick={() => { setCustomFormId(f.id); setDoc("custom"); }}>
      <div style={s.iconTile(f.accent_color || "#4338CA")}>
        {f.icon
          ? <span style={{ fontSize: 22 }}>{f.icon}</span>
          : <FileText size={22} color={f.accent_color || "#4338CA"} strokeWidth={2.25} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: C.text.primary }}>{f.title}</div>
        <div style={{ fontSize: 13, color: C.text.muted, marginTop: 1 }}>Custom document</div>
      </div>
      <ChevronRight size={20} color={C.text.faint} style={{ flexShrink: 0 }} />
    </div>
  );

  const header = (title, onBack) => (
    <header style={{
      position: "sticky", top: 0, zIndex: 40,
      background: "rgba(10,10,10,0.88)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
      borderBottom: `1px solid ${C.line}`, padding: "14px 20px",
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {onBack && (
          <button onClick={onBack} style={{
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            width: 32, height: 32, borderRadius: RAD.md, border: `1px solid ${C.line}`,
            background: "transparent", color: C.text.body, cursor: "pointer",
          }}>
            <ChevronLeft size={18} />
          </button>
        )}
        {!onBack && <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.orange, boxShadow: "0 0 14px 2px rgba(249,115,22,0.7)", flexShrink: 0 }} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.text.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {companyName || "FORA"}
          </div>
          <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 17, color: C.text.primary, letterSpacing: "-0.01em" }}>{title}</div>
        </div>
      </div>
      {onLogout && !onBack && (
        <button onClick={onLogout} style={{
          display: "flex", alignItems: "center", gap: 6, color: C.text.body, fontSize: 13,
          border: `1px solid ${C.line}`, background: "transparent", padding: "8px 14px",
          borderRadius: RAD.md, cursor: "pointer", fontWeight: 600, flexShrink: 0, minHeight: 36,
        }}>
          <LogOut size={14} /> {backLabel}
        </button>
      )}
    </header>
  );

  // ── CATEGORY SUB-MENU ────────────────────────────────────
  if (activeCategory) {
    const cat = visibleCategories.find(c => c.key === activeCategory);
    if (!cat) { setActiveCategory(null); return null; }
    return (
      <div style={s.wrap}>
        {header(cat.label, () => setActiveCategory(null))}
        <div style={s.body}>
          <div style={{ margin: "18px 0" }}>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: "clamp(22px,6vw,28px)", color: C.text.primary, letterSpacing: "-0.02em" }}>
              {cat.label}
            </div>
            <div style={{ fontSize: 13, color: C.text.muted, marginTop: 4 }}>{cat.blurb}</div>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {cat.builtins.map(renderItemCard)}
            {cat.forms.map(renderFormCard)}
          </div>
        </div>
      </div>
    );
  }

  // ── HOME SCREEN ──────────────────────────────────────────
  return (
    <div style={s.wrap}>
      {header("Home")}

      <div style={s.body}>
        {pdfUnlinkedCount > 0 && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            background: C.status.warning.bg, border: `1px solid ${C.status.warning.border}`,
            borderRadius: RAD.md, padding: 14, marginTop: 16,
          }}>
            <AlertTriangle size={16} color={C.status.warning.text} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13, color: C.text.body, lineHeight: 1.5 }}>
              <strong style={{ color: C.status.warning.text }}>
                {pdfUnlinkedCount === 1 ? "A queued submission" : `${pdfUnlinkedCount} queued submissions`} synced without {pdfUnlinkedCount === 1 ? "its" : "their"} PDF.
              </strong>{" "}
              The {pdfUnlinkedCount === 1 ? "report was" : "reports were"} saved and nothing was lost. Ask your supervisor to open {pdfUnlinkedCount === 1 ? "it" : "them"} in the dashboard and re-save, which regenerates the PDF.
            </div>
          </div>
        )}

        {droppedSubmissions.length > 0 && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            background: C.status.danger.bg, border: `1px solid ${C.status.danger.border}`,
            borderRadius: RAD.md, padding: 14, marginTop: 16,
          }}>
            <AlertTriangle size={16} color={C.status.danger.text} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13, color: C.text.body, lineHeight: 1.5 }}>
              <strong style={{ color: C.status.danger.text }}>
                {droppedSubmissions.length === 1 ? "A saved-offline submission" : `${droppedSubmissions.length} saved-offline submissions`} could not be sent.
              </strong>{" "}
              The server refused {droppedSubmissions.length === 1 ? "it" : "them"}, so {droppedSubmissions.length === 1 ? "it was" : "they were"} removed from the sync queue — everything behind {droppedSubmissions.length === 1 ? "it" : "them"} has been sent. Tell your supervisor.
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {droppedSubmissions.map((d) => (
                  <li key={d.id} style={{ marginBottom: 2 }}>
                    <strong>{d.formType}</strong>{d.createdAt ? ` (${new Date(d.createdAt).toLocaleString()})` : ""}: {d.reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Same hero-glow language as Dashboard.jsx's welcome moment — this
            is the worker's landing screen, so it earns the same welcome
            treatment as the supervisor dashboard gets. */}
        <div style={{
          position: "relative", overflow: "hidden",
          background: "linear-gradient(180deg,#171717 0%,#131313 100%)",
          border: `1px solid ${C.line}`, borderRadius: RAD.xl,
          padding: "22px 22px", marginTop: 16, marginBottom: 18, boxShadow: SHAD.lg,
        }}>
          <div style={{
            position: "absolute", width: 320, height: 320, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(249,115,22,0.2) 0%, transparent 68%)",
            top: -150, right: -110, pointerEvents: "none",
          }} />
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.orange, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              {new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}
            </div>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: "clamp(20px,5vw,26px)", color: C.text.primary, letterSpacing: "-0.02em" }}>
              {userName ? `Hey, ${userName.split(" ")[0]}` : "Welcome"}
            </div>
            <div style={{ fontSize: 13, color: C.text.muted, marginTop: 4 }}>
              Clock in below, or pick what you need to fill out.
            </div>
          </div>
        </div>

        {builtinActive?.certifications !== false && (certAlerts.expiredCount > 0 || certAlerts.expiringSoonCount > 0) && (
          <div style={{ background: "rgba(234,88,12,0.14)", border: "1.5px solid rgba(234,88,12,0.4)", borderRadius: 12, padding: "14px 16px", marginBottom: 18 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#FB923C", marginBottom: 2, display: "flex", alignItems: "center", gap: 5 }}>
              <AlertTriangle size={14} strokeWidth={2.5} />Certification alert
            </div>
            <div style={{ fontSize: 13, color: "#FDBA74" }}>
              {certAlerts.expiredCount > 0 && <span>{certAlerts.expiredCount} of your certifications {certAlerts.expiredCount === 1 ? "has" : "have"} expired</span>}
              {certAlerts.expiredCount > 0 && certAlerts.expiringSoonCount > 0 && <span> and </span>}
              {certAlerts.expiringSoonCount > 0 && <span>{certAlerts.expiringSoonCount} {certAlerts.expiringSoonCount === 1 ? "is" : "are"} expiring within 30 days</span>}
              . Contact your supervisor to renew.
            </div>
          </div>
        )}

        {/* Time Clock — top and centered, its own thing, not buried in a
            category. This is the button most workers reach for first and
            last on every shift. */}
        {timeclockItem && (
          <button
            onClick={() => setDoc("timeclock")}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              width: "100%", cursor: "pointer", textAlign: "center",
              background: `linear-gradient(160deg, ${C.panelRaised} 0%, ${C.panel} 100%)`,
              border: `1px solid ${timeclockItem.accent}55`, borderRadius: RAD.xl,
              padding: "22px 18px", boxShadow: `${SHAD.lg}, 0 0 32px -12px ${timeclockItem.accent}66`,
              marginBottom: 20, boxSizing: "border-box",
            }}
          >
            <div style={{ ...s.iconTile(timeclockItem.accent), width: 56, height: 56 }}>
              <Clock size={28} color={timeclockItem.accent} strokeWidth={2.25} />
            </div>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 20, color: C.text.primary, letterSpacing: "-0.01em" }}>
              Time Clock
            </div>
            <div style={{ fontSize: 13, color: C.text.muted }}>Clock in and out</div>
          </button>
        )}

        <div
          onClick={() => setShowMyDocs(true)}
          style={{
            display: "flex", alignItems: "center", gap: 14, cursor: "pointer",
            background: `linear-gradient(160deg, ${C.panelRaised} 0%, ${C.panel} 100%)`,
            border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: "14px 16px",
            boxShadow: SHAD.md, marginBottom: 16, minHeight: 64, boxSizing: "border-box",
          }}
        >
          <div style={s.iconTile(C.orange)}>
            <FolderClock size={22} color={C.orange} strokeWidth={2.25} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text.primary }}>My Forms</div>
            <div style={{ fontSize: 12.5, color: C.text.muted, marginTop: 1 }}>Unfinished drafts &amp; what you've submitted before</div>
          </div>
          <ChevronRight size={20} color={C.text.faint} style={{ flexShrink: 0 }} />
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {visibleCategories.map(cat => {
            const Icon = cat.icon;
            const items = [...cat.builtins.map(d => d.title), ...cat.forms.map(f => f.title)];
            return (
              <div
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 16, cursor: "pointer",
                  background: `linear-gradient(160deg, ${C.panelRaised} 0%, ${C.panel} 100%)`,
                  border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: "18px 18px",
                  boxShadow: SHAD.md, minHeight: 88, boxSizing: "border-box",
                  borderLeft: `3px solid ${cat.accent}`,
                }}
              >
                <div style={{ ...s.iconTile(cat.accent), width: 52, height: 52 }}>
                  <Icon size={26} color={cat.accent} strokeWidth={2.25} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 19, color: C.text.primary, letterSpacing: "-0.01em" }}>
                    {cat.label}
                  </div>
                  <div style={{ fontSize: 12.5, color: C.text.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {items.join(" · ")}
                  </div>
                </div>
                <ChevronRight size={22} color={C.text.faint} style={{ flexShrink: 0 }} />
              </div>
            );
          })}

          {!loading && totalItems === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0", color: C.text.muted }}>
              <Inbox size={32} style={{ marginBottom: 8, color: C.text.faint }} />
              <div>No forms are currently set up for your company. Ask your admin.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
