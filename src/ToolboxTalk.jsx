import { useState, useRef, useEffect } from "react";
import { generateAndUploadToolbox } from "./generateToolboxPDF";
import { useCustomFields, CustomFieldInputs } from "./customFields.jsx";
import { siteIdForName } from "./siteLookup.js";
import { loadDraft, clearDraft, useDraftAutosave } from "./useDraftAutosave.js";
import { enqueueSubmission } from "./offlineQueue.js";
import { fetchCompanyProfile, buildCompanyContextBlock } from "./companyProfile.js";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD } from "./theme";
import { buildFormStyles, disabledBg, bannerStyle, signatureCanvasStyle, docAccent } from "./FormKit";
import { ArrowLeft, Hammer, AlertTriangle, Loader2, CheckCircle2, WifiOff, PenLine, Plus, MessageCircle, User, HardHat, Check } from "lucide-react";

function newClientSubmissionId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Redoes the entire submission (PDF upload + the final POST) from plain
// input data — used both by a live online submit() below and by
// offlineQueue's drainQueue() to resend a queued one later. Only covers
// the "new talk" flow, not sign-late (see the matching note on the
// autosave restore logic above — sign-late updates an existing record
// fetched live, it isn't a fresh queueable submission).
export async function resubmitToolboxTalk(payload, clientSubmissionId, tokenForRequest) {
  const { presenter, meetingType, site, siteId, topic, points, attendees, customFields, companyName, companyLogo } = payload;
  const pdfUrl = await generateAndUploadToolbox({
    presenter, meetingType, site, topic, companyName, companyLogo, points, attendees, customFields, token: tokenForRequest,
  });

  let res;
  try {
    res = await fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "toolbox",
        action: "submit",
        token: tokenForRequest,
        clientSubmissionId,
        record: {
          presenter_name: presenter,
          meeting_type: meetingType,
          site,
          site_id: siteId || null,
          topic,
          talking_points_json: { ...points, customFields },
          attendees_json: attendees,
          pdf_url: pdfUrl || null,
        },
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
  // The server reports whether the generated PDF actually got attached to
  // the saved record — see receiptWasDropped() in server-lib/uploadUrls.js.
  // Returned so the caller (a live submit, or offlineQueue's drainQueue)
  // can say so instead of the record quietly having no PDF link.
  return await res.json().catch(() => ({}));
}

const MEETING_TYPES = ["Pre-Job", "Daily", "Weekly", "Monthly", "After Incident"];

export default function ToolboxTalk({ companyId, companyName, userName: loginUserName = "", onBack, onLogout, token = null }) {
  const [step, setStep] = useState("choice"); // choice | setup | topic | manualtalk | review | signoff | findtalk | latesign | done
  const [presenter, setPresenter] = useState(loginUserName);
  const [meetingType, setMeetingType] = useState("Pre-Job");
  const [site, setSite] = useState("");
  const [sites, setSites] = useState([]);
  const [siteMode, setSiteMode] = useState("list");
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [genError, setGenError] = useState(false);
  const [points, setPoints] = useState(null); // { summary, sections: [{heading, bullets:[]}], discussion:[], ai_assisted }
  const [manualNotes, setManualNotes] = useState(""); // docs/scope-offline-capability.md Phase 2 — plain fallback notes when AI is unreachable
  const [companyLogo, setCompanyLogo] = useState("");
  // docs/scope-company-brain.md Phase 5 — null (cold start) is handled
  // gracefully by buildCompanyContextBlock.
  const [companyProfile, setCompanyProfile] = useState(null);
  const cf = useCustomFields(companyId, "toolbox", token);

  // Attendees
  const [attendees, setAttendees] = useState([]); // {name, signature}
  const [attName, setAttName] = useState("");
  const [attHasSig, setAttHasSig] = useState(false);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [presenterSigned, setPresenterSigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Sign-later — for crew who missed the talk and are coming back to sign
  const [openTalks, setOpenTalks] = useState([]);
  const [loadingOpenTalks, setLoadingOpenTalks] = useState(false);
  const [lateSignTarget, setLateSignTarget] = useState(null); // { record, company }
  const [lateName, setLateName] = useState(loginUserName);
  const [signingLate, setSigningLate] = useState(false);
  const [lateSignError, setLateSignError] = useState("");

  useEffect(() => {
    async function load() {
      // Sites — via protected endpoint
      try {
        const siteRes = await fetch("/api/companydata", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_sites", token, companyId }),
        });
        const siteData = await siteRes.json();
        if (siteRes.ok) {
          setSites(siteData.sites || []);
          if (!siteData.sites || siteData.sites.length === 0) setSiteMode("other");
        } else {
          setSiteMode("other");
        }
      } catch (e) {
        setSiteMode("other");
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

      // Company profile (docs/scope-company-brain.md Phase 5) — best-effort.
      setCompanyProfile(await fetchCompanyProfile(token, companyId));
    }
    load();
  }, [companyId, token]);

  // ── Offline resilience: local draft autosave (docs/scope-offline-capability.md Phase 0) ──
  // Only the "new talk" flow (setup/topic/review/signoff) is restorable —
  // "Sign Late" depends on fetching a specific existing record live
  // (lateSignTarget), which isn't something to cache locally.
  const RESTORABLE_STEPS = ["setup", "topic", "manualtalk", "review", "signoff"];
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    if (!companyId) return;
    const draft = loadDraft("toolbox", companyId);
    if (draft && draft.step && RESTORABLE_STEPS.includes(draft.step)) {
      if (draft.presenter) setPresenter(draft.presenter);
      if (draft.meetingType) setMeetingType(draft.meetingType);
      if (draft.site) setSite(draft.site);
      if (draft.siteMode) setSiteMode(draft.siteMode);
      if (draft.topic) setTopic(draft.topic);
      if (draft.points) setPoints(draft.points);
      if (draft.manualNotes) setManualNotes(draft.manualNotes);
      if (draft.attendees) setAttendees(draft.attendees);
      if (draft.presenterSigned) setPresenterSigned(draft.presenterSigned);
      setStep(draft.step);
    }
    setDraftRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useDraftAutosave(
    "toolbox",
    companyId,
    { step, presenter, meetingType, site, siteMode, topic, points, manualNotes, attendees, presenterSigned },
    draftRestored && !!companyId && RESTORABLE_STEPS.includes(step)
  );

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
${buildCompanyContextBlock(companyProfile)}
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
        body: JSON.stringify({ prompt, token, documentType: "toolbox_talk" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const text = data.content?.map(b => b.text || "").join("") || "";
      const a = text.indexOf("{"), b = text.lastIndexOf("}");
      if (a === -1 || b === -1) throw new Error("bad response");
      const parsed = JSON.parse(text.slice(a, b + 1));
      setPoints({ ...parsed, ai_assisted: true });
      setStep("review");
    } catch (e) {
      setGenError(true);
    }
    setLoading(false);
  };

  // docs/scope-offline-capability.md Phase 2: unlike the other 6 forms,
  // ToolboxTalk's review step renders generated content as plain text with
  // no edit path at all — a presenter can't currently fix a single word of
  // an AI talk, let alone build one from scratch by hand. Rather than
  // retrofit that whole screen, the fallback is a single plain-text step:
  // type your talking points/notes, presented from memory instead of a
  // structured AI breakdown — which is how a real presenter runs a talk
  // without AI help anyway.
  const goManualTalk = () => {
    setGenError(false);
    setStep("manualtalk");
  };

  const confirmManualTalk = () => {
    setPoints({ summary: manualNotes.trim(), sections: [], discussion: [], ai_assisted: false });
    setStep("signoff");
  };

  const addAttendee = () => {
    if (!attName.trim() || !attHasSig) return;
    const sig = canvasRef.current.toDataURL("image/png");
    setAttendees(prev => [...prev, { name: attName.trim(), signature: sig, signedAt: new Date().toISOString() }]);
    setAttName("");
    clearSig();
  };
  const removeAttendee = (i) => setAttendees(prev => prev.filter((_, idx) => idx !== i));

  // ── Sign-later flow ─────────────────────────────────────────
  const loadOpenTalks = async () => {
    setLoadingOpenTalks(true);
    try {
      const res = await fetch("/api/logs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "toolbox", action: "list_open_toolbox", token }),
      });
      const data = await res.json();
      if (res.ok) setOpenTalks(data.talks || []);
    } catch (e) { /* leave list empty if the request fails */ }
    setLoadingOpenTalks(false);
  };

  const openTalkToSign = async (talkId) => {
    setLateSignError("");
    try {
      const res = await fetch("/api/logs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "toolbox", action: "get_toolbox_detail", token, id: talkId }),
      });
      const data = await res.json();
      if (res.ok) {
        setLateSignTarget(data);
        clearSig();
        setStep("latesign");
      } else {
        setLateSignError(data.error || "Couldn't load that toolbox talk.");
      }
    } catch (e) {
      setLateSignError("Couldn't load that toolbox talk.");
    }
  };

  const signLate = async () => {
    if (!lateSignTarget) return;
    setSigningLate(true); setLateSignError("");
    const sig = canvasRef.current.toDataURL("image/png");
    const { record, company } = lateSignTarget;
    const updatedAttendees = [...(record.attendees_json || []), { name: lateName.trim(), signature: sig, signedLate: true, signedAt: new Date().toISOString() }];

    // record.pdf_url here is already a signed URL (get_toolbox_detail signed
    // it) — never fall back to it as the value to persist, or a regen
    // failure would overwrite the DB's real stored path with a URL that
    // expires and can't be re-signed later. null means "leave pdf_url
    // alone" server-side, keeping whatever valid PDF already exists.
    let pdfUrl = null;
    try {
      pdfUrl = await generateAndUploadToolbox({
        presenter: record.presenter_name, meetingType: record.meeting_type, site: record.site, topic: record.topic,
        companyName: company?.name || "", companyLogo: company?.logo_url || "",
        points: record.talking_points_json || {}, attendees: updatedAttendees,
        customFields: record.talking_points_json?.customFields || [],
        token,
      });
    } catch (e) { /* keep the existing pdf if regeneration fails */ }

    try {
      const res = await fetch("/api/logs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "toolbox", action: "sign_late_toolbox", token, id: record.id, name: lateName.trim(), signature: sig, pdfUrl }),
      });
      const data = await res.json();
      if (!res.ok) { setLateSignError(data.error || "Couldn't save your signature."); setSigningLate(false); return; }
    } catch (e) {
      setLateSignError("Couldn't save your signature. Try again.");
      setSigningLate(false);
      return;
    }
    setSigningLate(false);
    setStep("done");
  };

  // docs/scope-offline-capability.md Phase 1: a network-level failure gets
  // queued and retried automatically once back online instead of silently
  // discarding the talk; a real server-side rejection shows an error and
  // lets the presenter retry manually.
  const submit = async () => {
    setSaving(true); setSaveError(false);
    const clientSubmissionId = newClientSubmissionId();
    const payload = { presenter, meetingType, site, siteId: siteIdForName(sites, site, siteMode), topic, points, attendees, customFields: cf.entries(), companyName, companyLogo };

    if (!navigator.onLine) {
      await enqueueSubmission("toolbox", clientSubmissionId, payload);
      setSaving(false);
      clearDraft("toolbox", companyId);
      setStep("queued");
      return;
    }

    try {
      await resubmitToolboxTalk(payload, clientSubmissionId, token);
      setSaving(false);
      clearDraft("toolbox", companyId);
      setStep("done");
    } catch (e) {
      if (e.isServerError) {
        console.error("Toolbox talk save failed:", e.message);
        setSaveError(true);
        setSaving(false);
      } else {
        await enqueueSubmission("toolbox", clientSubmissionId, payload);
        setSaving(false);
        clearDraft("toolbox", companyId);
        setStep("queued");
      }
    }
  };

  const accent = docAccent(C, "toolbox");
  const s = buildFormStyles(C, FONT, RAD, SHAD, accent);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {companyLogo ? <img src={companyLogo} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: "cover", background: "#fff" }} /> : <Hammer size={26} strokeWidth={2} />}
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>Toolbox Talk</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Safety meeting record</div>
          </div>
        </div>
        <button onClick={onBack} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><ArrowLeft size={15} strokeWidth={2.5} /> Menu</button>
      </div>

      {/* CHOICE */}
      {step === "choice" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: C.text.primary }}>Toolbox Talk</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 14 }}>Running a new talk, or signing one you missed?</div>
          <button style={s.btn(accent)} onClick={() => setStep("setup")}>Start a New Toolbox Talk</button>
          <button style={s.ghost} onClick={() => { setLateSignError(""); setStep("findtalk"); loadOpenTalks(); }}>I Missed One — Sign It Now</button>
        </div>
      )}

      {/* SETUP */}
      {step === "setup" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 12, color: C.text.primary }}>Meeting details</div>
          <label style={s.label}>Presenter name</label>
          <input
            style={{ ...s.input, ...(loginUserName ? { background: C.line, color: C.text.faint } : {}) }}
            placeholder="Who is leading the talk?" value={presenter}
            onChange={e => setPresenter(e.target.value)}
            readOnly={!!loginUserName}
          />

          <label style={s.label}>Meeting type</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {MEETING_TYPES.map(t => (
              <button key={t} onClick={() => setMeetingType(t)} style={{ flex: "1 1 40%", padding: "11px", borderRadius: RAD.sm, fontSize: 14, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${meetingType === t ? accent : C.line}`, background: meetingType === t ? accent : C.panelInset, color: meetingType === t ? "#fff" : C.text.faint }}>{t}</button>
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

          <button style={s.btn((presenter && site) ? accent : disabledBg(C))} disabled={!presenter || !site} onClick={() => {
            const missing = cf.missingRequired();
            if (missing.length > 0) { alert(`Please fill in: ${missing.join(", ")}`); return; }
            setStep("topic");
          }}>Continue →</button>
          <button style={s.ghost} onClick={() => setStep("choice")}><ArrowLeft size={15} strokeWidth={2.5} /> Back</button>
        </div>
      )}

      {/* TOPIC */}
      {step === "topic" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: C.text.primary }}>What's the talk about?</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 14 }}>Describe the task, job, or safety focus. The AI will generate talking points for a 5-10 minute talk.</div>
          <textarea style={{ ...s.input, minHeight: 120, resize: "vertical" }} placeholder="e.g. Today we're pouring concrete near the road — I want to cover traffic control, silica dust, and manual lifting" value={topic} onChange={e => setTopic(e.target.value)} />
          {genError && (
            <div style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Couldn't generate the talk. Check your connection and try again, or run it from your own notes.</span>
            </div>
          )}
          <button style={s.btn(loading ? disabledBg(C) : topic.trim() ? accent : disabledBg(C))} disabled={loading || !topic.trim()} onClick={generateTalk}>
            {loading ? <><Loader2 size={16} className="fora-spin" /> Preparing talk…</> : "Generate Talking Points"}
          </button>
          {genError && (
            <button style={s.ghost} onClick={goManualTalk}>Continue without AI — I'll present from my own notes</button>
          )}
          <button style={s.ghost} onClick={() => setStep("setup")}><ArrowLeft size={15} strokeWidth={2.5} /> Back</button>
        </div>
      )}

      {/* MANUAL TALK — docs/scope-offline-capability.md Phase 2 fallback when AI is unreachable */}
      {step === "manualtalk" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: C.text.primary }}>Your talking points</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 14 }}>No AI structuring this time — jot down what you plan to cover. This becomes the record of the talk.</div>
          <textarea style={{ ...s.input, minHeight: 160, resize: "vertical" }} placeholder="e.g. Reviewed traffic control plan, flaggers positioned before any lane closure. Silica dust — wet-cutting only, respirators on hand. No manual lifting over 50 lbs without a second person." value={manualNotes} onChange={e => setManualNotes(e.target.value)} />
          <button style={s.btn(manualNotes.trim() ? accent : disabledBg(C))} disabled={!manualNotes.trim()} onClick={confirmManualTalk}>Continue to Sign-Off →</button>
          <button style={s.ghost} onClick={() => setStep("topic")}><ArrowLeft size={15} strokeWidth={2.5} /> Back</button>
        </div>
      )}

      {/* REVIEW */}
      {step === "review" && points && (
        <>
          <div style={s.card}>
            <div style={{ fontSize: 11, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 0.5 }}>{meetingType} Toolbox Talk</div>
            <div style={{ fontWeight: 800, fontSize: 17, color: C.text.primary, marginTop: 2 }}>{points.summary}</div>
            <div style={{ fontSize: 12, color: C.text.muted, marginTop: 4 }}>Presenter: {presenter} · {site}</div>
          </div>

          {(points.sections || []).map((sec, i) => (
            <div key={i} style={s.card}>
              <div style={{ fontWeight: 800, fontSize: 15, color: accent, marginBottom: 8 }}>{sec.heading}</div>
              {(sec.bullets || []).map((b, j) => (
                <div key={j} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <span style={{ color: accent, fontWeight: 800 }}>•</span>
                  <span style={{ fontSize: 14, color: C.text.body, lineHeight: 1.5 }}>{b}</span>
                </div>
              ))}
            </div>
          ))}

          {points.discussion?.length > 0 && (
            <div style={{ ...s.card, background: C.orangeSoft, border: `1.5px solid ${C.orangeDim}` }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: accent, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}><MessageCircle size={16} strokeWidth={2.25} /> Discussion — ask the crew</div>
              {points.discussion.map((d, i) => (
                <div key={i} style={{ fontSize: 14, color: C.text.body, marginBottom: 6, lineHeight: 1.5 }}>{i + 1}. {d}</div>
              ))}
            </div>
          )}

          <button style={s.btn(accent)} onClick={() => setStep("signoff")}>Continue to Sign-Off →</button>
          <button style={s.ghost} onClick={() => setStep("topic")}><ArrowLeft size={15} strokeWidth={2.5} /> Back</button>
        </>
      )}

      {/* SIGN-OFF */}
      {step === "signoff" && (
        <>
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 17, color: C.text.primary, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><PenLine size={18} strokeWidth={2.25} color={accent} /> Attendance & Sign-Off</div>
            <div style={{ fontSize: 13, color: C.text.muted }}>Presenter: <strong>{presenter}</strong>{!presenterSigned && " — sign first, then pass the device to each attendee."}</div>
          </div>

          {/* Signed list */}
          {(presenterSigned || attendees.length > 0) && (
            <div style={s.card}>
              <div style={{ fontWeight: 800, fontSize: 14, color: C.text.primary, marginBottom: 8 }}>Signed ({(presenterSigned ? 1 : 0) + attendees.length})</div>
              {presenterSigned && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: attendees.length > 0 ? `1px solid ${C.line}` : "none" }}>
                  <span style={{ fontSize: 14, color: C.text.body, display: "flex", alignItems: "center", gap: 6 }}><User size={14} strokeWidth={2.25} /> {presenter} <span style={{ fontSize: 11, color: accent, fontWeight: 700 }}>PRESENTER</span></span>
                  <span style={{ fontSize: 12, color: C.status.success.text, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><Check size={13} strokeWidth={3} /> signed</span>
                </div>
              )}
              {attendees.map((a, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: i < attendees.length - 1 ? `1px solid ${C.line}` : "none" }}>
                  <span style={{ fontSize: 14, color: C.text.body, display: "flex", alignItems: "center", gap: 6 }}><HardHat size={14} strokeWidth={2.25} /> {a.name}</span>
                  <button onClick={() => removeAttendee(i)} style={{ background: "transparent", border: "none", color: C.status.danger.text, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Remove</button>
                </div>
              ))}
            </div>
          )}

          {/* Signature capture */}
          <div style={s.card}>
            <div style={{ fontWeight: 800, fontSize: 14, color: C.text.primary, marginBottom: 8 }}>{!presenterSigned ? "Presenter signature" : "Add attendee"}</div>
            <label style={s.label}>Name</label>
            <input style={s.input} placeholder={!presenterSigned ? presenter : "Attendee full name"} value={!presenterSigned ? presenter : attName} onChange={e => setAttName(e.target.value)} disabled={!presenterSigned} />
            <label style={s.label}>Signature</label>
            <div style={{ fontSize: 11, color: C.text.faint, marginBottom: 6, lineHeight: 1.4 }}>By signing, you take full responsibility for the accuracy of this document — FORA is not liable for any errors or omissions.</div>
            <div style={{ position: "relative", marginBottom: 6 }}>
              <canvas ref={canvasRef} width={600} height={160}
                style={{ ...signatureCanvasStyle(C, RAD), height: 130 }}
                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
              {!attHasSig && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 14, pointerEvents: "none" }}>Sign here</div>}
            </div>
            <div style={{ textAlign: "right", marginBottom: 10 }}>
              <button onClick={clearSig} style={{ background: "transparent", border: "none", color: C.text.muted, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Clear</button>
            </div>
            {!presenterSigned ? (
              <button style={s.btn(attHasSig ? accent : disabledBg(C))} disabled={!attHasSig} onClick={() => {
                const sig = canvasRef.current.toDataURL("image/png");
                setAttendees([{ name: presenter, signature: sig, presenter: true, signedAt: new Date().toISOString() }]);
                setPresenterSigned(true);
                clearSig();
              }}><Check size={16} strokeWidth={2.5} /> Presenter Sign</button>
            ) : (
              <button style={s.btn((attName.trim() && attHasSig) ? accent : disabledBg(C))} disabled={!attName.trim() || !attHasSig} onClick={addAttendee}><Plus size={16} strokeWidth={2.5} /> Add This Attendee</button>
            )}
          </div>

          {saveError && (
            <div style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Couldn't save this talk. Check your connection and try again.</span>
            </div>
          )}
          {presenterSigned && (
            <button style={s.btn(saving ? disabledBg(C) : C.status.success.solid)} disabled={saving} onClick={submit}>
              {saving ? <><Loader2 size={16} className="fora-spin" /> Saving…</> : saveError ? "Try Again" : <><CheckCircle2 size={16} strokeWidth={2.25} /> Finish & Save ({attendees.length} signed)</>}
            </button>
          )}
        </>
      )}

      {/* FIND TALK (sign-later) */}
      {step === "findtalk" && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: C.text.primary }}>Recent Toolbox Talks</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 14 }}>Pick the one you need to sign — from the last two weeks.</div>
          {lateSignError && <div style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1 }} /><span>{lateSignError}</span></div>}
          {loadingOpenTalks ? (
            <div style={{ textAlign: "center", color: C.text.faint, padding: "20px 0" }}>Loading…</div>
          ) : openTalks.length === 0 ? (
            <div style={{ textAlign: "center", color: C.text.faint, padding: "20px 0" }}>No toolbox talks found in the last two weeks. Ask your supervisor.</div>
          ) : (
            openTalks.map(t => (
              <button key={t.id} onClick={() => openTalkToSign(t.id)} style={{ display: "block", width: "100%", textAlign: "left", background: C.panelInset, border: `1.5px solid ${C.line}`, borderRadius: RAD.md, padding: "12px 14px", marginBottom: 8, cursor: "pointer" }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.text.primary }}>{t.meeting_type} · {t.site}</div>
                <div style={{ fontSize: 12, color: C.text.muted, marginTop: 2 }}>{t.presenter_name} · {new Date(t.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })} · {t.signedCount} signed</div>
              </button>
            ))
          )}
          <button style={s.ghost} onClick={() => setStep("choice")}><ArrowLeft size={15} strokeWidth={2.5} /> Back</button>
        </div>
      )}

      {/* LATE SIGN */}
      {step === "latesign" && lateSignTarget && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, color: C.text.primary }}>{lateSignTarget.record.meeting_type} Toolbox Talk</div>
          <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 14 }}>
            {lateSignTarget.record.site} · Presented by {lateSignTarget.record.presenter_name} · {new Date(lateSignTarget.record.created_at).toLocaleDateString("en-CA")}
          </div>
          {lateSignTarget.record.talking_points_json?.summary && (
            <div style={{ background: C.panelInset, borderRadius: RAD.md, padding: "12px 14px", marginBottom: 14, fontSize: 13, color: C.text.body }}>{lateSignTarget.record.talking_points_json.summary}</div>
          )}

          <label style={s.label}>Your name</label>
          <input
            style={{ ...s.input, ...(loginUserName ? { background: C.line, color: C.text.faint } : {}) }}
            placeholder="Your full name" value={lateName}
            onChange={e => setLateName(e.target.value)}
            readOnly={!!loginUserName}
          />

          <label style={s.label}>Signature</label>
          <div style={{ fontSize: 11, color: C.text.faint, marginBottom: 6, lineHeight: 1.4 }}>By signing, you take full responsibility for the accuracy of this document — FORA is not liable for any errors or omissions.</div>
          <div style={{ position: "relative", marginBottom: 6 }}>
            <canvas ref={canvasRef} width={600} height={160}
              style={{ ...signatureCanvasStyle(C, RAD), height: 130 }}
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
            {!attHasSig && <div style={{ position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", textAlign: "center", color: "#94A3B8", fontSize: 14, pointerEvents: "none" }}>Sign here</div>}
          </div>
          <div style={{ textAlign: "right", marginBottom: 10 }}>
            <button onClick={clearSig} style={{ background: "transparent", border: "none", color: C.text.muted, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Clear</button>
          </div>

          {lateSignError && <div style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1 }} /><span>{lateSignError}</span></div>}
          <button style={s.btn((lateName.trim() && attHasSig && !signingLate) ? C.status.success.solid : disabledBg(C))} disabled={!lateName.trim() || !attHasSig || signingLate} onClick={signLate}>
            {signingLate ? <><Loader2 size={16} className="fora-spin" /> Saving…</> : <><CheckCircle2 size={16} strokeWidth={2.25} /> Sign & Submit</>}
          </button>
          <button style={s.ghost} onClick={() => setStep("findtalk")}><ArrowLeft size={15} strokeWidth={2.5} /> Back</button>
        </div>
      )}

      {/* QUEUED — offline at submit time (docs/scope-offline-capability.md Phase 1) */}
      {step === "queued" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <WifiOff size={48} strokeWidth={1.75} color={C.status.warning.text} style={{ marginBottom: 12 }} />
            <div style={{ fontWeight: 800, fontSize: 22, color: C.text.primary, marginBottom: 6 }}>Saved — No Signal</div>
            <div style={{ fontSize: 14, color: C.text.muted, marginBottom: 8 }}>{meetingType} · {site} · {attendees.length} attendee{attendees.length !== 1 ? "s" : ""}</div>
            <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 20 }}>This talk is saved on your device and will send automatically the next time you're back online — no need to redo it.</div>
            <button style={s.btn(accent)} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}

      {/* DONE */}
      {step === "done" && (
        <div style={s.card}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <CheckCircle2 size={48} strokeWidth={1.75} color={C.status.success.text} style={{ marginBottom: 12 }} />
            <div style={{ fontWeight: 800, fontSize: 22, color: C.text.primary, marginBottom: 6 }}>{lateSignTarget ? "Signature Recorded" : "Toolbox Talk Recorded"}</div>
            {lateSignTarget ? (
              <div style={{ fontSize: 14, color: C.text.muted, marginBottom: 20 }}>{lateSignTarget.record.meeting_type} · {lateSignTarget.record.site} · Signed by {lateName}</div>
            ) : (
              <div style={{ fontSize: 14, color: C.text.muted, marginBottom: 20 }}>{meetingType} · {site} · {attendees.length} attendee{attendees.length !== 1 ? "s" : ""}</div>
            )}
            <button style={s.btn(accent)} onClick={onBack}>Back to menu</button>
          </div>
        </div>
      )}
      <style>{"@keyframes fora-spin { to { transform: rotate(360deg); } } .fora-spin { animation: fora-spin 0.8s linear infinite; }"}</style>
    </div>
  );
}
