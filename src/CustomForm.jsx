import { useState, useEffect } from "react";
import { generateAndUploadCustomForm } from "./generateCustomFormPDF";
import { loadDraft, clearDraft, useDraftAutosave } from "./useDraftAutosave.js";
import { enqueueSubmission } from "./offlineQueue.js";
import { fetchCompanyProfile, buildCompanyContextBlock } from "./companyProfile.js";

function newClientSubmissionId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Redoes the entire submission (PDF generation + upload + the final POST)
// from plain input data — used both by a live online submit() below and by
// offlineQueue's drainQueue() to resend a queued one later. Exported so
// WorkerMenu.jsx can drain this form's queue without the component
// mounted. formType for the queue is a single shared "customform" bucket
// covering every custom document type a company runs — formId in the
// payload is what routes a queued item back to the right one.
export async function resubmitCustomForm(payload, clientSubmissionId, tokenForRequest) {
  const { formTitle, accentColor, siteId, formId, siteNameStr, companyName, companyLogo, submittedBy, aiSummary, aiAssisted, items, sig } = payload;

  const pdfUrl = await generateAndUploadCustomForm({
    formTitle, accentColor, siteName: siteNameStr, companyName, companyLogo,
    submittedBy, aiSummary, items, signatureDataUrl: sig, token: tokenForRequest,
  });

  let res;
  try {
    res = await fetch("/api/customforms", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit_custom", token: tokenForRequest, clientSubmissionId,
        siteId, formId, submittedBy, aiSummary, aiAssisted, pdfUrl,
        answers: items.map(it => ({ questionId: it.questionId, answer: it.answer, note: it.note || "" })),
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
}

export default function CustomForm({ companyId, companyName, userName: loginUserName = "", formId, onBack, onLogout, token = null }) {
  const [step, setStep] = useState("site"); // site | questions | review | sign | queued | done
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState("");
  const [checking, setChecking] = useState(false);
  const [companyLogo, setCompanyLogo] = useState("");
  // docs/scope-company-brain.md Phase 5 — null (cold start) is handled
  // gracefully by buildCompanyContextBlock.
  const [companyProfile, setCompanyProfile] = useState(null);

  const [form, setForm] = useState(null);
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
        if (res.ok) setSites(data.sites || []);
        else console.error("sites read error:", data.error);
      } catch (e) {
        console.error("sites read error:", e.message);
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
  // Scoped by companyId + formId, not just companyId — a company can have
  // several custom document types active at once, each needs its own slot.
  const draftScope = companyId && formId ? `${companyId}::${formId}` : null;
  const RESTORABLE_STEPS = ["questions", "review", "sign"];
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    if (!draftScope) return;
    const draft = loadDraft("customform", draftScope);
    if (draft && draft.step && RESTORABLE_STEPS.includes(draft.step)) {
      if (draft.siteId) setSiteId(draft.siteId);
      if (draft.form) setForm(draft.form);
      if (draft.questions) setQuestions(draft.questions);
      if (draft.workerName) setWorkerName(draft.workerName);
      if (draft.answers) setAnswers(draft.answers);
      if (draft.aiSummary) setAiSummary(draft.aiSummary);
      if (typeof draft.aiAssisted === "boolean") setAiAssisted(draft.aiAssisted);
      setStep(draft.step);
    }
    setDraftRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftScope]);

  useDraftAutosave(
    "customform",
    draftScope,
    { step, siteId, form, questions, workerName, answers, aiSummary, aiAssisted },
    draftRestored && !!draftScope && RESTORABLE_STEPS.includes(step)
  );

  const siteName = () => sites.find(s => String(s.id) === String(siteId))?.name || "";

  const checkSiteAndProceed = async () => {
    setChecking(true); setGenError(false);
    try {
      const res = await fetch("/api/customforms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_active_form", token, siteId, formId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");

      setForm(data.form);
      setQuestions(data.questions || []);
      const initial = {};
      (data.questions || []).forEach(q => { initial[q.id] = { answer: null, note: "" }; });
      setAnswers(initial);
      setStep("questions");
    } catch (e) {
      setGenError(true);
    }
    setChecking(false);
  };

  const setAnswer = (qId, val) => setAnswers(prev => ({ ...prev, [qId]: { ...prev[qId], answer: val } }));
  const setNote = (qId, val) => setAnswers(prev => ({ ...prev, [qId]: { ...prev[qId], note: val } }));

  const allAnswered = questions.length > 0 && questions.every(q => answers[q.id]?.answer !== null);
  const flaggedItems = questions.filter(q => answers[q.id]?.answer === false);
  const notesComplete = flaggedItems.every(q => (answers[q.id]?.note || "").trim());

  const generateSummary = async () => {
    setLoading(true); setGenError(false);
    const qa = questions.map(q => {
      const a = answers[q.id];
      return `- ${q.question_text}: ${a.answer ? "YES" : "NO"}${!a.answer && a.note ? ` (Note: ${a.note})` : ""}`;
    }).join("\n");

    const prompt = `You are a safety officer writing a short professional summary of a completed "${form.title}" document.

Site: ${siteName()}
Company: ${companyName}

Results:
${qa}

INSTRUCTIONS:
- Write a clean, professional 2-4 sentence summary of the overall condition/status.
- If any items were flagged "NO", mention them factually.
- If everything passed, say so plainly.
- Do not invent details beyond what's given.
${buildCompanyContextBlock(companyProfile)}
Respond ONLY with valid JSON (no markdown, no backticks):
{ "summary": "professional summary text" }`;

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
      setAiSummary(parsed.summary || "");
      setAiAssisted(true);
      setStep("review");
    } catch (e) {
      setGenError(true);
    }
    setLoading(false);
  };

  // docs/scope-offline-capability.md Phase 2: if /api/generate-flha can't be
  // reached, let the worker continue instead of getting stuck — the actual
  // answers already exist before the AI call ever runs, so the fallback
  // just builds a plain, non-AI summary sentence client-side and drops into
  // the same already-editable review textarea. ai_assisted:false flags the
  // record so a supervisor knows it wasn't AI-summarized.
  const continueWithoutAI = () => {
    const flagged = questions.filter(q => answers[q.id]?.answer === false);
    const summary = flagged.length === 0
      ? `All ${questions.length} item${questions.length === 1 ? "" : "s"} passed.`
      : `${questions.length - flagged.length} of ${questions.length} items passed. Flagged: ${flagged.map(q => q.question_text).join("; ")}.`;
    setAiSummary(summary);
    setAiAssisted(false);
    setGenError(false);
    setStep("review");
  };

  // ── signature pad ────────────────────────────────────────
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

  // docs/scope-offline-capability.md Phase 1: a network-level failure gets
  // queued and retried automatically once back online instead of silently
  // discarding the document; a real server-side rejection shows an error
  // and lets the worker retry manually. Full auto-queue now that the
  // server side is idempotent (client_submission_id + a unique index on
  // custom_form_records, added earlier this session) — a blind background
  // retry can no longer create a duplicate record.
  const submit = async () => {
    setSaving(true); setSaveError(false);
    const sig = hasSignature && canvasEl ? canvasEl.toDataURL("image/png") : null;

    const items = questions.map(q => ({
      questionId: q.id,
      question: q.question_text,
      answer: answers[q.id]?.answer,
      note: answers[q.id]?.note || "",
    }));

    const clientSubmissionId = newClientSubmissionId();
    const payload = {
      formTitle: form.title, accentColor: form.accent_color, siteId, formId: form.id, siteNameStr: siteName(),
      companyName, companyLogo, submittedBy: workerName, aiSummary, aiAssisted, items, sig,
    };

    if (!navigator.onLine) {
      await enqueueSubmission("customform", clientSubmissionId, payload);
      setSaving(false);
      clearDraft("customform", draftScope);
      setStep("queued");
      return;
    }

    try {
      await resubmitCustomForm(payload, clientSubmissionId, token);
      setSaving(false);
      clearDraft("customform", draftScope);
      setStep("done");
    } catch (e) {
      if (e.isServerError) {
        console.error("Custom form save failed:", e.message);
        setSaveError(true);
        setSaving(false);
      } else {
        await enqueueSubmission("customform", clientSubmissionId, payload);
        setSaving(false);
        clearDraft("customform", draftScope);
        setStep("queued");
      }
    }
  };

  const s = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#F0F4F8", minHeight: "100vh", padding: 16, colorScheme: "light" },
    header: (accent) => ({ background: `linear-gradient(135deg,${accent},${accent}dd)`, borderRadius: 14, padding: "18px 20px", marginBottom: 16, color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }),
    card: { background: "#fff", borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: "0 1px 3px #0f172a12" },
    label: { display: "block", fontWeight: 700, fontSize: 12, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 },
    input: { width: "100%", padding: "11px 13px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 11, background: "#F8FAFC", color: "#1E293B", colorScheme: "light" },
    btn: (bg, fg = "#fff") => ({ background: bg, color: fg, border: "none", borderRadius: 10, padding: "13px", fontWeight: 800, fontSize: 15, cursor: "pointer", width: "100%" }),
    ghost: { background: "#F1F5F9", color: "#334155", border: "none", borderRadius: 10, padding: "11px", fontWeight: 600, fontSize: 14, cursor: "pointer", width: "100%", marginTop: 10 },
  };

  const accent = form?.accent_color || "#4338CA";

  return (
    <div style={s.wrap}>
      <div style={s.header(accent)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {companyLogo ? <img src={companyLogo} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: "cover", background: "#fff" }} /> : <span style={{ fontSize: 26 }}>{form?.icon || "📄"}</span>}
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>{form?.title || "Custom Document"}</div>
          </div>
        </div>
        <button onClick={onBack} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>← Menu</button>
      </div>

      {/* STEP: pick site */}
      {step === "site" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: "#1E293B" }}>Select site</div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 16 }}>Which site is this for?</div>
          {sites.length > 0 ? (
            <select style={s.input} value={siteId} onChange={e => setSiteId(e.target.value)}>
              <option value="">Select a site…</option>
              {sites.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          ) : (
            <div style={{ fontSize: 13, color: "#94A3B8", marginBottom: 11 }}>No sites registered for this company yet. Ask your admin to add one.</div>
          )}
          {genError && <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: "#991B1B" }}>Couldn't load this document. Try again.</div>}
          <button style={s.btn(checking ? "#94A3B8" : siteId ? accent : "#94A3B8")} disabled={checking || !siteId} onClick={checkSiteAndProceed}>
            {checking ? "⏳ Loading…" : "Continue →"}
          </button>
        </div>
      )}

      {/* STEP: questions */}
      {step === "questions" && form && (
        <>
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#1E293B" }}>{form.title}</div>
            <div style={{ fontSize: 13, color: "#64748B", marginTop: 2 }}>{siteName()}</div>
            <label style={{ ...s.label, marginTop: 14 }}>Your name</label>
            <input
              style={{ ...s.input, marginBottom: 0, ...(loginUserName ? { background: "#F3F4F6", color: "#6B7280" } : {}) }}
              placeholder="e.g. John Smith" value={workerName}
              onChange={e => setWorkerName(e.target.value)}
              readOnly={!!loginUserName}
            />
          </div>

          {questions.map((q, i) => {
            const a = answers[q.id] || {};
            return (
              <div key={q.id} style={s.card}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#1E293B", marginBottom: 12 }}>{i + 1}. {q.question_text}</div>
                <div style={{ display: "flex", gap: 8, marginBottom: a.answer === false ? 11 : 0 }}>
                  <button onClick={() => setAnswer(q.id, true)} style={{ flex: 1, padding: "12px", borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${a.answer === true ? "#16A34A" : "#E2E8F0"}`, background: a.answer === true ? "#F0FDF4" : "#fff", color: a.answer === true ? "#16A34A" : "#94A3B8" }}>Yes</button>
                  <button onClick={() => setAnswer(q.id, false)} style={{ flex: 1, padding: "12px", borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${a.answer === false ? "#DC2626" : "#E2E8F0"}`, background: a.answer === false ? "#FEF2F2" : "#fff", color: a.answer === false ? "#DC2626" : "#94A3B8" }}>No</button>
                </div>
                {a.answer === false && (
                  <textarea style={{ ...s.input, minHeight: 70, resize: "vertical", fontFamily: "inherit", marginBottom: 0 }} placeholder="What's the issue?" value={a.note} onChange={e => setNote(q.id, e.target.value)} />
                )}
              </div>
            );
          })}

          {genError && (
            <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: "#991B1B" }}>
              Couldn't generate the summary. Check your connection and try again, or continue without one.
            </div>
          )}
          <button style={s.btn(loading ? "#94A3B8" : (workerName && allAnswered && notesComplete) ? accent : "#94A3B8")} disabled={loading || !workerName || !allAnswered || !notesComplete} onClick={generateSummary}>
            {loading ? "⏳ Writing summary…" : "Generate Summary"}
          </button>
          {genError && (
            <button style={s.ghost} onClick={continueWithoutAI}>Continue without AI summary</button>
          )}
          <button style={s.ghost} onClick={() => setStep("site")}>← Back</button>
        </>
      )}

      {/* STEP: review */}
      {step === "review" && (
        <>
          {!aiAssisted && (
            <div style={{ background: "#FFFBEB", border: "1.5px solid #FCD34D", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#92400E" }}>
              ⚠️ Not AI-summarized — feel free to edit the summary below before submitting.
            </div>
          )}
          <div style={s.card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 0.5 }}>{form.title}</div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{siteName()} · By {workerName}</div>
          </div>

          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 15, color: accent, marginBottom: 8 }}>Summary</div>
            <textarea style={{ ...s.input, minHeight: 90, resize: "vertical", fontFamily: "inherit", marginBottom: 0 }} value={aiSummary} onChange={e => setAiSummary(e.target.value)} />
          </div>

          {flaggedItems.length > 0 && (
            <div style={{ ...s.card, background: "#FEF2F2", border: "1.5px solid #FCA5A5" }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: "#991B1B", marginBottom: 8 }}>{flaggedItems.length} item{flaggedItems.length > 1 ? "s" : ""} flagged</div>
              {flaggedItems.map(q => (
                <div key={q.id} style={{ fontSize: 13, color: "#7F1D1D", marginBottom: 6 }}>
                  • <strong>{q.question_text}</strong>{answers[q.id]?.note ? `: ${answers[q.id].note}` : ""}
                </div>
              ))}
            </div>
          )}

          <button style={s.btn(accent)} onClick={() => setStep("sign")}>Continue to Sign →</button>
          <button style={s.ghost} onClick={() => setStep("questions")}>← Back</button>
        </>
      )}

      {/* STEP: sign */}
      {step === "sign" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, color: "#1E293B" }}>Sign & Submit</div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 14 }}>Sign to confirm this is accurate and complete.</div>
          <label style={s.label}>Signature</label>
          <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 6, lineHeight: 1.4 }}>By signing, you take full responsibility for the accuracy of this document — FORA is not liable for any errors or omissions.</div>
          <div style={{ position: "relative", marginBottom: 6 }}>
            <canvas ref={canvasRefCallback} width={600} height={160}
              style={{ width: "100%", height: 130, border: "1.5px solid #E2E8F0", borderRadius: 10, background: "#fff", touchAction: "none", display: "block" }}
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
            {!hasSignature && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 14, pointerEvents: "none" }}>Sign here</div>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#475569" }}>Signed by: <strong>{workerName}</strong></div>
            <button onClick={clearSig} style={{ background: "transparent", border: "none", color: "#64748B", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Clear</button>
          </div>
          {saveError && (
            <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: "#991B1B" }}>
              Couldn't save this document. Check your connection and try again.
            </div>
          )}
          <button style={s.btn(saving ? "#94A3B8" : hasSignature ? "#16A34A" : "#94A3B8")} disabled={saving || !hasSignature} onClick={submit}>
            {saving ? "Submitting…" : saveError ? "Try Again" : "Sign & Submit"}
          </button>
          <button style={s.ghost} onClick={() => setStep("review")}>← Back</button>
        </div>
      )}

      {/* QUEUED — offline at submit time; queued locally and will send automatically once back online (docs/scope-offline-capability.md Phase 1) */}
      {step === "queued" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 60, marginBottom: 12 }}>📶</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: "#1E293B", marginBottom: 6 }}>Saved — No Signal</div>
            <div style={{ fontSize: 14, color: "#64748B", marginBottom: 8 }}>{siteName()}</div>
            <div style={{ fontSize: 13, color: "#64748B", marginBottom: 20 }}>This document is saved on your device and will send automatically the next time you're back online — no need to redo it.</div>
            <button style={s.btn(accent)} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}

      {/* STEP: done */}
      {step === "done" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 60, marginBottom: 12 }}>{flaggedItems.length > 0 ? "⚠️" : "✅"}</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: "#1E293B", marginBottom: 6 }}>Submitted</div>
            <div style={{ fontSize: 14, color: "#64748B", marginBottom: 18 }}>{siteName()} · {new Date().toLocaleDateString("en-CA")}</div>
            <button style={s.btn(accent)} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}
    </div>
  );
}
