import { useState, useRef, useEffect } from "react";
import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";
import { generateAndUploadIncident } from "./generateIncidentPDF";
import { useCustomFields, CustomFieldInputs } from "./customFields.jsx";
import { loadDraft, clearDraft, useDraftAutosave } from "./useDraftAutosave.js";
import { enqueueSubmission, storePhoto, getPhoto, deletePhoto, totalPhotoBytes } from "./offlineQueue.js";
import { fetchCompanyProfile, buildCompanyContextBlock } from "./companyProfile.js";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD } from "./theme";
import { buildFormStyles, disabledBg, bannerStyle, signatureCanvasStyle, docAccent } from "./FormKit";
import { ArrowLeft, Ambulance, WifiOff, X, Camera, AlertTriangle, CheckCircle2, Loader2, PenLine, Trash2, Plus } from "lucide-react";

function newClientSubmissionId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// docs/scope-offline-capability.md Phase 3: caps total pending offline
// photo storage so a multi-day offline stretch on a remote site can't
// silently exhaust device storage. ~25-30MB is roughly 15-20 phone photos —
// a fixed number is simpler to reason about and test than querying actual
// device storage via navigator.storage.estimate().
const PHOTO_BUDGET_BYTES = 28 * 1024 * 1024;

// Uploads a single pending (offline-stored) photo now that there's
// connectivity, and cleans up its local blob once confirmed-uploaded.
// Shared by the live component (when a "queued" photo gets its own retry)
// and resubmitIncident (when the whole record was queued and is now being
// drained). Throws on failure so the caller can tell success from failure —
// deliberately doesn't delete the blob on failure, so it stays available
// for the next attempt.
function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    try {
      const r = new FileReader();
      r.onloadend = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    } catch (e) { resolve(null); }
  });
}

// Returns both halves on purpose: `url` is what generateAndUploadIncident
// fetches to embed the photo into the PDF, `receipt` is what the server
// accepts for the photo_urls column. The browser can't be trusted to name a
// storage path, so the URL never leaves the browser (see
// server-lib/uploadUrls.js).
async function uploadPendingPhoto(pendingPhotoId, companyId, tokenForRequest) {
  const stored = await getPhoto(pendingPhotoId);
  if (!stored) return null; // already uploaded and cleaned up, or never existed — nothing to do
  const ext = (stored.contentType || "").split("/")[1] || "jpg";
  const filename = `incident_${companyId}_${pendingPhotoId}.${ext}`.replace(/[^a-zA-Z0-9_.\-]/g, "");
  const { publicUrl, receipt } = await uploadViaSignedUrl({
    endpoint: "/api/reports", action: "create_upload_url", token: tokenForRequest,
    bucket: "incident-photos", filename, file: stored.blob, contentType: stored.contentType,
  });
  // Read the bytes before deleting the local copy: the PDF needs them, and
  // the uploaded photo lives in a PRIVATE bucket that can't be fetched back
  // from an unsigned URL.
  const dataUrl = await blobToDataUrl(stored.blob);
  await deletePhoto(pendingPhotoId);
  if (!publicUrl) return null;
  return { url: publicUrl, receipt: receipt || null, dataUrl };
}

