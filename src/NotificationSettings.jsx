// src/NotificationSettings.jsx
// The Account Owner's (and the founder's) switches for document notifications.
// Per document: an Email switch, and an optional list of people who are always
// told. Everyone else is worked out for each record from who can already see it
// (department, division and site for supervisors, crew for leads), with the
// Owner as the fallback when nobody else would be told. Off until switched on.
//
// A notice carries only the document name and the site, never the content. The
// people named here are told only if they are allowed to see the document.
import { useCallback, useEffect, useState } from "react";
import { Mail, X } from "lucide-react";
import { colors as C, radius as RAD } from "./theme";
import { companyCall } from "./useCompanyStructure.js";

const field = {
  boxSizing: "border-box", padding: "9px 12px", borderRadius: RAD.sm, border: `1.5px solid ${C.line}`,
  background: C.panelInset, color: C.text.primary, fontSize: 14, minHeight: 40, flex: "1 1 150px", minWidth: 0,
};
const MAX_EXTRAS = 10;

export default function NotificationSettings({ token, companyId, roster = [] }) {
  const [loaded, setLoaded] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [noEmail, setNoEmail] = useState([]);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");

  const scope = companyId ? { companyId } : {};

  const load = useCallback(async () => {
    const r = await companyCall({ action: "list_document_notifications", token, ...scope });
    if (r.error) { setError(r.error); setLoaded(true); return; }
    setDocuments(r.documents || []);
    setNoEmail(r.noEmail || []);
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, companyId]);
  useEffect(() => { load(); }, [load]);

  const save = async (doc, patch) => {
    setError(""); setBusyKey(doc.key);
    const r = await companyCall({ action: "set_document_notification", token, ...scope, documentKey: doc.key, ...patch });
    setBusyKey("");
    if (r.error) { setError(r.error); return; }
    setDocuments(list => list.map(d => d.key === doc.key ? { ...d, ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), ...(patch.extraRosterIds !== undefined ? { extraRosterIds: patch.extraRosterIds } : {}) } : d));
  };

  const people = roster.filter(m => m.active && (m.role === "supervisor" || m.role === "worker"));
  const nameOf = (id) => roster.find(m => Number(m.id) === Number(id))?.name || "Someone";
  const lacksEmail = (id) => noEmail.some(p => Number(p.id) === Number(id));

  return (
    <div style={{ background: C.panelInset, border: `1px solid ${C.line}`, borderRadius: RAD.md, padding: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800, color: C.text.primary, marginBottom: 2 }}><Mail size={14} />Email notifications</div>
      <div style={{ fontSize: 12, color: C.text.faint, marginBottom: 12, lineHeight: 1.5 }}>
        Choose which documents send an email when someone submits one. It goes to the supervisors who can see that record (by department, division or site) and to a crew lead for their own crew. If nobody else would be told, it comes to you. The email only names the document and the site. All of it is off until you switch it on.
      </div>
      {error && <div style={{ fontSize: 12.5, color: C.status.danger.text, marginBottom: 8 }}>{error}</div>}
      {!loaded ? (
        <div style={{ fontSize: 12.5, color: C.text.faint }}>Loading…</div>
      ) : documents.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.text.faint }}>No documents are switched on for your company yet.</div>
      ) : (
        <>
          {documents.map(d => {
            const chosen = people.filter(m => !d.extraRosterIds.includes(Number(m.id)));
            return (
              <div key={d.key} style={{ padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", minHeight: 40 }}>
                  <input type="checkbox" checked={d.enabled} disabled={busyKey === d.key} onChange={e => save(d, { enabled: e.target.checked })}
                    style={{ width: 20, height: 20, accentColor: C.orange }} aria-label={`Email when ${d.label} is submitted`} />
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text.body }}>{d.label}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: d.enabled ? C.orange : C.text.faint, marginLeft: "auto" }}>{d.enabled ? "Emails on" : "Off"}</span>
                </label>
                {d.enabled && (
                  <div style={{ paddingLeft: 28 }}>
                    <div style={{ fontSize: 11.5, color: C.text.muted, margin: "2px 0 6px" }}>Always tell (they must be able to see this document):</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                      {d.extraRosterIds.length === 0 && <span style={{ fontSize: 12, color: C.text.faint }}>Nobody extra</span>}
                      {d.extraRosterIds.map(id => (
                        <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, color: C.text.body, border: `1px solid ${C.line}`, borderRadius: RAD.sm, padding: "3px 6px 3px 9px" }}>
                          {nameOf(id)}
                          {lacksEmail(id) && <span style={{ fontSize: 11, color: C.status.warning.text }}>(no email on file)</span>}
                          <button type="button" aria-label={`Stop telling ${nameOf(id)} about ${d.label}`} disabled={busyKey === d.key}
                            onClick={() => save(d, { extraRosterIds: d.extraRosterIds.filter(x => x !== id) })}
                            style={{ background: "transparent", border: "none", cursor: "pointer", color: C.text.faint, display: "flex", padding: 2 }}><X size={13} /></button>
                        </span>
                      ))}
                    </div>
                    {d.extraRosterIds.length < MAX_EXTRAS && chosen.length > 0 && (
                      <select style={{ ...field, flex: "none", width: "100%", maxWidth: 320 }} value="" aria-label={`Add someone to always tell about ${d.label}`} disabled={busyKey === d.key}
                        onChange={e => e.target.value && save(d, { extraRosterIds: [...d.extraRosterIds, Number(e.target.value)] })}>
                        <option value="">Add a person</option>
                        {chosen.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {noEmail.length > 0 && (
            <div style={{ fontSize: 11.5, color: C.status.warning.text, marginTop: 10, lineHeight: 1.5 }}>
              {noEmail.length} active {noEmail.length === 1 ? "person has" : "people have"} no email on file, so they can't be told: {noEmail.slice(0, 6).map(p => p.name).join(", ")}{noEmail.length > 6 ? " and others" : ""}.
            </div>
          )}
          <div style={{ fontSize: 11.5, color: C.text.faint, lineHeight: 1.5, marginTop: 8 }}>
            Each person gets at most 3 emails per document in 10 minutes. After that you get one summary with the count. Anonymous near misses are sent by site only and never name who filed them.
          </div>
        </>
      )}
    </div>
  );
}
