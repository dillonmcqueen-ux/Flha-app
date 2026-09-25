import { useEffect, useState } from "react";
import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";

// Public onboarding-wallet invite page — no PIN required. A new hire lands
// here from a link their supervisor generated (Dashboard's Roster tab,
// "Onboard New Employee" — api/companydata.js's onboard_new_employee, sent
// by email — or the per-person "Invite" button, same underlying token).
// Opening the link redeems it for an ordinary session, scoped server-side
// to the roster row the token belongs to (api/login.js's
// redeem_wallet_invite) — this page never sends a companyId/rosterId of
// its own for anything but the calls that session already permits.
// The link is single-use; "Finish Setup" below has them choose their own
// PIN (never emailed in plaintext) for every login after this one.

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

export default function WalletInvite() {
  const inviteToken = new URLSearchParams(window.location.search).get("token") || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [session, setSession] = useState(null); // { userId, userName, companyId, companyName }
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState({ name: "", email: "" });
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [pin, setPin] = useState("");
  const [certs, setCerts] = useState([]);
  const [form, setForm] = useState({ certType: "", certName: "", issueDate: "", expiryDate: "" });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState("");
  const [done, setDone] = useState(false);
  // From redeem_wallet_invite (break #24). Only an explicit false hides the
  // ticket card; null means the server couldn't check, and it still refuses
  // an upload the company hasn't bought.
  const [certificationsEnabled, setCertificationsEnabled] = useState(null);

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
        setProfile({ name: data.session.userName || "", email: data.email || "" });
        setCertificationsEnabled(data.certificationsEnabled ?? null);
        if (data.certificationsEnabled !== false) await loadCerts(data.token, data.session);
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
    const name = profile.name.trim();
    const email = profile.email.trim();
    if (!name) { setFinishError("Enter your name."); return; }
    if (!/^\d{6}$/.test(pin)) { setFinishError("Choose a 6-digit PIN — you'll use this to log in next time."); return; }
    setFinishing(true);
    try {
      const profileRes = await fetch("/api/certifications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_own_profile", token, name, email }),
      });
      const profileData = await profileRes.json();
      if (!profileRes.ok) { setFinishError(profileData.error || "Couldn't save your details."); setFinishing(false); return; }

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

      const pinRes = await fetch("/api/certifications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_own_pin", token, pin }),
      });
      const pinData = await pinRes.json();
      if (!pinRes.ok) { setFinishError(pinData.error || "Couldn't save your PIN."); setFinishing(false); return; }

      await fetch("/api/certifications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete_onboarding", token }),
      });

      setDone(true);
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
          <div style={styles.h1}>Onboarding Wallet</div>
          <div style={{ ...styles.hint, color: "#F87171", marginTop: 10 }}>{error}</div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <div style={styles.h1}>You're all set, {profile.name.split(" ")[0]}!</div>
          <div style={{ ...styles.hint, marginTop: 10 }}>
            Your details and tickets are on file with {session.companyName}. Next time, open the app and log in with your name and this PIN:
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <span style={{ ...styles.code, fontSize: 20, padding: "6px 14px" }}>{pin}</span>
          </div>
          <div style={{ ...styles.hint, marginTop: 14, marginBottom: 0 }}>You can close this page now.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={{ width: "100%", maxWidth: 560 }}>
        <div style={styles.card}>
          <div style={styles.h1}>Welcome to {session.companyName}</div>
          <div style={styles.hint}>
            Confirm your details below and choose a PIN — that's all that's required. Adding your safety tickets and a
            photo now is optional, and you can always add them later. This link is single-use.
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.h2}>Your details</div>
          <div style={styles.row}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={styles.label}>Name</label>
              <input style={styles.input} value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={styles.label}>Email</label>
              <input style={styles.input} type="email" value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} />
            </div>
          </div>
          <div style={styles.row}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={styles.label}>Profile photo (optional)</label>
              {photoPreview && <img src={photoPreview} alt="" style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", display: "block", marginBottom: 8 }} />}
              <input style={{ ...styles.input, padding: "8px 10px" }} type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif" onChange={onPhotoChange} />
            </div>
          </div>
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

        <div style={styles.card}>
          <div style={styles.h2}>Choose your PIN</div>
          <div style={styles.hint}>You'll use your name and this 6-digit PIN to log in from now on — write it down.</div>
          <input style={{ ...styles.input, maxWidth: 160, fontFamily: "monospace", fontSize: 18, letterSpacing: 2 }} inputMode="numeric" maxLength={6}
            placeholder="123456" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        </div>

        {certificationsEnabled !== false && <div style={{ ...styles.hint, textAlign: "center" }}>No tickets yet? No problem — you can finish now and add them anytime from "My Certifications" once you're logged in.</div>}
        {finishError && <div style={{ fontSize: 13, color: "#F87171", marginBottom: 10 }}>{finishError}</div>}
        <button style={{ ...styles.primaryBtn, width: "100%", padding: "14px 16px", fontSize: 15, opacity: finishing ? 0.6 : 1 }} onClick={finishSetup} disabled={finishing}>
          {finishing ? "Finishing…" : "Finish Setup"}
        </button>
      </div>
    </div>
  );
}
