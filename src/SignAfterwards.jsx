// src/SignAfterwards.jsx
// "Needs your signature": FLHAs the signed-in worker saved to sign later.
// The server only ever returns their OWN unsigned records and only accepts a
// signature from the person a record is stamped to (api/flhas.js sign_now),
// so this screen is a convenience, not a gate.
//
// Signing regenerates the PDF with the signature on it and uploads it
// the same way a normal submit does, then the server swaps the record's
// PDF for the new one.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, PenLine, CheckCircle2 } from "lucide-react";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD } from "./theme";
import { generateAndUploadFLHA } from "./generatePDF";
import { generateAndUploadIncident } from "./generateIncidentPDF";
import { generateAndUploadInspection } from "./generateInspectionPDF";
import { generateAndUploadNearMiss } from "./generateNearMissPDF";
import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";
import { dataUrlToBlob } from "./dataUrlToBlob.js";

async function post(url, body) {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? data : { error: data.error || "Something went wrong." };
  } catch (e) {
    return { error: "Connection error. Please try again." };
  }
}

const card = { background: `linear-gradient(160deg, ${C.panelRaised} 0%, ${C.panel} 100%)`, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: 16, boxShadow: SHAD.md, marginBottom: 14 };

function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [has, setHas] = useState(false);

  const pos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - rect.left) * (canvas.width / rect.width), y: (t.clientY - rect.top) * (canvas.height / rect.height) };
  };
  const start = (e) => { e.preventDefault(); drawing.current = true; const ctx = canvasRef.current.getContext("2d"); const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#1E3A5F"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.stroke();
    if (!has) setHas(true);
    onChange(canvasRef.current.toDataURL("image/png"));
  };
  const end = () => { drawing.current = false; };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setHas(false);
    onChange(null);
  };

  return (
    <div>
      <div style={{ position: "relative", marginBottom: 6 }}>
        <canvas
          ref={canvasRef} width={600} height={180}
          style={{ width: "100%", height: 150, border: `1.5px solid ${C.line}`, borderRadius: RAD.md, background: "#fff", touchAction: "none", display: "block" }}
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        />
        {!has && (
          <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#9CA3AF", fontSize: 14, pointerEvents: "none" }}>
            Sign here with your finger
          </div>
        )}
      </div>
      <div style={{ textAlign: "right" }}>
        <button onClick={clear} style={{ background: "transparent", border: "none", color: C.text.muted, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "6px 0", minHeight: 32 }}>Clear signature</button>
      </div>
    </div>
  );
}

function UnsignedFlha({ flha, token, companyName, companyLogo, userName, onSigned }) {
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hazards = (flha.hazards_json && flha.hazards_json.hazards) || [];
  const extreme = hazards.some(h => h && h.risk === "Extreme");

  const sign = async () => {
    if (!signature) return;
    setBusy(true); setError("");
    try {
      const pdfUrl = await generateAndUploadFLHA({
        flha: flha.hazards_json || {},
        workerName: flha.worker_name,
        jobSite: flha.job_site,
        signName: flha.worker_name,
        companyName,
        signatureDataUrl: signature,
        companyLogo,
        amendedNote: null,
        pendingApproval: flha.status === "pending_approval",
        crewSignatures: Array.isArray(flha.crew_signatures) ? flha.crew_signatures : [],
        token,
      });
      const out = await post("/api/flhas", { action: "sign_now", token, id: flha.id, signature, pdfUrl: pdfUrl || null });
      if (out.error) { setError(out.error); setBusy(false); return; }
      onSigned(flha.id, out);
    } catch (e) {
      setError("Couldn't save your signature. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div style={card}>
      <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 16, color: C.text.primary }}>{flha.job_site || "FLHA"}</div>
      <div style={{ fontSize: 12.5, color: C.text.muted, margin: "2px 0 10px" }}>
        Saved {new Date(flha.created_at).toLocaleString("en-CA")} by <strong style={{ color: C.text.body }}>{flha.worker_name || userName}</strong>
        {extreme ? " · extreme risk, a supervisor signs off after you" : ""}
      </div>
      {flha.task_description && (
        <div style={{ fontSize: 13, color: C.text.body, marginBottom: 10, lineHeight: 1.45 }}>{flha.task_description}</div>
      )}
      {hazards.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: C.text.primary, marginBottom: 6 }}>Hazards and controls, as they are now</div>
          {hazards.map((hz, i) => (
            <div key={i} style={{ borderTop: `1px solid ${C.line}`, padding: "8px 0", fontSize: 13, color: C.text.body, lineHeight: 1.4 }}>
              <div><strong>{hz.hazard}</strong>{hz.risk ? ` · ${hz.risk}` : ""}</div>
              {hz.task && <div style={{ color: C.text.muted }}>Task: {hz.task}</div>}
              {hz.control && <div style={{ color: C.text.muted }}>Control: {hz.control}</div>}
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 10 }}>
        By signing, I confirm I have reviewed this FLHA and understand the hazards and controls.
      </div>
      <SignaturePad onChange={setSignature} />
      {error && <div style={{ background: C.status.danger.bg, border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "10px 12px", margin: "8px 0", fontSize: 13.5, color: C.status.danger.text }}>{error}</div>}
      <button
        onClick={sign}
        disabled={!signature || busy}
        style={{ width: "100%", minHeight: 48, marginTop: 8, borderRadius: RAD.md, border: "none", fontWeight: 700, fontSize: 15, cursor: signature && !busy ? "pointer" : "default", background: signature ? C.orange : C.panelInset, color: signature ? C.text.onOrange : C.text.faint }}
      >
        {busy ? "Saving…" : "Sign this FLHA"}
      </button>
    </div>
  );
}

