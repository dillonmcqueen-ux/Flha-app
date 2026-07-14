import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { generateAndUploadDaily } from "./generateDailyPDF";
import { useCustomFields, CustomFieldInputs } from "./customFields.jsx";

const WEATHER = ["Clear", "Cloudy", "Rain", "Snow", "Windy", "Hot", "Cold"];

export default function DailyReport({ companyId, companyName, onBack, onLogout }) {
  const [step, setStep] = useState("setup"); // setup | notes | review | done
  const [reporter, setReporter] = useState("");
  const [site, setSite] = useState("");
  const [sites, setSites] = useState([]);
  const [siteMode, setSiteMode] = useState("list");
  const [reportDate, setReportDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [weather, setWeather] = useState("Clear");
  const [temperature, setTemperature] = useState("");
  const [crew, setCrew] = useState("");
  const [equipment, setEquipment] = useState("");
  const [visitors, setVisitors] = useState("");

  const [workDone, setWorkDone] = useState("");
  const [delays, setDelays] = useState("");
  const [tomorrow, setTomorrow] = useState("");

  const [loading, setLoading] = useState(false);
  const [genError, setGenError] = useState(false);
  const [report, setReport] = useState(null); // { workSummary, delaysSummary, tomorrowPlan }
  const [companyLogo, setCompanyLogo] = useState("");
  const cf = useCustomFields(companyId, "daily");
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

  const generateReport = async () => {
    setLoading(true); setGenError(false);
    const prompt = `You are a construction site supervisor writing a professional end-of-day site daily report from rough field notes. Turn the notes into clean, professional prose suitable for a project manager or client to read. Do not invent details not present in the notes; just clean up, organize, and professionalize what's given.

Company: ${companyName}
Site: ${site}
Date: ${reportDate}
Weather: ${weather}${temperature ? `, ${temperature}` : ""}
Crew on site: ${crew || "not specified"}
Equipment used: ${equipment || "not specified"}
Visitors: ${visitors || "none"}

Rough notes — WORK COMPLETED: "${workDone}"
Rough notes — DELAYS / ISSUES: "${delays || "none reported"}"
Rough notes — PLAN FOR TOMORROW: "${tomorrow || "not specified"}"

INSTRUCTIONS:
- "workSummary": a clean, professional 2-5 sentence summary of the work completed today, based on the notes.
- "delaysSummary": a clear write-up of any delays, issues, or downtime. If none were reported, return "No delays or issues reported.".
- "tomorrowPlan": a clean summary of the plan for tomorrow. If not specified, return "Not specified.".
- Keep it factual and professional. Do not add safety commentary or invented specifics.

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "workSummary": "professional summary",
  "delaysSummary": "delays write-up",
  "tomorrowPlan": "tomorrow summary"
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

  const updateText = (field, val) => setReport(prev => ({ ...prev, [field]: val }));

  const submit = async () => {
    setSaving(true);
    const meta = { reporter, site, reportDate, weather, temperature, crew, equipment, visitors, customFields: cf.entries() };
    const pdfUrl = await generateAndUploadDaily({ ...meta, report, companyName, companyLogo });
    await supabase.from("daily_reports").insert({
      company_id: companyId,
      reporter_name: reporter,
      site, report_date: reportDate, weather, temperature,
      crew, equipment, visitors,
      report_json: { ...report, customFields: cf.entries() },
      pdf_url: pdfUrl || null,
    });
    setSaving(false);
    setStep("done");
  };

  const s = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#F0F4F8", minHeight: "100vh", padding: 16 },
    header: { background: "linear-gradient(135deg,#15803D,#16A34A)", borderRadius: 14, padding: "18px 20px", marginBottom: 16, color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" },
    card: { background: "#fff", borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: "0 1px 3px #0f172a12" },
    label: { display: "block", fontWeight: 700, fontSize: 12, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 },
    input: { width: "100%", padding: "11px 13px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 11, background: "#F8FAFC" },
    btn: (bg, fg = "#fff") => ({ background: bg, color: fg, border: "none", borderRadius: 10, padding: "13px", fontWeight: 800, fontSize: 15, cursor: "pointer", width: "100%" }),
    ghost: { background: "#F1F5F9", color: "#334155", border: "none", borderRadius: 10, padding: "11px", fontWeight: 600, fontSize: 14, cursor: "pointer", width: "100%", marginTop: 10 },
    section: { fontWeight: 800, fontSize: 15, color: "#15803D", marginBottom: 8 },
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {companyLogo ? <img src={companyLogo} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: "cover", background: "#fff" }} /> : <span style={{ fontSize: 26 }}>📋</span>}
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>Daily Report</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>End-of-day site summary</div>
          </div>
        </div>
        <button onClick={onBack} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>← Menu</button>
      </div>

      {/* SETUP */}
      {step === "setup" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 12, color: "#1E293B" }}>Site & conditions</div>

          <label style={s.label}>Your name</label>
          <input style={s.input} placeholder="Reporter name" value={reporter} onChange={e => setReporter(e.target.value)} />

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

          <label style={s.label}>Date</label>
          <input style={s.input} value={reportDate} onChange={e => setReportDate(e.target.value)} />

          <label style={s.label}>Weather</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 11 }}>
            {WEATHER.map(w => (
              <button key={w} onClick={() => setWeather(w)} style={{ flex: "1 1 28%", padding: "9px 4px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${weather === w ? "#16A34A" : "#E2E8F0"}`, background: weather === w ? "#F0FDF4" : "#fff", color: weather === w ? "#15803D" : "#94A3B8" }}>{w}</button>
            ))}
          </div>

          <label style={s.label}>Temperature (optional)</label>
          <input style={s.input} placeholder="e.g. 18°C" value={temperature} onChange={e => setTemperature(e.target.value)} />

          <CustomFieldInputs cf={cf} labelStyle={s.label} inputStyle={s.input} />

          <button style={s.btn((reporter && site) ? "#16A34A" : "#94A3B8")} disabled={!reporter || !site} onClick={() => {
            const missing = cf.missingRequired();
            if (missing.length > 0) { alert(`Please fill in: ${missing.join(", ")}`); return; }
            setStep("notes");
          }}>Continue →</button>
        </div>
      )}

      {/* NOTES */}
      {step === "notes" && (
        <>
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: "#1E293B" }}>Crew, equipment & visitors</div>
            <label style={s.label}>Crew on site + hours</label>
            <input style={s.input} placeholder="e.g. 4 laborers, 1 operator — 8 hrs each" value={crew} onChange={e => setCrew(e.target.value)} />
            <label style={s.label}>Equipment used</label>
            <input style={s.input} placeholder="e.g. Excavator, skid steer, compactor" value={equipment} onChange={e => setEquipment(e.target.value)} />
            <label style={s.label}>Visitors on site (optional)</label>
            <input style={s.input} placeholder="e.g. Site inspector at 10am" value={visitors} onChange={e => setVisitors(e.target.value)} />
          </div>

          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: "#1E293B" }}>The day's notes</div>
            <div style={{ fontSize: 13, color: "#64748B", marginBottom: 12 }}>Jot rough notes — the AI will clean each into a professional summary.</div>

            <label style={s.label}>Work completed today</label>
            <textarea style={{ ...s.input, minHeight: 90, resize: "vertical", fontFamily: "inherit" }} placeholder="e.g. dug footings north side, poured 2 piers, backfilled east trench" value={workDone} onChange={e => setWorkDone(e.target.value)} />

            <label style={s.label}>Delays / issues / downtime</label>
            <textarea style={{ ...s.input, minHeight: 70, resize: "vertical", fontFamily: "inherit" }} placeholder="e.g. concrete truck 2 hrs late, rain stopped work 1pm-2pm" value={delays} onChange={e => setDelays(e.target.value)} />

            <label style={s.label}>Plan for tomorrow</label>
            <textarea style={{ ...s.input, minHeight: 70, resize: "vertical", fontFamily: "inherit" }} placeholder="e.g. strip forms, pour remaining piers, start south footings" value={tomorrow} onChange={e => setTomorrow(e.target.value)} />

            {genError && <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: "#991B1B" }}>Couldn't generate the report. Check your connection and try again.</div>}
            <button style={s.btn(loading ? "#94A3B8" : workDone.trim() ? "#16A34A" : "#94A3B8")} disabled={loading || !workDone.trim()} onClick={generateReport}>
              {loading ? "⏳ Writing report…" : "Generate Report"}
            </button>
            <button style={s.ghost} onClick={() => setStep("setup")}>← Back</button>
          </div>
        </>
      )}

      {/* REVIEW */}
      {step === "review" && report && (
        <>
          <div style={s.card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#15803D", textTransform: "uppercase", letterSpacing: 0.5 }}>Daily Report</div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{site} · {reportDate} · {weather}{temperature ? `, ${temperature}` : ""}</div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>By {reporter}</div>
          </div>

          {(crew || equipment || visitors) && (
            <div style={s.card}>
              {crew && <div style={{ fontSize: 13, color: "#374151", marginBottom: 4 }}><strong>Crew:</strong> {crew}</div>}
              {equipment && <div style={{ fontSize: 13, color: "#374151", marginBottom: 4 }}><strong>Equipment:</strong> {equipment}</div>}
              {visitors && <div style={{ fontSize: 13, color: "#374151" }}><strong>Visitors:</strong> {visitors}</div>}
            </div>
          )}

          <div style={s.card}>
            <div style={s.section}>Work Completed</div>
            <textarea style={{ ...s.input, minHeight: 100, resize: "vertical", fontFamily: "inherit", marginBottom: 0 }} value={report.workSummary} onChange={e => updateText("workSummary", e.target.value)} />
          </div>

          <div style={s.card}>
            <div style={s.section}>Delays / Issues</div>
            <textarea style={{ ...s.input, minHeight: 70, resize: "vertical", fontFamily: "inherit", marginBottom: 0 }} value={report.delaysSummary} onChange={e => updateText("delaysSummary", e.target.value)} />
          </div>

          <div style={s.card}>
            <div style={s.section}>Plan for Tomorrow</div>
            <textarea style={{ ...s.input, minHeight: 70, resize: "vertical", fontFamily: "inherit", marginBottom: 0 }} value={report.tomorrowPlan} onChange={e => updateText("tomorrowPlan", e.target.value)} />
          </div>

          <button style={s.btn(saving ? "#94A3B8" : "#16A34A")} disabled={saving} onClick={submit}>
            {saving ? "Submitting…" : "Submit Daily Report"}
          </button>
          <button style={s.ghost} onClick={() => setStep("notes")}>← Back</button>
        </>
      )}

      {/* DONE */}
      {step === "done" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 60, marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: "#1E293B", marginBottom: 6 }}>Daily Report Submitted</div>
            <div style={{ fontSize: 14, color: "#64748B", marginBottom: 20 }}>{site} · {reportDate}</div>
            <button style={s.btn("#16A34A")} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}
    </div>
  );
}
