// src/AccountSecurity.jsx
// Optional two-step sign-in for people whose role does not require it.
// (Supervisors and anyone in Safety, HR or Payroll are sent through setup at
// login instead, see Login.jsx.) Reset requests go to whoever sits above
// them: supervisors reset workers, the founder resets everyone else.
import { useState, useEffect } from "react";
import { colors as C, font as FONT, radius as RAD } from "./theme";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import MfaSetup from "./MfaSetup.jsx";

async function call(body) {
  try {
    const res = await fetch("/api/companydata", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return res.ok ? data : { error: data.error || "Something went wrong." };
  } catch (e) {
    return { error: "Connection error. Please try again." };
  }
}

export default function AccountSecurity({ token, onBack }) {
  const [status, setStatus] = useState(null); // { enabled, required } | { error }
  const [setup, setSetup] = useState(false);
  const [offCode, setOffCode] = useState("");
  const [offError, setOffError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await call({ action: "get_my_mfa_status", token });
    setStatus(r);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const turnOff = async () => {
    setOffError("");
    setBusy(true);
    const r = await call({ action: "mfa_self_disable", token, code: offCode.trim() });
    setBusy(false);
    if (r.error) { setOffError(r.error); return; }
    setOffCode("");
    load();
  };

  const card = { background: `linear-gradient(160deg, ${C.panelRaised} 0%, ${C.panel} 100%)`, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: "18px 16px" };
  const btn = (on) => ({ width: "100%", padding: "13px", borderRadius: RAD.md, border: "none", background: on ? C.orange : C.line, color: on ? "#fff" : C.text.faint, fontWeight: 700, fontSize: 15, cursor: on ? "pointer" : "default", minHeight: 44 });

  return (
    <div style={{ fontFamily: FONT.body, background: C.bg, minHeight: "100vh", color: C.text.primary }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "18px 16px 40px" }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none", color: C.text.muted, fontSize: 14, cursor: "pointer", marginBottom: 14, padding: 0, minHeight: 36 }}>
          <ChevronLeft size={16} /> Back
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT.heading, fontWeight: 700, fontSize: 18, marginBottom: 14 }}>
          <ShieldCheck size={20} color={C.orange} /> Sign-in security
        </div>

        <div style={card}>
          {!status ? (
            <div style={{ fontSize: 13, color: C.text.muted }}>Loading…</div>
          ) : status.error ? (
            <div style={{ fontSize: 13, color: C.status.danger.text }}>{status.error}</div>
          ) : status.applicable === false ? (
            <div style={{ fontSize: 13, color: C.text.muted }}>This login does not have its own authenticator.</div>
          ) : setup ? (
            <MfaSetup
              onCancel={() => setSetup(false)}
              start={async () => call({ action: "mfa_self_enroll_start", token })}
              confirm={async (code) => call({ action: "mfa_self_enroll_confirm", token, code })}
              onDone={() => { setSetup(false); load(); }}
            />
          ) : status.enabled ? (
            <>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Two-step sign-in is on</div>
              <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 14, lineHeight: 1.5 }}>
                {status.required
                  ? "Your role requires it, so it can't be turned off here. If you lose your phone and your backup codes, ask your supervisor or administrator to reset it."
                  : "You'll enter a code from your authenticator app after your PIN. To turn it off, enter a current code."}
              </div>
              {!status.required && (
                <>
                  <input
                    type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code"
                    value={offCode} onChange={e => setOffCode(e.target.value)}
                    style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: RAD.md, border: `1.5px solid ${C.line}`, background: C.panelInset, color: C.text.primary, fontSize: 16, marginBottom: 10 }}
                  />
                  {offError && <div style={{ fontSize: 13, color: C.status.danger.text, marginBottom: 10 }}>{offError}</div>}
                  <button style={btn(!busy && !!offCode.trim())} disabled={busy || !offCode.trim()} onClick={turnOff}>
                    {busy ? "Checking…" : "Turn off"}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Two-step sign-in is off</div>
              <div style={{ fontSize: 13, color: C.text.muted, marginBottom: 14, lineHeight: 1.5 }}>
                Add a code from an authenticator app on top of your PIN. Optional for your role.
              </div>
              <button style={btn(true)} onClick={() => setSetup(true)}>Set up</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
