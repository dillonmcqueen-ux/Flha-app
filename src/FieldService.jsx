import { useState, useEffect } from "react";
import { loadDraft, clearDraft, useDraftAutosave } from "./useDraftAutosave.js";
import { enqueueSubmission } from "./offlineQueue.js";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD } from "./theme";
import { buildFormStyles, disabledBg, bannerStyle } from "./FormKit";
import { ArrowLeft, Wrench, Loader2, CheckCircle2, WifiOff, AlertTriangle } from "lucide-react";

// Worker-logged equipment service — "changed the filters", "replaced a
// hose", "greased the pins". See docs/scope-equipment-service-log.md.
//
// This is deliberately NOT the supervisor's "log a completed service"
// screen. That one writes a pm_service row and resets the machine's
// preventative-maintenance clock. This one only ever writes field_service,
// which api/maintenance.js's latestServiceByEquipment ignores when picking
// the PM baseline. Dillon's rule, 2026-09-17: "supervisor only, workers
// shouldnt be able to reset the interval but they should be able to log
// things like filter changes or repairs they've done."
//
// There is no flag on this form that can produce a pm_service row. A worker
// who did the scheduled service tells a supervisor, who logs it properly.

function newClientSubmissionId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Redoes a submission from plain input data — used by a live submit below
// and by offlineQueue's drainQueue() to resend a queued one later. Throws on
// failure so the caller can tell success from failure. Exported so
// WorkerMenu.jsx can drain this form's queue without the component mounted.
export async function resubmitFieldService(payload, clientSubmissionId, tokenForRequest) {
  const { equipmentId, notes, serviceReading, readingUnit } = payload;
  let res;
  try {
    res = await fetch("/api/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "log_field_service",
        token: tokenForRequest,
        clientSubmissionId,
        equipmentId,
        notes,
        serviceReading: serviceReading || null,
        readingUnit: serviceReading ? readingUnit : null,
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
    err.status = res.status;
    throw err;
  }
  return await res.json().catch(() => ({}));
}

export default function FieldService({ companyId, userName: loginUserName = "", onBack, token = null }) {
  const [step, setStep] = useState("form"); // form | queued | done
  const [equipment, setEquipment] = useState([]);
  const [loadingEquipment, setLoadingEquipment] = useState(true);
  const [selectedEqId, setSelectedEqId] = useState("");
  const [notes, setNotes] = useState("");
  const [serviceReading, setServiceReading] = useState("");
  const [readingUnit, setReadingUnit] = useState("Hours");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  const labelFor = (eq) => [eq.year, eq.make, eq.model, eq.type].filter(Boolean).join(" ") + (eq.unit_number ? ` (Unit ${eq.unit_number})` : "");
  const menuLabelFor = (eq) => eq.unit_number ? `UNIT ${eq.unit_number}${eq.type ? `, ${eq.type}` : ""}` : labelFor(eq);

  // Unlike the fuel log, there is no free-text fallback: this writes to
  // equipment_maintenance_log, whose equipment_id is a real NOT NULL foreign
  // key to the fleet. Work has to be recorded against a machine that exists,
  // or it cannot show up under that machine later — which is the only reason
  // to record it. A company with an empty fleet gets told so plainly.
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/companydata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_equipment", token, companyId }),
        });
        const data = await res.json();
        if (res.ok) setEquipment(data.equipment || []);
      } catch (e) {
        /* leave the list empty; the empty state below explains it */
      }
      setLoadingEquipment(false);
    }
    load();
  }, [companyId, token]);

  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    if (!companyId) return;
    const draft = loadDraft("fieldservice", companyId);
    if (draft) {
      if (draft.selectedEqId) setSelectedEqId(draft.selectedEqId);
      if (draft.notes) setNotes(draft.notes);
      if (draft.readingUnit) setReadingUnit(draft.readingUnit);
    }
    setDraftRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useDraftAutosave("fieldservice", companyId, { selectedEqId, notes, readingUnit }, draftRestored && !!companyId);

  const submit = async () => {
    setSaveError("");
    setSaving(true);
    const clientSubmissionId = newClientSubmissionId();
    const payload = { equipmentId: selectedEqId, notes: notes.trim(), serviceReading, readingUnit };

    if (!navigator.onLine) {
      await enqueueSubmission("fieldservice", clientSubmissionId, payload);
      setSaving(false);
      clearDraft("fieldservice", companyId);
      setStep("queued");
      return;
    }

    try {
      await resubmitFieldService(payload, clientSubmissionId, token);
    } catch (e) {
      if (e.isServerError) {
        setSaveError(e.message || "Couldn't save that. Try again.");
        setSaving(false);
        return;
      }
      await enqueueSubmission("fieldservice", clientSubmissionId, payload);
      setSaving(false);
      clearDraft("fieldservice", companyId);
      setStep("queued");
      return;
    }
    setSaving(false);
    setSaved(true);
    clearDraft("fieldservice", companyId);
    setTimeout(() => setStep("done"), 400);
  };

  const accent = "#0D9488"; // teal — distinct from inspection (#0369A1) and fuel (#F59E0B)
  const s = buildFormStyles(C, FONT, RAD, SHAD, accent);
  const ready = !!selectedEqId && notes.trim().length > 0;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Wrench size={26} strokeWidth={2} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>Log Service</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Record work you did on a machine</div>
          </div>
        </div>
        <button onClick={onBack} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><ArrowLeft size={15} strokeWidth={2.5} /> Menu</button>
      </div>

      {step === "form" && (
        <>
          {!loadingEquipment && equipment.length === 0 ? (
            <div style={s.card}>
              <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6, color: C.text.primary }}>No machines set up yet</div>
              <div style={{ fontSize: 13, color: C.text.muted }}>
                Service gets logged against a specific machine, so your fleet needs to be added first. Ask your supervisor to add it.
              </div>
            </div>
          ) : (
            <>
              <div style={s.card}>
                <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: C.text.primary }}>Which machine?</div>
                <select style={s.input} value={selectedEqId} onChange={e => setSelectedEqId(e.target.value)}>
                  <option value="">{loadingEquipment ? "Loading…" : "Select a machine…"}</option>
                  {equipment.map(eq => <option key={eq.id} value={eq.id}>{menuLabelFor(eq)}</option>)}
                </select>
              </div>

              <div style={s.card}>
                <label style={s.label}>What did you do?</label>
                <textarea
                  style={{ ...s.input, minHeight: 96, resize: "vertical" }}
                  placeholder="e.g. Changed the fuel filters and topped up hydraulic oil"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
                <div style={{ fontSize: 12, color: C.text.faint, marginTop: 6 }}>
                  This gets logged against the machine so your supervisor can see it. It does not count as the scheduled service.
                </div>
              </div>

              <div style={s.card}>
                <label style={s.label}>Hours / KM (optional)</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    style={{ ...s.input, flex: 1 }}
                    inputMode="decimal"
                    placeholder="Leave blank if you don't know"
                    value={serviceReading}
                    onChange={e => setServiceReading(e.target.value)}
                  />
                  <select style={{ ...s.input, width: 110 }} value={readingUnit} onChange={e => setReadingUnit(e.target.value)}>
                    <option value="Hours">Hours</option>
                    <option value="KM">KM</option>
                  </select>
                </div>
              </div>

              {saveError && (
                <div style={bannerStyle(C, "danger")}>
                  <AlertTriangle size={16} strokeWidth={2.5} /> {saveError}
                </div>
              )}

              <button
                style={s.btn(ready && !saving ? accent : disabledBg(C))}
                disabled={!ready || saving}
                onClick={submit}
              >
                {saving ? <><Loader2 size={16} strokeWidth={2.5} /> Saving…</> : saved ? <><CheckCircle2 size={16} strokeWidth={2.5} /> Saved</> : "Log It"}
              </button>
            </>
          )}
        </>
      )}

      {step === "queued" && (
        <div style={s.card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 17, color: C.text.primary, marginBottom: 6 }}>
            <WifiOff size={18} strokeWidth={2.5} /> Saved on this phone
          </div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 16 }}>
            No signal right now. This will send by itself next time you're online — you don't have to do anything.
          </div>
          <button style={s.btn(accent)} onClick={onBack}>Back to menu</button>
        </div>
      )}

      {step === "done" && (
        <div style={s.card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 17, color: C.text.primary, marginBottom: 6 }}>
            <CheckCircle2 size={18} strokeWidth={2.5} /> Logged
          </div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 16 }}>Thanks — that's on the machine's record now.</div>
          <button style={s.btn(accent)} onClick={onBack}>Back to menu</button>
        </div>
      )}
    </div>
  );
}
