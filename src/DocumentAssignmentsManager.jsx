// src/DocumentAssignmentsManager.jsx
// The Account Owner's (and the founder's) screen for who may submit or view
// each document. An assignment only ever narrows access: a document with no
// assignment behaves as it always did, and a department or division on its
// own gives nobody anything. The Owner is never affected.
//
// Each row shows how many people it reaches right now. An assignment that
// reaches nobody switches its document off for everyone but the Owner, so a
// zero is shown in red before anyone finds out the hard way.
import { useCallback, useEffect, useState } from "react";
import { Trash2, Plus, CalendarClock } from "lucide-react";
import { colors as C, radius as RAD } from "./theme";
import { companyCall } from "./useCompanyStructure.js";

const field = {
  boxSizing: "border-box", padding: "9px 12px", borderRadius: RAD.sm, border: `1.5px solid ${C.line}`,
  background: C.panelInset, color: C.text.primary, fontSize: 14, minHeight: 40, flex: "1 1 150px", minWidth: 0,
};
const addBtn = {
  display: "inline-flex", alignItems: "center", gap: 4, padding: "9px 14px", borderRadius: RAD.sm, cursor: "pointer",
  fontWeight: 700, fontSize: 13, minHeight: 40, background: "transparent", color: C.orange, border: `1.5px solid ${C.orange}`,
};
const AUDIENCES = [
  { value: "everyone", label: "Everyone" },
  { value: "role", label: "A role" },
  { value: "department", label: "A department" },
  { value: "division", label: "A division" },
  { value: "site", label: "A site" },
  { value: "individual", label: "One person" },
];
const ROLE_LABEL = { worker: "Workers", supervisor: "Supervisors" };

