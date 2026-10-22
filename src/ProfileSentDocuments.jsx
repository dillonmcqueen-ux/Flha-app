// src/ProfileSentDocuments.jsx
// Send & Sign, on a person's profile drawer: the documents sent to them and
// where each stands, with a link to the signed copy once it is done. The
// server applies the same scope rule as the Send & Sign tab, so a supervisor
// only sees what they are allowed to. If the company does not have the module
// the call is refused and nothing renders.
import { useEffect, useState } from "react";
import { FileSignature } from "lucide-react";
import { colors as C } from "./theme";

const STATUS_LABEL = { sent: "Sent", opened: "Opened", overdue: "Overdue", completed: "Done", cancelled: "Cancelled" };
const CATEGORY_LABEL = { training: "Training", onboarding: "Onboarding", notices: "Notice", policies: "Policy", other: "Other" };

async function call(body) {
  try {
    const res = await fetch("/api/certifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (e) {
    return { ok: false, data: {} };
  }
}

export default function ProfileSentDocuments({ token, companyId, rosterId }) {
  const [docs, setDocs] = useState(null);

  useEffect(() => {
    let live = true;
    setDocs(null);
    if (!rosterId) return undefined;
    call({ action: "list_sent_documents", token, rosterId, ...(companyId ? { companyId } : {}) }).then(({ ok, data }) => {
      if (live) setDocs(ok ? (data.documents || []).filter((d) => d.status !== "cancelled") : []);
    });
    return () => { live = false; };
  }, [token, companyId, rosterId]);

  const view = async (doc) => {
    const { ok, data } = await call({ action: "open_sent_document", token, id: doc.id, ...(companyId ? { companyId } : {}) });
    if (ok && data.fileUrl) window.open(data.fileUrl, "_blank", "noopener");
  };

  // Not loaded yet, refused (module off), or nothing sent: show nothing.
  if (!docs || docs.length === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: C.text.primary, marginBottom: 8 }}>
        <FileSignature size={14} color={C.text.muted} />Sent documents ({docs.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {docs.map((d) => {
          const tone = d.displayStatus === "completed" ? C.status.success.text : d.displayStatus === "overdue" ? C.status.danger.text : C.text.faint;
          return (
            <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12.5, color: C.text.body }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{d.title}</div>
                <div style={{ fontSize: 11.5, color: tone }}>
                  {CATEGORY_LABEL[d.category] || d.category} · {STATUS_LABEL[d.displayStatus] || d.displayStatus}
                  {d.completed_at ? ` ${new Date(d.completed_at).toLocaleDateString("en-CA")}` : ""}
                </div>
              </div>
              <button type="button" onClick={() => view(d)} style={{ background: "transparent", border: "none", color: C.orange, fontWeight: 700, fontSize: 12, cursor: "pointer", flexShrink: 0, minHeight: 32 }}>
                {d.displayStatus === "completed" ? "View signed" : "View"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
