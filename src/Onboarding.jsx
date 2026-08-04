import { useState } from "react";
import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";

// Public onboarding intake — no login required. A brand-new customer lands
// here right after paying, before they have any credentials of their own.
// Nothing here provisions an account automatically; it just collects
// everything needed so onboarding is a quick manual step instead of a
// back-and-forth email chain.

const styles = {
  wrap: {
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    background: "#0A0A0A", minHeight: "100vh",
    display: "flex", justifyContent: "center", padding: "40px 16px",
  },
  card: {
    background: "#161616", borderRadius: 16, padding: 32, width: "100%", maxWidth: 640,
    border: "1px solid #F9731640", boxShadow: "0 4px 30px #F9731622", height: "fit-content",
  },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "#F97316", marginBottom: 6, marginTop: 18 },
  hint: { fontSize: 12, color: "#9CA3AF", marginBottom: 8, marginTop: -2 },
  input: {
    width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #2A2A2A",
    background: "#1E1E1E", color: "#fff",
    fontSize: 15, boxSizing: "border-box", outline: "none",
  },
  textarea: {
    width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #2A2A2A",
    background: "#1E1E1E", color: "#fff",
    fontSize: 15, boxSizing: "border-box", outline: "none", minHeight: 90, fontFamily: "inherit", resize: "vertical",
  },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  primaryBtn: {
    width: "100%", background: "#F97316", color: "#fff", border: "none", borderRadius: 10,
    padding: "14px", fontWeight: 700, fontSize: 16, cursor: "pointer", marginTop: 28,
  },
  fileList: { fontSize: 13, color: "#9CA3AF", marginTop: 8 },
  consentRow: { display: "flex", alignItems: "flex-start", gap: 10, marginTop: 24 },
  consentText: { fontSize: 13, color: "#9CA3AF", lineHeight: 1.5 },
};

const emptyForm = {
  companyName: "", contactName: "", contactEmail: "", contactPhone: "", address: "",
  sitesList: "", unitsList: "", usersList: "", customRequest: "",
};

