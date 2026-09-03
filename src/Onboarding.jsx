import { useEffect, useState } from "react";
import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD, glow as GLOW } from "./theme";
import {
  Building2, MapPin, Users, FileText, UploadCloud,
  Sparkles, AlertTriangle, CheckCircle2, ShieldCheck, Loader2, X, Check,
} from "lucide-react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_LINE_RE = /^(.+?)\s*[—-]\s*(worker|supervisor)$/i;

// Same parser api/admin.js uses when a company is actually created — kept
// in sync here so a submitter sees exactly which lines will/won't parse
// before they ever submit, instead of finding out from an admin later.
function skippedUserLines(usersList) {
  return (usersList || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((line) => !USER_LINE_RE.test(line));
}

// Public onboarding intake — no login required. A brand-new customer lands
// here right after paying, before they have any credentials of their own.
// Nothing here provisions an account automatically; it just collects
// everything needed so onboarding is a quick manual step instead of a
// back-and-forth email chain.
//
// Same design system as Dashboard.jsx/App.jsx/WorkerMenu.jsx (src/theme.js)
// — dark surfaces, two-part shadows, orange glow hero. This is the first
// screen a prospective customer ever sees of the product (before Dashboard,
// before login), so it gets the same hero treatment as Dashboard's welcome
// moment rather than a lesser one. The form itself is still one continuous
// scroll — no multi-step wizard was added — grouped into labeled sections
// so the page reads as organized instead of one long field dump, without
// adding extra clicks to a public intake form that should stay fast to fill
// out. All validation/upload/submit logic is unchanged from before.

const styles = {
  wrap: { fontFamily: FONT.body, background: C.bg, minHeight: "100vh", color: C.text.primary },
  centerWrap: { minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center", padding: "40px 16px" },
  body: { maxWidth: 640, margin: "0 auto", padding: "24px 16px 48px" },
  section: {
    background: C.panel, border: `1px solid ${C.line}`, borderRadius: RAD.lg,
    padding: "22px 22px 6px", marginBottom: 16, boxShadow: SHAD.md,
  },
  sectionHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 4 },
  sectionIcon: {
    width: 32, height: 32, borderRadius: RAD.md, flexShrink: 0,
    background: C.orangeSoft, border: `1px solid ${C.orangeDim}`,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  sectionTitle: { fontFamily: FONT.heading, fontWeight: 700, fontSize: 16, color: C.text.primary, letterSpacing: "-0.01em" },
  label: { display: "block", fontSize: 12, fontWeight: 700, color: C.text.muted, marginBottom: 6, marginTop: 18, textTransform: "uppercase", letterSpacing: "0.04em" },
  required: { color: C.orange },
  hint: { fontSize: 12.5, color: C.text.faint, marginBottom: 8, marginTop: -2, lineHeight: 1.5 },
  input: {
    width: "100%", padding: "12px 14px", borderRadius: RAD.sm, border: `1.5px solid ${C.line}`,
    background: C.panelInset, color: C.text.primary,
    fontSize: 15, boxSizing: "border-box", outline: "none", minHeight: 44,
  },
  textarea: {
    width: "100%", padding: "12px 14px", borderRadius: RAD.sm, border: `1.5px solid ${C.line}`,
    background: C.panelInset, color: C.text.primary,
    fontSize: 15, boxSizing: "border-box", outline: "none", minHeight: 90, fontFamily: "inherit", resize: "vertical",
  },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  fileBtn: {
    display: "flex", alignItems: "center", gap: 8, width: "100%", boxSizing: "border-box",
    padding: "11px 14px", borderRadius: RAD.sm, border: `1.5px dashed ${C.line}`,
    background: C.panelInset, color: C.text.body, fontSize: 14, fontWeight: 600,
    cursor: "pointer", minHeight: 44,
  },
  fileList: { fontSize: 13, color: C.text.muted, marginTop: 8, lineHeight: 1.6 },
  primaryBtn: {
    width: "100%", background: C.orange, color: C.text.onOrange, border: "none", borderRadius: RAD.md,
    padding: "15px", fontWeight: 700, fontSize: 16, cursor: "pointer", marginTop: 24,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    boxShadow: GLOW.orangeSoft, minHeight: 52, boxSizing: "border-box",
  },
  consentRow: { display: "flex", alignItems: "flex-start", gap: 10, marginTop: 20, marginBottom: 4 },
  consentText: { fontSize: 13, color: C.text.muted, lineHeight: 1.55 },
  errorBox: {
    display: "flex", alignItems: "flex-start", gap: 8, background: C.status.danger.bg,
    border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "10px 12px",
    marginTop: 16, fontSize: 13, color: C.status.danger.text,
  },
  warnBox: {
    display: "flex", alignItems: "flex-start", gap: 8, background: C.status.warning.bg,
    border: `1px solid ${C.status.warning.border}`, borderRadius: RAD.md, padding: "12px 14px",
    marginBottom: 16, fontSize: 13, color: C.status.warning.text, lineHeight: 1.5,
  },
  fieldError: { fontSize: 11.5, color: C.status.danger.text, marginTop: 5 },
};

const emptyForm = {
  companyName: "", contactName: "", contactEmail: "", contactPhone: "", address: "",
  sitesList: "", unitsList: "", usersList: "", customRequest: "",
};

// Small header used by every state of this screen (loading / already
// approved / done / the form itself) — same wordmark+glow-dot language as
// Dashboard.jsx/App.jsx/WorkerMenu.jsx, but without a logout button since
// nobody is logged in yet on this screen.
function Header() {
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 40,
      background: "rgba(10,10,10,0.88)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
      borderBottom: `1px solid ${C.line}`, padding: "14px 20px",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.orange, boxShadow: "0 0 14px 2px rgba(249,115,22,0.7)" }} />
      <span style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 18, color: C.text.primary, letterSpacing: "-0.01em" }}>FORA</span>
      <span style={{
        marginLeft: 2, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
        color: C.text.muted, border: `1px solid ${C.line}`, borderRadius: RAD.pill, padding: "3px 10px",
      }}>Company Setup</span>
    </header>
  );
}