export default function DocumentAssignmentsManager({ token, companyId, departments = [], divisions = [], sites = [], roster = [] }) {
  const [loaded, setLoaded] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [documentKey, setDocumentKey] = useState("");
  const [action, setAction] = useState("submit");
  const [audienceType, setAudienceType] = useState("everyone");
  const [audienceValue, setAudienceValue] = useState("");
  const [dueAt, setDueAt] = useState("");
  // false = a task (the default): it shows on the person's "Assigned to you"
  // list and takes nothing away from anyone else. true = only these people.
  const [restricts, setRestricts] = useState(false);

  const scope = companyId ? { companyId } : {};

  const load = useCallback(async () => {
    const r = await companyCall({ action: "list_document_assignments", token, ...scope });
    if (r.error) { setError(r.error); setLoaded(true); return; }
    setDocuments(r.documents || []);
    setAssignments(r.assignments || []);
    setNeedsSetup(r.needsSetup === true);
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, companyId]);
  useEffect(() => { load(); }, [load]);

  const doc = documents.find(d => d.key === documentKey);
  const docActions = doc ? doc.actions : ["submit", "view"];
  const labelFor = (key) => documents.find(d => d.key === key)?.label || key;
  const audienceLabel = (a) => {
    switch (a.audienceType) {
      case "everyone": return "Everyone";
      case "role": return ROLE_LABEL[a.audienceValue] || a.audienceValue;
      case "department": return departments.find(d => d.key === a.audienceValue)?.label || a.audienceValue;
      case "division": return divisions.find(d => String(d.id) === String(a.audienceValue))?.name || "A division";
      case "site": return sites.find(s => String(s.id) === String(a.audienceValue))?.name || "A site";
      case "individual": return roster.find(m => String(m.id) === String(a.audienceValue))?.name || "One person";
      default: return a.audienceValue;
    }
  };

  const valueOptions = () => {
    if (audienceType === "role") return [{ v: "worker", l: "Workers" }, { v: "supervisor", l: "Supervisors" }];
    if (audienceType === "department") return departments.map(d => ({ v: d.key, l: d.label }));
    if (audienceType === "division") return divisions.map(d => ({ v: String(d.id), l: d.name }));
    if (audienceType === "site") return sites.map(s => ({ v: String(s.id), l: s.name }));
    if (audienceType === "individual") return roster.filter(m => m.active).map(m => ({ v: String(m.id), l: m.name }));
    return [];
  };

  const canAdd = documentKey && (audienceType === "everyone" || audienceValue);

  const add = async () => {
    setError(""); setBusy(true);
    const r = await companyCall({
      action: "create_document_assignment", token, ...scope, documentKey,
      // `action` is the request's own verb, so the assignment's verb travels as assignAction.
      audienceType, audienceValue: audienceType === "everyone" ? null : audienceValue,
      assignAction: action, restricts: action === "view" ? true : restricts, dueAt: action === "submit" && dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null,
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setAudienceValue(""); setDueAt(""); setRestricts(false);
    load();
  };

  const remove = async (a) => {
    if (!window.confirm(`Remove this assignment from ${labelFor(a.documentKey)}?`)) return;
    setError(""); setBusy(true);
    const r = await companyCall({ action: "end_document_assignment", token, ...scope, id: a.id });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    load();
  };

  const byDoc = documents
    .map(d => ({ d, rows: assignments.filter(a => a.documentKey === d.key) }))
    .filter(x => x.rows.length > 0);

  return (
    <div style={{ background: C.panelInset, border: `1px solid ${C.line}`, borderRadius: RAD.md, padding: 14, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.text.primary, marginBottom: 2 }}>Document assignments</div>
      <div style={{ fontSize: 12, color: C.text.faint, marginBottom: 12, lineHeight: 1.5 }}>
        Decide who fills in or reads each document. A document with no assignment works for everyone, as before. Once you assign one, only the people you name can use it. You always see everything.
      </div>
      {needsSetup && <div style={{ fontSize: 12.5, color: C.status.warning.text, marginBottom: 8 }}>Assignments aren't switched on for this database yet. Contact FORA support.</div>}
      {error && <div style={{ fontSize: 12.5, color: C.status.danger.text, marginBottom: 8 }}>{error}</div>}

      {!loaded ? (
        <div style={{ fontSize: 12.5, color: C.text.faint }}>Loading…</div>
      ) : (
        <>
          {byDoc.length === 0 && <div style={{ fontSize: 12.5, color: C.text.faint, marginBottom: 12 }}>No assignments yet. Every document is open to everyone who has it switched on.</div>}
          {byDoc.map(({ d, rows }) => (
            <div key={d.key} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text.primary, marginBottom: 6 }}>{d.label}</div>
              {rows.map(a => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 0", borderTop: `1px solid ${C.line}` }}>
                  <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: a.action === "submit" ? C.orange : C.text.muted }}>{a.action === "submit" ? (a.restricts ? "Only these fill in" : "Task") : "Only these read"}</span>
                  <span style={{ fontSize: 13, color: C.text.body, fontWeight: 600 }}>{audienceLabel(a)}</span>
                  {a.dueAt && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, color: C.text.muted }}><CalendarClock size={12} />Due {new Date(a.dueAt).toLocaleDateString("en-CA")}</span>}
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: a.reaches === 0 && a.restricts ? C.status.danger.text : C.text.faint }}>
                    {a.reaches === 0 ? (a.restricts ? "Reaches nobody right now" : "Nobody matches yet") : `Reaches ${a.reaches} ${a.reaches === 1 ? "person" : "people"}`}
                  </span>
                  <button type="button" aria-label={`Remove assignment from ${d.label}`} disabled={busy} onClick={() => remove(a)}
                    style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", color: C.text.faint, display: "flex", padding: 4 }}><Trash2 size={14} /></button>
                </div>
              ))}
              {rows.some(a => a.action === "submit" && a.restricts) && rows.filter(a => a.action === "submit" && a.restricts).every(a => a.reaches === 0) && (
                <div style={{ fontSize: 11.5, color: C.status.danger.text, marginTop: 4 }}>Nobody can fill this in right now except you.</div>
              )}
            </div>
          ))}

          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text.muted, marginBottom: 6, marginTop: 4 }}>Add an assignment</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <select style={field} value={documentKey} aria-label="Document" onChange={e => {
              const key = e.target.value; setDocumentKey(key);
              const next = documents.find(d => d.key === key);
              if (next && !next.actions.includes(action)) setAction("submit");
            }}>
              <option value="">Pick a document</option>
              {documents.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <select style={field} value={action} aria-label="What they can do" onChange={e => setAction(e.target.value)}>
              <option value="submit">Can fill in</option>
              {docActions.includes("view") && <option value="view">Can read the records</option>}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <select style={field} value={audienceType} aria-label="Who" onChange={e => { setAudienceType(e.target.value); setAudienceValue(""); }}>
              {AUDIENCES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            {audienceType !== "everyone" && (
              <select style={field} value={audienceValue} aria-label="Which one" onChange={e => setAudienceValue(e.target.value)}>
                <option value="">Pick one</option>
                {valueOptions().map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            )}
            {action === "submit" && (
              <input style={field} type="date" value={dueAt} aria-label="Due date (optional)" onChange={e => setDueAt(e.target.value)} />
            )}
            {action === "submit" && (
              <select style={field} value={restricts ? "only" : "task"} aria-label="Task or restriction" onChange={e => setRestricts(e.target.value === "only")}>
                <option value="task">Just a task (everyone else keeps it)</option>
                <option value="only">Only these people can use it</option>
              </select>
            )}
            <button type="button" style={{ ...addBtn, opacity: canAdd && !busy ? 1 : 0.5 }} disabled={!canAdd || busy} onClick={add}><Plus size={14} />Add</button>
          </div>
          <div style={{ fontSize: 11.5, color: C.text.faint, lineHeight: 1.5 }}>
            A task puts the document first on their menu with the due date and changes nothing for anyone else. "Only these people" hides the document from everyone else, so check the count first. Reading is for supervisors and is always "only these people". Workers always see their own submissions. Company Portal documents can only be assigned for filling in.
          </div>
        </>
      )}
    </div>
  );
}
