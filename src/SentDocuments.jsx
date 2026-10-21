// src/SentDocuments.jsx
// Send & Sign, supervisor side. Upload a PDF, pick people, send it. Below
// that, a tracker shows where every sent document stands. The worker side
// (open, read, sign) is a later PR. Rules live in server-lib/sentDocuments.js;
// this screen only talks to /api/certifications.
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSignature, Send, Search, ExternalLink, Ban } from "lucide-react";
import { colors as C, radius as RAD } from "./theme";
import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";

const CATEGORIES = [
  { value: "training", label: "Training" },
  { value: "onboarding", label: "Onboarding" },
  { value: "notices", label: "Notices" },
  { value: "policies", label: "Policies" },
  { value: "other", label: "Other" },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

const STATUS = {
  sent: { label: "Sent", tone: C.status.info },
  opened: { label: "Opened", tone: C.status.warning },
  overdue: { label: "Overdue", tone: C.status.danger },
  completed: { label: "Done", tone: C.status.success },
  cancelled: { label: "Cancelled", tone: null },
};

const field = {
  boxSizing: "border-box", padding: "9px 12px", borderRadius: RAD.sm, border: `1.5px solid ${C.line}`,
  background: C.panelInset, color: C.text.primary, fontSize: 14, minHeight: 44, width: "100%",
};
const label = { fontSize: 12, fontWeight: 700, color: C.text.muted, marginBottom: 4, display: "block" };
const primaryBtn = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 18px", borderRadius: RAD.sm,
  border: "none", background: C.orange, color: C.text.onOrange, fontWeight: 700, fontSize: 14, minHeight: 44, cursor: "pointer",
};
const smallBtn = {
  display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: RAD.sm, minHeight: 36,
  border: `1.5px solid ${C.line}`, background: "transparent", color: C.text.primary, fontSize: 13, fontWeight: 600, cursor: "pointer",
};

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.sent;
  const tone = s.tone || { text: C.text.muted, bg: "transparent", border: C.line };
  return (
    <span style={{ fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999, color: tone.text, background: tone.bg, border: `1px solid ${tone.border}` }}>
      {s.label}
    </span>
  );
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

