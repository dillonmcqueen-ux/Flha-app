import { useState, useRef, useEffect } from "react";
import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";
import { generateAndUploadNearMiss } from "./generateNearMissPDF";
import { useCustomFields, CustomFieldInputs } from "./customFields.jsx";
import { loadDraft, clearDraft, useDraftAutosave } from "./useDraftAutosave.js";
import { enqueueSubmission } from "./offlineQueue.js";
import { siteIdForName } from "./siteLookup.js";
import { fetchCompanyProfile, buildCompanyContextBlock } from "./companyProfile.js";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD } from "./theme";
import { buildFormStyles, disabledBg, bannerStyle, signatureCanvasStyle, docAccent } from "./FormKit";
import { ArrowLeft, AlertTriangle, Loader2, CheckCircle2, WifiOff, PenLine, Plus, Trash2, Check } from "lucide-react";

function newClientSubmissionId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Redoes the entire submission (signature + PDF upload + the final POST)
// from plain input data — used both by a live online submit() below and by
// offlineQueue's drainQueue() to resend a queued one later. `sig` is a
// data: URL string (from the signature canvas), not a File/Blob, so it's
// plain JSON and safe to persist in the queue. Throws on failure so the
// caller can tell success from failure. Exported so WorkerMenu.jsx can
// drain this form's queue without the component mounted.
export async function resubmitNearMiss(payload, clientSubmissionId, tokenForRequest) {
  const { reporterLabel, anonymous, site, siteId, occurredAt, involved, report, customFields, companyName, companyLogo, companyId, sig } = payload;

  let signatureReceipt = null;
  if (sig) {
    try {
      const blob = await (await fetch(sig)).blob();
      const filename = `nearmiss_${companyId}_${Date.now()}.png`.replace(/[^a-zA-Z0-9_.\-]/g, "");
      const { receipt } = await uploadViaSignedUrl({
        endpoint: "/api/reports", action: "create_upload_url", token: tokenForRequest,
        bucket: "signatures", filename, file: blob, contentType: "image/png",
      });
      signatureReceipt = receipt || null;
    } catch (e) { /* signature upload failure shouldn't block submission */ }
  }

  const pdfUrl = await generateAndUploadNearMiss({
    reporter: reporterLabel, site, occurredAt, involved, report, companyName, companyLogo, signatureDataUrl: sig, customFields, token: tokenForRequest,
  });

  let res;
  try {
    res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "nearmiss",
        action: "submit",
        token: tokenForRequest,
        clientSubmissionId,
        signatureReceipt,
        record: {
          reporter_name: reporterLabel,
          is_anonymous: anonymous,
          site,
          site_id: siteId || null,
          occurred_at: occurredAt,
          involved,
          report_json: { ...report, customFields },
          signed_by: reporterLabel,
          pdf_url: pdfUrl || null,
        },
      }),
    });
  } catch (networkErr) {
    networkErr.isNetworkFailure = true;
    throw networkErr;
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const err = new Error(errBody.error || `Save failed (${res.status})`);
    err.isServerError = true;
    err.status = res.status;
    throw err;
  }
  // The server reports whether the generated PDF actually got attached to
  // the saved record — see receiptWasDropped() in server-lib/uploadUrls.js.
  // Returned so the caller (a live submit, or offlineQueue's drainQueue)
  // can say so instead of the record quietly having no PDF link.
  return await res.json().catch(() => ({}));
}

// Reuses theme.js's risk scale — Low/Medium/High map 1:1 to colors.risk;
// "Critical" reuses the "extreme" (stop-work) tone, deliberately solid and
// alarming rather than translucent, same reasoning as Dashboard's risk badges.
const SEVERITY = (C) => ({
  Low: { color: C.risk.low.text, bg: C.risk.low.bg, border: C.risk.low.border },
  Medium: { color: C.risk.medium.text, bg: C.risk.medium.bg, border: C.risk.medium.border },
  High: { color: C.risk.high.text, bg: C.risk.high.bg, border: C.risk.high.border },
  Critical: { color: C.risk.extreme.text, bg: C.risk.extreme.bg, border: C.risk.extreme.border },
});
const SEVERITY_LEVELS = ["Low", "Medium", "High", "Critical"];

