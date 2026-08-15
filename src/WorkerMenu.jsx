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
import MyDocuments from "./MyDocuments.jsx";
import { drainQueue } from "./offlineQueue.js";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD, glow as GLOW } from "./theme";
import {
  ClipboardList, ClipboardCheck, Hammer, AlertTriangle, Siren, CalendarClock,
  Clock, LogOut, ChevronRight, FileText, Inbox, FolderClock,
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
// Icons match Dashboard.jsx's TAB_ICON for the same document type — a
// worker and a supervisor should see the same glyph for "FLHA", etc.
// Accent colors are untouched from the pre-redesign version (existing
// precedent per-doc-type — not part of this pass's scope).
const BUILTIN_TYPES = [
  { key: "flha", icon: ClipboardList, title: "FLHA", desc: "Field Level Hazard Assessment", ready: true, accent: "#F97316" },
  { key: "inspection", icon: ClipboardCheck, title: "Equipment Inspection", desc: "Pre-use machine inspection", ready: true, accent: "#0369A1" },
  { key: "toolbox", icon: Hammer, title: "Toolbox Talk", desc: "Crew safety meeting record", ready: true, accent: "#7C3AED" },
  { key: "nearmiss", icon: AlertTriangle, title: "Near Miss Report", desc: "Report a close call", ready: true, accent: "#D97706" },
  { key: "incident", icon: Siren, title: "Incident Report", desc: "Report an injury or event", ready: true, accent: "#DC2626" },
  { key: "daily", icon: ClipboardList, title: "Daily Report", desc: "End-of-day site summary", ready: true, accent: "#16A34A" },
  { key: "monthly", icon: CalendarClock, title: "Monthly Site Inspection", desc: "Monthly compliance checklist", ready: true, accent: "#4338CA" },
  { key: "timeclock", icon: Clock, title: "Time Clock", desc: "Clock in and out", ready: true, accent: "#0891B2" },
];

export default function WorkerMenu({ companyId, companyName, userName = "", userId = null, onLogout, token, backLabel = "Sign out" }) {
  const [doc, setDoc] = useState(null);
  const [customFormId, setCustomFormId] = useState(null);
  const [builtinActive, setBuiltinActive] = useState(null); // null = loading
  const [customForms, setCustomForms] = useState([]);
  const [showMyDocs, setShowMyDocs] = useState(false);

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

  const visibleBuiltins = (builtinActive
    ? BUILTIN_TYPES.filter(d => builtinActive[d.key] !== false)
    : BUILTIN_TYPES // show everything while loading, then narrow once loaded
  ).filter(d => d.key !== "timeclock" || userId); // needs a real per-person identity, regardless of loading state

  const loading = builtinActive === null;

  return (
    <div style={s.wrap}>
      <header style={{
        position: "sticky", top: 0, zIndex: 40,
        background: "rgba(10,10,10,0.88)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        borderBottom: `1px solid ${C.line}`, padding: "14px 20px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.orange, boxShadow: "0 0 14px 2px rgba(249,115,22,0.7)", flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.text.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {companyName || "FORA"}
            </div>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 17, color: C.text.primary, letterSpacing: "-0.01em" }}>Choose a form</div>
          </div>
        </div>
        {onLogout && (
          <button onClick={onLogout} style={{
            display: "flex", alignItems: "center", gap: 6, color: C.text.body, fontSize: 13,
            border: `1px solid ${C.line}`, background: "transparent", padding: "8px 14px",
            borderRadius: RAD.md, cursor: "pointer", fontWeight: 600, flexShrink: 0, minHeight: 36,
          }}>
            <LogOut size={14} /> {backLabel}
          </button>
        )}
      </header>

      <div style={s.body}>
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
              Pick a document to fill out below.
            </div>
          </div>
        </div>

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
          {visibleBuiltins.map(d => {
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
          })}

          {customForms.map(f => (
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
          ))}

          {!loading && visibleBuiltins.length === 0 && customForms.length === 0 && (
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
