import { useEffect, useState } from "react";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD } from "./theme";
import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";

// Worker self-service certification screen — the ongoing counterpart to
// WalletInvite.jsx's one-time onboarding upload step. Same
// api/certifications.js actions, scoped to the logged-in worker's own
// roster row throughout; a worker can add/view/remove their own tickets
// any time after onboarding, not just during the single-use invite visit.
export default function WorkerCertifications({ companyId, userId, userName, token, onBack }) {
  const [certs, setCerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ certType: "", certName: "", issueDate: "", expiryDate: "" });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const loadCerts = async () => {
    try {
      const res = await fetch("/api/certifications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_certifications", token, companyId, rosterId: userId }),
      });
      const data = await res.json();
      if (res.ok) setCerts(data.certifications || []);
    } catch (e) { /* leave list as-is */ }
    setLoading(false);
  };

  useEffect(() => { loadCerts(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const addCertification = async () => {
    setUploadError("");
    if (!form.certType.trim() || !form.certName.trim()) { setUploadError("Enter a ticket type and name."); return; }
    if (!file) { setUploadError("Choose a file to upload."); return; }
    setUploading(true);
    try {
      const { path } = await uploadViaSignedUrl({
        endpoint: "/api/certifications", action: "create_certification_upload_url", token,
        bucket: "worker-certifications", filename: file.name, file, contentType: file.type,
        extra: { rosterId: userId, companyId },
      });
      const res = await fetch("/api/certifications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_certification", token, companyId, rosterId: userId,
          certType: form.certType.trim(), certName: form.certName.trim(),
          issueDate: form.issueDate || null, expiryDate: form.expiryDate || null, filePath: path,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setUploadError(data.error || "Couldn't save that ticket."); setUploading(false); return; }
      setForm({ certType: "", certName: "", issueDate: "", expiryDate: "" });
      setFile(null);
      await loadCerts();
    } catch (e) {
      setUploadError(e.message || "Upload failed. Please try again.");
    }
    setUploading(false);
  };

  const removeCertification = async (id) => {
    if (!window.confirm("Remove this ticket?")) return;
    try {
      const res = await fetch("/api/certifications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_certification", token, companyId, certId: id }),
      });
      if (res.ok) setCerts(prev => prev.filter(c => c.id !== id));
    } catch (e) { /* leave list as-is */ }
  };

  const s = {
    wrap: { fontFamily: FONT.body, background: C.bg, minHeight: "100vh", color: C.text.primary },
    body: { padding: "18px 16px 40px", maxWidth: 640, margin: "0 auto" },
    card: {
      background: `linear-gradient(160deg, ${C.panelRaised} 0%, ${C.panel} 100%)`,
      border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: "16px 18px",
      boxShadow: SHAD.md, marginBottom: 16,
    },
    input: {
      padding: "10px 12px", borderRadius: RAD.sm, border: `1.5px solid ${C.line}`,
      background: C.panelInset, color: C.text.primary, fontSize: 14, boxSizing: "border-box", width: "100%",
    },
    label: { fontSize: 12, fontWeight: 700, color: C.text.faint, marginBottom: 4, display: "block" },
  };

  return (
    <div style={s.wrap}>
      <header style={{
        position: "sticky", top: 0, zIndex: 40,
        background: "rgba(10,10,10,0.88)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        borderBottom: `1px solid ${C.line}`, padding: "14px 20px",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: C.text.muted, cursor: "pointer", display: "flex", alignItems: "center" }}>
          <ChevronLeft size={22} />
        </button>
        <ShieldCheck size={18} color={C.orange} strokeWidth={2.25} />
        <div style={{ fontWeight: 700, fontSize: 16 }}>My Certifications</div>
      </header>

      <div style={s.body}>
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>Add a ticket</div>
          <div style={{ fontSize: 12, color: C.text.faint, marginBottom: 12 }}>Got a new or renewed certification, {userName?.split(" ")[0] || "there"}? Add it here.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ flex: "1 1 160px" }}>
              <label style={s.label}>Type</label>
              <input style={s.input} placeholder="e.g. Fall Protection" value={form.certType} onChange={e => setForm(f => ({ ...f, certType: e.target.value }))} />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <label style={s.label}>Name on card</label>
              <input style={s.input} placeholder="e.g. WHMIS 2015" value={form.certName} onChange={e => setForm(f => ({ ...f, certName: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={s.label}>Issue date (optional)</label>
              <input style={s.input} type="date" value={form.issueDate} onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} />
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label style={s.label}>Expiry date (optional)</label>
              <input style={s.input} type="date" value={form.expiryDate} onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={s.label}>Photo or PDF of the ticket</label>
            <input style={{ ...s.input, padding: "8px 10px" }} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" onChange={e => setFile(e.target.files?.[0] || null)} />
          </div>
          {uploadError && <div style={{ fontSize: 12, color: C.status.danger.text, marginBottom: 10 }}>{uploadError}</div>}
          <button onClick={addCertification} disabled={uploading} style={{
            background: C.orange, color: C.text.onOrange, border: "none", borderRadius: RAD.sm,
            padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: uploading ? 0.6 : 1,
          }}>
            {uploading ? "Uploading…" : "Add ticket"}
          </button>
        </div>

        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>Your tickets ({certs.length})</div>
          {loading ? (
            <div style={{ textAlign: "center", padding: "20px 0", color: C.text.faint }}>Loading…</div>
          ) : certs.length === 0 ? (
            <div style={{ color: C.text.faint, textAlign: "center", padding: "10px 0" }}>Nothing uploaded yet.</div>
          ) : (
            certs.map(c => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}`, gap: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text.primary }}>
                    {c.cert_name}
                    {c.unverified && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: C.status.warning.text, background: C.status.warning.bg, border: `1px solid ${C.status.warning.border}`, borderRadius: RAD.pill, padding: "2px 8px" }}>UNVERIFIED</span>}
                  </div>
                  <div style={{ fontSize: 12, color: C.text.faint }}>
                    {c.cert_type}{c.expiry_date ? ` · ${c.status === "expired" ? "expired" : "expires"} ${new Date(c.expiry_date).toLocaleDateString("en-CA")}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                  {c.fileUrl && <a href={c.fileUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.orange, fontWeight: 700, textDecoration: "none" }}>View</a>}
                  <button onClick={() => removeCertification(c.id)} style={{ background: "transparent", border: "none", color: C.status.danger.text, fontSize: 13, cursor: "pointer", fontWeight: 700 }}>Remove</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