// Centered single-message card used for the loading / already-approved /
// done states — a smaller, calmer version of the section card above, with
// the same gradient-panel + glow treatment as Dashboard's hero moment.
function StatusCard({ icon: Icon, iconColor = C.orange, title, children }) {
  return (
    <div style={styles.wrap}>
      <Header />
      <div style={styles.centerWrap}>
        <div style={{
          position: "relative", overflow: "hidden", width: "100%", maxWidth: 460,
          background: "linear-gradient(180deg,#171717 0%,#131313 100%)",
          border: `1px solid ${C.line}`, borderRadius: RAD.xl,
          padding: "36px 30px", textAlign: "center", boxShadow: SHAD.lg,
        }}>
          <div style={{
            position: "absolute", width: 320, height: 320, borderRadius: "50%",
            background: `radial-gradient(circle, ${iconColor}33 0%, transparent 68%)`,
            top: -150, left: "50%", transform: "translateX(-50%)", pointerEvents: "none",
          }} />
          <div style={{ position: "relative" }}>
            {Icon && (
              <div style={{
                width: 56, height: 56, borderRadius: "50%", margin: "0 auto 16px",
                background: `${iconColor}1F`, border: `1px solid ${iconColor}55`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon size={26} color={iconColor} strokeWidth={2.25} />
              </div>
            )}
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 21, color: C.text.primary, marginBottom: 10, letterSpacing: "-0.01em" }}>{title}</div>
            <div style={{ fontSize: 14, color: C.text.muted, lineHeight: 1.6 }}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Onboarding() {
  const editToken = new URLSearchParams(window.location.search).get("edit") || "";

  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState([]);
  const [logoFile, setLogoFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [autoApproved, setAutoApproved] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(!!editToken);
  const [alreadyApproved, setAlreadyApproved] = useState(false);
  const [adminNote, setAdminNote] = useState("");
  const [savedEditToken, setSavedEditToken] = useState("");

  // Self-serve edit: a submitter returning via their emailed edit link (or
  // one an admin sent after flagging something with update_onboarding_status)
  // lands here with the form pre-filled from what they already sent, so
  // fixing a typo or an unparseable user line doesn't mean starting over —
  // or FORA relaying "please fix X" by hand.
  useEffect(() => {
    if (!editToken) return;
    (async () => {
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_onboarding_intake", editToken }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error || "Couldn't load your submission."); setLoadingEdit(false); return; }
        const r = data.request;
        if (r.created_company_id) { setAlreadyApproved(true); setLoadingEdit(false); return; }
        setForm({
          companyName: r.company_name || "", contactName: r.contact_name || "",
          contactEmail: r.contact_email || "", contactPhone: r.contact_phone || "",
          address: r.address || "", sitesList: r.sites_list || "", unitsList: r.units_list || "",
          usersList: r.users_list || "", customRequest: r.custom_request || "",
        });
        setAdminNote(r.admin_note || "");
        setAgreed(true); // already agreed once, at original submission
      } catch (e) {
        setError("Couldn't load your submission.");
      }
      setLoadingEdit(false);
    })();
  }, [editToken]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const siteLines = form.sitesList.split("\n").map((s) => s.trim()).filter(Boolean);
  const badUserLines = skippedUserLines(form.usersList);
  const emailLooksValid = !form.contactEmail.trim() || EMAIL_RE.test(form.contactEmail.trim());

  const handleFiles = (e) => {
    setFiles(Array.from(e.target.files || []));
  };

  const handleLogoFile = (e) => {
    setLogoFile(e.target.files?.[0] || null);
  };

  const uploadSops = async () => {
    // paths/pathTokens stay parallel arrays — the server only accepts a
    // sop file path back at submit time if it comes paired with the
    // matching pathToken it handed out right here, so it can tell "this
    // browser actually uploaded this file through this flow" apart from
    // any other string a submitter could type into the request. See
    // filterVerifiedSopPaths in api/login.js.
    const paths = [];
    const pathTokens = [];
    for (const file of files) {
      const ext = file.name.split(".").pop();
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`.replace(/[^a-zA-Z0-9_.\-]/g, "");
      try {
        const { path, pathToken } = await uploadViaSignedUrl({
          endpoint: "/api/login", action: "create_onboarding_upload_url",
          bucket: "onboarding-uploads", filename, file, contentType: file.type,
        });
        paths.push(path);
        pathTokens.push(pathToken);
      } catch (e) {
        throw new Error(`Couldn't upload ${file.name}: ${e.message}`);
      }
    }
    return { paths, pathTokens };
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

    // Catch the same things the server will reject, before ever uploading
    // files — so a submitter with a typo'd email or an empty site list
    // finds out immediately instead of after a full upload, and the admin
    // never sees the malformed version at all.
    if (!form.companyName.trim() || !form.contactEmail.trim()) {
      setError("Company name and contact email are required.");
      return;
    }
    if (!EMAIL_RE.test(form.contactEmail.trim())) {
      setError("Enter a valid contact email address.");
      return;
    }
    if (siteLines.length === 0) {
      setError("List at least one site, yard, or location — one per line.");
      return;
    }
    if (form.usersList.trim().split("\n").map((s) => s.trim()).filter(Boolean).length === 0) {
      setError('List at least one person — one per line, e.g. "Mike Reyes — worker".');
      return;
    }

    if (!agreed) {
      setError("Please agree to the Privacy Policy and Terms of Use to continue.");
      return;
    }

    setSubmitting(true);
    try {
      setUploading(true);
      const [{ paths: sopFilePaths, pathTokens: sopPathTokens }, logoUrl] = await Promise.all([uploadSops(), uploadLogo()]);
      setUploading(false);

      const stripeSessionId = new URLSearchParams(window.location.search).get("session_id") || "";

      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_onboarding_intake",
          editToken: editToken || undefined,
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
          sopPathTokens,
          logoUrl,
          stripeSessionId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || (data.errors && data.errors[0]) || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      setSavedEditToken(data.editToken || editToken || "");
      setAutoApproved(!!data.autoApproved);
      setDone(true);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    }
    setSubmitting(false);
    setUploading(false);
  };

  if (loadingEdit) {
    return (
      <StatusCard icon={Loader2} title="Loading your submission…">
        One moment.
      </StatusCard>
    );
  }

  if (alreadyApproved) {
    return (
      <StatusCard icon={ShieldCheck} title="Already set up">
        This request has already been approved and your company is live — check your email for your claim link, or contact FORA support for help.
      </StatusCard>
    );
  }

  if (done) {
    return (
      <StatusCard icon={CheckCircle2} iconColor={C.status.success.solid} title={autoApproved ? "You're already live!" : "You're all set"}>
        {autoApproved
          ? "Your FORA account is ready right now — check your email for a link to finish setup: assign your team's PINs and review what we drafted from what you sent."
          : "Thanks — we've got everything. We'll email you within one business day once your company is live on FORA."}
        {!autoApproved && savedEditToken && (
          <div style={{ fontSize: 12, color: C.text.faint, lineHeight: 1.6, marginTop: 16, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
            Need to fix or add something first? We also emailed this, but you can bookmark it now:
            <br />
            <a
              href={`/onboarding?edit=${savedEditToken}`}
              style={{ color: C.orange, wordBreak: "break-all" }}
            >
              {window.location.origin}/onboarding?edit={savedEditToken}
            </a>
          </div>
        )}
      </StatusCard>
    );
  }

  return (
    <div style={styles.wrap}>
      <Header />
      <div style={styles.body}>
        {/* Hero — same welcome-moment language as Dashboard.jsx's hero panel:
            gradient card, orange radial glow, headline. This is the very
            first impression of FORA a prospective customer gets, so it earns
            the same treatment as the logged-in app's landing moment rather
            than a lesser one. */}
        <div style={{
          position: "relative", overflow: "hidden",
          background: "linear-gradient(180deg,#171717 0%,#131313 100%)",
          border: `1px solid ${C.line}`, borderRadius: RAD.xl,
          padding: "26px 26px", marginBottom: 18, boxShadow: SHAD.lg,
        }}>
          <div style={{
            position: "absolute", width: 420, height: 420, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(249,115,22,0.22) 0%, transparent 68%)",
            top: -190, right: -140, pointerEvents: "none",
          }} />
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.orange, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              {editToken ? "Update your submission" : "Company setup"}
            </div>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: "clamp(22px,4.6vw,30px)", color: C.text.primary, letterSpacing: "-0.02em", marginBottom: 8 }}>
              {editToken ? "Fix or add anything below" : "Let's get you set up"}
            </div>
            <div style={{ fontSize: 14, color: C.text.muted, maxWidth: 480 }}>
              {editToken
                ? "Update your submission and resubmit — we'll pick up right where you left off."
                : "Tell us about your company. However messy, send it as-is — we'll sort it out."}
            </div>
          </div>
        </div>

        {adminNote && (
          <div style={styles.warnBox}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <div><strong>A FORA team member flagged:</strong> {adminNote}</div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={styles.section}>
            <div style={styles.sectionHead}>
              <div style={styles.sectionIcon}><Building2 size={16} color={C.orange} strokeWidth={2.25} /></div>
              <div style={styles.sectionTitle}>Company details</div>
            </div>

            <div style={styles.label}>Company name <span style={styles.required}>*</span></div>
            <input style={styles.input} value={form.companyName} onChange={set("companyName")} placeholder="ABC Earthworks Company" required />

            <div style={styles.row}>
              <div>
                <div style={styles.label}>Contact name</div>
                <input style={styles.input} value={form.contactName} onChange={set("contactName")} placeholder="Your name" />
              </div>
              <div>
                <div style={styles.label}>Contact email <span style={styles.required}>*</span></div>
                <input style={styles.input} type="email" value={form.contactEmail} onChange={set("contactEmail")} placeholder="you@company.com" required />
                {!emailLooksValid && <div style={styles.fieldError}>Doesn't look like a valid email address.</div>}
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
            <label style={styles.fileBtn}>
              <UploadCloud size={16} color={C.text.muted} style={{ flexShrink: 0 }} />
              {logoFile ? logoFile.name : "Choose a file…"}
              <input type="file" onChange={handleLogoFile} accept=".png,.jpg,.jpeg" style={{ display: "none" }} />
            </label>
            <div style={{ marginBottom: 6 }} />
          </div>

          <div style={styles.section}>
            <div style={styles.sectionHead}>
              <div style={styles.sectionIcon}><MapPin size={16} color={C.orange} strokeWidth={2.25} /></div>
              <div style={styles.sectionTitle}>Sites &amp; equipment</div>
            </div>

            <div style={styles.label}>Sites <span style={styles.required}>*</span></div>
            <div style={styles.hint}>One per line — job sites, yards, or locations your crew works out of. At least one is required.</div>
            <textarea style={styles.textarea} value={form.sitesList} onChange={set("sitesList")} placeholder={"Red Deer County\nMain Yard"} />

            <div style={styles.label}>Units / equipment</div>
            <div style={styles.hint}>One per line — year, make, model, and unit number if you have one. We'll draft an editable equipment list from this for you to confirm later.</div>
            <textarea style={styles.textarea} value={form.unitsList} onChange={set("unitsList")} placeholder={"2026 Chevrolet 2500 Pick up\n2005 John Deere 624H Loader — Unit 4"} />
            <div style={{ marginBottom: 6 }} />
          </div>

          <div style={styles.section}>
            <div style={styles.sectionHead}>
              <div style={styles.sectionIcon}><Users size={16} color={C.orange} strokeWidth={2.25} /></div>
              <div style={styles.sectionTitle}>Your team</div>
            </div>

            <div style={styles.label}>Users <span style={styles.required}>*</span></div>
            <div style={styles.hint}>One per line — name and role, e.g. "Mike Reyes — worker" or "Sarah Kaur — supervisor". At least one is required.</div>
            <textarea style={styles.textarea} value={form.usersList} onChange={set("usersList")} placeholder={"Mike Reyes — worker\nSarah Kaur — supervisor"} />
            {badUserLines.length > 0 && (
              <div style={styles.fieldError}>
                These lines won't be recognized — use "Name — worker" or "Name — supervisor": {badUserLines.join("; ")}
              </div>
            )}
            <div style={{ marginBottom: 6 }} />
          </div>

          <div style={styles.section}>
            <div style={styles.sectionHead}>
              <div style={styles.sectionIcon}><FileText size={16} color={C.orange} strokeWidth={2.25} /></div>
              <div style={styles.sectionTitle}>SOPs</div>
            </div>
            <div style={styles.hint}>Upload however you have them — PDFs, Word docs, scans, photos. Messy is fine.</div>
            <label style={styles.fileBtn}>
              <UploadCloud size={16} color={C.text.muted} style={{ flexShrink: 0 }} />
              {files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"} selected` : "Choose files…"}
              <input type="file" multiple onChange={handleFiles} accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" style={{ display: "none" }} />
            </label>
            {files.length > 0 && (
              <div style={styles.fileList}>{files.map((f) => f.name).join(", ")}</div>
            )}

            <div style={styles.label}>Custom form or custom build request</div>
            <div style={styles.hint}>Optional — describe anything beyond the standard five you'd like built.</div>
            <textarea style={styles.textarea} value={form.customRequest} onChange={set("customRequest")} placeholder="e.g. a monthly fuel log, or a preventative maintenance tracker for our fleet" />
            <div style={{ marginBottom: 6 }} />
          </div>

          <div style={{ ...styles.section, paddingBottom: 22 }}>
            <label style={styles.consentRow}>
              <span style={{ position: "relative", flexShrink: 0, marginTop: 2 }}>
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  style={{
                    appearance: "none",
                    WebkitAppearance: "none",
                    width: 16,
                    height: 16,
                    margin: 0,
                    borderRadius: 4,
                    border: `1.5px solid ${agreed ? C.orange : C.line}`,
                    background: agreed ? C.orange : C.panelInset,
                    cursor: "pointer",
                    display: "block",
                  }}
                />
                {agreed && (
                  <Check
                    size={12}
                    color={C.text.onOrange}
                    strokeWidth={3.5}
                    style={{ position: "absolute", top: 2, left: 2, pointerEvents: "none" }}
                  />
                )}
              </span>
              <span style={styles.consentText}>
                I agree to FORA's{" "}
                <a href="https://forafieldsolutions.com/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: C.orange }}>Privacy Policy</a>
                {" "}and{" "}
                <a href="https://forafieldsolutions.com/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: C.orange }}>Terms of Use</a>
                {" "}on behalf of my company.
              </span>
            </label>

            {error && (
              <div style={styles.errorBox}>
                <X size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>{error}</div>
              </div>
            )}

            <button type="submit" style={{ ...styles.primaryBtn, opacity: submitting || !agreed ? 0.7 : 1 }} disabled={submitting || !agreed}>
              {uploading
                ? <><Loader2 size={17} className="fora-spin" /> Uploading files…</>
                : submitting
                  ? <><Loader2 size={17} className="fora-spin" /> Submitting…</>
                  : editToken
                    ? <><Sparkles size={17} /> Resubmit</>
                    : <><Sparkles size={17} /> Submit</>}
            </button>
          </div>
        </form>
      </div>
      <style>{"@keyframes fora-spin { to { transform: rotate(360deg); } } .fora-spin { animation: fora-spin 0.8s linear infinite; }"}</style>
    </div>
  );
}
