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

export default function FLHAApp({ forcedCompanyId = null, onLogout = null }) {
  const [step, setStep] = useState("company");
  const [sopData, setSopData] = useState(FALLBACK_SOPS);
  const [sopsLoading, setSopsLoading] = useState(true);
  const [companyName, setCompanyName] = useState(FALLBACK_SOPS.company);
  const [companyId, setCompanyId] = useState(forcedCompanyId);
  const [companyLogo, setCompanyLogo] = useState("");
  const [debugInfo, setDebugInfo] = useState("");

  // Load company + SOPs from Supabase on first render.
  // If forcedCompanyId is provided (from login), load that specific company.
  useEffect(() => {
    async function loadSops() {
      let companies, companyErr;

      if (forcedCompanyId) {
        ({ data: companies, error: companyErr } = await supabase
          .from("companies")
          .select("id, name, logo_url")
          .eq("id", forcedCompanyId)
          .limit(1));
      } else {
        ({ data: companies, error: companyErr } = await supabase
          .from("companies")
          .select("id, name, logo_url")
          .limit(1));
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
      setCompanyId(company.id);
      setCompanyLogo(company.logo_url || "");
      setCompanyName(company.name);

      // Load saved sites for this company
      const { data: siteRows, error: siteErr } = await supabase
        .from("sites")
        .select("id, name")
        .eq("company_id", company.id)
        .order("id");
      if (siteErr) console.error("sites read error:", siteErr.message);
      setSites(siteRows || []);
      if (!siteRows || siteRows.length === 0) setSiteMode("other");
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
      setDebugInfo("");
      setSopsLoading(false);
    }
    loadSops();
  }, [forcedCompanyId]);


  const [workerName, setWorkerName] = useState("");
  const [jobSite, setJobSite] = useState("");
  const [sites, setSites] = useState([]);
  const [siteMode, setSiteMode] = useState("list"); // "list" | "other"
  const [taskDesc, setTaskDesc] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [flha, setFlha] = useState(null);
  const [loading, setLoading] = useState(false);
  const [genError, setGenError] = useState(false);
  const [sopsOpen, setSopsOpen] = useState(false);
  const [signed, setSigned] = useState(false);
  const [signName, setSignName] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const recognitionRef = useRef(null);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  // ── Signature pad drawing handlers ───────────────────────
  const getCanvasPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return {
      x: (touch.clientX - rect.left) * (canvas.width / rect.width),
      y: (touch.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDraw = (e) => {
    e.preventDefault();
    drawingRef.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getCanvasPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#1E3A5F";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    setHasSignature(true);
  };

  const endDraw = () => { drawingRef.current = false; };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasSignature(false);
  };

  const getSignatureDataUrl = () => {
    if (!canvasRef.current || !hasSignature) return null;
    return canvasRef.current.toDataURL("image/png");
  };

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

  const [addingTask, setAddingTask] = useState(false); // true when generating an additional task
  const [amendingId, setAmendingId] = useState(null);   // FLHA id being amended (null = new)
  const [amendSignature, setAmendSignature] = useState(null); // original signature to preserve
  const [resumeName, setResumeName] = useState("");
  const [resumeError, setResumeError] = useState("");
  const [resumeChoices, setResumeChoices] = useState([]); // if multiple found

  // Find today's FLHA for this worker name + company and load it for amending
  const resumeTodaysFLHA = async () => {
    setResumeError("");
    setResumeChoices([]);
    const name = resumeName.trim();
    if (!name) { setResumeError("Enter your name."); return; }

    const start = new Date(); start.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from("flhas")
      .select("id, worker_name, job_site, hazards_json, created_at")
      .eq("company_id", companyId)
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: false });

    if (error) { setResumeError("Something went wrong. Try again."); return; }
    const matches = (data || []).filter(f => (f.worker_name || "").trim().toLowerCase() === name.toLowerCase());
    if (matches.length === 0) { setResumeError("No FLHA found for that name today. Check the spelling or start a new one."); return; }
    if (matches.length === 1) { loadForAmend(matches[0]); return; }
    setResumeChoices(matches); // let them pick
  };

  const loadForAmend = (record) => {
    const h = record.hazards_json || {};
    setFlha(h);
    setWorkerName(record.worker_name || "");
    setJobSite(record.job_site || "");
    setAmendingId(record.id);
    // preserve original signature if it was stored in hazards_json (not currently), else keep null
    setAmendSignature(h.__signature || null);
    setResumeChoices([]);
    setStep("review");
  };


  const generateFLHA = async () => {
    setLoading(true);
    setGenError(false);
    const cleanTranscript = transcript.replace(/\[live\].*/s, "").trim() || taskDesc;
    const taskLabel = cleanTranscript;
    const prompt = `You are an experienced field safety officer reviewing a worker's task description before they begin work. Your job is to identify ONLY the hazards that are genuinely relevant to what this specific worker has described — not a generic list.

Company: ${companyName}
Worker: ${workerName}
Job Site: ${jobSite}
Task Description: "${cleanTranscript}"

Company SOPs and Policies:
${sopData.policies.map((p, i) => `${i + 1}. ${p}`).join("\n")}

INSTRUCTIONS:
- Read the task description carefully. Only flag hazards that are directly present or likely given what the worker described.
- Do NOT include generic hazards that have nothing to do with this task.
- If the worker mentions excavation, flag excavation hazards. If they don't mention heights, don't flag fall hazards.
- For sopAlerts, only include SOPs that are specifically triggered by this task — e.g. if no hot work is mentioned, don't include the hot work SOP.
- For ppeRequired, only list PPE actually needed for this specific task.
- Identify 2-5 hazards maximum. Quality over quantity.
- Risk levels: High = could cause serious injury or death, Medium = could cause injury, Low = minor risk.
- If a hazard is already well-controlled by the worker's described approach, rate it Lower.

Respond ONLY with a valid JSON object (no markdown, no backticks):
{
  "taskSummary": "one sentence summary of what the worker is doing",
  "hazards": [
    { "hazard": "specific hazard name", "risk": "Low|Medium|High", "control": "specific control measure for this task", "sopRef": "exact SOP text this references, or null" }
  ],
  "sopAlerts": ["only SOPs specifically triggered by this task"],
  "ppeRequired": ["only PPE needed for this specific task"],
  "additionalNotes": "any task-specific safety notes the worker should know, or null"
}`;

    try {
      const res = await fetch("/api/generate-flha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });
      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const text = data.content?.map(b => b.text || "").join("") || "";
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error("Invalid response format");
      }
      const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));

      // Tag each hazard with its task summary so we can group by task
      const tagged = (parsed.hazards || []).map(h => ({ ...h, task: parsed.taskSummary || taskLabel }));

      if (addingTask && flha) {
        // Append this task's hazards + merge PPE/alerts into the existing FLHA
        setFlha(prev => {
          const mergedPPE = Array.from(new Set([...(prev.ppeRequired || []), ...(parsed.ppeRequired || [])]));
          const mergedAlerts = Array.from(new Set([...(prev.sopAlerts || []), ...(parsed.sopAlerts || [])]));
          const existingTagged = (prev.hazards || []).map(h => h.task ? h : { ...h, task: prev.taskSummary || "Task 1" });
          return {
            ...prev,
            hazards: [...existingTagged, ...tagged],
            ppeRequired: mergedPPE,
            sopAlerts: mergedAlerts,
            additionalNotes: prev.additionalNotes,
          };
        });
        setAddingTask(false);
      } else {
        // First task — tag its hazards too, for consistent grouping
        setFlha({ ...parsed, hazards: tagged });
      }
      setStep("review");
      setTranscript("");
      setTaskDesc("");
    } catch (err) {
      console.error("FLHA generation error:", err);
      setGenError(true);
    }
    setLoading(false);
  };

  // Start adding an additional task — go back to voice input
  const startAddTask = () => {
    setAddingTask(true);
    setTranscript("");
    setTaskDesc("");
    setStep("voice");
  };

  // Save the completed, signed FLHA back to Supabase + generate PDF
  const saveFLHA = async () => {
    if (!flha) return;

    // When amending, reuse the original signature; otherwise capture the drawn one.
    const signatureDataUrl = amendingId ? amendSignature : getSignatureDataUrl();
    const amendedNote = amendingId ? `Amended ${new Date().toLocaleString("en-CA")}` : null;

    // Generate PDF and upload to Supabase Storage.
    const pdfUrl = await generateAndUploadFLHA({
      flha,
      workerName,
      jobSite,
      signName: workerName,
      companyName,
      signatureDataUrl,
      companyLogo,
      amendedNote,
    });

    if (amendingId) {
      // Update the existing record (one clean document)
      await supabase.from("flhas").update({
        job_site: jobSite,
        task_description: (flha.hazards || []).map(h => h.task).filter((v, i, a) => v && a.indexOf(v) === i).join(" | "),
        hazards_json: flha,
        pdf_url: pdfUrl || null,
      }).eq("id", amendingId);
    } else {
      await supabase.from("flhas").insert({
        worker_name: workerName,
        job_site: jobSite,
        task_description: transcript.replace(/\[live\].*/s, "").trim() || taskDesc,
        hazards_json: flha,
        signed_by: workerName,
        pdf_url: pdfUrl || null,
        company_id: companyId,
      });
    }
  };

  const riskColor = r => r === "High" ? "red" : r === "Medium" ? "amber" : "green";

  // ── Hazard editing (worker can add/edit/remove) ──────────
  const [editingHazard, setEditingHazard] = useState(null); // index being edited, or "new"
  const [hazardDraft, setHazardDraft] = useState({ hazard: "", risk: "Medium", control: "" });

  const openNewHazard = () => { setHazardDraft({ hazard: "", risk: "Medium", control: "" }); setEditingHazard("new"); };
  const openEditHazard = (i) => { const h = flha.hazards[i]; setHazardDraft({ hazard: h.hazard, risk: h.risk, control: h.control }); setEditingHazard(i); };
  const cancelHazardEdit = () => { setEditingHazard(null); };

  const saveHazard = () => {
    if (!hazardDraft.hazard.trim() || !hazardDraft.control.trim()) return;
    setFlha(prev => {
      const hazards = [...(prev.hazards || [])];
      const entry = { hazard: hazardDraft.hazard.trim(), risk: hazardDraft.risk, control: hazardDraft.control.trim(), sopRef: null };
      if (editingHazard === "new") hazards.push(entry);
      else hazards[editingHazard] = { ...hazards[editingHazard], ...entry };
      return { ...prev, hazards };
    });
    setEditingHazard(null);
  };

  const removeHazard = (i) => {
    setFlha(prev => ({ ...prev, hazards: prev.hazards.filter((_, idx) => idx !== i) }));
  };


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
      <div style={{ ...styles.header, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {companyLogo
            ? <img src={companyLogo} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", background: "#fff" }} />
            : <span style={{ fontSize: 28 }}>🦺</span>}
          <div>
            <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: -0.5 }}>FLHA</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>AI-powered Field Level Hazard Assessment</div>
          </div>
        </div>
        {onLogout && (
          <button onClick={onLogout} style={{
            background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8,
            padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer"
          }}>Exit</button>
        )}
      </div>

      <div style={styles.card}>
        <Stepper step={step} />
      </div>

      {step === "company" && (
        <div style={styles.card}>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Site & Worker Info</div>
          <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 18 }}>Pre-loaded with <strong>{sopData.company}</strong> SOPs ({sopData.policies.length} policies)</div>

          <label style={styles.label}>Worker Name</label>
          <input style={{ ...styles.input, marginBottom: 14 }} placeholder="e.g. John Smith" value={workerName} onChange={e => setWorkerName(e.target.value)} />

          <label style={styles.label}>Job Site / Location</label>
          {sites.length > 0 && siteMode === "list" ? (
            <>
              <select
                style={{ ...styles.input, marginBottom: 8 }}
                value={jobSite}
                onChange={e => {
                  if (e.target.value === "__other__") { setSiteMode("other"); setJobSite(""); }
                  else setJobSite(e.target.value);
                }}>
                <option value="">Select a site…</option>
                {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                <option value="__other__">＋ Other site (type a new one)</option>
              </select>
              <div style={{ marginBottom: 22 }} />
            </>
          ) : (
            <>
              <input
                style={{ ...styles.input, marginBottom: 8 }}
                placeholder="e.g. Hwy 2 & 42 Ave, Red Deer"
                value={jobSite}
                onChange={e => setJobSite(e.target.value)}
              />
              {sites.length > 0 && (
                <button
                  onClick={() => { setSiteMode("list"); setJobSite(""); }}
                  style={{ background: "transparent", border: "none", color: "#F97316", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 22 }}>
                  ← Choose from saved sites
                </button>
              )}
              {sites.length === 0 && <div style={{ marginBottom: 22 }} />}
            </>
          )}

          <div style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 10, marginBottom: 22, overflow: "hidden" }}>
            <button
              onClick={() => setSopsOpen(o => !o)}
              style={{
                width: "100%", background: "transparent", border: "none", cursor: "pointer",
                padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center",
                fontWeight: 600, fontSize: 13, color: "#0369A1"
              }}>
              <span>📋 Loaded Company SOPs ({sopData.policies.length})</span>
              <span style={{ fontSize: 12, transform: sopsOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
            </button>
            {sopsOpen && (
              <div style={{ padding: "0 14px 12px", maxHeight: 240, overflowY: "auto" }}>
                {sopData.policies.map((p, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#374151", marginBottom: 5 }}>• {p}</div>
                ))}
              </div>
            )}
          </div>

          <button style={styles.btn("#F97316")} onClick={async () => {
            if (!workerName || !jobSite) return;
            // Auto-save a newly typed site (case-insensitive dedupe)
            const trimmed = jobSite.trim();
            const exists = sites.some(s => s.name.toLowerCase() === trimmed.toLowerCase());
            if (!exists && companyId) {
              await supabase.from("sites").insert({ company_id: companyId, name: trimmed });
            }
            setStep("voice");
          }}>
            Continue to Voice Input →
          </button>

          <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid #E5E7EB" }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: "#1E3A5F" }}>Already started an FLHA today?</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 10 }}>Enter your name to reopen today's FLHA and add a task to it.</div>
            <input style={{ ...styles.input, marginBottom: 8 }} placeholder="Your name (as entered earlier)" value={resumeName} onChange={e => setResumeName(e.target.value)} />
            {resumeError && <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8, padding: "8px 12px", marginBottom: 8, fontSize: 13, color: "#991B1B" }}>{resumeError}</div>}
            {resumeChoices.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>Multiple found — pick one:</div>
                {resumeChoices.map(c => (
                  <button key={c.id} onClick={() => loadForAmend(c)} style={{ width: "100%", textAlign: "left", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "10px 12px", marginBottom: 6, cursor: "pointer" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1E3A5F" }}>{c.job_site || "No site"}</div>
                    <div style={{ fontSize: 11, color: "#6B7280" }}>{new Date(c.created_at).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}</div>
                  </button>
                ))}
              </div>
            )}
            <button style={{ ...styles.btn("#F3F4F6", "#374151") }} onClick={resumeTodaysFLHA}>
              Resume today's FLHA
            </button>
          </div>
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

          {genError && (
            <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "12px 14px", marginBottom: 12, fontSize: 14, color: "#991B1B" }}>
              Something went wrong generating the assessment. Please check your connection and try again.
            </div>
          )}

          <button
            style={styles.btn(loading ? "#9CA3AF" : "#16A34A")}
            onClick={generateFLHA}
            disabled={loading || (!transcript.replace(/\[live\].*/s, "").trim() && !taskDesc)}>
            {loading ? "⏳ Analyzing against SOPs…" : addingTask ? "✅ Add this task" : "✅ Generate FLHA"}
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

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Hazards & Controls</div>
              <button onClick={openNewHazard} style={{ background: "#1E3A5F", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Add hazard</button>
            </div>

            {editingHazard === "new" && (
              <div style={{ ...styles.hazardCard("Medium"), border: "1.5px dashed #1E3A5F" }}>
                <input style={{ ...styles.input, marginBottom: 8 }} placeholder="Hazard (what's the risk?)" value={hazardDraft.hazard} onChange={e => setHazardDraft(d => ({ ...d, hazard: e.target.value }))} />
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  {["Low", "Medium", "High"].map(r => (
                    <button key={r} onClick={() => setHazardDraft(d => ({ ...d, risk: r }))} style={{ flex: 1, padding: "8px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${hazardDraft.risk === r ? "#1E3A5F" : "#E5E7EB"}`, background: hazardDraft.risk === r ? "#1E3A5F" : "#fff", color: hazardDraft.risk === r ? "#fff" : "#6B7280" }}>{r}</button>
                  ))}
                </div>
                <input style={{ ...styles.input, marginBottom: 8 }} placeholder="Control (how do you manage it?)" value={hazardDraft.control} onChange={e => setHazardDraft(d => ({ ...d, control: e.target.value }))} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={saveHazard} style={{ flex: 1, background: "#16A34A", color: "#fff", border: "none", borderRadius: 8, padding: "9px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Add</button>
                  <button onClick={cancelHazardEdit} style={{ flex: 1, background: "#F3F4F6", color: "#374151", border: "none", borderRadius: 8, padding: "9px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            )}

            {flha.hazards?.map((h, i) => {
              const prevTask = i > 0 ? flha.hazards[i - 1].task : null;
              const showTaskHeader = h.task && h.task !== prevTask;
              const taskNumber = showTaskHeader
                ? [...new Set(flha.hazards.slice(0, i + 1).map(x => x.task))].length
                : null;
              return (
              <div key={i}>
              {showTaskHeader && (
                <div style={{ background: "#EFF6FF", borderRadius: 8, padding: "8px 12px", marginBottom: 8, marginTop: i > 0 ? 6 : 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#1E3A5F", textTransform: "uppercase", letterSpacing: 0.5 }}>Task {taskNumber}</div>
                  <div style={{ fontSize: 13, color: "#374151", marginTop: 1 }}>{h.task}</div>
                </div>
              )}
              {editingHazard === i ? (
                <div style={{ ...styles.hazardCard(hazardDraft.risk), border: "1.5px dashed #1E3A5F" }}>
                  <input style={{ ...styles.input, marginBottom: 8 }} value={hazardDraft.hazard} onChange={e => setHazardDraft(d => ({ ...d, hazard: e.target.value }))} />
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {["Low", "Medium", "High"].map(r => (
                      <button key={r} onClick={() => setHazardDraft(d => ({ ...d, risk: r }))} style={{ flex: 1, padding: "8px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${hazardDraft.risk === r ? "#1E3A5F" : "#E5E7EB"}`, background: hazardDraft.risk === r ? "#1E3A5F" : "#fff", color: hazardDraft.risk === r ? "#fff" : "#6B7280" }}>{r}</button>
                    ))}
                  </div>
                  <input style={{ ...styles.input, marginBottom: 8 }} value={hazardDraft.control} onChange={e => setHazardDraft(d => ({ ...d, control: e.target.value }))} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={saveHazard} style={{ flex: 1, background: "#16A34A", color: "#fff", border: "none", borderRadius: 8, padding: "9px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Save</button>
                    <button onClick={cancelHazardEdit} style={{ flex: 1, background: "#F3F4F6", color: "#374151", border: "none", borderRadius: 8, padding: "9px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={styles.hazardCard(h.risk)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{h.hazard}</div>
                    <Badge text={h.risk} color={riskColor(h.risk)} />
                  </div>
                  <div style={{ fontSize: 13, color: "#374151", marginBottom: h.sopRef ? 6 : 6 }}>🛡 {h.control}</div>
                  {h.sopRef && <div style={{ fontSize: 11, color: "#6B7280", fontStyle: "italic", marginBottom: 6 }}>SOP: {h.sopRef}</div>}
                  <div style={{ display: "flex", gap: 12 }}>
                    <button onClick={() => openEditHazard(i)} style={{ background: "transparent", border: "none", color: "#1E3A5F", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>Edit</button>
                    <button onClick={() => removeHazard(i)} style={{ background: "transparent", border: "none", color: "#DC2626", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>Remove</button>
                  </div>
                </div>
              )}
              </div>
              );
            })}

            <button onClick={startAddTask} style={{ width: "100%", background: "#fff", border: "1.5px dashed #1E3A5F", color: "#1E3A5F", borderRadius: 10, padding: "12px", fontWeight: 700, fontSize: 14, cursor: "pointer", marginTop: 4, marginBottom: 16 }}>
              + Add another task
            </button>


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
            {amendingId ? (
              <>
                <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 14 }}>By confirming, I acknowledge I have reviewed the added task(s) and understand the hazards and controls. This amendment will be time-stamped on the document.</div>
                <div style={{ background: "#EFF6FF", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
                  <div style={{ fontSize: 13, color: "#374151" }}>Worker: <strong>{workerName}</strong></div>
                  <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>Amendment will be recorded {new Date().toLocaleString("en-CA")}</div>
                </div>
                <button style={styles.btn(signed ? "#16A34A" : "#F97316")}
                  disabled={signed}
                  onClick={() => { setSigned(true); saveFLHA(); setTimeout(() => setStep("done"), 600); }}>
                  {signed ? "✓ Saved" : "Confirm & Update FLHA"}
                </button>
              </>
            ) : (
              <>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 14 }}>By signing, I confirm I have reviewed this FLHA and understand the hazards and controls before starting work.</div>

            <label style={styles.label}>Signature</label>
            <div style={{ position: "relative", marginBottom: 6 }}>
              <canvas
                ref={canvasRef}
                width={600}
                height={180}
                style={{
                  width: "100%", height: 150, border: "1.5px solid #E5E7EB",
                  borderRadius: 10, background: "#fff", touchAction: "none", display: "block"
                }}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={endDraw}
              />
              {!hasSignature && (
                <div style={{
                  position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)",
                  textAlign: "center", color: "#9CA3AF", fontSize: 14, pointerEvents: "none"
                }}>Sign here with your finger</div>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: "#374151" }}>Signed by: <strong>{workerName}</strong></div>
              <button onClick={clearSignature} style={{
                background: "transparent", border: "none", color: "#6B7280",
                fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0
              }}>Clear signature</button>
            </div>

            <button style={styles.btn(signed ? "#16A34A" : hasSignature ? "#F97316" : "#9CA3AF")}
              disabled={!hasSignature || signed}
              onClick={() => { setSignName(workerName); setSigned(true); saveFLHA(); setTimeout(() => setStep("done"), 600); }}>
              {signed ? "✓ Signed" : "Sign & Submit FLHA"}
            </button>
              </>
            )}
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
            <button style={styles.btn("#1E3A5F")} onClick={() => { setStep("company"); setTranscript(""); setTaskDesc(""); setFlha(null); setSigned(false); setSignName(""); setHasSignature(false); setWorkerName(""); setJobSite(""); setSiteMode(sites.length > 0 ? "list" : "other"); }}>
              Start New FLHA
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
