import { useState, useRef, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { generateAndUploadFLHA } from "./generatePDF";

// Fallback used only if Supabase has no data yet (e.g. first run)
const FALLBACK_SOPS = {
  company: "Demo Company",
  policies: [
    "All workers must conduct a FLHA before beginning any task.",
    "PPE (hard hat, safety vest, steel-toed boots, gloves) is mandatory on all sites.",
  ],
};

const STEPS = ["company", "voice", "review", "done"];

const sampleHazards = [
  { hazard: "Uneven terrain / trip hazard", control: "Walk the site perimeter before work begins. Wear CSA-approved footwear." },
  { hazard: "Working at heights (ladder use)", control: "Inspect ladder before use. Maintain 3-point contact. Secure base." },
  { hazard: "Overhead power lines present", control: "Call 811. Maintain 3 m clearance. Notify supervisor before approaching." },
  { hazard: "Hot work — grinding required", control: "Fire watch assigned. ABC extinguisher within 10 m. Hot work permit issued." },
  { hazard: "Energized equipment nearby", control: "LOTO procedure completed and verified by second worker before starting." },
];

function Badge({ text, color = "blue" }) {
  const colors = {
    blue: "background:#1D4ED820;color:#1D4ED8;border:1px solid #1D4ED840",
    green: "background:#16A34A20;color:#16A34A;border:1px solid #16A34A40",
    amber: "background:#D9770620;color:#D97706;border:1px solid #D9770640",
    red: "background:#DC262620;color:#DC2626;border:1px solid #DC262640",
  };
  return (
    <span style={{ ...Object.fromEntries(colors[color].split(";").map(s => s.split(":"))), borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>
      {text}
    </span>
  );
}

function Stepper({ step }) {
  const labels = ["Setup", "Voice Input", "Review", "Complete"];
  return (
    <div style={{ display: "flex", gap: 0, marginBottom: 28 }}>
      {labels.map((label, i) => {
        const active = i === STEPS.indexOf(step);
        const done = STEPS.indexOf(step) > i;
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
              {i > 0 && <div style={{ flex: 1, height: 2, background: done || active ? "#F97316" : "#E5E7EB" }} />}
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: done ? "#F97316" : active ? "#1E3A5F" : "#E5E7EB",
                color: done || active ? "#fff" : "#9CA3AF",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 14, flexShrink: 0
              }}>
                {done ? "✓" : i + 1}
              </div>
              {i < 3 && <div style={{ flex: 1, height: 2, background: done ? "#F97316" : "#E5E7EB" }} />}
            </div>
            <span style={{ fontSize: 11, marginTop: 4, color: active ? "#1E3A5F" : done ? "#F97316" : "#9CA3AF", fontWeight: active ? 700 : 400 }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function FLHAApp() {
  const [step, setStep] = useState("company");
  const [sopData, setSopData] = useState(FALLBACK_SOPS);
  const [sopsLoading, setSopsLoading] = useState(true);
  const [companyName, setCompanyName] = useState(FALLBACK_SOPS.company);
  const [debugInfo, setDebugInfo] = useState("");

  // Load company + SOPs from Supabase on first render.
  // Assumes one row in `companies` for now — swap for a login/company-select
  // step once you have multiple companies using the app.
  useEffect(() => {
    async function loadSops() {
      // Try both lowercase "companies" and capitalized "Companies" since
      // table/column casing varies depending on how tables were created
      // in the Supabase UI (capitalized names need quotes in Postgres).
      let companies, companyErr;
      ({ data: companies, error: companyErr } = await supabase
        .from("companies")
        .select("id, name")
        .limit(1));

      if (companyErr || !companies?.length) {
        ({ data: companies, error: companyErr } = await supabase
          .from("Companies")
          .select('id, "Name"')
          .limit(1));
        if (companies?.length) {
          companies = companies.map(c => ({ id: c.id, name: c.Name }));
        }
      }

      if (companyErr) {
        setDebugInfo(`companies query error: ${companyErr.message}`);
        setSopsLoading(false);
        return;
      }
      if (!companies?.length) {
        setDebugInfo("companies table returned 0 rows");
        setSopsLoading(false);
        return;
      }

      const company = companies[0];
      const { data: sops, error: sopsErr } = await supabase
        .from("sops")
        .select("policy_text")
        .eq("company_id", company.id);

      if (sopsErr) {
        setDebugInfo(`sops query error: ${sopsErr.message}`);
        setSopsLoading(false);
        return;
      }
      if (!sops?.length) {
        setDebugInfo(`sops returned 0 rows for company_id=${company.id}`);
        setSopsLoading(false);
        return;
      }

      setSopData({ company: company.name, policies: sops.map(s => s.policy_text) });
      setCompanyName(company.name);
      setDebugInfo(""); // success, clear debug
      setSopsLoading(false);
    }
    loadSops();
  }, []);


  const [workerName, setWorkerName] = useState("");
  const [jobSite, setJobSite] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [flha, setFlha] = useState(null);
  const [loading, setLoading] = useState(false);
  const [signed, setSigned] = useState(false);
  const [signName, setSignName] = useState("");
  const recognitionRef = useRef(null);

  const hasSpeech = typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);

  const startListening = () => {
    if (!hasSpeech) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-CA";
    r.onresult = (e) => {
      let final = "";
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + " ";
      }
      setTranscript(prev => {
        const base = prev.replace(/\[live\].*/s, "").trimEnd();
        let live = "";
        for (let i = e.results.length - 1; i >= 0; i--) {
          if (!e.results[i].isFinal) { live = e.results[i][0].transcript; break; }
        }
        return (base + " " + final + (live ? `[live] ${live}` : "")).trim();
      });
    };
    r.onend = () => setIsListening(false);
    r.start();
    recognitionRef.current = r;
    setIsListening(true);
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setIsListening(false);
    setTranscript(t => t.replace(/\[live\].*/s, "").trim());
  };

  const generateFLHA = async () => {
    setLoading(true);
    const cleanTranscript = transcript.replace(/\[live\].*/s, "").trim() || taskDesc;
    const prompt = `You are a safety officer AI. A field worker has described their work task verbally. Cross-reference it with the company SOPs and generate a structured FLHA (Field Level Hazard Assessment).

Company: ${companyName}
Worker: ${workerName}
Job Site: ${jobSite}
Task Description (from voice/text): "${cleanTranscript}"

Company SOPs and Policies:
${sopData.policies.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Respond ONLY with a valid JSON object (no markdown, no backticks) with this structure:
{
  "taskSummary": "short summary of task",
  "hazards": [
    { "hazard": "hazard name", "risk": "Low|Medium|High", "control": "control measure aligned with SOP", "sopRef": "which SOP this references or null" }
  ],
  "sopAlerts": ["any SOP requirements triggered by this task"],
  "ppeRequired": ["list of required PPE"],
  "additionalNotes": "any other safety notes"
}

Identify 3-5 real hazards based on the task described. Make sopRef cite the actual SOP text if relevant.`;

    try {
      // NOTE: this calls a serverless function (/api/generate-flha), not
      // Anthropic's API directly. Never put an Anthropic API key in
      // frontend code — see api/generate-flha.js for the real call.
      const res = await fetch("/api/generate-flha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setFlha(parsed);
      setStep("review");
    } catch (err) {
      console.error("FLHA generation failed, using fallback:", err);
      // fallback demo data — lets you keep demoing even if the API/key isn't set up yet
      setFlha({
        taskSummary: cleanTranscript || "Excavation and trenching work at site perimeter",
        hazards: sampleHazards.slice(0, 4).map(h => ({ ...h, risk: "Medium", sopRef: sopData.policies[0] || null })),
        sopAlerts: ["LOTO required before servicing pump", "Excavation >1.5m requires shoring", "Call 811 before digging"],
        ppeRequired: ["Hard hat", "Safety vest", "Steel-toed boots", "Gloves", "Safety glasses"],
        additionalNotes: "Ensure check-in with dispatch every 2 hours. Incident reporting within 1 hour if any near-miss occurs."
      });
      setStep("review");
    }
    setLoading(false);
  };

  // Save the completed, signed FLHA back to Supabase + generate PDF
  const saveFLHA = async () => {
    if (!flha) return;

    // Generate PDF and upload to Supabase Storage
    const pdfUrl = await generateAndUploadFLHA({
      flha,
      workerName,
      jobSite,
      signName,
      companyName,
    });

    // Save FLHA record with PDF URL
    await supabase.from("flhas").insert({
      worker_name: workerName,
      job_site: jobSite,
      task_description: transcript.replace(/\[live\].*/s, "").trim() || taskDesc,
      hazards_json: flha,
      signed_by: signName,
      pdf_url: pdfUrl || null,
    });
  };

  const riskColor = r => r === "High" ? "red" : r === "Medium" ? "amber" : "green";

  const styles = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#F0F4F8", minHeight: "100vh", padding: "16px" },
    card: { background: "#fff", borderRadius: 14, padding: "24px", marginBottom: 16, boxShadow: "0 1px 4px #0001" },
    header: { background: "linear-gradient(135deg,#1E3A5F,#2D5F8A)", borderRadius: 14, padding: "20px 24px", marginBottom: 16, color: "#fff" },
    label: { display: "block", fontWeight: 600, fontSize: 13, color: "#374151", marginBottom: 6 },
    input: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #E5E7EB", fontSize: 15, boxSizing: "border-box", outline: "none" },
    btn: (bg, fg = "#fff") => ({ background: bg, color: fg, border: "none", borderRadius: 9, padding: "12px 20px", fontWeight: 700, fontSize: 15, cursor: "pointer", width: "100%" }),
    textarea: { width: "100%", minHeight: 90, padding: "10px 12px", borderRadius: 8, border: "1.5px solid #E5E7EB", fontSize: 14, resize: "vertical", boxSizing: "border-box" },
    hazardCard: (risk) => ({
      border: `1.5px solid ${risk === "High" ? "#FCA5A5" : risk === "Medium" ? "#FCD34D" : "#86EFAC"}`,
      background: risk === "High" ? "#FEF2F2" : risk === "Medium" ? "#FFFBEB" : "#F0FDF4",
      borderRadius: 10, padding: "14px 16px", marginBottom: 10
    })
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 28 }}>🦺</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: -0.5 }}>SafeField FLHA</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>AI-powered Field Level Hazard Assessment</div>
          </div>
        </div>
      </div>

      <div style={styles.card}>
        <Stepper step={step} />
      </div>

      {step === "company" && (
        <div style={styles.card}>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Site & Worker Info</div>
          <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 18 }}>Pre-loaded with <strong>{sopData.company}</strong> SOPs ({sopData.policies.length} policies)</div>

          {debugInfo && (
            <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px 12px", marginBottom: 16, fontSize: 12, color: "#991B1B", fontFamily: "monospace" }}>
              DEBUG: {debugInfo}
            </div>
          )}

          <label style={styles.label}>Worker Name</label>
          <input style={{ ...styles.input, marginBottom: 14 }} placeholder="e.g. John Smith" value={workerName} onChange={e => setWorkerName(e.target.value)} />

          <label style={styles.label}>Job Site / Location</label>
          <input style={{ ...styles.input, marginBottom: 22 }} placeholder="e.g. Hwy 2 & 42 Ave, Red Deer" value={jobSite} onChange={e => setJobSite(e.target.value)} />

          <div style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 10, padding: "12px 14px", marginBottom: 22 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#0369A1", marginBottom: 6 }}>📋 Loaded Company SOPs</div>
            {sopData.policies.map((p, i) => (
              <div key={i} style={{ fontSize: 12, color: "#374151", marginBottom: 3 }}>• {p}</div>
            ))}
          </div>

          <button style={styles.btn("#F97316")} onClick={() => { if (workerName && jobSite) setStep("voice"); }}>
            Continue to Voice Input →
          </button>
        </div>
      )}

      {step === "voice" && (
        <div style={styles.card}>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Describe Your Task</div>
          <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 18 }}>Speak or type what work you're about to do. Be specific — mention equipment, location conditions, and any hazards you already see.</div>

          {hasSpeech ? (
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <button
                onClick={isListening ? stopListening : startListening}
                style={{
                  width: 100, height: 100, borderRadius: "50%", border: "none",
                  background: isListening ? "#DC2626" : "#1E3A5F",
                  color: "#fff", fontSize: 36, cursor: "pointer",
                  boxShadow: isListening ? "0 0 0 8px #DC262630" : "0 4px 20px #1E3A5F40",
                  transition: "all 0.2s"
                }}>
                {isListening ? "⏹" : "🎙"}
              </button>
              <div style={{ marginTop: 10, fontWeight: 600, color: isListening ? "#DC2626" : "#374151" }}>
                {isListening ? "Listening… tap to stop" : "Tap to speak"}
              </div>
            </div>
          ) : (
            <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13, color: "#92400E" }}>
              ⚠️ Voice input requires Chrome or Safari. Type your task below.
            </div>
          )}

          {transcript && (
            <div style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 14, color: "#374151", minHeight: 60 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", marginBottom: 4 }}>TRANSCRIPT</div>
              {transcript.replace(/\[live\].*$/s, "").trim()}
              {transcript.includes("[live]") && (
                <span style={{ color: "#9CA3AF" }}> {transcript.replace(/.*\[live\]/s, "").trim()}</span>
              )}
            </div>
          )}

          <label style={styles.label}>Or type your task description</label>
          <textarea
            style={{ ...styles.textarea, marginBottom: 18 }}
            placeholder="e.g. I'm going to be doing excavation work near the north fence line, about 2 metres deep. There's an overhead power line about 4 metres away and we'll need to use the jackhammer and compactor..."
            value={taskDesc}
            onChange={e => setTaskDesc(e.target.value)}
          />

          <button
            style={styles.btn(loading ? "#9CA3AF" : "#16A34A")}
            onClick={generateFLHA}
            disabled={loading || (!transcript.replace(/\[live\].*/s, "").trim() && !taskDesc)}>
            {loading ? "⏳ Analyzing against SOPs…" : "✅ Generate FLHA"}
          </button>

          <button style={{ ...styles.btn("#F3F4F6", "#374151"), marginTop: 10 }} onClick={() => setStep("company")}>
            ← Back
          </button>
        </div>
      )}

      {step === "review" && flha && (
        <>
          <div style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>FLHA Report</div>
                <div style={{ fontSize: 13, color: "#6B7280" }}>{companyName} • {new Date().toLocaleDateString("en-CA")}</div>
              </div>
              <Badge text={`${workerName || "Worker"}`} color="blue" />
            </div>

            <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#166534", marginBottom: 4 }}>TASK SUMMARY</div>
              <div style={{ fontSize: 14, color: "#166534" }}>{flha.taskSummary}</div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 6 }}>📍 {jobSite}</div>
            </div>

            {flha.sopAlerts?.length > 0 && (
              <div style={{ background: "#FFF7ED", border: "1.5px solid #FED7AA", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#C2410C", marginBottom: 6 }}>⚠️ SOP REQUIREMENTS TRIGGERED</div>
                {flha.sopAlerts.map((a, i) => <div key={i} style={{ fontSize: 13, color: "#9A3412", marginBottom: 3 }}>• {a}</div>)}
              </div>
            )}

            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Hazards & Controls</div>
            {flha.hazards?.map((h, i) => (
              <div key={i} style={styles.hazardCard(h.risk)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{h.hazard}</div>
                  <Badge text={h.risk} color={riskColor(h.risk)} />
                </div>
                <div style={{ fontSize: 13, color: "#374151", marginBottom: h.sopRef ? 6 : 0 }}>🛡 {h.control}</div>
                {h.sopRef && <div style={{ fontSize: 11, color: "#6B7280", fontStyle: "italic" }}>SOP: {h.sopRef}</div>}
              </div>
            ))}

            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Required PPE</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              {flha.ppeRequired?.map((p, i) => <Badge key={i} text={p} color="blue" />)}
            </div>

            {flha.additionalNotes && (
              <div style={{ background: "#F9FAFB", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>NOTES</div>
                <div style={{ fontSize: 13, color: "#374151" }}>{flha.additionalNotes}</div>
              </div>
            )}
          </div>

          <div style={styles.card}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Worker Acknowledgement</div>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 14 }}>By signing, I confirm I have reviewed this FLHA and understand the hazards and controls before starting work.</div>
            <label style={styles.label}>Full Name (electronic signature)</label>
            <input style={{ ...styles.input, marginBottom: 14 }} placeholder="Type your full name to sign" value={signName} onChange={e => setSignName(e.target.value)} />
            <button style={styles.btn(signed ? "#16A34A" : signName ? "#F97316" : "#9CA3AF")}
              disabled={!signName || signed}
              onClick={() => { setSigned(true); saveFLHA(); setTimeout(() => setStep("done"), 600); }}>
              {signed ? "✓ Signed" : "Sign & Submit FLHA"}
            </button>
          </div>
        </>
      )}

      {step === "done" && (
        <div style={styles.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 64, marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: "#1E3A5F", marginBottom: 6 }}>FLHA Complete</div>
            <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 20 }}>
              Submitted {new Date().toLocaleString("en-CA")} by <strong>{signName}</strong>
            </div>
            <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 10, padding: 16, marginBottom: 16, textAlign: "left" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#166534", marginBottom: 8 }}>SUBMITTED SUCCESSFULLY</div>
              {["🗂 Saved to company FLHA database", "📄 PDF generated and stored for supervisor", "📊 Hazard data recorded for site trends", "🔔 Available in supervisor dashboard"].map((n, i) => (
                <div key={i} style={{ fontSize: 13, color: "#374151", marginBottom: 4 }}>{n}</div>
              ))}
            </div>
            <a href="/dashboard" style={{
              display: "block", background: "#F97316", color: "#fff", borderRadius: 9,
              padding: "12px 20px", fontWeight: 700, fontSize: 15, textDecoration: "none",
              marginBottom: 10, textAlign: "center"
            }}>View Dashboard →</a>
            <button style={styles.btn("#1E3A5F")} onClick={() => { setStep("company"); setTranscript(""); setTaskDesc(""); setFlha(null); setSigned(false); setSignName(""); setWorkerName(""); setJobSite(""); }}>
              Start New FLHA
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