function UnsignedIncident({ record, token, companyId, companyName, companyLogo, userName, onSigned }) {
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const report = record.report_json || {};

  const sign = async () => {
    if (!signature) return;
    setBusy(true); setError("");
    try {
      const blob = dataUrlToBlob(signature);
      const filename = `incident_${companyId}_${Date.now()}.png`.replace(/[^a-zA-Z0-9_.\-]/g, "");
      const { receipt: signatureReceipt } = await uploadViaSignedUrl({
        endpoint: "/api/reports", action: "create_upload_url", token,
        bucket: "signatures", filename, file: blob, contentType: "image/png",
      });
      const pdfUrl = await generateAndUploadIncident({
        reporter: record.reporter_name, site: record.site, occurredAt: record.occurred_at, incidentType: record.incident_type,
        injuredPerson: record.injured_person, bodyPart: record.body_part, treatment: record.treatment,
        medicalAttention: record.medical_attention, witnesses: record.witnesses, evidence: record.evidence,
        report, companyName, companyLogo, signatureDataUrl: signature,
        customFields: report.customFields || [], photoUrls: record.photo_urls || [], token,
      });
      const out = await post("/api/reports", { type: "incident", action: "sign_now", token, id: record.id, signatureReceipt, pdfUrl: pdfUrl || null });
      if (out.error) { setError(out.error); setBusy(false); return; }
      onSigned(record.id, out, "incident");
    } catch (e) {
      setError("Couldn't save your signature. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div style={card}>
      <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 16, color: C.text.primary }}>Incident report: {record.incident_type || "Incident"}</div>
      <div style={{ fontSize: 12.5, color: C.text.muted, margin: "2px 0 10px" }}>
        {record.site || "No site"} · saved {new Date(record.created_at).toLocaleString("en-CA")} by <strong style={{ color: C.text.body }}>{record.reporter_name || userName}</strong>
      </div>
      {report.summary && <div style={{ fontSize: 13, color: C.text.body, marginBottom: 10, lineHeight: 1.45 }}>{report.summary}</div>}
      {record.injured_person && <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 4 }}>Injured person: {record.injured_person}{record.body_part ? ` · ${record.body_part}` : ""}</div>}
      {record.treatment && <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 4 }}>Treatment: {record.treatment}</div>}
      <div style={{ fontSize: 13, color: C.text.muted, margin: "8px 0 10px" }}>
        By signing, I confirm this incident report, as it is now, is accurate and complete to the best of my knowledge.
      </div>
      <SignaturePad onChange={setSignature} />
      {error && <div style={{ background: C.status.danger.bg, border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "10px 12px", margin: "8px 0", fontSize: 13.5, color: C.status.danger.text }}>{error}</div>}
      <button
        onClick={sign}
        disabled={!signature || busy}
        style={{ width: "100%", minHeight: 48, marginTop: 8, borderRadius: RAD.md, border: "none", fontWeight: 700, fontSize: 15, cursor: signature && !busy ? "pointer" : "default", background: signature ? C.orange : C.panelInset, color: signature ? C.text.onOrange : C.text.faint }}
      >
        {busy ? "Saving…" : "Sign this report"}
      </button>
    </div>
  );
}

