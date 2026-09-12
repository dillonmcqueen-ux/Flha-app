import { useEffect, useState } from "react";
import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";

// Public onboarding-wallet invite page — no PIN required. A new hire (or
// an existing worker being asked to get their tickets on file) lands here
// from a link their employer generated and sent them (Admin Panel's
// Roster tab, "Invite" button — api/companydata.js's create_wallet_invite).
// Opening the link redeems it for an ordinary session, scoped server-side
// to the roster row the token belongs to (api/login.js's
// redeem_wallet_invite) — this page never sends a companyId/rosterId of
// its own for anything but the upload calls that session already permits.
// The link is single-use; after this, the person logs back in with their
// normal name + PIN like any other roster login (their PIN was already
// set when the admin added them).

const styles = {
  wrap: {
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    background: "#0A0A0A", minHeight: "100vh",
    display: "flex", justifyContent: "center", padding: "40px 16px",
  },
  card: {
    background: "#161616", borderRadius: 16, padding: 32, width: "100%", maxWidth: 560,
    border: "1px solid #F9731640", boxShadow: "0 4px 30px #F9731622", height: "fit-content", marginBottom: 20,
  },
  h1: { fontSize: 22, fontWeight: 700, color: "#fff" },
  h2: { fontSize: 15, fontWeight: 700, color: "#F97316", marginBottom: 10, marginTop: 4 },
  hint: { fontSize: 12, color: "#9CA3AF", marginBottom: 12 },
  label: { fontSize: 12, fontWeight: 700, color: "#9CA3AF", marginBottom: 4, display: "block" },
  input: {
    padding: "10px 12px", borderRadius: 8, border: "1.5px solid #2A2A2A",
    background: "#1E1E1E", color: "#fff", fontSize: 14, boxSizing: "border-box", outline: "none", width: "100%",
  },
  row: { display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" },
  primaryBtn: {
    background: "#F97316", color: "#fff", border: "none", borderRadius: 8,
    padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer",
  },
  ghostBtn: {
    background: "transparent", color: "#9CA3AF", border: "1px solid #2A2A2A", borderRadius: 8,
    padding: "10px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer",
  },
  certRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 0", borderBottom: "1px solid #2A2A2A", gap: 10,
  },
};

export default function WalletInvite() {
  const inviteToken = new URLSearchParams(window.location.search).get("token") || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [session, setSession] = useState(null); // { userId, userName, companyId, companyName }
  const [token, setToken] = useState("");
  const [certs, setCerts] = useState([]);
  const [form, setForm] = useState({ certType: "", certName: "", issueDate: "", expiryDate: "" });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    if (!inviteToken) { setError("Missing invite link."); setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch("/api/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "redeem_wallet_invite", inviteToken }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error || "That invite link isn't valid."); setLoading(false); return; }
        setSession(data.session);
        setToken(data.token);
        await loadCerts(data.token, data.session);
      } catch (e) {
        setError("Couldn't load your invite. Please try again.");
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);

  const loadCerts = async (tok, sess) => {
    try {
      const res = await fetch("/api/certifications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_certifications", token: tok, companyId: sess.companyId }),
      });
      const data = await res.json();
      if (res.ok) setCerts(data.certifications || []);
    } catch (e) { /* leave list as-is */ }
  };

  const addCertification = async () => {
    setUploadError("");
    if (!form.certType.trim() || !form.certName.trim()) { setUploadError("Enter a ticket type and name."); return; }
    if (!file) { setUploadError("Choose a file to upload."); return; }
    setUploading(true);
    try {
      const { path } = await uploadViaSignedUrl({
        endpoint: "/api/certifications", action: "create_certification_upload_url", token,
        filename: file.name, file, contentType: file.type,
        extra: { rosterId: session.userId, companyId: session.companyId },
      });
      const res = await fetch("/api/certifications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_certification", token, companyId: session.companyId, rosterId: session.userId,
          certType: form.certType.trim(), certName: form.certName.trim(),
          issueDate: form.issueDate || null, expiryDate: form.expiryDate || null, filePath: path,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setUploadError(data.error || "Couldn't save that ticket."); setUploading(false); return; }
      setForm({ certType: "", certName: "", issueDate: "", expiryDate: "" });
      setFile(null);
      await loadCerts(token, session);
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
        body: JSON.stringify({ action: "delete_certification", token, companyId: session.companyId, certId: id }),
      });
      if (res.ok) setCerts(prev => prev.filter(c => c.id !== id));
    } catch (e) { /* leave list as-is */ }
  };

  if (loading) return <div style={styles.wrap}><div style={{ color: "#9CA3AF", marginTop: 60 }}>Loading…</div></div>;

  if (error) {
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <div style={styles.h1}>Onboarding Wallet</div>
          <div style={{ ...styles.hint, color: "#F87171", marginTop: 10 }}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={{ width: "100%", maxWidth: 560 }}>
        <div style={styles.card}>
          <div style={styles.h1}>Welcome, {session.userName?.split(" ")[0] || "there"}</div>
          <div style={styles.hint}>
            Upload your safety tickets/certifications for {session.companyName}. This link is single-use —
            after today, log back in with your usual name and PIN to add more or check on these anytime.
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.h2}>Add a ticket</div>
          <div style={styles.row}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={styles.label}>Type</label>
              <input style={styles.input} placeholder="e.g. Fall Protection" value={form.certType}
                onChange={e => setForm(f => ({ ...f, certType: e.target.value }))} />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={styles.label}>Name on card</label>
              <input style={styles.input} placeholder="e.g. WHMIS 2015" value={form.certName}
                onChange={e => setForm(f => ({ ...f, certName: e.target.value }))} />
            </div>
          </div>
          <div style={styles.row}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={styles.label}>Issue date (optional)</label>
              <input style={styles.input} type="date" value={form.issueDate}
                onChange={e => setForm(f => ({ ...f, issueDate: e.target.value }))} />
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={styles.label}>Expiry date (optional)</label>
              <input style={styles.input} type="date" value={form.expiryDate}
                onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))} />
            </div>
          </div>
          <div style={styles.row}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={styles.label}>Photo or PDF of the ticket</label>
              <input style={{ ...styles.input, padding: "8px 10px" }} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                onChange={e => setFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          {uploadError && <div style={{ fontSize: 12, color: "#F87171", marginBottom: 10 }}>{uploadError}</div>}
          <button style={{ ...styles.primaryBtn, opacity: uploading ? 0.6 : 1 }} onClick={addCertification} disabled={uploading}>
            {uploading ? "Uploading…" : "Add ticket"}
          </button>
        </div>

        <div style={styles.card}>
          <div style={styles.h2}>Your tickets ({certs.length})</div>
          {certs.length === 0 ? (
            <div style={{ color: "#6B7280", padding: "10px 0" }}>Nothing uploaded yet.</div>
          ) : (
            certs.map(c => (
              <div key={c.id} style={styles.certRow}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#E5E7EB" }}>{c.cert_name}</div>
                  <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                    {c.cert_type}{c.expiry_date ? ` · expires ${new Date(c.expiry_date).toLocaleDateString("en-CA")}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                  {c.fileUrl && <a href={c.fileUrl} target="_blank" rel="noreferrer" style={{ ...styles.ghostBtn, textDecoration: "none" }}>View</a>}
                  <button style={{ background: "transparent", border: "none", color: "#F87171", fontSize: 13, cursor: "pointer", fontWeight: 700 }} onClick={() => removeCertification(c.id)}>Remove</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
