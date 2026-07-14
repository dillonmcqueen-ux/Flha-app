import { useState } from "react";
import App from "./App.jsx";
import Inspection from "./Inspection.jsx";
import ToolboxTalk from "./ToolboxTalk.jsx";
import NearMiss from "./NearMiss.jsx";
import Incident from "./Incident.jsx";

// Document types. `ready: false` shows a "coming soon" state.
const DOC_TYPES = [
  { key: "flha", icon: "🦺", title: "FLHA", desc: "Field Level Hazard Assessment", ready: true, accent: "#F97316" },
  { key: "inspection", icon: "🚜", title: "Equipment Inspection", desc: "Pre-use machine inspection", ready: true, accent: "#0369A1" },
  { key: "toolbox", icon: "🧰", title: "Toolbox Talk", desc: "Crew safety meeting record", ready: true, accent: "#7C3AED" },
  { key: "nearmiss", icon: "⚠️", title: "Near Miss Report", desc: "Report a close call", ready: true, accent: "#D97706" },
  { key: "incident", icon: "🚑", title: "Incident Report", desc: "Report an injury or event", ready: true, accent: "#DC2626" },
  { key: "daily", icon: "📋", title: "Daily Report", desc: "End-of-day site summary", ready: false, accent: "#16A34A" },
];

export default function WorkerMenu({ companyId, companyName, onLogout }) {
  const [doc, setDoc] = useState(null);

  if (doc === "flha") {
    return <App forcedCompanyId={companyId} onLogout={() => setDoc(null)} />;
  }
  if (doc === "inspection") {
    return <Inspection companyId={companyId} companyName={companyName} onBack={() => setDoc(null)} onLogout={onLogout} />;
  }
  if (doc === "toolbox") {
    return <ToolboxTalk companyId={companyId} companyName={companyName} onBack={() => setDoc(null)} onLogout={onLogout} />;
  }
  if (doc === "nearmiss") {
    return <NearMiss companyId={companyId} companyName={companyName} onBack={() => setDoc(null)} onLogout={onLogout} />;
  }
  if (doc === "incident") {
    return <Incident companyId={companyId} companyName={companyName} onBack={() => setDoc(null)} onLogout={onLogout} />;
  }

  const s = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#F0F4F8", minHeight: "100vh" },
    header: { background: "linear-gradient(135deg,#1E3A5F,#2D5F8A)", padding: "20px 20px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" },
    body: { padding: "18px 16px 40px", maxWidth: 640, margin: "0 auto" },
    card: (accent, ready) => ({
      background: "#fff", borderRadius: 14, padding: 18, boxShadow: "0 1px 3px #0f172a12",
      borderLeft: `4px solid ${accent}`, cursor: ready ? "pointer" : "default",
      display: "flex", alignItems: "center", gap: 14, opacity: ready ? 1 : 0.55,
    }),
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, opacity: 0.8, textTransform: "uppercase" }}>{companyName || "FORA"}</div>
          <div style={{ fontWeight: 800, fontSize: 22, marginTop: 2 }}>Choose a form</div>
        </div>
        {onLogout && <button onClick={onLogout} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "7px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Sign out</button>}
      </div>

      <div style={s.body}>
        <div style={{ display: "grid", gap: 12 }}>
          {DOC_TYPES.map(d => (
            <div key={d.key} style={s.card(d.accent, d.ready)} onClick={() => d.ready && setDoc(d.key)}>
              <div style={{ width: 52, height: 52, borderRadius: 12, background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, flexShrink: 0 }}>{d.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: "#1E293B" }}>{d.title}</div>
                <div style={{ fontSize: 13, color: "#64748B", marginTop: 1 }}>{d.desc}</div>
              </div>
              {d.ready
                ? <span style={{ fontSize: 20, color: "#94A3B8", flexShrink: 0 }}>→</span>
                : <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", background: "#F1F5F9", padding: "4px 9px", borderRadius: 20, flexShrink: 0 }}>SOON</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
