// src/MfaSetup.jsx
// Authenticator app setup: scan a QR code, prove it with one code, then save
// the one-time backup codes. Used in two places:
//   - Login.jsx, forced, right after the PIN for supervisors and anyone in a
//     sensitive department who has not set one up yet (no session exists
//     until this finishes).
//   - AccountSecurity.jsx, optional, for anyone who wants it.
// The caller supplies the two network calls so this component stays
// unaware of which endpoint (login ticket vs session) is behind them.
import { useState, useEffect } from "react";
import { colors as C, font as FONT, radius as RAD } from "./theme";
import { AlertTriangle, Check } from "lucide-react";

export default function MfaSetup({ start, confirm, onDone, forced = false, onCancel = null }) {
  const [qr, setQr] = useState(null); // { qrDataUrl, secret }
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // whatever confirm() returned, once it succeeded
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await start();
      if (cancelled) return;
      if (r.error) setError(r.error); else setQr(r);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    setError("");
    setBusy(true);
    const r = await confirm(code.trim());
    setBusy(false);
    if (r.error) { setError(r.error); setCode(""); return; }
    setResult(r);
  };

  const s = {
    title: { fontFamily: FONT.heading, fontWeight: 700, fontSize: 16, color: C.orange, marginBottom: 2 },
    sub: { fontSize: 12, color: C.text.muted, marginBottom: 16, lineHeight: 1.5 },
    input: { width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: RAD.md, border: `1.5px solid ${C.line}`, background: C.panelInset, color: C.text.primary, fontSize: 16, marginBottom: 12 },
    btn: (enabled) => ({ width: "100%", padding: "13px", borderRadius: RAD.md, border: "none", background: enabled ? C.orange : C.line, color: enabled ? "#fff" : C.text.faint, fontWeight: 700, fontSize: 15, cursor: enabled ? "pointer" : "default", minHeight: 44 }),
    err: { background: C.status.danger.bg, border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "10px 12px", margin: "0 0 12px", fontSize: 13, color: C.status.danger.text, display: "flex", alignItems: "center", gap: 6 },
  };

  // Step 2: backup codes, shown once.
  if (result) {
    const codes = result.backupCodes || [];
    return (
      <>
        <div style={s.title}>Save your backup codes</div>
        <div style={s.sub}>Each code works once if you lose your phone. They will not be shown again. Write them down or store them somewhere safe.</div>
        <div style={{ background: C.panelInset, border: `1px solid ${C.line}`, borderRadius: RAD.md, padding: "12px 14px", marginBottom: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontFamily: "monospace", fontSize: 14, color: C.text.primary }}>
          {codes.map(c => <span key={c}>{c}</span>)}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.text.body, marginBottom: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
          I saved these codes
        </label>
        <button style={s.btn(saved)} disabled={!saved} onClick={() => onDone(result)}>
          <Check size={15} style={{ verticalAlign: "middle", marginRight: 6 }} />Continue
        </button>
      </>
    );
  }

  // Step 1: scan and confirm.
  return (
    <>
      <div style={s.title}>{forced ? "Set up your authenticator" : "Set up two-step sign-in"}</div>
      <div style={s.sub}>
        {forced ? "Your role requires an authenticator app. " : ""}
        Scan this with Google Authenticator, Microsoft Authenticator, 1Password or similar, then enter the 6-digit code it shows.
      </div>
      {qr ? (
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <img src={qr.qrDataUrl} alt="Authenticator QR code" style={{ width: 180, height: 180, background: "#fff", borderRadius: RAD.sm, padding: 6 }} />
          <div style={{ fontSize: 11, color: C.text.faint, marginTop: 6, wordBreak: "break-all" }}>Can't scan? Enter this key: <span style={{ fontFamily: "monospace", color: C.text.body }}>{qr.secret}</span></div>
        </div>
      ) : !error ? (
        <div style={{ fontSize: 13, color: C.text.muted, textAlign: "center", padding: "24px 0" }}>Loading…</div>
      ) : null}
      {error && <div style={s.err}><AlertTriangle size={14} style={{ flexShrink: 0 }} /> {error}</div>}
      {qr && (
        <>
          <input
            style={s.input}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            value={code}
            onChange={e => setCode(e.target.value.replace(/[^\d\s]/g, ""))}
            onKeyDown={e => { if (e.key === "Enter" && !busy && code.trim()) submit(); }}
          />
          <button style={s.btn(!busy && !!code.trim())} disabled={busy || !code.trim()} onClick={submit}>
            {busy ? "Checking…" : "Turn on"}
          </button>
        </>
      )}
      {onCancel && <button style={{ background: "transparent", border: "none", color: C.text.muted, fontSize: 13, cursor: "pointer", marginTop: 12, width: "100%" }} onClick={onCancel}>{forced ? "Start over" : "Cancel"}</button>}
    </>
  );
}
