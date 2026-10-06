// src/AuditorsManager.jsx
// The Account Owner's (and the founder's) place to give an outside auditor
// read-only access. An auditor reads the documents of the types you choose,
// filed at the sites (or in the divisions) you choose, for 14 days. They never
// write anything, never see the Brain or Analytics, and do not use up a seat.
// Signing in always needs their PIN and an authenticator.
//
// Access is granted, never assumed: nothing is readable until you pick it, and
// access ends by itself 14 days after you send it.
import { useCallback, useEffect, useState } from "react";
import { Plus, Send, Ban, Save } from "lucide-react";
import { colors as C, radius as RAD } from "./theme";
import { companyCall } from "./useCompanyStructure.js";

const field = {
  boxSizing: "border-box", padding: "9px 12px", borderRadius: RAD.sm, border: `1.5px solid ${C.line}`,
  background: C.panelInset, color: C.text.primary, fontSize: 14, minHeight: 40, flex: "1 1 160px", minWidth: 0,
};
const btn = (tone) => ({
  display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 13px", borderRadius: RAD.sm, cursor: "pointer",
  fontWeight: 700, fontSize: 13, minHeight: 40, background: "transparent", color: tone, border: `1.5px solid ${tone}`,
});
const chip = (on) => ({
  padding: "6px 12px", borderRadius: RAD.pill, cursor: "pointer", fontSize: 12.5, fontWeight: 700, minHeight: 34,
  background: on ? C.status.success.bg : C.panelInset, color: on ? C.status.success.text : C.text.muted,
  border: `1px solid ${on ? C.status.success.border : C.line}`,
});

function AuditorCard({ a, documents, divisions, sites, token, scope, onChanged, setError }) {
  const [draft, setDraft] = useState({ divisionIds: a.divisionIds, siteIds: a.siteIds, documentKeys: a.documentKeys });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => { setDraft({ divisionIds: a.divisionIds, siteIds: a.siteIds, documentKeys: a.documentKeys }); }, [a.divisionIds, a.siteIds, a.documentKeys]);

  const toggle = (field, value) => setDraft(d => ({ ...d, [field]: d[field].includes(value) ? d[field].filter(x => x !== value) : [...d[field], value] }));
  const dirty = JSON.stringify(draft) !== JSON.stringify({ divisionIds: a.divisionIds, siteIds: a.siteIds, documentKeys: a.documentKeys });

  const run = async (body, after) => {
    setError(""); setNote(""); setBusy(true);
    const r = await companyCall({ token, ...scope, ...body });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    after && after(r);
    onChanged();
  };

  const status = !a.active ? "Deactivated"
    : a.live ? `Access until ${new Date(a.expiresAt).toLocaleDateString("en-CA")}`
    : a.expiresAt ? "Access ended" : "Access not sent yet";

  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: "12px 0" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: C.text.primary }}>{a.name}</span>
        <span style={{ fontSize: 12, color: C.text.faint }}>{a.email}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: a.live ? C.status.success.text : C.text.muted }}>{status}</span>
        {a.live && !a.mfaEnabled && <span style={{ fontSize: 11.5, color: C.status.warning.text }}>Authenticator not set up yet</span>}
      </div>

      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text.muted, margin: "8px 0 4px" }}>Can read these documents</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {documents.map(d => <button key={d.key} type="button" style={chip(draft.documentKeys.includes(d.key))} onClick={() => toggle("documentKeys", d.key)}>{draft.documentKeys.includes(d.key) ? "✓ " : ""}{d.label}</button>)}
      </div>

      {divisions.length > 0 && (
        <>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text.muted, margin: "10px 0 4px" }}>At every site in these divisions</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {divisions.map(d => <button key={d.id} type="button" style={chip(draft.divisionIds.includes(d.id))} onClick={() => toggle("divisionIds", d.id)}>{draft.divisionIds.includes(d.id) ? "✓ " : ""}{d.name}</button>)}
          </div>
        </>
      )}

      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text.muted, margin: "10px 0 4px" }}>And at these sites</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {sites.map(s => <button key={s.id} type="button" style={chip(draft.siteIds.includes(s.id))} onClick={() => toggle("siteIds", s.id)}>{draft.siteIds.includes(s.id) ? "✓ " : ""}{s.name}</button>)}
        {sites.length === 0 && <span style={{ fontSize: 12, color: C.text.faint }}>No sites yet.</span>}
      </div>
      <div style={{ fontSize: 11.5, color: C.text.faint, marginTop: 6, lineHeight: 1.5 }}>
        A document is shown by the site it was filed at. Equipment inspections have no site, so they can't be shared yet.
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
        <button type="button" disabled={!dirty || busy} style={{ ...btn(C.orange), opacity: !dirty || busy ? 0.5 : 1 }}
          onClick={() => run({ action: "set_auditor_scope", rosterId: a.id, ...draft }, () => setNote("Saved."))}><Save size={14} />Save what they can read</button>
        <button type="button" disabled={busy || dirty || !a.active} style={{ ...btn(C.status.success.text), opacity: busy || dirty || !a.active ? 0.5 : 1 }}
          onClick={() => run({ action: "send_auditor_access", rosterId: a.id }, (r) => setNote(r.emailSent ? "Access sent for 14 days." : "Access is set for 14 days but the email did not send. Try again."))}>
          <Send size={14} />{a.live ? "Resend and restart 14 days" : "Send 14 day access"}
        </button>
        {a.live && (
          <button type="button" disabled={busy} style={btn(C.status.danger.text)}
            onClick={() => { if (window.confirm(`End ${a.name}'s access now?`)) run({ action: "revoke_auditor_access", rosterId: a.id }, () => setNote("Access ended.")); }}>
            <Ban size={14} />End access now
          </button>
        )}
        {dirty && <span style={{ fontSize: 11.5, color: C.text.faint }}>Save the changes before sending.</span>}
        {note && <span style={{ fontSize: 12, color: C.status.success.text }}>{note}</span>}
      </div>
    </div>
  );
}

