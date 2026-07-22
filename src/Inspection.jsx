import { useState, useRef, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { generateAndUploadInspection } from "./generateInspectionPDF";
import { useCustomFields, CustomFieldInputs } from "./customFields.jsx";

const CONDITIONS = [
  { key: "Good", color: "#16A34A", bg: "#F0FDF4", border: "#86EFAC" },
  { key: "Monitor", color: "#D97706", bg: "#FFFBEB", border: "#FCD34D" },
  { key: "Defective", color: "#DC2626", bg: "#FEF2F2", border: "#FCA5A5" },
];

export default function Inspection({ companyId, companyName, onBack, onLogout, token = null }) {
  const [step, setStep] = useState("equipment"); // equipment | choice | worker | inspect | posttrip | done
  const [equipment, setEquipment] = useState([]);
  const [eqMode, setEqMode] = useState("list"); // list | other
  const [selectedEq, setSelectedEq] = useState("");
  const [freeEq, setFreeEq] = useState({ year: "", make: "", model: "", type: "" });
  const [workerName, setWorkerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [genError, setGenError] = useState(false);
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

  // Load equipment registry + logo
  useEffect(() => {
    async function load() {
      const { data: eq } = await supabase.from("equipment")
        .select("id, year, make, model, type, unit_number")
        .eq("company_id", companyId).order("make");
      setEquipment(eq || []);
      if (!eq || eq.length === 0) setEqMode("other");
      const { data: co } = await supabase.from("companies").select("logo_url").eq("id", companyId).limit(1);
      if (co && co[0]) setCompanyLogo(co[0].logo_url || "");
    }
    load();
  }, [companyId]);

  const equipmentLabel = () => {
    if (eqMode === "list" && selectedEq) return selectedEq;
    const { year, make, model, type } = freeEq;
    return [year, make, model, type].filter(Boolean).join(" ");
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

  const generateInspection = async () => {
    setLoading(true); setGenError(false);
    const label = equipmentLabel();
    const prompt = `You are a heavy equipment safety inspector. Generate a pre-use inspection checklist specific to this machine.

Machine: ${label}
Company: ${companyName}

INSTRUCTIONS:
- Generate inspection items specific to THIS type of machine. A skid steer, excavator, boom lift, and pickup truck each have different critical inspection points.
- Focus on safety-critical and function-critical items an operator checks before use.
- Include the categories relevant to this machine (e.g. fluids, hydraulics, tires/tracks, controls, safety devices, structure, attachments).
- 10-18 items. Each item should be a short, specific check an operator can assess as Good, Monitor, or Defective.

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "machineSummary": "one line describing the machine and inspection type",
  "items": [
    { "item": "specific thing to inspect", "category": "category name" }
  ]
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
      setInspectionMeta({ machineSummary: parsed.machineSummary });
      setItems((parsed.items || []).map(it => ({ item: it.item, category: it.category || "", condition: "Good", note: "" })));
      setStep("inspect");
    } catch (e) {
      setGenError(true);
    }
    setLoading(false);
  };

  const setCondition = (i, cond) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, condition: cond } : it));
  const setNote = (i, note) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, note } : it));

  const defectiveCount = items.filter(i => i.condition === "Defective").length;
  const monitorCount = items.filter(i => i.condition === "Monitor").length;

  // ── Submit: Pre-Trip (full checklist) ───────────────────────
  const submitPretrip = async () => {
    setSigned(true);
    const sig = hasSignature ? canvasRef.current.toDataURL("image/png") : null;
    const label = equipmentLabel();
    const resultsJson = { machineSummary: inspectionMeta.machineSummary, items, defectiveCount, monitorCount, customFields: cf.entries() };

    // Auto-save a free-typed rental to the fleet.
    const typedSomething = (freeEq.make || freeEq.model || freeEq.type || freeEq.year).trim();
    if (typedSomething) {
      const typedLabel = [freeEq.year, freeEq.make, freeEq.model, freeEq.type].filter(v => v && v.trim()).join(" ").trim().toLowerCase();
      const alreadyInFleet = equipment.some(eq =>
        [eq.year, eq.make, eq.model, eq.type].filter(Boolean).join(" ").trim().toLowerCase() === typedLabel
      );
      if (!alreadyInFleet) {
        const { error: eqInsErr } = await supabase.from("equipment").insert({
          company_id: companyId,
          year: (freeEq.year || "").trim(),
          make: (freeEq.make || "").trim(),
          model: (freeEq.model || "").trim(),
          type: (freeEq.type || "").trim(),
          unit_number: "",
        });
        if (eqInsErr) console.error("rental auto-save failed:", eqInsErr.message);
      }
    }

    const pdfUrl = await generateAndUploadInspection({
      equipmentLabel: label, workerName, companyName, companyLogo,
      results: resultsJson, signatureDataUrl: sig,
      tripType: "pretrip", startReading, readingUnit,
    });

    try {
      await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "inspection",
          action: "submit",
          token,
          record: {
            worker_name: workerName,
            equipment_label: label,
            results_json: resultsJson,
            signed_by: workerName,
            pdf_url: pdfUrl || null,
            trip_type: "pretrip",
            linked_inspection_id: null,
            start_reading: startReading,
            end_reading: null,
            reading_unit: readingUnit,
            has_changes: null,
          },
        }),
      });
    } catch (e) {
      console.error("Inspection save failed:", e);
    }
    setTimeout(() => setStep("done"), 500);
  };

  // ── Submit: Post-Trip (short flow) ──────────────────────────
  const submitPosttrip = async () => {
    setSigned(true);
    const sig = hasSignature ? canvasRef.current.toDataURL("image/png") : null;
    const label = equipmentLabel();
    const resultsJson = {
      hasChanges: !!hasChanges,
      changeCondition: hasChanges ? changeCondition : null,
      changeNotes: hasChanges ? changeNotes.trim() : null,
      defectiveCount: hasChanges && changeCondition === "Defective" ? 1 : 0,
      monitorCount: hasChanges && changeCondition === "Monitor" ? 1 : 0,
    };

    const pdfUrl = await generateAndUploadInspection({
      equipmentLabel: label, workerName, companyName, companyLogo,
      signatureDataUrl: sig,
      tripType: "posttrip",
      startReading: openPretrip.start_reading, endReading, readingUnit,
      hasChanges: !!hasChanges, changeCondition, changeNotes,
      linkedPretrip: openPretrip,
    });

    try {
      await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "inspection",
          action: "submit",
          token,
          record: {
            worker_name: workerName,
            equipment_label: label,
            results_json: resultsJson,
            signed_by: workerName,
            pdf_url: pdfUrl || null,
            trip_type: "posttrip",
            linked_inspection_id: openPretrip.id,
            start_reading: openPretrip.start_reading,
            end_reading: endReading,
            reading_unit: openPretrip.reading_unit || readingUnit,
            has_changes: !!hasChanges,
          },
        }),
      });
    } catch (e) {
      console.error("Post-trip save failed:", e);
    }
    setTimeout(() => setStep("done"), 500);
  };

  // ── styles ───────────────────────────────────────────────
  const s = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#F0F4F8", minHeight: "100vh", padding: 16 },
    header: { background: "linear-gradient(135deg,#0C4A6E,#0369A1)", borderRadius: 14, padding: "18px 20px", marginBottom: 16, color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" },
    card: { background: "#fff", borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: "0 1px 3px #0f172a12" },
    label: { display: "block", fontWeight: 700, fontSize: 12, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 },
    input: { width: "100%", padding: "11px 13px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 11, background: "#F8FAFC" },
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
              <select style={s.input} value={selectedEq} onChange={e => {
                if (e.target.value === "__other__") { setEqMode("other"); setSelectedEq(""); }
                else setSelectedEq(e.target.value);
              }}>
                <option value="">Select a machine…</option>
                {equipment.map(eq => {
                  const lbl = [eq.year, eq.make, eq.model, eq.type].filter(Boolean).join(" ") + (eq.unit_number ? ` (Unit ${eq.unit_number})` : "");
                  return <option key={eq.id} value={lbl}>{lbl}</option>;
                })}
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
              {equipment.length > 0 && (
                <button onClick={() => { setEqMode("list"); setFreeEq({ year: "", make: "", model: "", type: "" }); }} style={{ background: "transparent", border: "none", color: "#0369A1", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 8 }}>← Choose from fleet</button>
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
            <input style={s.input} placeholder="e.g. John Smith" value={workerName} onChange={e => setWorkerName(e.target.value)} />

            <label style={s.label}>Reading type</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 11 }}>
              {["Hours", "KM"].map(u => (
                <button key={u} onClick={() => setReadingUnit(u)} style={{ flex: 1, padding: "10px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${readingUnit === u ? "#0369A1" : "#E2E8F0"}`, background: readingUnit === u ? "#F0F9FF" : "#fff", color: readingUnit === u ? "#0369A1" : "#94A3B8" }}>{u}</button>
              ))}
            </div>

            <label style={s.label}>Starting reading</label>
            <input style={s.input} type="number" inputMode="decimal" placeholder={`e.g. 1245.3`} value={startReading} onChange={e => setStartReading(e.target.value)} />

            <CustomFieldInputs cf={cf} labelStyle={s.label} inputStyle={s.input} />
            {genError && <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: "#991B1B" }}>Couldn't generate the inspection. Check your connection and try again.</div>}
            <button style={s.btn(loading ? "#94A3B8" : (workerName && startReading) ? "#0369A1" : "#94A3B8")} disabled={loading || !workerName || !startReading} onClick={() => {
              const missing = cf.missingRequired();
              if (missing.length > 0) { alert(`Please fill in: ${missing.join(", ")}`); return; }
              generateInspection();
            }}>
              {loading ? "⏳ Building inspection…" : "Generate Inspection"}
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
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 6 }}>Starting reading: {startReading} {readingUnit}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              {defectiveCount > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "#DC2626", background: "#FEF2F2", padding: "4px 10px", borderRadius: 20 }}>{defectiveCount} defective</span>}
              {monitorCount > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "#D97706", background: "#FFFBEB", padding: "4px 10px", borderRadius: 20 }}>{monitorCount} monitor</span>}
            </div>
          </div>

          {items.map((it, i) => {
            const cond = CONDITIONS.find(c => c.key === it.condition);
            return (
              <div key={i} style={{ ...s.card, borderLeft: `4px solid ${cond.color}`, marginBottom: 10 }}>
                {it.category && <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 }}>{it.category}</div>}
                <div style={{ fontWeight: 700, fontSize: 15, color: "#1E293B", marginBottom: 10 }}>{it.item}</div>
                <div style={{ display: "flex", gap: 6, marginBottom: it.condition === "Defective" || it.condition === "Monitor" ? 10 : 0 }}>
                  {CONDITIONS.map(c => (
                    <button key={c.key} onClick={() => setCondition(i, c.key)} style={{
                      flex: 1, padding: "9px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
                      border: `1.5px solid ${it.condition === c.key ? c.color : "#E2E8F0"}`,
                      background: it.condition === c.key ? c.bg : "#fff",
                      color: it.condition === c.key ? c.color : "#94A3B8",
                    }}>{c.key}</button>
                  ))}
                </div>
                {(it.condition === "Defective" || it.condition === "Monitor") && (
                  <input style={{ ...s.input, marginBottom: 0 }} placeholder="Add a note (what's wrong?)" value={it.note} onChange={e => setNote(i, e.target.value)} />
                )}
              </div>
            );
          })}

          {/* signature */}
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10, color: "#1E293B" }}>Inspector signature</div>
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
            <button style={s.btn(signed ? "#16A34A" : hasSignature ? "#0369A1" : "#94A3B8")} disabled={!hasSignature || signed} onClick={submitPretrip}>
              {signed ? "✓ Submitting…" : "Sign & Submit Pre-Trip Inspection"}
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
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>Starting reading: {openPretrip.start_reading} {openPretrip.reading_unit}</div>
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
            <input style={s.input} placeholder="e.g. John Smith" value={workerName} onChange={e => setWorkerName(e.target.value)} />
            <label style={s.label}>Ending reading ({openPretrip.reading_unit || readingUnit})</label>
            <input style={{ ...s.input, marginBottom: 0 }} type="number" inputMode="decimal" placeholder="e.g. 1251.8" value={endReading} onChange={e => setEndReading(e.target.value)} />
          </div>

          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10, color: "#1E293B" }}>Signature</div>
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
            {(() => {
              const ready = hasSignature && workerName && endReading && hasChanges !== null && (!hasChanges || changeNotes.trim());
              return (
                <button style={s.btn(signed ? "#16A34A" : ready ? "#0369A1" : "#94A3B8")} disabled={!ready || signed} onClick={submitPosttrip}>
                  {signed ? "✓ Submitting…" : "Sign & Submit Post-Trip"}
                </button>
              );
            })()}
          </div>
        </>
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
