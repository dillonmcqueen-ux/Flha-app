import { useState, useRef, useEffect } from "react";
import { generateAndUploadFLHA } from "./generatePDF";

// Fallback used only if Supabase has no data yet (e.g. first run)
const FALLBACK_SOPS = {
  company: "Demo Company",
  policies: [
    "All workers must conduct a FLHA before beginning any task.",
    "PPE (hard hat, safety vest, steel-toed boots, gloves) is mandatory on all sites.",
  ],
};

const STEPS = ["company", "voice", "review", "signoff", "done"];

// ── SOP relevance pre-filter ──────────────────────────────
const SOP_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "is", "are", "be", "must", "will", "all", "at", "by", "as", "this",
  "that", "it", "should", "may", "not", "before", "after", "any", "into",
  "from", "must", "when", "each", "such", "their", "has", "have",
]);

// Common construction/safety word families that should count as the same
// concept even when the exact word differs (e.g. a task that says "digging
// a ditch" should match an SOP titled "Excavation Procedures").
const SOP_SYNONYM_GROUPS = [
  ["excavat", "trench", "dig", "ditch"],
  ["fenc", "barricad", "barrier"],
  ["fall", "height"],
  ["lockout", "tagout", "loto", "isolat", "energiz", "energis"],
  ["confined", "enclosed"],
  ["electric", "power", "wire", "cable"],
  ["traffic", "vehicle", "flagg", "roadway"],
  ["crane", "lift", "rig", "hoist", "sling"],
  ["manual", "handl", "ergonom"],
  ["weather", "environment", "cold", "heat", "rain"],
  ["scaffold", "ladder", "platform"],
  ["chemical", "hazmat", "spill"],
];
const SOP_SYNONYM_MAP = new Map();
SOP_SYNONYM_GROUPS.forEach((group, idx) => {
  group.forEach(term => SOP_SYNONYM_MAP.set(term, `syn${idx}`));
});

// Light stemmer so "digging"/"dig", "fencing"/"fence" and
// "excavation"/"excavating" line up without needing an exact word match.
function stem(word) {
  if (word.length > 6 && word.endsWith("ation")) return word.slice(0, -5);
  if (word.length > 6 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 5 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function canonicalize(word) {
  const stemmed = stem(word);
  for (const [term, tag] of SOP_SYNONYM_MAP) {
    if (word.startsWith(term) || stemmed.startsWith(term)) return tag;
  }
  return stemmed;
}

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(w => w.length > 2 && !SOP_STOPWORDS.has(w))
    .map(canonicalize);
}

function scorePolicyRelevance(policy, taskWordsSet) {
  const policyWords = tokenize(policy);
  let score = 0;
  policyWords.forEach(w => { if (taskWordsSet.has(w)) score += 1; });
  return score;
}

function selectRelevantPolicies(policies, taskText, maxCount = 25) {
  if (!policies || policies.length <= maxCount) return policies || [];
  const taskWords = new Set(tokenize(taskText));
  const scored = policies.map((p, i) => ({ p, i, score: scorePolicyRelevance(p, taskWords) }));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, maxCount).sort((a, b) => a.i - b.i).map(s => s.p);
}

// ── Deterministic safety net for boilerplate hazards ──────
// The AI keeps re-adding certain SOP-driven hazard categories (working
// alone, weather, overhead/underground utilities) even when the prompt
// explicitly says not to, because those SOPs are sitting right there in
// its context. Prompt wording alone hasn't reliably stopped this, so
// strip these categories out after the fact unless the worker's own
// words actually indicate the condition — this can't be talked out of
// working by any amount of prompt tuning.
const UNGROUNDED_HAZARD_RULES = [
  {
    // \w* after a stem lets it match inflected forms ("isolation", "isolated")
    // — a bare \b right after the stem would block those, since the next
    // letter is still a word character and never counts as a boundary.
    textMatch: /\b(alone|isolat\w*|remote location|unsupervised)\b/i,
    taskMatch: /\b(alone|by myself|on my own|no one else|nobody else|unsupervised|remote site|remote location|no cell service|no signal|no radio)\b/i,
  },
  {
    textMatch: /\b(weather|rain\w*|wind\w*|lightning|storm\w*|snow\w*|heat\w*|cold\w*|temperature|low light)\b/i,
    taskMatch: /\b(rain\w*|wind\w*|storm\w*|lightning|snow\w*|hot out|cold\w*|heat wave|freezing|humid|weather|dark out|nighttime|after dark)\b/i,
  },
  {
    textMatch: /\boverhead (power |electrical )?lines?\b/i,
    taskMatch: /\b(overhead|power line|hydro line|electrical line|wire|wires|pole|poles|aerial|transmission line)\b/i,
  },
  {
    textMatch: /\b(underground utilit\w*|buried (pipe|cable|line)\w*|utility strike\w*)\b/i,
    taskMatch: /\b(underground|buried|utilit\w*|pipe\w*|cable\w*|gas line|water line|conduit|call.?before.?you.?dig)\b/i,
  },
];

function isUngroundedText(text, lowerTask) {
  return UNGROUNDED_HAZARD_RULES.some(
    rule => rule.textMatch.test(text || "") && !rule.taskMatch.test(lowerTask)
  );
}

function stripUngroundedHazards(hazards, taskText) {
  const lowerTask = (taskText || "").toLowerCase();
  // Check the cited SOP text too, not just the hazard's own wording — the
  // model can reword a hazard to dodge these keywords while still citing
  // the exact same working-alone/weather/utility SOP as its justification.
  return (hazards || []).filter(h => !isUngroundedText(`${h.hazard || ""} ${h.control || ""} ${h.sopRef || ""}`, lowerTask));
}

