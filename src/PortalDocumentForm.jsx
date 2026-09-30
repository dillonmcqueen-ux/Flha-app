import { useState, useEffect, useRef } from "react";
import { generateAndUploadPortalDocument } from "./generatePortalDocumentPDF";
import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";
import { loadDraft, clearDraft, useDraftAutosave } from "./useDraftAutosave.js";
import { enqueueSubmission } from "./offlineQueue.js";
import { fetchCompanyProfile, buildCompanyContextBlock } from "./companyProfile.js";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD } from "./theme";
import { buildFormStyles, disabledBg, bannerStyle, signatureCanvasStyle } from "./FormKit";
import { ArrowLeft, FileText, Loader2, CheckCircle2, AlertTriangle, WifiOff, PenLine, Upload } from "lucide-react";

function newClientSubmissionId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(header)?.[1] || "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// signature/file_upload answers are captured as dataURLs client-side (same
// deferred-upload pattern as the final sign-off canvas in every other
// worker form) and only actually uploaded to storage here, at submit time —
// live or from the offline queue's drain. Mutates nothing; returns a new
// items array with each signature/file_upload `value` replaced by its
// server-issued upload receipt, or null if the upload failed (submission
// still proceeds — a missing attachment isn't a reason to lose the rest of
// a worker's completed document).
async function uploadPortalAttachments(items, token) {
  return Promise.all(items.map(async (it) => {
    if ((it.field_type !== "signature" && it.field_type !== "file_upload") || !it.value) return it;
    try {
      const blob = it.value.startsWith("data:") ? dataUrlToBlob(it.value) : it.value;
      const ext = it.field_type === "signature" ? "png" : (it.fileName || "").split(".").pop() || "png";
      const { receipt } = await uploadViaSignedUrl({
        endpoint: "/api/portal", action: "create_portal_upload_url", token,
        bucket: "portal-attachments", filename: `${it.field_type}-${it.questionId}.${ext}`,
        file: blob, contentType: blob.type || "application/octet-stream",
      });
      return { ...it, value: receipt || null };
    } catch (e) {
      return { ...it, value: null };
    }
  }));
}

