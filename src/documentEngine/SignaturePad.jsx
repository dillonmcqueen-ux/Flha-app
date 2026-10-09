import { useRef, useState } from "react";
import { colors as C, radius as RAD } from "../theme";
import { signatureCanvasStyle } from "../FormKit";

// A signature canvas that reports a PNG data URL when the pen lifts and null
// when cleared. Pointer events cover mouse, touch and pen.
export default function SignaturePad({ value, onChange, height = 130, label = "Sign here" }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const [has, setHas] = useState(!!value);
  const pos = (e) => {
    const c = ref.current, r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const down = (e) => {
    e.preventDefault(); drawing.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const ctx = ref.current.getContext("2d"); const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  const move = (e) => {
    if (!drawing.current) return; e.preventDefault();
    const ctx = ref.current.getContext("2d"); const p = pos(e);
    ctx.lineTo(p.x, p.y); ctx.strokeStyle = "#1E293B"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.stroke();
    if (!has) setHas(true);
  };
  const up = () => { if (!drawing.current) return; drawing.current = false; onChange(ref.current.toDataURL("image/png")); };
  const clear = () => { ref.current.getContext("2d").clearRect(0, 0, ref.current.width, ref.current.height); setHas(false); onChange(null); };
  return (
    <div>
      <div style={{ position: "relative" }}>
        <canvas ref={ref} width={600} height={160} aria-label="Signature pad" data-testid="signature-pad"
          style={{ ...signatureCanvasStyle(C, RAD), height }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        {!has && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 14, pointerEvents: "none" }}>{label}</div>}
      </div>
      <button type="button" onClick={clear} style={{ background: "transparent", border: "none", color: C.text.muted, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "8px 0" }}>Clear</button>
    </div>
  );
}
