import { useState, useEffect, useRef } from "react";
import { enqueueSubmission, drainQueue } from "./offlineQueue.js";
import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";

// ── Gatehouse's own look — deliberately not FORA's safety-app theme (see
// the planning session: this product gets its own face on the shared
// login/session platform). Same civic-amber palette as the county
// proposal artifact. ────────────────────────────────────────────────────
const C = {
  paper: "#EDEFEA", ink: "#182420", slate: "#57655F", line: "#CBD1C8",
  amber: "#C4761F", amberDim: "#C4761F22", card: "#F6F7F3", white: "#FFFFFF",
  bad: "#B3452F", good: "#2E6E58",
};

function newClientSubmissionId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(",");
  const contentType = meta.match(/data:(.*);base64/)?.[1] || "image/jpeg";
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: contentType });
}

// Redoes a full transaction submission from plain data — used by a live
// online submit and by offlineQueue's drainQueue() to resend a queued one
// later, same pattern as App.jsx's resubmitFLHA. If the cheque photo was
// never uploaded (queued fully offline as a data URL), upload it now —
// this only runs once there's a connection, since drainQueue only fires
// on mount / the browser's `online` event.
export async function resubmitGatehouseTransaction(payload, clientSubmissionId, token) {
  let chequePhotoPath = payload.chequePhotoPath || null;
  if (payload.paymentMethod === "cheque" && !chequePhotoPath && payload.chequePhotoDataUrl) {
    const blob = dataUrlToBlob(payload.chequePhotoDataUrl);
    const filename = `cheque_${clientSubmissionId}.jpg`;
    const uploaded = await uploadViaSignedUrl({
      endpoint: "/api/gatehouse", action: "create_cheque_upload_url", token,
      bucket: "gatehouse-uploads", filename, file: blob, contentType: blob.type,
    });
    // Store the "public"-shaped URL, not the raw storage path — that's the
    // form api/gatehouse.js's signStoredUrl/pathFromStoredUrl (matching
    // api/companydata.js's existing convention for private buckets) expect
    // to find in cheque_photo_url later when re-signing it for viewing.
    chequePhotoPath = uploaded.publicUrl;
  }

  let res;
  try {
    res = await fetch("/api/gatehouse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "log_transaction", token, clientSubmissionId,
        stationId: payload.stationId, businessDate: payload.businessDate,
        tierId: payload.tierId, addonTierIds: payload.addonTierIds || [], redirected: payload.redirected,
        plate: payload.plate, vehicleEmail: payload.vehicleEmail,
        paymentMethod: payload.paymentMethod, chequePhotoPath,
        operatorName: payload.operatorName,
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
  return res.json();
}

export default function GatehouseBooth({ companyId, companyName, userName, onLogout, token }) {
  const [config, setConfig] = useState(null); // { stations, tiers }
  const [stationId, setStationId] = useState(null);
  const [step, setStep] = useState("tier"); // tier | vehicle | payment | confirm
  const [tier, setTier] = useState(null);
  const [selectedAddons, setSelectedAddons] = useState([]); // array of tier objects
  const [redirecting, setRedirecting] = useState(false);
  const [plate, setPlate] = useState("");
  const [email, setEmail] = useState("");
  const [lookedUp, setLookedUp] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [chequePhoto, setChequePhoto] = useState(null); // { file, previewUrl }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [todaysLog, setTodaysLog] = useState([]); // client-side running list for this session
  const [queuedCount, setQueuedCount] = useState(0);
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetch("/api/gatehouse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_config", token, companyId }),
    })
      .then((r) => r.json())
      .then((data) => {
        setConfig(data);
        if (data.stations && data.stations.length === 1) setStationId(data.stations[0].id);
      })
      .catch(() => setError("Could not load station configuration."));
  }, [token, companyId]);

  const refreshQueueCount = () => {
    drainQueue("gatehouse", (payload, csid) => resubmitGatehouseTransaction(payload, csid, token))
      .then((r) => setQueuedCount(r.remaining))
      .catch(() => {});
  };
  useEffect(() => {
    refreshQueueCount();
    window.addEventListener("online", refreshQueueCount);
    return () => window.removeEventListener("online", refreshQueueCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handlePlateBlur() {
    const clean = plate.trim().toUpperCase();
    if (!clean || lookedUp) return;
    setLookedUp(true);
    try {
      const res = await fetch("/api/gatehouse", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lookup_vehicle", token, companyId, plate: clean }),
      });
      const data = await res.json();
      if (data.vehicle && data.vehicle.email && !email) setEmail(data.vehicle.email);
    } catch (e) { /* best-effort — offline lookup just skips prefill */ }
  }

  async function handleChequePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setChequePhoto({ file, previewUrl });
  }

  function toggleAddon(addonTier) {
    setSelectedAddons((cur) => cur.some((t) => t.id === addonTier.id) ? cur.filter((t) => t.id !== addonTier.id) : [...cur, addonTier]);
  }

  function resetForm() {
    setStep("tier"); setTier(null); setSelectedAddons([]); setRedirecting(false); setPlate(""); setEmail("");
    setLookedUp(false); setPaymentMethod(null); setChequePhoto(null); setError("");
  }

  async function submit() {
    setSaving(true); setError("");
    const clientSubmissionId = newClientSubmissionId();
    let chequePhotoDataUrl = null;
    if (paymentMethod === "cheque" && chequePhoto) {
      try { chequePhotoDataUrl = await fileToDataUrl(chequePhoto.file); } catch (e) { /* fall through, still allow offline queue without it is not ideal but don't block */ }
    }
    const addonTierIds = redirecting ? [] : selectedAddons.map((t) => t.id);
    const payload = {
      stationId, businessDate: todayLocal(),
      tierId: tier?.id || null, addonTierIds, redirected: redirecting,
      plate: plate.trim().toUpperCase() || null, vehicleEmail: email.trim() || null,
      paymentMethod: redirecting ? null : paymentMethod,
      chequePhotoDataUrl, chequePhotoPath: null,
      operatorName: userName || null,
      // Client-side display only — snapshotted here since `tier`/
      // `selectedAddons` reset after this submission, before a queued item
      // ever gets re-rendered. Ignored server-side; log_transaction always
      // recomputes the real price from tierId/addonTierIds.
      displayLabel: [tier?.label, ...selectedAddons.map((t) => t.label)].filter(Boolean).join(" + ") || null,
      displayAmount: redirecting ? null : Number(tier?.price || 0) + selectedAddons.reduce((s, t) => s + Number(t.price || 0), 0),
    };

    // Known offline up front — queue immediately rather than waiting out a
    // doomed fetch, same as App.jsx's resubmitFLHA caller.
    if (!navigator.onLine) {
      await enqueueSubmission("gatehouse", clientSubmissionId, payload);
      setTodaysLog((l) => [{ ...payload, receipt_number: "pending", queued: true, id: clientSubmissionId }, ...l]);
      refreshQueueCount();
      setSaving(false);
      resetForm();
      return;
    }

    try {
      const result = await resubmitGatehouseTransaction(payload, clientSubmissionId, token);
      setTodaysLog((l) => [result.transaction, ...l]);
      setSaving(false);
      resetForm();
    } catch (e) {
      if (e.isServerError) {
        // A real rejection (bad price tier, missing cheque photo, etc.) —
        // show it and let the operator fix and retry, don't silently queue
        // something the server will just reject again on sync.
        setError(e.message);
        setSaving(false);
        return;
      }
      // Network-level failure — queue it. The whole point of this path is
      // that the operator never has to stop and wait for a signal; the
      // receipt is saved locally the instant they confirm.
      await enqueueSubmission("gatehouse", clientSubmissionId, payload);
      setTodaysLog((l) => [{ ...payload, receipt_number: "pending", queued: true, id: clientSubmissionId }, ...l]);
      refreshQueueCount();
      setSaving(false);
      resetForm();
    }
  }

  const station = config?.stations?.find((s) => s.id === stationId);

  const styles = {
    wrap: { minHeight: "100vh", background: C.paper, color: C.ink, fontFamily: "'Segoe UI', system-ui, sans-serif" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${C.line}`, background: C.white },
    body: { maxWidth: 640, margin: "0 auto", padding: "24px 16px 80px" },
    // Form controls (button/input/select) don't reliably inherit `color`
    // from an ancestor the way a div does — the browser's own UA
    // stylesheet wins unless color is set explicitly here, which is what
    // was producing invisible white-on-white text.
    btn: { padding: "16px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.white, color: C.ink, fontSize: 17, fontWeight: 600, cursor: "pointer", width: "100%", textAlign: "left" },
    btnActive: { border: `2px solid ${C.amber}`, background: C.amberDim },
    primary: { background: C.amber, color: "#fff", border: "none", borderRadius: 8, padding: "16px 20px", fontSize: 17, fontWeight: 700, cursor: "pointer", width: "100%" },
    ghost: { background: "transparent", border: `1px solid ${C.line}`, color: C.ink, borderRadius: 8, padding: "12px 16px", fontSize: 15, cursor: "pointer" },
    input: { width: "100%", padding: "14px", fontSize: 17, borderRadius: 8, border: `1px solid ${C.line}`, color: C.ink, background: C.white, boxSizing: "border-box" },
    label: { fontSize: 13, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8, display: "block" },
  };

  if (!config) {
    return <div style={{ ...styles.wrap, display: "flex", alignItems: "center", justifyContent: "center" }}>Loading station…</div>;
  }

  if (!stationId) {
    return (
      <div style={styles.wrap}>
        <div style={styles.header}>
          <strong>{companyName}</strong>
          <button style={styles.ghost} onClick={onLogout}>Sign out</button>
        </div>
        <div style={styles.body}>
          <span style={styles.label}>Which station is this?</span>
          <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
            {(config.stations || []).map((s) => (
              <button key={s.id} style={styles.btn} onClick={() => setStationId(s.id)}>{s.name}</button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <div>
          <strong>{station?.name}</strong>
          <div style={{ fontSize: 12, color: C.slate }}>{companyName}{userName ? ` · ${userName}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {queuedCount > 0 && <span style={{ fontSize: 12, color: C.bad, fontWeight: 700 }}>{queuedCount} saved offline, syncing…</span>}
          <button style={styles.ghost} onClick={onLogout}>Sign out</button>
        </div>
      </div>

      <div style={styles.body}>
        {error && <div style={{ color: C.bad, marginBottom: 16 }}>{error}</div>}

        {step === "tier" && (
          <>
            <span style={styles.label}>Select the load</span>
            <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
              {(config.tiers || []).filter((t) => !t.is_addon).map((t) => (
                <button
                  key={t.id}
                  style={styles.btn}
                  onClick={() => { setTier(t); setRedirecting(false); setStep("vehicle"); }}
                >
                  {t.label} <span style={{ float: "right", color: C.amber }}>${Number(t.price).toFixed(2)}</span>
                </button>
              ))}
              <button
                style={{ ...styles.btn, color: C.bad, borderColor: C.bad }}
                onClick={() => { setTier(null); setRedirecting(true); setStep("vehicle"); }}
              >
                Redirect — not accepted here
              </button>
            </div>
          </>
        )}

        {step === "vehicle" && (
          <>
            <span style={styles.label}>Vehicle</span>
            <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
              <input
                style={styles.input} placeholder="Plate number" value={plate}
                onChange={(e) => { setPlate(e.target.value); setLookedUp(false); }}
                onBlur={handlePlateBlur} autoFocus
              />
              <input
                style={styles.input} placeholder="Customer email (for the receipt, optional)" value={email}
                onChange={(e) => setEmail(e.target.value)} type="email"
              />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button style={styles.ghost} onClick={() => setStep("tier")}>Back</button>
              <button style={styles.primary} onClick={() => setStep(redirecting ? "confirm" : "payment")}>Continue</button>
            </div>
          </>
        )}

        {step === "payment" && (
          <>
            {(config.tiers || []).some((t) => t.is_addon) && (
              <div style={{ marginBottom: 24 }}>
                <span style={styles.label}>Add-ons</span>
                <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                  {(config.tiers || []).filter((t) => t.is_addon).map((t) => {
                    const active = selectedAddons.some((a) => a.id === t.id);
                    return (
                      <button key={t.id} style={{ ...styles.btn, ...(active ? styles.btnActive : {}) }} onClick={() => toggleAddon(t)}>
                        {active ? "✓ " : ""}{t.label} <span style={{ float: "right", color: C.amber }}>+${Number(t.price).toFixed(2)}</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 10, fontSize: 15, color: C.slate }}>
                  Total: <strong style={{ color: C.ink }}>${(Number(tier?.price || 0) + selectedAddons.reduce((s, t) => s + Number(t.price || 0), 0)).toFixed(2)}</strong>
                </div>
              </div>
            )}
            <span style={styles.label}>Payment — cash or cheque only</span>
            <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
              <button style={{ ...styles.btn, ...(paymentMethod === "cash" ? styles.btnActive : {}) }} onClick={() => setPaymentMethod("cash")}>Cash</button>
              <button style={{ ...styles.btn, ...(paymentMethod === "cheque" ? styles.btnActive : {}) }} onClick={() => setPaymentMethod("cheque")}>Cheque</button>
            </div>
            {paymentMethod === "cheque" && (
              <div style={{ marginTop: 16 }}>
                <span style={styles.label}>Photo of the cheque</span>
                <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleChequePhoto} />
                {chequePhoto && <img src={chequePhoto.previewUrl} alt="Cheque" style={{ marginTop: 10, maxWidth: "100%", borderRadius: 6, border: `1px solid ${C.line}` }} />}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button style={styles.ghost} onClick={() => setStep("vehicle")}>Back</button>
              <button
                style={{ ...styles.primary, opacity: (paymentMethod === "cash" || (paymentMethod === "cheque" && chequePhoto)) ? 1 : 0.5 }}
                disabled={!(paymentMethod === "cash" || (paymentMethod === "cheque" && chequePhoto))}
                onClick={() => setStep("confirm")}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === "confirm" && (
          <>
            <span style={styles.label}>Confirm</span>
            <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: 18, marginTop: 8, fontSize: 16, lineHeight: 1.7 }}>
              {redirecting ? (
                <div><strong>Redirected load</strong> — no charge</div>
              ) : (
                <>
                  <div><strong>{tier?.label}</strong> — ${Number(tier?.price || 0).toFixed(2)}</div>
                  {selectedAddons.map((a) => (
                    <div key={a.id}>+ {a.label} — ${Number(a.price).toFixed(2)}</div>
                  ))}
                  <div><strong>Total: ${(Number(tier?.price || 0) + selectedAddons.reduce((s, t) => s + Number(t.price || 0), 0)).toFixed(2)}</strong> ({paymentMethod})</div>
                </>
              )}
              {plate && <div>Plate: {plate.trim().toUpperCase()}</div>}
              {email && <div>Receipt to: {email}</div>}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button style={styles.ghost} onClick={() => setStep(redirecting ? "vehicle" : "payment")}>Back</button>
              <button style={styles.primary} disabled={saving} onClick={submit}>{saving ? "Saving…" : "Issue receipt"}</button>
            </div>
          </>
        )}

        {todaysLog.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <span style={styles.label}>This session</span>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {todaysLog.map((t) => (
                <div key={t.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
                  <span>#{t.receipt_number} {t.redirected ? "— redirected" : `— ${t.tier_label || t.displayLabel || ""}`}{t.queued ? " (syncing…)" : ""}</span>
                  <span style={{ fontWeight: 700 }}>{t.redirected ? "—" : `$${Number(t.amount ?? t.displayAmount ?? 0).toFixed(2)}`}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