// The shared redo-everything-from-plain-data function — used by a live
// submit() below and by offlineQueue's drainQueue() to resend a queued
// submission later. Same shape as src/CustomForm.jsx's resubmitCustomForm.
export async function resubmitPortalForm(payload, clientSubmissionId, tokenForRequest) {
  const { documentTitle, siteId, documentId, siteNameStr, companyName, companyLogo, submittedBy, aiSummary, aiAssisted, items, sig } = payload;

  const uploadedItems = await uploadPortalAttachments(items, tokenForRequest);

  const pdfUrl = await generateAndUploadPortalDocument({
    documentTitle, siteName: siteNameStr, companyName, companyLogo,
    submittedBy, aiSummary,
    items: uploadedItems.map(it => ({ question_text: it.question_text, field_type: it.field_type, value: it.value, note: it.note })),
    signatureDataUrl: sig, token: tokenForRequest,
  });

  let res;
  try {
    res = await fetch("/api/portal", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit_portal", token: tokenForRequest, clientSubmissionId,
        siteId, documentId, submittedBy, aiSummary, aiAssisted, pdfUrl,
        answers: uploadedItems.map(it => ({ questionId: it.questionId, value: it.value, note: it.note || "" })),
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
  return await res.json().catch(() => ({}));
}

function answerIsEmpty(fieldType, value) {
  if (fieldType === "multiselect") return !Array.isArray(value) || value.length === 0;
  return value === null || value === undefined || value === "";
}

export default function PortalDocumentForm({ companyId, companyName, userName: loginUserName = "", documentId, onBack, onLogout, token = null }) {
  const [step, setStep] = useState("site"); // site | questions | review | sign | queued | done
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState("");
  const [checking, setChecking] = useState(false);
  const [companyLogo, setCompanyLogo] = useState("");
  const [companyProfile, setCompanyProfile] = useState(null);

  const [document, setDocument] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});

  const [workerName, setWorkerName] = useState(loginUserName);
  const [loading, setLoading] = useState(false);
  const [genError, setGenError] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [aiAssisted, setAiAssisted] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/companydata", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_sites", token, companyId }),
        });
        const data = await res.json();
        if (res.ok) {
          setSites(data.sites || []);
          // The person's default site, from their profile (never overrides a choice or draft).
          if (data.defaultSiteId) setSiteId(prev => prev || String(data.defaultSiteId));
        }
      } catch (e) { /* leave sites empty */ }
      try {
        const logoRes = await fetch("/api/companydata", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_company_logo", token, companyId }),
        });
        const logoData = await logoRes.json();
        if (logoRes.ok) setCompanyLogo(logoData.logo_url || "");
      } catch (e) { /* leave logo blank */ }
      setCompanyProfile(await fetchCompanyProfile(token, companyId));
    }
    load();
  }, [companyId, token]);

  const draftScope = companyId && documentId ? `${companyId}::${documentId}` : null;
  const RESTORABLE_STEPS = ["questions", "review", "sign"];
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    if (!draftScope) return;
    const draft = loadDraft("portalform", draftScope);
    if (draft && draft.step && RESTORABLE_STEPS.includes(draft.step)) {
      if (draft.siteId) setSiteId(draft.siteId);
      if (draft.document) setDocument(draft.document);
      if (draft.questions) setQuestions(draft.questions);
      if (draft.workerName && !loginUserName) setWorkerName(draft.workerName);
      if (draft.answers) setAnswers(draft.answers);
      if (draft.aiSummary) setAiSummary(draft.aiSummary);
      if (typeof draft.aiAssisted === "boolean") setAiAssisted(draft.aiAssisted);
      setStep(draft.step);
    }
    setDraftRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftScope]);

  // Known limitation: signature/file_upload answers hold full base64
  // dataURLs, which ride along into this autosave snapshot same as every
  // other answer. Unlike CustomForm.jsx's single final signature (never
  // autosaved — it's captured fresh at the "sign" step, past the
  // restorable steps), a mid-form signature/file_upload question can make
  // this snapshot large enough to risk localStorage's quota on a
  // document with several such fields. Not a correctness bug (a quota
  // failure just means the draft doesn't persist, per useDraftAutosave's
  // own try/catch), but worth tightening later if a real document hits it.
  useDraftAutosave(
    "portalform",
    draftScope,
    { step, siteId, document, questions, workerName, answers, aiSummary, aiAssisted },
    draftRestored && !!draftScope && RESTORABLE_STEPS.includes(step)
  );

  const siteName = () => sites.find(s => String(s.id) === String(siteId))?.name || "";

  const checkSiteAndProceed = async () => {
    setChecking(true); setGenError(false);
    try {
      const res = await fetch("/api/portal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_active_portal_document", token, siteId, documentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");

      setDocument(data.document);
      setQuestions(data.questions || []);
      const initial = {};
      (data.questions || []).forEach(q => {
        initial[q.id] = { value: q.field_type === "multiselect" ? [] : null, note: "" };
      });
      setAnswers(initial);
      setStep("questions");
    } catch (e) {
      setGenError(true);
    }
    setChecking(false);
  };

  const setAnswer = (qId, val) => setAnswers(prev => ({ ...prev, [qId]: { ...prev[qId], value: val } }));
  const setNote = (qId, val) => setAnswers(prev => ({ ...prev, [qId]: { ...prev[qId], note: val } }));
  const toggleMulti = (qId, option) => setAnswers(prev => {
    const current = Array.isArray(prev[qId]?.value) ? prev[qId].value : [];
    const next = current.includes(option) ? current.filter(o => o !== option) : [...current, option];
    return { ...prev, [qId]: { ...prev[qId], value: next } };
  });

  const allAnswered = questions.length > 0 && questions.every(q => !answerIsEmpty(q.field_type, answers[q.id]?.value));
  const flaggedItems = questions.filter(q => q.field_type === "yesno" && answers[q.id]?.value === "no");
  const notesComplete = flaggedItems.every(q => (answers[q.id]?.note || "").trim());

  const generateSummary = async () => {
    setLoading(true); setGenError(false);
    const qa = questions.map(q => {
      const a = answers[q.id];
      const val = Array.isArray(a.value) ? a.value.join(", ") : a.value;
      return `- ${q.question_text}: ${val}${q.field_type === "yesno" && a.value === "no" && a.note ? ` (Note: ${a.note})` : ""}`;
    }).join("\n");

    const prompt = `You are a safety officer writing a short professional summary of a completed "${document.title}" document.

Site: ${siteName()}
Company: ${companyName}

Results:
${qa}

INSTRUCTIONS:
- Write a clean, professional 2-4 sentence summary of the overall condition/status.
- If any yes/no items were flagged "no", mention them factually.
- If everything looks fine, say so plainly.
- Do not invent details beyond what's given.
${buildCompanyContextBlock(companyProfile)}
Respond ONLY with valid JSON (no markdown, no backticks):
{ "summary": "professional summary text" }`;

    try {
      const res = await fetch("/api/generate-flha", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, token, documentType: "custom_form" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const text = data.content?.map(b => b.text || "").join("") || "";
      const a = text.indexOf("{"), b = text.lastIndexOf("}");
      if (a === -1 || b === -1) throw new Error("bad response");
      const parsed = JSON.parse(text.slice(a, b + 1));
      setAiSummary(parsed.summary || "");
      setAiAssisted(true);
      setStep("review");
    } catch (e) {
      setGenError(true);
    }
    setLoading(false);
  };

  const continueWithoutAI = () => {
    const flagged = questions.filter(q => q.field_type === "yesno" && answers[q.id]?.value === "no");
    const summary = flagged.length === 0
      ? `All ${questions.length} item${questions.length === 1 ? "" : "s"} completed.`
      : `${questions.length - flagged.length} of ${questions.length} items passed. Flagged: ${flagged.map(q => q.question_text).join("; ")}.`;
    setAiSummary(summary);
    setAiAssisted(false);
    setGenError(false);
    setStep("review");
  };

  // ── final sign-off pad (same as every other worker form) ────────────
  const [canvasEl, setCanvasEl] = useState(null);
  const canvasRefCallback = (node) => { if (node) setCanvasEl(node); };
  const drawingRef = { current: false };
  const getPos = (e, canvas) => {
    const r = canvas.getBoundingClientRect(), t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (canvas.width / r.width), y: (t.clientY - r.top) * (canvas.height / r.height) };
  };
  const startDraw = (e) => { e.preventDefault(); drawingRef.current = true; const ctx = canvasEl.getContext("2d"); const { x, y } = getPos(e, canvasEl); ctx.beginPath(); ctx.moveTo(x, y); };
  const draw = (e) => { if (!drawingRef.current) return; e.preventDefault(); const ctx = canvasEl.getContext("2d"); const { x, y } = getPos(e, canvasEl); ctx.lineTo(x, y); ctx.strokeStyle = "#1E293B"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.stroke(); setHasSignature(true); };
  const endDraw = () => { drawingRef.current = false; };
  const clearSig = () => { if (canvasEl) canvasEl.getContext("2d").clearRect(0, 0, canvasEl.width, canvasEl.height); setHasSignature(false); };

  // ── per-question signature capture (a mid-form "Inspector signature"
  // field type, distinct from the mandatory final sign-off above) ──────
  const miniCanvases = useRef(new Map());
  const drawingMini = useRef(new Map());
  const miniPos = (e, canvas) => {
    const r = canvas.getBoundingClientRect(), t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (canvas.width / r.width), y: (t.clientY - r.top) * (canvas.height / r.height) };
  };
  const miniStart = (qId) => (e) => {
    e.preventDefault();
    const canvas = miniCanvases.current.get(qId); if (!canvas) return;
    drawingMini.current.set(qId, true);
    const ctx = canvas.getContext("2d"); const { x, y } = miniPos(e, canvas);
    ctx.beginPath(); ctx.moveTo(x, y);
  };
  const miniDraw = (qId) => (e) => {
    if (!drawingMini.current.get(qId)) return;
    e.preventDefault();
    const canvas = miniCanvases.current.get(qId); if (!canvas) return;
    const ctx = canvas.getContext("2d"); const { x, y } = miniPos(e, canvas);
    ctx.lineTo(x, y); ctx.strokeStyle = "#1E293B"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.stroke();
  };
  const miniEnd = (qId) => () => {
    drawingMini.current.set(qId, false);
    const canvas = miniCanvases.current.get(qId); if (!canvas) return;
    setAnswer(qId, canvas.toDataURL("image/png"));
  };
  const miniClear = (qId) => {
    const canvas = miniCanvases.current.get(qId);
    if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setAnswer(qId, null);
  };

  const handleFileSelect = (qId) => (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setAnswers(prev => ({ ...prev, [qId]: { ...prev[qId], value: reader.result, fileName: file.name } }));
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setSaving(true); setSaveError(false);
    const sig = hasSignature && canvasEl ? canvasEl.toDataURL("image/png") : null;

    const items = questions.map(q => ({
      questionId: q.id,
      question_text: q.question_text,
      field_type: q.field_type,
      value: answers[q.id]?.value,
      note: answers[q.id]?.note || "",
      fileName: answers[q.id]?.fileName,
    }));

    const clientSubmissionId = newClientSubmissionId();
    const payload = {
      documentTitle: document.title, siteId, documentId: document.id, siteNameStr: siteName(),
      companyName, companyLogo, submittedBy: workerName, aiSummary, aiAssisted, items, sig,
    };

    if (!navigator.onLine) {
      await enqueueSubmission("portalform", clientSubmissionId, payload);
      setSaving(false);
      clearDraft("portalform", draftScope);
      setStep("queued");
      return;
    }

    try {
      await resubmitPortalForm(payload, clientSubmissionId, token);
      setSaving(false);
      clearDraft("portalform", draftScope);
      setStep("done");
    } catch (e) {
      if (e.isServerError) {
        setSaveError(true);
        setSaving(false);
      } else {
        await enqueueSubmission("portalform", clientSubmissionId, payload);
        setSaving(false);
        clearDraft("portalform", draftScope);
        setStep("queued");
      }
    }
  };

  const accent = C.orange;
  const s = buildFormStyles(C, FONT, RAD, SHAD, accent);

  const renderQuestionInput = (q) => {
    const a = answers[q.id] || {};
    switch (q.field_type) {
      case "yesno":
        return (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: a.value === "no" ? 11 : 0 }}>
              <button onClick={() => setAnswer(q.id, "yes")} style={{ flex: 1, padding: "13px", borderRadius: RAD.md, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${a.value === "yes" ? C.status.success.solid : C.line}`, background: a.value === "yes" ? C.status.success.bg : C.panelInset, color: a.value === "yes" ? C.status.success.text : C.text.faint }}>Yes</button>
              <button onClick={() => setAnswer(q.id, "no")} style={{ flex: 1, padding: "13px", borderRadius: RAD.md, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${a.value === "no" ? C.status.danger.solid : C.line}`, background: a.value === "no" ? C.status.danger.bg : C.panelInset, color: a.value === "no" ? C.status.danger.text : C.text.faint }}>No</button>
            </div>
            {a.value === "no" && (
              <textarea style={{ ...s.input, minHeight: 70, resize: "vertical", marginBottom: 0, marginTop: 11 }} placeholder="What's the issue?" value={a.note} onChange={e => setNote(q.id, e.target.value)} />
            )}
          </>
        );
      case "short_text":
        return <input style={s.input} type="text" value={a.value || ""} onChange={e => setAnswer(q.id, e.target.value)} />;
      case "number":
        return <input style={s.input} type="number" value={a.value || ""} onChange={e => setAnswer(q.id, e.target.value)} />;
      case "date":
        return <input style={s.input} type="date" value={a.value || ""} onChange={e => setAnswer(q.id, e.target.value)} />;
      case "dropdown":
        return (
          <select style={s.input} value={a.value || ""} onChange={e => setAnswer(q.id, e.target.value)}>
            <option value="">Select…</option>
            {(q.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        );
      case "multiselect":
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(q.options || []).map(opt => {
              const selected = Array.isArray(a.value) && a.value.includes(opt);
              return (
                <button key={opt} type="button" onClick={() => toggleMulti(q.id, opt)} style={{
                  padding: "8px 14px", borderRadius: RAD.pill, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  border: `1.5px solid ${selected ? C.orange : C.line}`,
                  background: selected ? `${C.orange}22` : C.panelInset,
                  color: selected ? C.orange : C.text.faint,
                }}>{selected ? "✓ " : ""}{opt}</button>
              );
            })}
          </div>
        );
      case "signature":
        return (
          <div>
            <div style={{ position: "relative", marginBottom: 6 }}>
              <canvas
                ref={(node) => { if (node) miniCanvases.current.set(q.id, node); }}
                width={500} height={110}
                style={{ ...signatureCanvasStyle(C, RAD), height: 90 }}
                onMouseDown={miniStart(q.id)} onMouseMove={miniDraw(q.id)} onMouseUp={miniEnd(q.id)} onMouseLeave={miniEnd(q.id)}
                onTouchStart={miniStart(q.id)} onTouchMove={miniDraw(q.id)} onTouchEnd={miniEnd(q.id)}
              />
              {!a.value && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 13, pointerEvents: "none" }}>Sign here</div>}
            </div>
            <button onClick={() => miniClear(q.id)} style={{ background: "transparent", border: "none", color: C.text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Clear</button>
          </div>
        );
      case "file_upload":
        return (
          <div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: RAD.md, border: `1.5px dashed ${C.line}`, cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.text.body }}>
              <Upload size={15} strokeWidth={2.25} />
              {a.fileName || "Choose a file…"}
              <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={handleFileSelect(q.id)} />
            </label>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {companyLogo ? <img src={companyLogo} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: "cover", background: "#fff" }} /> : <FileText size={26} strokeWidth={2} />}
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>{document?.title || "Document"}</div>
          </div>
        </div>
        <button onClick={onBack} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><ArrowLeft size={15} strokeWidth={2.5} /> Menu</button>
      </div>

      {step === "site" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: C.text.primary }}>Select site</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 16 }}>Which site is this for?</div>
          {sites.length > 0 ? (
            <select style={s.input} value={siteId} onChange={e => setSiteId(e.target.value)}>
              <option value="">Select a site…</option>
              {sites.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          ) : (
            <div style={{ fontSize: 13, color: C.text.faint, marginBottom: 11 }}>No sites registered for this company yet. Ask your admin to add one.</div>
          )}
          {genError && <div style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1 }} /><span>Couldn't load this document. Try again.</span></div>}
          <button style={s.btn(checking ? disabledBg(C) : siteId ? accent : disabledBg(C))} disabled={checking || !siteId} onClick={checkSiteAndProceed}>
            {checking ? <><Loader2 size={16} className="fora-spin" /> Loading…</> : "Continue →"}
          </button>
        </div>
      )}

      {step === "questions" && document && (
        <>
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 17, color: C.text.primary }}>{document.title}</div>
            <div style={{ fontSize: 13, color: C.text.muted, marginTop: 2 }}>{siteName()}</div>
            {loginUserName ? (
              <div style={{ fontSize: 13, color: C.text.muted, margin: "0 0 14px" }}>Filling in as <strong>{loginUserName}</strong></div>
            ) : (
              <>
              <label style={{ ...s.label, marginTop: 14 }}>Your name</label>
            <input
              style={{ ...s.input, marginBottom: 0, ...(loginUserName ? { background: C.line, color: C.text.faint } : {}) }}
              placeholder="e.g. John Smith" value={workerName}
              onChange={e => setWorkerName(e.target.value)}
              readOnly={!!loginUserName}
            />
              </>
            )}
          </div>

          {questions.map((q, i) => (
            <div key={q.id} style={s.card}>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.text.primary, marginBottom: 12 }}>{i + 1}. {q.question_text}</div>
              {renderQuestionInput(q)}
            </div>
          ))}

          {genError && (
            <div style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Couldn't generate the summary. Check your connection and try again, or continue without one.</span>
            </div>
          )}
          <button style={s.btn(loading ? disabledBg(C) : (workerName && allAnswered && notesComplete) ? accent : disabledBg(C))} disabled={loading || !workerName || !allAnswered || !notesComplete} onClick={generateSummary}>
            {loading ? <><Loader2 size={16} className="fora-spin" /> Writing summary…</> : "Generate Summary"}
          </button>
          {genError && (
            <button style={s.ghost} onClick={continueWithoutAI}>Continue without AI summary</button>
          )}
          <button style={s.ghost} onClick={() => setStep("site")}><ArrowLeft size={15} strokeWidth={2.5} /> Back</button>
        </>
      )}

      {step === "review" && (
        <>
          {!aiAssisted && (
            <div style={bannerStyle(C, RAD, "warning")}><AlertTriangle size={16} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Not AI-summarized — feel free to edit the summary below before submitting.</span>
            </div>
          )}
          <div style={s.card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 0.5 }}>{document.title}</div>
            <div style={{ fontSize: 12, color: C.text.muted, marginTop: 2 }}>{siteName()} · By {workerName}</div>
          </div>

          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 15, color: accent, marginBottom: 8 }}>Summary</div>
            <textarea style={{ ...s.input, minHeight: 90, resize: "vertical", marginBottom: 0 }} value={aiSummary} onChange={e => setAiSummary(e.target.value)} />
          </div>

          {flaggedItems.length > 0 && (
            <div style={{ ...s.card, background: C.status.danger.bg, border: `1.5px solid ${C.status.danger.border}` }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: C.status.danger.text, marginBottom: 8 }}>{flaggedItems.length} item{flaggedItems.length > 1 ? "s" : ""} flagged</div>
              {flaggedItems.map(q => (
                <div key={q.id} style={{ fontSize: 13, color: C.text.body, marginBottom: 6 }}>
                  • <strong>{q.question_text}</strong>{answers[q.id]?.note ? `: ${answers[q.id].note}` : ""}
                </div>
              ))}
            </div>
          )}

          <button style={s.btn(accent)} onClick={() => setStep("sign")}>Continue to Sign →</button>
          <button style={s.ghost} onClick={() => setStep("questions")}><ArrowLeft size={15} strokeWidth={2.5} /> Back</button>
        </>
      )}

      {step === "sign" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, color: C.text.primary, display: "flex", alignItems: "center", gap: 8 }}><PenLine size={18} strokeWidth={2.25} color={accent} /> Sign & Submit</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 14 }}>Sign to confirm this is accurate and complete.</div>
          <label style={s.label}>Signature</label>
          <div style={{ fontSize: 11, color: C.text.faint, marginBottom: 6, lineHeight: 1.4 }}>By signing, you take full responsibility for the accuracy of this document — FORA is not liable for any errors or omissions.</div>
          <div style={{ position: "relative", marginBottom: 6 }}>
            <canvas ref={canvasRefCallback} width={600} height={160}
              style={{ ...signatureCanvasStyle(C, RAD), height: 130 }}
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
            {!hasSignature && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 14, pointerEvents: "none" }}>Sign here</div>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: C.text.body }}>Signed by: <strong>{workerName}</strong></div>
            <button onClick={clearSig} style={{ background: "transparent", border: "none", color: C.text.muted, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Clear</button>
          </div>
          {saveError && (
            <div style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Couldn't save this document. Check your connection and try again.</span>
            </div>
          )}
          <button style={s.btn(saving ? disabledBg(C) : hasSignature ? C.status.success.solid : disabledBg(C))} disabled={saving || !hasSignature} onClick={submit}>
            {saving ? <><Loader2 size={16} className="fora-spin" /> Submitting…</> : saveError ? "Try Again" : <><CheckCircle2 size={16} strokeWidth={2.25} /> Sign & Submit</>}
          </button>
          <button style={s.ghost} onClick={() => setStep("review")}><ArrowLeft size={15} strokeWidth={2.5} /> Back</button>
        </div>
      )}

      {step === "queued" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <WifiOff size={48} strokeWidth={1.75} color={C.status.warning.text} style={{ marginBottom: 12 }} />
            <div style={{ fontWeight: 800, fontSize: 22, color: C.text.primary, marginBottom: 6 }}>Saved — No Signal</div>
            <div style={{ fontSize: 14, color: C.text.muted, marginBottom: 8 }}>{siteName()}</div>
            <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 20 }}>This document is saved on your device and will send automatically the next time you're back online — no need to redo it.</div>
            <button style={s.btn(accent)} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            {flaggedItems.length > 0
              ? <AlertTriangle size={48} strokeWidth={1.75} color={C.status.warning.text} style={{ marginBottom: 12 }} />
              : <CheckCircle2 size={48} strokeWidth={1.75} color={C.status.success.text} style={{ marginBottom: 12 }} />}
            <div style={{ fontWeight: 800, fontSize: 22, color: C.text.primary, marginBottom: 6 }}>Submitted</div>
            <div style={{ fontSize: 14, color: C.text.muted, marginBottom: 18 }}>{siteName()} · {new Date().toLocaleDateString("en-CA")}</div>
            <button style={s.btn(accent)} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}
      <style>{"@keyframes fora-spin { to { transform: rotate(360deg); } } .fora-spin { animation: fora-spin 0.8s linear infinite; }"}</style>
    </div>
  );
}
