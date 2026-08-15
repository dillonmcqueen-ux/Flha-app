// src/MyDocuments.jsx
// "A worker who submits a form should be able to see forms they have
// submitted before. If they accidentally log out or whatever, have a spot
// where they can find their unfinished and submitted forms, pdf ready if
// needed to present to someone on the fly." — customer feedback.
//
// Two sections:
//  - Unfinished: every in-progress draft this device has for this company
//    (useDraftAutosave.js already autosaves one per form type — this just
//    surfaces what's already sitting in localStorage instead of only
//    restoring it silently when the worker happens to reopen that exact
//    form). Survives logout because clearSession() in Login.jsx never
//    touches draft keys.
//  - Submitted: real records pulled from the server via
//    api/customforms.js's get_my_documents action, each with a signed,
//    ready-to-open PDF link — "pdf ready to present to someone on the fly."
import { useState, useEffect } from "react";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD } from "./theme";
import { ChevronLeft, FileText, RotateCcw, Trash2, ExternalLink, Inbox } from "lucide-react";
import { clearDraft } from "./useDraftAutosave.js";

const NAME_KEY_PREFIX = "fora_myname_";
const DRAFT_PREFIX = "fora_draft_";

const TYPE_META = {
  flha: { label: "FLHA", icon: "🦺" },
  inspection: { label: "Equipment Inspection", icon: "🔧" },
  toolbox: { label: "Toolbox Talk", icon: "🗣️" },
  nearmiss: { label: "Near Miss Report", icon: "👀" },
  incident: { label: "Incident Report", icon: "🚨" },
  daily: { label: "Daily Report", icon: "📋" },
  monthly: { label: "Monthly Inspection", icon: "🗓️" },
  customform: { label: "Custom Document", icon: "🗂️" },
};