function stripUngroundedAlerts(alerts, taskText) {
  const lowerTask = (taskText || "").toLowerCase();
  return (alerts || []).filter(a => !isUngroundedText(a, lowerTask));
}

// General backstop, independent of topic: a hedge is the model's own tell
// that it isn't sure the condition applies, so the item shouldn't be in the
// output at all (only optionally as a note) — this catches SOPs the four
// named categories above don't, like "face shield if driving pins," without
// needing a new named category every time a new company SOP triggers it.
const HEDGE_PATTERN = /\(if [^)]*\)|\bif (present|any|applicable|performing|using|required|needed|it applies)\b|\bwhen (performing|using)\b|\bshould (it|they|this) (exist|apply|occur)\b/i;

function stripHedged(items, getText) {
  return (items || []).filter(item => !HEDGE_PATTERN.test(getText(item) || ""));
}

// The model doesn't reliably include these baseline items on its own even
// when told to, so guarantee them here rather than relying on prompt
// compliance — same reasoning as the exclusion filters above, just for
// inclusion instead.
const BASELINE_HAZARD_CHECKS = [
  {
    present: /\b(fit(ness)? for duty|fatigue|impair(ed|ment)?)\b/i,
    hazard: {
      hazard: "Fitness for duty",
      risk: "Low",
      control: "Confirm fitness for duty before starting — well-rested, not under the influence of drugs or alcohol, and free of any illness or medication that could affect safe performance of this task. Do not begin work if fatigued, ill, or impaired.",
      sopRef: null,
    },
  },
  {
    present: /\b(muster point|emergency response|assembly point|evacuation (plan|route))\b/i,
    hazard: {
      hazard: "Muster point and emergency response plan awareness",
      risk: "Low",
      control: "Confirm the site's muster/assembly point and emergency response plan with the supervisor before starting work, confirm 911/emergency services availability, and ensure a working communication method (two-way radio, cell phone, or land line) is on hand.",
      sopRef: null,
    },
  },
];

function ensureBaselineHazards(hazards, taskLabel) {
  const result = [...(hazards || [])];
  BASELINE_HAZARD_CHECKS.forEach(({ present, hazard }) => {
    const covered = result.some(h => present.test(`${h.hazard || ""} ${h.control || ""}`));
    if (!covered) result.push({ ...hazard, task: taskLabel });
  });
  return result;
}

