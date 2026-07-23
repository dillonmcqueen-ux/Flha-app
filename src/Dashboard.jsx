import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabaseClient";
import { generateAndUploadFLHA } from "./generatePDF";
import { generateAndUploadEquipmentReport } from "./generateEquipmentReportPDF";

const RISK_COLOR = {
  Extreme: { bg: "#7F1D1D", border: "#7F1D1D", text: "#FFFFFF", dot: "#7F1D1D" },
  High: { bg: "#FEF2F2", border: "#FCA5A5", text: "#991B1B", dot: "#DC2626" },
  Medium: { bg: "#FFFBEB", border: "#FCD34D", text: "#92400E", dot: "#D97706" },
  Low: { bg: "#F0FDF4", border: "#86EFAC", text: "#166534", dot: "#16A34A" },
};

function RiskBadge({ risk }) {
  const c = RISK_COLOR[risk] || RISK_COLOR.Low;
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700
    }}>{risk}</span>
  );
}

function FLHACard({ flha, onClose, onDelete, onApprove }) {
  const h = flha.hazards_json || {};
  const isPending = flha.status === "pending_approval";
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [supName, setSupName] = useState("");
  const [approving, setApproving] = useState(false);

  const getPos = (e) => {
    const c = canvasRef.current, r = c.getBoundingClientRect(), t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) };
  };
  const startDraw = (e) => { e.preventDefault(); drawingRef.current = true; const ctx = canvasRef.current.getContext("2d"); const { x, y } = getPos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const draw = (e) => { if (!drawingRef.current) return; e.preventDefault(); const ctx = canvasRef.current.getContext("2d"); const { x, y } = getPos(e); ctx.lineTo(x, y); ctx.strokeStyle = "#1E293B"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.stroke(); setHasSignature(true); };
  const endDraw = () => { drawingRef.current = false; };
  const clearSig = () => { const c = canvasRef.current; if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height); setHasSignature(false); };

  const doApprove = async () => {
    if (!supName.trim() || !hasSignature) return;
    setApproving(true);
    const sig = canvasRef.current.toDataURL("image/png");
    await onApprove(flha, supName.trim(), sig);
    setApproving(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#00000080", zIndex: 100,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "16px", overflowY: "auto"
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 14, padding: 24, width: "100%",
        maxWidth: 640, marginTop: 8
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: "#1E3A5F" }}>FLHA Report</div>
            <div style={{ fontSize: 13, color: "#6B7280" }}>
              {new Date(flha.created_at).toLocaleString("en-CA")} · {flha.job_site}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {flha.pdf_url && (
              <a href={flha.pdf_url} target="_blank" rel="noreferrer" style={{
                background: "#F97316", color: "#fff", border: "none", borderRadius: 8,
                padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                textDecoration: "none"
              }}>⬇ PDF</a>
            )}
            {onDelete && (
              <button onClick={() => onDelete(flha.id, flha.worker_name)} style={{
                background: "#FEF2F2", color: "#DC2626", border: "1.5px solid #FCA5A5", borderRadius: 8,
                padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer"
              }}>🗑 Delete</button>
            )}
            <button onClick={onClose} style={{
              background: "#F3F4F6", border: "none", borderRadius: 8,
              padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer"
            }}>✕ Close</button>
          </div>
        </div>

        {isPending && (
          <div style={{ background: "#7F1D1D", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", marginBottom: 2 }}>🛑 PENDING SUPERVISOR SIGN-OFF — EXTREME RISK</div>
            <div style={{ fontSize: 13, color: "#FECACA" }}>This FLHA contains extreme-risk work. Review the hazards and controls below, then sign off to approve. Work should not begin until you approve.</div>
          </div>
        )}

        {!isPending && flha.supervisor_signed_by && (
          <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#166534" }}>✓ APPROVED BY SUPERVISOR</div>
            <div style={{ fontSize: 13, color: "#374151", marginTop: 2 }}>{flha.supervisor_signed_by} · {flha.supervisor_signed_at ? new Date(flha.supervisor_signed_at).toLocaleString("en-CA") : ""}</div>
          </div>
        )}

        <div style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#0369A1", marginBottom: 4 }}>WORKER</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#1E3A5F" }}>{flha.worker_name}</div>
          <div style={{ fontSize: 13, color: "#374151", marginTop: 2 }}>Signed by: {flha.signed_by}</div>
        </div>

        {h.taskSummary && (
          <div style={{ background: "#F9FAFB", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>TASK SUMMARY</div>
            <div style={{ fontSize: 14, color: "#374151" }}>{h.taskSummary}</div>
          </div>
        )}

        {h.sopAlerts?.length > 0 && (
          <div style={{ background: "#FFF7ED", border: "1.5px solid #FED7AA", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#C2410C", marginBottom: 6 }}>⚠️ SOP ALERTS TRIGGERED</div>
            {h.sopAlerts.map((a, i) => <div key={i} style={{ fontSize: 13, color: "#9A3412", marginBottom: 2 }}>• {a}</div>)}
          </div>
        )}

        {h.customFields?.length > 0 && (
          <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {h.customFields.map((f, i) => (
                <div key={i}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>{f.label}</div>
                  <div style={{ fontSize: 13, color: "#334155" }}>{f.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {h.hazards?.length > 0 && (
          <>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: "#1E3A5F" }}>Hazards & Controls</div>
            {h.hazards.map((hz, i) => {
              const c = RISK_COLOR[hz.risk] || RISK_COLOR.Low;
              const prevTask = i > 0 ? h.hazards[i - 1].task : null;
              const showTaskHeader = hz.task && hz.task !== prevTask;
              const taskNumber = showTaskHeader
                ? [...new Set(h.hazards.slice(0, i + 1).map(x => x.task))].length
                : null;
              return (
                <div key={i}>
                  {showTaskHeader && (
                    <div style={{ background: "#EFF6FF", borderRadius: 8, padding: "8px 12px", marginBottom: 8, marginTop: i > 0 ? 10 : 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#1E3A5F", textTransform: "uppercase", letterSpacing: 0.5 }}>Task {taskNumber}</div>
                      <div style={{ fontSize: 13, color: "#374151", marginTop: 1 }}>{hz.task}</div>
                    </div>
                  )}
                  <div style={{
                    border: `1.5px solid ${c.border}`, background: c.bg,
                    borderRadius: 10, padding: "12px 14px", marginBottom: 8
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{hz.hazard}</div>
                      <RiskBadge risk={hz.risk} />
                    </div>
                    <div style={{ fontSize: 13, color: "#374151" }}>🛡 {hz.control}</div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {h.ppeRequired?.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: "#1E3A5F" }}>Required PPE</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {h.ppeRequired.map((p, i) => (
                <span key={i} style={{
                  background: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1D4ED8",
                  borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600
                }}>{p}</span>
              ))}
            </div>
          </div>
        )}

        {isPending && onApprove && (
          <div style={{ borderTop: "2px solid #7F1D1D", marginTop: 8, paddingTop: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#7F1D1D", marginBottom: 4 }}>Supervisor Sign-Off Required</div>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>By signing, I approve this extreme-risk work to proceed with the controls listed above.</div>
            <label style={{ display: "block", fontWeight: 700, fontSize: 12, color: "#475569", marginBottom: 6, textTransform: "uppercase" }}>Supervisor name</label>
            <input value={supName} onChange={e => setSupName(e.target.value)} placeholder="Your full name" style={{ width: "100%", padding: "11px 13px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 12, background: "#F8FAFC" }} />
            <label style={{ display: "block", fontWeight: 700, fontSize: 12, color: "#475569", marginBottom: 6, textTransform: "uppercase" }}>Signature</label>
            <div style={{ position: "relative", marginBottom: 6 }}>
              <canvas ref={canvasRef} width={600} height={180}
                style={{ width: "100%", height: 150, border: "1.5px solid #E2E8F0", borderRadius: 10, background: "#fff", touchAction: "none", display: "block" }}
                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
              {!hasSignature && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 14, pointerEvents: "none" }}>Sign here to approve</div>}
            </div>
            <div style={{ textAlign: "right", marginBottom: 12 }}>
              <button onClick={clearSig} style={{ background: "transparent", border: "none", color: "#64748B", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Clear</button>
            </div>
            <button onClick={doApprove} disabled={!supName.trim() || !hasSignature || approving}
              style={{ width: "100%", background: (supName.trim() && hasSignature) ? "#16A34A" : "#94A3B8", color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontWeight: 800, fontSize: 15, cursor: "pointer" }}>
              {approving ? "Approving…" : "✓ Approve & Sign Off"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function InspectionCard({ insp, onClose, onDelete }) {
  const r = insp.results_json || {};
  const items = r.items || [];
  const isPost = insp.trip_type === "posttrip";
  const condColor = { Good: "#16A34A", Monitor: "#D97706", Defective: "#DC2626" };
  const condBg = { Good: "#F0FDF4", Monitor: "#FFFBEB", Defective: "#FEF2F2" };
  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000080", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 640, marginTop: 8 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 18, color: "#1E293B" }}>{isPost ? "Post-Trip Inspection" : "Pre-Trip Inspection"}</div>
              <span style={{ fontSize: 10, fontWeight: 800, color: isPost ? "#7C3AED" : "#0369A1", background: isPost ? "#F3E8FF" : "#EFF6FF", padding: "2px 8px", borderRadius: 20 }}>{isPost ? "POST" : "PRE"}</span>
            </div>
            <div style={{ fontSize: 13, color: "#6B7280" }}>{new Date(insp.created_at).toLocaleString("en-CA")}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {insp.pdf_url && (
              <a href={insp.pdf_url} target="_blank" rel="noreferrer" style={{ background: "#0369A1", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>⬇ PDF</a>
            )}
            {onDelete && (
              <button onClick={() => onDelete(insp.id, insp.worker_name)} style={{ background: "#FEF2F2", color: "#DC2626", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🗑 Delete</button>
            )}
            <button onClick={onClose} style={{ background: "#F3F4F6", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>✕ Close</button>
          </div>
        </div>

        <div style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1E293B" }}>{insp.equipment_label}</div>
          <div style={{ fontSize: 13, color: "#374151", marginTop: 2 }}>{isPost ? "Technician" : "Inspector"}: {insp.worker_name}</div>
          {r.machineSummary && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>{r.machineSummary}</div>}
          {(insp.start_reading || insp.end_reading) && (
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              {insp.start_reading && <div style={{ fontSize: 12, color: "#374151" }}>Start: <strong>{insp.start_reading} {insp.reading_unit}</strong></div>}
              {insp.end_reading && <div style={{ fontSize: 12, color: "#374151" }}>End: <strong>{insp.end_reading} {insp.reading_unit}</strong></div>}
            </div>
          )}
        </div>

        {isPost ? (
          <>
            {insp.has_changes === false && (
              <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#166534" }}>✓ No changes reported since Pre-Trip</div>
              </div>
            )}
            {insp.has_changes === true && (
              <div style={{ border: `1.5px solid ${r.changeCondition === "Defective" ? "#FCA5A5" : "#FCD34D"}`, background: r.changeCondition === "Defective" ? "#FEF2F2" : "#FFFBEB", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: r.changeCondition === "Defective" ? "#991B1B" : "#92400E", marginBottom: 4 }}>⚠ Change reported — {r.changeCondition}</div>
                <div style={{ fontSize: 13, color: "#374151" }}>{r.changeNotes}</div>
              </div>
            )}
          </>
        ) : (
          items.map((it, i) => (
            <div key={i} style={{ border: `1.5px solid ${condColor[it.condition] || "#E5E7EB"}40`, background: condBg[it.condition] || "#fff", borderRadius: 10, padding: "10px 14px", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#1E293B" }}>{it.item}</div>
                <span style={{ fontSize: 12, fontWeight: 800, color: condColor[it.condition] }}>{it.condition}</span>
              </div>
              {it.note && <div style={{ fontSize: 13, color: "#374151", marginTop: 4, fontStyle: "italic" }}>Note: {it.note}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ToolboxCard({ talk, onClose, onDelete }) {
  const p = talk.talking_points_json || {};
  const attendees = talk.attendees_json || [];
  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000080", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 640, marginTop: 8 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: "#5B21B6" }}>{talk.meeting_type} Toolbox Talk</div>
            <div style={{ fontSize: 13, color: "#6B7280" }}>{new Date(talk.created_at).toLocaleString("en-CA")} · {talk.site}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {talk.pdf_url && (
              <a href={talk.pdf_url} target="_blank" rel="noreferrer" style={{ background: "#7C3AED", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>⬇ PDF</a>
            )}
            {onDelete && (
              <button onClick={() => onDelete(talk.id)} style={{ background: "#FEF2F2", color: "#DC2626", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🗑 Delete</button>
            )}
            <button onClick={onClose} style={{ background: "#F3F4F6", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>✕ Close</button>
          </div>
        </div>

        <div style={{ background: "#FAF5FF", border: "1px solid #E9D5FF", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1E293B" }}>{p.summary || talk.topic}</div>
          <div style={{ fontSize: 13, color: "#374151", marginTop: 2 }}>Presenter: {talk.presenter_name}</div>
        </div>

        {(p.sections || []).map((sec, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#5B21B6", marginBottom: 6 }}>{sec.heading}</div>
            {(sec.bullets || []).map((b, j) => (
              <div key={j} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                <span style={{ color: "#7C3AED", fontWeight: 800 }}>•</span>
                <span style={{ fontSize: 14, color: "#334155", lineHeight: 1.5 }}>{b}</span>
              </div>
            ))}
          </div>
        ))}

        {p.discussion?.length > 0 && (
          <div style={{ background: "#FAF5FF", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#5B21B6", marginBottom: 6 }}>💬 Discussion</div>
            {p.discussion.map((d, i) => (
              <div key={i} style={{ fontSize: 14, color: "#334155", marginBottom: 4 }}>{i + 1}. {d}</div>
            ))}
          </div>
        )}

        <div style={{ borderTop: "1px solid #E5E7EB", paddingTop: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#1E293B", marginBottom: 8 }}>Attendance ({attendees.length})</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {attendees.map((a, i) => (
              <div key={i} style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: 8 }}>
                {a.signature && <img src={a.signature} alt="" style={{ width: "100%", height: 40, objectFit: "contain" }} />}
                <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginTop: 4 }}>{a.name}{a.presenter ? " (Presenter)" : ""}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportRow({ rec, last, onClick, kind }) {
  const r = rec.report_json || {};
  const sevColors = {
    Low: { c: "#166534", bg: "#F0FDF4" }, Medium: { c: "#92400E", bg: "#FFFBEB" },
    High: { c: "#991B1B", bg: "#FEF2F2" }, Critical: { c: "#fff", bg: "#7F1D1D" },
  };
  const sev = r.severity || "Medium";
  const sc = sevColors[sev] || sevColors.Medium;
  const preview = kind === "incident"
    ? (r.summary || rec.incident_type || "")
    : (r.whatHappened || rec.involved || "");
  const who = kind === "nearmiss" && rec.is_anonymous ? "Anonymous" : rec.reporter_name;
  return (
    <div onClick={onClick} style={{ padding: "12px 4px", borderBottom: last ? "none" : "1px solid #F3F4F680", cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1, paddingRight: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: sc.c, background: sc.bg, padding: "2px 9px", borderRadius: 20, border: sev === "Critical" ? "none" : `1px solid ${sc.c}30` }}>{sev.toUpperCase()}</span>
            {kind === "incident" && <span style={{ fontSize: 11, fontWeight: 700, color: "#991B1B", background: "#FEF2F2", padding: "2px 8px", borderRadius: 20 }}>{rec.incident_type}</span>}
            <div style={{ fontWeight: 700, fontSize: 14, color: "#1E3A5F" }}>{rec.site}</div>
          </div>
          <div style={{ fontSize: 13, color: "#374151" }}>{preview.length > 90 ? preview.slice(0, 90) + "…" : preview}</div>
          <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>🧑 {who}{rec.occurred_at ? ` · ${rec.occurred_at}` : ""}</div>
          {rec.reviewed && <div style={{ fontSize: 11, color: "#16A34A", fontWeight: 700, marginTop: 2 }}>✓ Reviewed by {rec.reviewed_by}</div>}
        </div>
        <div style={{ fontSize: 11, color: rec.pdf_url ? "#D97706" : "#9CA3AF", flexShrink: 0 }}>
          {rec.pdf_url ? "📄 PDF" : ""} →
        </div>
      </div>
    </div>
  );
}

function NearMissCard({ nm, onClose, onDelete, onReview }) {
  const [reviewNotes, setReviewNotes] = useState("");
  const r = nm.report_json || {};
  const sevColors = {
    Low: { c: "#166534", bg: "#F0FDF4" }, Medium: { c: "#92400E", bg: "#FFFBEB" },
    High: { c: "#991B1B", bg: "#FEF2F2" }, Critical: { c: "#fff", bg: "#7F1D1D" },
  };
  const sev = r.severity || "Medium";
  const sc = sevColors[sev] || sevColors.Medium;
  const List = ({ title, items }) => (
    (items && items.length > 0) ? (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: "#B45309", marginBottom: 6 }}>{title}</div>
        {items.map((it, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
            <span style={{ color: "#D97706", fontWeight: 800 }}>•</span>
            <span style={{ fontSize: 14, color: "#334155", lineHeight: 1.5 }}>{it}</span>
          </div>
        ))}
      </div>
    ) : null
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000080", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 640, marginTop: 8 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: "#B45309" }}>Near Miss Report</div>
            <div style={{ fontSize: 13, color: "#6B7280" }}>{new Date(nm.created_at).toLocaleString("en-CA")} · {nm.site}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {nm.pdf_url && (
              <a href={nm.pdf_url} target="_blank" rel="noreferrer" style={{ background: "#D97706", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>⬇ PDF</a>
            )}
            {onDelete && (
              <button onClick={() => onDelete(nm.id)} style={{ background: "#FEF2F2", color: "#DC2626", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🗑 Delete</button>
            )}
            <button onClick={onClose} style={{ background: "#F3F4F6", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>✕ Close</button>
          </div>
        </div>

        <div style={{ background: sc.bg, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: sc.c }}>POTENTIAL SEVERITY: {sev.toUpperCase()}</div>
          {r.severityReason && <div style={{ fontSize: 13, color: sc.c === "#fff" ? "#FECACA" : "#475569", marginTop: 2 }}>{r.severityReason}</div>}
        </div>

        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: "#374151" }}>Reported by: <strong>{nm.is_anonymous ? "Anonymous" : nm.reporter_name}</strong></div>
          {nm.occurred_at && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>When: {nm.occurred_at}</div>}
          {nm.involved && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>Involved: {nm.involved}</div>}
        </div>

        {r.whatHappened && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#B45309", marginBottom: 6 }}>What Happened</div>
            <div style={{ fontSize: 14, color: "#334155", lineHeight: 1.5 }}>{r.whatHappened}</div>
          </div>
        )}
        <List title="Contributing Factors" items={r.contributingFactors} />
        {r.potentialOutcome && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#B45309", marginBottom: 6 }}>Potential Outcome</div>
            <div style={{ fontSize: 14, color: "#334155", lineHeight: 1.5 }}>{r.potentialOutcome}</div>
          </div>
        )}
        <List title="Immediate Actions Taken" items={r.immediateActions} />
        <List title="Recommended Next Steps" items={r.nextSteps} />

        {nm.reviewed ? (
          <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 10, padding: "12px 14px", marginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#166534" }}>✓ REVIEWED BY {(nm.reviewed_by || "").toUpperCase()}</div>
            <div style={{ fontSize: 12, color: "#374151", marginTop: 2 }}>{nm.reviewed_at ? new Date(nm.reviewed_at).toLocaleString("en-CA") : ""}</div>
            {nm.review_notes && <div style={{ fontSize: 13, color: "#374151", marginTop: 6 }}><strong>Action taken:</strong> {nm.review_notes}</div>}
          </div>
        ) : onReview && (
          <div style={{ borderTop: "2px solid #B45309", marginTop: 8, paddingTop: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#B45309", marginBottom: 8 }}>Mark as Reviewed</div>
            <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} placeholder="Optional — action taken or notes" style={{ width: "100%", minHeight: 60, padding: "10px 12px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 14, boxSizing: "border-box", fontFamily: "inherit", marginBottom: 10, background: "#F8FAFC", resize: "vertical" }} />
            <button onClick={() => onReview(nm.id, reviewNotes)} style={{ width: "100%", background: "#16A34A", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontWeight: 800, fontSize: 15, cursor: "pointer" }}>✓ Mark Reviewed</button>
          </div>
        )}
      </div>
    </div>
  );
}

function IncidentCard({ inc, onClose, onDelete, onReview }) {
  const [reviewNotes, setReviewNotes] = useState("");
  const r = inc.report_json || {};
  const sevColors = {
    Low: { c: "#166534", bg: "#F0FDF4" }, Medium: { c: "#92400E", bg: "#FFFBEB" },
    High: { c: "#991B1B", bg: "#FEF2F2" }, Critical: { c: "#fff", bg: "#7F1D1D" },
  };
  const sev = r.severity || "Medium";
  const sc = sevColors[sev] || sevColors.Medium;
  const List = ({ title, items }) => (
    (items && items.length > 0) ? (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: "#991B1B", marginBottom: 6 }}>{title}</div>
        {items.map((it, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
            <span style={{ color: "#DC2626", fontWeight: 800 }}>•</span>
            <span style={{ fontSize: 14, color: "#334155", lineHeight: 1.5 }}>{it}</span>
          </div>
        ))}
      </div>
    ) : null
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000080", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 640, marginTop: 8 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: "#991B1B" }}>{inc.incident_type}</div>
            <div style={{ fontSize: 13, color: "#6B7280" }}>{new Date(inc.created_at).toLocaleString("en-CA")} · {inc.site}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {inc.pdf_url && <a href={inc.pdf_url} target="_blank" rel="noreferrer" style={{ background: "#DC2626", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>⬇ PDF</a>}
            {onDelete && <button onClick={() => onDelete(inc.id)} style={{ background: "#FEF2F2", color: "#DC2626", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🗑</button>}
            <button onClick={onClose} style={{ background: "#F3F4F6", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>✕</button>
          </div>
        </div>

        <div style={{ background: sc.bg, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: sc.c }}>SEVERITY: {sev.toUpperCase()}</div>
          {r.severityReason && <div style={{ fontSize: 13, color: sc.c === "#fff" ? "#FECACA" : "#475569", marginTop: 2 }}>{r.severityReason}</div>}
        </div>

        <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: "#374151" }}>Reported by: <strong>{inc.reporter_name}</strong></div>
          {inc.occurred_at && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>When: {inc.occurred_at}</div>}
          {inc.injured_person && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>Injured: {inc.injured_person}{inc.body_part ? ` (${inc.body_part})` : ""}</div>}
          {inc.medical_attention && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>Medical: {inc.medical_attention}</div>}
          {inc.treatment && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>Treatment: {inc.treatment}</div>}
          {inc.witnesses && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>Witnesses: {inc.witnesses}</div>}
          {inc.evidence && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>Evidence: {inc.evidence}</div>}
        </div>

        {r.summary && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#991B1B", marginBottom: 6 }}>Summary</div>
            <div style={{ fontSize: 14, color: "#334155", lineHeight: 1.5 }}>{r.summary}</div>
          </div>
        )}
        <List title="Sequence of Events" items={r.sequenceOfEvents} />
        <List title="Contributing Factors" items={r.contributingFactors} />
        {r.rootCause && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#991B1B", marginBottom: 6 }}>Root Cause</div>
            <div style={{ fontSize: 14, color: "#334155", lineHeight: 1.5 }}>{r.rootCause}</div>
          </div>
        )}
        <List title="Immediate Actions Taken" items={r.immediateActions} />
        <List title="Corrective Actions" items={r.correctiveActions} />

        {inc.reviewed ? (
          <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 10, padding: "12px 14px", marginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#166534" }}>✓ REVIEWED BY {(inc.reviewed_by || "").toUpperCase()}</div>
            <div style={{ fontSize: 12, color: "#374151", marginTop: 2 }}>{inc.reviewed_at ? new Date(inc.reviewed_at).toLocaleString("en-CA") : ""}</div>
            {inc.review_notes && <div style={{ fontSize: 13, color: "#374151", marginTop: 6 }}><strong>Action taken:</strong> {inc.review_notes}</div>}
          </div>
        ) : onReview && (
          <div style={{ borderTop: "2px solid #991B1B", marginTop: 8, paddingTop: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#991B1B", marginBottom: 8 }}>Mark as Reviewed</div>
            <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} placeholder="Optional — action taken or notes" style={{ width: "100%", minHeight: 60, padding: "10px 12px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 14, boxSizing: "border-box", fontFamily: "inherit", marginBottom: 10, background: "#F8FAFC", resize: "vertical" }} />
            <button onClick={() => onReview(inc.id, reviewNotes)} style={{ width: "100%", background: "#16A34A", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontWeight: 800, fontSize: 15, cursor: "pointer" }}>✓ Mark Reviewed</button>
          </div>
        )}
      </div>
    </div>
  );
}

function DailyCard({ dr, onClose, onDelete }) {
  const r = dr.report_json || {};
  const Block = ({ title, body }) => (
    body ? (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: "#15803D", marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 14, color: "#334155", lineHeight: 1.5 }}>{body}</div>
      </div>
    ) : null
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000080", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 640, marginTop: 8 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: "#15803D" }}>Daily Report</div>
            <div style={{ fontSize: 13, color: "#6B7280" }}>{dr.report_date} · {dr.site}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {dr.pdf_url && <a href={dr.pdf_url} target="_blank" rel="noreferrer" style={{ background: "#16A34A", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>⬇ PDF</a>}
            {onDelete && <button onClick={() => onDelete(dr.id)} style={{ background: "#FEF2F2", color: "#DC2626", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🗑</button>}
            <button onClick={onClose} style={{ background: "#F3F4F6", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>✕</button>
          </div>
        </div>

        <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: "#374151" }}>Weather: <strong>{dr.weather}{dr.temperature ? `, ${dr.temperature}` : ""}</strong></div>
          <div style={{ fontSize: 13, color: "#374151", marginTop: 2 }}>Prepared by: <strong>{dr.reporter_name}</strong></div>
          {dr.crew && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>Crew: {dr.crew}</div>}
          {dr.equipment && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>Equipment: {dr.equipment}</div>}
          {dr.visitors && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>Visitors: {dr.visitors}</div>}
        </div>

        <Block title="Work Completed" body={r.workSummary} />
        <Block title="Delays / Issues" body={r.delaysSummary} />
        <Block title="Plan for Tomorrow" body={r.tomorrowPlan} />
      </div>
    </div>
  );
}

function MonthlyRecordCard({ data, onClose }) {
  if (!data) return null;
  const { record, form, site, items } = data;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000080", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 640, marginTop: 8 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: "#4338CA" }}>{form?.title}</div>
            <div style={{ fontSize: 13, color: "#6B7280" }}>{site?.name} · {record.period_month}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {record.pdf_url && <a href={record.pdf_url} target="_blank" rel="noreferrer" style={{ background: "#4338CA", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>⬇ PDF</a>}
            <button onClick={onClose} style={{ background: "#F3F4F6", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>✕ Close</button>
          </div>
        </div>

        {record.ai_summary && (
          <div style={{ background: "#EEF2FF", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#4338CA", marginBottom: 4 }}>SUMMARY</div>
            <div style={{ fontSize: 14, color: "#374151" }}>{record.ai_summary}</div>
          </div>
        )}
        <div style={{ fontSize: 13, color: "#374151", marginBottom: 16 }}>Submitted by: <strong>{record.submitted_by}</strong></div>

        {items.map((it, i) => (
          <div key={it.id} style={{ border: `1.5px solid ${it.answer ? "#86EFAC" : "#FCA5A5"}`, background: it.answer ? "#F0FDF4" : "#FEF2F2", borderRadius: 10, padding: "10px 14px", marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#1E293B" }}>{i + 1}. {it.question_text}</div>
              <span style={{ fontSize: 12, fontWeight: 800, color: it.answer ? "#16A34A" : "#DC2626", flexShrink: 0, marginLeft: 8 }}>{it.answer ? "YES" : "NO"}</span>
            </div>
            {it.notes && <div style={{ fontSize: 13, color: "#374151", marginTop: 4, fontStyle: "italic" }}>{it.notes}</div>}
            {it.corrective_action && (
              <div style={{ fontSize: 12, marginTop: 6, color: it.corrective_action.status === "resolved" ? "#166534" : "#991B1B", fontWeight: 700 }}>
                {it.corrective_action.status === "resolved" ? "✓ Resolved" : "⚠ Open"}
                {it.corrective_action.responsible_name ? ` · ${it.corrective_action.responsible_name}` : ""}
                {it.corrective_action.target_date ? ` · Due ${it.corrective_action.target_date}` : ""}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CorrectiveActionRow({ ca, onUpdate }) {
  const [responsibleName, setResponsibleName] = useState(ca.responsible_name || "");
  const [targetDate, setTargetDate] = useState(ca.target_date || "");
  const [saving, setSaving] = useState(false);
  const isResolved = ca.status === "resolved";

  const save = async (newStatus) => {
    setSaving(true);
    await onUpdate(ca.id, { responsibleName, targetDate, status: newStatus });
    setSaving(false);
  };

  return (
    <div style={{ border: `1.5px solid ${isResolved ? "#86EFAC" : "#FCA5A5"}`, background: isResolved ? "#F0FDF4" : "#FEF2F2", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: "#1E293B", marginBottom: 2 }}>{ca.question_text}</div>
      <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>{ca.site_name} · {ca.period_month} · reported by {ca.submitted_by}</div>
      <div style={{ fontSize: 13, color: "#374151", marginBottom: 10, fontStyle: "italic" }}>{ca.description}</div>
      {isResolved ? (
        <div style={{ fontSize: 12, color: "#166534", fontWeight: 700 }}>
          ✓ Resolved by {ca.responsible_name || "—"} · {ca.resolved_at ? new Date(ca.resolved_at).toLocaleDateString("en-CA") : ""}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input placeholder="Responsible person" value={responsibleName} onChange={e => setResponsibleName(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 7, border: "1.5px solid #E2E8F0", fontSize: 13, outline: "none" }} />
            <input type="date" value={targetDate || ""} onChange={e => setTargetDate(e.target.value)} style={{ padding: "8px 10px", borderRadius: 7, border: "1.5px solid #E2E8F0", fontSize: 13, outline: "none" }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => save("open")} disabled={saving} style={{ flex: 1, background: "#F1F5F9", color: "#334155", border: "none", borderRadius: 8, padding: "9px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Save Assignment</button>
            <button onClick={() => save("resolved")} disabled={saving} style={{ flex: 1, background: "#16A34A", color: "#fff", border: "none", borderRadius: 8, padding: "9px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>✓ Mark Resolved</button>
          </div>
        </>
      )}
    </div>
  );
}

function EquipmentReportCard({ data, onClose, onGeneratePdf, generating }) {
  if (!data) return null;
  const { report, company } = data;
  const rj = report.report_json || {};
  const equipment = rj.equipment || [];
  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000080", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, overflowY: "auto" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 680, marginTop: 8 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: "#0369A1" }}>Weekly Equipment Usage</div>
            <div style={{ fontSize: 13, color: "#6B7280" }}>{rj.weekStart} to {rj.weekEnd} · {company?.name}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {report.pdf_url ? (
              <a href={report.pdf_url} target="_blank" rel="noreferrer" style={{ background: "#0369A1", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>⬇ PDF</a>
            ) : (
              <button onClick={() => onGeneratePdf(report)} disabled={generating} style={{ background: generating ? "#94A3B8" : "#0369A1", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                {generating ? "Generating…" : "📄 Generate PDF"}
              </button>
            )}
            <button onClick={onClose} style={{ background: "#F3F4F6", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>✕ Close</button>
          </div>
        </div>

        {equipment.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>No equipment activity recorded this week.</div>
        ) : (
          equipment.map((eq, i) => (
            <div key={i} style={{ border: "1.5px solid #E2E8F0", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#1E293B", marginBottom: 6 }}>{eq.equipmentLabel}</div>
              <div style={{ display: "flex", gap: 16, marginBottom: eq.issues.length > 0 || eq.noPostTripCount > 0 ? 8 : 0 }}>
                <div style={{ fontSize: 13, color: "#374151" }}>Used: <strong>{eq.usage > 0 ? `${eq.usage.toFixed(1)} ${eq.unit || ""}` : "—"}</strong></div>
                <div style={{ fontSize: 13, color: "#374151" }}>Ending reading: <strong>{eq.endingReading != null ? `${eq.endingReading} ${eq.unit || ""}` : "—"}</strong></div>
              </div>
              {eq.noPostTripCount > 0 && (
                <div style={{ fontSize: 12, color: "#D97706", fontWeight: 700, marginBottom: 4 }}>⚠ Currently checked out — no post-trip logged</div>
              )}
              {eq.issues.map((iss, j) => (
                <div key={j} style={{ fontSize: 12, color: "#DC2626", marginBottom: 2 }}>
                  • {iss.type}: {iss.note} <span style={{ color: "#9CA3AF" }}>({iss.worker}, {new Date(iss.date).toLocaleDateString("en-CA")})</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}


export default function Dashboard({ forcedCompanyId = null, isAdmin = false, onLogout = null, backLabel = "Exit", suspended = false, token = null }) {
  const [companies, setCompanies] = useState([]);
  const [flhas, setFlhas] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [toolboxTalks, setToolboxTalks] = useState([]);
  const [selectedToolbox, setSelectedToolbox] = useState(null);
  const [nearMisses, setNearMisses] = useState([]);
  const [selectedNearMiss, setSelectedNearMiss] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [dailyReports, setDailyReports] = useState([]);
  const [selectedDaily, setSelectedDaily] = useState(null);
  const [sops, setSops] = useState([]);
  const [selectedInspection, setSelectedInspection] = useState(null);
  const [monthlyRecords, setMonthlyRecords] = useState([]);
  const [monthlyActions, setMonthlyActions] = useState([]);
  const [selectedMonthlyRecord, setSelectedMonthlyRecord] = useState(null);
  const [monthlySubTab, setMonthlySubTab] = useState("records"); // records | actions
  const [equipmentReports, setEquipmentReports] = useState([]);
  const [loadingEquipmentReports, setLoadingEquipmentReports] = useState(false);
  const [selectedEquipmentReport, setSelectedEquipmentReport] = useState(null);
  const [generatingReportPdf, setGeneratingReportPdf] = useState(false);
  const [generatingNewReport, setGeneratingNewReport] = useState(false);
  const [equipmentReportsEnabled, setEquipmentReportsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [selectedFlha, setSelectedFlha] = useState(null);
  const [activeTab, setActiveTab] = useState("flhas");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sortBy, setSortBy] = useState("newest");
  const [dateFilter, setDateFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState("none");

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const exportSelected = () => {
    const toExport = companyFlhas.filter(f => selectedIds.has(f.id) && f.pdf_url);
    if (!toExport.length) {
      alert("No PDFs available for selected FLHAs. PDFs are only generated for FLHAs submitted after this feature was added.");
      return;
    }
    toExport.forEach((f, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = f.pdf_url;
        a.target = "_blank";
        a.download = `FLHA_${f.worker_name}_${new Date(f.created_at).toLocaleDateString("en-CA")}.pdf`;
        a.click();
      }, i * 500); // stagger downloads
    });
    setSelectedIds(new Set());
  };

  const deleteFlha = async (id, workerName) => {
    if (!window.confirm(`Delete the FLHA for ${workerName || "this worker"}? This cannot be undone.`)) return;
    try {
      await fetch("/api/flhas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", token, ids: [id] }),
      });
    } catch (e) { /* leave list as-is if the request fails */ }
    setFlhas(prev => prev.filter(f => f.id !== id));
    setSelectedFlha(null);
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const approveFLHA = async (record, supName, supSignature) => {
    const now = new Date();
    const co = companies.find(c => c.id === record.company_id);
    let pdfUrl = record.pdf_url;
    try {
      pdfUrl = await generateAndUploadFLHA({
        flha: record.hazards_json,
        workerName: record.worker_name,
        jobSite: record.job_site,
        signName: record.worker_name,
        companyName: co?.name || "",
        signatureDataUrl: record.worker_signature || null,
        companyLogo: co?.logo_url || "",
        amendedNote: null,
        pendingApproval: false,
        supervisorApproval: { name: supName, date: now.toLocaleString("en-CA"), signature: supSignature },
      });
    } catch (e) { /* keep old pdf if regen fails */ }

    try {
      await fetch("/api/flhas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", token, id: record.id, supName, supSignature, pdfUrl: pdfUrl || record.pdf_url }),
      });
    } catch (e) { /* keep local state updated even if the request fails */ }

    setFlhas(prev => prev.map(f => f.id === record.id
      ? { ...f, status: "complete", supervisor_signed_by: supName, supervisor_signed_at: now.toISOString(), pdf_url: pdfUrl || f.pdf_url }
      : f));
    setSelectedFlha(null);
  };

  const deleteSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} selected FLHA${ids.length > 1 ? "s" : ""}? This cannot be undone.`)) return;
    try {
      await fetch("/api/flhas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", token, ids }),
      });
    } catch (e) { /* leave list as-is if the request fails */ }
    setFlhas(prev => prev.filter(f => !selectedIds.has(f.id)));
    setSelectedIds(new Set());
  };

  useEffect(() => {
    async function loadAll() {
      const { data: cos } = await supabase.from("companies").select("*");

      const visibleCompaniesRaw = forcedCompanyId
        ? (cos || []).filter(c => c.id === forcedCompanyId)
        : (cos || []);

      // SOPs — via protected endpoint, one call per visible company (there
      // are only ever a handful of companies for a supervisor/admin view).
      let ss = [];
      try {
        const sopResults = await Promise.all(visibleCompaniesRaw.map(async (c) => {
          try {
            const res = await fetch("/api/companydata", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "list_sops", token, companyId: c.id }),
            });
            const data = await res.json();
            if (res.ok) return (data.sops || []).map(s => ({ ...s, company_id: c.id }));
            return [];
          } catch (e) { return []; }
        }));
        ss = sopResults.flat();
      } catch (e) { /* leave ss empty if the request fails */ }

      let fs = [];
      try {
        const flhaRes = await fetch("/api/flhas", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list", token }),
        });
        const flhaData = await flhaRes.json();
        if (flhaRes.ok) fs = flhaData.flhas || [];
      } catch (e) { /* leave fs empty if the request fails */ }

      let nm = [];
      try {
        const nmRes = await fetch("/api/reports", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "nearmiss", action: "list", token }),
        });
        const nmData = await nmRes.json();
        if (nmRes.ok) nm = nmData.records || [];
      } catch (e) { /* leave nm empty if the request fails */ }

      let inc = [];
      try {
        const incRes = await fetch("/api/reports", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "incident", action: "list", token }),
        });
        const incData = await incRes.json();
        if (incRes.ok) inc = incData.records || [];
      } catch (e) { /* leave inc empty if the request fails */ }

      let insp = [];
      try {
        const inspRes = await fetch("/api/logs", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "inspection", action: "list", token }),
        });
        const inspData = await inspRes.json();
        if (inspRes.ok) insp = inspData.records || [];
      } catch (e) { /* leave insp empty if the request fails */ }

      let tbt = [];
      try {
        const tbtRes = await fetch("/api/logs", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "toolbox", action: "list", token }),
        });
        const tbtData = await tbtRes.json();
        if (tbtRes.ok) tbt = tbtData.records || [];
      } catch (e) { /* leave tbt empty if the request fails */ }

      let dr = [];
      try {
        const drRes = await fetch("/api/logs", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "daily", action: "list", token }),
        });
        const drData = await drRes.json();
        if (drRes.ok) dr = drData.records || [];
      } catch (e) { /* leave dr empty if the request fails */ }

      let mr = [];
      try {
        const mrRes = await fetch("/api/monthly", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_records", token }),
        });
        const mrData = await mrRes.json();
        if (mrRes.ok) mr = mrData.records || [];
      } catch (e) { /* leave mr empty if the request fails */ }

      let ma = [];
      try {
        const maRes = await fetch("/api/monthly", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_corrective_actions", token }),
        });
        const maData = await maRes.json();
        if (maRes.ok) ma = maData.actions || [];
      } catch (e) { /* leave ma empty if the request fails */ }

      setCompanies(visibleCompaniesRaw);
      setFlhas(fs);
      setInspections(insp);
      setToolboxTalks(tbt);
      setNearMisses(nm);
      setIncidents(inc);
      setDailyReports(dr);
      setMonthlyRecords(mr);
      setMonthlyActions(ma);
      setSops(ss || []);
      if (visibleCompaniesRaw.length) setSelectedCompany(visibleCompaniesRaw[0].id);
      setLoading(false);
    }
    loadAll();
  }, [forcedCompanyId, token]);

  // Check whether Weekly Equipment Reports is turned on for the selected
  // company, so the Equipment tab only shows up when an admin has it active.
  useEffect(() => {
    async function checkEquipmentReportsToggle() {
      if (!selectedCompany) return;
      try {
        const res = await fetch("/api/customforms", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_document_settings", token, companyId: selectedCompany }),
        });
        const data = await res.json();
        if (res.ok) {
          const entry = (data.documents || []).find(d => d.key === "equipment_reports");
          setEquipmentReportsEnabled(entry ? entry.isActive : true);
          if (entry && !entry.isActive && activeTab === "equipment") setActiveTab("flhas");
        }
      } catch (e) { /* default to shown if the check fails */ }
    }
    checkEquipmentReportsToggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany, token]);

  // Load equipment reports for the selected company whenever that tab is opened or the company changes.
  useEffect(() => {
    async function loadEquipmentReports() {
      if (activeTab !== "equipment" || !selectedCompany) return;
      setLoadingEquipmentReports(true);
      try {
        const res = await fetch("/api/equipmentreports", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_reports", token, companyId: selectedCompany }),
        });
        const data = await res.json();
        if (res.ok) setEquipmentReports(data.reports || []);
      } catch (e) { /* leave list as-is if the request fails */ }
      setLoadingEquipmentReports(false);
    }
    loadEquipmentReports();
  }, [activeTab, selectedCompany, token]);

  const openEquipmentReport = async (report) => {
    try {
      const res = await fetch("/api/equipmentreports", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_report", token, reportId: report.id }),
      });
      const data = await res.json();
      if (res.ok) setSelectedEquipmentReport(data);
    } catch (e) { /* ignore */ }
  };

  const generateReportPdf = async (report) => {
    setGeneratingReportPdf(true);
    try {
      const co = companies.find(c => c.id === report.company_id) || selectedEquipmentReport?.company;
      const pdfUrl = await generateAndUploadEquipmentReport({
        report, companyName: co?.name || "", companyLogo: co?.logo_url || "",
      });
      if (pdfUrl) {
        await fetch("/api/equipmentreports", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save_pdf_url", token, reportId: report.id, pdfUrl }),
        });
        setSelectedEquipmentReport(prev => prev ? { ...prev, report: { ...prev.report, pdf_url: pdfUrl } } : prev);
        setEquipmentReports(prev => prev.map(r => r.id === report.id ? { ...r, pdf_url: pdfUrl } : r));
      }
          } catch (e) { setEquipmentPdfError(e.message || "Something went wrong."); }
    setGeneratingReportPdf(false);
  };

  const generateThisWeeksReport = async () => {
    if (!selectedCompany) return;
    setGeneratingNewReport(true);
    try {
      const res = await fetch("/api/equipmentreports", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_now", token, companyId: selectedCompany }),
      });
      const data = await res.json();
      if (res.ok) {
        setEquipmentReports(prev => {
          const filtered = prev.filter(r => r.week_start !== data.report.week_start);
          return [{ id: data.report.id, week_start: data.report.week_start, week_end: data.report.week_end, pdf_url: data.report.pdf_url, generated_by: data.report.generated_by, created_at: data.report.created_at }, ...filtered]
            .sort((a, b) => new Date(b.week_start) - new Date(a.week_start));
        });
      }
    } catch (e) { /* ignore */ }
    setGeneratingNewReport(false);
  };

  const company = companies.find(c => c.id === selectedCompany);
  const companyFlhas = flhas.filter(f => f.company_id === selectedCompany);
  const companyInspections = inspections.filter(i => i.company_id === selectedCompany);
  const companyToolbox = toolboxTalks.filter(t => t.company_id === selectedCompany);
  const companyNearMisses = nearMisses.filter(n => n.company_id === selectedCompany);
  const companyIncidents = incidents.filter(n => n.company_id === selectedCompany);
  const companyDaily = dailyReports.filter(d => d.company_id === selectedCompany);
  const companyMonthlyRecords = monthlyRecords.filter(r => r.company_id === selectedCompany);
  const companyMonthlyActions = monthlyActions.filter(a => a.company_id === selectedCompany);

  const deleteDaily = async (id) => {
    if (!window.confirm("Delete this daily report? This cannot be undone.")) return;
    try {
      await fetch("/api/logs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "daily", action: "delete", token, id }),
      });
    } catch (e) { /* leave list as-is if the request fails */ }
    setDailyReports(prev => prev.filter(d => d.id !== id));
    setSelectedDaily(null);
  };

  const openMonthlyRecord = async (record) => {
    try {
      const res = await fetch("/api/monthly", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_record_detail", token, recordId: record.id }),
      });
      const data = await res.json();
      if (res.ok) setSelectedMonthlyRecord(data);
    } catch (e) { /* ignore */ }
  };

  const updateCorrectiveAction = async (actionId, { responsibleName, targetDate, status }) => {
    try {
      const res = await fetch("/api/monthly", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_corrective_action", token, actionId, responsibleName, targetDate, status }),
      });
      const data = await res.json();
      if (res.ok) {
        setMonthlyActions(prev => prev.map(a => a.id === actionId
          ? { ...a, responsible_name: responsibleName, target_date: targetDate, status, resolved_at: status === "resolved" ? new Date().toISOString() : null }
          : a));
      }
    } catch (e) { /* ignore */ }
  };

  const awaitingSignOff = companyFlhas.filter(f => f.status === "pending_approval").length;
  const needsReview = companyNearMisses.filter(n => !n.reviewed).length + companyIncidents.filter(n => !n.reviewed).length;
  const incidentCount = companyIncidents.length;
  const startOfWeek = (() => { const d = new Date(); const day = d.getDay(); d.setDate(d.getDate() - day); d.setHours(0, 0, 0, 0); return d; })();
  const docsThisWeek = [
    ...companyFlhas, ...companyInspections, ...companyToolbox, ...companyNearMisses, ...companyIncidents, ...companyDaily, ...companyMonthlyRecords,
  ].filter(x => x.created_at && new Date(x.created_at) >= startOfWeek).length;
  const openCorrectiveCount = companyMonthlyActions.filter(a => a.status !== "resolved").length;

  const reviewNearMiss = async (id, notes) => {
    try {
      const res = await fetch("/api/reports", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "nearmiss", action: "review", token, id, notes }),
      });
      const data = await res.json();
      if (res.ok) {
        setNearMisses(prev => prev.map(n => n.id === id
          ? { ...n, reviewed: true, reviewed_by: data.reviewed_by, reviewed_at: data.reviewed_at, review_notes: notes || null }
          : n));
      }
    } catch (e) { /* leave as-is if the request fails */ }
    setSelectedNearMiss(null);
  };

  const reviewIncident = async (id, notes) => {
    try {
      const res = await fetch("/api/reports", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "incident", action: "review", token, id, notes }),
      });
      const data = await res.json();
      if (res.ok) {
        setIncidents(prev => prev.map(n => n.id === id
          ? { ...n, reviewed: true, reviewed_by: data.reviewed_by, reviewed_at: data.reviewed_at, review_notes: notes || null }
          : n));
      }
    } catch (e) { /* leave as-is if the request fails */ }
    setSelectedIncident(null);
  };

  const deleteIncident = async (id) => {
    if (!window.confirm("Delete this incident report? This cannot be undone.")) return;
    try {
      await fetch("/api/reports", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "incident", action: "delete", token, id }),
      });
    } catch (e) { /* leave list as-is if the request fails */ }
    setIncidents(prev => prev.filter(n => n.id !== id));
    setSelectedIncident(null);
  };

  const companySops = sops.filter(s => s.company_id === selectedCompany);

  const deleteInspection = async (id, workerName) => {
    if (!window.confirm(`Delete the inspection by ${workerName || "this worker"}? This cannot be undone.`)) return;
    try {
      await fetch("/api/logs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "inspection", action: "delete", token, id }),
      });
    } catch (e) { /* leave list as-is if the request fails */ }
    setInspections(prev => prev.filter(i => i.id !== id));
    setSelectedInspection(null);
  };

  const deleteToolbox = async (id) => {
    if (!window.confirm("Delete this toolbox talk? This cannot be undone.")) return;
    try {
      await fetch("/api/logs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "toolbox", action: "delete", token, id }),
      });
    } catch (e) { /* leave list as-is if the request fails */ }
    setToolboxTalks(prev => prev.filter(t => t.id !== id));
    setSelectedToolbox(null);
  };

  const deleteNearMiss = async (id) => {
    if (!window.confirm("Delete this near miss report? This cannot be undone.")) return;
    try {
      await fetch("/api/reports", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "nearmiss", action: "delete", token, id }),
      });
    } catch (e) { /* leave list as-is if the request fails */ }
    setNearMisses(prev => prev.filter(n => n.id !== id));
    setSelectedNearMiss(null);
  };

  const riskRank = (f) => {
    const hz = f.hazards_json?.hazards || [];
    if (hz.some(h => h.risk === "Extreme")) return 4;
    if (hz.some(h => h.risk === "High")) return 3;
    if (hz.some(h => h.risk === "Medium")) return 2;
    return 1;
  };

  const now = new Date();
  const inDateRange = (f) => {
    if (dateFilter === "all") return true;
    const d = new Date(f.created_at);
    const diffDays = (now - d) / (1000 * 60 * 60 * 24);
    if (dateFilter === "today") return d.toDateString() === now.toDateString();
    if (dateFilter === "week") return diffDays <= 7;
    if (dateFilter === "month") return diffDays <= 31;
    return true;
  };

  const matchesSearch = (f) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (f.worker_name || "").toLowerCase().includes(q) ||
           (f.job_site || "").toLowerCase().includes(q);
  };

  let processedFlhas = companyFlhas.filter(f => inDateRange(f) && matchesSearch(f));

  processedFlhas = [...processedFlhas].sort((a, b) => {
    switch (sortBy) {
      case "oldest": return new Date(a.created_at) - new Date(b.created_at);
      case "worker": return (a.worker_name || "").localeCompare(b.worker_name || "");
      case "site": return (a.job_site || "").localeCompare(b.job_site || "");
      case "risk": return riskRank(b) - riskRank(a);
      case "newest":
      default: return new Date(b.created_at) - new Date(a.created_at);
    }
  });

  const grouped = {};
  if (groupBy === "none") {
    grouped["All Assessments"] = processedFlhas;
  } else {
    processedFlhas.forEach(f => {
      const key = groupBy === "site" ? (f.job_site || "No location") : (f.worker_name || "Unknown worker");
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(f);
    });
  }

  const highRiskCount = companyFlhas.filter(f => {
    const hazards = f.hazards_json?.hazards || [];
    return hazards.some(h => h.risk === "High");
  }).length;

  const styles = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#F0F4F8", minHeight: "100vh" },
    header: {
      background: "linear-gradient(135deg,#1E3A5F,#2D5F8A)",
      padding: "16px 20px", color: "#fff",
      display: "flex", justifyContent: "space-between", alignItems: "center"
    },
    card: { background: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 4px #0001" },
    stat: (accent) => ({
      background: "#fff", borderRadius: 12, padding: "14px 16px",
      borderLeft: `4px solid ${accent}`, boxShadow: "0 1px 4px #0001"
    }),
    tab: (active) => ({
      padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14,
      background: active ? "#1E3A5F" : "transparent", color: active ? "#fff" : "#6B7280"
    }),
    flhaRow: { padding: "12px 14px", borderBottom: "1px solid #F3F4F6", cursor: "pointer" },
    select: { flex: "1 1 auto", minWidth: 0, padding: "8px 10px", borderRadius: 8, border: "1.5px solid #E5E7EB", fontSize: 13, background: "#fff", color: "#374151", cursor: "pointer", outline: "none" },
  };

  if (loading) return (
    <div style={{ ...styles.wrap, display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <div style={{ textAlign: "center", color: "#6B7280" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
        Loading dashboard...
      </div>
    </div>
  );

  return (
    <div style={styles.wrap}>
      {selectedFlha && <FLHACard flha={selectedFlha} onClose={() => setSelectedFlha(null)} onDelete={deleteFlha} onApprove={approveFLHA} />}
      {selectedInspection && <InspectionCard insp={selectedInspection} onClose={() => setSelectedInspection(null)} onDelete={deleteInspection} />}
      {selectedToolbox && <ToolboxCard talk={selectedToolbox} onClose={() => setSelectedToolbox(null)} onDelete={deleteToolbox} />}
      {selectedNearMiss && <NearMissCard nm={selectedNearMiss} onClose={() => setSelectedNearMiss(null)} onDelete={deleteNearMiss} onReview={reviewNearMiss} />}
      {selectedIncident && <IncidentCard inc={selectedIncident} onClose={() => setSelectedIncident(null)} onDelete={deleteIncident} onReview={reviewIncident} />}
      {selectedDaily && <DailyCard dr={selectedDaily} onClose={() => setSelectedDaily(null)} onDelete={deleteDaily} />}
      {selectedMonthlyRecord && <MonthlyRecordCard data={selectedMonthlyRecord} onClose={() => setSelectedMonthlyRecord(null)} />}
      {selectedEquipmentReport && <EquipmentReportCard data={selectedEquipmentReport} onClose={() => setSelectedEquipmentReport(null)} onGeneratePdf={generateReportPdf} generating={generatingReportPdf} />}

      <div style={styles.header}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>FORA Dashboard</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>{isAdmin ? "Admin View — All Companies" : "Supervisor View"}</div>
        </div>
        {onLogout && (
          <button onClick={onLogout} style={{ color: "#fff", fontSize: 13, border: "none", background: "#ffffff20", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
            {backLabel}
          </button>
        )}
      </div>

      <div style={{ padding: 16 }}>

        {suspended && (
          <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#991B1B", marginBottom: 2 }}>⚠️ Account suspended</div>
            <div style={{ fontSize: 13, color: "#B91C1C" }}>Your company's access is currently suspended. You can still view and export existing records, but workers cannot submit new FLHAs. Please contact your administrator.</div>
          </div>
        )}

        {isAdmin && companies.length > 1 && (
          <div style={styles.card}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 8 }}>COMPANY</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {companies.map(c => (
                <button key={c.id} onClick={() => setSelectedCompany(c.id)} style={{
                  padding: "8px 14px", borderRadius: 8, border: "1.5px solid",
                  borderColor: selectedCompany === c.id ? "#1E3A5F" : "#E5E7EB",
                  background: selectedCompany === c.id ? "#1E3A5F" : "#fff",
                  color: selectedCompany === c.id ? "#fff" : "#374151",
                  fontWeight: 600, fontSize: 14, cursor: "pointer"
                }}>{c.name}</button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div onClick={() => setActiveTab("flhas")} style={{ background: awaitingSignOff > 0 ? "#7F1D1D" : "#fff", borderRadius: 12, padding: "14px 16px", cursor: "pointer", boxShadow: "0 1px 3px #0f172a12", border: awaitingSignOff > 0 ? "none" : "1px solid #F1F5F9" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: awaitingSignOff > 0 ? "#fff" : "#94A3B8" }}>{awaitingSignOff}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: awaitingSignOff > 0 ? "#FECACA" : "#6B7280", textTransform: "uppercase", letterSpacing: 0.3 }}>🛑 Awaiting Sign-Off</div>
          </div>
          <div onClick={() => setActiveTab(companyIncidents.filter(n => !n.reviewed).length > 0 ? "incident" : "nearmiss")} style={{ background: needsReview > 0 ? "#B45309" : "#fff", borderRadius: 12, padding: "14px 16px", cursor: "pointer", boxShadow: "0 1px 3px #0f172a12", border: needsReview > 0 ? "none" : "1px solid #F1F5F9" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: needsReview > 0 ? "#fff" : "#94A3B8" }}>{needsReview}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: needsReview > 0 ? "#FEF3C7" : "#6B7280", textTransform: "uppercase", letterSpacing: 0.3 }}>🚩 Needs Review</div>
          </div>
          <div onClick={() => { setActiveTab("monthly"); setMonthlySubTab("actions"); }} style={{ background: openCorrectiveCount > 0 ? "#4338CA" : "#fff", borderRadius: 12, padding: "14px 16px", cursor: "pointer", boxShadow: "0 1px 3px #0f172a12", border: openCorrectiveCount > 0 ? "none" : "1px solid #F1F5F9" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: openCorrectiveCount > 0 ? "#fff" : "#94A3B8" }}>{openCorrectiveCount}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: openCorrectiveCount > 0 ? "#E0E7FF" : "#6B7280", textTransform: "uppercase", letterSpacing: 0.3 }}>🗓️ Open Corrective Actions</div>
          </div>
          <div style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 3px #0f172a12", border: "1px solid #F1F5F9" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#1E3A5F" }}>{docsThisWeek}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.3 }}>📄 Docs This Week</div>
          </div>
        </div>

        <div style={{ ...styles.card, padding: "8px 10px", display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
          <button style={styles.tab(activeTab === "flhas")} onClick={() => setActiveTab("flhas")}>📋 FLHAs</button>
          <button style={styles.tab(activeTab === "inspections")} onClick={() => setActiveTab("inspections")}>🚜 Inspections</button>
          <button style={styles.tab(activeTab === "toolbox")} onClick={() => setActiveTab("toolbox")}>🧰 Toolbox Talks</button>
          <button style={styles.tab(activeTab === "nearmiss")} onClick={() => setActiveTab("nearmiss")}>
            ⚠️ Near Misses{companyNearMisses.filter(n => !n.reviewed).length > 0 ? ` (${companyNearMisses.filter(n => !n.reviewed).length})` : ""}
          </button>
          <button style={styles.tab(activeTab === "incident")} onClick={() => setActiveTab("incident")}>
            🚑 Incidents{companyIncidents.filter(n => !n.reviewed).length > 0 ? ` (${companyIncidents.filter(n => !n.reviewed).length})` : ""}
          </button>
          <button style={styles.tab(activeTab === "daily")} onClick={() => setActiveTab("daily")}>📋 Daily</button>
          <button style={styles.tab(activeTab === "monthly")} onClick={() => setActiveTab("monthly")}>
            🗓️ Monthly{openCorrectiveCount > 0 ? ` (${openCorrectiveCount})` : ""}
          </button>
          {equipmentReportsEnabled && (
            <button style={styles.tab(activeTab === "equipment")} onClick={() => setActiveTab("equipment")}>🔧 Equipment</button>
          )}
          <button style={styles.tab(activeTab === "sops")} onClick={() => setActiveTab("sops")}>📄 SOPs</button>
        </div>

        {activeTab === "flhas" && (
          <div style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F" }}>
                  {company?.name} — Field Assessments
                </div>
                <div style={{ fontSize: 13, color: "#6B7280" }}>
                  {processedFlhas.length} of {companyFlhas.length} shown
                </div>
              </div>
              {selectedIds.size > 0 && (
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button onClick={exportSelected} style={{
                    background: "#F97316", color: "#fff", border: "none", borderRadius: 8,
                    padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer"
                  }}>⬇ {selectedIds.size} PDF{selectedIds.size > 1 ? "s" : ""}</button>
                  <button onClick={deleteSelected} style={{
                    background: "#FEF2F2", color: "#DC2626", border: "1.5px solid #FCA5A5", borderRadius: 8,
                    padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer"
                  }}>🗑 Delete</button>
                </div>
              )}
            </div>

            <input
              style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #E5E7EB", fontSize: 14, boxSizing: "border-box", marginBottom: 10, outline: "none" }}
              placeholder="🔍 Search worker or site…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={styles.select}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="worker">Worker (A–Z)</option>
                <option value="site">Site (A–Z)</option>
                <option value="risk">Highest risk</option>
              </select>
              <select value={dateFilter} onChange={e => setDateFilter(e.target.value)} style={styles.select}>
                <option value="all">All time</option>
                <option value="today">Today</option>
                <option value="week">Past 7 days</option>
                <option value="month">Past 31 days</option>
              </select>
              <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={styles.select}>
                <option value="none">No grouping</option>
                <option value="site">Group by site</option>
                <option value="worker">Group by worker</option>
              </select>
            </div>

            {processedFlhas.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                {companyFlhas.length === 0 ? "No FLHAs submitted yet for this company." : "No FLHAs match your filters."}
              </div>
            ) : (
              Object.entries(grouped).map(([groupName, groupFlhas]) => (
                <div key={groupName} style={{ marginBottom: groupBy === "none" ? 0 : 12 }}>
                  {groupBy !== "none" && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#7C3AED", background: "#F5F3FF", padding: "6px 10px", borderRadius: 6, marginBottom: 4, marginTop: 8 }}>
                      {groupBy === "site" ? "📍" : "👷"} {groupName} ({groupFlhas.length})
                    </div>
                  )}
                  {groupFlhas.map((f, i) => {
                    const hazards = f.hazards_json?.hazards || [];
                    const extremeRisk = hazards.filter(h => h.risk === "Extreme").length;
                    const highRisk = hazards.filter(h => h.risk === "High").length;
                    const medRisk = hazards.filter(h => h.risk === "Medium").length;
                    return (
                      <div key={f.id} style={{
                        ...styles.flhaRow,
                        borderBottom: i < groupFlhas.length - 1 ? "1px solid #F3F4F6" : "none",
                        display: "flex", alignItems: "flex-start", gap: 10,
                        background: selectedIds.has(f.id) ? "#F0F9FF" : "transparent"
                      }}>
                        <input type="checkbox" checked={selectedIds.has(f.id)}
                          onChange={() => toggleSelect(f.id)}
                          style={{ marginTop: 4, flexShrink: 0, width: 16, height: 16, cursor: "pointer" }}
                          onClick={e => e.stopPropagation()}
                        />
                        <div style={{ flex: 1 }} onClick={() => setSelectedFlha(f)}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 14, color: "#1E3A5F" }}>{f.worker_name || "Unknown Worker"}</div>
                              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>📍 {f.job_site || "No location"}</div>
                              <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>
                                {new Date(f.created_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
                              </div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                              {f.status === "pending_approval" && <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: "#7F1D1D", padding: "3px 9px", borderRadius: 20 }}>NEEDS SIGN-OFF</span>}
                              {extremeRisk > 0 && <RiskBadge risk="Extreme" />}
                              {highRisk > 0 && <RiskBadge risk="High" />}
                              {medRisk > 0 && <RiskBadge risk="Medium" />}
                              {extremeRisk === 0 && highRisk === 0 && medRisk === 0 && <RiskBadge risk="Low" />}
                              <div style={{ fontSize: 11, color: f.pdf_url ? "#F97316" : "#9CA3AF" }}>
                                {f.pdf_url ? "📄 PDF ready" : "No PDF"} · {hazards.length} hazards →
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "inspections" && (
          <div style={styles.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 4 }}>
              {company?.name} — Equipment Inspections
            </div>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>Tap any row to view the full inspection.</div>
            {companyInspections.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🚜</div>
                No inspections submitted yet.
              </div>
            ) : (
              companyInspections.map((insp, i) => {
                const r = insp.results_json || {};
                const isPost = insp.trip_type === "posttrip";
                const def = r.defectiveCount || 0;
                const mon = r.monitorCount || 0;
                return (
                  <div key={insp.id} style={{
                    padding: "12px 14px", borderBottom: i < companyInspections.length - 1 ? "1px solid #F3F4F6" : "none",
                    cursor: "pointer"
                  }} onClick={() => setSelectedInspection(insp)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#1E3A5F" }}>{insp.equipment_label || "Equipment"}</div>
                          <span style={{ fontSize: 9, fontWeight: 800, color: isPost ? "#7C3AED" : "#0369A1", background: isPost ? "#F3E8FF" : "#EFF6FF", padding: "2px 6px", borderRadius: 20 }}>{isPost ? "POST" : "PRE"}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>👷 {insp.worker_name || "Unknown"}</div>
                        {(insp.start_reading || insp.end_reading) && (
                          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
                            {insp.start_reading ? `${insp.start_reading}` : "—"}{insp.end_reading ? ` → ${insp.end_reading}` : ""} {insp.reading_unit}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>
                          {new Date(insp.created_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                        {def > 0
                          ? <span style={{ fontSize: 11, fontWeight: 700, color: "#DC2626", background: "#FEF2F2", padding: "3px 9px", borderRadius: 20 }}>{def} defective</span>
                          : mon > 0
                            ? <span style={{ fontSize: 11, fontWeight: 700, color: "#D97706", background: "#FFFBEB", padding: "3px 9px", borderRadius: 20 }}>{mon} monitor</span>
                            : <span style={{ fontSize: 11, fontWeight: 700, color: "#16A34A", background: "#F0FDF4", padding: "3px 9px", borderRadius: 20 }}>All good</span>}
                        <div style={{ fontSize: 11, color: insp.pdf_url ? "#0369A1" : "#9CA3AF" }}>
                          {insp.pdf_url ? "📄 PDF ready" : "No PDF"} →
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === "toolbox" && (
          <div style={styles.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 4 }}>
              {company?.name} — Toolbox Talks
            </div>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>Tap any meeting to view the talk and attendance.</div>
            {companyToolbox.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🧰</div>
                No toolbox talks recorded yet.
              </div>
            ) : (
              companyToolbox.map((t, i) => {
                const attendees = t.attendees_json || [];
                return (
                  <div key={t.id} style={{
                    padding: "12px 14px", borderBottom: i < companyToolbox.length - 1 ? "1px solid #F3F4F6" : "none",
                    cursor: "pointer"
                  }} onClick={() => setSelectedToolbox(t)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", background: "#F3E8FF", padding: "2px 8px", borderRadius: 20 }}>{t.meeting_type}</span>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#1E3A5F" }}>{t.site}</div>
                        </div>
                        <div style={{ fontSize: 13, color: "#374151", marginTop: 4 }}>{t.talking_points_json?.summary || t.topic}</div>
                        <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>🎤 {t.presenter_name} · 👥 {attendees.length} signed</div>
                        <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>
                          {new Date(t.created_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: t.pdf_url ? "#7C3AED" : "#9CA3AF" }}>
                        {t.pdf_url ? "📄 PDF" : "No PDF"} →
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === "nearmiss" && (
          <div style={styles.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 12 }}>
              {company?.name} — Near Miss Reports
            </div>
            {companyNearMisses.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
                No near miss reports yet.
              </div>
            ) : (
              <>
                {companyNearMisses.filter(n => !n.reviewed).length > 0 && (
                  <>
                    <div style={{ background: "#B45309", color: "#fff", borderRadius: 10, padding: "12px 16px", marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 22 }}>🚩</span>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 800 }}>{companyNearMisses.filter(n => !n.reviewed).length} Awaiting Review</div>
                        <div style={{ fontSize: 12, opacity: 0.9 }}>Tap to review and record action taken</div>
                      </div>
                    </div>
                    <div style={{ background: "#FFFBEB", borderRadius: 10, border: "1.5px solid #FDE68A", padding: "4px 12px", marginBottom: 20 }}>
                      {companyNearMisses.filter(n => !n.reviewed).map((n, i, arr) => (
                        <ReportRow key={n.id} rec={n} last={i === arr.length - 1} onClick={() => setSelectedNearMiss(n)} kind="nearmiss" />
                      ))}
                    </div>
                  </>
                )}
                {companyNearMisses.filter(n => n.reviewed).length > 0 && (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Reviewed</div>
                    {companyNearMisses.filter(n => n.reviewed).map((n, i, arr) => (
                      <ReportRow key={n.id} rec={n} last={i === arr.length - 1} onClick={() => setSelectedNearMiss(n)} kind="nearmiss" />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === "incident" && (
          <div style={styles.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 12 }}>
              {company?.name} — Incident Reports
            </div>
            {companyIncidents.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🚑</div>
                No incident reports yet.
              </div>
            ) : (
              <>
                {companyIncidents.filter(n => !n.reviewed).length > 0 && (
                  <>
                    <div style={{ background: "#991B1B", color: "#fff", borderRadius: 10, padding: "12px 16px", marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 22 }}>🚩</span>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 800 }}>{companyIncidents.filter(n => !n.reviewed).length} Awaiting Review</div>
                        <div style={{ fontSize: 12, opacity: 0.9 }}>Incident reports require your review — tap to record action taken</div>
                      </div>
                    </div>
                    <div style={{ background: "#FEF2F2", borderRadius: 10, border: "1.5px solid #FCA5A5", padding: "4px 12px", marginBottom: 20 }}>
                      {companyIncidents.filter(n => !n.reviewed).map((n, i, arr) => (
                        <ReportRow key={n.id} rec={n} last={i === arr.length - 1} onClick={() => setSelectedIncident(n)} kind="incident" />
                      ))}
                    </div>
                  </>
                )}
                {companyIncidents.filter(n => n.reviewed).length > 0 && (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Reviewed</div>
                    {companyIncidents.filter(n => n.reviewed).map((n, i, arr) => (
                      <ReportRow key={n.id} rec={n} last={i === arr.length - 1} onClick={() => setSelectedIncident(n)} kind="incident" />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === "daily" && (
          <div style={styles.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 4 }}>
              {company?.name} — Daily Reports
            </div>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>Tap any report to view the full day's summary.</div>
            {companyDaily.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                No daily reports yet.
              </div>
            ) : (
              companyDaily.map((d, i) => {
                const r = d.report_json || {};
                return (
                  <div key={d.id} style={{
                    padding: "12px 14px", borderBottom: i < companyDaily.length - 1 ? "1px solid #F3F4F6" : "none",
                    cursor: "pointer"
                  }} onClick={() => setSelectedDaily(d)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1, paddingRight: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#1E3A5F" }}>{d.report_date}</div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#15803D", background: "#F0FDF4", padding: "2px 8px", borderRadius: 20 }}>{d.weather}{d.temperature ? `, ${d.temperature}` : ""}</span>
                        </div>
                        <div style={{ fontSize: 13, color: "#374151", marginTop: 3 }}>{r.workSummary ? (r.workSummary.length > 90 ? r.workSummary.slice(0, 90) + "…" : r.workSummary) : d.site}</div>
                        <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>📍 {d.site} · {d.reporter_name}</div>
                      </div>
                      <div style={{ fontSize: 11, color: d.pdf_url ? "#16A34A" : "#9CA3AF", flexShrink: 0 }}>
                        {d.pdf_url ? "📄 PDF" : ""} →
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === "monthly" && (
          <>
            <div style={{ ...styles.card, padding: "8px 10px", display: "flex", gap: 4 }}>
              <button style={styles.tab(monthlySubTab === "records")} onClick={() => setMonthlySubTab("records")}>Submissions</button>
              <button style={styles.tab(monthlySubTab === "actions")} onClick={() => setMonthlySubTab("actions")}>
                Corrective Actions{companyMonthlyActions.filter(a => a.status !== "resolved").length > 0 ? ` (${companyMonthlyActions.filter(a => a.status !== "resolved").length})` : ""}
              </button>
            </div>

            {monthlySubTab === "records" && (
              <div style={styles.card}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 4 }}>
                  {company?.name} — Monthly Inspections
                </div>
                <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>Tap any submission to view full details.</div>
                {companyMonthlyRecords.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🗓️</div>
                    No monthly inspections submitted yet.
                  </div>
                ) : (
                  companyMonthlyRecords.map((r, i) => (
                    <div key={r.id} style={{
                      padding: "12px 14px", borderBottom: i < companyMonthlyRecords.length - 1 ? "1px solid #F3F4F6" : "none",
                      cursor: "pointer"
                    }} onClick={() => openMonthlyRecord(r)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1, paddingRight: 10 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#1E3A5F" }}>{r.form_title}</div>
                          <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>📍 {r.site_name} · {r.period_month}</div>
                          <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>👷 {r.submitted_by}</div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                          {r.open_actions > 0
                            ? <span style={{ fontSize: 11, fontWeight: 700, color: "#DC2626", background: "#FEF2F2", padding: "3px 9px", borderRadius: 20 }}>{r.open_actions} open</span>
                            : <span style={{ fontSize: 11, fontWeight: 700, color: "#16A34A", background: "#F0FDF4", padding: "3px 9px", borderRadius: 20 }}>All clear</span>}
                          <div style={{ fontSize: 11, color: r.pdf_url ? "#4338CA" : "#9CA3AF" }}>
                            {r.pdf_url ? "📄 PDF" : "No PDF"} →
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {monthlySubTab === "actions" && (
              <div style={styles.card}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 4 }}>
                  {company?.name} — Corrective Actions
                </div>
                <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>Assign a responsible person and target date, then mark resolved once complete.</div>
                {companyMonthlyActions.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                    No corrective actions logged yet.
                  </div>
                ) : (
                  <>
                    {companyMonthlyActions.filter(a => a.status !== "resolved").length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#991B1B", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                          Open ({companyMonthlyActions.filter(a => a.status !== "resolved").length})
                        </div>
                        {companyMonthlyActions.filter(a => a.status !== "resolved").map(ca => (
                          <CorrectiveActionRow key={ca.id} ca={ca} onUpdate={updateCorrectiveAction} />
                        ))}
                      </div>
                    )}
                    {companyMonthlyActions.filter(a => a.status === "resolved").length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                          Resolved ({companyMonthlyActions.filter(a => a.status === "resolved").length})
                        </div>
                        {companyMonthlyActions.filter(a => a.status === "resolved").map(ca => (
                          <CorrectiveActionRow key={ca.id} ca={ca} onUpdate={updateCorrectiveAction} />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === "equipment" && equipmentReportsEnabled && (
          <div style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F" }}>
                {company?.name} — Weekly Equipment Usage
              </div>
              <button onClick={generateThisWeeksReport} disabled={generatingNewReport} style={{
                background: generatingNewReport ? "#94A3B8" : "#0369A1", color: "#fff", border: "none", borderRadius: 8,
                padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0
              }}>
                {generatingNewReport ? "Generating…" : "+ Generate This Week"}
              </button>
            </div>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>A new report is generated automatically every Monday for the prior week. Tap any report to view or download.</div>

            {loadingEquipmentReports ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>Loading…</div>
            ) : equipmentReports.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔧</div>
                No equipment reports yet.
              </div>
            ) : (
              equipmentReports.map((r, i) => (
                <div key={r.id} style={{
                  padding: "12px 14px", borderBottom: i < equipmentReports.length - 1 ? "1px solid #F3F4F6" : "none",
                  cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center"
                }} onClick={() => openEquipmentReport(r)}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#1E3A5F" }}>{r.week_start} to {r.week_end}</div>
                    <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{r.generated_by === "auto" ? "Auto-generated" : "Manually generated"} · {new Date(r.created_at).toLocaleDateString("en-CA")}</div>
                  </div>
                  <div style={{ fontSize: 11, color: r.pdf_url ? "#0369A1" : "#9CA3AF" }}>
                    {r.pdf_url ? "📄 PDF ready" : "No PDF yet"} →
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "sops" && (
          <div style={styles.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 12 }}>
              {company?.name} — Safety Policies
            </div>
            {companySops.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                No SOPs loaded for this company.
              </div>
            ) : (
              companySops.map((s, i) => (
                <div key={s.id} style={{
                  padding: "10px 0", borderBottom: i < companySops.length - 1 ? "1px solid #F3F4F6" : "none",
                  display: "flex", gap: 10, alignItems: "flex-start"
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", background: "#1E3A5F",
                    color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center"
                  }}>{i + 1}</div>
                  <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.5 }}>{s.policy_text}</div>
                </div>
              ))
            )}
          </div>
        )}

      </div>
    </div>
  );
}
