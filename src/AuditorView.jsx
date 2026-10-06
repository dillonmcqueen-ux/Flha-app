// src/AuditorView.jsx
// What an auditor sees after signing in: a read-only list of the documents
// the account owner shared with them, each with its PDF. Nothing here writes,
// and there is no menu to anything else: every other endpoint treats an
// auditor session as no session (server-lib/auditorAccess.js). Access ends by
// itself on the date shown.
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, LogOut, ShieldCheck } from "lucide-react";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD } from "./theme";

async function post(body) {
  try {
    const res = await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? data : { error: data.error || "Something went wrong.", status: res.status };
  } catch (e) {
    return { error: "Connection error. Please try again." };
  }
}

const field = {
  boxSizing: "border-box", padding: "10px 12px", borderRadius: RAD.sm, border: `1.5px solid ${C.line}`,
  background: C.panelInset, color: C.text.primary, fontSize: 15, minHeight: 44, flex: "1 1 160px", minWidth: 0,
};

export default function AuditorView({ token, companyName, userName, onLogout }) {
  const [scope, setScope] = useState(null);
  const [docs, setDocs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [docKey, setDocKey] = useState("");
  const [siteId, setSiteId] = useState("");

  const load = useCallback(async () => {
    setError("");
    const [s, d] = await Promise.all([
      post({ action: "get_audit_scope", token }),
      post({ action: "list_audit_documents", token, documentKey: docKey || undefined, siteId: siteId || undefined }),
    ]);
    if (s.error) { setError(s.error); setLoaded(true); return; }
    setScope(s);
    if (d.error) setError(d.error); else setDocs(d.documents || []);
    setLoaded(true);
  }, [token, docKey, siteId]);
  useEffect(() => { load(); }, [load]);

  const card = { background: `linear-gradient(160deg, ${C.panelRaised} 0%, ${C.panel} 100%)`, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: 16, boxShadow: SHAD.md, marginBottom: 16 };

  return (
    <div style={{ fontFamily: FONT.body, background: C.bg, minHeight: "100vh", color: C.text.primary }}>
      <div style={{ padding: "18px 16px 40px", maxWidth: 720, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <ShieldCheck size={22} color={C.orange} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 21 }}>Audit view</div>
            <div style={{ fontSize: 13, color: C.text.muted }}>{companyName}{userName ? ` · ${userName}` : ""}</div>
          </div>
          <button onClick={onLogout} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: `1.5px solid ${C.line}`, color: C.text.muted, borderRadius: RAD.sm, padding: "8px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 44 }}>
            <LogOut size={15} />Sign out
          </button>
        </div>

        <div style={{ ...card, padding: 12, fontSize: 13, color: C.text.muted, lineHeight: 1.6 }}>
          Read only. You can open the documents below and their PDFs. {scope && scope.expiresAt ? `Your access ends on ${new Date(scope.expiresAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}.` : ""}
        </div>

        {error && <div style={{ fontSize: 14, color: C.status.danger.text, marginBottom: 12 }}>{error}</div>}

        {scope && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <select style={field} value={docKey} aria-label="Document type" onChange={e => setDocKey(e.target.value)}>
              <option value="">All document types</option>
              {scope.documents.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <select style={field} value={siteId} aria-label="Site" onChange={e => setSiteId(e.target.value)}>
              <option value="">All sites</option>
              {scope.sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        <div style={card}>
          {!loaded ? (
            <div style={{ fontSize: 14, color: C.text.muted }}>Loading…</div>
          ) : docs.length === 0 ? (
            <div style={{ fontSize: 14, color: C.text.muted }}>{error ? "" : "No documents match."}</div>
          ) : docs.map(d => (
            <div key={`${d.type}:${d.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderTop: `1px solid ${C.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{d.title}{d.subtitle ? ` · ${d.subtitle}` : ""}</div>
                <div style={{ fontSize: 13, color: C.text.muted }}>{d.site || "No site"} · {new Date(d.createdAt).toLocaleDateString("en-CA")}</div>
              </div>
              {d.pdf_url ? (
                <a href={d.pdf_url} target="_blank" rel="noreferrer" aria-label={`Open the PDF for ${d.title}`}
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, minWidth: 44, minHeight: 44, color: C.orange, fontWeight: 700, fontSize: 13, textDecoration: "none" }}>
                  <ExternalLink size={18} />PDF
                </a>
              ) : <span style={{ fontSize: 12, color: C.text.faint }}>No PDF</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
