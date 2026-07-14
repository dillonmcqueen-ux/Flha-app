import { useState, useRef, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { generateAndUploadIncident } from "./generateIncidentPDF";

const INCIDENT_TYPES = [
  "Injury / Illness",
  "Property / Equipment Damage",
  "Environmental Spill",
  "Vehicle Incident",
  "Near Miss Escalated",
];

const SEVERITY = {
  Low: { color: "#16A34A", bg: "#F0FDF4", border: "#86EFAC" },
  Medium: { color: "#D97706", bg: "#FFFBEB", border: "#FCD34D" },
  High: { color: "#DC2626", bg: "#FEF2F2", border: "#FCA5A5" },
  Critical: { color: "#FFFFFF", bg: "#7F1D1D", border: "#7F1D1D" },
};
const SEVERITY_LEVELS = ["Low", "Medium", "High", "Critical"];

export default function Incident({ companyId, companyName, onBack, onLogout }) {
  const [step, setStep] = useState("setup"); // setup | details | describe | review | sign | done
  const [reporter, setReporter] = useState("");
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

  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [genError, setGenError] = useState(false);
  const [report, setReport] = useState(null);
  const [companyLogo, setCompanyLogo] = useState("");

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

  const updateList = (field, idx, val) => setReport(prev => ({ ...prev, [field]: prev[field].map((x, i) => i === idx ? val : x) }));
  const removeListItem = (field, idx) => setReport(prev => ({ ...prev, [field]: prev[field].filter((_, i) => i !== idx) }));
  const addListItem = (field) => setReport(prev => ({ ...prev, [field]: [...(prev[field] || []), ""] }));
  const updateText = (field, val) => setReport(prev => ({ ...prev, [field]: val }));

  const submit = async () => {
    setSigned(true);
    setSaving(true);
    const sig = hasSignature ? canvasRef.current.toDataURL("image/png") : null;
    const meta = { reporter, site, occurredAt, incidentType, injuredPerson, bodyPart, treatment, medicalAttention, witnesses, evidence };
    const pdfUrl = await generateAndUploadIncident({ ...meta, report, companyName, companyLogo, signatureDataUrl: sig });
    await supabase.from("incidents").insert({
      company_id: companyId,
      reporter_name: reporter,
      site, occurred_at: occurredAt, incident_type: incidentType,
      injured_person: injuredPerson, body_part: bodyPart, treatment,
      medical_attention: medicalAttention, witnesses, evidence,
      report_json: report,
      signed_by: reporter,
      pdf_url: pdfUrl || null,
    });
    setSaving(false);
    setStep("done");
  };

  const s = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#F0F4F8", minHeight: "100vh", padding: 16 },
    header: { background: "linear-gradient(135deg,#991B1B,#DC2626)", borderRadius: 14, padding: "18px 20px", marginBottom: 16, color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" },
    card: { background: "#fff", borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: "0 1px 3px #0f172a12" },
    label: { display: "block", fontWeight: 700, fontSize: 12, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 },
    input: { width: "100%", padding: "11px 13px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 11, background: "#F8FAFC" },
    btn: (bg, fg = "#fff") => ({ background: bg, color: fg, border: "none", borderRadius: 10, padding: "13px", fontWeight: 800, fontSize: 15, cursor: "pointer", width: "100%" }),
    ghost: { background: "#F1F5F9", color: "#334155", border: "none", borderRadius: 10, padding: "11px", fontWeight: 600, fontSize: 14, cursor: "pointer", width: "100%", marginTop: 10 },
    section: { fontWeight: 800, fontSize: 15, color: "#991B1B", marginBottom: 8 },
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {companyLogo ? <img src={companyLogo} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: "cover", background: "#fff" }} /> : <span style={{ fontSize: 26 }}>🚑</span>}
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>Incident Report</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Formal incident record</div>
          </div>
        </div>
        <button onClick={onBack} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>← Menu</button>
      </div>

      {/* SETUP */}
      {step === "setup" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 12, color: "#1E293B" }}>Incident details</div>

          <label style={s.label}>Your name</label>
          <input style={s.input} placeholder="Reporter name" value={reporter} onChange={e => setReporter(e.target.value)} />

          <label style={s.label}>Incident type</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
            {INCIDENT_TYPES.map(t => (
              <button key={t} onClick={() => setIncidentType(t)} style={{ padding: "10px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "left", border: `1.5px solid ${incidentType === t ? "#DC2626" : "#E2E8F0"}`, background: incidentType === t ? "#FEF2F2" : "#fff", color: incidentType === t ? "#991B1B" : "#64748B" }}>{t}</button>
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

          <button style={s.btn((reporter && site) ? "#DC2626" : "#94A3B8")} disabled={!reporter || !site} onClick={() => setStep("details")}>Continue →</button>
        </div>
      )}

      {/* DETAILS */}
      {step === "details" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: "#1E293B" }}>People & evidence</div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 14 }}>Fill in what applies. Leave blank anything not relevant to this incident.</div>

          <label style={s.label}>Injured person (if any)</label>
          <input style={s.input} placeholder="Name of injured person" value={injuredPerson} onChange={e => setInjuredPerson(e.target.value)} />

          <label style={s.label}>Body part affected</label>
          <input style={s.input} placeholder="e.g. Left hand" value={bodyPart} onChange={e => setBodyPart(e.target.value)} />

          <label style={s.label}>Treatment given</label>
          <input style={s.input} placeholder="e.g. Cleaned and bandaged on site" value={treatment} onChange={e => setTreatment(e.target.value)} />

          <label style={s.label}>Medical attention required?</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {["None", "First Aid", "Medical Aid", "Hospital"].map(m => (
              <button key={m} onClick={() => setMedicalAttention(m)} style={{ flex: 1, padding: "9px 4px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${medicalAttention === m ? "#DC2626" : "#E2E8F0"}`, background: medicalAttention === m ? "#FEF2F2" : "#fff", color: medicalAttention === m ? "#991B1B" : "#94A3B8" }}>{m}</button>
            ))}
          </div>

          <label style={s.label}>Witnesses</label>
          <input style={s.input} placeholder="Names of anyone who saw it" value={witnesses} onChange={e => setWitnesses(e.target.value)} />

          <label style={s.label}>Evidence on file</label>
          <textarea style={{ ...s.input, minHeight: 70, resize: "vertical", fontFamily: "inherit" }} placeholder="Describe any photos, videos, or physical evidence and where it's stored (e.g. 4 photos of the damaged scaffold on my phone, emailed to supervisor)" value={evidence} onChange={e => setEvidence(e.target.value)} />

          <button style={s.btn("#DC2626")} onClick={() => setStep("describe")}>Continue →</button>
          <button style={s.ghost} onClick={() => setStep("setup")}>← Back</button>
        </div>
      )}

      {/* DESCRIBE */}
      {step === "describe" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: "#1E293B" }}>What happened?</div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 14 }}>Describe the incident in your own words — what led up to it, what happened, and what was done. The AI will structure it into a formal report.</div>
          <textarea style={{ ...s.input, minHeight: 150, resize: "vertical", fontFamily: "inherit" }} placeholder="e.g. Worker was carrying a sheet of plywood when a gust of wind caught it. He lost his grip and the edge struck his forearm, causing a deep cut. We stopped work, applied first aid, and drove him to the clinic for stitches." value={description} onChange={e => setDescription(e.target.value)} />
          {genError && <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: "#991B1B" }}>Couldn't generate the report. Check your connection and try again.</div>}
          <button style={s.btn(loading ? "#94A3B8" : description.trim() ? "#DC2626" : "#94A3B8")} disabled={loading || !description.trim()} onClick={generateReport}>
            {loading ? "⏳ Structuring report…" : "Generate Report"}
          </button>
          <button style={s.ghost} onClick={() => setStep("details")}>← Back</button>
        </div>
      )}

      {/* REVIEW */}
      {step === "review" && report && (
        <>
          <div style={s.card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#991B1B", textTransform: "uppercase", letterSpacing: 0.5 }}>{incidentType} — Incident Report</div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{reporter} · {site}{occurredAt ? ` · ${occurredAt}` : ""}</div>
          </div>

          {/* Severity */}
          <div style={{ ...s.card, background: (SEVERITY[report.severity] || SEVERITY.Medium).bg, border: `1.5px solid ${(SEVERITY[report.severity] || SEVERITY.Medium).border}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Incident Severity</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {SEVERITY_LEVELS.map(lvl => {
                const sel = report.severity === lvl;
                const c = SEVERITY[lvl];
                return (
                  <button key={lvl} onClick={() => updateText("severity", lvl)} style={{ flex: 1, padding: "10px 4px", borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: "pointer", border: `1.5px solid ${sel ? c.color : "#E2E8F0"}`, background: sel ? c.bg : "#fff", color: sel ? c.color : "#94A3B8", boxShadow: sel && lvl === "Critical" ? "inset 0 0 0 2px #7F1D1D" : "none" }}>{lvl}</button>
                );
              })}
            </div>
            {report.severityReason && <div style={{ fontSize: 13, color: "#475569", fontStyle: "italic" }}>{report.severityReason}</div>}
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>AI-suggested — tap to adjust</div>
          </div>

          <div style={s.card}>
            <div style={s.section}>Summary</div>
            <textarea style={{ ...s.input, minHeight: 80, resize: "vertical", fontFamily: "inherit", marginBottom: 0 }} value={report.summary} onChange={e => updateText("summary", e.target.value)} />
          </div>

          <ListEditor s={s} title="Sequence of Events" field="sequenceOfEvents" report={report} updateList={updateList} removeListItem={removeListItem} addListItem={addListItem} />
          <ListEditor s={s} title="Contributing Factors" field="contributingFactors" report={report} updateList={updateList} removeListItem={removeListItem} addListItem={addListItem} />

          <div style={s.card}>
            <div style={s.section}>Root Cause</div>
            <textarea style={{ ...s.input, minHeight: 60, resize: "vertical", fontFamily: "inherit", marginBottom: 0 }} value={report.rootCause} onChange={e => updateText("rootCause", e.target.value)} />
          </div>

          <ListEditor s={s} title="Immediate Actions Taken" field="immediateActions" report={report} updateList={updateList} removeListItem={removeListItem} addListItem={addListItem} />
          <ListEditor s={s} title="Corrective Actions" field="correctiveActions" report={report} updateList={updateList} removeListItem={removeListItem} addListItem={addListItem} />

          <button style={s.btn("#DC2626")} onClick={() => setStep("sign")}>Continue to Sign →</button>
          <button style={s.ghost} onClick={() => setStep("describe")}>← Back</button>
        </>
      )}

      {/* SIGN */}
      {step === "sign" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, color: "#1E293B" }}>Sign & Submit</div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 14 }}>Sign to confirm this incident report is accurate and complete to the best of your knowledge.</div>
          <label style={s.label}>Signature</label>
          <div style={{ position: "relative", marginBottom: 6 }}>
            <canvas ref={canvasRef} width={600} height={160}
              style={{ width: "100%", height: 130, border: "1.5px solid #E2E8F0", borderRadius: 10, background: "#fff", touchAction: "none", display: "block" }}
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
            {!hasSignature && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 14, pointerEvents: "none" }}>Sign here</div>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#475569" }}>Reported by: <strong>{reporter}</strong></div>
            <button onClick={clearSig} style={{ background: "transparent", border: "none", color: "#64748B", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Clear</button>
          </div>
          <button style={s.btn(saving ? "#94A3B8" : hasSignature ? "#16A34A" : "#94A3B8")} disabled={saving || !hasSignature} onClick={submit}>
            {saving ? "Submitting…" : "Sign & Submit Report"}
          </button>
          <button style={s.ghost} onClick={() => setStep("review")}>← Back</button>
        </div>
      )}

      {/* DONE */}
      {step === "done" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 60, marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: "#1E293B", marginBottom: 6 }}>Incident Report Filed</div>
            <div style={{ fontSize: 14, color: "#64748B", marginBottom: 8 }}>{incidentType} · {site} · {reporter}</div>
            <div style={{ fontSize: 13, color: "#64748B", marginBottom: 20 }}>This report has been saved and sent to your supervisor's dashboard for review.</div>
            <button style={s.btn("#DC2626")} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ListEditor({ s, title, field, report, updateList, removeListItem, addListItem }) {
  return (
    <div style={s.card}>
      <div style={s.section}>{title}</div>
      {(report[field] || []).map((f, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
          <input style={{ ...s.input, marginBottom: 0 }} value={f} onChange={e => updateList(field, i, e.target.value)} />
          <button onClick={() => removeListItem(field, i)} style={{ background: "#FEF2F2", color: "#DC2626", border: "none", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>✕</button>
        </div>
      ))}
      <button onClick={() => addListItem(field)} style={{ background: "transparent", border: "none", color: "#991B1B", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0 }}>+ Add</button>
    </div>
  );
}
