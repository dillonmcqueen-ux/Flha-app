import { useState, useRef, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { generateAndUploadToolbox } from "./generateToolboxPDF";
import { useCustomFields, CustomFieldInputs } from "./customFields.jsx";

const MEETING_TYPES = ["Pre-Job", "Daily", "Weekly", "Monthly"];

export default function ToolboxTalk({ companyId, companyName, onBack, onLogout, token = null }) {
  const [step, setStep] = useState("setup"); // setup | topic | review | signoff | done
  const [presenter, setPresenter] = useState("");
  const [meetingType, setMeetingType] = useState("Pre-Job");
  const [site, setSite] = useState("");
  const [sites, setSites] = useState([]);
  const [siteMode, setSiteMode] = useState("list");
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [genError, setGenError] = useState(false);
  const [points, setPoints] = useState(null); // { summary, sections: [{heading, bullets:[]}], discussion:[] }
  const [companyLogo, setCompanyLogo] = useState("");
  const cf = useCustomFields(companyId, "toolbox");

  // Attendees
  const [attendees, setAttendees] = useState([]); // {name, signature}
  const [attName, setAttName] = useState("");
  const [attHasSig, setAttHasSig] = useState(false);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [presenterSigned, setPresenterSigned] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: st } = await supabase.from("sites").select("id, name").eq("company_id", companyId).order("id");
      setSites(st || []);
      if (!st || st.length === 0) setSiteMode("other");
      const { data: co } = await supabase.from("companies").select("logo_url").eq("id", companyId).limit(1);
      if (co && co[0]) setCompanyLogo(co[0].logo_url || "");
    }
    load();
  }, [companyId]);

  // ── signature pad ────────────────────────────────────────
  const getPos = (e) => {
    const c = canvasRef.current, r = c.getBoundingClientRect(), t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) };
  };
  const startDraw = (e) => { e.preventDefault(); drawingRef.current = true; const ctx = canvasRef.current.getContext("2d"); const { x, y } = getPos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const draw = (e) => { if (!drawingRef.current) return; e.preventDefault(); const ctx = canvasRef.current.getContext("2d"); const { x, y } = getPos(e); ctx.lineTo(x, y); ctx.strokeStyle = "#1E293B"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.stroke(); setAttHasSig(true); };
  const endDraw = () => { drawingRef.current = false; };
  const clearSig = () => { const c = canvasRef.current; if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height); setAttHasSig(false); };

  const generateTalk = async () => {
    setLoading(true); setGenError(false);
    const prompt = `You are a construction safety leader preparing a short toolbox talk (safety meeting) for a work crew. The meeting should last 5-10 minutes and be delivered verbally by a presenter to workers on site.

Company: ${companyName}
Meeting type: ${meetingType}
Site: ${site}
Topic the presenter wants to cover: "${topic}"

INSTRUCTIONS:
- Generate short, straightforward talking-point bulletins the presenter can read aloud and expand on. Keep each bullet plain and practical — no corporate jargon.
- Make it SPECIFIC to the topic and task described, not generic.
- Cover: the key hazards for this task, safe work practices, and how to prevent injuries/incidents.
- Include a few discussion prompts — open questions the presenter can ask the crew to encourage participation.
- This is a talk, not a document to read silently. Write for the ear.

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "summary": "one sentence describing what this toolbox talk covers",
  "sections": [
    { "heading": "short section title", "bullets": ["short talking point", "short talking point"] }
  ],
  "discussion": ["open question to ask the crew", "open question to ask the crew"]
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
      setPoints(parsed);
      setStep("review");
    } catch (e) {
      setGenError(true);
    }
    setLoading(false);
  };

  const addAttendee = () => {
    if (!attName.trim() || !attHasSig) return;
    const sig = canvasRef.current.toDataURL("image/png");
    setAttendees(prev => [...prev, { name: attName.trim(), signature: sig }]);
    setAttName("");
    clearSig();
  };
  const removeAttendee = (i) => setAttendees(prev => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    setSaving(true);
    const pdfUrl = await generateAndUploadToolbox({
      presenter, meetingType, site, topic, companyName, companyLogo, points, attendees, customFields: cf.entries(),
    });
    try {
      await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "toolbox",
          action: "submit",
          token,
          record: {
            presenter_name: presenter,
            meeting_type: meetingType,
            site,
            topic,
            talking_points_json: { ...points, customFields: cf.entries() },
            attendees_json: attendees,
            pdf_url: pdfUrl || null,
          },
        }),
      });
    } catch (e) {
      console.error("Toolbox talk save failed:", e);
    }
    setSaving(false);
    setStep("done");
  };

  const s = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#F0F4F8", minHeight: "100vh", padding: 16 },
    header: { background: "linear-gradient(135deg,#5B21B6,#7C3AED)", borderRadius: 14, padding: "18px 20px", marginBottom: 16, color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" },
    card: { background: "#fff", borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: "0 1px 3px #0f172a12" },
    label: { display: "block", fontWeight: 700, fontSize: 12, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 },
    input: { width: "100%", padding: "11px 13px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 11, background: "#F8FAFC" },
    btn: (bg, fg = "#fff") => ({ background: bg, color: fg, border: "none", borderRadius: 10, padding: "13px", fontWeight: 800, fontSize: 15, cursor: "pointer", width: "100%" }),
    ghost: { background: "#F1F5F9", color: "#334155", border: "none", borderRadius: 10, padding: "11px", fontWeight: 600, fontSize: 14, cursor: "pointer", width: "100%", marginTop: 10 },
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {companyLogo ? <img src={companyLogo} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: "cover", background: "#fff" }} /> : <span style={{ fontSize: 26 }}>🧰</span>}
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>Toolbox Talk</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Safety meeting record</div>
          </div>
        </div>
        <button onClick={onBack} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>← Menu</button>
      </div>

      {/* SETUP */}
      {step === "setup" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 12, color: "#1E293B" }}>Meeting details</div>
          <label style={s.label}>Presenter name</label>
          <input style={s.input} placeholder="Who is leading the talk?" value={presenter} onChange={e => setPresenter(e.target.value)} />

          <label style={s.label}>Meeting type</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {MEETING_TYPES.map(t => (
              <button key={t} onClick={() => setMeetingType(t)} style={{ flex: "1 1 40%", padding: "10px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${meetingType === t ? "#7C3AED" : "#E2E8F0"}`, background: meetingType === t ? "#7C3AED" : "#fff", color: meetingType === t ? "#fff" : "#64748B" }}>{t}</button>
            ))}
          </div>

          <label style={s.label}>Site / Location</label>
          {sites.length > 0 && siteMode === "list" ? (
            <select style={s.input} value={site} onChange={e => { if (e.target.value === "__other__") { setSiteMode("other"); setSite(""); } else setSite(e.target.value); }}>
              <option value="">Select a site…</option>
              {sites.map(st => <option key={st.id} value={st.name}>{st.name}</option>)}
              <option value="__other__">＋ Other site</option>
            </select>
          ) : (
            <input style={s.input} placeholder="e.g. Hwy 2 Project" value={site} onChange={e => setSite(e.target.value)} />
          )}

          <CustomFieldInputs cf={cf} labelStyle={s.label} inputStyle={s.input} />

          <button style={s.btn((presenter && site) ? "#7C3AED" : "#94A3B8")} disabled={!presenter || !site} onClick={() => {
            const missing = cf.missingRequired();
            if (missing.length > 0) { alert(`Please fill in: ${missing.join(", ")}`); return; }
            setStep("topic");
          }}>Continue →</button>
        </div>
      )}

      {/* TOPIC */}
      {step === "topic" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: "#1E293B" }}>What's the talk about?</div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 14 }}>Describe the task, job, or safety focus. The AI will generate talking points for a 5-10 minute talk.</div>
          <textarea style={{ ...s.input, minHeight: 120, resize: "vertical", fontFamily: "inherit" }} placeholder="e.g. Today we're pouring concrete near the road — I want to cover traffic control, silica dust, and manual lifting" value={topic} onChange={e => setTopic(e.target.value)} />
          {genError && <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: "#991B1B" }}>Couldn't generate the talk. Check your connection and try again.</div>}
          <button style={s.btn(loading ? "#94A3B8" : topic.trim() ? "#7C3AED" : "#94A3B8")} disabled={loading || !topic.trim()} onClick={generateTalk}>
            {loading ? "⏳ Preparing talk…" : "Generate Talking Points"}
          </button>
          <button style={s.ghost} onClick={() => setStep("setup")}>← Back</button>
        </div>
      )}

      {/* REVIEW */}
      {step === "review" && points && (
        <>
          <div style={s.card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", textTransform: "uppercase", letterSpacing: 0.5 }}>{meetingType} Toolbox Talk</div>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#1E293B", marginTop: 2 }}>{points.summary}</div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 4 }}>Presenter: {presenter} · {site}</div>
          </div>

          {(points.sections || []).map((sec, i) => (
            <div key={i} style={s.card}>
              <div style={{ fontWeight: 800, fontSize: 15, color: "#5B21B6", marginBottom: 8 }}>{sec.heading}</div>
              {(sec.bullets || []).map((b, j) => (
                <div key={j} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <span style={{ color: "#7C3AED", fontWeight: 800 }}>•</span>
                  <span style={{ fontSize: 14, color: "#334155", lineHeight: 1.5 }}>{b}</span>
                </div>
              ))}
            </div>
          ))}

          {points.discussion?.length > 0 && (
            <div style={{ ...s.card, background: "#FAF5FF", border: "1.5px solid #E9D5FF" }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: "#5B21B6", marginBottom: 8 }}>💬 Discussion — ask the crew</div>
              {points.discussion.map((d, i) => (
                <div key={i} style={{ fontSize: 14, color: "#334155", marginBottom: 6, lineHeight: 1.5 }}>{i + 1}. {d}</div>
              ))}
            </div>
          )}

          <button style={s.btn("#7C3AED")} onClick={() => setStep("signoff")}>Continue to Sign-Off →</button>
          <button style={s.ghost} onClick={() => setStep("topic")}>← Back</button>
        </>
      )}

      {/* SIGN-OFF */}
      {step === "signoff" && (
        <>
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#1E293B", marginBottom: 4 }}>Attendance & Sign-Off</div>
            <div style={{ fontSize: 13, color: "#64748B" }}>Presenter: <strong>{presenter}</strong>{!presenterSigned && " — sign first, then pass the device to each attendee."}</div>
          </div>

          {/* Signed list */}
          {(presenterSigned || attendees.length > 0) && (
            <div style={s.card}>
              <div style={{ fontWeight: 800, fontSize: 14, color: "#1E293B", marginBottom: 8 }}>Signed ({(presenterSigned ? 1 : 0) + attendees.length})</div>
              {presenterSigned && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: attendees.length > 0 ? "1px solid #F1F5F9" : "none" }}>
                  <span style={{ fontSize: 14, color: "#334155" }}>👤 {presenter} <span style={{ fontSize: 11, color: "#7C3AED", fontWeight: 700 }}>PRESENTER</span></span>
                  <span style={{ fontSize: 12, color: "#16A34A", fontWeight: 700 }}>✓ signed</span>
                </div>
              )}
              {attendees.map((a, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < attendees.length - 1 ? "1px solid #F1F5F9" : "none" }}>
                  <span style={{ fontSize: 14, color: "#334155" }}>👷 {a.name}</span>
                  <button onClick={() => removeAttendee(i)} style={{ background: "transparent", border: "none", color: "#DC2626", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Remove</button>
                </div>
              ))}
            </div>
          )}

          {/* Signature capture */}
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#1E293B", marginBottom: 8 }}>{!presenterSigned ? "Presenter signature" : "Add attendee"}</div>
            <label style={s.label}>Name</label>
            <input style={s.input} placeholder={!presenterSigned ? presenter : "Attendee full name"} value={!presenterSigned ? presenter : attName} onChange={e => setAttName(e.target.value)} disabled={!presenterSigned} />
            <label style={s.label}>Signature</label>
            <div style={{ position: "relative", marginBottom: 6 }}>
              <canvas ref={canvasRef} width={600} height={160}
                style={{ width: "100%", height: 130, border: "1.5px solid #E2E8F0", borderRadius: 10, background: "#fff", touchAction: "none", display: "block" }}
                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
              {!attHasSig && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 14, pointerEvents: "none" }}>Sign here</div>}
            </div>
            <div style={{ textAlign: "right", marginBottom: 10 }}>
              <button onClick={clearSig} style={{ background: "transparent", border: "none", color: "#64748B", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Clear</button>
            </div>
            {!presenterSigned ? (
              <button style={s.btn(attHasSig ? "#7C3AED" : "#94A3B8")} disabled={!attHasSig} onClick={() => {
                const sig = canvasRef.current.toDataURL("image/png");
                setAttendees([{ name: presenter, signature: sig, presenter: true }]);
                setPresenterSigned(true);
                clearSig();
              }}>✓ Presenter Sign</button>
            ) : (
              <button style={s.btn((attName.trim() && attHasSig) ? "#7C3AED" : "#94A3B8")} disabled={!attName.trim() || !attHasSig} onClick={addAttendee}>+ Add This Attendee</button>
            )}
          </div>

          {presenterSigned && (
            <button style={s.btn(saving ? "#94A3B8" : "#16A34A")} disabled={saving} onClick={submit}>
              {saving ? "Saving…" : `Finish & Save (${attendees.length} signed)`}
            </button>
          )}
        </>
      )}

      {/* DONE */}
      {step === "done" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 60, marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: "#1E293B", marginBottom: 6 }}>Toolbox Talk Recorded</div>
            <div style={{ fontSize: 14, color: "#64748B", marginBottom: 20 }}>{meetingType} · {site} · {attendees.length} attendee{attendees.length !== 1 ? "s" : ""}</div>
            <button style={s.btn("#7C3AED")} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}
    </div>
  );
}
