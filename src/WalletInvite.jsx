import { useEffect, useState } from "react";
import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";

// Public "set up your sign-in" page. A person lands here from the link FORA
// emailed them (company creation, an Owner adding them, or a resend; see
// server-lib/setupLinks.js). Opening it proves their mailbox, so:
//   1. they choose their own 6-digit PIN (api/login.js's pin_link_open and
//      pin_link_set_pin; nothing here sends a companyId or rosterId),
//   2. someone whose role needs an authenticator is handed straight to the
//      existing authenticator setup on the login page, and gets a session only
//      after it,
//   3. everyone else is signed in as soon as the PIN is saved, and may add a
//      photo and safety tickets before opening the app (both optional).
// The link is single-use.

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
  disclaimer: {
    fontSize: 11, color: "#FDBA74", background: "#F9731614", border: "1px solid #F9731633",
    borderRadius: 6, padding: "6px 10px", marginBottom: 10,
  },
  code: { fontFamily: "monospace", background: "#1E1E1E", padding: "2px 8px", borderRadius: 6, color: "#F97316", fontWeight: 700 },
};

const SESSION_STORAGE_KEY = "fora_session"; // same key and shape as Login.jsx

export default function WalletInvite() {
  const linkToken = new URLSearchParams(window.location.search).get("token") || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState(null); // { name, companyName, emailOnFile, emailHint, mfaRequired, hasAuthenticator }
  const [stage, setStage] = useState("pin"); // "pin" | "extras" | "signin"
  const [session, setSession] = useState(null); // { userId, userName, companyId, companyName }
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [settingPin, setSettingPin] = useState(false);
  const [pinError, setPinError] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [certs, setCerts] = useState([]);
  const [form, setForm] = useState({ certType: "", certName: "", issueDate: "", expiryDate: "" });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState("");
  // Only an explicit false hides the ticket card; null means the server couldn't
  // check, and it still refuses an upload the company hasn't bought.
  const [certificationsEnabled, setCertificationsEnabled] = useState(null);

  useEffect(() => {
    if (!linkToken) { setError("Missing setup link."); setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch("/api/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pin_link_open", linkToken }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error || "That setup link isn't valid."); setLoading(false); return; }
        setInfo(data);
      } catch (e) {
        setError("Couldn't load your setup link. Please try again.");
      }
      setLoading(false);
    })();
  }, [linkToken]);

  const setMyPin = async () => {
    setPinError("");
    if (!/^\d{6}$/.test(pin)) { setPinError("Choose a 6-digit PIN."); return; }
    if (pin !== pinConfirm) { setPinError("The two PINs don't match."); return; }
    if (!info.emailOnFile && info.mfaRequired && !email.trim()) { setPinError("Enter your email address."); return; }
    setSettingPin(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pin_link_set_pin", linkToken, pin, ...(info.emailOnFile ? {} : { email: email.trim() }) }),
      });
      const data = await res.json();
      if (!res.ok) { setPinError(data.error || "Couldn't save your PIN."); setSettingPin(false); return; }
      if (data.stage === "enroll") {
        // The login page already runs authenticator setup from this ticket.
        window.location.assign(`/?mfa_setup=${encodeURIComponent(data.enrollTicket)}`);
        return;
      }
      if (data.stage === "signin") { setStage("signin"); setSettingPin(false); return; }
      const s = { ...data.session, token: data.token };
      try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* storage blocked: they can still sign in with the PIN */ }
      setSession(data.session);
      setToken(data.token);
      setCertificationsEnabled(data.certificationsEnabled ?? null);
      if (data.certificationsEnabled !== false) await loadCerts(data.token, data.session);
      setStage("extras");
    } catch (e) {
      setPinError("Couldn't save your PIN. Please try again.");
    }
    setSettingPin(false);
  };

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
        bucket: "worker-certifications", filename: file.name, file, contentType: file.type,
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

  const onPhotoChange = (e) => {
    const f = e.target.files?.[0] || null;
    setPhotoFile(f);
    setPhotoPreview(f ? URL.createObjectURL(f) : null);
  };

  const finishSetup = async () => {
    setFinishError("");
    setFinishing(true);
    try {
      if (photoFile) {
        const { path } = await uploadViaSignedUrl({
          endpoint: "/api/certifications", action: "create_photo_upload_url", token,
          bucket: "worker-photos", filename: photoFile.name, file: photoFile, contentType: photoFile.type,
        });
        const photoRes = await fetch("/api/certifications", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set_profile_photo", token, photoPath: path }),
        });
        const photoData = await photoRes.json();
        if (!photoRes.ok) { setFinishError(photoData.error || "Couldn't save your photo."); setFinishing(false); return; }
      }
      await fetch("/api/certifications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete_onboarding", token }),
      });
      window.location.assign("/");
      return;
    } catch (e) {
      setFinishError(e.message || "Something went wrong. Please try again.");
    }
    setFinishing(false);
  };

  if (loading) return <div style={styles.wrap}><div style={{ color: "#9CA3AF", marginTop: 60 }}>Loading…</div></div>;

  if (error) {
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <div style={styles.h1}>Set up your sign-in</div>
          <div style={{ ...styles.hint, color: "#F87171", marginTop: 10 }}>{error}</div>
        </div>
      </div>
    );
  }

  if (stage === "signin") {
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <div style={styles.h1}>PIN saved, {info.name.split(" ")[0]}</div>
          <div style={{ ...styles.hint, marginTop: 10 }}>
            Your account already uses an authenticator app, so sign in from the normal login page with your name, your new PIN and your authenticator code.
          </div>
          <button style={styles.primaryBtn} onClick={() => window.location.assign("/")}>Go to sign in</button>
        </div>
      </div>
    );
  }

  if (stage === "pin") {
    return (
      <div style={styles.wrap}>
        <div style={{ width: "100%", maxWidth: 560 }}>
          <div style={styles.card}>
            <div style={styles.h1}>Welcome to {info.companyName}</div>
            <div style={styles.hint}>
              Hi {info.name}. Choose a 6-digit PIN. You will sign in with your name and this PIN from now on, so write it down somewhere safe.
              {info.mfaRequired && !info.hasAuthenticator && " Your role also needs an authenticator app, so the next step sets that up. Have your phone handy."}
              {" "}This link works once.
            </div>
          </div>
          <div style={styles.card}>
            <div style={styles.h2}>Your PIN</div>
            {!info.emailOnFile && (
              <div style={{ marginBottom: 12 }}>
                <label style={styles.label}>Email address{info.mfaRequired ? "" : " (optional)"}</label>
                <input style={styles.input} type="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
            )}
            <div style={styles.row}>
              <div style={{ minWidth: 160 }}>
                <label style={styles.label}>PIN</label>
                <input style={{ ...styles.input, fontFamily: "monospace", fontSize: 18, letterSpacing: 2 }} inputMode="numeric" autoComplete="new-password" maxLength={6}
                  placeholder="6 digits" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} />
              </div>
              <div style={{ minWidth: 160 }}>
                <label style={styles.label}>Confirm PIN</label>
                <input style={{ ...styles.input, fontFamily: "monospace", fontSize: 18, letterSpacing: 2 }} inputMode="numeric" autoComplete="new-password" maxLength={6}
                  placeholder="6 digits" value={pinConfirm} onChange={e => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))} />
              </div>
            </div>
            {pinError && <div style={{ fontSize: 13, color: "#F87171", marginBottom: 10 }}>{pinError}</div>}
            <button style={{ ...styles.primaryBtn, width: "100%", padding: "14px 16px", fontSize: 15, opacity: settingPin ? 0.6 : 1 }} onClick={setMyPin} disabled={settingPin}>
              {settingPin ? "Saving…" : "Set my PIN"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={{ width: "100%", maxWidth: 560 }}>
        <div style={styles.card}>
          <div style={styles.h1}>You're in, {session.userName.split(" ")[0]}</div>
          <div style={styles.hint}>
            Your PIN is saved and you are signed in to {session.companyName}. Adding a photo and your safety tickets now is optional, and you can do it any time later.
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.h2}>Profile photo (optional)</div>
          {photoPreview && <img src={photoPreview} alt="" style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", display: "block", marginBottom: 8 }} />}
          <input style={{ ...styles.input, padding: "8px 10px" }} type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif" onChange={onPhotoChange} />
        </div>

        {certificationsEnabled !== false && (
        <div style={styles.card}>
          <div style={styles.h2}>Add a ticket</div>
          <div style={styles.disclaimer}>Tickets you upload here are marked "Unverified" until your supervisor has had a chance to look them over.</div>
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

          {certs.length > 0 && (
            <div style={{ marginTop: 16 }}>
              {certs.map(c => (
                <div key={c.id} style={styles.certRow}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#E5E7EB" }}>
                      {c.cert_name}
                      {c.unverified && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: "#FDBA74", background: "#F9731622", border: "1px solid #F9731644", borderRadius: 20, padding: "2px 8px" }}>UNVERIFIED</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                      {c.cert_type}{c.expiry_date ? ` · expires ${new Date(c.expiry_date).toLocaleDateString("en-CA")}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    {c.fileUrl && <a href={c.fileUrl} target="_blank" rel="noreferrer" style={{ ...styles.ghostBtn, textDecoration: "none" }}>View</a>}
                    <button style={{ background: "transparent", border: "none", color: "#F87171", fontSize: 13, cursor: "pointer", fontWeight: 700 }} onClick={() => removeCertification(c.id)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {certificationsEnabled !== false && <div style={{ ...styles.hint, textAlign: "center" }}>No tickets yet? No problem — you can finish now and add them anytime from "My Certifications" once you're logged in.</div>}
        {finishError && <div style={{ fontSize: 13, color: "#F87171", marginBottom: 10 }}>{finishError}</div>}
        <button style={{ ...styles.primaryBtn, width: "100%", padding: "14px 16px", fontSize: 15, opacity: finishing ? 0.6 : 1 }} onClick={finishSetup} disabled={finishing}>
          {finishing ? "Opening…" : "Open FORA"}
        </button>
      </div>
    </div>
  );
}