export default function AuditorsManager({ token, companyId, divisions = [], sites = [] }) {
  const [loaded, setLoaded] = useState(false);
  const [auditors, setAuditors] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = companyId ? { companyId } : {};

  const load = useCallback(async () => {
    const r = await companyCall({ action: "list_auditors", token, ...scope });
    if (r.error) setError(r.error); else { setAuditors(r.auditors || []); setDocuments(r.documents || []); }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, companyId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setError(""); setBusy(true);
    const r = await companyCall({ action: "create_auditor", token, ...scope, name, email });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setName(""); setEmail("");
    load();
  };

  return (
    <div style={{ background: C.panelInset, border: `1px solid ${C.line}`, borderRadius: RAD.md, padding: 14, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.text.primary, marginBottom: 2 }}>Auditors</div>
      <div style={{ fontSize: 12, color: C.text.faint, marginBottom: 12, lineHeight: 1.5 }}>
        Give an outside auditor read-only access for 14 days. They see only the documents and sites you pick, can open each document's PDF, and can't change anything or see the Brain or Analytics. They don't use up a seat, and signing in needs their PIN and an authenticator.
      </div>
      {error && <div style={{ fontSize: 12.5, color: C.status.danger.text, marginBottom: 8 }}>{error}</div>}
      {!loaded ? <div style={{ fontSize: 12.5, color: C.text.faint }}>Loading…</div> : (
        <>
          {auditors.length === 0 && <div style={{ fontSize: 12.5, color: C.text.faint, marginBottom: 10 }}>No auditors yet.</div>}
          {auditors.map(a => (
            <AuditorCard key={a.id} a={a} documents={documents} divisions={divisions} sites={sites} token={token} scope={scope} onChanged={load} setError={setError} />
          ))}
          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text.muted, margin: "12px 0 6px" }}>Add an auditor</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input style={field} value={name} onChange={e => setName(e.target.value)} placeholder="Name" aria-label="Auditor name" />
            <input style={field} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" aria-label="Auditor email" />
            <button type="button" disabled={busy || !name.trim() || !email.trim()} style={{ ...btn(C.orange), opacity: busy || !name.trim() || !email.trim() ? 0.5 : 1 }} onClick={add}><Plus size={14} />Add</button>
          </div>
        </>
      )}
    </div>
  );
}
