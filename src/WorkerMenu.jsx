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
import { drainQueue } from "./offlineQueue.js";
import theme from "./theme.js";
import {
  HardHat,
  LogOut,
  ChevronRight,
  Inbox,
  ClipboardList,
  Tractor,
  Presentation,
  TriangleAlert,
  Siren,
  ClipboardCheck,
  CalendarCheck,
  Clock,
} from "lucide-react";

// Which form types have a queue-drain function wired up (offlineQueue.js +
// docs/scope-offline-capability.md Phase 1) — now all 8 worker-facing forms.
const RESUBMIT_HANDLERS = {
  daily: resubmitDaily,
  nearmiss: resubmitNearMiss,
  incident: resubmitIncident,
  toolbox: resubmitToolboxTalk,
  flha: resubmitFLHA,
  inspection: resubmitInspection,
  monthly: resubmitMonthly,
  customform: resubmitCustomForm,
};

// Built-in document types. `ready: false` shows a "coming soon" state.
// Icons are the same lucide components used for the matching tab in
// Dashboard.jsx's TAB_META, so a document type reads identically whether a
// worker or a supervisor is looking at it. `accent` stays a per-type brand
// color (same pattern Dashboard.jsx uses for its stat tiles) rather than
// forcing every doc type onto a single theme color — these colors are what
// let a worker tell FLHA apart from Incident apart from Toolbox at a glance.
const BUILTIN_TYPES = [
  { key: "flha", Icon: ClipboardList, title: "FLHA", desc: "Field Level Hazard Assessment", ready: true, accent: "#F97316" },
  { key: "inspection", Icon: Tractor, title: "Equipment Inspection", desc: "Pre-use machine inspection", ready: true, accent: "#0369A1" },
  { key: "toolbox", Icon: Presentation, title: "Toolbox Talk", desc: "Crew safety meeting record", ready: true, accent: "#7C3AED" },
  { key: "nearmiss", Icon: TriangleAlert, title: "Near Miss Report", desc: "Report a close call", ready: true, accent: "#D97706" },
  { key: "incident", Icon: Siren, title: "Incident Report", desc: "Report an injury or event", ready: true, accent: "#DC2626" },
  { key: "daily", Icon: ClipboardCheck, title: "Daily Report", desc: "End-of-day site summary", ready: true, accent: "#16A34A" },
  { key: "monthly", Icon: CalendarCheck, title: "Monthly Site Inspection", desc: "Monthly compliance checklist", ready: true, accent: "#4338CA" },
  { key: "timeclock", Icon: Clock, title: "Time Clock", desc: "Clock in and out", ready: true, accent: "#0891B2" },
];

