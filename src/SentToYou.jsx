// src/SentToYou.jsx
// Send & Sign, recipient side. A document a supervisor sent to the signed-in
// person: open the PDF, then sign it or tap Got it. The server only ever
// returns this person's own rows and builds the signed copy itself
// (server-lib/sentDocuments.js complete_sent_document), so these pieces are a
// convenience, not a gate. The list lives in the inbox (src/Inbox.jsx): this
// file loads the rows, turns them into inbox items, and owns the open/sign
// screen. If the company does not have the module the list call is refused and
// nothing shows.
import { useState } from "react";
import { FileSignature, ExternalLink, CheckCircle2, ChevronLeft } from "lucide-react";
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

/** The signed-in person's own sent documents, or [] when the module is off. */
export async function listSentDocuments(token, extra = {}) {
  const out = await post(token, { action: "list_sent_documents", ...extra });
  return out.data ? out.data.documents || [] : [];
}

/** An inbox item (src/inbox.js) for a document sent to this person. */
export function sentDocToItem(d, onOpen) {
  const finished = d.displayStatus === "completed";
  const overdue = d.displayStatus === "overdue";
  return {
    key: `sent:${d.id}`, Icon: FileSignature, onOpen,
    title: d.title,
    status: finished ? "done" : overdue ? "overdue" : "open",
    dueAt: d.due_at, doneAt: d.completed_at,
    subtitle: finished ? `Done ${fmt(d.completed_at)}`
      : overdue ? `Overdue, was due ${fmt(d.due_at)}`
      : `${d.mode === "sign" ? "Needs your signature" : "Please read"}${d.due_at ? ` · Due ${fmt(d.due_at)}` : ""}`,
  };
}

const btn = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "12px 18px", borderRadius: RAD.md,
  border: "none", background: C.orange, color: C.text.onOrange, fontWeight: 700, fontSize: 16, minHeight: 48, cursor: "pointer", width: "100%",
};
const ghostBtn = { ...btn, background: "transparent", color: C.text.primary, border: `1.5px solid ${C.line}` };

export default function SentDocDetail({ token, doc, onBack, onDone }) {
  const [fileUrl, setFileUrl] = useState("");
  const [opened, setOpened] = useState(doc.status === "opened");
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const openFile = async () => {
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
      action: "complete_sent_document", id: doc.id,
      ...(doc.mode === "sign" ? { signature } : {}),
    });
    setBusy(false);
    if (out.error) { setError(out.error); return; }
    onDone();
  };

  const isSign = doc.mode === "sign";
  const finished = doc.displayStatus === "completed";
  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text.primary }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 16px 40px" }}>
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: 16, boxShadow: SHAD.md }}>
          <button onClick={onBack} style={{ background: "transparent", border: "none", color: C.text.muted, fontWeight: 600, cursor: "pointer", padding: "6px 0", minHeight: 36, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <ChevronLeft size={18} /> Back
          </button>
          <h2 style={{ margin: "4px 0", fontSize: 20, overflowWrap: "anywhere" }}>{doc.title}</h2>
          <div style={{ color: C.text.muted, fontSize: 13, marginBottom: 10 }}>
            {CATEGORY_LABEL[doc.category] || "Document"} · from {doc.sent_by_name || "your supervisor"}
            {doc.due_at ? ` · Due ${fmt(doc.due_at)}` : ""}
          </div>
          {doc.note && <p style={{ margin: "0 0 12px", fontSize: 15, overflowWrap: "anywhere" }}>{doc.note}</p>}

          <button style={ghostBtn} onClick={openFile}>
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
      </div>
    </div>
  );
}
