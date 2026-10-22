// src/SentToYou.jsx
// Send & Sign, worker side. Documents a supervisor sent to the signed-in
// person: open the PDF, then sign it or tap Got it. The server only ever
// returns this person's own rows and builds the signed copy itself
// (server-lib/sentDocuments.js complete_sent_document), so this screen is a
// convenience, not a gate. If the company does not have the module the list
// call is refused and nothing renders.
import { useCallback, useEffect, useState } from "react";
import { FileSignature, ExternalLink, CheckCircle2, ChevronRight, ChevronLeft } from "lucide-react";
import { colors as C, radius as RAD, shadow as SHAD } from "./theme";
import { SignaturePad } from "./SignAfterwards.jsx";

async function post(token, body) {
  try {
    const res = await fetch("/api/certifications", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { data } : { error: data.error || "Something went wrong.", status: res.status };
  } catch (e) {
    return { error: "Connection error. Please try again." };
  }
}

const CATEGORY_LABEL = { training: "Training", onboarding: "Onboarding", notices: "Notice", policies: "Policy", other: "Document" };
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString("en-CA") : "");

const btn = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "12px 18px", borderRadius: RAD.md,
  border: "none", background: C.orange, color: C.text.onOrange, fontWeight: 700, fontSize: 16, minHeight: 48, cursor: "pointer", width: "100%",
};
const ghostBtn = { ...btn, background: "transparent", color: C.text.primary, border: `1.5px solid ${C.line}` };

export default function SentToYou({ token }) {
  const [docs, setDocs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [fileUrl, setFileUrl] = useState("");
  const [opened, setOpened] = useState(false);
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const out = await post(token, { action: "list_sent_documents" });
    if (out.data) setDocs(out.data.documents || []);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const pending = docs.filter((d) => d.displayStatus !== "completed" && d.displayStatus !== "cancelled");
  const done = docs.filter((d) => d.displayStatus === "completed").slice(0, 5);
  if (!selected && pending.length === 0 && done.length === 0) return null;

  const pick = (doc) => {
    setSelected(doc); setFileUrl(""); setOpened(doc.status === "opened"); setSignature(null); setError("");
  };
  const back = () => { setSelected(null); load(); };

  const openFile = async (doc) => {
    setError("");
    const out = await post(token, { action: "open_sent_document", id: doc.id });
    if (out.error) { setError(out.error); return; }
    setFileUrl(out.data.fileUrl || "");
    setOpened(true);
    if (out.data.fileUrl) window.open(out.data.fileUrl, "_blank", "noopener");
  };

  const finish = async () => {
    setBusy(true); setError("");
    const out = await post(token, {
      action: "complete_sent_document", id: selected.id,
      ...(selected.mode === "sign" ? { signature } : {}),
    });
    setBusy(false);
    if (out.error) { setError(out.error); return; }
    setSelected(null);
    load();
  };

  if (selected) {
    const isSign = selected.mode === "sign";
    const finished = selected.displayStatus === "completed";
    return (
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: 16, marginBottom: 20, boxShadow: SHAD.md }}>
        <button onClick={back} style={{ background: "transparent", border: "none", color: C.text.muted, fontWeight: 600, cursor: "pointer", padding: "6px 0", minHeight: 36, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <ChevronLeft size={18} /> Back
        </button>
        <h2 style={{ margin: "4px 0", fontSize: 20, overflowWrap: "anywhere" }}>{selected.title}</h2>
        <div style={{ color: C.text.muted, fontSize: 13, marginBottom: 10 }}>
          {CATEGORY_LABEL[selected.category] || "Document"} · from {selected.sent_by_name || "your supervisor"}
          {selected.due_at ? ` · Due ${fmt(selected.due_at)}` : ""}
        </div>
        {selected.note && <p style={{ margin: "0 0 12px", fontSize: 15, overflowWrap: "anywhere" }}>{selected.note}</p>}

        <button style={ghostBtn} onClick={() => openFile(selected)}>
          <ExternalLink size={18} /> {finished ? "Open signed copy" : opened ? "Open it again" : "Open the document"}
        </button>
        {fileUrl && (
          <div style={{ marginTop: 8, fontSize: 14 }}>
            Didn't open? <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.orange, fontWeight: 700 }}>Tap here to open it</a>
          </div>
        )}

        {!finished && (
          <div style={{ marginTop: 16 }}>
            {!opened ? (
              <div style={{ color: C.text.muted, fontSize: 14 }}>Open the document first, then {isSign ? "sign" : "confirm you read it"}.</div>
            ) : isSign ? (
              <>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Sign below</div>
                <SignaturePad onChange={setSignature} />
                <div style={{ marginTop: 10 }}>
                  <button style={{ ...btn, opacity: signature && !busy ? 1 : 0.5 }} disabled={!signature || busy} onClick={finish}>
                    <FileSignature size={18} /> {busy ? "Saving..." : "Sign and submit"}
                  </button>
                </div>
              </>
            ) : (
              <button style={{ ...btn, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={finish}>
                <CheckCircle2 size={18} /> {busy ? "Saving..." : "Got it"}
              </button>
            )}
          </div>
        )}
        {error && <div role="alert" style={{ marginTop: 12, color: C.status.danger.text, fontSize: 14 }}>{error}</div>}
      </div>
    );
  }

  const row = (d) => {
    const overdue = d.displayStatus === "overdue";
    const finished = d.displayStatus === "completed";
    return (
      <div key={d.id} onClick={() => pick(d)} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") pick(d); }}
        style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: 14, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", minHeight: 64, boxShadow: SHAD.md }}>
        <FileSignature size={22} color={C.orange} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16, overflowWrap: "anywhere" }}>{d.title}</div>
          <div style={{ fontSize: 13, color: finished ? C.status.success.text : overdue ? C.status.danger.text : C.text.muted, fontWeight: overdue ? 700 : 400 }}>
            {finished ? `Done ${fmt(d.completed_at)}`
              : overdue ? `Overdue, was due ${fmt(d.due_at)}`
              : `${d.mode === "sign" ? "Needs your signature" : "Please read"}${d.due_at ? ` · Due ${fmt(d.due_at)}` : ""}`}
          </div>
        </div>
        <ChevronRight size={20} color={C.text.faint} style={{ flexShrink: 0 }} />
      </div>
    );
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.text.muted, marginBottom: 8 }}>
        Sent to you
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10 }}>
        {pending.map(row)}
        {done.map(row)}
      </div>
    </div>
  );
}
