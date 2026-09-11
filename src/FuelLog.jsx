import { useState, useEffect } from "react";
import { loadDraft, clearDraft, useDraftAutosave } from "./useDraftAutosave.js";
import { enqueueSubmission } from "./offlineQueue.js";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD } from "./theme";
import { buildFormStyles, disabledBg, bannerStyle } from "./FormKit";
import { ArrowLeft, Fuel, Loader2, CheckCircle2, WifiOff, AlertTriangle } from "lucide-react";

function newClientSubmissionId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Redoes an entire fuel-log submission from plain input data — used both by
// a live online submit below and by offlineQueue's drainQueue() to resend a
// queued one later. Throws on any failure so the caller can tell success
// from failure. Exported so WorkerMenu.jsx can drain this form's queue
// without the FuelLog component mounted.
export async function resubmitFuelLog(payload, clientSubmissionId, tokenForRequest) {
  const { equipmentLabel, equipmentId, workerName, hourReading, readingUnit, quantity, quantityUnit, cost, siteId } = payload;
  const record = {
    equipment_label: equipmentLabel,
    equipment_id: equipmentId || null,
    worker_name: workerName,
    hour_reading: hourReading || null,
    reading_unit: hourReading ? readingUnit : null,
    quantity: Number(quantity),
    quantity_unit: quantityUnit,
    cost: cost ? Number(cost) : null,
    site_id: siteId || null,
  };

  let res;
  try {
    res = await fetch("/api/fuellogs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit", token: tokenForRequest, clientSubmissionId, record }),
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

export default function FuelLog({ companyId, userName: loginUserName = "", onBack, token = null }) {
  const [step, setStep] = useState("form"); // form | queued | done
  const [equipment, setEquipment] = useState([]);
  const [eqMode, setEqMode] = useState("list"); // list | other
  const [selectedEqId, setSelectedEqId] = useState("");
  const [freeEqLabel, setFreeEqLabel] = useState("");
  const [workerName, setWorkerName] = useState(loginUserName);
  const [readingUnit, setReadingUnit] = useState("Hours");
  const [hourReading, setHourReading] = useState("");
  const [lastReading, setLastReading] = useState(null);
  const [checkingReading, setCheckingReading] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [quantityUnit, setQuantityUnit] = useState("L");
  const [cost, setCost] = useState("");
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const labelFor = (eq) => [eq.year, eq.make, eq.model, eq.type].filter(Boolean).join(" ") + (eq.unit_number ? ` (Unit ${eq.unit_number})` : "");
  const menuLabelFor = (eq) => eq.unit_number ? `UNIT ${eq.unit_number}${eq.type ? `, ${eq.type}` : ""}` : labelFor(eq);
  const equipmentLabel = () => (eqMode === "list" && selectedEqId) ? labelFor(equipment.find(e => String(e.id) === String(selectedEqId)) || {}) : freeEqLabel;

  // Load equipment + site lists — same protected endpoint Inspection.jsx uses.
  useEffect(() => {
    async function load() {
      try {
        const [eqRes, siteRes] = await Promise.all([
          fetch("/api/companydata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list_equipment", token, companyId }) }),
          fetch("/api/companydata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list_sites", token, companyId }) }),
        ]);
        const eqData = await eqRes.json();
        if (eqRes.ok) {
          setEquipment(eqData.equipment || []);
          if (!eqData.equipment || eqData.equipment.length === 0) setEqMode("other");
        } else setEqMode("other");
        const siteData = await siteRes.json();
        if (siteRes.ok) setSites(siteData.sites || []);
      } catch (e) {
        setEqMode("other");
      }
    }
    load();
  }, [companyId, token]);

  // Draft autosave (docs/scope-offline-capability.md Phase 0 pattern) — this
  // is a single-screen form, so there's no step to restore, just the fields.
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    if (!companyId) return;
    const draft = loadDraft("fuellog", companyId);
    if (draft) {
      if (draft.eqMode) setEqMode(draft.eqMode);
      if (draft.selectedEqId) setSelectedEqId(draft.selectedEqId);
      if (draft.freeEqLabel) setFreeEqLabel(draft.freeEqLabel);
      if (draft.workerName) setWorkerName(draft.workerName);
      if (draft.readingUnit) setReadingUnit(draft.readingUnit);
      if (draft.quantityUnit) setQuantityUnit(draft.quantityUnit);
      if (draft.siteId) setSiteId(draft.siteId);
    }
    setDraftRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useDraftAutosave("fuellog", companyId, { eqMode, selectedEqId, freeEqLabel, workerName, readingUnit, quantityUnit, siteId }, draftRestored && !!companyId);

  // Pre-fill the hour/KM reading from the most recent known value for this
  // machine (last fuel log or last pre/post-trip inspection, whichever is
  // newer — api/fuellogs.js's check_equipment looks at both). Worker can
  // still edit it.
  useEffect(() => {
    const label = equipmentLabel();
    // Clear immediately on every equipment change — otherwise switching from
    // machine A to machine B keeps A's reading in the field until (or even
    // after) B's check_equipment call resolves, and a worker who doesn't
    // notice submits B's fuel-up against A's meter reading.
    setHourReading("");
    if (!label) { setLastReading(null); return; }
    let cancelled = false;
    setCheckingReading(true);
    fetch("/api/fuellogs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check_equipment", token, equipmentLabel: label }) })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        setLastReading(data.lastReading || null);
        if (data.lastReading) {
          setReadingUnit(data.lastReading.unit || "Hours");
          setHourReading(data.lastReading.value || "");
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCheckingReading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEqId, freeEqLabel, eqMode]);

  const submit = async () => {
    setSaveError(false);
    setSaving(true);
    const clientSubmissionId = newClientSubmissionId();
    const payload = {
      equipmentLabel: equipmentLabel(),
      equipmentId: eqMode === "list" ? (selectedEqId || null) : null,
      workerName, hourReading, readingUnit, quantity, quantityUnit,
      cost: cost || null, siteId: siteId || null,
    };

    if (!navigator.onLine) {
      await enqueueSubmission("fuellog", clientSubmissionId, payload);
      setSaving(false);
      clearDraft("fuellog", companyId);
      setStep("queued");
      return;
    }

    try {
      await resubmitFuelLog(payload, clientSubmissionId, token);
    } catch (e) {
      if (e.isServerError) {
        setSaveError(true);
        setSaving(false);
        return;
      }
      await enqueueSubmission("fuellog", clientSubmissionId, payload);
      setSaving(false);
      clearDraft("fuellog", companyId);
      setStep("queued");
      return;
    }
    setSaving(false);
    setSaved(true);
    clearDraft("fuellog", companyId);
    setTimeout(() => setStep("done"), 400);
  };

  const accent = "#F59E0B"; // amber — distinct from every other doc type's accent (see FormKit.js's docAccent scale)
  const s = buildFormStyles(C, FONT, RAD, SHAD, accent);
  const ready = !!equipmentLabel() && !!workerName && !!quantity && Number(quantity) > 0;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Fuel size={26} strokeWidth={2} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>Log Fuel</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Record a fuel-up</div>
          </div>
        </div>
        <button onClick={onBack} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><ArrowLeft size={15} strokeWidth={2.5} /> Menu</button>
      </div>

      {step === "form" && (
        <>
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: C.text.primary }}>Equipment</div>
            {equipment.length > 0 && eqMode === "list" ? (
              <>
                <select style={s.input} value={selectedEqId} onChange={e => {
                  if (e.target.value === "__other__") { setEqMode("other"); setSelectedEqId(""); }
                  else setSelectedEqId(e.target.value);
                }}>
                  <option value="">Select a machine…</option>
                  {equipment.map(eq => <option key={eq.id} value={eq.id}>{menuLabelFor(eq)}</option>)}
                  <option value="__other__">＋ Other / not in fleet</option>
                </select>
              </>
            ) : (
              <>
                <input style={s.input} placeholder="e.g. 2019 Caterpillar 320 Excavator" value={freeEqLabel} onChange={e => setFreeEqLabel(e.target.value)} />
                {equipment.length > 0 && (
                  <button onClick={() => { setEqMode("list"); setFreeEqLabel(""); }} style={{ background: "transparent", border: "none", color: accent, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><ArrowLeft size={13} strokeWidth={2.5} /> Choose from fleet</button>
                )}
              </>
            )}
          </div>

          <div style={s.card}>
            <label style={s.label}>Your name</label>
            <input
              style={{ ...s.input, ...(loginUserName ? { background: C.line, color: C.text.faint } : {}) }}
              placeholder="e.g. John Smith" value={workerName}
              onChange={e => setWorkerName(e.target.value)}
              readOnly={!!loginUserName}
            />

            <label style={s.label}>Reading type</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 11 }}>
              {["Hours", "KM"].map(u => (
                <button key={u} onClick={() => setReadingUnit(u)} style={{ flex: 1, padding: "11px", borderRadius: RAD.sm, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${readingUnit === u ? accent : C.line}`, background: readingUnit === u ? C.status.info.bg : C.panelInset, color: readingUnit === u ? C.status.info.text : C.text.faint }}>{u}</button>
              ))}
            </div>

            <label style={s.label}>Current reading{checkingReading ? " (checking…)" : lastReading ? " (pre-filled from last reading)" : ""}</label>
            <input style={s.input} type="number" inputMode="decimal" placeholder="e.g. 1251.8" value={hourReading} onChange={e => setHourReading(e.target.value)} />
          </div>

          <div style={s.card}>
            <label style={s.label}>Quantity</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 11 }}>
              <input style={{ ...s.input, marginBottom: 0, flex: 1 }} type="number" inputMode="decimal" placeholder="e.g. 120" value={quantity} onChange={e => setQuantity(e.target.value)} />
              {["L", "gal"].map(u => (
                <button key={u} onClick={() => setQuantityUnit(u)} style={{ padding: "0 16px", borderRadius: RAD.sm, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${quantityUnit === u ? accent : C.line}`, background: quantityUnit === u ? C.status.info.bg : C.panelInset, color: quantityUnit === u ? C.status.info.text : C.text.faint }}>{u}</button>
              ))}
            </div>

            <label style={s.label}>Cost (optional)</label>
            <input style={s.input} type="number" inputMode="decimal" placeholder="e.g. 185.40" value={cost} onChange={e => setCost(e.target.value)} />

            {sites.length > 0 && (
              <>
                <label style={s.label}>Site (optional)</label>
                <select style={{ ...s.input, marginBottom: 0 }} value={siteId} onChange={e => setSiteId(e.target.value)}>
                  <option value="">No specific site</option>
                  {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
                </select>
              </>
            )}
          </div>

          {saveError && (
            <div style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Couldn't save this fuel log. Check your connection and try again.</span>
            </div>
          )}
          <button style={s.btn(saved ? C.status.success.solid : ready ? accent : disabledBg(C))} disabled={!ready || saving || saved} onClick={submit}>
            {saving ? <><Loader2 size={16} className="fora-spin" /> Saving…</> : saved ? <><CheckCircle2 size={16} strokeWidth={2.25} /> Saved</> : "Save Fuel Log"}
          </button>
          <style>{"@keyframes fora-spin { to { transform: rotate(360deg); } } .fora-spin { animation: fora-spin 0.8s linear infinite; }"}</style>
        </>
      )}

      {step === "queued" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <WifiOff size={48} strokeWidth={1.75} color={C.status.warning.text} style={{ marginBottom: 12 }} />
            <div style={{ fontWeight: 800, fontSize: 22, color: C.text.primary, marginBottom: 6 }}>Saved — No Signal</div>
            <div style={{ fontSize: 14, color: C.text.muted, marginBottom: 8 }}>{equipmentLabel()}</div>
            <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 20 }}>This fuel log is saved on your device and will send automatically the next time you're back online.</div>
            <button style={s.btn(accent)} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <CheckCircle2 size={48} strokeWidth={1.75} color={C.status.success.text} style={{ marginBottom: 12 }} />
            <div style={{ fontWeight: 800, fontSize: 22, color: C.text.primary, marginBottom: 6 }}>Fuel Logged</div>
            <div style={{ fontSize: 14, color: C.text.muted, marginBottom: 20 }}>{equipmentLabel()} · {new Date().toLocaleString("en-CA")}</div>
            <button style={s.btn(accent)} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}
    </div>
  );
}