// Every draft key looks like fora_draft_<formType>_<scopeId>, and scopeId is
// either just companyId, or "companyId::formId" for custom forms (see
// CustomForm.jsx's draftScope — a company can have several custom document
// types active at once, each needs its own slot).
function scanDrafts(companyId) {
  const drafts = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DRAFT_PREFIX)) continue;
      const rest = key.slice(DRAFT_PREFIX.length);
      const sep = rest.indexOf("_");
      if (sep === -1) continue;
      const type = rest.slice(0, sep);
      const scopeId = rest.slice(sep + 1);
      if (!TYPE_META[type]) continue;

      let formId = null;
      let scopeCompanyId = scopeId;
      if (scopeId.includes("::")) {
        const [cid, fid] = scopeId.split("::");
        scopeCompanyId = cid;
        formId = fid;
      }
      if (String(scopeCompanyId) !== String(companyId)) continue;

      let savedAt = null;
      try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        savedAt = parsed?.savedAt || null;
      } catch (e) { /* leave savedAt null */ }

      drafts.push({ key, type, formId, savedAt });
    }
  } catch (e) { /* localStorage unavailable — no drafts to show */ }
  return drafts.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export default function MyDocuments({ companyId, userName, userId, token, onBack, onResume }) {
  const nameKey = `${NAME_KEY_PREFIX}${companyId}`;
  const hasVerifiedIdentity = !!(userId && userName);

  const [nameInput, setNameInput] = useState("");
  const [confirmedName, setConfirmedName] = useState(() => {
    if (hasVerifiedIdentity) return userName;
    try { return localStorage.getItem(nameKey) || ""; } catch (e) { return ""; }
  });
  const [documents, setDocuments] = useState(null); // null = loading
  const [loadError, setLoadError] = useState("");
  const [drafts, setDrafts] = useState(() => scanDrafts(companyId));

  useEffect(() => {
    if (!confirmedName) { setDocuments([]); return undefined; }
    let cancelled = false;
    setDocuments(null);
    setLoadError("");
    fetch("/api/customforms", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_my_documents", token, workerName: confirmedName }),
    })
      .then(r => r.json())
      .then(data => { if (!cancelled) setDocuments(data.documents || []); })
      .catch(() => { if (!cancelled) { setDocuments([]); setLoadError("Couldn't load your submitted forms right now."); } });
    return () => { cancelled = true; };
  }, [confirmedName, token]);

  const saveName = () => {
    const v = nameInput.trim();
    if (!v) return;
    setConfirmedName(v);
    try { localStorage.setItem(nameKey, v); } catch (e) { /* not fatal — just re-prompt next time */ }
  };

  const discardDraft = (d) => {
    if (!window.confirm("Discard this unfinished form? This can't be undone.")) return;
    clearDraft(d.type, d.formId ? `${companyId}::${d.formId}` : companyId);
    setDrafts(prev => prev.filter(x => x.key !== d.key));
  };

  const s = {
    wrap: { fontFamily: FONT.body, background: C.bg, minHeight: "100vh", color: C.text.primary },
    body: { padding: "18px 16px 40px", maxWidth: 640, margin: "0 auto" },
    sectionTitle: { fontFamily: FONT.heading, fontWeight: 700, fontSize: 15, color: C.text.primary, margin: "22px 0 10px" },
    card: { background: `linear-gradient(160deg, ${C.panelRaised} 0%, ${C.panel} 100%)`, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: "14px 16px", boxShadow: SHAD.md, display: "flex", alignItems: "center", gap: 12, marginBottom: 10 },
    empty: { textAlign: "center", padding: "24px 0", color: C.text.muted, fontSize: 13.5 },
    btn: (accent) => ({ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${accent}60`, color: accent, borderRadius: RAD.md, padding: "8px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", minHeight: 36 }),
  };

  return (
    <div style={s.wrap}>
      <header style={{
        position: "sticky", top: 0, zIndex: 40,
        background: "rgba(10,10,10,0.88)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        borderBottom: `1px solid ${C.line}`, padding: "14px 20px",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none", color: C.text.body, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 6 }}>
          <ChevronLeft size={18} /> Back
        </button>
        <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 17, color: C.text.primary }}>My Forms</div>
      </header>

      <div style={s.body}>
        <div style={s.sectionTitle}>Unfinished</div>
        {drafts.length === 0 ? (
          <div style={s.empty}>Nothing in progress right now.</div>
        ) : drafts.map(d => {
          const meta = TYPE_META[d.type];
          return (
            <div key={d.key} style={s.card}>
              <div style={{ fontSize: 22 }}>{meta.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.text.primary }}>{meta.label}</div>
                <div style={{ fontSize: 12, color: C.text.muted, marginTop: 1 }}>
                  {d.savedAt ? `Saved ${new Date(d.savedAt).toLocaleString("en-CA")}` : "In progress"}
                </div>
              </div>
              <button style={s.btn(C.orange)} onClick={() => onResume(d.type, d.formId)}><RotateCcw size={13} /> Resume</button>
              <button style={s.btn("#DC2626")} onClick={() => discardDraft(d)}><Trash2 size={13} /></button>
            </div>
          );
        })}

        <div style={s.sectionTitle}>Submitted</div>
        {!confirmedName ? (
          <div style={s.card}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 8 }}>
                Enter your name the way you use it on forms, so we can find what you've submitted.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveName(); }}
                  placeholder="Your name"
                  style={{ flex: 1, padding: "9px 12px", borderRadius: RAD.md, border: `1px solid ${C.line}`, background: C.panelInset, color: C.text.primary, fontSize: 14, minHeight: 38, boxSizing: "border-box" }}
                />
                <button style={{ ...s.btn(C.orange), background: C.orange, color: "#0A0A0A", border: "none" }} onClick={saveName}>Find</button>
              </div>
            </div>
          </div>
        ) : documents === null ? (
          <div style={s.empty}>Loading…</div>
        ) : loadError ? (
          <div style={s.empty}>{loadError}</div>
        ) : documents.length === 0 ? (
          <div style={s.empty}>
            <Inbox size={26} style={{ marginBottom: 6, color: C.text.faint }} />
            <div>No submitted forms found for "{confirmedName}" yet.</div>
            {!hasVerifiedIdentity && (
              <button style={{ ...s.btn(C.text.muted), marginTop: 10 }} onClick={() => { setConfirmedName(""); try { localStorage.removeItem(nameKey); } catch (e) {} }}>Not you? Change name</button>
            )}
          </div>
        ) : (
          documents.map(doc => {
            const meta = TYPE_META[doc.type] || { label: doc.title, icon: "📄" };
            return (
              <div key={`${doc.type}-${doc.id}`} style={s.card}>
                <div style={{ fontSize: 22 }}>{meta.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: C.text.primary }}>{doc.title || meta.label}</div>
                  <div style={{ fontSize: 12, color: C.text.muted, marginTop: 1 }}>
                    {doc.subtitle ? `${doc.subtitle} · ` : ""}{new Date(doc.createdAt).toLocaleString("en-CA")}
                  </div>
                </div>
                {doc.pdf_url
                  ? <a href={doc.pdf_url} target="_blank" rel="noreferrer" style={{ ...s.btn(C.orange), textDecoration: "none" }}><ExternalLink size={13} /> PDF</a>
                  : <span style={{ fontSize: 11, color: C.text.faint, fontWeight: 600 }}>No PDF</span>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