function Badge({ text, color = "blue" }) {
  const colors = {
    blue: "background:#1D4ED820;color:#1D4ED8;border:1px solid #1D4ED840",
    green: "background:#16A34A20;color:#16A34A;border:1px solid #16A34A40",
    amber: "background:#D9770620;color:#D97706;border:1px solid #D9770640",
    red: "background:#DC262620;color:#DC2626;border:1px solid #DC262640",
    extreme: "background:#7F1D1D;color:#FFFFFF;border:1px solid #7F1D1D",
  };
  return (
    <span style={{ ...Object.fromEntries(colors[color].split(";").map(s => s.split(":"))), borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>
      {text}
    </span>
  );
}

function Stepper({ step }) {
  const labels = ["Setup", "Voice Input", "Review", "Sign-Off", "Complete"];
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
                width: 30, height: 30, borderRadius: "50%",
                background: done ? "#F97316" : active ? "#1E3A5F" : "#E5E7EB",
                color: done || active ? "#fff" : "#9CA3AF",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 13, flexShrink: 0
              }}>
                {done ? "✓" : i + 1}
              </div>
              {i < labels.length - 1 && <div style={{ flex: 1, height: 2, background: done ? "#F97316" : "#E5E7EB" }} />}
            </div>
            <span style={{ fontSize: 10, marginTop: 4, color: active ? "#1E3A5F" : done ? "#F97316" : "#9CA3AF", fontWeight: active ? 700 : 400, textAlign: "center" }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const RISK_ROW_STYLE = {
  Extreme: { bg: "#FEF2F2", border: "#7F1D1D", badgeBg: "#7F1D1D", badgeText: "#fff" },
  High: { bg: "#FEF2F2", border: "#FCA5A5", badgeBg: "#FEE2E2", badgeText: "#DC2626" },
  Medium: { bg: "#FFFBEB", border: "#FCD34D", badgeBg: "#FEF3C7", badgeText: "#D97706" },
  Low: { bg: "#F0FDF4", border: "#86EFAC", badgeBg: "#DCFCE7", badgeText: "#16A34A" },
};

export default function FLHAApp({ forcedCompanyId = null, companyName: propCompanyName = "", userName: loginUserName = "", onLogout = null, token = null }) {
  const [step, setStep] = useState("company");
  const [sopData, setSopData] = useState(FALLBACK_SOPS);
  const [sopsLoading, setSopsLoading] = useState(true);
  const [companyName, setCompanyName] = useState(propCompanyName || FALLBACK_SOPS.company);
  const [companyId, setCompanyId] = useState(forcedCompanyId);
  const [companyLogo, setCompanyLogo] = useState("");
  const [debugInfo, setDebugInfo] = useState("");

  // Load SOPs/sites/custom fields for forcedCompanyId (from login) on first
  // render. Company name comes from the login session (propCompanyName) —
  // this used to also re-derive it via a direct client-side companies read,
  // which RLS now blocks for everyone (see Phase 1 RLS remediation); every
  // other worker form already avoided that by taking companyName as a prop
  // and fetching only the logo via the protected endpoint, same as here.
  useEffect(() => {
    async function loadSops() {
      if (!forcedCompanyId) {
        setSopsLoading(false);
        return;
      }

      // Company logo — via protected endpoint
      try {
        const logoRes = await fetch("/api/companydata", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_company_logo", token, companyId: forcedCompanyId }),
        });
        const logoData = await logoRes.json();
        if (logoRes.ok) setCompanyLogo(logoData.logo_url || "");
      } catch (e) { /* leave logo blank if the request fails */ }

      // Sites — via protected endpoint
      try {
        const siteRes = await fetch("/api/companydata", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_sites", token, companyId: forcedCompanyId }),
        });
        const siteData = await siteRes.json();
        if (siteRes.ok) {
          setSites(siteData.sites || []);
          if (!siteData.sites || siteData.sites.length === 0) setSiteMode("other");
        } else {
          console.error("sites read error:", siteData.error);
          setSiteMode("other");
        }
      } catch (e) {
        console.error("sites read error:", e.message);
        setSiteMode("other");
      }

      // Custom FLHA fields — via protected endpoint
      try {
        const cfRes = await fetch("/api/companydata", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_custom_fields", token, companyId: forcedCompanyId, docType: "flha" }),
        });
        const cfData = await cfRes.json();
        if (cfRes.ok) setCustomFields(cfData.fields || []);
        else console.error("custom fields read error:", cfData.error);
      } catch (e) {
        console.error("custom fields read error:", e.message);
      }

      // SOPs — via protected endpoint
      try {
        const sopsRes = await fetch("/api/companydata", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_sops", token, companyId: forcedCompanyId }),
        });
        const sopsData = await sopsRes.json();
        if (!sopsRes.ok) {
          setDebugInfo(`sops query error: ${sopsData.error}`);
          setSopsLoading(false);
          return;
        }
        const sops = sopsData.sops || [];
        if (sops.length === 0) {
          setDebugInfo(`sops returned 0 rows for company_id=${forcedCompanyId}`);
          setSopsLoading(false);
          return;
        }
        setSopData({ company: propCompanyName || FALLBACK_SOPS.company, policies: sops.map(s => s.policy_text) });
        setDebugInfo("");
      } catch (e) {
        setDebugInfo(`sops query error: ${e.message}`);
        setSopsLoading(false);
        return;
      }

      setSopsLoading(false);
    }
    loadSops();
  }, [forcedCompanyId, propCompanyName, token]);


  const [workerName, setWorkerName] = useState(loginUserName);
  const [jobSite, setJobSite] = useState("");
  const [sites, setSites] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [customValues, setCustomValues] = useState({});
  const [siteMode, setSiteMode] = useState("list"); // "list" | "other"
  const [taskDesc, setTaskDesc] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [flha, setFlha] = useState(null);
  const [loading, setLoading] = useState(false);
  const [genError, setGenError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [savingFLHA, setSavingFLHA] = useState(false);
  const [sopsOpen, setSopsOpen] = useState(false);
  const [signed, setSigned] = useState(false);
  const [signName, setSignName] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const recognitionRef = useRef(null);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  // ── crew (multi-signature) ────────────────────────────────
  const [crew, setCrew] = useState([]);
  const [crewName, setCrewName] = useState("");
  const [crewHasSig, setCrewHasSig] = useState(false);
  const crewCanvasRef = useRef(null);
  const crewDrawingRef = useRef(false);

  const getCrewPos = (e) => {
    const c = crewCanvasRef.current, r = c.getBoundingClientRect(), t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) };
  };
  const startCrewDraw = (e) => { e.preventDefault(); crewDrawingRef.current = true; const ctx = crewCanvasRef.current.getContext("2d"); const { x, y } = getCrewPos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const crewDraw = (e) => { if (!crewDrawingRef.current) return; e.preventDefault(); const ctx = crewCanvasRef.current.getContext("2d"); const { x, y } = getCrewPos(e); ctx.lineTo(x, y); ctx.strokeStyle = "#1E293B"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.stroke(); setCrewHasSig(true); };
  const endCrewDraw = () => { crewDrawingRef.current = false; };
  const clearCrewSig = () => { const c = crewCanvasRef.current; if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height); setCrewHasSig(false); };
  const addCrewMember = () => {
    if (!crewName.trim() || !crewHasSig) return;
    const sig = crewCanvasRef.current.toDataURL("image/png");
    setCrew(prev => [...prev, { name: crewName.trim(), signature: sig, signedAt: new Date().toISOString() }]);
    setCrewName("");
    clearCrewSig();
  };
  const removeCrewMember = (i) => setCrew(prev => prev.filter((_, idx) => idx !== i));

  // ── Signature pad drawing handlers (primary worker) ──────
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

  const [addingTask, setAddingTask] = useState(false);
  const [amendingId, setAmendingId] = useState(null);
  const [amendSignature, setAmendSignature] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [resumeName, setResumeName] = useState("");
  const [resumeError, setResumeError] = useState("");
  const [resumeChoices, setResumeChoices] = useState([]);

  const resumeTodaysFLHA = async () => {
    setResumeError("");
    setResumeChoices([]);
    const name = resumeName.trim();
    if (!name) { setResumeError("Enter your name."); return; }

    try {
      const res = await fetch("/api/flhas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume", token, workerName: name }),
      });
      const data = await res.json();
      if (!res.ok) { setResumeError(data.error || "Something went wrong. Try again."); return; }
      const matches = data.matches || [];
      if (matches.length === 0) { setResumeError("No FLHA found for that name today. Check the spelling or start a new one."); return; }
      if (matches.length === 1) { loadForAmend(matches[0]); return; }
      setResumeChoices(matches);
    } catch (e) {
      setResumeError("Something went wrong. Try again.");
    }
  };

  const loadForAmend = (record) => {
    const h = record.hazards_json || {};
    setFlha(h);
    setWorkerName(record.worker_name || "");
    setJobSite(record.job_site || "");
    setAmendingId(record.id);
    setAmendSignature(record.worker_signature || null);
    // Crew acknowledged the pre-amendment hazards only — don't carry their old
    // signatures forward onto content they haven't seen. Reopen sign-off.
    setCrew([]);
    setResumeChoices([]);
    setStep("review");
  };


  const generateFLHA = async () => {
    setLoading(true);
    setGenError(false);
    const cleanTranscript = transcript.replace(/\[live\].*/s, "").trim() || taskDesc;
    const taskLabel = cleanTranscript;

    const relevantPolicies = selectRelevantPolicies(sopData.policies, cleanTranscript, 25);

    const prompt = `You are an experienced field safety officer reviewing a worker's task description before they begin work. Your job is to identify ONLY the hazards that are genuinely relevant to what this specific worker has described — not a generic list.

Company: ${companyName}
Worker: ${workerName}
Job Site: ${jobSite}
Task Description: "${cleanTranscript}"

Company SOPs and Policies (pre-filtered to those most likely relevant to this task):
${relevantPolicies.map((p, i) => `${i + 1}. ${p}`).join("\n")}

INSTRUCTIONS:
- Read the task description carefully. Only flag hazards that are directly present or likely given what the worker described.
- Do NOT include generic hazards that have nothing to do with this task.
- If the worker mentions excavation, flag excavation hazards. If they don't mention heights, don't flag fall hazards.
- Do NOT confuse the "excavator" (a piece of equipment — same as a dozer, loader, or grader) with an "excavation" (a dug hole, trench, or pit with walls that could collapse). Operating an excavator to strip topsoil, grade, load material, or clean up spoil is SURFACE work, not excavation work, even though the machine's name contains "excavat-". Only cite excavation/trenching/shoring SOPs (cave-in, wall collapse, depth-based shoring requirements) when the task actually describes digging a hole, trench, or pit that a worker could fall into or that could collapse on someone — not merely because the machine operating is called an excavator.
- MANY company SOPs are phrased as a conditional procedure: "when doing X, do Y", "before X, confirm Y", "if performing X, wear/use Y". This is a GENERAL pattern, not specific to any one topic — it applies just as much to a pin-driving/hammer SOP or a hot-work SOP as it does to an overhead-power-line or underground-utility SOP. The fact that a conditional SOP appears in the pre-filtered list above does NOT mean its condition (X) is happening on this task. Before citing ANY such SOP — in a hazard's sopRef, in sopAlerts, or in ppeRequired — check: does the task description actually describe doing X? If not, the SOP is not triggered, full stop. This applies regardless of topic: overhead lines, underground utilities, hammer/punch/pin-driving, hot work, confined space, working at height, chemical handling, etc. — the topic doesn't matter, only whether the task actually describes that specific activity or condition.
  - If X isn't actually described in the task: do NOT add a hazard row for it, do NOT add it to sopAlerts, and do NOT add its associated gear to ppeRequired — not even in hedged/conditional form. Banned patterns anywhere in the output (hazard names, sopAlerts strings, ppeRequired items): "(if present)", "if any", "if applicable", "if performing", "if using", "when using", "should they exist" — a hedge is proof the condition isn't actually confirmed, which means it doesn't belong in the output at all, only optionally as one line in additionalNotes.
  - Example 1: task = "installing fencing around an excavated hole" with no mention of power lines. WRONG: a hazard row titled "Contact with overhead power lines (if present near hole)". RIGHT: no overhead-power-line hazard row, no sopAlerts entry for it.
  - Example 2: task = "operating an excavator to strip topsoil" with no mention of pins, hammers, punches, or repair work. WRONG: citing a "wear a face shield when driving pins with a hammer/punch" SOP in sopAlerts or adding "Face shield (if performing hydraulic pin-driving)" to ppeRequired. RIGHT: that SOP is not mentioned anywhere in the output, because nothing about pin-driving is happening on this task.
- For sopAlerts and sopRef, only cite a policy if it is SPECIFICALLY and clearly triggered by a concrete detail in the task description (a named piece of equipment, a specific hazard type, or a specific procedure) — not because it's broadly applicable to almost any task. Do NOT default to citing general catch-all policies (e.g. a blanket "PPE is mandatory" or "conduct an FLHA before starting" policy) as the reason for a hazard's control unless the hazard specifically calls for PPE or a procedure beyond the baseline. Every citation should feel like it was picked FOR this task, not reused from the last one.
- For ppeRequired, only list PPE actually needed for this specific task, using CSA-approved terminology where applicable (e.g. "CSA-approved eye protection", "CSA-approved foot protection", "CSA-approved head protection", "CSA-approved hearing protection", "CSA-approved respiratory protection", "High-visibility clothing") rather than generic brand-neutral phrasing.
- Use this standard hazard-category taxonomy as a scanning checklist so nothing gets missed — for each category below, ask whether it genuinely applies to this task per the inclusion tests further down, and include it if so (do not skip a category just because it's not the most dramatic one, but do not force an item that doesn't apply either):
  - Ergonomic: congested work area, parts of body in the line of fire, repetitive motion, over-extension, static work position, pinch points.
  - Environmental: housekeeping, dust/mist/fumes, extreme temperatures, other workers in the area, SDS/chemical safety review, biohazardous materials, communication, noise, weather conditions, working alone, unknown materials, wildlife, equipment or traffic in the area.
  - Access/egress: ladders, elevated work platforms, evacuation routes.
  - Overhead: harness/lanyard inspection, barricades and signage, falling objects, overhead utility lines.
  - Equipment: struck-by, mechanical failure, communication with equipment operators, cuts/abrasion/laceration, vehicle traffic, burns, fire, line-of-sight/visual contact, pinch points/crushing, mounting/dismounting, hot work.
  - Electrical: lockout/tagout, working on or near energized equipment, electrical cords/tools.
  This taxonomy is a memory aid for coverage, not a license to override the grounding rules above or below — the circumstantial categories (working alone, weather, overhead lines, underground utilities) still need an actual signal in the task description per the EXCEPTION rule below, and everything else still needs to pass test (a) or (b) below.
- Identify all hazards genuinely relevant to this task — aim for a THOROUGH assessment, typically 10-15 hazards, not a minimal one. A short list is not a sign of quality here; a real FLHA covers the whole workday around the task, including the routine Low-risk items, not just the one or two most dramatic risks. Low-risk hazards are just as important to document as High ones — do not trim them for brevity. A hazard belongs on the list if ANY of these is true:
  (a) It's inherent to the actual work, equipment, or environment described — a competent safety officer would expect it just from knowing what the worker is doing, even if the worker didn't use the specific word for it and even if no company SOP covers it. Example: a task description that says "operate an excavator and dozer" foreseeably involves restricted cab visibility/blind spots, 3-point contact when mounting/dismounting the machine, mechanical breakdown or hydraulic/fuel leaks and spill response, and working near other equipment or personnel on an active site — include hazards like these even with no matching SOP (sopRef: null is completely normal and expected for this kind of hazard — do not skip a real hazard just because you have nothing to cite).
  (b) It's tied to a specific circumstantial detail the worker actually described (a named piece of equipment, a specific procedure, a stated site condition).
  (c) It's a standard baseline hazard that belongs on virtually every field FLHA regardless of the specific task — worker fitness for duty (fatigue, illness, medication, impairment); awareness of the site's muster point and emergency response plan, including confirming 911/emergency services availability; and having a working communication method on hand (two-way radio, cell phone, or land line, whichever the task or site implies) are always worth including (typically Low risk) even when nothing in the task description calls them out specifically. Unlike (a) and (b), these don't need to be "inherent to the described work" — they're baseline readiness items for anyone on site.
  Do NOT pad the list with hazards that belong to a DIFFERENT kind of job than the one described (e.g. don't add fall-from-height hazards to ground-level work) just to hit a count. The test for (a)/(b) is "would this hazard actually occur doing the described work" — not "is there a literal keyword match in the task text," and not "is there an SOP to cite."
  - EXCEPTION — a few hazard categories depend on a circumstance that may or may not exist today, so they need an actual signal in the task description before you add them (a keyword match IS required here, unlike the general case above):
    - Do NOT add a "working alone" / isolation / communication-check hazard unless the task explicitly says the worker is alone, unsupervised, or in a remote/no-signal location. The mere absence of any mention of coworkers is NOT evidence of solo work.
    - Do NOT add a weather/environmental hazard unless the task explicitly mentions a weather, temperature, precipitation, wind, or lighting/visibility condition. "End of day" or a location name alone does not imply weather or darkness.
    - Do NOT add an overhead-power-line, underground-utility, or excavation-collapse hazard, or infer a hazard purely from the type of site named (e.g. "gas station," "roadway," "warehouse"), unless the task gives a concrete indication of that specific condition — see the rules above.
- Risk levels — rate the RESIDUAL risk (the risk that REMAINS after accounting for the safeguards and controls the worker has already described). Apply STRICTLY:
  - CRITICAL RULE: If the worker has described a control that properly manages a hazard (e.g. "using a trench box" for excavation collapse, "locked out the equipment" for energized machinery, "using a fall arrest harness" for heights), then the residual risk is REDUCED — usually to High or Medium — NOT Extreme. A well-controlled hazard is not Extreme.
  - "Extreme" = even WITH normal controls in place, a single mistake or equipment failure could realistically be CATASTROPHIC or FATAL, with almost no margin for error. Reserve ONLY for inherently life-threatening work where the danger persists despite safeguards: working on an energized high-voltage source, entry into a confined space with a hazardous atmosphere, work on a LIVE (un-isolated) pressurized water/gas main, a critical/complex crane lift over people, or hot work in a confirmed explosive atmosphere. Extreme is rare. If a proper safeguard is described, it is almost never Extreme.
  - "High" = could cause serious injury or death, but is either routine work or a serious hazard that is being actively controlled by the worker's described safeguards (e.g. excavation collapse WITH a trench box, work at height WITH fall protection). This is where most managed high-risk work lands.
  - "Medium" = could cause injury.
  - "Low" = minor risk.
- Read the task description for controls the worker already mentioned, and lower the risk accordingly. Do not rate the raw hazard — rate what could still realistically happen given their approach.
- If a hazard is already well-controlled by the worker's described approach, rate it Lower.

Respond ONLY with a valid JSON object (no markdown, no backticks):
{
  "taskSummary": "one sentence summary of what the worker is doing",
  "hazards": [
    { "hazard": "specific hazard name", "risk": "Low|Medium|High|Extreme", "control": "specific control measure for this task", "sopRef": "exact SOP text this references, or null" }
  ],
  "sopAlerts": ["only SOPs specifically triggered by this task"],
  "ppeRequired": ["only PPE needed for this specific task"],
  "additionalNotes": "any task-specific safety notes the worker should know, or null"
}`;

    try {
      const res = await fetch("/api/generate-flha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, token })
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

      const unhedgedHazards = stripHedged(parsed.hazards, h => `${h.hazard || ""} ${h.control || ""}`);
      const groundedHazards = stripUngroundedHazards(unhedgedHazards, cleanTranscript);
      const tagged = groundedHazards.map(h => ({ ...h, task: parsed.taskSummary || taskLabel }));
      const groundedAlerts = stripUngroundedAlerts(stripHedged(parsed.sopAlerts, a => a), cleanTranscript);
      const groundedPPE = stripHedged(parsed.ppeRequired, p => p);

      if (addingTask && flha) {
        setFlha(prev => {
          const mergedPPE = Array.from(new Set([...(prev.ppeRequired || []), ...groundedPPE]));
          const mergedAlerts = Array.from(new Set([...(prev.sopAlerts || []), ...groundedAlerts]));
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
        const withBaseline = ensureBaselineHazards(tagged, parsed.taskSummary || taskLabel);
        setFlha({ ...parsed, hazards: withBaseline, sopAlerts: groundedAlerts, ppeRequired: groundedPPE });
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

  const startAddTask = () => {
    setAddingTask(true);
    setTranscript("");
    setTaskDesc("");
    setStep("voice");
  };

  const saveFLHA = async () => {
    if (!flha) return false;
    setSavingFLHA(true);
    setSaveError(false);

    const signatureDataUrl = amendingId ? amendSignature : getSignatureDataUrl();
    const amendedNote = amendingId ? `Amended ${new Date().toLocaleString("en-CA")}` : null;

    const hasExtreme = (flha.hazards || []).some(h => h.risk === "Extreme");
    const newStatus = hasExtreme ? "pending_approval" : "complete";

    const customEntries = customFields
      .map(f => ({ label: f.label, value: (customValues[f.id] || "").trim() }))
      .filter(e => e.value);
    const flhaWithCustom = customEntries.length > 0
      ? { ...flha, customFields: customEntries }
      : (flha.customFields ? flha : { ...flha });

    const pdfUrl = await generateAndUploadFLHA({
      flha: flhaWithCustom,
      workerName,
      jobSite,
      signName: workerName,
      companyName,
      signatureDataUrl,
      companyLogo,
      amendedNote,
      pendingApproval: newStatus === "pending_approval",
      crewSignatures: crew,
    });

    try {
      const res = amendingId
        ? await fetch("/api/flhas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "submit",
              token,
              amendingId,
              record: {
                job_site: jobSite,
                task_description: (flha.hazards || []).map(h => h.task).filter((v, i, a) => v && a.indexOf(v) === i).join(" | "),
                hazards_json: flhaWithCustom,
                pdf_url: pdfUrl || null,
                status: newStatus,
                crew_signatures: crew,
              },
            }),
          })
        : await fetch("/api/flhas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "submit",
              token,
              record: {
                worker_name: workerName,
                job_site: jobSite,
                task_description: transcript.replace(/\[live\].*/s, "").trim() || taskDesc,
                hazards_json: flhaWithCustom,
                signed_by: workerName,
                pdf_url: pdfUrl || null,
                status: newStatus,
                worker_signature: signatureDataUrl || null,
                crew_signatures: crew,
              },
            }),
          });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        console.error("FLHA save failed:", res.status, errBody);
        setSaveError(true);
        setSavingFLHA(false);
        return false;
      }
    } catch (e) {
      console.error("FLHA save failed:", e);
      setSaveError(true);
      setSavingFLHA(false);
      return false;
    }
    setSavingFLHA(false);
    setPendingApproval(newStatus === "pending_approval");
    return true;
  };

  const riskColor = r => r === "Extreme" ? "extreme" : r === "High" ? "red" : r === "Medium" ? "amber" : "green";

  // ── Hazard editing (worker can add/edit/remove) ──────────
  const [editingHazard, setEditingHazard] = useState(null);
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
    ghost: { background: "#F1F5F9", color: "#334155", border: "none", borderRadius: 10, padding: "11px", fontWeight: 600, fontSize: 14, cursor: "pointer", width: "100%", marginTop: 10 },
    textarea: { width: "100%", minHeight: 90, padding: "10px 12px", borderRadius: 8, border: "1.5px solid #E5E7EB", fontSize: 14, resize: "vertical", boxSizing: "border-box" },
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
          <input
            style={{ ...styles.input, marginBottom: 14, ...(loginUserName ? { background: "#F3F4F6", color: "#6B7280" } : {}) }}
            placeholder="e.g. John Smith" value={workerName}
            onChange={e => setWorkerName(e.target.value)}
            readOnly={!!loginUserName}
          />

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

          {customFields.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              {customFields.map(f => (
                <div key={f.id}>
                  <label style={styles.label}>{f.label}{f.required ? " *" : ""}</label>
                  {f.field_type === "dropdown" ? (
                    <select style={styles.input} value={customValues[f.id] || ""} onChange={e => setCustomValues(v => ({ ...v, [f.id]: e.target.value }))}>
                      <option value="">Select…</option>
                      {(f.options || "").split(",").map(o => o.trim()).filter(Boolean).map(o => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input style={styles.input} placeholder={f.label} value={customValues[f.id] || ""} onChange={e => setCustomValues(v => ({ ...v, [f.id]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
          )}

          <button style={styles.btn("#F97316")} onClick={async () => {
            if (!workerName || !jobSite) return;
            const missing = customFields.filter(f => f.required && !(customValues[f.id] || "").trim());
            if (missing.length > 0) { alert(`Please fill in: ${missing.map(m => m.label).join(", ")}`); return; }
            const trimmed = jobSite.trim();
            const exists = sites.some(s => s.name.toLowerCase() === trimmed.toLowerCase());
            if (!exists && companyId) {
              try {
                const res = await fetch("/api/companydata", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "add_site", token, companyId, name: trimmed }),
                });
                const data = await res.json();
                if (res.ok && data.site) setSites(prev => [...prev, data.site]);
              } catch (e) { /* proceed even if the save fails — not worth blocking the FLHA */ }
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
                <div style={{ fontWeight: 700, fontSize: 17 }}>Job Hazard Analysis</div>
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
              <div style={{ fontWeight: 700, fontSize: 14 }}>Hazard / Control Checklist</div>
              <button onClick={openNewHazard} style={{ background: "#1E3A5F", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Add hazard</button>
            </div>

            {editingHazard === "new" && (
              <div style={{ border: "1.5px dashed #1E3A5F", borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>
                <input style={{ ...styles.input, marginBottom: 8 }} placeholder="Hazard (what's the risk?)" value={hazardDraft.hazard} onChange={e => setHazardDraft(d => ({ ...d, hazard: e.target.value }))} />
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  {["Low", "Medium", "High", "Extreme"].map(r => (
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

            {flha.hazards?.length > 0 && (
              <div style={{ display: "flex", padding: "0 4px 6px", fontSize: 10, fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.4 }}>
                <div style={{ flex: "0 0 46px" }}>#</div>
                <div style={{ flex: 1 }}>Hazard / Control / SOP Ref</div>
                <div style={{ flex: "0 0 70px", textAlign: "right" }}>Risk</div>
              </div>
            )}

            {flha.hazards?.map((h, i) => {
              const prevTask = i > 0 ? flha.hazards[i - 1].task : null;
              const showTaskHeader = h.task && h.task !== prevTask;
              const taskNumber = showTaskHeader
                ? [...new Set(flha.hazards.slice(0, i + 1).map(x => x.task))].length
                : null;
              const rowStyle = RISK_ROW_STYLE[h.risk] || RISK_ROW_STYLE.Low;
              return (
              <div key={i}>
              {showTaskHeader && (
                <div style={{ background: "#EFF6FF", borderRadius: 8, padding: "8px 12px", marginBottom: 8, marginTop: i > 0 ? 10 : 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#1E3A5F", textTransform: "uppercase", letterSpacing: 0.5 }}>Task {taskNumber}</div>
                  <div style={{ fontSize: 13, color: "#374151", marginTop: 1 }}>{h.task}</div>
                </div>
              )}
              {editingHazard === i ? (
                <div style={{ border: "1.5px dashed #1E3A5F", borderRadius: 10, padding: "14px 16px", marginBottom: 8 }}>
                  <input style={{ ...styles.input, marginBottom: 8 }} value={hazardDraft.hazard} onChange={e => setHazardDraft(d => ({ ...d, hazard: e.target.value }))} />
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {["Low", "Medium", "High", "Extreme"].map(r => (
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
                <div style={{ display: "flex", alignItems: "flex-start", gap: 0, borderLeft: `4px solid ${rowStyle.border}`, background: rowStyle.bg, borderRadius: 8, padding: "10px 12px", marginBottom: 6 }}>
                  <div style={{ flex: "0 0 30px", fontWeight: 800, fontSize: 13, color: "#94A3B8", paddingTop: 1 }}>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#1E293B", marginBottom: 3 }}>{h.hazard}</div>
                    <div style={{ fontSize: 13, color: "#374151", marginBottom: h.sopRef ? 3 : 0 }}><span style={{ fontWeight: 700, color: "#16A34A" }}>Control:</span> {h.control}</div>
                    {h.sopRef && <div style={{ fontSize: 11, color: "#6B7280", fontStyle: "italic" }}>📋 SOP Ref: {h.sopRef}</div>}
                    <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                      <button onClick={() => openEditHazard(i)} style={{ background: "transparent", border: "none", color: "#1E3A5F", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>Edit</button>
                      <button onClick={() => removeHazard(i)} style={{ background: "transparent", border: "none", color: "#DC2626", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>Remove</button>
                    </div>
                  </div>
                  <div style={{ flex: "0 0 66px", textAlign: "right", paddingTop: 1 }}>
                    <span style={{ background: rowStyle.badgeBg, color: rowStyle.badgeText, borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 800 }}>{h.risk}</span>
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

          <button style={styles.btn("#F97316")} onClick={() => setStep("signoff")}>Continue to Sign-Off →</button>
        </>
      )}

      {step === "signoff" && flha && (
        <>
          <div style={styles.card}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>{amendingId ? "Confirm Amendment" : "Worker Sign-Off"}</div>
            <div style={{ fontSize: 13, color: "#6B7280" }}>Primary worker: <strong>{workerName}</strong>{amendingId ? " — confirming the added task(s)." : ""}</div>
          </div>

          {amendingId ? (
            <div style={styles.card}>
              <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 14 }}>By confirming, I acknowledge I have reviewed the added task(s) and understand the hazards and controls. This amendment will be time-stamped on the document.</div>
              <div style={{ background: "#EFF6FF", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
                <div style={{ fontSize: 13, color: "#374151" }}>Worker: <strong>{workerName}</strong></div>
                <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>Amendment will be recorded {new Date().toLocaleString("en-CA")}</div>
              </div>
            </div>
          ) : (
            <div style={styles.card}>
              <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 14 }}>By signing, I confirm I have reviewed this FLHA and understand the hazards and controls before starting work.</div>

              <label style={styles.label}>Worker signature</label>
              <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 6, lineHeight: 1.4 }}>By signing, you take full responsibility for the accuracy of this document — FORA is not liable for any errors or omissions.</div>
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, color: "#374151" }}>Signed by: <strong>{workerName}</strong></div>
                <button onClick={clearSignature} style={{
                  background: "transparent", border: "none", color: "#6B7280",
                  fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0
                }}>Clear signature</button>
              </div>
            </div>
          )}

          {/* Crew sign-off — additional workers acknowledging the same FLHA. Reopened on
              amendments too, since the crew hasn't yet acknowledged the amended hazards. */}
          <div style={styles.card}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#1E293B", marginBottom: 4 }}>Additional crew (optional)</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 12 }}>
              {amendingId
                ? "This amendment changed the FLHA — if other workers are covered by it, have each of them re-sign below."
                : "If other workers are covered by this same FLHA, have each of them sign below. Pass the device to each person."}
            </div>

            {crew.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                {crew.map((c, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < crew.length - 1 ? "1px solid #F1F5F9" : "none" }}>
                    <span style={{ fontSize: 14, color: "#334155" }}>👷 {c.name}</span>
                    <button onClick={() => removeCrewMember(i)} style={{ background: "transparent", border: "none", color: "#DC2626", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Remove</button>
                  </div>
                ))}
              </div>
            )}

            <label style={styles.label}>Crew member name</label>
            <input style={{ ...styles.input, marginBottom: 8 }} placeholder="Full name" value={crewName} onChange={e => setCrewName(e.target.value)} />
            <label style={styles.label}>Signature</label>
            <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 6, lineHeight: 1.4 }}>By signing, you take full responsibility for the accuracy of this document — FORA is not liable for any errors or omissions.</div>
            <div style={{ position: "relative", marginBottom: 6 }}>
              <canvas ref={crewCanvasRef} width={600} height={160}
                style={{ width: "100%", height: 130, border: "1.5px solid #E5E7EB", borderRadius: 10, background: "#fff", touchAction: "none", display: "block" }}
                onMouseDown={startCrewDraw} onMouseMove={crewDraw} onMouseUp={endCrewDraw} onMouseLeave={endCrewDraw}
                onTouchStart={startCrewDraw} onTouchMove={crewDraw} onTouchEnd={endCrewDraw} />
              {!crewHasSig && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 14, pointerEvents: "none" }}>Sign here</div>}
            </div>
            <div style={{ textAlign: "right", marginBottom: 10 }}>
              <button onClick={clearCrewSig} style={{ background: "transparent", border: "none", color: "#64748B", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Clear</button>
            </div>
            <button style={styles.btn((crewName.trim() && crewHasSig) ? "#1E3A5F" : "#94A3B8")} disabled={!crewName.trim() || !crewHasSig} onClick={addCrewMember}>+ Add This Crew Member</button>
          </div>

          {saveError && (
            <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "12px 14px", marginBottom: 12, fontSize: 14, color: "#991B1B" }}>
              Couldn't save this FLHA — it has NOT reached your supervisor's dashboard. Check your connection and try again.
            </div>
          )}

          {amendingId ? (
            <button style={styles.btn(signed ? "#16A34A" : "#F97316")}
              disabled={signed && !saveError}
              onClick={async () => {
                setSigned(true);
                const ok = await saveFLHA();
                if (ok) setTimeout(() => setStep("done"), 600);
                else setSigned(false);
              }}>
              {savingFLHA ? "Saving…" : signed && !saveError ? "✓ Saved" : `Confirm & Update FLHA${crew.length > 0 ? ` (+${crew.length} crew)` : ""}`}
            </button>
          ) : (
            <>
              <button style={styles.btn(signed ? "#16A34A" : hasSignature ? "#F97316" : "#9CA3AF")}
                disabled={!hasSignature || (signed && !saveError)}
                onClick={async () => {
                  setSignName(workerName);
                  setSigned(true);
                  const ok = await saveFLHA();
                  if (ok) setTimeout(() => setStep("done"), 600);
                  else setSigned(false);
                }}>
                {savingFLHA ? "Saving…" : signed && !saveError ? "✓ Signed" : `Sign & Submit FLHA${crew.length > 0 ? ` (${crew.length + 1} signed)` : ""}`}
              </button>
              <button style={styles.ghost} onClick={() => setStep("review")}>← Back to review</button>
            </>
          )}
        </>
      )}

      {step === "done" && (
        <div style={styles.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 64, marginBottom: 12 }}>{pendingApproval ? "⚠️" : "✅"}</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: "#1E3A5F", marginBottom: 6 }}>{pendingApproval ? "Awaiting Supervisor Sign-Off" : "FLHA Complete"}</div>
            <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 20 }}>
              Submitted {new Date().toLocaleString("en-CA")} by <strong>{workerName}</strong>{crew.length > 0 ? ` + ${crew.length} crew` : ""}
            </div>

            {pendingApproval && (
              <div style={{ background: "#7F1D1D", borderRadius: 10, padding: 16, marginBottom: 16, textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", marginBottom: 6 }}>🛑 EXTREME-RISK WORK — DO NOT START YET</div>
                <div style={{ fontSize: 13, color: "#FECACA", lineHeight: 1.5 }}>This FLHA contains extreme-risk activity and requires a supervisor's sign-off before work begins. Your submission has been sent to your supervisor for review and approval.</div>
              </div>
            )}

            <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 10, padding: 16, marginBottom: 16, textAlign: "left" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#166534", marginBottom: 8 }}>SUBMITTED SUCCESSFULLY</div>
              {(pendingApproval
                ? ["🗂 Saved to company FLHA database", "📄 PDF generated (marked pending approval)", "🔔 Sent to supervisor for required sign-off"]
                : ["🗂 Saved to company FLHA database", "📄 PDF generated and stored for supervisor", "📊 Hazard data recorded for site trends", "🔔 Available in supervisor dashboard"]
              ).map((n, i) => (
                <div key={i} style={{ fontSize: 13, color: "#374151", marginBottom: 4 }}>{n}</div>
              ))}
            </div>
            <a href="/dashboard" style={{
              display: "block", background: "#F97316", color: "#fff", borderRadius: 9,
              padding: "12px 20px", fontWeight: 700, fontSize: 15, textDecoration: "none",
              marginBottom: 10, textAlign: "center"
            }}>View Dashboard →</a>
            <button style={styles.btn("#1E3A5F")} onClick={() => { setStep("company"); setTranscript(""); setTaskDesc(""); setFlha(null); setSigned(false); setSignName(""); setHasSignature(false); setWorkerName(""); setJobSite(""); setPendingApproval(false); setAmendingId(null); setCrew([]); setSiteMode(sites.length > 0 ? "list" : "other"); }}>
              Start New FLHA
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
