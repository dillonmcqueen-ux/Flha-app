import { useState, useRef, useEffect } from "react";
import { generateAndUploadFLHA } from "./generatePDF";
import { loadDraft, clearDraft, useDraftAutosave } from "./useDraftAutosave.js";
import { enqueueSubmission } from "./offlineQueue.js";
import { fetchCompanyProfile, buildCompanyContextBlock } from "./companyProfile.js";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD, glow as GLOW } from "./theme";
import {
  HardHat, LogOut, CheckCircle2, Mic, Square, AlertTriangle, MapPin,
  ClipboardList, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  FileText, Plus, Pencil, X, User, WifiOff, ShieldAlert, Database,
  BarChart3, Bell,
} from "lucide-react";

function newClientSubmissionId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Redoes a fresh FLHA submission (PDF generation + upload + the final POST)
// from plain input data — used both by a live online saveFLHA() below and by
// offlineQueue's drainQueue() to resend a queued one later. Amendments
// (amendingId) are deliberately not covered here — they're out of offline
// scope, see docs/scope-offline-capability.md's open question 4. Throws on
// any failure so the caller can tell success from failure; never touches UI
// state itself. Exported so WorkerMenu.jsx can drain this form's queue
// without needing the FLHA component mounted.
export async function resubmitFLHA(payload, clientSubmissionId, tokenForRequest) {
  const { flha, workerName, jobSite, taskDescription, signatureDataUrl, companyName, companyLogo, crew, aiEditSignal } = payload;
  const hasExtreme = (flha.hazards || []).some(h => h.risk === "Extreme");
  const newStatus = hasExtreme ? "pending_approval" : "complete";

  const pdfUrl = await generateAndUploadFLHA({
    flha, workerName, jobSite, signName: workerName, companyName, signatureDataUrl, companyLogo,
    amendedNote: null, pendingApproval: newStatus === "pending_approval", crewSignatures: crew,
  });

  let res;
  try {
    res = await fetch("/api/flhas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit",
        token: tokenForRequest,
        clientSubmissionId,
        aiEditSignal: aiEditSignal || null,
        record: {
          worker_name: workerName,
          job_site: jobSite,
          task_description: taskDescription,
          hazards_json: flha,
          signed_by: workerName,
          pdf_url: pdfUrl || null,
          status: newStatus,
          worker_signature: signatureDataUrl || null,
          crew_signatures: crew,
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
}

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

// docs/scope-company-brain.md Phase 3 — diffs the AI-generated hazard
// baseline against what actually got submitted, keyed on hazard name
// (case-insensitive), so a company_signals row only gets written for a
// *substantive* edit: a hazard added, removed, or its risk level changed.
// Wording-only edits (e.g. a reworded control with the same hazard name
// and risk) are deliberately invisible to this diff — not a real signal.
// Returns null when there's nothing worth recording (no baseline to
// compare against, or no substantive difference), so the caller can skip
// sending anything to the server at all.
function computeFlhaEditSignal(baseline, finalHazards) {
  if (!baseline || baseline.length === 0) return null;
  const norm = h => (h.hazard || "").trim().toLowerCase();
  const baseMap = new Map(baseline.filter(h => norm(h)).map(h => [norm(h), h.risk]));
  const finalMap = new Map((finalHazards || []).filter(h => norm(h)).map(h => [norm(h), h.risk]));

  const removed = [...baseMap.keys()].filter(k => !finalMap.has(k));
  const added = [...finalMap.keys()].filter(k => !baseMap.has(k));
  const riskChanged = [...baseMap.keys()]
    .filter(k => finalMap.has(k) && finalMap.get(k) !== baseMap.get(k))
    .map(k => ({ hazard: k, from: baseMap.get(k), to: finalMap.get(k) }));

  if (removed.length === 0 && added.length === 0 && riskChanged.length === 0) return null;
  return {
    added: added.slice(0, 20),
    removed: removed.slice(0, 20),
    riskChanged: riskChanged.slice(0, 20),
  };
}

// Badge colors now map onto theme.colors.status.* instead of a hardcoded
// blue/green/amber/red/extreme hex map — same status language Dashboard.jsx
// uses for its own badges.
const BADGE_TONE = {
  blue: C.status.info,
  green: C.status.success,
  amber: C.status.warning,
  red: C.status.danger,
  extreme: { solid: C.risk.extreme.solid, text: "#FFFFFF", bg: C.risk.extreme.solid, border: C.risk.extreme.solid },
};

function Badge({ text, color = "blue" }) {
  const t = BADGE_TONE[color] || BADGE_TONE.blue;
  return (
    <span style={{ background: t.bg, color: t.text, border: `1px solid ${t.border}`, borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>
      {text}
    </span>
  );
}

// Same structure as the pre-redesign Stepper — connector line + numbered
// circle + label — just reskinned onto theme tokens, with a CheckCircle2
// icon replacing the "✓" glyph for a completed step.
function Stepper({ step }) {
  const labels = ["Setup", "Voice", "Review", "Sign-Off", "Complete"];
  return (
    <div style={{ display: "flex", gap: 0 }}>
      {labels.map((label, i) => {
        const active = i === STEPS.indexOf(step);
        const done = STEPS.indexOf(step) > i;
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
              {i > 0 && <div style={{ flex: 1, height: 2, background: done || active ? C.orange : C.line }} />}
              <div style={{
                width: 30, height: 30, borderRadius: "50%",
                background: done ? C.orange : active ? C.panelRaised : C.panelInset,
                border: active && !done ? `1.5px solid ${C.orange}` : "none",
                color: done ? C.text.onOrange : active ? C.orange : C.text.faint,
                boxShadow: done ? GLOW.orangeSoft : "none",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 13, flexShrink: 0
              }}>
                {done ? <CheckCircle2 size={16} strokeWidth={2.5} /> : i + 1}
              </div>
              {i < labels.length - 1 && <div style={{ flex: 1, height: 2, background: done ? C.orange : C.line }} />}
            </div>
            <span style={{ fontSize: 10, marginTop: 6, color: active ? C.orange : done ? C.text.body : C.text.faint, fontWeight: active ? 700 : 500, textAlign: "center" }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Reuses theme.colors.risk instead of a hand-copied light-mode hex map —
// same scale Dashboard.jsx's RISK_COLOR uses for the FLHACard modal.
const RISK_ROW_STYLE = {
  Extreme: { bg: C.risk.extreme.bg, border: C.risk.extreme.border, badgeBg: C.risk.extreme.solid, badgeText: "#fff" },
  High: { bg: C.risk.high.bg, border: C.risk.high.border, badgeBg: C.risk.high.bg, badgeText: C.risk.high.text },
  Medium: { bg: C.risk.medium.bg, border: C.risk.medium.border, badgeBg: C.risk.medium.bg, badgeText: C.risk.medium.text },
  Low: { bg: C.risk.low.bg, border: C.risk.low.border, badgeBg: C.risk.low.bg, badgeText: C.risk.low.text },
};

export default function FLHAApp({ forcedCompanyId = null, companyName: propCompanyName = "", userName: loginUserName = "", onLogout = null, token = null }) {
  const [step, setStep] = useState("company");
  const [sopData, setSopData] = useState(FALLBACK_SOPS);
  const [sopsLoading, setSopsLoading] = useState(true);
  const [companyName, setCompanyName] = useState(propCompanyName || FALLBACK_SOPS.company);
  const [companyId, setCompanyId] = useState(forcedCompanyId);
  const [companyLogo, setCompanyLogo] = useState("");
  const [debugInfo, setDebugInfo] = useState("");
  // docs/scope-company-brain.md Phase 5 — null until loaded, and stays
  // null for a company with no profile yet (cold start); buildCompanyContextBlock
  // handles null gracefully so the prompt doesn't need to branch on it.
  const [companyProfile, setCompanyProfile] = useState(null);

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

      // Company profile (docs/scope-company-brain.md Phase 5) — best-effort
      // (fetchCompanyProfile never throws): a company with no profile yet
      // just gets null, which buildCompanyContextBlock treats as "nothing
      // to add".
      setCompanyProfile(await fetchCompanyProfile(token, forcedCompanyId));

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
  // docs/scope-company-brain.md Phase 3 — snapshot of {hazard, risk} pairs
  // exactly as the AI generated them, captured before any worker edit.
  // Compared against the final submitted hazards at save time to detect a
  // *substantive* edit (hazard added/removed, or risk level changed) for
  // company_signals. A ref, not state: it must survive across renders
  // without itself triggering one, and nothing in the UI reads it directly.
  const aiBaselineRef = useRef([]);
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

  // ── Offline resilience: local draft autosave (docs/scope-offline-capability.md Phase 0) ──
  // Restores an in-progress, not-yet-submitted FLHA on mount, then
  // debounced-saves it to this device's localStorage as it changes — so a
  // dropped connection, a crash, or an accidental navigation doesn't cost
  // the worker their typed task description or AI-generated hazards.
  // Deliberately excludes the signature canvas (hasSignature/signed) and
  // the amend flow (amendingId) — see the scope doc for why.
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    if (!forcedCompanyId) return;
    const draft = loadDraft("flha", forcedCompanyId);
    if (draft && draft.step && draft.step !== "done" && draft.step !== "company") {
      if (draft.workerName) setWorkerName(draft.workerName);
      if (draft.jobSite) setJobSite(draft.jobSite);
      if (draft.siteMode) setSiteMode(draft.siteMode);
      if (draft.taskDesc) setTaskDesc(draft.taskDesc);
      if (draft.transcript) setTranscript(draft.transcript);
      if (draft.customValues) setCustomValues(draft.customValues);
      if (draft.flha) setFlha(draft.flha);
      if (draft.crew) setCrew(draft.crew);
      if (draft.signName) setSignName(draft.signName);
      setStep(draft.step);
    }
    setDraftRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcedCompanyId]);

  useDraftAutosave(
    "flha",
    forcedCompanyId,
    { step, workerName, jobSite, siteMode, taskDesc, transcript, customValues, flha, crew, signName },
    draftRestored && !!forcedCompanyId && !amendingId
  );

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
${buildCompanyContextBlock(companyProfile, { includeHazardEmphasis: true })}
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
        aiBaselineRef.current = [...aiBaselineRef.current, ...tagged.map(h => ({ hazard: h.hazard, risk: h.risk }))];
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
            ai_assisted: true,
          };
        });
        setAddingTask(false);
      } else {
        const withBaseline = ensureBaselineHazards(tagged, parsed.taskSummary || taskLabel);
        aiBaselineRef.current = withBaseline.map(h => ({ hazard: h.hazard, risk: h.risk }));
        setFlha({ ...parsed, hazards: withBaseline, sopAlerts: groundedAlerts, ppeRequired: groundedPPE, ai_assisted: true });
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

  // docs/scope-offline-capability.md Phase 2: if /api/generate-flha can't be
  // reached, let the worker continue instead of getting stuck — the review
  // step already lets a worker add/edit/remove hazards by hand ("+ Add
  // hazard"), so the fallback just needs to get them there without an AI
  // call. Adding a task to an existing FLHA (addingTask) needs no new
  // state — the worker adds it manually via the same UI. A fresh FLHA gets
  // an empty skeleton to fill in. Either way ai_assisted flips to false so
  // a supervisor knows to double-check this one — even when only the most
  // recent added task skipped AI, since the flag covers the whole record.
  const continueWithoutAI = () => {
    if (addingTask && flha) {
      setFlha(prev => ({ ...prev, ai_assisted: false }));
      setAddingTask(false);
    } else {
      const cleanTranscript = transcript.replace(/\[live\].*/s, "").trim() || taskDesc;
      aiBaselineRef.current = [];
      setFlha({ taskSummary: cleanTranscript, hazards: [], sopAlerts: [], ppeRequired: [], additionalNotes: null, ai_assisted: false });
    }
    setGenError(false);
    setStep("review");
    setTranscript("");
    setTaskDesc("");
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

    // Amendments are out of offline scope (docs/scope-offline-capability.md
    // open question 4 — a conflict is possible if the record also changed
    // server-side while offline) so they keep the original direct-fetch
    // path, no queueing.
    if (amendingId) {
      try {
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

        const res = await fetch("/api/flhas", {
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
      clearDraft("flha", forcedCompanyId);
      return true;
    }

    // Fresh submission (docs/scope-offline-capability.md Phase 1) — a
    // network-level failure gets queued and retried automatically once
    // back online instead of silently discarding the FLHA; a real
    // server-side rejection shows an error and lets the worker retry
    // manually, same as the FLHA form already did before this pass.
    const taskDescription = transcript.replace(/\[live\].*/s, "").trim() || taskDesc;
    const clientSubmissionId = newClientSubmissionId();
    // docs/scope-company-brain.md Phase 3 — only meaningful when the whole
    // record actually went through AI (ai_assisted), since a mixed record
    // (one task AI-generated, another added manually via continueWithoutAI)
    // can't be cleanly attributed to "the AI's version" as a single baseline.
    const aiEditSignal = flha.ai_assisted ? computeFlhaEditSignal(aiBaselineRef.current, flha.hazards) : null;
    const payload = { flha: flhaWithCustom, workerName, jobSite, taskDescription, signatureDataUrl, companyName, companyLogo, crew, aiEditSignal };

    if (!navigator.onLine) {
      await enqueueSubmission("flha", clientSubmissionId, payload);
      setSavingFLHA(false);
      clearDraft("flha", forcedCompanyId);
      return "queued";
    }

    try {
      await resubmitFLHA(payload, clientSubmissionId, token);
      setSavingFLHA(false);
      setPendingApproval(newStatus === "pending_approval");
      clearDraft("flha", forcedCompanyId);
      return true;
    } catch (e) {
      if (e.isServerError) {
        console.error("FLHA save failed:", e.message);
        setSaveError(true);
        setSavingFLHA(false);
        return false;
      }
      await enqueueSubmission("flha", clientSubmissionId, payload);
      setSavingFLHA(false);
      clearDraft("flha", forcedCompanyId);
      return "queued";
    }
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


  // Same design system as Dashboard.jsx (src/theme.js). `btn`/`ghost`/`input`
  // keep a `minHeight` of 44+ — this form is filled out standing on a
  // jobsite, often on a phone, often with gloves on, so touch targets don't
  // shrink just because the palette changed.
  const styles = {
    wrap: { fontFamily: FONT.body, background: C.bg, minHeight: "100vh", color: C.text.primary },
    card: { background: C.panel, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: "20px", marginBottom: 16, boxShadow: SHAD.md },
    label: { display: "block", fontWeight: 700, fontSize: 11, color: C.text.muted, marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.04em" },
    input: { width: "100%", padding: "12px 13px", borderRadius: RAD.sm, border: `1.5px solid ${C.line}`, fontSize: 15, boxSizing: "border-box", outline: "none", background: C.panelInset, color: C.text.primary, minHeight: 44 },
    btn: (bg, fg = C.text.onDark) => ({
      background: bg, color: fg, border: "none", borderRadius: RAD.md, padding: "13px 20px",
      fontWeight: 700, fontSize: 15, cursor: "pointer", width: "100%", minHeight: 48,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxSizing: "border-box",
    }),
    ghost: {
      background: C.panelInset, color: C.text.body, border: `1px solid ${C.line}`, borderRadius: RAD.md,
      padding: "12px", fontWeight: 600, fontSize: 14, cursor: "pointer", width: "100%", marginTop: 10,
      minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxSizing: "border-box",
    },
    textarea: { width: "100%", minHeight: 100, padding: "12px 13px", borderRadius: RAD.sm, border: `1.5px solid ${C.line}`, fontSize: 15, resize: "vertical", boxSizing: "border-box", background: C.panelInset, color: C.text.primary, outline: "none" },
  };

  return (
    <div style={styles.wrap}>
      {/* Sticky header — same pattern as Dashboard.jsx/WorkerMenu.jsx: glow dot
          + wordmark on the left (company logo substitutes for the dot+HardHat
          tile when one exists), Exit on the right. */}
      <header style={{
        position: "sticky", top: 0, zIndex: 40,
        background: "rgba(10,10,10,0.88)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        borderBottom: `1px solid ${C.line}`, padding: "14px 20px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {companyLogo
            ? <img src={companyLogo} alt="" style={{ width: 36, height: 36, borderRadius: RAD.sm, objectFit: "cover", background: "#fff", flexShrink: 0 }} />
            : (
              <div style={{
                width: 36, height: 36, borderRadius: RAD.sm, flexShrink: 0, background: C.orangeSoft,
                border: `1px solid ${C.orangeDim}`, display: "flex", alignItems: "center", justifyContent: "center",
              }}><HardHat size={19} color={C.orange} strokeWidth={2.25} /></div>
            )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 17, color: C.text.primary, letterSpacing: "-0.01em" }}>FLHA</div>
            <div style={{ fontSize: 11, color: C.text.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>AI-powered Field Level Hazard Assessment</div>
          </div>
        </div>
        {onLogout && (
          <button onClick={onLogout} style={{
            display: "flex", alignItems: "center", gap: 6, color: C.text.body, fontSize: 13,
            border: `1px solid ${C.line}`, background: "transparent", padding: "8px 14px",
            borderRadius: RAD.md, cursor: "pointer", fontWeight: 600, flexShrink: 0, minHeight: 36,
          }}>
            <LogOut size={14} /> Exit
          </button>
        )}
      </header>

      <div style={{ padding: 16 }}>

      <div style={styles.card}>
        <Stepper step={step} />
      </div>

      {step === "company" && (
        <div style={styles.card}>
          <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 17, color: C.text.primary, marginBottom: 4 }}>Site & Worker Info</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 18 }}>Pre-loaded with <strong style={{ color: C.text.body }}>{sopData.company}</strong> SOPs ({sopData.policies.length} policies)</div>

          <label style={styles.label}>Worker Name</label>
          <input
            style={{ ...styles.input, marginBottom: 14, ...(loginUserName ? { background: C.panelInset, color: C.text.muted, opacity: 0.8 } : {}) }}
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
                <option value="__other__">+ Other site (type a new one)</option>
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
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "none", color: C.orange, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "6px 0", marginBottom: 16, minHeight: 32 }}>
                  <ChevronLeft size={14} /> Choose from saved sites
                </button>
              )}
              {sites.length === 0 && <div style={{ marginBottom: 22 }} />}
            </>
          )}

          <div style={{ background: C.status.info.bg, border: `1px solid ${C.status.info.border}`, borderRadius: RAD.md, marginBottom: 22, overflow: "hidden" }}>
            <button
              onClick={() => setSopsOpen(o => !o)}
              style={{
                width: "100%", background: "transparent", border: "none", cursor: "pointer",
                padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center",
                fontWeight: 600, fontSize: 13, color: C.status.info.text, minHeight: 44, boxSizing: "border-box",
              }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}><ClipboardList size={14} /> Loaded Company SOPs ({sopData.policies.length})</span>
              {sopsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {sopsOpen && (
              <div style={{ padding: "0 14px 12px", maxHeight: 240, overflowY: "auto" }}>
                {sopData.policies.map((p, i) => (
                  <div key={i} style={{ fontSize: 12, color: C.text.body, marginBottom: 5 }}>• {p}</div>
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
                    <select style={{ ...styles.input, marginBottom: 14 }} value={customValues[f.id] || ""} onChange={e => setCustomValues(v => ({ ...v, [f.id]: e.target.value }))}>
                      <option value="">Select…</option>
                      {(f.options || "").split(",").map(o => o.trim()).filter(Boolean).map(o => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input style={{ ...styles.input, marginBottom: 14 }} placeholder={f.label} value={customValues[f.id] || ""} onChange={e => setCustomValues(v => ({ ...v, [f.id]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
          )}

          <button style={styles.btn(C.orange, C.text.onOrange)} onClick={async () => {
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
            Continue to Voice Input <ChevronRight size={16} />
          </button>

          <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: C.text.primary }}>Already started an FLHA today?</div>
            <div style={{ fontSize: 12, color: C.text.muted, marginBottom: 10 }}>Enter your name to reopen today's FLHA and add a task to it.</div>
            <input style={{ ...styles.input, marginBottom: 8 }} placeholder="Your name (as entered earlier)" value={resumeName} onChange={e => setResumeName(e.target.value)} />
            {resumeError && <div style={{ background: C.status.danger.bg, border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "8px 12px", marginBottom: 8, fontSize: 13, color: C.status.danger.text }}>{resumeError}</div>}
            {resumeChoices.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: C.text.muted, marginBottom: 6 }}>Multiple found — pick one:</div>
                {resumeChoices.map(c => (
                  <button key={c.id} onClick={() => loadForAmend(c)} style={{ width: "100%", textAlign: "left", background: C.panelInset, border: `1px solid ${C.line}`, borderRadius: RAD.sm, padding: "10px 12px", marginBottom: 6, cursor: "pointer", minHeight: 44, boxSizing: "border-box" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text.primary }}>{c.job_site || "No site"}</div>
                    <div style={{ fontSize: 11, color: C.text.muted }}>{new Date(c.created_at).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}</div>
                  </button>
                ))}
              </div>
            )}
            <button style={styles.ghost} onClick={resumeTodaysFLHA}>
              Resume today's FLHA
            </button>
          </div>
        </div>
      )}

      {step === "voice" && (
        <div style={styles.card}>
          <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 17, color: C.text.primary, marginBottom: 4 }}>Describe Your Task</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 18 }}>Speak or type what work you're about to do. Be specific — mention equipment, location conditions, and any hazards you already see.</div>

          {hasSpeech ? (
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <button
                onClick={isListening ? stopListening : startListening}
                style={{
                  width: 100, height: 100, borderRadius: "50%", border: "none",
                  background: isListening ? C.status.danger.solid : C.orange,
                  color: isListening ? "#fff" : C.text.onOrange, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: isListening ? "0 0 0 8px rgba(239,68,68,0.22)" : GLOW.orange,
                  transition: "all 0.2s"
                }}>
                {isListening ? <Square size={34} fill="currentColor" /> : <Mic size={38} strokeWidth={2} />}
              </button>
              <div style={{ marginTop: 10, fontWeight: 600, color: isListening ? C.status.danger.text : C.text.body }}>
                {isListening ? "Listening… tap to stop" : "Tap to speak"}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: C.status.warning.bg, border: `1px solid ${C.status.warning.border}`, borderRadius: RAD.sm, padding: 12, marginBottom: 14, fontSize: 13, color: C.status.warning.text }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Voice input requires Chrome or Safari. Type your task below.</span>
            </div>
          )}

          {transcript && (
            <div style={{ background: C.panelInset, border: `1px solid ${C.line}`, borderRadius: RAD.sm, padding: 12, marginBottom: 14, fontSize: 14, color: C.text.body, minHeight: 60 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.text.faint, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.03em" }}>Transcript</div>
              {transcript.replace(/\[live\].*$/s, "").trim()}
              {transcript.includes("[live]") && (
                <span style={{ color: C.text.faint }}> {transcript.replace(/.*\[live\]/s, "").trim()}</span>
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
            <div style={{ background: C.status.danger.bg, border: `1.5px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "12px 14px", marginBottom: 12, fontSize: 14, color: C.status.danger.text }}>
              Something went wrong generating the assessment. Please check your connection and try again, or continue and add hazards yourself.
            </div>
          )}

          <button
            style={styles.btn(loading ? C.text.faint : C.status.success.solid)}
            onClick={generateFLHA}
            disabled={loading || (!transcript.replace(/\[live\].*/s, "").trim() && !taskDesc)}>
            {loading
              ? <>Analyzing against SOPs…</>
              : <><CheckCircle2 size={16} />{addingTask ? "Add this task" : "Generate FLHA"}</>}
          </button>

          {genError && (
            <button style={{ ...styles.ghost }} onClick={continueWithoutAI}>
              Continue without AI — I'll add hazards myself
            </button>
          )}

          <button style={styles.ghost} onClick={() => setStep("company")}>
            <ChevronLeft size={14} /> Back
          </button>
        </div>
      )}

      {step === "review" && flha && (
        <>
          {flha.ai_assisted === false && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: C.status.warning.bg, border: `1.5px solid ${C.status.warning.border}`, borderRadius: RAD.md, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: C.status.warning.text }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Not AI-reviewed — this hazard list was not cross-referenced against your company's SOPs. Check it carefully before submitting.</span>
            </div>
          )}
          <div style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 17, color: C.text.primary }}>Job Hazard Analysis</div>
                <div style={{ fontSize: 13, color: C.text.muted }}>{companyName} • {new Date().toLocaleDateString("en-CA")}</div>
              </div>
              <Badge text={`${workerName || "Worker"}`} color="blue" />
            </div>

            <div style={{ background: C.status.success.bg, border: `1px solid ${C.status.success.border}`, borderRadius: RAD.md, padding: "12px 14px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.status.success.text, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.03em" }}>Task Summary</div>
              <div style={{ fontSize: 14, color: C.text.body }}>{flha.taskSummary}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.text.muted, marginTop: 6 }}><MapPin size={12} /> {jobSite}</div>
            </div>

            {flha.sopAlerts?.length > 0 && (
              <div style={{ background: C.status.warning.bg, border: `1.5px solid ${C.status.warning.border}`, borderRadius: RAD.md, padding: "12px 14px", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: C.status.warning.text, marginBottom: 6 }}><AlertTriangle size={13} /> SOP Requirements Triggered</div>
                {flha.sopAlerts.map((a, i) => <div key={i} style={{ fontSize: 13, color: C.text.body, marginBottom: 3 }}>• {a}</div>)}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: flha.ai_assisted ? 2 : 10 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text.primary }}>Hazard / Control Checklist</div>
              <button onClick={openNewHazard} style={{ display: "flex", alignItems: "center", gap: 5, background: C.panelInset, color: C.text.primary, border: `1px solid ${C.line}`, borderRadius: RAD.sm, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", minHeight: 36 }}><Plus size={14} color={C.orange} /> Add hazard</button>
            </div>
            {flha.ai_assisted && (
              <div style={{ fontSize: 11.5, color: C.text.muted, marginBottom: 10 }}>AI-suggested hazards and risk levels — review each one and correct anything that's wrong or missing before you sign off.</div>
            )}

            {editingHazard === "new" && (
              <div style={{ border: `1.5px dashed ${C.orange}`, borderRadius: RAD.md, padding: "14px 16px", marginBottom: 10, background: C.panelInset }}>
                <input style={{ ...styles.input, marginBottom: 8 }} placeholder="Hazard (what's the risk?)" value={hazardDraft.hazard} onChange={e => setHazardDraft(d => ({ ...d, hazard: e.target.value }))} />
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  {["Low", "Medium", "High", "Extreme"].map(r => (
                    <button key={r} onClick={() => setHazardDraft(d => ({ ...d, risk: r }))} style={{ flex: 1, minHeight: 40, padding: "8px", borderRadius: RAD.sm, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${hazardDraft.risk === r ? C.orange : C.line}`, background: hazardDraft.risk === r ? C.orange : C.panel, color: hazardDraft.risk === r ? C.text.onOrange : C.text.muted }}>{r}</button>
                  ))}
                </div>
                <input style={{ ...styles.input, marginBottom: 8 }} placeholder="Control (how do you manage it?)" value={hazardDraft.control} onChange={e => setHazardDraft(d => ({ ...d, control: e.target.value }))} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={saveHazard} style={{ flex: 1, minHeight: 40, background: C.status.success.solid, color: "#fff", border: "none", borderRadius: RAD.sm, padding: "9px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Add</button>
                  <button onClick={cancelHazardEdit} style={{ flex: 1, minHeight: 40, background: C.panel, color: C.text.body, border: `1px solid ${C.line}`, borderRadius: RAD.sm, padding: "9px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            )}

            {flha.hazards?.length > 0 && (
              <div style={{ display: "flex", padding: "0 4px 6px", fontSize: 10, fontWeight: 800, color: C.text.faint, textTransform: "uppercase", letterSpacing: 0.4 }}>
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
                <div style={{ background: C.panelInset, border: `1px solid ${C.line}`, borderRadius: RAD.sm, padding: "8px 12px", marginBottom: 8, marginTop: i > 0 ? 10 : 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.text.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Task {taskNumber}</div>
                  <div style={{ fontSize: 13, color: C.text.body, marginTop: 1 }}>{h.task}</div>
                </div>
              )}
              {editingHazard === i ? (
                <div style={{ border: `1.5px dashed ${C.orange}`, borderRadius: RAD.md, padding: "14px 16px", marginBottom: 8, background: C.panelInset }}>
                  <input style={{ ...styles.input, marginBottom: 8 }} value={hazardDraft.hazard} onChange={e => setHazardDraft(d => ({ ...d, hazard: e.target.value }))} />
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {["Low", "Medium", "High", "Extreme"].map(r => (
                      <button key={r} onClick={() => setHazardDraft(d => ({ ...d, risk: r }))} style={{ flex: 1, minHeight: 40, padding: "8px", borderRadius: RAD.sm, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${hazardDraft.risk === r ? C.orange : C.line}`, background: hazardDraft.risk === r ? C.orange : C.panel, color: hazardDraft.risk === r ? C.text.onOrange : C.text.muted }}>{r}</button>
                    ))}
                  </div>
                  <input style={{ ...styles.input, marginBottom: 8 }} value={hazardDraft.control} onChange={e => setHazardDraft(d => ({ ...d, control: e.target.value }))} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={saveHazard} style={{ flex: 1, minHeight: 40, background: C.status.success.solid, color: "#fff", border: "none", borderRadius: RAD.sm, padding: "9px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Save</button>
                    <button onClick={cancelHazardEdit} style={{ flex: 1, minHeight: 40, background: C.panel, color: C.text.body, border: `1px solid ${C.line}`, borderRadius: RAD.sm, padding: "9px", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 0, borderLeft: `4px solid ${rowStyle.border}`, background: rowStyle.bg, borderRadius: RAD.sm, padding: "10px 12px", marginBottom: 6 }}>
                  <div style={{ flex: "0 0 30px", fontWeight: 800, fontSize: 13, color: C.text.faint, paddingTop: 1 }}>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.text.primary, marginBottom: 3 }}>{h.hazard}</div>
                    <div style={{ fontSize: 13, color: C.text.body, marginBottom: h.sopRef ? 3 : 0 }}><span style={{ fontWeight: 700, color: C.status.success.text }}>Control:</span> {h.control}</div>
                    {h.sopRef && <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.text.muted, fontStyle: "italic" }}><FileText size={11} /> SOP Ref: {h.sopRef}</div>}
                    <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
                      <button onClick={() => openEditHazard(i)} style={{ display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none", color: C.orange, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "4px 0", minHeight: 28 }}><Pencil size={11} /> Edit</button>
                      <button onClick={() => removeHazard(i)} style={{ display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none", color: C.status.danger.text, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "4px 0", minHeight: 28 }}><X size={11} /> Remove</button>
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

            <button onClick={startAddTask} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", minHeight: 44, background: C.panelInset, border: `1.5px dashed ${C.line}`, color: C.text.body, borderRadius: RAD.md, padding: "12px", fontWeight: 700, fontSize: 14, cursor: "pointer", marginTop: 4, marginBottom: 16, boxSizing: "border-box" }}>
              <Plus size={15} color={C.orange} /> Add another task
            </button>

            <div style={{ fontWeight: 700, fontSize: 14, color: C.text.primary, marginBottom: 8 }}>Required PPE</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              {flha.ppeRequired?.map((p, i) => <Badge key={i} text={p} color="blue" />)}
            </div>

            {flha.additionalNotes && (
              <div style={{ background: C.panelInset, border: `1px solid ${C.line}`, borderRadius: RAD.md, padding: "12px 14px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.03em" }}>Notes</div>
                <div style={{ fontSize: 13, color: C.text.body }}>{flha.additionalNotes}</div>
              </div>
            )}
          </div>

          <button style={styles.btn(C.orange, C.text.onOrange)} onClick={() => setStep("signoff")}>Continue to Sign-Off <ChevronRight size={16} /></button>
        </>
      )}

      {step === "signoff" && flha && (
        <>
          <div style={styles.card}>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 17, color: C.text.primary, marginBottom: 4 }}>{amendingId ? "Confirm Amendment" : "Worker Sign-Off"}</div>
            <div style={{ fontSize: 13, color: C.text.muted }}>Primary worker: <strong style={{ color: C.text.body }}>{workerName}</strong>{amendingId ? " — confirming the added task(s)." : ""}</div>
          </div>

          {amendingId ? (
            <div style={styles.card}>
              <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 14 }}>By confirming, I acknowledge I have reviewed the added task(s) and understand the hazards and controls. This amendment will be time-stamped on the document.</div>
              <div style={{ background: C.status.info.bg, border: `1px solid ${C.status.info.border}`, borderRadius: RAD.sm, padding: "12px 14px", marginBottom: 14 }}>
                <div style={{ fontSize: 13, color: C.text.body }}>Worker: <strong style={{ color: C.text.primary }}>{workerName}</strong></div>
                <div style={{ fontSize: 12, color: C.text.muted, marginTop: 2 }}>Amendment will be recorded {new Date().toLocaleString("en-CA")}</div>
              </div>
            </div>
          ) : (
            <div style={styles.card}>
              <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 14 }}>By signing, I confirm I have reviewed this FLHA and understand the hazards and controls before starting work.</div>

              <label style={styles.label}>Worker signature</label>
              <div style={{ fontSize: 11, color: C.text.faint, marginBottom: 6, lineHeight: 1.4 }}>By signing, you take full responsibility for the accuracy of this document — FORA is not liable for any errors or omissions.</div>
              {/* Canvas stays white regardless of theme — a signature is drawn in
                  dark ink and needs to look like a normal signature both on the
                  PDF and here, not a white-on-dark ghost. */}
              <div style={{ position: "relative", marginBottom: 6 }}>
                <canvas
                  ref={canvasRef}
                  width={600}
                  height={180}
                  style={{
                    width: "100%", height: 150, border: `1.5px solid ${C.line}`,
                    borderRadius: RAD.md, background: "#fff", touchAction: "none", display: "block"
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
                <div style={{ fontSize: 13, color: C.text.body }}>Signed by: <strong style={{ color: C.text.primary }}>{workerName}</strong></div>
                <button onClick={clearSignature} style={{
                  background: "transparent", border: "none", color: C.text.muted,
                  fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "6px 0", minHeight: 32
                }}>Clear signature</button>
              </div>
            </div>
          )}

          {/* Crew sign-off — additional workers acknowledging the same FLHA. Reopened on
              amendments too, since the crew hasn't yet acknowledged the amended hazards. */}
          <div style={styles.card}>
            <div style={{ fontWeight: 800, fontSize: 14, color: C.text.primary, marginBottom: 4 }}>Additional crew (optional)</div>
            <div style={{ fontSize: 12, color: C.text.muted, marginBottom: 12 }}>
              {amendingId
                ? "This amendment changed the FLHA — if other workers are covered by it, have each of them re-sign below."
                : "If other workers are covered by this same FLHA, have each of them sign below. Pass the device to each person."}
            </div>

            {crew.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                {crew.map((c, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < crew.length - 1 ? `1px solid ${C.line}` : "none" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: C.text.body }}><User size={13} color={C.text.muted} /> {c.name}</span>
                    <button onClick={() => removeCrewMember(i)} style={{ background: "transparent", border: "none", color: C.status.danger.text, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "6px 0", minHeight: 28 }}>Remove</button>
                  </div>
                ))}
              </div>
            )}

            <label style={styles.label}>Crew member name</label>
            <input style={{ ...styles.input, marginBottom: 8 }} placeholder="Full name" value={crewName} onChange={e => setCrewName(e.target.value)} />
            <label style={styles.label}>Signature</label>
            <div style={{ fontSize: 11, color: C.text.faint, marginBottom: 6, lineHeight: 1.4 }}>By signing, you take full responsibility for the accuracy of this document — FORA is not liable for any errors or omissions.</div>
            <div style={{ position: "relative", marginBottom: 6 }}>
              <canvas ref={crewCanvasRef} width={600} height={160}
                style={{ width: "100%", height: 130, border: `1.5px solid ${C.line}`, borderRadius: RAD.md, background: "#fff", touchAction: "none", display: "block" }}
                onMouseDown={startCrewDraw} onMouseMove={crewDraw} onMouseUp={endCrewDraw} onMouseLeave={endCrewDraw}
                onTouchStart={startCrewDraw} onTouchMove={crewDraw} onTouchEnd={endCrewDraw} />
              {!crewHasSig && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 14, pointerEvents: "none" }}>Sign here</div>}
            </div>
            <div style={{ textAlign: "right", marginBottom: 10 }}>
              <button onClick={clearCrewSig} style={{ background: "transparent", border: "none", color: C.text.muted, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "6px 0", minHeight: 32 }}>Clear</button>
            </div>
            <button style={styles.btn((crewName.trim() && crewHasSig) ? C.orange : C.panelInset, (crewName.trim() && crewHasSig) ? C.text.onOrange : C.text.faint)} disabled={!crewName.trim() || !crewHasSig} onClick={addCrewMember}><Plus size={15} /> Add This Crew Member</button>
          </div>

          {saveError && (
            <div style={{ background: C.status.danger.bg, border: `1.5px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "12px 14px", marginBottom: 12, fontSize: 14, color: C.status.danger.text }}>
              Couldn't save this FLHA — it has NOT reached your supervisor's dashboard. Check your connection and try again.
            </div>
          )}

          {amendingId ? (
            <button style={styles.btn(signed ? C.status.success.solid : C.orange, signed ? "#fff" : C.text.onOrange)}
              disabled={signed && !saveError}
              onClick={async () => {
                setSigned(true);
                const result = await saveFLHA();
                if (result === true) setTimeout(() => setStep("done"), 600);
                else if (result === "queued") setStep("queued");
                else setSigned(false);
              }}>
              {savingFLHA
                ? "Saving…"
                : signed && !saveError
                  ? <><CheckCircle2 size={16} /> Saved</>
                  : `Confirm & Update FLHA${crew.length > 0 ? ` (+${crew.length} crew)` : ""}`}
            </button>
          ) : (
            <>
              <button style={styles.btn(signed ? C.status.success.solid : hasSignature ? C.orange : C.text.faint, signed ? "#fff" : hasSignature ? C.text.onOrange : C.bg)}
                disabled={!hasSignature || (signed && !saveError)}
                onClick={async () => {
                  setSignName(workerName);
                  setSigned(true);
                  const result = await saveFLHA();
                  if (result === true) setTimeout(() => setStep("done"), 600);
                  else if (result === "queued") setStep("queued");
                  else setSigned(false);
                }}>
                {savingFLHA
                  ? "Saving…"
                  : signed && !saveError
                    ? <><CheckCircle2 size={16} /> Signed</>
                    : `Sign & Submit FLHA${crew.length > 0 ? ` (${crew.length + 1} signed)` : ""}`}
              </button>
              <button style={styles.ghost} onClick={() => setStep("review")}><ChevronLeft size={14} /> Back to review</button>
            </>
          )}
        </>
      )}

      {/* QUEUED — offline at submit time; queued locally and will send automatically once back online (docs/scope-offline-capability.md Phase 1) */}
      {step === "queued" && (
        <div style={styles.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <WifiOff size={52} color={C.text.faint} style={{ marginBottom: 12 }} />
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 22, color: C.text.primary, marginBottom: 6 }}>Saved — No Signal</div>
            <div style={{ fontSize: 14, color: C.text.muted, marginBottom: 8 }}>{jobSite} · {workerName}</div>
            <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 20 }}>This FLHA is saved on your device and will send automatically the next time you're back online — no need to redo it.</div>
            {onLogout && <button style={styles.btn(C.orange, C.text.onOrange)} onClick={onLogout}>Back to menu</button>}
          </div>
        </div>
      )}

      {step === "done" && (
        <div style={styles.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            {pendingApproval
              ? <AlertTriangle size={56} color={C.status.warning.text} style={{ marginBottom: 12 }} />
              : <CheckCircle2 size={56} color={C.status.success.text} style={{ marginBottom: 12 }} />}
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 22, color: C.text.primary, marginBottom: 6 }}>{pendingApproval ? "Awaiting Supervisor Sign-Off" : "FLHA Complete"}</div>
            <div style={{ fontSize: 14, color: C.text.muted, marginBottom: 20 }}>
              Submitted {new Date().toLocaleString("en-CA")} by <strong style={{ color: C.text.body }}>{workerName}</strong>{crew.length > 0 ? ` + ${crew.length} crew` : ""}
            </div>

            {pendingApproval && (
              <div style={{ background: C.risk.extreme.solid, borderRadius: RAD.md, padding: 16, marginBottom: 16, textAlign: "left", boxShadow: GLOW.ring }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 800, color: "#fff", marginBottom: 6 }}><ShieldAlert size={15} /> EXTREME-RISK WORK — DO NOT START YET</div>
                <div style={{ fontSize: 13, color: "#FECACA", lineHeight: 1.5 }}>This FLHA contains extreme-risk activity and requires a supervisor's sign-off before work begins. Your submission has been sent to your supervisor for review and approval.</div>
              </div>
            )}

            <div style={{ background: C.status.success.bg, border: `1px solid ${C.status.success.border}`, borderRadius: RAD.md, padding: 16, marginBottom: 16, textAlign: "left" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.status.success.text, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.03em" }}>Submitted Successfully</div>
              {(pendingApproval
                ? [
                  { Icon: Database, text: "Saved to company FLHA database" },
                  { Icon: FileText, text: "PDF generated (marked pending approval)" },
                  { Icon: Bell, text: "Sent to supervisor for required sign-off" },
                ]
                : [
                  { Icon: Database, text: "Saved to company FLHA database" },
                  { Icon: FileText, text: "PDF generated and stored for supervisor" },
                  { Icon: BarChart3, text: "Hazard data recorded for site trends" },
                  { Icon: Bell, text: "Available in supervisor dashboard" },
                ]
              ).map((n, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.text.body, marginBottom: 6 }}>
                  <n.Icon size={13} color={C.status.success.text} /> {n.text}
                </div>
              ))}
            </div>
            <a href="/dashboard" style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              background: C.orange, color: C.text.onOrange, borderRadius: RAD.md,
              padding: "12px 20px", fontWeight: 700, fontSize: 15, textDecoration: "none",
              marginBottom: 10, textAlign: "center", minHeight: 48, boxSizing: "border-box",
            }}>View Dashboard <ChevronRight size={16} /></a>
            <button style={styles.ghost} onClick={() => { clearDraft("flha", forcedCompanyId); setStep("company"); setTranscript(""); setTaskDesc(""); setFlha(null); aiBaselineRef.current = []; setSigned(false); setSignName(""); setHasSignature(false); setWorkerName(""); setJobSite(""); setPendingApproval(false); setAmendingId(null); setCrew([]); setSiteMode(sites.length > 0 ? "list" : "other"); }}>
              Start New FLHA
            </button>
          </div>
        </div>
      )}

      </div>
    </div>
  );
}
