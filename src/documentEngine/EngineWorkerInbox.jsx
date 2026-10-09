import { useState, useEffect, useCallback } from "react";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD } from "../theme";
import { buildFormStyles, bannerStyle } from "../FormKit";
import { callDocuments } from "./builderApi.js";
import { loadRecordForWorker, signEngineDocument } from "./engineSubmit.js";
import { rowsToForm } from "./recordView.js";
import SignaturePad from "./SignaturePad.jsx";
import EngineDocumentForm from "./EngineDocumentForm.jsx";
import { ArrowLeft, AlertTriangle, CheckCircle2, Loader2, PenLine, RotateCcw } from "lucide-react";

// What is waiting on this worker: documents a reviewer sent back, and
// documents they saved to sign afterwards. Needs a connection; nothing here
// is queued offline.

export default function EngineWorkerInbox({ token, companyId, companyName, userName, userId, titles = {}, onBack, onCount, onAmendCount }) {
  const s = buildFormStyles(C, FONT, RAD, SHAD, C.orange);
  const [items, setItems] = useState(null);
  const [amendable, setAmendable] = useState([]);
  const [err, setErr] = useState("");
  const [fixing, setFixing] = useState(null); // { recordId, definitionId }
  const [signing, setSigning] = useState(null); // { recordId, definitionId }

  const load = useCallback(async () => {
    try {
      const out = await callDocuments(token, "my_inbox", { companyId });
      setItems(out.mine || []);
      setAmendable(out.amendable || []);
      onAmendCount && onAmendCount((out.amendable || []).length);
      onCount && onCount(out.counts?.mine || 0);
    } catch (e) { setErr(e.message || "Couldn't load your inbox."); setItems([]); }
  }, [token, companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  if (fixing) {
    return <EngineDocumentForm companyId={companyId} companyName={companyName} userName={userName} userId={userId} definitionId={fixing.definitionId} resubmitRecordId={fixing.recordId} amend={fixing.amend === true} token={token} onBack={() => { setFixing(null); load(); }} />;
  }
  if (signing) {
    return <SignPanel s={s} token={token} companyId={companyId} companyName={companyName} userName={userName} item={signing} title={titles[signing.definitionId]} onBack={() => { setSigning(null); load(); }} />;
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Company document inbox</div>
        <button onClick={onBack} aria-label="Back" style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: RAD.md, padding: "8px 12px", cursor: "pointer" }}><ArrowLeft size={16} /></button>
      </div>
      {err && <div role="alert" style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} /> <span>{err}</span></div>}
      {items === null && <div style={{ color: C.text.muted }}><Loader2 size={16} className="fora-spin" /> Loading...</div>}
      {items && items.length === 0 && !err && <div style={{ ...s.card, textAlign: "center", color: C.text.muted }}><CheckCircle2 size={28} color={C.status.success.text} /><div style={{ marginTop: 6 }}>Nothing is waiting on you.</div></div>}
      {(items || []).map((it) => (
        <div key={`${it.kind}_${it.recordId}`} style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 15, color: C.text.primary }}>{titles[it.definitionId] || "Document"}</div>
          {it.kind === "returned" ? (
            <>
              <div style={{ fontSize: 13, color: C.status.warning.text, margin: "6px 0 10px" }}>Sent back: {it.reason || "No reason given."}</div>
              <button style={s.btn(C.orange)} onClick={() => setFixing({ recordId: it.recordId, definitionId: it.definitionId })}><RotateCcw size={16} /> Fix and resend</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: C.text.muted, margin: "6px 0 10px" }}>Waiting for your signature{it.at ? ` since ${new Date(it.at).toLocaleDateString("en-CA")}` : ""}.</div>
              <button style={s.btn(C.orange)} onClick={() => setSigning({ recordId: it.recordId, definitionId: it.definitionId })}><PenLine size={16} /> Sign now</button>
            </>
          )}
        </div>
      ))}
      {amendable.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: C.text.primary, margin: "0 0 6px" }}>You can still change today</div>
          {amendable.map((it) => (
            <div key={`amend_${it.recordId}`} style={s.card}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.text.primary }}>{titles[it.definitionId] || "Document"}</div>
              <div style={{ fontSize: 13, color: C.text.muted, margin: "6px 0 10px" }}>Filed {it.at ? new Date(it.at).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" }) : "today"}.</div>
              <button style={s.btn(C.orange)} onClick={() => setFixing({ recordId: it.recordId, definitionId: it.definitionId, amend: true })}><RotateCcw size={16} /> Amend</button>
            </div>
          ))}
        </div>
      )}
      <style>{"@keyframes fora-spin { to { transform: rotate(360deg); } } .fora-spin { animation: fora-spin 0.8s linear infinite; }"}</style>
    </div>
  );
}

function SignPanel({ s, token, companyId, companyName, userName, item, title, onBack }) {
  const [rec, setRec] = useState(null);
  const [sig, setSig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    let live = true;
    loadRecordForWorker(token, companyId, item.recordId, callDocuments).then((r) => live && setRec(r)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [token, companyId, item.recordId]);

  const go = async () => {
    setBusy(true); setErr("");
    try {
      const { answers } = rowsToForm(rec.answers);
      const now = new Date();
      // The PDF is only redrawn when the form still matches the version it was filed on.
      const sites = await fetch("/api/companydata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list_sites", token, companyId }) }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      const siteName = (sites.sites || []).find((x) => String(x.id) === String(rec.record.site_id))?.name || "";
      const payload = { title: rec.doc.definition.title, layout: rec.doc.layout, fields: rec.doc.fields, answers, notes: {}, siteName, companyName, submittedBy: userName, dateText: now.toLocaleDateString("en-CA"), dateTimeText: now.toLocaleString("en-CA"), skipPdf: !rec.sameVersion };
      await signEngineDocument(payload, item.recordId, sig, token);
      setDone(true);
    } catch (e) { setErr(e.isNetworkFailure ? "No connection. Try again when you are back online." : e.message); }
    setBusy(false);
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}><div style={{ fontWeight: 800, fontSize: 18 }}>{title || "Sign document"}</div>
        <button onClick={onBack} aria-label="Back" style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: RAD.md, padding: "8px 12px", cursor: "pointer" }}><ArrowLeft size={16} /></button></div>
      {done ? (
        <div style={{ ...s.card, textAlign: "center" }}><CheckCircle2 size={40} color={C.status.success.text} /><div style={{ fontWeight: 800, fontSize: 20, margin: "8px 0 14px" }}>Signed</div><button style={s.btn(C.orange)} onClick={onBack}>Back to inbox</button></div>
      ) : (
        <div style={s.card}>
          <div style={{ fontSize: 11.5, color: C.text.faint, marginBottom: 8 }}>By signing, you take full responsibility for the accuracy of this document.</div>
          {!rec && !err && <div style={{ color: C.text.muted }}><Loader2 size={16} className="fora-spin" /> Loading...</div>}
          {rec && <SignaturePad value={sig} onChange={setSig} />}
          {err && <div role="alert" style={bannerStyle(C, RAD, "danger")}><AlertTriangle size={16} /> <span>{err}</span></div>}
          <button style={s.btn(busy || !sig ? C.text.faint : C.status.success.solid)} disabled={busy || !sig || !rec} onClick={go}>{busy ? "Signing..." : "Sign"}</button>
        </div>
      )}
    </div>
  );
}