function UnsignedInspection({ record, token, companyName, companyLogo, userName, onSigned }) {
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const results = record.results_json || {};
  const items = Array.isArray(results.items) ? results.items : [];
  const flagged = items.filter(it => it && (it.condition === "Defective" || it.condition === "Monitor"));
  const isPost = record.trip_type === "posttrip";

  const sign = async () => {
    if (!signature) return;
    setBusy(true); setError("");
    try {
      const pre = record.linked_pretrip || null;
      const pdfUrl = await generateAndUploadInspection({
        equipmentLabel: record.equipment_label, workerName: record.worker_name, companyName, companyLogo,
        results, signatureDataUrl: signature, tripType: record.trip_type || "pretrip",
        startReading: record.start_reading, endReading: isPost ? record.end_reading : undefined,
        readingUnit: record.reading_unit,
        hasChanges: isPost ? !!record.has_changes : undefined,
        changeCondition: isPost ? results.changeCondition : undefined,
        changeNotes: isPost ? results.changeNotes : undefined,
        linkedPretrip: isPost ? {
          id: record.linked_inspection_id,
          start_reading: pre ? pre.start_reading : record.start_reading,
          reading_unit: pre ? pre.reading_unit : record.reading_unit,
          results_json: pre ? pre.results_json : null,
          worker_name: pre ? pre.worker_name : null,
          created_at: pre ? pre.created_at : null,
        } : undefined,
        token,
      });
      const out = await post("/api/logs", { type: "inspection", action: "sign_now", token, id: record.id, signature, pdfUrl: pdfUrl || null });
      if (out.error) { setError(out.error); setBusy(false); return; }
      onSigned(record.id, out, "inspection");
    } catch (e) {
      setError("Couldn't save your signature. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div style={card}>
      <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 16, color: C.text.primary }}>{isPost ? "Post-trip" : "Pre-trip"} inspection: {record.equipment_label || "Equipment"}</div>
      <div style={{ fontSize: 12.5, color: C.text.muted, margin: "2px 0 10px" }}>
        Saved {new Date(record.created_at).toLocaleString("en-CA")} by <strong style={{ color: C.text.body }}>{record.worker_name || userName}</strong>
      </div>
      {flagged.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: C.text.primary, marginBottom: 6 }}>Flagged items, as they are now</div>
          {flagged.map((it, i) => (
            <div key={i} style={{ borderTop: `1px solid ${C.line}`, padding: "6px 0", fontSize: 13, color: C.text.body }}>
              <strong>{it.item}</strong> · {it.condition}{it.note ? ` · ${it.note}` : ""}
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 13, color: C.text.muted, margin: "8px 0 10px" }}>
        By signing, I confirm this inspection, as it is now, is accurate and complete. Its reading counts toward maintenance and fuel once you sign.
      </div>
      <SignaturePad onChange={setSignature} />
      {error && <div style={{ background: C.status.danger.bg, border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "10px 12px", margin: "8px 0", fontSize: 13.5, color: C.status.danger.text }}>{error}</div>}
      <button
        onClick={sign}
        disabled={!signature || busy}
        style={{ width: "100%", minHeight: 48, marginTop: 8, borderRadius: RAD.md, border: "none", fontWeight: 700, fontSize: 15, cursor: signature && !busy ? "pointer" : "default", background: signature ? C.orange : C.panelInset, color: signature ? C.text.onOrange : C.text.faint }}
      >
        {busy ? "Saving…" : "Sign this inspection"}
      </button>
    </div>
  );
}

function UnsignedNearMiss({ record, token, companyId, companyName, companyLogo, userName, onSigned }) {
  const [signature, setSignature] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const report = record.report_json || {};

  const sign = async () => {
    if (!signature) return;
    setBusy(true); setError("");
    try {
      const blob = dataUrlToBlob(signature);
      const filename = `nearmiss_${companyId}_${Date.now()}.png`.replace(/[^a-zA-Z0-9_.\-]/g, "");
      const { receipt: signatureReceipt } = await uploadViaSignedUrl({
        endpoint: "/api/reports", action: "create_upload_url", token,
        bucket: "signatures", filename, file: blob, contentType: "image/png",
      });
      const pdfUrl = await generateAndUploadNearMiss({
        reporter: record.reporter_name, site: record.site, occurredAt: record.occurred_at, involved: record.involved,
        report, companyName, companyLogo, signatureDataUrl: signature, customFields: report.customFields || [], token,
      });
      const out = await post("/api/reports", { type: "nearmiss", action: "sign_now", token, id: record.id, signatureReceipt, pdfUrl: pdfUrl || null });
      if (out.error) { setError(out.error); setBusy(false); return; }
      onSigned(record.id, out, "nearmiss");
    } catch (e) {
      setError("Couldn't save your signature. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div style={card}>
      <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 16, color: C.text.primary }}>Near miss report{report.severity ? `: ${report.severity} potential` : ""}</div>
      <div style={{ fontSize: 12.5, color: C.text.muted, margin: "2px 0 10px" }}>
        {record.site || "No site"} · saved {new Date(record.created_at).toLocaleString("en-CA")} by <strong style={{ color: C.text.body }}>{record.reporter_name || userName}</strong>
      </div>
      {report.whatHappened && <div style={{ fontSize: 13, color: C.text.body, marginBottom: 10, lineHeight: 1.45 }}>{report.whatHappened}</div>}
      {record.involved && <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 4 }}>Involved: {record.involved}</div>}
      <div style={{ fontSize: 13, color: C.text.muted, margin: "8px 0 10px" }}>
        By signing, I confirm this near miss report, as it is now, is accurate and complete to the best of my knowledge.
      </div>
      <SignaturePad onChange={setSignature} />
      {error && <div style={{ background: C.status.danger.bg, border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "10px 12px", margin: "8px 0", fontSize: 13.5, color: C.status.danger.text }}>{error}</div>}
      <button
        onClick={sign}
        disabled={!signature || busy}
        style={{ width: "100%", minHeight: 48, marginTop: 8, borderRadius: RAD.md, border: "none", fontWeight: 700, fontSize: 15, cursor: signature && !busy ? "pointer" : "default", background: signature ? C.orange : C.panelInset, color: signature ? C.text.onOrange : C.text.faint }}
      >
        {busy ? "Saving…" : "Sign this near miss"}
      </button>
    </div>
  );
}

