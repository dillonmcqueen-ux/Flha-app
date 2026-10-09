import { useState, useEffect, useCallback } from "react";
import { colors as C, radius as RAD, shadow as SHAD } from "../theme";
import { callDocuments } from "./builderApi.js";
import { formatAnswer, statusLabel } from "./recordView.js";

// Supervisor and Owner view of company (unified-engine) documents: what
// waits on you to review, escalations routed to your departments, and every
// record. Who may see or act on what is decided by the server; this screen
// only shows what it is given.

const card = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: 16, marginBottom: 12, boxShadow: SHAD.md };
const btn = { background: C.panelInset, color: C.text.body, border: `1px solid ${C.line}`, borderRadius: RAD.sm, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const when = (t) => (t ? new Date(t).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" }) : "");

export default function EngineInbox({ token, companyId, docs = [], inbox, escalations = [], onChanged }) {
  const titles = Object.fromEntries(docs.map((d) => [d.id, d.title]));
  const [tab, setTab] = useState("review");
  const [records, setRecords] = useState(null);
  const [open, setOpen] = useState(null); // { record, answers, signatures }
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const review = inbox?.review || [];
  const reviewIds = new Set(review.map((r) => r.recordId));
  const call = (action, extra) => callDocuments(token, action, { companyId, ...extra });

  const loadRecords = useCallback(async () => {
    try { setRecords((await call("list_records", { limit: 100 })).records || []); } catch (e) { setRecords([]); setMsg(e.message); }
  }, [token, companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === "all" && records === null) loadRecords(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const openRecord = async (recordId) => {
    setBusy(true); setMsg(""); setReason("");
    try {
      const rec = await call("get_record", { recordId });
      // Links are short lived and best effort: the record reads fine without them.
      const links = await call("get_record_links", { recordId }).catch(() => ({ pdf: null, files: {}, signatures: {} }));
      setOpen({ ...rec, links });
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  const decide = async (decision) => {
    if (decision === "return" && !reason.trim()) { setMsg("Say what needs fixing."); return; }
    setBusy(true); setMsg("");
    try {
      await call("review", { recordId: open.record.id, decision, reason: reason.trim() || undefined });
      setOpen(null); setRecords(null); await onChanged();
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  const actionEsc = async (id) => {
    setBusy(true); setMsg("");
    try { await call("action_escalation", { escalationId: id }); await onChanged(); } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  const tabBtn = (k, label, n) => <button key={k} role="tab" aria-selected={tab === k} style={{ ...btn, borderColor: tab === k ? C.orange : C.line }} onClick={() => { setTab(k); setOpen(null); setMsg(""); }}>{label}{n > 0 ? ` (${n})` : ""}</button>;

  return (
    <div>
      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 16, color: C.text.primary, marginBottom: 4 }}>Company documents</div>
        <div style={{ fontSize: 12.5, color: C.text.muted, marginBottom: 12 }}>Documents built for this company: reviews waiting on you, escalations for your departments, and every record you can see.</div>
        <div role="tablist" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tabBtn("review", "To review", review.length)}{tabBtn("esc", "Escalations", escalations.length)}{tabBtn("all", "All records", 0)}
        </div>
        {msg && <div role="alert" style={{ marginTop: 10, fontSize: 13, color: C.status.danger.text }}>{msg}</div>}
      </div>

      {open && (
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontWeight: 800, color: C.text.primary }}>{titles[open.record.definition_id] || "Document"} <span style={{ fontWeight: 500, fontSize: 12, color: C.text.muted }}>{statusLabel(open.record.status)}{open.record.awaiting_signature ? ", not signed yet" : ""}</span></div>
            <button style={btn} onClick={() => setOpen(null)}>Close</button>
          </div>
          <div style={{ fontSize: 12, color: C.text.muted, margin: "4px 0 10px" }}>Filed {when(open.record.submitted_at)}
            {open.links?.pdf && <> · <a href={open.links.pdf} target="_blank" rel="noreferrer" style={{ color: C.orange, fontWeight: 700 }}>Open PDF</a></>}</div>
          {open.record.returned_reason && <div style={{ fontSize: 13, color: C.status.warning.text, marginBottom: 8 }}>Sent back: {open.record.returned_reason}</div>}
          {open.answers.map((a) => (
            <div key={a.id} style={{ padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text.muted, textTransform: "uppercase" }}>{a.question_text}</div>
              <div style={{ fontSize: 14, color: C.text.primary, whiteSpace: "pre-wrap" }}>{formatAnswer(a) || "No answer"}
                {open.links?.files?.[a.id] && <> <a href={open.links.files[a.id]} target="_blank" rel="noreferrer" style={{ color: C.orange, fontWeight: 700 }}>Open</a></>}</div>
              {a.notes && <div style={{ fontSize: 12.5, color: C.status.warning.text }}>Note: {a.notes}</div>}
            </div>
          ))}
          {open.signatures.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 13, color: C.text.body }}>
              {open.signatures.map((g) => <div key={g.id}>{g.kind === "approval" ? "Approved" : "Signed"} by {g.signer_name}{g.step_key ? ` (${g.step_key})` : ""}, {when(g.signed_at)}
                {open.links?.signatures?.[g.id] && <> <a href={open.links.signatures[g.id]} target="_blank" rel="noreferrer" style={{ color: C.orange, fontWeight: 700 }}>View signature</a></>}</div>)}
            </div>
          )}
          {reviewIds.has(open.record.id) && (
            <div style={{ marginTop: 14 }}>
              <textarea aria-label="Reason for sending back" placeholder="If sending back, say what needs fixing" value={reason} onChange={(e) => setReason(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", minHeight: 60, padding: 9, borderRadius: RAD.sm, border: `1px solid ${C.line}`, background: C.panelInset, color: C.text.primary }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button style={{ ...btn, background: C.status.success.solid, color: "#fff", border: "none" }} disabled={busy} onClick={() => decide("approve")}>Approve</button>
                <button style={btn} disabled={busy} onClick={() => decide("return")}>Send back</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "review" && (
        <div style={card}>
          {review.length === 0 && <div style={{ color: C.text.muted, fontSize: 13 }}>Nothing is waiting for your review.</div>}
          {review.map((r) => (
            <div key={r.recordId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
              <div><div style={{ fontWeight: 700, color: C.text.primary }}>{titles[r.definitionId] || "Document"}</div>
                <div style={{ fontSize: 12, color: C.text.muted }}>{r.step}, filed {when(r.at)}</div></div>
              <button style={btn} disabled={busy} onClick={() => openRecord(r.recordId)}>Review</button>
            </div>
          ))}
        </div>
      )}

      {tab === "esc" && (
        <div style={card}>
          {escalations.length === 0 && <div style={{ color: C.text.muted, fontSize: 13 }}>No open escalations.</div>}
          {escalations.map((e) => (
            <div key={e.id} style={{ padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ fontWeight: 700, color: C.text.primary }}>{e.question_text}: {e.trigger_value}</div>
              <div style={{ fontSize: 12, color: C.text.muted }}>{e.target_department || "Account Owner"}, {when(e.created_at)}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button style={btn} disabled={busy} onClick={() => openRecord(e.record_id)}>Open record</button>
                <button style={btn} disabled={busy} onClick={() => actionEsc(e.id)}>Mark actioned</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "all" && (
        <div style={card}>
          {records === null && <div style={{ color: C.text.muted, fontSize: 13 }}>Loading...</div>}
          {records && records.length === 0 && <div style={{ color: C.text.muted, fontSize: 13 }}>No records yet.</div>}
          {(records || []).map((r) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
              <div><div style={{ fontWeight: 700, color: C.text.primary }}>{titles[r.definition_id] || "Document"}</div>
                <div style={{ fontSize: 12, color: C.text.muted }}>{statusLabel(r.status)}{r.awaiting_signature ? ", not signed" : ""}, {when(r.submitted_at || r.created_at)}</div></div>
              <button style={btn} disabled={busy} onClick={() => openRecord(r.id)}>Open</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