export default function WorkerMenu({ companyId, companyName, userName = "", userId = null, onLogout, token, backLabel = "Sign out" }) {
  const [doc, setDoc] = useState(null);
  const [customFormId, setCustomFormId] = useState(null);
  const [builtinActive, setBuiltinActive] = useState(null); // null = loading
  const [customForms, setCustomForms] = useState([]);

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

  // Drain any queued offline submissions (docs/scope-offline-capability.md
  // Phase 1) whenever a worker lands back on this menu — covers reopening
  // the app after reconnecting, not just staying on the same form — and
  // again on the browser's `online` event for whoever leaves the menu open.
  // Best-effort: a drain failure here just leaves the item queued for the
  // next opportunity, same as offlineQueue.drainQueue already handles.
  useEffect(() => {
    if (!token) return;
    const drainAll = () => {
      Object.entries(RESUBMIT_HANDLERS).forEach(([formType, resubmit]) => {
        drainQueue(formType, (payload, clientSubmissionId) => resubmit(payload, clientSubmissionId, token))
          .catch(() => { /* best-effort — stays queued, tried again next time */ });
      });
    };
    drainAll();
    window.addEventListener("online", drainAll);
    return () => window.removeEventListener("online", drainAll);
  }, [token]);

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

  const s = {
    wrap: { fontFamily: theme.type.fontFamily, background: theme.colors.background, minHeight: "100vh", color: theme.colors.textPrimary },
    header: {
      background: theme.colors.primaryDarker,
      padding: "16px 20px", color: theme.colors.textOnPrimary,
      display: "flex", justifyContent: "space-between", alignItems: "center"
    },
    body: { padding: "18px 16px 40px", maxWidth: 640, margin: "0 auto" },
    card: (accent, ready) => ({
      background: theme.colors.surface, borderRadius: theme.radius.lg, padding: 18, boxShadow: theme.shadow.sm,
      border: `1px solid ${theme.colors.border}`,
      borderLeft: `4px solid ${accent}`, cursor: ready ? "pointer" : "default",
      display: "flex", alignItems: "center", gap: 14, opacity: ready ? 1 : 0.55,
      minHeight: 44,
    }),
  };

  const visibleBuiltins = (builtinActive
    ? BUILTIN_TYPES.filter(d => builtinActive[d.key] !== false)
    : BUILTIN_TYPES // show everything while loading, then narrow once loaded
  ).filter(d => d.key !== "timeclock" || userId); // needs a real per-person identity, regardless of loading state

  const loading = builtinActive === null;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: theme.radius.md, background: theme.colors.primary,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
          }}>
            <HardHat size={19} color={theme.colors.textOnPrimary} strokeWidth={2.25} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, opacity: 0.85, textTransform: "uppercase" }}>{companyName || "FORA"}</div>
            <div style={{ fontWeight: 800, fontSize: 19, marginTop: 1 }}>Choose a form</div>
          </div>
        </div>
        {onLogout && (
          <button onClick={onLogout} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "#ffffff18", color: "#fff", border: "1px solid #ffffff2A", borderRadius: theme.radius.pill,
            padding: "7px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer", minHeight: 36
          }}><LogOut size={14} /> {backLabel}</button>
        )}
      </div>

      <div style={s.body}>
        <div style={{ display: "grid", gap: 12 }}>
          {visibleBuiltins.map(d => (
            <div key={d.key} style={s.card(d.accent, d.ready)} onClick={() => d.ready && setDoc(d.key)}>
              <div style={{
                width: 52, height: 52, borderRadius: theme.radius.md, background: `${d.accent}18`,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
              }}>
                <d.Icon size={24} color={d.accent} strokeWidth={2} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: theme.colors.textPrimary }}>{d.title}</div>
                <div style={{ fontSize: 13, color: theme.colors.textSecondary, marginTop: 1 }}>{d.desc}</div>
              </div>
              {d.ready
                ? <ChevronRight size={20} color={theme.colors.textMuted} style={{ flexShrink: 0 }} />
                : <span style={{ fontSize: 11, fontWeight: 700, color: theme.colors.textMuted, background: theme.colors.surfaceSunken, padding: "4px 9px", borderRadius: theme.radius.pill, flexShrink: 0 }}>SOON</span>}
            </div>
          ))}

          {customForms.map(f => (
            <div key={f.id} style={s.card(f.accent_color || "#4338CA", true)} onClick={() => { setCustomFormId(f.id); setDoc("custom"); }}>
              <div style={{ width: 52, height: 52, borderRadius: theme.radius.md, background: theme.colors.surfaceSunken, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, flexShrink: 0 }}>{f.icon || "📄"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: theme.colors.textPrimary }}>{f.title}</div>
                <div style={{ fontSize: 13, color: theme.colors.textSecondary, marginTop: 1 }}>Custom document</div>
              </div>
              <ChevronRight size={20} color={theme.colors.textMuted} style={{ flexShrink: 0 }} />
            </div>
          ))}

          {!loading && visibleBuiltins.length === 0 && customForms.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0", color: theme.colors.textMuted }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}><Inbox size={32} strokeWidth={1.5} /></div>
              No forms are currently set up for your company. Ask your admin.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
