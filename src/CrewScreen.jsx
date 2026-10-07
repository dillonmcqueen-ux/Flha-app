// src/CrewScreen.jsx
// What a crew lead sees under "My crew" on the worker menu. A lead is a worker
// the Account Owner flagged (server-lib/leadAccess.js); everything here is
// checked again on the server against the live roster row, so this screen is
// only ever a convenience.
//
//  - FLHAs waiting for sign-off (never the lead's own)
//  - tasks the lead has given: a document, a crew member and a due date, shown
//    first on that person's menu. A task never takes a document away from
//    anyone else; only the Owner can restrict a document.
//  - the crew's recent documents, read only, with a PDF link each
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ChevronLeft, ExternalLink, Trash2, Plus, CalendarClock } from "lucide-react";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD } from "./theme";
import { generateAndUploadFLHA } from "./generatePDF";

// Loaded on demand so the worker menu does not pull the whole supervisor
// dashboard in up front (and so the two files do not import each other).
const FLHACard = lazy(() => import("./Dashboard.jsx").then(m => ({ default: m.FLHACard })));

async function post(url, body) {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? data : { error: data.error || "Something went wrong." };
  } catch (e) {
    return { error: "Connection error. Please try again." };
  }
}

const field = {
  boxSizing: "border-box", padding: "10px 12px", borderRadius: RAD.sm, border: `1.5px solid ${C.line}`,
  background: C.panelInset, color: C.text.primary, fontSize: 15, minHeight: 44, flex: "1 1 150px", minWidth: 0,
};
const section = { background: `linear-gradient(160deg, ${C.panelRaised} 0%, ${C.panel} 100%)`, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: 16, boxShadow: SHAD.md, marginBottom: 16 };
const heading = { fontFamily: FONT.heading, fontWeight: 700, fontSize: 17, color: C.text.primary, marginBottom: 4 };

