import { useEffect, useRef, useState } from "react";
import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";
import theme from "./theme.js";
import {
  HardHat,
  Building2,
  MapPin,
  Users,
  FileText,
  ShieldCheck,
  CheckCircle2,
  Info,
  TriangleAlert,
  Upload,
  Image as ImageIcon,
  Paperclip,
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
// Visual identity: onto src/theme.js, same system as Dashboard.jsx /
// WorkerMenu.jsx / App.jsx (teal badge header, Inter type, lucide-react
// icons) instead of this file's old standalone dark/orange theme, which
// matched neither the marketing site's actual dark theme nor the app's
// identity. See theme.js's file header for why the app palette is
// deliberately its own thing, not a port of website/'s.
//
// Structure: single scroll with five labeled, anchor-navigable sections
// (Company -> Sites & Equipment -> Team -> Documents -> Review) rather than
// a gated multi-step wizard. Validation here mirrors the server's rules
// and only ever runs as a whole at submit time (see handleSubmit) — there's
// no per-field ordering the server cares about, so a wizard would have had
// to either invent new step-gating validation (a behavior change this pass
// isn't supposed to make) or just be a fancier way to view the same
// unconstrained fields. A visible section nav gets the "this reads as
// guided, not endless" goal without changing when/how anything validates.

const SECTIONS = [
  { id: "section-company", label: "Company", Icon: Building2 },
  { id: "section-sites", label: "Sites & Equipment", Icon: MapPin },
  { id: "section-team", label: "Team", Icon: Users },
  { id: "section-documents", label: "Documents", Icon: FileText },
  { id: "section-review", label: "Review", Icon: ShieldCheck },
];

const styles = {
  wrap: {
    fontFamily: theme.type.fontFamily,
    background: theme.colors.background, minHeight: "100vh",
    display: "flex", justifyContent: "center", padding: "32px 16px 60px",
    color: theme.colors.textPrimary,
  },
  outer: { width: "100%", maxWidth: 680 },
  header: {
    background: theme.colors.primaryDarker, borderRadius: theme.radius.lg,
    padding: "20px 24px", marginBottom: 16, color: theme.colors.textOnPrimary,
    display: "flex", alignItems: "center", gap: 12,
  },
  badge: {
    width: 40, height: 40, borderRadius: theme.radius.md, background: theme.colors.primary,
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  card: {
    background: theme.colors.surface, borderRadius: theme.radius.lg, padding: 24,
    marginBottom: 16, boxShadow: theme.shadow.sm, border: `1px solid ${theme.colors.border}`,
  },
  sectionHeading: { display: "flex", alignItems: "center", gap: 10, marginBottom: 18 },
  sectionIconWrap: {
    width: 34, height: 34, borderRadius: theme.radius.md, background: theme.colors.primarySoft,
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  sectionTitle: { fontSize: 16, fontWeight: 800, color: theme.colors.textPrimary },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: theme.colors.textSecondary, marginBottom: 6, marginTop: 18 },
  hint: { fontSize: 12, color: theme.colors.textMuted, marginBottom: 8, marginTop: -2 },
  input: {
    width: "100%", padding: "12px 14px", borderRadius: theme.radius.sm, border: `1.5px solid ${theme.colors.border}`,
    background: theme.colors.surface, color: theme.colors.textPrimary,
    fontSize: 15, boxSizing: "border-box", outline: "none", fontFamily: theme.type.fontFamily,
  },
  textarea: {
    width: "100%", padding: "12px 14px", borderRadius: theme.radius.sm, border: `1.5px solid ${theme.colors.border}`,
    background: theme.colors.surface, color: theme.colors.textPrimary,
    fontSize: 15, boxSizing: "border-box", outline: "none", minHeight: 90, fontFamily: "inherit", resize: "vertical",
  },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  primaryBtn: {
    width: "100%", background: theme.colors.primary, color: theme.colors.textOnPrimary, border: "none",
    borderRadius: theme.radius.md, padding: "14px", fontWeight: 700, fontSize: 16, cursor: "pointer",
    marginTop: 24, fontFamily: theme.type.fontFamily, minHeight: 48,
  },
  fileList: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: theme.colors.textSecondary, marginTop: 8 },
  consentRow: { display: "flex", alignItems: "flex-start", gap: 10, marginTop: 4 },
  consentText: { fontSize: 13, color: theme.colors.textSecondary, lineHeight: 1.5 },
};

function SectionCard({ id, icon: Icon, title, children }) {
  return (
    <div id={id} style={{ ...styles.card, scrollMarginTop: 16 }}>
      <div style={styles.sectionHeading}>
        <div style={styles.sectionIconWrap}>
          <Icon size={18} color={theme.colors.primaryDark} strokeWidth={2.25} />
        </div>
        <div style={styles.sectionTitle}>{title}</div>
      </div>
      {children}
    </div>
  );
}

// Passive progress-through-sections indicator. Doubles as anchor nav
// (clicking jumps to a section) but never gates access to any section —
// every field stays reachable/editable regardless of what's filled in
// above it, matching the all-at-once validation in handleSubmit.
function SectionNav({ activeId }) {
  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto", paddingBottom: 2 }}>
      {SECTIONS.map(({ id, label, Icon }, i) => {
        const active = id === activeId;
        return (
          <button
            key={id}
            type="button"
            onClick={() => scrollTo(id)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
              padding: "7px 12px", borderRadius: theme.radius.pill,
              border: `1.5px solid ${active ? theme.colors.primary : theme.colors.border}`,
              background: active ? theme.colors.primarySoft : theme.colors.surface,
              color: active ? theme.colors.primaryDark : theme.colors.textSecondary,
              fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: theme.type.fontFamily,
            }}
          >
            <span style={{
              width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
              background: active ? theme.colors.primary : theme.colors.border,
              color: active ? "#fff" : theme.colors.textMuted,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800,
            }}>{i + 1}</span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      width: 32, height: 32, margin: "0 auto 10px", borderRadius: "50%",
      border: `3px solid ${theme.colors.border}`, borderTopColor: theme.colors.primary,
      animation: "fora-spin 0.8s linear infinite",
    }}>
      <style>{"@keyframes fora-spin { to { transform: rotate(360deg); } }"}</style>
    </div>
  );
}

function StatusCard({ icon: Icon, iconColor, iconBg, title, children }) {
  return (
    <div style={styles.wrap}>
      <div style={{ ...styles.outer, maxWidth: 480, marginTop: 60 }}>
        <div style={{ ...styles.card, textAlign: "center" }}>
          <div style={{
            width: 52, height: 52, borderRadius: "50%", background: iconBg,
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
          }}>
            <Icon size={26} color={iconColor} strokeWidth={2.25} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: theme.colors.textPrimary, marginBottom: 8 }}>{title}</div>
          {children}
        </div>
      </div>
    </div>
  );
}

