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

export default function SignAfterwards({ token, companyId, companyName, userName, onBack, onCount }) {
  const [flhas, setFlhas] = useState(null);
  const [error, setError] = useState("");
  const [logo, setLogo] = useState("");
  const [justSigned, setJustSigned] = useState([]);

  const load = useCallback(async () => {
    const out = await post("/api/flhas", { action: "my_unsigned", token });
    if (out.error) { setError(out.error); setFlhas([]); return; }
    setFlhas(out.flhas || []);
  }, [token]);

  useEffect(() => {
    load();
    post("/api/companydata", { action: "get_company_logo", token, companyId }).then(d => { if (d && d.logo_url) setLogo(d.logo_url); });
  }, [load, token]);

  const signed = (id, out) => {
    setFlhas(prev => (prev || []).filter(f => f.id !== id));
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

      {flhas && flhas.length === 0 && justSigned.length === 0 && !error && (
        <div style={{ color: C.text.muted, fontSize: 14 }}>Nothing is waiting for your signature.</div>
      )}

      {(flhas || []).map(f => (
        <UnsignedFlha key={f.id} flha={f} token={token} companyName={companyName} companyLogo={logo} userName={userName} onSigned={signed} />
      ))}
    </div>
  );
}
