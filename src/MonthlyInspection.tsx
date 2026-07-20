import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { generateAndUploadMonthlyInspection } from "./generateMonthlyInspectionPDF";

export default function MonthlyInspection({ companyId, companyName, onBack, onLogout, token = null }) {
  const [step, setStep] = useState("site"); // site | duplicate | none | questions | review | sign | done
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState("");
  const [checking, setChecking] = useState(false);
  const [companyLogo, setCompanyLogo] = useState("");

  const [form, setForm] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [existingRecord, setExistingRecord] = useState(null);
  const [answers, setAnswers] = useState({}); // { [questionId]: { answer: bool|null, note: string } }

  const [workerName, setWorkerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [genError, setGenError] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [signed, setSigned] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: st } = await supabase.from("sites").select("id, name").eq("company_id", companyId).order("id");
      setSites(st || []);
      const { data: co } = await supabase.from("companies").select("logo_url").eq("id", companyId).limit(1);
      if (co && co[0]) setCompanyLogo(co[0].logo_url || "");
    }
    load();
  }, [companyId]);

  const siteName = () => sites.find(s => String(s.id) === String(siteId))?.name || "";

  const checkSiteAndProceed = async () => {
    setChecking(true); setGenError(false);
    try {
      const res = await fetch("/api/monthly", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_active_form", token, siteId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");

      if (!data.form) { setStep("none"); setChecking(false); return; }

      setForm(data.form);
      setQuestions(data.questions || []);
      const initial = {};
      (data.questions || []).forEach(q => { initial[q.id] = { answer: null, note: "" }; });
      setAnswers(initial);

      if (data.existingRecord) {
        setExistingRecord(data.existingRecord);
        setStep("duplicate");
      } else {
        setStep("questions");
      }
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

    const prompt = `You are a safety officer writing a short professional summary of a completed monthly site inspection.

Site: ${siteName()}
Company: ${companyName}

Inspection results:
${qa}

INSTRUCTIONS:
- Write a clean, professional 2-4 sentence summary of the inspection's overall condition.
- If any items were flagged "NO", mention them factually and note that corrective action has been logged.
- If everything passed, say so plainly.
- Do not invent details beyond what's given.

Respond ONLY with valid JSON (no markdown, no backticks):
{ "summary": "professional summary text" }`;

    try {
      const res = await fetch("/api/generate-flha", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const text = data.content?.map(b => b.text || "").join("") || "";
      const a = text.indexOf("{"), b = text.lastIndexOf("}");
      if (a === -1 || b === -1) throw new Error("bad response");
      const parsed = JSON.parse(text.slice(a, b + 1));
      setAiSummary(parsed.summary || "");
      setStep("review");
    } catch (e) {
      setGenError(true);
    }
    setLoading(false);
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

  const submit = async () => {
    setSigned(true); setSaving(true);
    const sig = hasSignature && canvasEl ? canvasEl.toDataURL("image/png") : null;

    const items = questions.map(q => ({
      question: q.question_text,
      answer: answers[q.id]?.answer,
      note: answers[q.id]?.note || "",
    }));

    const pdfUrl = await generateAndUploadMonthlyInspection({
      formTitle: form.title, siteName: siteName(), companyName, companyLogo,
      monthLabel: new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long" }),
      submittedBy: workerName, aiSummary, items, signatureDataUrl: sig,
    });

    try {
      await fetch("/api/monthly", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_monthly", token,
          siteId, formId: form.id, submittedBy: workerName, aiSummary, pdfUrl,
          answers: questions.map(q => ({ questionId: q.id, answer: answers[q.id]?.answer, note: answers[q.id]?.note || "" })),
        }),
      });
    } catch (e) {
      console.error("Monthly inspection save failed:", e);
    }
    setSaving(false);
    setStep("done");
  };

  const s = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#F0F4F8", minHeight: "100vh", padding: 16 },
    header: { background: "linear-gradient(135deg,#3730A3,#4338CA)", borderRadius: 14, padding: "18px 20px", marginBottom: 16, color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" },
    card: { background: "#fff", borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: "0 1px 3px #0f172a12" },
    label: { display: "block", fontWeight: 700, fontSize: 12, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 },
    input: { width: "100%", padding: "11px 13px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 11, background: "#F8FAFC" },
    btn: (bg, fg = "#fff") => ({ background: bg, color: fg, border: "none", borderRadius: 10, padding: "13px", fontWeight: 800, fontSize: 15, cursor: "pointer", width: "100%" }),
    ghost: { background: "#F1F5F9", color: "#334155", border: "none", borderRadius: 10, padding: "11px", fontWeight: 600, fontSize: 14, cursor: "pointer", width: "100%", marginTop: 10 },
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {companyLogo ? <img src={companyLogo} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: "cover", background: "#fff" }} /> : <span style={{ fontSize: 26 }}>🗓️</span>}
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>Monthly Site Inspection</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{new Date().toLocaleDateString("en-CA", { month: "long", year: "numeric" })}</div>
          </div>
        </div>
        <button onClick={onBack} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>← Menu</button>
      </div>

      {/* STEP: pick site */}
      {step === "site" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: "#1E293B" }}>Select site</div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 16 }}>Which site is this month's inspection for?</div>
          {sites.length > 0 ? (
            <select style={s.input} value={siteId} onChange={e => setSiteId(e.target.value)}>
              <option value="">Select a site…</option>
              {sites.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          ) : (
            <div style={{ fontSize: 13, color: "#94A3B8", marginBottom: 11 }}>No sites registered for this company yet. Ask your admin to add one.</div>
          )}
          {genError && <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: "#991B1B" }}>Couldn't check this site. Try again.</div>}
          <button style={s.btn(checking ? "#94A3B8" : siteId ? "#4338CA" : "#94A3B8")} disabled={checking || !siteId} onClick={checkSiteAndProceed}>
            {checking ? "⏳ Checking…" : "Continue →"}
          </button>
        </div>
      )}

      {/* STEP: no active form for this company */}
      {step === "none" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>🗓️</div>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#1E293B", marginBottom: 6 }}>No monthly inspection set up</div>
            <div style={{ fontSize: 14, color: "#64748B", marginBottom: 18 }}>Your company doesn't have an active monthly inspection form yet. Ask your admin to set one up.</div>
            <button style={s.btn("#4338CA")} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}

      {/* STEP: duplicate this month */}
      {step === "duplicate" && existingRecord && (
        <>
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: "#1E293B" }}>{siteName()}</div>
            <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 10, padding: "12px 14px", marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#92400E", marginBottom: 2 }}>Already submitted this month</div>
              <div style={{ fontSize: 13, color: "#374151" }}>
                {existingRecord.submitted_by} · {new Date(existingRecord.created_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
              </div>
            </div>
          </div>
          <div style={s.card}>
            <button style={s.btn("#4338CA")} onClick={() => setStep("questions")}>Submit Another Inspection Anyway</button>
            <button style={s.ghost} onClick={onBack}>Back to menu</button>
          </div>
        </>
      )}

      {/* STEP: questions */}
      {step === "questions" && form && (
        <>
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#1E293B" }}>{form.title}</div>
            <div style={{ fontSize: 13, color: "#64748B", marginTop: 2 }}>{siteName()}</div>
            <label style={{ ...s.label, marginTop: 14 }}>Your name</label>
            <input style={{ ...s.input, marginBottom: 0 }} placeholder="e.g. John Smith" value={workerName} onChange={e => setWorkerName(e.target.value)} />
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
                  <textarea style={{ ...s.input, minHeight: 70, resize: "vertical", fontFamily: "inherit", marginBottom: 0 }} placeholder="What's the issue? This becomes a corrective action." value={a.note} onChange={e => setNote(q.id, e.target.value)} />
                )}
              </div>
            );
          })}

          {genError && <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: "#991B1B" }}>Couldn't generate the summary. Check your connection and try again.</div>}
          <button style={s.btn(loading ? "#94A3B8" : (workerName && allAnswered && notesComplete) ? "#4338CA" : "#94A3B8")} disabled={loading || !workerName || !allAnswered || !notesComplete} onClick={generateSummary}>
            {loading ? "⏳ Writing summary…" : "Generate Summary"}
          </button>
          <button style={s.ghost} onClick={() => setStep("site")}>← Back</button>
        </>
      )}

      {/* STEP: review */}
      {step === "review" && (
        <>
          <div style={s.card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#4338CA", textTransform: "uppercase", letterSpacing: 0.5 }}>{form.title}</div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{siteName()} · By {workerName}</div>
          </div>

          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#4338CA", marginBottom: 8 }}>Summary</div>
            <textarea style={{ ...s.input, minHeight: 90, resize: "vertical", fontFamily: "inherit", marginBottom: 0 }} value={aiSummary} onChange={e => setAiSummary(e.target.value)} />
          </div>

          {flaggedItems.length > 0 && (
            <div style={{ ...s.card, background: "#FEF2F2", border: "1.5px solid #FCA5A5" }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: "#991B1B", marginBottom: 8 }}>{flaggedItems.length} item{flaggedItems.length > 1 ? "s" : ""} flagged — corrective action will be logged</div>
              {flaggedItems.map(q => (
                <div key={q.id} style={{ fontSize: 13, color: "#7F1D1D", marginBottom: 6 }}>
                  • <strong>{q.question_text}</strong>{answers[q.id]?.note ? `: ${answers[q.id].note}` : ""}
                </div>
              ))}
            </div>
          )}

          <button style={s.btn("#4338CA")} onClick={() => setStep("sign")}>Continue to Sign →</button>
          <button style={s.ghost} onClick={() => setStep("questions")}>← Back</button>
        </>
      )}

      {/* STEP: sign */}
      {step === "sign" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, color: "#1E293B" }}>Sign & Submit</div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 14 }}>Sign to confirm this inspection is accurate and complete.</div>
          <label style={s.label}>Signature</label>
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
          <button style={s.btn(saving ? "#94A3B8" : hasSignature ? "#16A34A" : "#94A3B8")} disabled={saving || !hasSignature} onClick={submit}>
            {saving ? "Submitting…" : "Sign & Submit Inspection"}
          </button>
          <button style={s.ghost} onClick={() => setStep("review")}>← Back</button>
        </div>
      )}

      {/* STEP: done */}
      {step === "done" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 60, marginBottom: 12 }}>{flaggedItems.length > 0 ? "⚠️" : "✅"}</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: "#1E293B", marginBottom: 6 }}>Inspection Submitted</div>
            <div style={{ fontSize: 14, color: "#64748B", marginBottom: 8 }}>{siteName()} · {new Date().toLocaleDateString("en-CA", { month: "long", year: "numeric" })}</div>
            {flaggedItems.length > 0 && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: 14, marginBottom: 18, textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#991B1B" }}>{flaggedItems.length} corrective action{flaggedItems.length > 1 ? "s" : ""} logged</div>
                <div style={{ fontSize: 13, color: "#B91C1C", marginTop: 2 }}>Your supervisor will assign follow-up.</div>
              </div>
            )}
            <button style={s.btn("#4338CA")} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}
    </div>
  );
}