export default function Onboarding() {
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState([]);
  const [logoFile, setLogoFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleFiles = (e) => {
    setFiles(Array.from(e.target.files || []));
  };

  const handleLogoFile = (e) => {
    setLogoFile(e.target.files?.[0] || null);
  };

  const uploadSops = async () => {
    const paths = [];
    for (const file of files) {
      const ext = file.name.split(".").pop();
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`.replace(/[^a-zA-Z0-9_.\-]/g, "");
      try {
        const { path } = await uploadViaSignedUrl({
          endpoint: "/api/login", action: "create_onboarding_upload_url",
          bucket: "onboarding-uploads", filename, file, contentType: file.type,
        });
        paths.push(path);
      } catch (e) {
        throw new Error(`Couldn't upload ${file.name}: ${e.message}`);
      }
    }
    return paths;
  };

  const uploadLogo = async () => {
    if (!logoFile) return "";
    const ext = logoFile.name.split(".").pop();
    const filename = `onboarding_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`.replace(/[^a-zA-Z0-9_.\-]/g, "");
    try {
      const { publicUrl } = await uploadViaSignedUrl({
        endpoint: "/api/login", action: "create_onboarding_upload_url",
        bucket: "company-logos", filename, file: logoFile, contentType: logoFile.type,
      });
      return publicUrl;
    } catch (e) {
      throw new Error(`Couldn't upload logo: ${e.message}`);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.companyName.trim() || !form.contactEmail.trim()) {
      setError("Company name and contact email are required.");
      return;
    }

    if (!agreed) {
      setError("Please agree to the Privacy Policy and Terms of Use to continue.");
      return;
    }

    setSubmitting(true);
    try {
      setUploading(true);
      const [sopFilePaths, logoUrl] = await Promise.all([uploadSops(), uploadLogo()]);
      setUploading(false);

      const stripeSessionId = new URLSearchParams(window.location.search).get("session_id") || "";

      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_onboarding_intake",
          companyName: form.companyName.trim(),
          contactName: form.contactName.trim(),
          contactEmail: form.contactEmail.trim(),
          contactPhone: form.contactPhone.trim(),
          address: form.address.trim(),
          sitesList: form.sitesList.trim(),
          unitsList: form.unitsList.trim(),
          usersList: form.usersList.trim(),
          customRequest: form.customRequest.trim(),
          sopFilePaths,
          logoUrl,
          stripeSessionId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    }
    setSubmitting(false);
    setUploading(false);
  };

  if (done) {
    return (
      <div style={styles.wrap}>
        <div style={{ ...styles.card, maxWidth: 480, textAlign: "center", marginTop: 80 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#F97316", marginBottom: 8 }}>You're all set</div>
          <div style={{ fontSize: 14, color: "#9CA3AF", lineHeight: 1.6 }}>
            Thanks — we've got everything. We'll email you within one business day once your company is live on FORA.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>Let's get you set up</div>
          <div style={{ fontSize: 13, color: "#9CA3AF", marginTop: 4 }}>
            Tell us about your company. However messy, send it as-is — we'll sort it out.
          </div>
        </div>

        <div style={styles.label}>Company name *</div>
        <input style={styles.input} value={form.companyName} onChange={set("companyName")} placeholder="ABC Earthworks Company" required />

        <div style={styles.row}>
          <div>
            <div style={styles.label}>Contact name</div>
            <input style={styles.input} value={form.contactName} onChange={set("contactName")} placeholder="Your name" />
          </div>
          <div>
            <div style={styles.label}>Contact email *</div>
            <input style={styles.input} type="email" value={form.contactEmail} onChange={set("contactEmail")} placeholder="you@company.com" required />
          </div>
        </div>

        <div style={styles.row}>
          <div>
            <div style={styles.label}>Contact phone</div>
            <input style={styles.input} value={form.contactPhone} onChange={set("contactPhone")} placeholder="(555) 555-5555" />
          </div>
          <div>
            <div style={styles.label}>Business address</div>
            <input style={styles.input} value={form.address} onChange={set("address")} placeholder="Street, city, province" />
          </div>
        </div>

        <div style={styles.label}>Company logo</div>
        <div style={styles.hint}>Optional — shows on your login screen and generated PDFs.</div>
        <input style={styles.input} type="file" onChange={handleLogoFile} accept=".png,.jpg,.jpeg,.svg" />
        {logoFile && <div style={styles.fileList}>{logoFile.name}</div>}

        <div style={styles.label}>Sites</div>
        <div style={styles.hint}>One per line — job sites, yards, or locations your crew works out of.</div>
        <textarea style={styles.textarea} value={form.sitesList} onChange={set("sitesList")} placeholder={"Red Deer County\nMain Yard"} />

        <div style={styles.label}>Units / equipment</div>
        <div style={styles.hint}>One per line — year, make, model, and unit number if you have one.</div>
        <textarea style={styles.textarea} value={form.unitsList} onChange={set("unitsList")} placeholder={"2026 Chevrolet 2500 Pick up\n2005 John Deere 624H Loader — Unit 4"} />

        <div style={styles.label}>Users</div>
        <div style={styles.hint}>One per line — name and role (worker or supervisor).</div>
        <textarea style={styles.textarea} value={form.usersList} onChange={set("usersList")} placeholder={"Mike Reyes — worker\nSarah Kaur — supervisor"} />

        <div style={styles.label}>SOPs</div>
        <div style={styles.hint}>Upload however you have them — PDFs, Word docs, scans, photos. Messy is fine.</div>
        <input style={styles.input} type="file" multiple onChange={handleFiles} accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" />
        {files.length > 0 && (
          <div style={styles.fileList}>{files.length} file{files.length === 1 ? "" : "s"} selected: {files.map((f) => f.name).join(", ")}</div>
        )}

        <div style={styles.label}>Custom form or custom build request</div>
        <div style={styles.hint}>Optional — describe anything beyond the standard five you'd like built.</div>
        <textarea style={styles.textarea} value={form.customRequest} onChange={set("customRequest")} placeholder="e.g. a monthly fuel log, or a preventative maintenance tracker for our fleet" />

        <label style={styles.consentRow}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, accentColor: "#F97316" }}
          />
          <span style={styles.consentText}>
            I agree to FORA's{" "}
            <a href="https://forafieldsolutions.com/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: "#F97316" }}>Privacy Policy</a>
            {" "}and{" "}
            <a href="https://forafieldsolutions.com/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: "#F97316" }}>Terms of Use</a>
            {" "}on behalf of my company.
          </span>
        </label>

        {error && (
          <div style={{ background: "#2A1212", border: "1px solid #DC262660", borderRadius: 8, padding: "10px 12px", marginTop: 16, fontSize: 13, color: "#FCA5A5" }}>
            {error}
          </div>
        )}

        <button type="submit" style={{ ...styles.primaryBtn, opacity: submitting || !agreed ? 0.7 : 1 }} disabled={submitting || !agreed}>
          {uploading ? "Uploading files…" : submitting ? "Submitting…" : "Submit"}
        </button>
      </form>
    </div>
  );
}