// Redoes the entire submission (signature + PDF upload + the final POST)
// from plain input data — used both by a live online submit() below and by
// offlineQueue's drainQueue() to resend a queued one later. `photoUrls`
// carries already-uploaded photo URLs (strings); `pendingPhotoIds` carries
// local IDs of photos whose upload couldn't complete earlier (offline, or a
// bad moment for the connection) — resubmitIncident uploads each of those
// now that there's connectivity, before assembling the final photo list.
// `sig` is a data: URL string, not a File/Blob, so it's plain JSON and safe
// to persist in the queue.
export async function resubmitIncident(payload, clientSubmissionId, tokenForRequest) {
  const { reporter, site, occurredAt, incidentType, injuredPerson, bodyPart, treatment, medicalAttention, witnesses, evidence, customFields, report, companyName, companyLogo, companyId, sig, photoUrls, photoReceipts, photoImages, pendingPhotoIds } = payload;

  // `photoUrls` and `photoReceipts` are parallel arrays, same pattern
  // api/login.js's onboarding flow already uses for `paths`/`pathTokens`.
  // A payload queued before receipts existed carries urls and no receipts;
  // those photos still make it into the PDF, but the server has nothing to
  // verify so they won't be listed on the record separately.
  const allPhotoUrls = [...(photoUrls || [])];
  const allPhotoReceipts = [...(photoReceipts || [])];
  // Parallel to allPhotoUrls. A slot is undefined when the browser doesn't
  // hold that photo's bytes — a submission queued online-uploaded photos and
  // drained later — and the generator falls back to fetching that one.
  const allPhotoImages = [...(photoImages || [])];
  for (const id of (pendingPhotoIds || [])) {
    const uploaded = await uploadPendingPhoto(id, companyId, tokenForRequest);
    if (uploaded) {
      allPhotoImages[allPhotoUrls.length] = uploaded.dataUrl || undefined;
      allPhotoUrls.push(uploaded.url);
      if (uploaded.receipt) allPhotoReceipts.push(uploaded.receipt);
    }
  }

  let signatureReceipt = null;
  if (sig) {
    try {
      const blob = await (await fetch(sig)).blob();
      const filename = `incident_${companyId}_${Date.now()}.png`.replace(/[^a-zA-Z0-9_.\-]/g, "");
      const { receipt } = await uploadViaSignedUrl({
        endpoint: "/api/reports", action: "create_upload_url", token: tokenForRequest,
        bucket: "signatures", filename, file: blob, contentType: "image/png",
      });
      signatureReceipt = receipt || null;
    } catch (e) { /* signature upload failure shouldn't block submission */ }
  }

  const pdfUrl = await generateAndUploadIncident({
    reporter, site, occurredAt, incidentType, injuredPerson, bodyPart, treatment, medicalAttention, witnesses, evidence, customFields,
    report, companyName, companyLogo, signatureDataUrl: sig, photoUrls: allPhotoUrls,
    photoImages: allPhotoImages, token: tokenForRequest,
  });

  let res;
  try {
    res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "incident",
        action: "submit",
        token: tokenForRequest,
        clientSubmissionId,
        photoReceipts: allPhotoReceipts,
        signatureReceipt,
        record: {
          reporter_name: reporter,
          site, occurred_at: occurredAt, incident_type: incidentType,
          injured_person: injuredPerson, body_part: bodyPart, treatment,
          medical_attention: medicalAttention, witnesses, evidence,
          report_json: { ...report, customFields },
          signed_by: reporter,
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
    throw err;
  }
  // The server reports whether the generated PDF actually got attached to
  // the saved record — see receiptWasDropped() in server-lib/uploadUrls.js.
  // Returned so the caller (a live submit, or offlineQueue's drainQueue)
  // can say so instead of the record quietly having no PDF link.
  return await res.json().catch(() => ({}));
}

const INCIDENT_TYPES = [
  "Injury / Illness",
  "Property / Equipment Damage",
  "Environmental Spill",
  "Vehicle Incident",
  "Near Miss Escalated",
];

// Reuses theme.js's risk scale — see the matching note in NearMiss.jsx.
const SEVERITY = (C) => ({
  Low: { color: C.risk.low.text, bg: C.risk.low.bg, border: C.risk.low.border },
  Medium: { color: C.risk.medium.text, bg: C.risk.medium.bg, border: C.risk.medium.border },
  High: { color: C.risk.high.text, bg: C.risk.high.bg, border: C.risk.high.border },
  Critical: { color: C.risk.extreme.text, bg: C.risk.extreme.bg, border: C.risk.extreme.border },
});
const SEVERITY_LEVELS = ["Low", "Medium", "High", "Critical"];

export default function Incident({ companyId, companyName, userName: loginUserName = "", onBack, onLogout, token = null }) {
  const [step, setStep] = useState("setup"); // setup | details | describe | review | sign | done
  const [reporter, setReporter] = useState(loginUserName);
  const [site, setSite] = useState("");
  const [sites, setSites] = useState([]);
  const [siteMode, setSiteMode] = useState("list");
  const [occurredAt, setOccurredAt] = useState("");
  const [incidentType, setIncidentType] = useState("Injury / Illness");

  const [injuredPerson, setInjuredPerson] = useState("");
  const [bodyPart, setBodyPart] = useState("");
  const [treatment, setTreatment] = useState("");
  const [medicalAttention, setMedicalAttention] = useState("None");
  const [witnesses, setWitnesses] = useState("");
  const [evidence, setEvidence] = useState("");

  const [photos, setPhotos] = useState([]); // [{ id, file, previewUrl, uploading, uploadedUrl, pending, pendingPhotoId, error }]
  const [uploadingCount, setUploadingCount] = useState(0);
  const [photoBudgetError, setPhotoBudgetError] = useState("");

  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [genError, setGenError] = useState(false);
  const [report, setReport] = useState(null);
  const [companyLogo, setCompanyLogo] = useState("");
  // docs/scope-company-brain.md Phase 5 — null (cold start) is handled
  // gracefully by buildCompanyContextBlock.
  const [companyProfile, setCompanyProfile] = useState(null);
  const cf = useCustomFields(companyId, "incident", token);

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

  // ── Offline resilience: local draft autosave (docs/scope-offline-capability.md Phase 0/3) ──
  // Photos: only metadata is saved to the draft (never the File object —
  // it doesn't survive JSON.stringify, and its blob: preview URL doesn't
  // survive a reload either). A `pending` photo's actual blob lives
  // separately in offlineQueue.js's IndexedDB `photos` store (Phase 3),
  // keyed by pendingPhotoId — restoring one means loading that blob back
  // and regenerating a fresh previewUrl via URL.createObjectURL. An
  // already-`uploadedUrl` photo just needs its remote URL back — that
  // already works fine as an <img> src, no blob needed. A hard `error`
  // entry (upload failed AND storing the blob failed too — IndexedDB
  // itself unavailable) has nothing left to restore and is dropped.
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    async function restore() {
      const draft = loadDraft("incident", companyId);
      if (draft && draft.step && draft.step !== "done") {
        if (draft.reporter) setReporter(draft.reporter);
        if (draft.site) setSite(draft.site);
        if (draft.siteMode) setSiteMode(draft.siteMode);
        if (draft.occurredAt) setOccurredAt(draft.occurredAt);
        if (draft.incidentType) setIncidentType(draft.incidentType);
        if (draft.injuredPerson) setInjuredPerson(draft.injuredPerson);
        if (draft.bodyPart) setBodyPart(draft.bodyPart);
        if (draft.treatment) setTreatment(draft.treatment);
        if (draft.medicalAttention) setMedicalAttention(draft.medicalAttention);
        if (draft.witnesses) setWitnesses(draft.witnesses);
        if (draft.evidence) setEvidence(draft.evidence);
        if (draft.description) setDescription(draft.description);
        if (draft.report) setReport(draft.report);
        if (draft.photosMeta && draft.photosMeta.length > 0) {
          const restoredPhotos = [];
          for (const meta of draft.photosMeta) {
            if (meta.uploadedUrl) {
              restoredPhotos.push({ id: meta.id, file: null, previewUrl: meta.uploadedUrl, uploading: false, uploadedUrl: meta.uploadedUrl, pending: false, pendingPhotoId: null, error: false });
            } else if (meta.pending && meta.pendingPhotoId) {
              const stored = await getPhoto(meta.pendingPhotoId);
              if (stored) {
                restoredPhotos.push({ id: meta.id, file: null, previewUrl: URL.createObjectURL(stored.blob), uploading: false, uploadedUrl: null, pending: true, pendingPhotoId: meta.pendingPhotoId, error: false });
              }
              // if the blob is missing (cleared storage, etc.) there's nothing to restore — skip silently
            }
          }
          if (!cancelled && restoredPhotos.length > 0) setPhotos(restoredPhotos);
        }
        setStep(draft.step);
      }
      if (!cancelled) setDraftRestored(true);
    }
    restore();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useDraftAutosave(
    "incident",
    companyId,
    {
      step, reporter, site, siteMode, occurredAt, incidentType, injuredPerson, bodyPart, treatment, medicalAttention, witnesses, evidence, description, report,
      photosMeta: photos.map(p => ({ id: p.id, uploadedUrl: p.uploadedUrl, pending: p.pending, pendingPhotoId: p.pendingPhotoId })),
    },
    draftRestored && !!companyId
  );

  const getPos = (e) => {
    const c = canvasRef.current, r = c.getBoundingClientRect(), t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) };
  };
  const startDraw = (e) => { e.preventDefault(); drawingRef.current = true; const ctx = canvasRef.current.getContext("2d"); const { x, y } = getPos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const draw = (e) => { if (!drawingRef.current) return; e.preventDefault(); const ctx = canvasRef.current.getContext("2d"); const { x, y } = getPos(e); ctx.lineTo(x, y); ctx.strokeStyle = "#1E293B"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.stroke(); setHasSignature(true); };
  const endDraw = () => { drawingRef.current = false; };
  const clearSig = () => { const c = canvasRef.current; if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height); setHasSignature(false); };

  // ── photo upload ────────────────────────────────────────
  const handlePhotoSelect = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setPhotoBudgetError("");

    const newEntries = files.map(file => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      uploading: true,
      uploadedUrl: null,
      pending: false,
      pendingPhotoId: null,
      error: false,
    }));
    setPhotos(prev => [...prev, ...newEntries]);
    setUploadingCount(prev => prev + newEntries.length);

    for (const entry of newEntries) {
      try {
        const ext = (entry.file.name.split(".").pop() || "jpg").toLowerCase();
        const filename = `incident_${companyId}_${entry.id}.${ext}`.replace(/[^a-zA-Z0-9_.\-]/g, "");
        const { publicUrl, receipt } = await uploadViaSignedUrl({
          endpoint: "/api/reports", action: "create_upload_url", token,
          bucket: "incident-photos", filename, file: entry.file, contentType: entry.file.type,
        });
        setPhotos(prev => prev.map(p => p.id === entry.id
          ? { ...p, uploading: false, uploadedUrl: publicUrl || null, uploadedReceipt: receipt || null }
          : p));
      } catch (e) {
        // docs/scope-offline-capability.md Phase 3: an immediate upload
        // failure (offline, or just a bad moment for the connection) used
        // to silently drop the photo entirely — nothing blocked the worker
        // from submitting without it, and it was gone. Now the blob is
        // persisted locally instead, so submit() -> resubmitIncident can
        // upload it for real once the incident is actually submitted (or,
        // if the whole record ends up queued too, once that gets drained).
        const budgetUsed = await totalPhotoBytes();
        if (budgetUsed + entry.file.size > PHOTO_BUDGET_BYTES) {
          setPhotoBudgetError("Photo storage on this device is full from previously queued photos — reconnect to let them sync before adding more.");
          setPhotos(prev => prev.map(p => p.id === entry.id ? { ...p, uploading: false, error: true } : p));
        } else {
          try {
            const pendingPhotoId = await storePhoto(entry.file, entry.file.type);
            setPhotos(prev => prev.map(p => p.id === entry.id ? { ...p, uploading: false, pending: true, pendingPhotoId } : p));
          } catch (storeErr) {
            // IndexedDB itself unavailable (private browsing, quota) — genuinely nothing left to fall back to.
            setPhotos(prev => prev.map(p => p.id === entry.id ? { ...p, uploading: false, error: true } : p));
          }
        }
      }
      setUploadingCount(prev => Math.max(0, prev - 1));
    }
  };

  const removePhoto = (id) => {
    setPhotos(prev => {
      const target = prev.find(p => p.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      if (target?.pendingPhotoId) deletePhoto(target.pendingPhotoId).catch(() => {});
      return prev.filter(p => p.id !== id);
    });
  };

  const uploadedPhotoUrls = () => photos.filter(p => p.uploadedUrl).map(p => p.uploadedUrl);
  const uploadedPhotoReceipts = () => photos.filter(p => p.uploadedUrl && p.uploadedReceipt).map(p => p.uploadedReceipt);
  // The File is still in memory here, which is the only way the PDF can show
  // the photo: incident-photos is a private bucket, so the public-shaped URL
  // the upload hands back is not fetchable. Parallel to uploadedPhotoUrls().
  const uploadedPhotoImages = () => Promise.all(
    photos.filter(p => p.uploadedUrl).map(p => (p.file ? blobToDataUrl(p.file) : Promise.resolve(undefined)))
  );
  const pendingPhotoIds = () => photos.filter(p => p.pending && p.pendingPhotoId).map(p => p.pendingPhotoId);

  const generateReport = async () => {
    setLoading(true); setGenError(false);
    const prompt = `You are a construction safety officer helping a worker turn a raw incident description into a formal, professional incident report. An incident is an event that HAS caused injury, illness, damage, or an environmental release.

Company: ${companyName}
Site: ${site}
When it occurred: ${occurredAt || "not specified"}
Incident type: ${incidentType}
Injured person: ${injuredPerson || "n/a"}
Body part affected: ${bodyPart || "n/a"}
Treatment given: ${treatment || "n/a"}
Medical attention: ${medicalAttention}
Witnesses: ${witnesses || "none listed"}
Evidence on file: ${evidence || "none listed"}
Worker's description of what happened: "${description}"

INSTRUCTIONS:
- Write a clear, factual, professional incident report based ONLY on what was described. Do not invent specifics, but you may reasonably infer contributing factors and sensible corrective actions.
- Keep a neutral, non-blaming, objective tone suitable for a formal record that may be reviewed by management, WCB/WSIB, or regulators.
- "severity": rate the ACTUAL severity of this incident as "Low", "Medium", "High", or "Critical". Critical = fatality or life-altering injury/major loss; High = serious injury or significant damage; Medium = injury needing medical treatment or moderate damage; Low = minor injury/first aid or minor damage.
- "severityReason": one short sentence explaining the rating.
- "summary": a clear 2-4 sentence factual account of the incident.
- "sequenceOfEvents": the step-by-step sequence leading to and during the incident (3-5 short points).
- "contributingFactors": conditions or actions that contributed (2-4 short points).
- "rootCause": the underlying root cause, one or two sentences.
- "immediateActions": what was done right away in response (2-3 short points).
- "correctiveActions": longer-term actions to prevent recurrence (2-4 short points).
${buildCompanyContextBlock(companyProfile)}
Respond ONLY with valid JSON (no markdown, no backticks):
{
  "severity": "Low|Medium|High|Critical",
  "severityReason": "short reason",
  "summary": "factual account",
  "sequenceOfEvents": ["step", "step"],
  "contributingFactors": ["point", "point"],
  "rootCause": "underlying cause",
  "immediateActions": ["action", "action"],
  "correctiveActions": ["action", "action"]
}`;

    try {
      const res = await fetch("/api/generate-flha", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, token }),
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
  // already fully editable (add/edit/remove every list item via
  // ListEditor), so the fallback just needs an empty skeleton to fill in by
  // hand. ai_assisted:false flags the record so a supervisor knows it
  // wasn't AI-structured.
  const continueWithoutAI = () => {
    setReport({
      severity: "Medium", severityReason: "", summary: description,
      sequenceOfEvents: [], contributingFactors: [], rootCause: "",
      immediateActions: [], correctiveActions: [],
      ai_assisted: false,
    });
    setGenError(false);
    setStep("review");
  };

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
    const photoUrls = uploadedPhotoUrls();
    const photoReceipts = uploadedPhotoReceipts();
    const pendingIds = pendingPhotoIds();
    const clientSubmissionId = newClientSubmissionId();
    const payload = { reporter, site, occurredAt, incidentType, injuredPerson, bodyPart, treatment, medicalAttention, witnesses, evidence, customFields: cf.entries(), report, companyName, companyLogo, companyId, sig, photoUrls, photoReceipts, pendingPhotoIds: pendingIds };
    // Deliberately NOT part of `payload`, so it never reaches the offline
    // queue: these are full-size photos as base64, and the queue already
    // budgets 28MB for pending photo blobs. A queued submission therefore
    // drains without them, and its PDF is missing those photos — but the
    // record and the photos themselves are safe in storage, and a supervisor
    // regenerating from the dashboard gets them, because the dashboard's
    // list endpoint hands back signed URLs that ARE fetchable.
    const photoImages = await uploadedPhotoImages();

    if (!navigator.onLine) {
      await enqueueSubmission("incident", clientSubmissionId, payload);
      setSaving(false);
      clearDraft("incident", companyId);
      setStep("queued");
      return;
    }

    try {
      await resubmitIncident({ ...payload, photoImages }, clientSubmissionId, token);
      setSaving(false);
      clearDraft("incident", companyId);
      setStep("done");
    } catch (e) {
      if (e.isServerError) {
        console.error("Incident save failed:", e.message);
        setSaveError(true);
        setSaving(false);
        setSigned(false);
      } else {
        await enqueueSubmission("incident", clientSubmissionId, payload);
        setSaving(false);
        clearDraft("incident", companyId);
        setStep("queued");
      }
    }
  };

  const accent = docAccent(C, "incident");
  const s = buildFormStyles(C, FONT, RAD, SHAD, accent);
  const SEV = SEVERITY(C);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {companyLogo ? <img src={companyLogo} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: "cover", background: "#fff" }} /> : <Ambulance size={26} strokeWidth={2} />}
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>Incident Report</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Formal incident record</div>
          </div>
        </div>
        <button onClick={onBack} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><ArrowLeft size={15} strokeWidth={2.5} /> Menu</button>
      </div>

      {/* SETUP */}
      {step === "setup" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 12, color: C.text.primary }}>Incident details</div>

          <label style={s.label}>Your name</label>
          <input
            style={{ ...s.input, ...(loginUserName ? { background: C.line, color: C.text.faint } : {}) }}
            placeholder="Reporter name" value={reporter}
            onChange={e => setReporter(e.target.value)}
            readOnly={!!loginUserName}
          />

          <label style={s.label}>Incident type</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
            {INCIDENT_TYPES.map(t => (
              <button key={t} onClick={() => setIncidentType(t)} style={{ padding: "11px 12px", borderRadius: RAD.sm, fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "left", border: `1.5px solid ${incidentType === t ? accent : C.line}`, background: incidentType === t ? C.status.danger.bg : C.panelInset, color: incidentType === t ? C.status.danger.text : C.text.faint }}>{t}</button>
            ))}
          </div>

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
          <input style={s.input} placeholder="e.g. Today at 2:30pm" value={occurredAt} onChange={e => setOccurredAt(e.target.value)} />

          <button style={s.btn((reporter && site) ? accent : disabledBg(C))} disabled={!reporter || !site} onClick={() => setStep("details")}>Continue →</button>
        </div>
      )}

      {/* DETAILS */}
      {step === "details" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: C.text.primary }}>People & evidence</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 14 }}>Fill in what applies. Leave blank anything not relevant to this incident.</div>

          <label style={s.label}>Injured person (if any)</label>
          <input style={s.input} placeholder="Name of injured person" value={injuredPerson} onChange={e => setInjuredPerson(e.target.value)} />

          <label style={s.label}>Body part affected</label>
          <input style={s.input} placeholder="e.g. Left hand" value={bodyPart} onChange={e => setBodyPart(e.target.value)} />

          <label style={s.label}>Treatment given</label>
          <input style={s.input} placeholder="e.g. Cleaned and bandaged on site" value={treatment} onChange={e => setTreatment(e.target.value)} />

          <label style={s.label}>Medical attention required?</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {["None", "First Aid", "Medical Aid", "Hospital"].map(m => (
              <button key={m} onClick={() => setMedicalAttention(m)} style={{ flex: "1 1 auto", padding: "10px 6px", borderRadius: RAD.sm, fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${medicalAttention === m ? accent : C.line}`, background: medicalAttention === m ? C.status.danger.bg : C.panelInset, color: medicalAttention === m ? C.status.danger.text : C.text.faint }}>{m}</button>
            ))}
          </div>

          <label style={s.label}>Witnesses</label>
          <input style={s.input} placeholder="Names of anyone who saw it" value={witnesses} onChange={e => setWitnesses(e.target.value)} />

          <label style={s.label}>Evidence on file</label>
          <textarea style={{ ...s.input, minHeight: 70, resize: "vertical" }} placeholder="Describe any physical evidence not covered by the photos below" value={evidence} onChange={e => setEvidence(e.target.value)} />

          <label style={s.label}>Photos</label>
          <div style={{ fontSize: 12, color: C.text.faint, marginBottom: 10 }}>Add photos of the scene, damage, or injury. Uploads automatically.</div>

          {photos.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 8, marginBottom: 12 }}>
              {photos.map(p => (
                <div key={p.id} style={{ position: "relative", aspectRatio: "1", borderRadius: RAD.sm, overflow: "hidden", border: `1.5px solid ${C.line}`, background: C.panelInset }}>
                  <img src={p.previewUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: p.uploading ? 0.5 : 1 }} />
                  {p.uploading && (
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.text.body }}><Loader2 size={16} className="fora-spin" /></div>
                  )}
                  {p.pending && (
                    <div style={{ position: "absolute", inset: 0, background: "rgba(245,158,11,0.55)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", textAlign: "center", padding: 4, gap: 2 }}><WifiOff size={13} strokeWidth={2.25} /> Queued</div>
                  )}
                  {p.error && (
                    <div style={{ position: "absolute", inset: 0, background: "rgba(239,68,68,0.7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}>Failed</div>
                  )}
                  <button onClick={() => removePhoto(p.id)} style={{ position: "absolute", top: 3, right: 3, width: 22, height: 22, borderRadius: "50%", background: "#00000090", color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={13} strokeWidth={2.5} /></button>
                </div>
              ))}
            </div>
          )}

          {photos.some(p => p.pending) && (
            <div style={{ fontSize: 12, color: C.status.warning.text, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><WifiOff size={13} strokeWidth={2.25} /> Queued photos will upload automatically once you're back online — no need to redo them.</div>
          )}
          {photoBudgetError && (
            <div style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1 }} /><span>{photoBudgetError}</span></div>
          )}

          <label style={{ display: "block", background: C.panelInset, color: C.text.body, border: `1.5px dashed ${C.lineStrong}`, borderRadius: RAD.md, padding: "15px", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "center", marginBottom: 14 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Camera size={16} strokeWidth={2.25} /> Add photos</span>
            <input type="file" accept="image/*" multiple capture="environment" style={{ display: "none" }} onChange={e => { handlePhotoSelect(e.target.files); e.target.value = ""; }} />
          </label>

          <CustomFieldInputs cf={cf} labelStyle={s.label} inputStyle={s.input} />

          <button style={s.btn(uploadingCount > 0 ? disabledBg(C) : accent)} disabled={uploadingCount > 0} onClick={() => {
            const missing = cf.missingRequired();
            if (missing.length > 0) { alert(`Please fill in: ${missing.join(", ")}`); return; }
            setStep("describe");
          }}>
            {uploadingCount > 0 ? <><Loader2 size={16} className="fora-spin" /> {`Uploading ${uploadingCount} photo${uploadingCount > 1 ? "s" : ""}…`}</> : "Continue →"}
          </button>
          <button style={s.ghost} onClick={() => setStep("setup")}><ArrowLeft size={15} strokeWidth={2.5} /> Back</button>
        </div>
      )}

      {/* DESCRIBE */}
      {step === "describe" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: C.text.primary }}>What happened?</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 14 }}>Describe the incident in your own words — what led up to it, what happened, and what was done. The AI will structure it into a formal report.</div>
          <textarea style={{ ...s.input, minHeight: 150, resize: "vertical" }} placeholder="e.g. Worker was carrying a sheet of plywood when a gust of wind caught it. He lost his grip and the edge struck his forearm, causing a deep cut. We stopped work, applied first aid, and drove him to the clinic for stitches." value={description} onChange={e => setDescription(e.target.value)} />
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
          <button style={s.ghost} onClick={() => setStep("details")}><ArrowLeft size={15} strokeWidth={2.5} /> Back</button>
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
            <div style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 0.5 }}>{incidentType} — Incident Report</div>
            <div style={{ fontSize: 12, color: C.text.muted, marginTop: 2 }}>{reporter} · {site}{occurredAt ? ` · ${occurredAt}` : ""}</div>
          </div>

          {/* Severity */}
          <div style={{ ...s.card, background: (SEV[report.severity] || SEV.Medium).bg, border: `1.5px solid ${(SEV[report.severity] || SEV.Medium).border}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.text.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Incident Severity</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {SEVERITY_LEVELS.map(lvl => {
                const sel = report.severity === lvl;
                const c = SEV[lvl];
                return (
                  <button key={lvl} onClick={() => updateText("severity", lvl)} style={{ flex: 1, padding: "11px 4px", borderRadius: RAD.sm, fontSize: 13, fontWeight: 800, cursor: "pointer", border: `1.5px solid ${sel ? c.color : C.line}`, background: sel ? c.bg : C.panelInset, color: sel ? c.color : C.text.faint }}>{lvl}</button>
                );
              })}
            </div>
            {report.severityReason && <div style={{ fontSize: 13, color: C.text.body, fontStyle: "italic" }}>{report.severityReason}</div>}
            <div style={{ fontSize: 11, color: C.text.faint, marginTop: 6 }}>AI-suggested — tap to adjust</div>
          </div>

          <div style={s.card}>
            <div style={s.section}>Summary</div>
            <textarea style={{ ...s.input, minHeight: 80, resize: "vertical", marginBottom: 0 }} value={report.summary} onChange={e => updateText("summary", e.target.value)} />
          </div>

          <ListEditor s={s} C={C} accent={accent} title="Sequence of Events" field="sequenceOfEvents" report={report} updateList={updateList} removeListItem={removeListItem} addListItem={addListItem} />
          <ListEditor s={s} C={C} accent={accent} title="Contributing Factors" field="contributingFactors" report={report} updateList={updateList} removeListItem={removeListItem} addListItem={addListItem} />

          <div style={s.card}>
            <div style={s.section}>Root Cause</div>
            <textarea style={{ ...s.input, minHeight: 60, resize: "vertical", marginBottom: 0 }} value={report.rootCause} onChange={e => updateText("rootCause", e.target.value)} />
          </div>

          <ListEditor s={s} C={C} accent={accent} title="Immediate Actions Taken" field="immediateActions" report={report} updateList={updateList} removeListItem={removeListItem} addListItem={addListItem} />
          <ListEditor s={s} C={C} accent={accent} title="Corrective Actions" field="correctiveActions" report={report} updateList={updateList} removeListItem={removeListItem} addListItem={addListItem} />

          {photos.length > 0 && (
            <div style={s.card}>
              <div style={s.section}>Photos ({photos.filter(p => p.uploadedUrl).length})</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 8 }}>
                {photos.filter(p => p.uploadedUrl).map(p => (
                  <img key={p.id} src={p.previewUrl} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: RAD.sm, border: `1.5px solid ${C.line}` }} />
                ))}
              </div>
            </div>
          )}

          <button style={s.btn(accent)} onClick={() => setStep("sign")}>Continue to Sign →</button>
          <button style={s.ghost} onClick={() => setStep("describe")}><ArrowLeft size={15} strokeWidth={2.5} /> Back</button>
        </>
      )}

      {/* SIGN */}
      {step === "sign" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, color: C.text.primary, display: "flex", alignItems: "center", gap: 8 }}><PenLine size={18} strokeWidth={2.25} color={accent} /> Sign & Submit</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 14 }}>Sign to confirm this incident report is accurate and complete to the best of your knowledge.</div>
          <label style={s.label}>Signature</label>
          <div style={{ fontSize: 11, color: C.text.faint, marginBottom: 6, lineHeight: 1.4 }}>By signing, you take full responsibility for the accuracy of this document — FORA is not liable for any errors or omissions.</div>
          <div style={{ position: "relative", marginBottom: 6 }}>
            <canvas ref={canvasRef} width={600} height={160}
              style={{ ...signatureCanvasStyle(C, RAD), height: 130 }}
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
            {!hasSignature && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 14, pointerEvents: "none" }}>Sign here</div>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: C.text.body }}>Reported by: <strong>{reporter}</strong></div>
            <button onClick={clearSig} style={{ background: "transparent", border: "none", color: C.text.muted, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Clear</button>
          </div>
          {saveError && (
            <div style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Couldn't save this report. Check your connection and try again.</span>
            </div>
          )}
          <button style={s.btn(saving ? disabledBg(C) : hasSignature ? C.status.success.solid : disabledBg(C))} disabled={saving || !hasSignature} onClick={submit}>
            {saving ? <><Loader2 size={16} className="fora-spin" /> Submitting…</> : saveError ? "Try Again" : <><CheckCircle2 size={16} strokeWidth={2.25} /> Sign & Submit Report</>}
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
            <div style={{ fontSize: 14, color: C.text.muted, marginBottom: 8 }}>{incidentType} · {site} · {reporter}</div>
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
            <div style={{ fontWeight: 800, fontSize: 22, color: C.text.primary, marginBottom: 6 }}>Incident Report Filed</div>
            <div style={{ fontSize: 14, color: C.text.muted, marginBottom: 8 }}>{incidentType} · {site} · {reporter}</div>
            <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 20 }}>This report has been saved and sent to your supervisor's dashboard for review.</div>
            <button style={s.btn(accent)} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}
      <style>{"@keyframes fora-spin { to { transform: rotate(360deg); } } .fora-spin { animation: fora-spin 0.8s linear infinite; }"}</style>
    </div>
  );
}

function ListEditor({ s, C, accent, title, field, report, updateList, removeListItem, addListItem }) {
  return (
    <div style={s.card}>
      <div style={s.section}>{title}</div>
      {(report[field] || []).map((f, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
          <input style={{ ...s.input, marginBottom: 0 }} value={f} onChange={e => updateList(field, i, e.target.value)} />
          <button onClick={() => removeListItem(field, i)} style={{ background: C.status.danger.bg, color: C.status.danger.text, border: `1px solid ${C.status.danger.border}`, borderRadius: 8, padding: "10px 12px", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center" }}><Trash2 size={15} strokeWidth={2.25} /></button>
        </div>
      ))}
      <button onClick={() => addListItem(field)} style={{ background: "transparent", border: "none", color: accent, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 6 }}><Plus size={15} strokeWidth={2.5} /> Add</button>
    </div>
  );
}
