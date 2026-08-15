import { useState, useRef, useEffect } from "react";
import { generateAndUploadInspection } from "./generateInspectionPDF";
import { useCustomFields, CustomFieldInputs } from "./customFields.jsx";
import { getEquipmentTemplate, isTrailerTemplate, isTowCapableTemplate } from "./equipmentInspectionTemplates";
import { loadDraft, clearDraft, useDraftAutosave } from "./useDraftAutosave.js";
import { enqueueSubmission } from "./offlineQueue.js";

function newClientSubmissionId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Redoes an entire inspection submission (PDF generation + upload + the
// final POST) from plain input data, covering both pre-trip and post-trip —
// used both by a live online submit below and by offlineQueue's
// drainQueue() to resend a queued one later. Throws on any failure so the
// caller can tell success from failure. Exported so WorkerMenu.jsx can
// drain this form's queue without the Inspection component mounted.
export async function resubmitInspection(payload, clientSubmissionId, tokenForRequest) {
  const {
    tripType, label, workerName, companyName, companyLogo, sig, isTrailer, readingUnit, equipmentId,
    resultsJson, startReading,
    endReading, hasChanges, changeCondition, changeNotes,
    linkedPretripId, linkedPretripStartReading, linkedPretripReadingUnit,
  } = payload;

  const pdfUrl = await generateAndUploadInspection({
    equipmentLabel: label, workerName, companyName, companyLogo,
    results: tripType === "pretrip" ? resultsJson : undefined,
    signatureDataUrl: sig,
    tripType,
    startReading: isTrailer ? null : (tripType === "pretrip" ? startReading : linkedPretripStartReading),
    endReading: tripType === "posttrip" ? (isTrailer ? null : endReading) : undefined,
    readingUnit: isTrailer ? null : readingUnit,
    hasChanges: tripType === "posttrip" ? !!hasChanges : undefined,
    changeCondition: tripType === "posttrip" ? changeCondition : undefined,
    changeNotes: tripType === "posttrip" ? changeNotes : undefined,
    linkedPretrip: tripType === "posttrip" ? { id: linkedPretripId, start_reading: linkedPretripStartReading, reading_unit: linkedPretripReadingUnit } : undefined,
    token: tokenForRequest,
  });

  const record = tripType === "pretrip" ? {
    worker_name: workerName, equipment_label: label, equipment_id: equipmentId,
    results_json: resultsJson, signed_by: workerName, pdf_url: pdfUrl || null,
    trip_type: "pretrip", linked_inspection_id: null,
    start_reading: isTrailer ? null : startReading, end_reading: null,
    reading_unit: isTrailer ? null : readingUnit, has_changes: null,
  } : {
    worker_name: workerName, equipment_label: label, equipment_id: equipmentId,
    results_json: resultsJson, signed_by: workerName, pdf_url: pdfUrl || null,
    trip_type: "posttrip", linked_inspection_id: linkedPretripId,
    start_reading: isTrailer ? null : linkedPretripStartReading,
    end_reading: isTrailer ? null : endReading,
    reading_unit: isTrailer ? null : (linkedPretripReadingUnit || readingUnit),
    has_changes: !!hasChanges,
  };

  let res;
  try {
    res = await fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "inspection", action: "submit", token: tokenForRequest, clientSubmissionId, record }),
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

const CONDITIONS = [
  { key: "Good", color: "#16A34A", bg: "#F0FDF4", border: "#86EFAC" },
  { key: "Monitor", color: "#D97706", bg: "#FFFBEB", border: "#FCD34D" },
  { key: "Defective", color: "#DC2626", bg: "#FEF2F2", border: "#FCA5A5" },
  { key: "N/A", color: "#64748B", bg: "#F1F5F9", border: "#CBD5E1" },
];

export default function Inspection({ companyId, companyName, userName: loginUserName = "", onBack, onLogout, token = null }) {
  const [step, setStep] = useState("equipment"); // equipment | choice | worker | inspect | posttrip | queued | done
  const [equipment, setEquipment] = useState([]);
  const [eqMode, setEqMode] = useState("list"); // list | other
  const [selectedEq, setSelectedEq] = useState("");
  const [selectedEqId, setSelectedEqId] = useState("");
  const [freeEq, setFreeEq] = useState({ year: "", make: "", model: "", type: "", unit_number: "" });
  const [workerName, setWorkerName] = useState(loginUserName);
  const [checking, setChecking] = useState(false);
  const [genError, setGenError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [savingInspection, setSavingInspection] = useState(false);
  const [items, setItems] = useState([]);        // [{ item, condition, note }]
  const [inspectionMeta, setInspectionMeta] = useState({});
  const [companyLogo, setCompanyLogo] = useState("");
  const cf = useCustomFields(companyId, "inspection", token);
  const [signed, setSigned] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  // ── new: readings + trip linking ──────────────────────────
  const [mode, setMode] = useState("pretrip"); // pretrip | posttrip
  const [readingUnit, setReadingUnit] = useState("Hours"); // Hours | KM
  const [startReading, setStartReading] = useState("");
  const [endReading, setEndReading] = useState("");
  const [openPretrip, setOpenPretrip] = useState(null);
  const [lastInspection, setLastInspection] = useState(null);
  const [hasChanges, setHasChanges] = useState(null); // null until chosen
  const [changeCondition, setChangeCondition] = useState("Monitor");
  const [changeNotes, setChangeNotes] = useState("");

  // ── trailer attachment (tow-capable units only) ────────────
  const [attachedTrailerId, setAttachedTrailerId] = useState("");
  const [attachedTrailerText, setAttachedTrailerText] = useState("");

  // Load equipment registry + logo
  useEffect(() => {
    async function load() {
      // Equipment — via protected endpoint
      try {
        const eqRes = await fetch("/api/companydata", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_equipment", token, companyId }),
        });
        const eqData = await eqRes.json();
        if (eqRes.ok) {
          setEquipment(eqData.equipment || []);
          if (!eqData.equipment || eqData.equipment.length === 0) setEqMode("other");
        } else {
          setEqMode("other");
        }
      } catch (e) {
        setEqMode("other");
      }

      // Company logo — via protected endpoint
      try {
        const logoRes = await fetch("/api/companydata", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_company_logo", token, companyId }),
        });
        const logoData = await logoRes.json();
        if (logoRes.ok) setCompanyLogo(logoData.logo_url || "");
      } catch (e) { /* leave logo blank if the request fails */ }
    }
    load();
  }, [companyId, token]);

  // ── Offline resilience: local draft autosave (docs/scope-offline-capability.md Phase 0) ──
  // Equipment selection restores unconditionally, but the step only jumps
  // back into "worker" or "inspect" — "choice" and "posttrip" depend on
  // openPretrip/lastInspection, which are always re-fetched live rather
  // than cached (a stale cached "open pre-trip today" could be actively
  // wrong if it's since been closed out or superseded), so there's nothing
  // safe to restore into those two steps. A worker mid-post-trip who loses
  // connection just re-picks the equipment and re-checks it.
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    if (!companyId) return;
    const draft = loadDraft("inspection", companyId);
    if (draft) {
      if (draft.eqMode) setEqMode(draft.eqMode);
      if (draft.selectedEq) setSelectedEq(draft.selectedEq);
      if (draft.selectedEqId) setSelectedEqId(draft.selectedEqId);
      if (draft.freeEq) setFreeEq(draft.freeEq);
      if (draft.workerName) setWorkerName(draft.workerName);
      if (draft.attachedTrailerId) setAttachedTrailerId(draft.attachedTrailerId);
      if (draft.attachedTrailerText) setAttachedTrailerText(draft.attachedTrailerText);
      if (draft.step === "worker" || draft.step === "inspect") {
        if (draft.readingUnit) setReadingUnit(draft.readingUnit);
        if (draft.startReading) setStartReading(draft.startReading);
        if (draft.items && draft.items.length > 0) setItems(draft.items);
        if (draft.inspectionMeta) setInspectionMeta(draft.inspectionMeta);
        setStep(draft.step);
      }
    }
    setDraftRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useDraftAutosave(
    "inspection",
    companyId,
    { step, eqMode, selectedEq, selectedEqId, freeEq, workerName, attachedTrailerId, attachedTrailerText, readingUnit, startReading, items, inspectionMeta },
    draftRestored && !!companyId
  );

  const labelFor = (eq) => [eq.year, eq.make, eq.model, eq.type].filter(Boolean).join(" ") + (eq.unit_number ? ` (Unit ${eq.unit_number})` : "");

  // Concise text for the equipment picker's dropdown options — a worker who
  // knows their unit number shouldn't have to scan full year/make/model
  // text to find it. Falls back to the full descriptive label when there's
  // no unit number to key off of.
  const menuLabelFor = (eq) => {
    if (eq.unit_number) return `UNIT ${eq.unit_number}${eq.type ? `, ${eq.type}` : ""}`;
    return labelFor(eq);
  };

  const equipmentLabel = () => {
    if (eqMode === "list" && selectedEq) return selectedEq;
    const { year, make, model, type, unit_number } = freeEq;
    return [year, make, model, type].filter(Boolean).join(" ") + (unit_number ? ` (Unit ${unit_number})` : "");
  };

  // { type, make, model } for whichever equipment is currently selected —
  // feeds the keyword match that picks an inspection template.
  const currentEquipmentFields = () => {
    if (eqMode === "list") {
      const eq = equipment.find(e => String(e.id) === String(selectedEqId));
      return { type: eq?.type || "", make: eq?.make || "", model: eq?.model || "" };
    }
    return { type: freeEq.type, make: freeEq.make, model: freeEq.model };
  };

  const { type: currentType, make: currentMake, model: currentModel } = currentEquipmentFields();
  const isTrailer = isTrailerTemplate(currentType, currentMake, currentModel);
  const isTowCapable = isTowCapableTemplate(currentType, currentMake, currentModel);
  const trailerFleet = equipment.filter(eq => isTrailerTemplate(eq.type, eq.make, eq.model));

  // { id, label } for whatever trailer (if any) was selected to go with
  // this trip, or null if none — fleet selection wins over free text.
  const selectedAttachedTrailer = () => {
    if (attachedTrailerId) {
      const eq = trailerFleet.find(e => String(e.id) === String(attachedTrailerId));
      return eq ? { id: eq.id, label: menuLabelFor(eq) } : null;
    }
    if (attachedTrailerText.trim()) return { id: null, label: attachedTrailerText.trim() };
    return null;
  };

  const lastHadIssues = (insp) => {
    if (!insp) return false;
    const r = insp.results_json || {};
    return (r.defectiveCount || 0) > 0 || (r.monitorCount || 0) > 0;
  };

  // ── signature pad ────────────────────────────────────────
  const getPos = (e) => {
    const c = canvasRef.current, r = c.getBoundingClientRect(), t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) };
  };
  const startDraw = (e) => { e.preventDefault(); drawingRef.current = true; const ctx = canvasRef.current.getContext("2d"); const { x, y } = getPos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const draw = (e) => { if (!drawingRef.current) return; e.preventDefault(); const ctx = canvasRef.current.getContext("2d"); const { x, y } = getPos(e); ctx.lineTo(x, y); ctx.strokeStyle = "#1E293B"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.stroke(); setHasSignature(true); };
  const endDraw = () => { drawingRef.current = false; };
  const clearSig = () => { const c = canvasRef.current; if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height); setHasSignature(false); };

  // Called when the worker taps Continue on the equipment step.
  const checkEquipmentAndProceed = async () => {
    setChecking(true); setGenError(false);
    try {
      const res = await fetch("/api/logs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "inspection", action: "check_equipment", token, equipmentLabel: equipmentLabel() }),
      });
      const data = await res.json();
      const openPT = res.ok ? data.openPretrip : null;
      const lastInsp = res.ok ? data.lastInspection : null;
      setOpenPretrip(openPT);
      setLastInspection(lastInsp);

      if (openPT) {
        setStep("choice");
      } else {
        setMode("pretrip");
        setStep("worker");
      }
    } catch (e) {
      // If the check fails, don't block the worker — just proceed as a normal pre-trip.
      setMode("pretrip");
      setStep("worker");
    }
    setChecking(false);
  };

  const choosePostTrip = () => {
    setMode("posttrip");
    setReadingUnit(openPretrip.reading_unit || "Hours");
    setStep("posttrip");
  };
  const chooseNewPretrip = () => {
    setMode("pretrip");
    setStep("worker");
  };

  // Picks a fixed, real inspection checklist by matching the equipment's
  // type/make/model against known keywords (see equipmentInspectionTemplates.js)
  // instead of asking an LLM to improvise one — a truck and a grader should
  // never get the same checklist, and shouldn't vary run to run either.
  const generateInspection = () => {
    const { type, make, model } = currentEquipmentFields();
    const template = getEquipmentTemplate(type, make, model);
    const truckLabel = equipmentLabel();
    const truckItems = template.items.map(it => ({ item: it.item, category: it.category || "", unit: "truck", unitLabel: truckLabel, condition: "Good", note: "" }));

    // A trailer attached to a tow-capable unit gets its OWN checklist
    // appended, tagged by unit — the trailer is a completely different
    // machine with different failure points, and a defect on it must never
    // read as a defect on the tow vehicle (or vice versa) on this record,
    // in the PDF, or in the weekly report's issue list.
    const trailer = isTowCapable ? selectedAttachedTrailer() : null;
    let trailerTemplateLabel = null;
    let allItems = truckItems;
    if (trailer) {
      const trailerEq = attachedTrailerId ? trailerFleet.find(e => String(e.id) === String(attachedTrailerId)) : null;
      const trailerTemplate = trailerEq
        ? getEquipmentTemplate(trailerEq.type, trailerEq.make, trailerEq.model)
        : getEquipmentTemplate(trailer.label, "", "");
      trailerTemplateLabel = trailerTemplate.label;
      const trailerItems = trailerTemplate.items.map(it => ({ item: it.item, category: it.category || "", unit: "trailer", unitLabel: trailer.label, condition: "Good", note: "" }));
      allItems = [...truckItems, ...trailerItems];
    }

    setInspectionMeta({
      machineSummary: trailer ? `${template.label} + ${trailerTemplateLabel} (trailer attached)` : `${template.label} — pre-trip inspection`,
    });
    setItems(allItems);
    setStep("inspect");
  };

  const setCondition = (i, cond) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, condition: cond } : it));
  const setNote = (i, note) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, note } : it));

  const defectiveCount = items.filter(i => i.condition === "Defective").length;
  const monitorCount = items.filter(i => i.condition === "Monitor").length;

  // ── Submit: Pre-Trip (full checklist) ───────────────────────
  const submitPretrip = async () => {
    setSigned(true);
    setSaveError(false);
    setSavingInspection(true);
    const sig = hasSignature ? canvasRef.current.toDataURL("image/png") : null;
    const label = equipmentLabel();
    const resultsJson = {
      machineSummary: inspectionMeta.machineSummary, items, defectiveCount, monitorCount, customFields: cf.entries(),
      attachedTrailer: isTowCapable ? selectedAttachedTrailer() : null,
    };

    // Auto-save a free-typed rental to the fleet, via the protected
    // endpoint — only when a unit number was given. Matching by
    // year/make/model/type TEXT used to silently create a duplicate "unit"
    // every time it was typed even slightly differently (extra word,
    // different capitalization/order, abbreviation) — exactly the problem a
    // unit number exists to solve, so use that as the dedup key instead,
    // and skip auto-adding entirely when there's no reliable identifier to
    // key off of (a genuine one-off rental with no company asset tag).
    const typedUnit = freeEq.unit_number.trim();
    if (typedUnit) {
      const alreadyInFleet = equipment.some(eq => (eq.unit_number || "").trim().toLowerCase() === typedUnit.toLowerCase());
      if (!alreadyInFleet) {
        try {
          await fetch("/api/companydata", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "add_equipment", token, companyId,
              year: freeEq.year, make: freeEq.make, model: freeEq.model, type: freeEq.type, unitNumber: typedUnit,
            }),
          });
        } catch (e) {
          console.error("rental auto-save failed:", e.message);
        }
      }
    }

    const clientSubmissionId = newClientSubmissionId();
    const payload = {
      tripType: "pretrip", label, workerName, companyName, companyLogo, sig, isTrailer, readingUnit,
      equipmentId: eqMode === "list" ? (selectedEqId || null) : null,
      resultsJson, startReading,
    };

    // docs/scope-offline-capability.md Phase 1: a network-level failure gets
    // queued and retried automatically once back online instead of leaving
    // the submit button stuck; a real server-side rejection shows an error
    // and lets the worker retry manually.
    if (!navigator.onLine) {
      await enqueueSubmission("inspection", clientSubmissionId, payload);
      setSavingInspection(false);
      clearDraft("inspection", companyId);
      setStep("queued");
      return;
    }

    try {
      await resubmitInspection(payload, clientSubmissionId, token);
    } catch (e) {
      if (e.isServerError) {
        console.error("Inspection save failed:", e.message);
        setSaveError(true);
        setSavingInspection(false);
        setSigned(false);
        return;
      }
      await enqueueSubmission("inspection", clientSubmissionId, payload);
      setSavingInspection(false);
      clearDraft("inspection", companyId);
      setStep("queued");
      return;
    }
    setSavingInspection(false);
    clearDraft("inspection", companyId);
    setTimeout(() => setStep("done"), 500);
  };

  // ── Submit: Post-Trip (short flow) ──────────────────────────
  const submitPosttrip = async () => {
    setSigned(true);
    setSaveError(false);
    setSavingInspection(true);
    const sig = hasSignature ? canvasRef.current.toDataURL("image/png") : null;
    const label = equipmentLabel();
    const resultsJson = {
      hasChanges: !!hasChanges,
      changeCondition: hasChanges ? changeCondition : null,
      changeNotes: hasChanges ? changeNotes.trim() : null,
      defectiveCount: hasChanges && changeCondition === "Defective" ? 1 : 0,
      monitorCount: hasChanges && changeCondition === "Monitor" ? 1 : 0,
    };

    const clientSubmissionId = newClientSubmissionId();
    const payload = {
      tripType: "posttrip", label, workerName, companyName, companyLogo, sig, isTrailer, readingUnit,
      equipmentId: eqMode === "list" ? (selectedEqId || null) : null,
      resultsJson, endReading, hasChanges: !!hasChanges, changeCondition, changeNotes,
      linkedPretripId: openPretrip.id, linkedPretripStartReading: openPretrip.start_reading, linkedPretripReadingUnit: openPretrip.reading_unit,
    };

    // docs/scope-offline-capability.md Phase 1: a network-level failure gets
    // queued and retried automatically once back online instead of leaving
    // the submit button stuck; a real server-side rejection shows an error
    // and lets the worker retry manually.
    if (!navigator.onLine) {
      await enqueueSubmission("inspection", clientSubmissionId, payload);
      setSavingInspection(false);
      clearDraft("inspection", companyId);
      setStep("queued");
      return;
    }

    try {
      await resubmitInspection(payload, clientSubmissionId, token);
    } catch (e) {
      if (e.isServerError) {
        console.error("Post-trip save failed:", e.message);
        setSaveError(true);
        setSavingInspection(false);
        setSigned(false);
        return;
      }
      await enqueueSubmission("inspection", clientSubmissionId, payload);
      setSavingInspection(false);
      clearDraft("inspection", companyId);
      setStep("queued");
      return;
    }
    setSavingInspection(false);
    clearDraft("inspection", companyId);
    setTimeout(() => setStep("done"), 500);
  };

  // ── styles ───────────────────────────────────────────────
  const s = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#F0F4F8", minHeight: "100vh", padding: 16, colorScheme: "light" },
    header: { background: "linear-gradient(135deg,#0C4A6E,#0369A1)", borderRadius: 14, padding: "18px 20px", marginBottom: 16, color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" },
    card: { background: "#fff", borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: "0 1px 3px #0f172a12" },
    label: { display: "block", fontWeight: 700, fontSize: 12, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 },
    input: { width: "100%", padding: "11px 13px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 11, background: "#F8FAFC", color: "#1E293B", colorScheme: "light" },
    btn: (bg, fg = "#fff") => ({ background: bg, color: fg, border: "none", borderRadius: 10, padding: "13px", fontWeight: 800, fontSize: 15, cursor: "pointer", width: "100%" }),
    ghost: { background: "#F1F5F9", color: "#334155", border: "none", borderRadius: 10, padding: "11px", fontWeight: 600, fontSize: 14, cursor: "pointer", width: "100%", marginTop: 10 },
  };

  const IssuesBanner = () => {
    if (!lastHadIssues(lastInspection)) return null;
    const r = lastInspection.results_json || {};
    const flaggedItems = (r.items || []).filter(it => it.condition === "Defective" || it.condition === "Monitor");
    return (
      <div style={{ ...s.card, background: "#FEF2F2", border: "1.5px solid #FCA5A5" }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: "#991B1B", marginBottom: 4 }}>⚠️ Previous inspection flagged issues</div>
        <div style={{ fontSize: 13, color: "#7F1D1D", marginBottom: 8 }}>
          {lastInspection.worker_name || "Unknown"} · {new Date(lastInspection.created_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
        </div>
        {flaggedItems.length > 0 ? flaggedItems.map((it, i) => (
          <div key={i} style={{ fontSize: 13, color: "#991B1B", marginBottom: 4 }}>
            • <strong>{it.item}</strong> — {it.condition}{it.note ? `: ${it.note}` : ""}
          </div>
        )) : (
          r.changeNotes && <div style={{ fontSize: 13, color: "#991B1B" }}>• {r.changeCondition}: {r.changeNotes}</div>
        )}
      </div>
    );
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {companyLogo ? <img src={companyLogo} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: "cover", background: "#fff" }} /> : <span style={{ fontSize: 26 }}>🚜</span>}
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>Equipment Inspection</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Pre-trip & post-trip checks</div>
          </div>
        </div>
        <button onClick={onBack} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>← Menu</button>
      </div>

      {/* STEP: pick equipment */}
      {step === "equipment" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: "#1E293B" }}>Select equipment</div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 16 }}>Choose from your fleet, or enter a rental / one-off machine.</div>

          {equipment.length > 0 && eqMode === "list" ? (
            <>
              <label style={s.label}>Machine</label>
              <select style={s.input} value={selectedEqId} onChange={e => {
                if (e.target.value === "__other__") { setEqMode("other"); setSelectedEq(""); setSelectedEqId(""); }
                else {
                  const eq = equipment.find(e2 => String(e2.id) === e.target.value);
                  setSelectedEqId(e.target.value);
                  setSelectedEq(eq ? labelFor(eq) : "");
                }
              }}>
                <option value="">Select a machine…</option>
                {equipment.map(eq => (
                  <option key={eq.id} value={eq.id}>{menuLabelFor(eq)}</option>
                ))}
                <option value="__other__">＋ Other / rental (enter details)</option>
              </select>
            </>
          ) : (
            <>
              <label style={s.label}>Year</label>
              <input style={s.input} placeholder="e.g. 2019" value={freeEq.year} onChange={e => setFreeEq(p => ({ ...p, year: e.target.value }))} />
              <label style={s.label}>Make</label>
              <input style={s.input} placeholder="e.g. Caterpillar" value={freeEq.make} onChange={e => setFreeEq(p => ({ ...p, make: e.target.value }))} />
              <label style={s.label}>Model</label>
              <input style={s.input} placeholder="e.g. 320" value={freeEq.model} onChange={e => setFreeEq(p => ({ ...p, model: e.target.value }))} />
              <label style={s.label}>Type</label>
              <input style={s.input} placeholder="e.g. Excavator" value={freeEq.type} onChange={e => setFreeEq(p => ({ ...p, type: e.target.value }))} />
              <label style={s.label}>Unit / asset number (optional)</label>
              <div style={{ fontSize: 11, color: "#94A3B8", marginTop: -6, marginBottom: 6, lineHeight: 1.4 }}>If your company tags this machine with a unit number, enter it here — it's what lets this get added to the fleet correctly instead of as a duplicate.</div>
              <input style={s.input} placeholder="e.g. 56" value={freeEq.unit_number} onChange={e => setFreeEq(p => ({ ...p, unit_number: e.target.value }))} />
              {equipment.length > 0 && (
                <button onClick={() => { setEqMode("list"); setFreeEq({ year: "", make: "", model: "", type: "", unit_number: "" }); }} style={{ background: "transparent", border: "none", color: "#0369A1", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 8 }}>← Choose from fleet</button>
              )}
            </>
          )}

          {genError && <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: "#991B1B" }}>Couldn't check this equipment. Check your connection and try again.</div>}

          <button style={s.btn(checking ? "#94A3B8" : equipmentLabel() ? "#0369A1" : "#94A3B8")} disabled={checking || !equipmentLabel()} onClick={checkEquipmentAndProceed}>
            {checking ? "⏳ Checking…" : "Continue →"}
          </button>
        </div>
      )}

      {/* STEP: choice — open pre-trip found for this machine today */}
      {step === "choice" && (
        <>
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: "#1E293B" }}>{equipmentLabel()}</div>
            <div style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 10, padding: "12px 14px", marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0369A1", marginBottom: 2 }}>Pre-Trip already done today</div>
              <div style={{ fontSize: 13, color: "#374151" }}>
                {openPretrip.worker_name} · {new Date(openPretrip.created_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
              </div>
              {openPretrip.start_reading && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>Starting reading: {openPretrip.start_reading} {openPretrip.reading_unit}</div>}
            </div>
          </div>

          <IssuesBanner />

          <div style={s.card}>
            <button style={s.btn("#0369A1")} onClick={choosePostTrip}>Do Post-Trip Inspection</button>
            <button style={s.ghost} onClick={chooseNewPretrip}>Start a new Pre-Trip instead</button>
          </div>
        </>
      )}

      {/* STEP: worker name (pre-trip) */}
      {step === "worker" && (
        <>
          <IssuesBanner />
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: "#1E293B" }}>Inspector</div>
            <div style={{ fontSize: 13, color: "#64748B", marginBottom: 16 }}>Inspecting: <strong>{equipmentLabel()}</strong></div>
            <label style={s.label}>Your name</label>
            <input
              style={{ ...s.input, ...(loginUserName ? { background: "#F3F4F6", color: "#6B7280" } : {}) }}
              placeholder="e.g. John Smith" value={workerName}
              onChange={e => setWorkerName(e.target.value)}
              readOnly={!!loginUserName}
            />

            {!isTrailer && (
              <>
                <label style={s.label}>Reading type</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 11 }}>
                  {["Hours", "KM"].map(u => (
                    <button key={u} onClick={() => setReadingUnit(u)} style={{ flex: 1, padding: "10px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${readingUnit === u ? "#0369A1" : "#E2E8F0"}`, background: readingUnit === u ? "#F0F9FF" : "#fff", color: readingUnit === u ? "#0369A1" : "#94A3B8" }}>{u}</button>
                  ))}
                </div>

                <label style={s.label}>Starting reading</label>
                <input style={s.input} type="number" inputMode="decimal" placeholder={`e.g. 1245.3`} value={startReading} onChange={e => setStartReading(e.target.value)} />
              </>
            )}

            {isTowCapable && (
              <>
                <label style={s.label}>Attach a trailer? (optional)</label>
                {trailerFleet.length > 0 && (
                  <select style={s.input} value={attachedTrailerId} onChange={e => { setAttachedTrailerId(e.target.value); setAttachedTrailerText(""); }}>
                    <option value="">No trailer attached</option>
                    {trailerFleet.map(eq => (
                      <option key={eq.id} value={eq.id}>{menuLabelFor(eq)}</option>
                    ))}
                  </select>
                )}
                {!attachedTrailerId && (
                  <input
                    style={{ ...s.input, marginTop: trailerFleet.length > 0 ? -3 : 0 }}
                    placeholder={trailerFleet.length > 0 ? "Or type a trailer not in your fleet" : "e.g. 5x10 Dump Trailer (Unit 7)"}
                    value={attachedTrailerText}
                    onChange={e => setAttachedTrailerText(e.target.value)}
                  />
                )}
              </>
            )}

            <CustomFieldInputs cf={cf} labelStyle={s.label} inputStyle={s.input} />
            <button style={s.btn((workerName && (isTrailer || startReading)) ? "#0369A1" : "#94A3B8")} disabled={!workerName || (!isTrailer && !startReading)} onClick={() => {
              const missing = cf.missingRequired();
              if (missing.length > 0) { alert(`Please fill in: ${missing.join(", ")}`); return; }
              generateInspection();
            }}>
              Start Inspection
            </button>
            <button style={s.ghost} onClick={() => setStep("equipment")}>← Back</button>
          </div>
        </>
      )}

      {/* STEP: inspect (pre-trip checklist) */}
      {step === "inspect" && (
        <>
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#1E293B" }}>{equipmentLabel()}</div>
            {inspectionMeta.machineSummary && <div style={{ fontSize: 13, color: "#64748B", marginTop: 2 }}>{inspectionMeta.machineSummary}</div>}
            {!isTrailer && <div style={{ fontSize: 12, color: "#64748B", marginTop: 6 }}>Starting reading: {startReading} {readingUnit}</div>}
            {isTowCapable && selectedAttachedTrailer() && <div style={{ fontSize: 12, color: "#64748B", marginTop: 6 }}>Trailer attached: {selectedAttachedTrailer().label}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              {defectiveCount > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "#DC2626", background: "#FEF2F2", padding: "4px 10px", borderRadius: 20 }}>{defectiveCount} defective</span>}
              {monitorCount > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "#D97706", background: "#FFFBEB", padding: "4px 10px", borderRadius: 20 }}>{monitorCount} monitor</span>}
            </div>
          </div>

          {items.map((it, i) => {
            const cond = CONDITIONS.find(c => c.key === it.condition);
            const isNewUnit = it.unit && it.unit !== items[i - 1]?.unit;
            return (
              <div key={i}>
                {isNewUnit && (
                  <div style={{
                    background: it.unit === "trailer" ? "#EDE9FE" : "#DBEAFE", borderRadius: 9,
                    padding: "8px 12px", marginBottom: 8, fontWeight: 800, fontSize: 13,
                    color: it.unit === "trailer" ? "#5B21B6" : "#1E40AF",
                  }}>
                    {it.unit === "trailer" ? "TRAILER" : "TRUCK / TOW VEHICLE"}{it.unitLabel ? ` — ${it.unitLabel}` : ""}
                  </div>
                )}
              <div style={{ ...s.card, padding: 12, borderLeft: `4px solid ${cond.color}`, marginBottom: 8 }}>
                {it.category && <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>{it.category}</div>}
                <div style={{ fontWeight: 700, fontSize: 15, color: "#1E293B", marginBottom: 8 }}>{it.item}</div>
                <div style={{ display: "flex", gap: 5, marginBottom: it.condition === "Defective" || it.condition === "Monitor" ? 8 : 0 }}>
                  {CONDITIONS.map(c => (
                    <button key={c.key} onClick={() => setCondition(i, c.key)} style={{
                      flex: 1, padding: "6px 4px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer",
                      border: `1.5px solid ${it.condition === c.key ? c.color : "#E2E8F0"}`,
                      background: it.condition === c.key ? c.bg : "#fff",
                      color: it.condition === c.key ? c.color : "#94A3B8",
                    }}>{c.key}</button>
                  ))}
                </div>
                {(it.condition === "Defective" || it.condition === "Monitor") && (
                  <input style={{ ...s.input, padding: "8px 10px", marginBottom: 0 }} placeholder="Add a note (what's wrong?)" value={it.note} onChange={e => setNote(i, e.target.value)} />
                )}
              </div>
              </div>
            );
          })}

          {/* signature */}
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10, color: "#1E293B" }}>Inspector signature</div>
            <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 6, lineHeight: 1.4 }}>By signing, you take full responsibility for the accuracy of this document — FORA is not liable for any errors or omissions.</div>
            <div style={{ position: "relative", marginBottom: 6 }}>
              <canvas ref={canvasRef} width={600} height={180}
                style={{ width: "100%", height: 150, border: "1.5px solid #E2E8F0", borderRadius: 10, background: "#fff", touchAction: "none", display: "block" }}
                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
              {!hasSignature && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 14, pointerEvents: "none" }}>Sign here</div>}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: "#475569" }}>Signed by: <strong>{workerName}</strong></div>
              <button onClick={clearSig} style={{ background: "transparent", border: "none", color: "#64748B", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}>Clear</button>
            </div>
            {saveError && (
              <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: "#991B1B" }}>
                Couldn't save this inspection. Check your connection and try again.
              </div>
            )}
            <button style={s.btn(signed && !saveError ? "#16A34A" : hasSignature ? "#0369A1" : "#94A3B8")} disabled={!hasSignature || (signed && !saveError)} onClick={submitPretrip}>
              {savingInspection ? "Saving…" : signed && !saveError ? "✓ Submitted" : "Sign & Submit Pre-Trip Inspection"}
            </button>
          </div>
        </>
      )}

      {/* STEP: post-trip (short flow) */}
      {step === "posttrip" && (
        <>
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#1E293B" }}>{equipmentLabel()}</div>
            <div style={{ fontSize: 13, color: "#64748B", marginTop: 4 }}>
              Linked to Pre-Trip by {openPretrip.worker_name} · {new Date(openPretrip.created_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
            </div>
            {!isTrailer && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>Starting reading: {openPretrip.start_reading} {openPretrip.reading_unit}</div>}
          </div>

          <div style={s.card}>
            <label style={s.label}>Any changes since the Pre-Trip?</label>
            <div style={{ display: "flex", gap: 8, marginBottom: hasChanges ? 14 : 0 }}>
              <button onClick={() => setHasChanges(false)} style={{ flex: 1, padding: "12px", borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${hasChanges === false ? "#16A34A" : "#E2E8F0"}`, background: hasChanges === false ? "#F0FDF4" : "#fff", color: hasChanges === false ? "#16A34A" : "#94A3B8" }}>No changes</button>
              <button onClick={() => setHasChanges(true)} style={{ flex: 1, padding: "12px", borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${hasChanges === true ? "#D97706" : "#E2E8F0"}`, background: hasChanges === true ? "#FFFBEB" : "#fff", color: hasChanges === true ? "#D97706" : "#94A3B8" }}>Yes, something changed</button>
            </div>

            {hasChanges === true && (
              <>
                <label style={s.label}>How serious?</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 11 }}>
                  {["Monitor", "Defective"].map(c => (
                    <button key={c} onClick={() => setChangeCondition(c)} style={{ flex: 1, padding: "10px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${changeCondition === c ? (c === "Defective" ? "#DC2626" : "#D97706") : "#E2E8F0"}`, background: changeCondition === c ? (c === "Defective" ? "#FEF2F2" : "#FFFBEB") : "#fff", color: changeCondition === c ? (c === "Defective" ? "#DC2626" : "#D97706") : "#94A3B8" }}>{c}</button>
                  ))}
                </div>
                <label style={s.label}>What changed?</label>
                <textarea style={{ ...s.input, minHeight: 80, resize: "vertical", fontFamily: "inherit" }} placeholder="Describe what changed during the shift" value={changeNotes} onChange={e => setChangeNotes(e.target.value)} />
              </>
            )}
          </div>

          <div style={s.card}>
            <label style={s.label}>Your name</label>
            <input
              style={{ ...s.input, ...(loginUserName ? { background: "#F3F4F6", color: "#6B7280" } : {}) }}
              placeholder="e.g. John Smith" value={workerName}
              onChange={e => setWorkerName(e.target.value)}
              readOnly={!!loginUserName}
            />
            {!isTrailer && (
              <>
                <label style={s.label}>Ending reading ({openPretrip.reading_unit || readingUnit})</label>
                <input style={{ ...s.input, marginBottom: 0 }} type="number" inputMode="decimal" placeholder="e.g. 1251.8" value={endReading} onChange={e => setEndReading(e.target.value)} />
              </>
            )}
          </div>

          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10, color: "#1E293B" }}>Signature</div>
            <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 6, lineHeight: 1.4 }}>By signing, you take full responsibility for the accuracy of this document — FORA is not liable for any errors or omissions.</div>
            <div style={{ position: "relative", marginBottom: 6 }}>
              <canvas ref={canvasRef} width={600} height={180}
                style={{ width: "100%", height: 150, border: "1.5px solid #E2E8F0", borderRadius: 10, background: "#fff", touchAction: "none", display: "block" }}
                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
              {!hasSignature && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 14, pointerEvents: "none" }}>Sign here</div>}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: "#475569" }}>Signed by: <strong>{workerName}</strong></div>
              <button onClick={clearSig} style={{ background: "transparent", border: "none", color: "#64748B", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}>Clear</button>
            </div>
            {saveError && (
              <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: "#991B1B" }}>
                Couldn't save this inspection. Check your connection and try again.
              </div>
            )}
            {(() => {
              const ready = hasSignature && workerName && (isTrailer || endReading) && hasChanges !== null && (!hasChanges || changeNotes.trim());
              return (
                <button style={s.btn(signed && !saveError ? "#16A34A" : ready ? "#0369A1" : "#94A3B8")} disabled={!ready || (signed && !saveError)} onClick={submitPosttrip}>
                  {savingInspection ? "Saving…" : signed && !saveError ? "✓ Submitted" : "Sign & Submit Post-Trip"}
                </button>
              );
            })()}
          </div>
        </>
      )}

      {/* QUEUED — offline at submit time; queued locally and will send automatically once back online (docs/scope-offline-capability.md Phase 1) */}
      {step === "queued" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 60, marginBottom: 12 }}>📶</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: "#1E293B", marginBottom: 6 }}>Saved — No Signal</div>
            <div style={{ fontSize: 14, color: "#64748B", marginBottom: 8 }}>{equipmentLabel()}</div>
            <div style={{ fontSize: 13, color: "#64748B", marginBottom: 20 }}>This inspection is saved on your device and will send automatically the next time you're back online — no need to redo it.</div>
            <button style={s.btn("#0369A1")} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}

      {/* STEP: done */}
      {step === "done" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 60, marginBottom: 12 }}>{(mode === "pretrip" ? defectiveCount > 0 : hasChanges && changeCondition === "Defective") ? "⚠️" : "✅"}</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: "#1E293B", marginBottom: 6 }}>
              {mode === "posttrip" ? "Post-Trip Complete" : "Pre-Trip Complete"}
            </div>
            <div style={{ fontSize: 14, color: "#64748B", marginBottom: 20 }}>{equipmentLabel()} · {new Date().toLocaleString("en-CA")}</div>
            {mode === "pretrip" && defectiveCount > 0 && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: 14, marginBottom: 18, textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#991B1B" }}>{defectiveCount} defective item{defectiveCount > 1 ? "s" : ""} flagged</div>
                <div style={{ fontSize: 13, color: "#B91C1C", marginTop: 2 }}>This machine may not be safe to operate. Report to your supervisor.</div>
              </div>
            )}
            {mode === "posttrip" && hasChanges && (
              <div style={{ background: changeCondition === "Defective" ? "#FEF2F2" : "#FFFBEB", border: `1px solid ${changeCondition === "Defective" ? "#FCA5A5" : "#FCD34D"}`, borderRadius: 10, padding: 14, marginBottom: 18, textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: changeCondition === "Defective" ? "#991B1B" : "#92400E" }}>Change reported: {changeCondition}</div>
                <div style={{ fontSize: 13, color: changeCondition === "Defective" ? "#B91C1C" : "#B45309", marginTop: 2 }}>Reported to your supervisor for review.</div>
              </div>
            )}
            <button style={s.btn("#0369A1")} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}
    </div>
  );
}
