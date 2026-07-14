import { useState, useRef, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { generateAndUploadNearMiss } from "./generateNearMissPDF";
import { useCustomFields, CustomFieldInputs } from "./customFields.jsx";

const SEVERITY = {
  Low: { color: "#16A34A", bg: "#F0FDF4", border: "#86EFAC" },
  Medium: { color: "#D97706", bg: "#FFFBEB", border: "#FCD34D" },
  High: { color: "#DC2626", bg: "#FEF2F2", border: "#FCA5A5" },
  Critical: { color: "#FFFFFF", bg: "#7F1D1D", border: "#7F1D1D" },
};
const SEVERITY_LEVELS = ["Low", "Medium", "High", "Critical"];

export default function NearMiss({ companyId, companyName, onBack, onLogout }) {
  const [step, setStep] = useState("setup"); // setup | describe | review | sign | done
  const [reporter, setReporter] = useState("");
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
  const cf = useCustomFields(companyId, "nearmiss");

  // editing
  const [editField, setEditField] = useState(null);
  const [editValue, setEditValue] = useState("");

  // signature
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [signed, setSigned] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: st } = await supabase.from("sites").select("id, name").eq("company_id", companyId).order("id");
      setSites(st || []);
      if (!st || st.length === 0) setSiteMode("other");
      const { data: co } = await supabase.from("companies").select("logo_url").eq("id", companyId).limit(1);
      if (co && co[0]) setCompanyLogo(co[0].logo_url || "");
    }
    load();
  }, [companyId]);

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
- Write a clear, factual, professional report based ONLY on what the worker described. Do not invent specifics that weren't provided, but you may reasonably infer contributing factors and sensible corrective steps.
- Keep a neutral, non-blaming tone — near-miss reporting is about learning, not fault.
- "severity": rate the POTENTIAL severity — how bad it realistically could have been if it had gone wrong — as one of "Low", "Medium", "High", or "Critical". Critical = potential fatality or life-altering injury; High = potential serious injury; Medium = potential injury needing medical treatment; Low = minor potential injury.
- "severityReason": one short sentence explaining the rating.
- "whatHappened": a clear 2-4 sentence write-up of the event.
- "contributingFactors": the conditions or actions that led to the near miss (2-4 short points).
- "potentialOutcome": one or two sentences on what could realistically have happened.
- "immediateActions": what was or should have been done right away to make the situation safe (2-3 short points).
- "nextSteps": longer-term recommended actions to prevent recurrence (2-4 short points).

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
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const text = data.content?.map(b => b.text || "").join("") || "";
      const a = text.indexOf("{"), b = text.lastIndexOf("}");
      if (a === -1 || b === -1) throw new Error("bad response");
      const parsed = JSON.parse(text.slice(a, b + 1));
      setReport(parsed);
      setStep("review");
    } catch (e) {
      setGenError(true);
    }
    setLoading(false);
  };

  // editing helpers for list fields
  const updateList = (field, idx, val) => setReport(prev => ({ ...prev, [field]: prev[field].map((x, i) => i === idx ? val : x) }));
  const removeListItem = (field, idx) => setReport(prev => ({ ...prev, [field]: prev[field].filter((_, i) => i !== idx) }));
  const addListItem = (field) => setReport(prev => ({ ...prev, [field]: [...(prev[field] || []), ""] }));
  const updateText = (field, val) => setReport(prev => ({ ...prev, [field]: val }));

  const submit = async () => {
    setSigned(true);
    setSaving(true);
    const sig = hasSignature ? canvasRef.current.toDataURL("image/png") : null;
    const pdfUrl = await generateAndUploadNearMiss({
      reporter: reporterLabel(), site, occurredAt, involved, report, companyName, companyLogo, signatureDataUrl: sig, customFields: cf.entries(),
    });
    await supabase.from("near_misses").insert({
      company_id: companyId,
      reporter_name: reporterLabel(),
      is_anonymous: anonymous,
      site,
      occurred_at: occurredAt,
      involved,
      report_json: { ...report, customFields: cf.entries() },
      signed_by: reporterLabel(),
      pdf_url: pdfUrl || null,
    });
    setSaving(false);
    setStep("done");
  };

  const s = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#F0F4F8", minHeight: "100vh", padding: 16 },
    header: { background: "linear-gradient(135deg,#B45309,#D97706)", borderRadius: 14, padding: "18px 20px", marginBottom: 16, color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" },
    card: { background: "#fff", borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: "0 1px 3px #0f172a12" },
    label: { display: "block", fontWeight: 700, fontSize: 12, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 },
    input: { width: "100%", padding: "11px 13px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 11, background: "#F8FAFC" },
    btn: (bg, fg = "#fff") => ({ background: bg, color: fg, border: "none", borderRadius: 10, padding: "13px", fontWeight: 800, fontSize: 15, cursor: "pointer", width: "100%" }),
    ghost: { background: "#F1F5F9", color: "#334155", border: "none", borderRadius: 10, padding: "11px", fontWeight: 600, fontSize: 14, cursor: "pointer", width: "100%", marginTop: 10 },
    section: { fontWeight: 800, fontSize: 15, color: "#B45309", marginBottom: 8 },
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {companyLogo ? <img src={companyLogo} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: "cover", background: "#fff" }} /> : <span style={{ fontSize: 26 }}>⚠️</span>}
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>Near Miss Report</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Report a close call</div>
          </div>
        </div>
        <button onClick={onBack} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>← Menu</button>
      </div>

      {/* SETUP */}
      {step === "setup" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 12, color: "#1E293B" }}>Report details</div>

          <div onClick={() => setAnonymous(!anonymous)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: anonymous ? "#FFFBEB" : "#F8FAFC", border: `1.5px solid ${anonymous ? "#FCD34D" : "#E2E8F0"}`, borderRadius: 10, marginBottom: 14, cursor: "pointer" }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, background: anonymous ? "#D97706" : "#fff", border: `1.5px solid ${anonymous ? "#D97706" : "#CBD5E1"}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 800 }}>{anonymous ? "✓" : ""}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#1E293B" }}>Report anonymously</div>
              <div style={{ fontSize: 12, color: "#64748B" }}>Your name won't appear on the report</div>
            </div>
          </div>

          {!anonymous && (
            <>
              <label style={s.label}>Your name</label>
              <input style={s.input} placeholder="Reporter name" value={reporter} onChange={e => setReporter(e.target.value)} />
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

          <button style={s.btn((site && (anonymous || reporter)) ? "#D97706" : "#94A3B8")} disabled={!site || (!anonymous && !reporter)} onClick={() => {
            const missing = cf.missingRequired();
            if (missing.length > 0) { alert(`Please fill in: ${missing.join(", ")}`); return; }
            setStep("describe");
          }}>Continue →</button>
        </div>
      )}

      {/* DESCRIBE */}
      {step === "describe" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: "#1E293B" }}>What happened?</div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 14 }}>Describe the near miss in your own words. The AI will structure it into a clean report.</div>
          <textarea style={{ ...s.input, minHeight: 140, resize: "vertical", fontFamily: "inherit" }} placeholder="e.g. I was walking behind the excavator and the operator started to swing without seeing me. I stepped back just in time. There was no spotter and the horn didn't sound." value={description} onChange={e => setDescription(e.target.value)} />
          {genError && <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: "#991B1B" }}>Couldn't generate the report. Check your connection and try again.</div>}
          <button style={s.btn(loading ? "#94A3B8" : description.trim() ? "#D97706" : "#94A3B8")} disabled={loading || !description.trim()} onClick={generateReport}>
            {loading ? "⏳ Structuring report…" : "Generate Report"}
          </button>
          <button style={s.ghost} onClick={() => setStep("setup")}>← Back</button>
        </div>
      )}

      {/* REVIEW */}
      {step === "review" && report && (
        <>
          <div style={s.card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#B45309", textTransform: "uppercase", letterSpacing: 0.5 }}>Near Miss Incident Report</div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{reporterLabel()} · {site}{occurredAt ? ` · ${occurredAt}` : ""}</div>
          </div>

          {/* Severity index */}
          <div style={{ ...s.card, background: (SEVERITY[report.severity] || SEVERITY.Medium).bg, border: `1.5px solid ${(SEVERITY[report.severity] || SEVERITY.Medium).border}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Potential Severity</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {SEVERITY_LEVELS.map(lvl => {
                const sel = report.severity === lvl;
                const c = SEVERITY[lvl];
                return (
                  <button key={lvl} onClick={() => updateText("severity", lvl)} style={{
                    flex: 1, padding: "10px 4px", borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: "pointer",
                    border: `1.5px solid ${sel ? c.color : "#E2E8F0"}`,
                    background: sel ? c.bg : "#fff",
                    color: sel ? c.color : "#94A3B8",
                    boxShadow: sel && lvl === "Critical" ? "inset 0 0 0 2px #7F1D1D" : "none",
                  }}>{lvl}</button>
                );
              })}
            </div>
            {report.severityReason && <div style={{ fontSize: 13, color: "#475569", fontStyle: "italic" }}>{report.severityReason}</div>}
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>AI-suggested — tap to adjust</div>
          </div>

          <div style={s.card}>
            <div style={s.section}>What Happened</div>
            <textarea style={{ ...s.input, minHeight: 80, resize: "vertical", fontFamily: "inherit", marginBottom: 0 }} value={report.whatHappened} onChange={e => updateText("whatHappened", e.target.value)} />
          </div>

          <div style={s.card}>
            <div style={s.section}>Contributing Factors</div>
            {(report.contributingFactors || []).map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
                <input style={{ ...s.input, marginBottom: 0 }} value={f} onChange={e => updateList("contributingFactors", i, e.target.value)} />
                <button onClick={() => removeListItem("contributingFactors", i)} style={{ background: "#FEF2F2", color: "#DC2626", border: "none", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>✕</button>
              </div>
            ))}
            <button onClick={() => addListItem("contributingFactors")} style={{ background: "transparent", border: "none", color: "#B45309", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0 }}>+ Add factor</button>
          </div>

          <div style={s.card}>
            <div style={s.section}>Potential Outcome</div>
            <textarea style={{ ...s.input, minHeight: 60, resize: "vertical", fontFamily: "inherit", marginBottom: 0 }} value={report.potentialOutcome} onChange={e => updateText("potentialOutcome", e.target.value)} />
          </div>

          <div style={s.card}>
            <div style={s.section}>Immediate Actions Taken</div>
            {(report.immediateActions || []).map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
                <input style={{ ...s.input, marginBottom: 0 }} value={f} onChange={e => updateList("immediateActions", i, e.target.value)} />
                <button onClick={() => removeListItem("immediateActions", i)} style={{ background: "#FEF2F2", color: "#DC2626", border: "none", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>✕</button>
              </div>
            ))}
            <button onClick={() => addListItem("immediateActions")} style={{ background: "transparent", border: "none", color: "#B45309", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0 }}>+ Add action</button>
          </div>

          <div style={s.card}>
            <div style={s.section}>Recommended Next Steps</div>
            {(report.nextSteps || []).map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
                <input style={{ ...s.input, marginBottom: 0 }} value={f} onChange={e => updateList("nextSteps", i, e.target.value)} />
                <button onClick={() => removeListItem("nextSteps", i)} style={{ background: "#FEF2F2", color: "#DC2626", border: "none", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>✕</button>
              </div>
            ))}
            <button onClick={() => addListItem("nextSteps")} style={{ background: "transparent", border: "none", color: "#B45309", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0 }}>+ Add step</button>
          </div>

          <button style={s.btn("#D97706")} onClick={() => setStep("sign")}>Continue to Sign →</button>
          <button style={s.ghost} onClick={() => setStep("describe")}>← Back</button>
        </>
      )}

      {/* SIGN */}
      {step === "sign" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, color: "#1E293B" }}>{anonymous ? "Confirm & Submit" : "Sign & Submit"}</div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 14 }}>{anonymous ? "This report will be submitted anonymously." : "Sign to confirm this report is accurate."}</div>

          {!anonymous && (
            <>
              <label style={s.label}>Signature</label>
              <div style={{ position: "relative", marginBottom: 6 }}>
                <canvas ref={canvasRef} width={600} height={160}
                  style={{ width: "100%", height: 130, border: "1.5px solid #E2E8F0", borderRadius: 10, background: "#fff", touchAction: "none", display: "block" }}
                  onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                  onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
                {!hasSignature && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 14, pointerEvents: "none" }}>Sign here</div>}
              </div>
              <div style={{ textAlign: "right", marginBottom: 12 }}>
                <button onClick={clearSig} style={{ background: "transparent", border: "none", color: "#64748B", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Clear</button>
              </div>
            </>
          )}

          <button style={s.btn(saving ? "#94A3B8" : (anonymous || hasSignature) ? "#16A34A" : "#94A3B8")} disabled={saving || (!anonymous && !hasSignature)} onClick={submit}>
            {saving ? "Submitting…" : anonymous ? "Submit Report" : "Sign & Submit Report"}
          </button>
          <button style={s.ghost} onClick={() => setStep("review")}>← Back</button>
        </div>
      )}

      {/* DONE */}
      {step === "done" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 60, marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: "#1E293B", marginBottom: 6 }}>Near Miss Reported</div>
            <div style={{ fontSize: 14, color: "#64748B", marginBottom: 8 }}>{site} · {reporterLabel()}</div>
            <div style={{ fontSize: 13, color: "#64748B", marginBottom: 20 }}>Thank you for reporting. Near-miss reports help prevent injuries before they happen.</div>
            <button style={s.btn("#D97706")} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}
    </div>
  );
}