export default function CrewScreen({ token, userId, userName, companyName, crew, onBack }) {
  const [flhas, setFlhas] = useState([]);
  const [docs, setDocs] = useState([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [taskDocs, setTaskDocs] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openFlha, setOpenFlha] = useState(null);

  const [taskDoc, setTaskDoc] = useState("");
  const [taskPerson, setTaskPerson] = useState("");
  const [taskDue, setTaskDue] = useState("");

  const load = useCallback(async () => {
    const [f, d, t] = await Promise.all([
      post("/api/flhas", { action: "list", token }),
      post("/api/customforms", { action: "get_crew_documents", token }),
      post("/api/companydata", { action: "lead_list_tasks", token }),
    ]);
    if (f.flhas) setFlhas(f.flhas);
    if (d.documents) setDocs(d.documents);
    setDocsLoaded(true);
    if (t.tasks) setTasks(t.tasks);
    if (t.documents) setTaskDocs(t.documents);
    const firstError = [f, d, t].find(x => x.error);
    if (firstError && !f.flhas && !d.documents) setError(firstError.error);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const personName = (id) => crew.find(p => p.id === id)?.name || "Someone";
  const docLabel = (key) => taskDocs.find(d => d.key === key)?.label || key;
  // Saved by a crew member to sign afterwards: nothing to sign off yet. After a
  // day it is flagged so the lead can nudge them.
  const unsigned = flhas.filter(f => f.awaiting_signature === true);
  const isOverdue = (f) => f.signature_requested_at && Date.now() - new Date(f.signature_requested_at).getTime() > 24 * 60 * 60 * 1000;
  const waiting = flhas.filter(f => f.status === "pending_approval" && f.awaiting_signature !== true && Number(f.submitted_by_roster_id) !== Number(userId));

  const approve = async (record, supName, supSignature) => {
    const now = new Date();
    let pdfUrl = null;
    try {
      pdfUrl = await generateAndUploadFLHA({
        flha: record.hazards_json, workerName: record.worker_name, jobSite: record.job_site, signName: record.worker_name,
        companyName: companyName || "", signatureDataUrl: record.worker_signature || null, companyLogo: "",
        amendedNote: null, pendingApproval: false,
        supervisorApproval: { name: userName || supName, date: now.toLocaleString("en-CA"), signature: supSignature },
        token,
      });
    } catch (e) { /* the record is still signed off if the PDF fails to regenerate */ }
    const r = await post("/api/flhas", { action: "approve", token, id: record.id, supName: userName || supName, supSignature, pdfUrl });
    if (r.error) { setError(r.error); return; }
    setOpenFlha(null);
    load();
  };

  const addTask = async () => {
    setError(""); setBusy(true);
    const r = await post("/api/companydata", {
      action: "lead_assign_task", token, documentKey: taskDoc, personId: Number(taskPerson),
      dueAt: taskDue ? new Date(`${taskDue}T23:59:59`).toISOString() : null,
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setTaskDoc(""); setTaskPerson(""); setTaskDue("");
    load();
  };

  const removeTask = async (t) => {
    if (!window.confirm(`Remove this task for ${personName(t.personId)}?`)) return;
    setError(""); setBusy(true);
    const r = await post("/api/companydata", { action: "lead_end_task", token, id: t.id });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    load();
  };

  return (
    <div style={{ fontFamily: FONT.body, background: C.bg, minHeight: "100vh", color: C.text.primary }}>
      <div style={{ padding: "18px 16px 40px", maxWidth: 640, margin: "0 auto" }}>
        <button onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "none", color: C.text.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "8px 0", minHeight: 44 }}>
          <ChevronLeft size={18} />Back
        </button>
        <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 24, margin: "4px 0 14px" }}>My crew</div>
        {error && <div style={{ fontSize: 13.5, color: C.status.danger.text, marginBottom: 12 }}>{error}</div>}

        {unsigned.length > 0 && (
          <div style={section}>
            <div style={heading}>Not signed by the worker yet</div>
            <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 6 }}>Saved to sign afterwards. They sign from their own menu; nobody can sign for them.</div>
            {unsigned.map(f => (
              <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderTop: `1px solid ${C.line}`, minHeight: 48 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{f.worker_name}</div>
                  <div style={{ fontSize: 13, color: C.text.muted }}>{f.job_site || "FLHA"} · saved {new Date(f.signature_requested_at || f.created_at).toLocaleString("en-CA")}</div>
                </div>
                {isOverdue(f) && <span style={{ fontSize: 12, fontWeight: 800, color: C.status.warning.text }}>Over a day. Remind them.</span>}
              </div>
            ))}
          </div>
        )}

        <div style={section}>
          <div style={heading}>Waiting for your sign-off</div>
          {waiting.length === 0 ? (
            <div style={{ fontSize: 13.5, color: C.text.muted }}>No extreme-risk FLHAs are waiting on you.</div>
          ) : waiting.map(f => (
            <div key={f.id} onClick={() => setOpenFlha(f)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderTop: `1px solid ${C.line}`, cursor: "pointer", minHeight: 48 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{f.worker_name}</div>
                <div style={{ fontSize: 13, color: C.text.muted }}>{f.job_site || "FLHA"} · {new Date(f.created_at).toLocaleDateString("en-CA")}</div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.orange }}>Review and sign</span>
            </div>
          ))}
        </div>

        <div style={section}>
          <div style={heading}>Give your crew a task</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 10, lineHeight: 1.5 }}>
            It goes first on their menu with the due date. Nobody else loses the document.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <select style={field} value={taskDoc} aria-label="Document" onChange={e => setTaskDoc(e.target.value)}>
              <option value="">Pick a document</option>
              {taskDocs.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <select style={field} value={taskPerson} aria-label="Crew member" onChange={e => setTaskPerson(e.target.value)}>
              <option value="">Pick a person</option>
              {crew.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input style={field} type="date" value={taskDue} aria-label="Due date (optional)" onChange={e => setTaskDue(e.target.value)} />
            <button type="button" disabled={!taskDoc || !taskPerson || busy} onClick={addTask}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "10px 16px", borderRadius: RAD.sm, fontWeight: 700, fontSize: 14, minHeight: 44, cursor: "pointer", background: "transparent", color: C.orange, border: `1.5px solid ${C.orange}`, opacity: !taskDoc || !taskPerson || busy ? 0.5 : 1 }}>
              <Plus size={16} />Give task
            </button>
          </div>
          {crew.length === 0 && <div style={{ fontSize: 12.5, color: C.text.faint }}>You have no crew yet. Ask your account owner to put people in your department, division or site.</div>}
          {tasks.map(t => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{docLabel(t.documentKey)}</span>
              <span style={{ fontSize: 13, color: C.text.muted }}>for {personName(t.personId)}</span>
              {t.dueAt && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, color: C.text.muted }}><CalendarClock size={12} />{new Date(t.dueAt).toLocaleDateString("en-CA")}</span>}
              <button type="button" aria-label="Remove task" disabled={busy} onClick={() => removeTask(t)}
                style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", color: C.text.faint, display: "flex", padding: 10, minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>

        <div style={section}>
          <div style={heading}>Your crew's recent documents</div>
          {!docsLoaded ? (
            <div style={{ fontSize: 13.5, color: C.text.muted }}>Loading…</div>
          ) : docs.length === 0 ? (
            <div style={{ fontSize: 13.5, color: C.text.muted }}>Nothing from your crew yet.</div>
          ) : docs.map(d => (
            <div key={`${d.type}:${d.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{d.title}{d.subtitle ? ` · ${d.subtitle}` : ""}</div>
                <div style={{ fontSize: 12.5, color: C.text.muted }}>
                  {d.author || "Unknown"}{d.enteredBy ? ` (entered by ${d.enteredBy})` : ""} · {new Date(d.createdAt).toLocaleDateString("en-CA")}
                  {d.status === "pending_approval" ? " · waiting for sign-off" : ""}
                </div>
              </div>
              {d.pdf_url && (
                <a href={d.pdf_url} target="_blank" rel="noreferrer" aria-label={`Open the PDF for ${d.title}`}
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 44, minHeight: 44, color: C.orange }}><ExternalLink size={18} /></a>
              )}
            </div>
          ))}
        </div>
      </div>

      {openFlha && (
        <Suspense fallback={null}>
          <FLHACard flha={openFlha} onClose={() => setOpenFlha(null)} onApprove={approve} defaultSupName={userName} />
        </Suspense>
      )}
    </div>
  );
}