async function call(body) {
  const res = await fetch("/api/certifications", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export default function SentDocuments({ token, companyId, roster = [] }) {
  const scope = companyId ? { companyId } : {};

  // ── Send form ──
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("notices");
  const [mode, setMode] = useState("sign");
  const [dueAt, setDueAt] = useState("");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");
  const [sentMessage, setSentMessage] = useState("");

  // ── Tracker ──
  const [docs, setDocs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const people = useMemo(
    () => roster.filter((m) => m.active && m.role !== "auditor").sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [roster]
  );
  const visiblePeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? people.filter((m) => String(m.name).toLowerCase().includes(q)) : people;
  }, [people, search]);

  const load = useCallback(async () => {
    const { ok, data } = await call({ action: "list_sent_documents", token, ...scope });
    if (ok) { setDocs(data.documents || []); setListError(""); } else { setListError(data.error || "Could not load documents."); }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, companyId]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allVisiblePicked = visiblePeople.length > 0 && visiblePeople.every((m) => picked.has(m.id));
  const toggleAllVisible = () => setPicked((prev) => {
    const next = new Set(prev);
    visiblePeople.forEach((m) => (allVisiblePicked ? next.delete(m.id) : next.add(m.id)));
    return next;
  });

  const send = async () => {
    setFormError(""); setSentMessage("");
    if (!file) { setFormError("Choose a PDF to send."); return; }
    if (!/\.pdf$/i.test(file.name)) { setFormError("Only PDF files can be sent."); return; }
    if (!title.trim()) { setFormError("Give the document a title."); return; }
    if (picked.size === 0) { setFormError("Pick at least one person."); return; }
    setSending(true);
    try {
      const up = await uploadViaSignedUrl({
        endpoint: "/api/certifications", action: "create_sent_document_upload_url", token,
        bucket: "sent-documents", filename: file.name, file, contentType: "application/pdf", extra: scope,
      });
      const { ok, data } = await call({
        action: "send_document", token, ...scope,
        receipt: up.receipt, title: title.trim(), category, mode, note: note.trim(),
        dueAt: dueAt || null, rosterIds: [...picked],
      });
      if (!ok) { setFormError(data.error || "Could not send the document."); setSending(false); return; }
      setSentMessage(`Sent to ${data.sent} ${data.sent === 1 ? "person" : "people"}.`);
      setFile(null); setTitle(""); setNote(""); setDueAt(""); setPicked(new Set());
      await load();
    } catch (e) {
      setFormError(e.message || "Upload failed. Please try again.");
    }
    setSending(false);
  };

  const view = async (doc) => {
    const { ok, data } = await call({ action: "open_sent_document", token, id: doc.id, ...scope });
    if (ok && data.fileUrl) window.open(data.fileUrl, "_blank", "noopener");
    else setListError(data.error || "Could not open that document.");
  };

  const cancel = async (doc) => {
    if (!window.confirm(`Cancel "${doc.title}" for ${doc.recipientName || "this person"}? They will no longer see it.`)) return;
    const { ok, data } = await call({ action: "cancel_sent_document", token, id: doc.id, ...scope });
    if (!ok) setListError(data.error || "Could not cancel that document.");
    await load();
  };

  const shown = docs.filter((d) =>
    (!filterCategory || d.category === filterCategory) && (!filterStatus || d.displayStatus === filterStatus));
  const counts = docs.reduce((acc, d) => { acc[d.displayStatus] = (acc[d.displayStatus] || 0) + 1; return acc; }, {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: RAD.md, padding: 16 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18, display: "flex", alignItems: "center", gap: 8 }}>
          <FileSignature size={20} /> Send a document
        </h2>
        <p style={{ margin: "0 0 14px", color: C.text.muted, fontSize: 13 }}>
          Upload a PDF, pick who gets it, and choose whether they sign it or just confirm they read it.
        </p>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <div>
            <label style={label} htmlFor="sd-file">PDF</label>
            <input id="sd-file" type="file" accept="application/pdf,.pdf" style={field}
              onChange={(e) => { const f = e.target.files && e.target.files[0]; setFile(f || null); if (f && !title) setTitle(f.name.replace(/\.pdf$/i, "")); }} />
          </div>
          <div>
            <label style={label} htmlFor="sd-title">Title</label>
            <input id="sd-title" type="text" style={field} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label style={label} htmlFor="sd-cat">Category</label>
            <select id="sd-cat" style={field} value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label style={label} htmlFor="sd-mode">They need to</label>
            <select id="sd-mode" style={field} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="sign">Sign it</option>
              <option value="read">Read it (tap Got it)</option>
            </select>
          </div>
          <div>
            <label style={label} htmlFor="sd-due">Due date (optional)</label>
            <input id="sd-due" type="date" style={field} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={label} htmlFor="sd-note">Note to them (optional)</label>
          <textarea id="sd-note" style={{ ...field, minHeight: 64, resize: "vertical" }} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div style={{ marginTop: 14 }}>
          <span style={label}>Send to ({picked.size} picked)</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ position: "relative", flex: "1 1 200px" }}>
              <Search size={16} style={{ position: "absolute", left: 10, top: 14, color: C.text.muted }} />
              <input type="text" aria-label="Search people" placeholder="Search people" style={{ ...field, paddingLeft: 32 }}
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button type="button" style={smallBtn} onClick={toggleAllVisible} disabled={visiblePeople.length === 0}>
              {allVisiblePicked ? "Clear shown" : "Select all shown"}
            </button>
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: RAD.sm, background: C.panelInset }}>
            {visiblePeople.length === 0 && <div style={{ padding: 12, color: C.text.muted, fontSize: 13 }}>No one matches.</div>}
            {visiblePeople.map((m) => (
              <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", minHeight: 44, cursor: "pointer", borderBottom: `1px solid ${C.line}` }}>
                <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} style={{ width: 20, height: 20 }} />
                <span style={{ flex: 1 }}>{m.name}</span>
                <span style={{ color: C.text.muted, fontSize: 12 }}>{m.role === "supervisor" ? "Supervisor" : "Worker"}</span>
              </label>
            ))}
          </div>
        </div>

        {formError && <div role="alert" style={{ marginTop: 12, color: C.status.danger.text, fontSize: 14 }}>{formError}</div>}
        {sentMessage && <div role="status" style={{ marginTop: 12, color: C.status.success.text, fontSize: 14 }}>{sentMessage}</div>}
        <div style={{ marginTop: 14 }}>
          <button type="button" style={{ ...primaryBtn, opacity: sending ? 0.6 : 1 }} onClick={send} disabled={sending}>
            <Send size={16} /> {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </section>

      <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: RAD.md, padding: 16 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>Sent documents</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {["sent", "opened", "overdue", "completed"].map((k) => (
            <button key={k} type="button" onClick={() => setFilterStatus(filterStatus === k ? "" : k)}
              style={{ ...smallBtn, borderColor: filterStatus === k ? C.orange : C.line }}>
              {STATUS[k].label}: {counts[k] || 0}
            </button>
          ))}
          <select aria-label="Filter by category" style={{ ...field, width: "auto", minHeight: 36, padding: "4px 10px" }}
            value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        {listError && <div role="alert" style={{ color: C.status.danger.text, fontSize: 14, marginBottom: 8 }}>{listError}</div>}
        {!loaded && <div style={{ color: C.text.muted }}>Loading...</div>}
        {loaded && shown.length === 0 && <div style={{ color: C.text.muted, fontSize: 14 }}>Nothing sent yet.</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shown.map((d) => (
            <div key={d.id} style={{ border: `1px solid ${C.line}`, borderRadius: RAD.sm, padding: 12, background: C.panelInset, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{d.title}</div>
                <div style={{ color: C.text.muted, fontSize: 13 }}>
                  {d.recipientName || "Unknown"} · {CATEGORY_LABEL[d.category] || d.category} · {d.mode === "sign" ? "Sign" : "Read"}
                </div>
                <div style={{ color: C.text.muted, fontSize: 12 }}>
                  Sent {fmtDate(d.created_at)}{d.sent_by_name ? ` by ${d.sent_by_name}` : ""}
                  {d.due_at ? ` · Due ${fmtDate(d.due_at)}` : ""}
                  {d.completed_at ? ` · Done ${fmtDate(d.completed_at)}` : ""}
                </div>
              </div>
              <StatusBadge status={d.displayStatus} />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" style={smallBtn} onClick={() => view(d)}><ExternalLink size={14} /> View</button>
                {(d.status === "sent" || d.status === "opened") && (
                  <button type="button" style={smallBtn} onClick={() => cancel(d)}><Ban size={14} /> Cancel</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
