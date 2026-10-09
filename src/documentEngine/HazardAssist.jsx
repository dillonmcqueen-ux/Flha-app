import { useState, useEffect, useRef } from "react";
import { colors as C, radius as RAD } from "../theme";
import { selectRelevantPolicies, buildHazardPrompt, parseHazardResponse } from "../flhaHazardAi.js";
import { fetchCompanyProfile } from "../companyProfile.js";
import { applyAiResult, withoutAiPatch } from "./hazardAssist.js";
import { Loader2, AlertTriangle, Sparkles } from "lucide-react";

// The "describe the task" box on a hazard table field whose config has
// aiAssist (the FLHA template). It runs the same prompt and clean-up the
// built-in FLHA uses (src/flhaHazardAi.js) and fills the form's fields from the
// result. The worker can still edit every hazard afterwards, and carrying on
// without the AI is always possible, so no signal never blocks a form.

const box = { width: "100%", boxSizing: "border-box", padding: "12px 13px", borderRadius: RAD.md, border: `1.5px solid ${C.line}`, fontSize: 15, background: C.panelInset, color: C.text.primary, minHeight: 90, marginBottom: 10 };
const btn = (bg) => ({ background: bg, color: "#fff", border: "none", borderRadius: RAD.md, padding: "13px", fontWeight: 800, fontSize: 15, cursor: "pointer", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 });

export default function HazardAssist({ field, answers, setMany, token, companyId, companyName, workerName, siteName, onBaseline }) {
  const cfg = field.config.aiAssist;
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [policies, setPolicies] = useState([]);
  const profile = useRef(null);
  const hasHazards = Array.isArray(answers[field.field_key]) && answers[field.field_key].some((r) => r && String(r.hazard || "").trim());

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/companydata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list_sops", token, companyId }) });
        const data = await res.json();
        if (live && res.ok) setPolicies((data.sops || []).map((s) => s.policy_text).filter(Boolean));
      } catch (e) { /* no SOPs: the AI works from the task alone */ }
      profile.current = await fetchCompanyProfile(token, companyId);
    })();
    return () => { live = false; };
  }, [token, companyId]);

  const generate = async () => {
    const task = desc.trim();
    if (!task) return;
    setBusy(true); setFailed(false);
    try {
      const prompt = buildHazardPrompt({ companyName, workerName, jobSite: siteName, cleanTranscript: task, relevantPolicies: selectRelevantPolicies(policies, task, 25), companyProfile: profile.current });
      const res = await fetch("/api/generate-flha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, token, documentType: "flha" }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const result = parseHazardResponse((data.content || []).map((b) => b.text || "").join(""), task, task);
      const { patch, baseline } = applyAiResult({ result, cfg, hazardKey: field.field_key, answers, taskLabel: task, addingTask: hasHazards });
      setMany(patch);
      onBaseline && onBaseline(baseline, hasHazards);
      setDesc("");
    } catch (e) { setFailed(true); }
    setBusy(false);
  };

  const without = () => {
    setMany(withoutAiPatch({ cfg, description: desc }));
    setDesc("");
    setFailed(false);
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <label htmlFor={`assist-${field.field_key}`} style={{ display: "block", fontWeight: 700, fontSize: 12, color: C.text.muted, marginBottom: 6, textTransform: "uppercase" }}>
        {hasHazards ? "Add another task" : "Describe the task"}
      </label>
      <textarea id={`assist-${field.field_key}`} style={box} placeholder="What are you about to do? Equipment, location, conditions, who is with you." value={desc} onChange={(e) => setDesc(e.target.value)} />
      {failed && (
        <div role="alert" style={{ display: "flex", gap: 8, fontSize: 13, color: C.status.danger.text, marginBottom: 10 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} /><span>Couldn't generate hazards. Check your connection and try again, or carry on and fill them in yourself.</span>
        </div>
      )}
      <button type="button" style={btn(busy || !desc.trim() ? C.text.faint : C.orange)} disabled={busy || !desc.trim()} onClick={generate}>
        {busy ? <><Loader2 size={16} className="fora-spin" /> Writing hazards...</> : <><Sparkles size={16} /> {hasHazards ? "Add hazards for this task" : "Generate hazards"}</>}
      </button>
      {failed && <button type="button" style={{ ...btn(C.panelInset), color: C.text.body, border: `1px solid ${C.line}`, marginTop: 10 }} onClick={without}>Carry on without AI</button>}
    </div>
  );
}