export default function NearMiss({ companyId, companyName, userName: loginUserName = "", onBack, onLogout, token = null }) {
  const [step, setStep] = useState("setup"); // setup | describe | review | sign | done
  const [reporter, setReporter] = useState(loginUserName);
  const [anonymous, setAnonymous] = useState(false);
  const [site, setSite] = useState("");
  const [sites, setSites] = useState([]);
  const [siteMode, setSiteMode] = useState("list");
  const [occurredAt, setOccurredAt] = useState("");
  const [involved, setInvolved] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [genError, setGenError] = useState(false);
  const [report, setReport] = useState(null); // { whatHappened, contributingFactors:[], potentialOutcome, correctiveActions:[] }
  const [companyLogo, setCompanyLogo] = useState("");
  // docs/scope-company-brain.md Phase 5 — null (cold start) is handled
  // gracefully by buildCompanyContextBlock.
  const [companyProfile, setCompanyProfile] = useState(null);
  const cf = useCustomFields(companyId, "nearmiss", token);

  // editing
  const [editField, setEditField] = useState(null);
  const [editValue, setEditValue] = useState("");

  // signature
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [signed, setSigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    async function load() {
      // Sites — via protected endpoint
      try {
        const siteRes = await fetch("/api/companydata", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_sites", token, companyId }),
        });
        const siteData = await siteRes.json();
        if (siteRes.ok) {
          setSites(siteData.sites || []);
          if (!siteData.sites || siteData.sites.length === 0) setSiteMode("other");
        } else {
          setSiteMode("other");
        }
      } catch (e) {
        setSiteMode("other");
      }

      // Company logo — via protected endpoint
      try {
        const logoRes = await fetch("/api/companydata", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_company_logo", token, companyId }),
        });
        const logoData = await logoRes.json();
        if (logoRes.ok) setCompanyLogo(logoData.logo_url || "");
      } catch (e) { /* leave logo blank if the request fails */ }

      // Company profile (docs/scope-company-brain.md Phase 5) — best-effort.
      setCompanyProfile(await fetchCompanyProfile(token, companyId));
    }
    load();
  }, [companyId, token]);

  // ── Offline resilience: local draft autosave (docs/scope-offline-capability.md Phase 0) ──
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    if (!companyId) return;
    const draft = loadDraft("nearmiss", companyId);
    if (draft && draft.step && draft.step !== "done") {
      if (draft.reporter) setReporter(draft.reporter);
      if (draft.anonymous) setAnonymous(draft.anonymous);
      if (draft.site) setSite(draft.site);
      if (draft.siteMode) setSiteMode(draft.siteMode);
      if (draft.occurredAt) setOccurredAt(draft.occurredAt);
      if (draft.involved) setInvolved(draft.involved);
      if (draft.description) setDescription(draft.description);
      if (draft.report) setReport(draft.report);
      setStep(draft.step);
    }
    setDraftRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useDraftAutosave(
    "nearmiss",
    companyId,
    { step, reporter, anonymous, site, siteMode, occurredAt, involved, description, report },
    draftRestored && !!companyId
  );

  const reporterLabel = () => anonymous ? "Anonymous" : reporter;

  // ── signature ────────────────────────────────────────────
  const getPos = (e) => {
    const c = canvasRef.current, r = c.getBoundingClientRect(), t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) };
  };
  const startDraw = (e) => { e.preventDefault(); drawingRef.current = true; const ctx = canvasRef.current.getContext("2d"); const { x, y } = getPos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const draw = (e) => { if (!drawingRef.current) return; e.preventDefault(); const ctx = canvasRef.current.getContext("2d"); const { x, y } = getPos(e); ctx.lineTo(x, y); ctx.strokeStyle = "#1E293B"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.stroke(); setHasSignature(true); };
  const endDraw = () => { drawingRef.current = false; };
  const clearSig = () => { const c = canvasRef.current; if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height); setHasSignature(false); };

  const generateReport = async () => {
    setLoading(true); setGenError(false);
    const prompt = `You are a construction safety officer helping a worker turn a raw near-miss description into a clean, professional near-miss incident report. A near miss is an event that could have caused injury, illness, or damage but did not.

Company: ${companyName}
Site: ${site}
When it occurred: ${occurredAt || "not specified"}
Who/what was involved: ${involved || "not specified"}
Worker's description of what happened: "${description}"

INSTRUCTIONS:
- Write a clear, factual, professional report based ONLY on what the worker described.
- GROUNDING RULE, which overrides every length guide below. Every statement of fact must trace back to the worker's description or the fields above. NEVER introduce a circumstance that was not stated — no weather or wind, no equipment age or condition, no maintenance history, no training or experience level, no fatigue, no time pressure, no staffing or supervision level, no lighting, no ground conditions, no procedure that was or wasn't followed.
- The counts below are MAXIMUMS, not targets. A thin description should produce a short report. An empty contributingFactors list is correct when the description does not identify any. Never pad a list to reach a number.
- "potentialOutcome" and "nextSteps" are the places forward-looking judgement is allowed, because they are assessments and recommendations rather than statements of fact about what occurred.
- Keep a neutral, non-blaming tone — near-miss reporting is about learning, not fault.
- "severity": rate the POTENTIAL severity — how bad it realistically could have been if it had gone wrong — as one of "Low", "Medium", "High", or "Critical". Critical = potential fatality or life-altering injury; High = potential serious injury; Medium = potential injury needing medical treatment; Low = minor potential injury.
- "severityReason": one short sentence explaining the rating.
- "whatHappened": a clear 2-4 sentence write-up of the event.
- "contributingFactors": conditions or actions stated in the description that led to the near miss (up to 4 short points). Return [] if the description does not identify any — do not infer them.
- "potentialOutcome": one or two sentences on what could realistically have happened.
- "immediateActions": what was or should have been done right away to make the situation safe (2-3 short points).
- "nextSteps": longer-term recommended actions to prevent recurrence (2-4 short points).
${buildCompanyContextBlock(companyProfile)}
Respond ONLY with valid JSON (no markdown, no backticks):
{
  "severity": "Low|Medium|High|Critical",
  "severityReason": "short reason",
  "whatHappened": "clear write-up",
  "contributingFactors": ["point", "point"],
  "potentialOutcome": "what could have happened",
  "immediateActions": ["action", "action"],
  "nextSteps": ["action", "action"]
}`;

    try {
      const res = await fetch("/api/generate-flha", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, token, documentType: "near_miss" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const text = data.content?.map(b => b.text || "").join("") || "";
      const a = text.indexOf("{"), b = text.lastIndexOf("}");
      if (a === -1 || b === -1) throw new Error("bad response");
      const parsed = JSON.parse(text.slice(a, b + 1));
      setReport({ ...parsed, ai_assisted: true });
      setStep("review");
    } catch (e) {
      setGenError(true);
    }
    setLoading(false);
  };

  // docs/scope-offline-capability.md Phase 2: if /api/generate-flha can't be
  // reached, let the worker continue instead of getting stuck — review is
  // already fully editable (add/edit/remove every list item), so the
  // fallback just needs an empty skeleton to fill in by hand.
  // ai_assisted:false flags the record so a supervisor knows it wasn't
  // AI-structured.
  const continueWithoutAI = () => {
    setReport({
      severity: "Medium", severityReason: "", whatHappened: description,
      contributingFactors: [], potentialOutcome: "", immediateActions: [], nextSteps: [],
      ai_assisted: false,
    });
    setGenError(false);
    setStep("review");
  };

  // editing helpers for list fields
  const updateList = (field, idx, val) => setReport(prev => ({ ...prev, [field]: prev[field].map((x, i) => i === idx ? val : x) }));
  const removeListItem = (field, idx) => setReport(prev => ({ ...prev, [field]: prev[field].filter((_, i) => i !== idx) }));
  const addListItem = (field) => setReport(prev => ({ ...prev, [field]: [...(prev[field] || []), ""] }));
  const updateText = (field, val) => setReport(prev => ({ ...prev, [field]: val }));

  // docs/scope-offline-capability.md Phase 1: a network-level failure gets
  // queued and retried automatically once back online instead of silently
  // discarding the report; a real server-side rejection shows an error and
  // lets the worker retry manually.
  const submit = async () => {
    setSigned(true);
    setSaving(true); setSaveError(false);
    const sig = hasSignature ? canvasRef.current.toDataURL("image/png") : null;
    const clientSubmissionId = newClientSubmissionId();
    const payload = { reporterLabel: reporterLabel(), anonymous, site, siteId: siteIdForName(sites, site, siteMode), occurredAt, involved, report, customFields: cf.entries(), companyName, companyLogo, companyId, sig };

    if (!navigator.onLine) {
      await enqueueSubmission("nearmiss", clientSubmissionId, payload);
      setSaving(false);
      clearDraft("nearmiss", companyId);
      setStep("queued");
      return;
    }

    try {
      await resubmitNearMiss(payload, clientSubmissionId, token);
      setSaving(false);
      clearDraft("nearmiss", companyId);
      setStep("done");
    } catch (e) {
      if (e.isServerError) {
        console.error("Near miss save failed:", e.message);
        setSaveError(true);
        setSaving(false);
        setSigned(false);
      } else {
        await enqueueSubmission("nearmiss", clientSubmissionId, payload);
        setSaving(false);
        clearDraft("nearmiss", companyId);
        setStep("queued");
      }
    }
  };

  const accent = docAccent(C, "nearmiss");
  const s = buildFormStyles(C, FONT, RAD, SHAD, accent);
  const SEV = SEVERITY(C);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {companyLogo ? <img src={companyLogo} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: "cover", background: "#fff" }} /> : <AlertTriangle size={26} strokeWidth={2} />}
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>Near Miss Report</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Report a close call</div>
          </div>
        </div>
        <button onClick={onBack} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><ArrowLeft size={15} strokeWidth={2.5} /> Menu</button>
      </div>

      {/* SETUP */}
      {step === "setup" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 12, color: C.text.primary }}>Report details</div>

          <div onClick={() => setAnonymous(!anonymous)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", background: anonymous ? C.status.warning.bg : C.panelInset, border: `1.5px solid ${anonymous ? C.status.warning.border : C.line}`, borderRadius: RAD.md, marginBottom: 14, cursor: "pointer" }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: anonymous ? C.status.warning.solid : "transparent", border: `1.5px solid ${anonymous ? C.status.warning.solid : C.lineStrong}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0 }}>{anonymous && <Check size={15} strokeWidth={3} />}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text.primary }}>Report anonymously</div>
              <div style={{ fontSize: 12, color: C.text.muted }}>Your name won't appear on the report</div>
            </div>
          </div>

          {!anonymous && (
            <>
              <label style={s.label}>Your name</label>
              <input
                style={{ ...s.input, ...(loginUserName ? { background: C.line, color: C.text.faint } : {}) }}
                placeholder="Reporter name" value={reporter}
                onChange={e => setReporter(e.target.value)}
                readOnly={!!loginUserName}
              />
            </>
          )}

          <label style={s.label}>Site / Location</label>
          {sites.length > 0 && siteMode === "list" ? (
            <select style={s.input} value={site} onChange={e => { if (e.target.value === "__other__") { setSiteMode("other"); setSite(""); } else setSite(e.target.value); }}>
              <option value="">Select a site…</option>
              {sites.map(st => <option key={st.id} value={st.name}>{st.name}</option>)}
              <option value="__other__">＋ Other site</option>
            </select>
          ) : (
            <input style={s.input} placeholder="e.g. Hwy 2 Project" value={site} onChange={e => setSite(e.target.value)} />
          )}

          <label style={s.label}>When did it happen?</label>
          <input style={s.input} placeholder="e.g. This morning around 9am" value={occurredAt} onChange={e => setOccurredAt(e.target.value)} />

          <label style={s.label}>Who / what was involved?</label>
          <input style={s.input} placeholder="e.g. Excavator and a ground worker" value={involved} onChange={e => setInvolved(e.target.value)} />

          <CustomFieldInputs cf={cf} labelStyle={s.label} inputStyle={s.input} />

          <button style={s.btn((site && (anonymous || reporter)) ? accent : disabledBg(C))} disabled={!site || (!anonymous && !reporter)} onClick={() => {
            const missing = cf.missingRequired();
            if (missing.length > 0) { alert(`Please fill in: ${missing.join(", ")}`); return; }
            setStep("describe");
          }}>Continue →</button>
        </div>
      )}

      {/* DESCRIBE */}
      {step === "describe" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: C.text.primary }}>What happened?</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 14 }}>Describe the near miss in your own words. The AI will structure it into a clean report.</div>
          <textarea style={{ ...s.input, minHeight: 140, resize: "vertical" }} placeholder="e.g. I was walking behind the excavator and the operator started to swing without seeing me. I stepped back just in time. There was no spotter and the horn didn't sound." value={description} onChange={e => setDescription(e.target.value)} />
          {genError && (
            <div style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Couldn't generate the report. Check your connection and try again, or continue and write it up yourself.</span>
            </div>
          )}
          <button style={s.btn(loading ? disabledBg(C) : description.trim() ? accent : disabledBg(C))} disabled={loading || !description.trim()} onClick={generateReport}>
            {loading ? <><Loader2 size={16} className="fora-spin" /> Structuring report…</> : "Generate Report"}
          </button>
          {genError && (
            <button style={s.ghost} onClick={continueWithoutAI}>Continue without AI — I'll fill this in myself</button>
          )}
          <button style={s.ghost} onClick={() => setStep("setup")}><ArrowLeft size={15} strokeWidth={2.5} /> Back</button>
        </div>
      )}

      {/* REVIEW */}
      {step === "review" && report && (
        <>
          {report.ai_assisted === false && (
            <div style={bannerStyle(C, RAD, "warning")}><AlertTriangle size={16} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Not AI-structured — fill in the details below yourself before submitting.</span>
            </div>
          )}
          <div style={s.card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 0.5 }}>Near Miss Incident Report</div>
            <div style={{ fontSize: 12, color: C.text.muted, marginTop: 2 }}>{reporterLabel()} · {site}{occurredAt ? ` · ${occurredAt}` : ""}</div>
          </div>

          {/* Severity index */}
          <div style={{ ...s.card, background: (SEV[report.severity] || SEV.Medium).bg, border: `1.5px solid ${(SEV[report.severity] || SEV.Medium).border}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.text.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Potential Severity</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {SEVERITY_LEVELS.map(lvl => {
                const sel = report.severity === lvl;
                const c = SEV[lvl];
                return (
                  <button key={lvl} onClick={() => updateText("severity", lvl)} style={{
                    flex: 1, padding: "11px 4px", borderRadius: RAD.sm, fontSize: 13, fontWeight: 800, cursor: "pointer",
                    border: `1.5px solid ${sel ? c.color : C.line}`,
                    background: sel ? c.bg : C.panelInset,
                    color: sel ? c.color : C.text.faint,
                  }}>{lvl}</button>
                );
              })}
            </div>
            {report.severityReason && <div style={{ fontSize: 13, color: C.text.body, fontStyle: "italic" }}>{report.severityReason}</div>}
            <div style={{ fontSize: 11, color: C.text.faint, marginTop: 6 }}>AI-suggested — tap to adjust</div>
          </div>

          <div style={s.card}>
            <div style={s.section}>What Happened</div>
            <textarea style={{ ...s.input, minHeight: 80, resize: "vertical", marginBottom: 0 }} value={report.whatHappened} onChange={e => updateText("whatHappened", e.target.value)} />
          </div>

          <div style={s.card}>
            <div style={s.section}>Contributing Factors</div>
            {(report.contributingFactors || []).map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
                <input style={{ ...s.input, marginBottom: 0 }} value={f} onChange={e => updateList("contributingFactors", i, e.target.value)} />
                <button onClick={() => removeListItem("contributingFactors", i)} style={{ background: C.status.danger.bg, color: C.status.danger.text, border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "10px 12px", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center" }}><Trash2 size={15} strokeWidth={2.25} /></button>
              </div>
            ))}
            <button onClick={() => addListItem("contributingFactors")} style={{ background: "transparent", border: "none", color: accent, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 6 }}><Plus size={15} strokeWidth={2.5} /> Add factor</button>
          </div>

          <div style={s.card}>
            <div style={s.section}>Potential Outcome</div>
            <textarea style={{ ...s.input, minHeight: 60, resize: "vertical", marginBottom: 0 }} value={report.potentialOutcome} onChange={e => updateText("potentialOutcome", e.target.value)} />
          </div>

          <div style={s.card}>
            <div style={s.section}>Immediate Actions Taken</div>
            {(report.immediateActions || []).map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
                <input style={{ ...s.input, marginBottom: 0 }} value={f} onChange={e => updateList("immediateActions", i, e.target.value)} />
                <button onClick={() => removeListItem("immediateActions", i)} style={{ background: C.status.danger.bg, color: C.status.danger.text, border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "10px 12px", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center" }}><Trash2 size={15} strokeWidth={2.25} /></button>
              </div>
            ))}
            <button onClick={() => addListItem("immediateActions")} style={{ background: "transparent", border: "none", color: accent, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 6 }}><Plus size={15} strokeWidth={2.5} /> Add action</button>
          </div>

          <div style={s.card}>
            <div style={s.section}>Recommended Next Steps</div>
            {(report.nextSteps || []).map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
                <input style={{ ...s.input, marginBottom: 0 }} value={f} onChange={e => updateList("nextSteps", i, e.target.value)} />
                <button onClick={() => removeListItem("nextSteps", i)} style={{ background: C.status.danger.bg, color: C.status.danger.text, border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "10px 12px", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center" }}><Trash2 size={15} strokeWidth={2.25} /></button>
              </div>
            ))}
            <button onClick={() => addListItem("nextSteps")} style={{ background: "transparent", border: "none", color: accent, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 6 }}><Plus size={15} strokeWidth={2.5} /> Add step</button>
          </div>

          <button style={s.btn(accent)} onClick={() => setStep("sign")}>Continue to Sign →</button>
          <button style={s.ghost} onClick={() => setStep("describe")}><ArrowLeft size={15} strokeWidth={2.5} /> Back</button>
        </>
      )}

      {/* SIGN */}
      {step === "sign" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, color: C.text.primary, display: "flex", alignItems: "center", gap: 8 }}><PenLine size={18} strokeWidth={2.25} color={accent} /> {anonymous ? "Confirm & Submit" : "Sign & Submit"}</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 14 }}>{anonymous ? "This report will be submitted anonymously." : "Sign to confirm this report is accurate."}</div>

          {!anonymous && (
            <>
              <label style={s.label}>Signature</label>
              <div style={{ fontSize: 11, color: C.text.faint, marginBottom: 6, lineHeight: 1.4 }}>By signing, you take full responsibility for the accuracy of this document — FORA is not liable for any errors or omissions.</div>
              <div style={{ position: "relative", marginBottom: 6 }}>
                <canvas ref={canvasRef} width={600} height={160}
                  style={{ ...signatureCanvasStyle(C, RAD), height: 130 }}
                  onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                  onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
                {!hasSignature && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 14, pointerEvents: "none" }}>Sign here</div>}
              </div>
              <div style={{ textAlign: "right", marginBottom: 12 }}>
                <button onClick={clearSig} style={{ background: "transparent", border: "none", color: C.text.muted, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Clear</button>
              </div>
            </>
          )}

          {saveError && (
            <div style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Couldn't save this report. Check your connection and try again.</span>
            </div>
          )}
          <button style={s.btn(saving ? disabledBg(C) : (anonymous || hasSignature) ? C.status.success.solid : disabledBg(C))} disabled={saving || (!anonymous && !hasSignature)} onClick={submit}>
            {saving ? <><Loader2 size={16} className="fora-spin" /> Submitting…</> : saveError ? "Try Again" : <><CheckCircle2 size={16} strokeWidth={2.25} /> {anonymous ? "Submit Report" : "Sign & Submit Report"}</>}
          </button>
          <button style={s.ghost} onClick={() => setStep("review")}><ArrowLeft size={15} strokeWidth={2.5} /> Back</button>
        </div>
      )}

      {/* QUEUED — offline at submit time (docs/scope-offline-capability.md Phase 1) */}
      {step === "queued" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <WifiOff size={48} strokeWidth={1.75} color={C.status.warning.text} style={{ marginBottom: 12 }} />
            <div style={{ fontWeight: 800, fontSize: 22, color: C.text.primary, marginBottom: 6 }}>Saved — No Signal</div>
            <div style={{ fontSize: 14, color: C.text.muted, marginBottom: 8 }}>{site} · {reporterLabel()}</div>
            <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 20 }}>This report is saved on your device and will send automatically the next time you're back online — no need to redo it.</div>
            <button style={s.btn(accent)} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}

      {/* DONE */}
      {step === "done" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <CheckCircle2 size={48} strokeWidth={1.75} color={C.status.success.text} style={{ marginBottom: 12 }} />
            <div style={{ fontWeight: 800, fontSize: 22, color: C.text.primary, marginBottom: 6 }}>Near Miss Reported</div>
            <div style={{ fontSize: 14, color: C.text.muted, marginBottom: 8 }}>{site} · {reporterLabel()}</div>
            <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 20 }}>Thank you for reporting. Near-miss reports help prevent injuries before they happen.</div>
            <button style={s.btn(accent)} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}
      <style>{"@keyframes fora-spin { to { transform: rotate(360deg); } } .fora-spin { animation: fora-spin 0.8s linear infinite; }"}</style>
    </div>
  );
}