export default function SignAfterwards({ token, companyId, companyName, userName, onBack, onCount }) {
  const [flhas, setFlhas] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [nearMisses, setNearMisses] = useState([]);
  const [error, setError] = useState("");
  const [logo, setLogo] = useState("");
  const [justSigned, setJustSigned] = useState([]);

  const load = useCallback(async () => {
    const [out, inc, insp, nm] = await Promise.all([
      post("/api/flhas", { action: "my_unsigned", token }),
      post("/api/reports", { type: "incident", action: "my_unsigned", token }),
      post("/api/logs", { type: "inspection", action: "my_unsigned", token }),
      post("/api/reports", { type: "nearmiss", action: "my_unsigned", token }),
    ]);
    // A document type the company has switched off answers with an error; that
    // is just "nothing to sign" for it, not a failure of the screen.
    setFlhas(out.flhas || []);
    setIncidents(inc.records || []);
    setInspections(insp.records || []);
    setNearMisses(nm.records || []);
    if (out.error && inc.error && insp.error && nm.error) setError(out.error);
  }, [token]);

  useEffect(() => {
    load();
    post("/api/companydata", { action: "get_company_logo", token, companyId }).then(d => { if (d && d.logo_url) setLogo(d.logo_url); });
  }, [load, token]);

  const signed = (id, out, kind = "flha") => {
    if (kind === "incident") setIncidents(prev => prev.filter(r => r.id !== id));
    else if (kind === "inspection") setInspections(prev => prev.filter(r => r.id !== id));
    else if (kind === "nearmiss") setNearMisses(prev => prev.filter(r => r.id !== id));
    else setFlhas(prev => (prev || []).filter(f => f.id !== id));
    setJustSigned(prev => [...prev, { id, pdfUrl: out && out.pdfUrl }]);
    if (onCount) onCount();
  };

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "16px 16px 40px", boxSizing: "border-box" }}>
      <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none", color: C.text.muted, fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "8px 0", minHeight: 40 }}>
        <ChevronLeft size={16} /> Back
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 14px" }}>
        <PenLine size={22} color={C.orange} />
        <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 22, color: C.text.primary }}>Needs your signature</div>
      </div>

      {flhas === null && <div style={{ color: C.text.muted, fontSize: 14 }}>Loading…</div>}
      {error && <div style={{ color: C.status.danger.text, fontSize: 14, marginBottom: 12 }}>{error}</div>}

      {justSigned.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.status.success.bg, border: `1px solid ${C.status.success.border}`, borderRadius: RAD.md, padding: 14, marginBottom: 14, fontSize: 14, color: C.status.success.text }}>
          <CheckCircle2 size={18} /> Signed. It can go to your supervisor now.
        </div>
      )}

      {flhas && flhas.length === 0 && incidents.length === 0 && inspections.length === 0 && nearMisses.length === 0 && justSigned.length === 0 && !error && (
        <div style={{ color: C.text.muted, fontSize: 14 }}>Nothing is waiting for your signature.</div>
      )}

      {(flhas || []).map(f => (
        <UnsignedFlha key={`flha-${f.id}`} flha={f} token={token} companyName={companyName} companyLogo={logo} userName={userName} onSigned={signed} />
      ))}
      {incidents.map(r => (
        <UnsignedIncident key={`incident-${r.id}`} record={r} token={token} companyId={companyId} companyName={companyName} companyLogo={logo} userName={userName} onSigned={signed} />
      ))}
      {nearMisses.map(r => (
        <UnsignedNearMiss key={`nearmiss-${r.id}`} record={r} token={token} companyId={companyId} companyName={companyName} companyLogo={logo} userName={userName} onSigned={signed} />
      ))}
      {inspections.map(r => (
        <UnsignedInspection key={`inspection-${r.id}`} record={r} token={token} companyName={companyName} companyLogo={logo} userName={userName} onSigned={signed} />
      ))}
    </div>
  );
}