const emptyForm = {
  companyName: "", contactName: "", contactEmail: "", contactPhone: "", address: "",
  sitesList: "", unitsList: "", usersList: "", customRequest: "",
};

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
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);

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

  // Passive scroll-spy for the section nav — presentational only, never
  // affects which fields are enabled/validated.
  const sectionRefsReady = !loadingEdit && !alreadyApproved && !done;
  useEffect(() => {
    if (!sectionRefsReady) return;
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          const topMost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
          setActiveSection(topMost.target.id);
        }
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sectionRefsReady]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const siteLines = form.sitesList.split("\n").map((s) => s.trim()).filter(Boolean);
  const userLines = form.usersList.split("\n").map((s) => s.trim()).filter(Boolean);
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
      <div style={styles.wrap}>
        <div style={{ ...styles.outer, maxWidth: 480, marginTop: 80 }}>
          <div style={{ ...styles.card, textAlign: "center", color: theme.colors.textMuted }}>
            <Spinner />
            Loading your submission…
          </div>
        </div>
      </div>
    );
  }

  if (alreadyApproved) {
    return (
      <StatusCard icon={Info} iconColor={theme.colors.status.info.solid} iconBg={theme.colors.status.info.bg} title="Already set up">
        <div style={{ fontSize: 14, color: theme.colors.textSecondary, lineHeight: 1.6 }}>
          This request has already been approved and your company is live — check your email for your claim link, or contact FORA support for help.
        </div>
      </StatusCard>
    );
  }

  if (done) {
    return (
      <StatusCard
        icon={CheckCircle2}
        iconColor={theme.colors.status.success.solid}
        iconBg={theme.colors.status.success.bg}
        title={autoApproved ? "You're already live!" : "You're all set"}
      >
        <div style={{ fontSize: 14, color: theme.colors.textSecondary, lineHeight: 1.6 }}>
          {autoApproved
            ? "Your FORA account is ready right now — check your email for a link to finish setup: assign your team's PINs and review what we drafted from what you sent."
            : "Thanks — we've got everything. We'll email you within one business day once your company is live on FORA."}
        </div>
        {!autoApproved && savedEditToken && (
          <div style={{
            fontSize: 12, color: theme.colors.textMuted, lineHeight: 1.6, marginTop: 16,
            background: theme.colors.surfaceSunken, borderRadius: theme.radius.sm, padding: "10px 12px",
          }}>
            Need to fix or add something first? We also emailed this, but you can bookmark it now:
            <br />
            <a
              href={`/onboarding?edit=${savedEditToken}`}
              style={{ color: theme.colors.primaryDark, wordBreak: "break-all", fontWeight: 600 }}
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
      <form style={styles.outer} onSubmit={handleSubmit}>
        <div style={styles.header}>
          <div style={styles.badge}>
            <HardHat size={22} color={theme.colors.textOnPrimary} strokeWidth={2.25} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: -0.3 }}>
              {editToken ? "Update your submission" : "Let's get you set up"}
            </div>
            <div style={{ fontSize: 13, color: theme.colors.teal[200], marginTop: 2 }}>
              {editToken ? "Fix or add anything below, then resubmit." : "Tell us about your company. However messy, send it as-is — we'll sort it out."}
            </div>
          </div>
        </div>

        {adminNote && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            background: theme.colors.status.warning.bg, border: `1px solid ${theme.colors.status.warning.border}`,
            borderRadius: theme.radius.md, padding: "12px 14px", marginBottom: 16,
          }}>
            <TriangleAlert size={16} color={theme.colors.status.warning.text} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13, color: theme.colors.status.warning.text }}>A FORA team member flagged: {adminNote}</div>
          </div>
        )}

        <SectionNav activeId={activeSection} />

        <SectionCard id="section-company" icon={Building2} title="Company info">
          <div style={{ ...styles.label, marginTop: 0 }}>Company name *</div>
          <input style={styles.input} value={form.companyName} onChange={set("companyName")} placeholder="ABC Earthworks Company" required />

          <div style={styles.row}>
            <div>
              <div style={styles.label}>Contact name</div>
              <input style={styles.input} value={form.contactName} onChange={set("contactName")} placeholder="Your name" />
            </div>
            <div>
              <div style={styles.label}>Contact email *</div>
              <input style={styles.input} type="email" value={form.contactEmail} onChange={set("contactEmail")} placeholder="you@company.com" required />
              {!emailLooksValid && <div style={{ fontSize: 11, color: theme.colors.status.danger.solid, marginTop: 4 }}>Doesn't look like a valid email address.</div>}
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
          {logoFile && <div style={styles.fileList}><ImageIcon size={13} /> {logoFile.name}</div>}
        </SectionCard>

        <SectionCard id="section-sites" icon={MapPin} title="Sites & equipment">
          <div style={{ ...styles.label, marginTop: 0 }}>Sites *</div>
          <div style={styles.hint}>One per line — job sites, yards, or locations your crew works out of. At least one is required.</div>
          <textarea style={styles.textarea} value={form.sitesList} onChange={set("sitesList")} placeholder={"Red Deer County\nMain Yard"} />

          <div style={styles.label}>Units / equipment</div>
          <div style={styles.hint}>One per line — year, make, model, and unit number if you have one. We'll draft an editable equipment list from this for you to confirm later.</div>
          <textarea style={styles.textarea} value={form.unitsList} onChange={set("unitsList")} placeholder={"2026 Chevrolet 2500 Pick up\n2005 John Deere 624H Loader — Unit 4"} />
        </SectionCard>

        <SectionCard id="section-team" icon={Users} title="Team">
          <div style={{ ...styles.label, marginTop: 0 }}>Users *</div>
          <div style={styles.hint}>One per line — name and role, e.g. "Mike Reyes — worker" or "Sarah Kaur — supervisor". At least one is required.</div>
          <textarea style={styles.textarea} value={form.usersList} onChange={set("usersList")} placeholder={"Mike Reyes — worker\nSarah Kaur — supervisor"} />
          {badUserLines.length > 0 && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: theme.colors.status.danger.solid, marginTop: 8 }}>
              <TriangleAlert size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>These lines won't be recognized — use "Name — worker" or "Name — supervisor": {badUserLines.join("; ")}</span>
            </div>
          )}
        </SectionCard>

        <SectionCard id="section-documents" icon={FileText} title="Documents">
          <div style={{ ...styles.label, marginTop: 0 }}>SOPs</div>
          <div style={styles.hint}>Upload however you have them — PDFs, Word docs, scans, photos. Messy is fine.</div>
          <input style={styles.input} type="file" multiple onChange={handleFiles} accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" />
          {files.length > 0 && (
            <div style={styles.fileList}>
              <Paperclip size={13} />
              {files.length} file{files.length === 1 ? "" : "s"} selected: {files.map((f) => f.name).join(", ")}
            </div>
          )}

          <div style={styles.label}>Custom form or custom build request</div>
          <div style={styles.hint}>Optional — describe anything beyond the standard five you'd like built.</div>
          <textarea style={styles.textarea} value={form.customRequest} onChange={set("customRequest")} placeholder="e.g. a monthly fuel log, or a preventative maintenance tracker for our fleet" />
        </SectionCard>

        <SectionCard id="section-review" icon={ShieldCheck} title="Review & submit">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
            {[
              { label: "Company", value: form.companyName.trim() || "—" },
              { label: "Contact email", value: form.contactEmail.trim() || "—" },
              { label: "Sites listed", value: String(siteLines.length) },
              { label: "Team members", value: String(userLines.length) },
              { label: "SOP files", value: String(files.length) },
              { label: "Logo", value: logoFile ? "Attached" : "None" },
            ].map((row) => (
              <div key={row.label} style={{ background: theme.colors.surfaceSunken, borderRadius: theme.radius.sm, padding: "8px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: theme.colors.textMuted, textTransform: "uppercase", letterSpacing: 0.4 }}>{row.label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: theme.colors.textPrimary, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.value}</div>
              </div>
            ))}
          </div>

          <label style={styles.consentRow}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, accentColor: theme.colors.primary }}
            />
            <span style={styles.consentText}>
              I agree to FORA's{" "}
              <a href="https://forafieldsolutions.com/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.primaryDark, fontWeight: 600 }}>Privacy Policy</a>
              {" "}and{" "}
              <a href="https://forafieldsolutions.com/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.primaryDark, fontWeight: 600 }}>Terms of Use</a>
              {" "}on behalf of my company.
            </span>
          </label>

          {error && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              background: theme.colors.status.danger.bg, border: `1px solid ${theme.colors.status.danger.border}`,
              borderRadius: theme.radius.sm, padding: "10px 12px", marginTop: 16,
            }}>
              <TriangleAlert size={15} color={theme.colors.status.danger.text} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13, color: theme.colors.status.danger.text }}>{error}</div>
            </div>
          )}

          <button type="submit" style={{ ...styles.primaryBtn, opacity: submitting || !agreed ? 0.7 : 1 }} disabled={submitting || !agreed}>
            {uploading
              ? "Uploading files…"
              : submitting
                ? "Submitting…"
                : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                    <Upload size={16} /> {editToken ? "Resubmit" : "Submit"}
                  </span>
                )}
          </button>
        </SectionCard>
      </form>
    </div>
  );
}
