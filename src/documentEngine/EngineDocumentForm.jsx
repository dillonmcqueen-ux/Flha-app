import { useState, useEffect } from "react";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD } from "../theme";
import { buildFormStyles, disabledBg, bannerStyle } from "../FormKit";
import { loadDraft, clearDraft, useDraftAutosave } from "../useDraftAutosave.js";
import { enqueueSubmission } from "../offlineQueue.js";
import { callDocuments } from "./builderApi.js";
import { initialAnswers, clientProblems, newClientSubmissionId, UNANSWERABLE_TYPES, RISKS, emptyHazard } from "./formModel.js";
import { submitEngineDocument, resubmitEngineDocument, loadRecordForWorker } from "./engineSubmit.js";
import { rowsToForm, hasFiles } from "./recordView.js";
import SignaturePad from "./SignaturePad.jsx";
import { shrinkImage, readAsDataUrl } from "./shrinkImage.js";
import { ArrowLeft, Loader2, CheckCircle2, AlertTriangle, WifiOff, PenLine } from "lucide-react";

// The worker form for a unified-engine document. Everything on screen comes
// from the document's published field list; the submit path is shared with
// the offline queue (engineSubmit.js), so a document filled with no signal
// sends itself later exactly as it would have now.

async function postJson(action, token, extra) {
  const res = await fetch("/api/companydata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, token, ...extra }) });
  return res.ok ? await res.json() : {};
}

export default function EngineDocumentForm({ companyId, companyName, userName = "", userId = null, definitionId, resubmitRecordId = null, onBack, token }) {
  const [doc, setDoc] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState("");
  const [companyLogo, setCompanyLogo] = useState("");
  const [answers, setAnswers] = useState({});
  const [notes, setNotes] = useState({});
  const [signature, setSignature] = useState(null);
  const [step, setStep] = useState("form"); // form | queued | done
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showProblems, setShowProblems] = useState(false);
  const [restored, setRestored] = useState(false);
  const [keptFileKeys, setKeptFileKeys] = useState([]);
  const [returnedNote, setReturnedNote] = useState(null); // { reason, hadFiles } when fixing a sent-back document

  const accent = C.orange;
  const s = buildFormStyles(C, FONT, RAD, SHAD, accent);
  // A sent-back document is fixed from the saved record, never from a draft.
  const scope = companyId && definitionId && !resubmitRecordId ? `${companyId}::engine_${definitionId}` : null;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (resubmitRecordId) {
          const rec = await loadRecordForWorker(token, companyId, resubmitRecordId, callDocuments);
          if (!live) return;
          if (!rec.sameVersion) throw new Error("This document was updated after you filed it. Ask your supervisor to cancel it and file it again.");
          setDoc(rec.doc);
          const prefill = rowsToForm(rec.answers);
          setAnswers({ ...initialAnswers(rec.doc.fields), ...prefill.answers });
          setNotes(prefill.notes);
          setSiteId(rec.record.site_id ? String(rec.record.site_id) : "");
          setKeptFileKeys(rec.answers.filter((r) => r.file_path).map((r) => r.field_key));
          setReturnedNote({ reason: rec.record.returned_reason || "", hadFiles: hasFiles(rec.answers) });
        } else {
          const got = await callDocuments(token, "get_document", { companyId, definitionId });
          if (!live) return;
          setDoc(got);
          const draft = scope ? loadDraft("engineform", scope) : null;
          setAnswers({ ...initialAnswers(got.fields), ...(draft?.answers || {}) });
          if (draft?.notes) setNotes(draft.notes);
          if (draft?.siteId) setSiteId(draft.siteId);
        }
      } catch (e) { if (live) setLoadError(e.message || "This document is not available."); }
      setRestored(true);
    })();
    (async () => {
      const d = await postJson("list_sites", token, { companyId });
      if (!live) return;
      setSites(d.sites || []);
      if (d.defaultSiteId) setSiteId((p) => p || String(d.defaultSiteId));
      const l = await postJson("get_company_logo", token, { companyId });
      if (live) setCompanyLogo(l.logo_url || "");
    })();
    return () => { live = false; };
  }, [companyId, definitionId, resubmitRecordId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useDraftAutosave("engineform", scope, { answers, notes, siteId }, restored && !!doc && step === "form");

  const fields = doc?.fields || [];
  const needsSignature = (doc?.signatureSteps || []).some((x) => x.signer === "worker");
  const problems = doc ? clientProblems(fields, answers, notes, keptFileKeys) : [];
  const set = (k, v) => setAnswers((p) => ({ ...p, [k]: v }));
  const setNote = (k, v) => setNotes((p) => ({ ...p, [k]: v }));
  const siteName = sites.find((x) => String(x.id) === String(siteId))?.name || "";

  const submit = async (signLater) => {
    setShowProblems(true);
    if (problems.length) return;
    if (resubmitRecordId) {
      setSaving(true); setSaveError("");
      const now = new Date();
      try {
        await resubmitEngineDocument({ title: doc.definition.title, layout: doc.layout, fields, answers, notes, siteName, companyName, companyLogo, submittedBy: userName, dateText: now.toLocaleDateString("en-CA"), dateTimeText: now.toLocaleString("en-CA"), status: "pending_approval" }, resubmitRecordId, token);
        setStep("done");
      } catch (e) { setSaveError(e.isNetworkFailure ? "No connection. Try again when you are back online." : e.message); }
      setSaving(false);
      return;
    }
    if (needsSignature && !signLater && !signature) { setSaveError("Sign the document, or choose Sign later."); return; }
    setSaving(true); setSaveError("");
    const now = new Date();
    const payload = {
      definitionId, title: doc.definition.title, layout: doc.layout, fields, answers, notes, siteId, siteName, companyName, companyLogo,
      submittedBy: userName, signature: signLater ? null : signature, signLater, dateText: now.toLocaleDateString("en-CA"), dateTimeText: now.toLocaleString("en-CA"),
    };
    const id = newClientSubmissionId();
    const queue = async () => { await enqueueSubmission("engineform", id, payload); clearDraft("engineform", scope); setStep("queued"); };
    try {
      if (!navigator.onLine) { await queue(); setSaving(false); return; }
      await submitEngineDocument(payload, id, token);
      clearDraft("engineform", scope); setStep("done");
    } catch (e) {
      if (e.isServerError) setSaveError(e.message); else await queue();
    }
    setSaving(false);
  };

  const pickFile = (key, isPhoto) => async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (f) set(key, isPhoto || /^image\//.test(f.type) ? await shrinkImage(f) : await readAsDataUrl(f));
  };

  const choice = (key, options, value, onPick, tone) => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map(([val, label]) => {
        const on = value === val;
        return <button key={val} type="button" aria-pressed={on} onClick={() => onPick(val)} style={{
          flex: 1, minWidth: 80, minHeight: 48, padding: "10px", borderRadius: RAD.md, fontSize: 15, fontWeight: 700, cursor: "pointer",
          border: `1.5px solid ${on ? (tone?.(val) || accent) : C.line}`, background: on ? `${tone?.(val) || accent}22` : C.panelInset, color: on ? C.text.primary : C.text.faint,
        }}>{label}</button>;
      })}
    </div>
  );

  const control = (f) => {
    const v = answers[f.field_key];
    const opts = f.config?.options || [];
    const k = f.field_key;
    switch (f.field_type) {
      case "yesno": return (<>{choice(k, [["yes", "Yes"], ["no", "No"]], v, (x) => set(k, x), (x) => (x === "yes" ? C.status.success.solid : C.status.danger.solid))}
        {v === "no" && <textarea aria-label={`${f.label} note`} style={{ ...s.input, minHeight: 64, marginTop: 10, marginBottom: 0 }} placeholder="What's the issue? (optional)" value={notes[k] || ""} onChange={(e) => setNote(k, e.target.value)} />}</>);
      case "condition3": return (<>{choice(k, [["Good", "Good"], ["Monitor", "Monitor"], ["Defective", "Defective"], ["N/A", "N/A"]], v, (x) => set(k, x), (x) => (x === "Good" ? C.status.success.solid : x === "Defective" ? C.status.danger.solid : C.status.warning.solid))}
        {(v === "Monitor" || v === "Defective") && <textarea aria-label={`${f.label} note`} style={{ ...s.input, minHeight: 64, marginTop: 10, marginBottom: 0 }} placeholder="Describe the problem" value={notes[k] || ""} onChange={(e) => setNote(k, e.target.value)} />}</>);
      case "short_text": return <input style={{ ...s.input, marginBottom: 0 }} type="text" value={v || ""} onChange={(e) => set(k, e.target.value)} />;
      case "long_text": return <textarea style={{ ...s.input, minHeight: 90, marginBottom: 0 }} value={v || ""} onChange={(e) => set(k, e.target.value)} />;
      case "number": return <input style={{ ...s.input, marginBottom: 0 }} type="number" inputMode="decimal" value={v ?? ""} onChange={(e) => set(k, e.target.value)} />;
      case "date": return <input style={{ ...s.input, marginBottom: 0 }} type="date" value={v || ""} onChange={(e) => set(k, e.target.value)} />;
      case "dropdown": return (<select style={{ ...s.input, marginBottom: 0 }} value={v || ""} onChange={(e) => set(k, e.target.value)}><option value="">Select...</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>);
      case "multiselect": case "ppe_list": {
        const list = f.field_type === "ppe_list" && opts.length === 0 ? ["Hard hat", "Safety vest", "Safety glasses", "Gloves", "Steel toe boots", "Hearing protection", "Fall arrest harness", "Respirator"] : opts;
        return (<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{list.map((o) => {
          const on = Array.isArray(v) && v.includes(o);
          return <button key={o} type="button" aria-pressed={on} onClick={() => set(k, on ? v.filter((x) => x !== o) : [...(v || []), o])} style={{ minHeight: 44, padding: "8px 14px", borderRadius: RAD.pill, fontSize: 14, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${on ? C.orange : C.line}`, background: on ? `${C.orange}22` : C.panelInset, color: on ? C.orange : C.text.faint }}>{on ? "✓ " : ""}{o}</button>;
        })}</div>);
      }
      case "signature": return <SignaturePad value={v} onChange={(d) => set(k, d || "")} height={100} />;
      case "photo": case "file_upload": return (
        <div>
          <input type="file" aria-label={f.label} accept={f.field_type === "photo" ? "image/*" : "image/*,application/pdf"} capture={f.field_type === "photo" ? "environment" : undefined} onChange={pickFile(k, f.field_type === "photo")} />
          {typeof v === "string" && v.startsWith("data:image") && <img src={v} alt="" style={{ display: "block", maxWidth: "100%", maxHeight: 160, marginTop: 8, borderRadius: RAD.sm }} />}
          {typeof v === "string" && v.startsWith("data:") && !v.startsWith("data:image") && <div style={{ fontSize: 13, color: C.text.muted, marginTop: 6 }}>File attached</div>}
        </div>);
      case "hazard_table": {
        const rows = Array.isArray(v) ? v : [];
        const upd = (i, p) => set(k, rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
        return (<div>{rows.map((r, i) => (
          <div key={i} style={{ border: `1px solid ${C.line}`, borderRadius: RAD.md, padding: 10, marginBottom: 8 }}>
            <input aria-label={`Hazard ${i + 1}`} style={s.input} placeholder="Hazard" value={r.hazard || ""} onChange={(e) => upd(i, { hazard: e.target.value })} />
            <textarea aria-label={`Control ${i + 1}`} style={{ ...s.input, minHeight: 56 }} placeholder="Control measure" value={r.control || ""} onChange={(e) => upd(i, { control: e.target.value })} />
            <div style={{ display: "flex", gap: 8 }}>
              <select aria-label={`Risk ${i + 1}`} style={{ ...s.input, marginBottom: 0 }} value={r.risk || "Low"} onChange={(e) => upd(i, { risk: e.target.value })}>{RISKS.map((x) => <option key={x}>{x}</option>)}</select>
              <button type="button" onClick={() => set(k, rows.filter((_, j) => j !== i))} style={{ ...s.ghost, width: "auto", marginTop: 0, padding: "0 16px" }}>Remove</button>
            </div>
          </div>))}
          <button type="button" style={{ ...s.ghost, marginTop: 0 }} onClick={() => set(k, [...rows, emptyHazard()])}>Add hazard</button></div>);
      }
      default: return <div style={{ fontSize: 13, color: C.text.muted }}>This question type is not available on this form yet.</div>;
    }
  };

  const shell = (children) => (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>{doc?.definition?.title || "Document"}</div>
        <button onClick={onBack} aria-label="Back" style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: RAD.md, padding: "8px 12px", fontWeight: 700, cursor: "pointer" }}><ArrowLeft size={16} /></button>
      </div>
      {children}
    </div>
  );

  if (loadError) return shell(<div style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} /> <span>{loadError}</span></div>);
  if (!doc) return shell(<div style={{ color: C.text.muted }}><Loader2 size={16} className="fora-spin" /> Loading...</div>);
  if (step === "queued") return shell(
    <div style={{ ...s.card, textAlign: "center" }}><WifiOff size={44} color={C.status.warning.text} />
      <div style={{ fontWeight: 800, fontSize: 20, margin: "10px 0 6px" }}>Saved, no signal</div>
      <div style={{ fontSize: 14, color: C.text.muted, marginBottom: 16 }}>This document is saved on your device and sends itself when you are back online.</div>
      <button style={s.btn(accent)} onClick={onBack}>Back to menu</button></div>);
  if (step === "done") return shell(
    <div style={{ ...s.card, textAlign: "center" }}><CheckCircle2 size={44} color={C.status.success.text} />
      <div style={{ fontWeight: 800, fontSize: 20, margin: "10px 0 6px" }}>Submitted</div>
      <div style={{ fontSize: 14, color: C.text.muted, marginBottom: 16 }}>{siteName} {new Date().toLocaleDateString("en-CA")}</div>
      <button style={s.btn(accent)} onClick={onBack}>Back to menu</button></div>);

  let section = null;
  return shell(
    <>
      {returnedNote && (
        <div role="note" style={bannerStyle(C, RAD, "warning")}><AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <span><strong>Sent back:</strong> {returnedNote.reason || "No reason given."}{returnedNote.hadFiles ? " Photos and files you already added stay unless you add new ones." : ""}</span></div>
      )}
      {!resubmitRecordId && <div style={s.card}>
        <label style={s.label} htmlFor="eng-site">Job site</label>
        <select id="eng-site" style={{ ...s.input, marginBottom: 0 }} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="">Select a site...</option>
          {sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {userName && <div style={{ fontSize: 13, color: C.text.muted, marginTop: 10 }}>Filling in as <strong>{userName}</strong></div>}
      </div>}

      {fields.filter((f) => !UNANSWERABLE_TYPES.includes(f.field_type)).map((f) => {
        const head = f.section && f.section !== section ? <div style={{ fontWeight: 800, fontSize: 13, color: accent, textTransform: "uppercase", margin: "6px 2px 8px" }}>{f.section}</div> : null;
        section = f.section || section;
        return (
          <div key={f.field_key}>
            {head}
            <div style={s.card}>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.text.primary, marginBottom: f.help_text ? 4 : 10 }}>{f.label}{f.required && <span style={{ color: C.status.danger.text }}> *</span>}</div>
              {f.help_text && <div style={{ fontSize: 12.5, color: C.text.muted, marginBottom: 10 }}>{f.help_text}</div>}
              {control(f)}
            </div>
          </div>
        );
      })}

      {needsSignature && !resubmitRecordId && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><PenLine size={18} color={accent} /> Your signature</div>
          <div style={{ fontSize: 11.5, color: C.text.faint, marginBottom: 8, lineHeight: 1.4 }}>By signing, you take full responsibility for the accuracy of this document.</div>
          <SignaturePad value={signature} onChange={setSignature} />
          <div style={{ fontSize: 13, color: C.text.body }}>Signed by: <strong>{userName}</strong></div>
        </div>
      )}

      {showProblems && problems.length > 0 && <div role="alert" style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} style={{ flexShrink: 0 }} /><span>{problems[0]}{problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}</span></div>}
      {saveError && <div role="alert" style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} style={{ flexShrink: 0 }} /><span>{saveError}</span></div>}
      <button style={s.btn(saving ? disabledBg(C) : C.status.success.solid)} disabled={saving} onClick={() => submit(false)}>
        {saving ? <><Loader2 size={16} className="fora-spin" /> Submitting...</> : <><CheckCircle2 size={16} /> {resubmitRecordId ? "Send back for review" : needsSignature ? "Sign and submit" : "Submit"}</>}
      </button>
      {needsSignature && userId && !resubmitRecordId && <button style={s.ghost} disabled={saving} onClick={() => submit(true)}>Submit now, sign later</button>}
      <style>{"@keyframes fora-spin { to { transform: rotate(360deg); } } .fora-spin { animation: fora-spin 0.8s linear infinite; }"}</style>
    </>
  );
}
