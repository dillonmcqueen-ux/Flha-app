import { useState, useEffect } from "react";
import App from "./App.jsx";
import Dashboard from "./Dashboard.jsx";
import AdminPanel from "./AdminPanel.jsx";
import WorkerMenu from "./WorkerMenu.jsx";
import AuditorView from "./AuditorView.jsx";
import MfaSetup from "./MfaSetup.jsx";
import { KeyRound, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD, glow as GLOW } from "./theme";
import { setDraftUser } from "./useDraftAutosave.js";

// Session storage. Anyone who signed in as a named person (a roster row with a
// userId) goes in localStorage, which survives closing the browser, so a
// supervisor signs in once per working day instead of every time the window
// closes. How long that session lasts is bounded by the server, not the
// browser: 12 hours for supervisors and the Account Owner, 7 days for workers
// (server-lib/sessionTtl.js). A stale local copy just fails on the next API call.
//
// Founder sessions (the admin code, and the master code picking a company) have
// no userId and can reach every company's data, so they stay in sessionStorage,
// which the browser clears when its last window closes.
const SESSION_STORAGE_KEY = "fora_session";
function isPersistable(session) {
  return !!session && session.role !== "admin" && session.role !== "auditor" && !!session.userId; // an outside auditor never stays signed in after the window closes
}
function saveSession(session) {
  try {
    const store = isPersistable(session) ? localStorage : sessionStorage;
    store.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (e) {}
}
function loadSession() {
  try {
    const fromSession = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (fromSession) return JSON.parse(fromSession);

    const fromLocal = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!fromLocal) return null;
    const session = JSON.parse(fromLocal);
    // Anything in localStorage that is not a named person's session (an old
    // founder or shared-code session left over from before this change) is
    // cleared rather than silently restored.
    if (!isPersistable(session)) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return session;
  } catch (e) { return null; }
}
function clearSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (e) {}
}

export default function Login() {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null); // null (company code) or "admin" (founder access). The logged-in role always comes back from the server.
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [adminDashCompany, setAdminDashCompany] = useState(null); // admin viewing a specific company's dashboard

  // Company code (step 1 for everyone except the founder)
  const [companyCode, setCompanyCode] = useState("");
  // Set when a PIN or authenticator attempt hits the lockout, so the Account
  // Owner can ask for an emailed unlock link.
  const [lockedOut, setLockedOut] = useState(false);
  const [unlockNote, setUnlockNote] = useState("");

  // Roster login
  const [companyTicket, setCompanyTicket] = useState(null);
  const [rosterCompanyName, setRosterCompanyName] = useState("");
  const [rosterNames, setRosterNames] = useState([]);
  const [nameFilter, setNameFilter] = useState("");
  const [selectedRoster, setSelectedRoster] = useState(null); // { id, name }
  const [pin, setPin] = useState("");

  // Master-code login (picks any company, either role)
  const [masterTicket, setMasterTicket] = useState(null);
  const [masterCompanies, setMasterCompanies] = useState([]);
  const [companyFilter, setCompanyFilter] = useState("");
  const [pendingMasterCompanyId, setPendingMasterCompanyId] = useState(null);
  const [masterRole, setMasterRole] = useState("supervisor"); // which role the founder opens the company as

  // MFA (TOTP) — required on the admin role and master-code paths once
  // enrolled from the Admin Panel. See api/login.js's checkMfa.
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  // Per-person authenticator on roster logins. Set after a correct PIN when
  // the person must finish setting one up before they get a session.
  const [enrollTicket, setEnrollTicket] = useState(null);
  // The setup link is emailed, not returned. After a correct PIN the server
  // says "sent" and this holds a masked address to show.
  const [enrollLinkHint, setEnrollLinkHint] = useState(null);

  // Restore session on load
  useEffect(() => {
    // Arriving from the emailed authenticator setup link: go straight to setup.
    try {
      const params = new URLSearchParams(window.location.search);
      const setupToken = params.get("mfa_setup");
      if (setupToken) {
        window.history.replaceState({}, "", window.location.pathname);
        setEnrollTicket(setupToken);
        return;
      }
    } catch (e) { /* no URL access: fall through to the normal login */ }
    const s = loadSession();
    if (s && s.role) setSession(s);
  }, []);

  const resetToRolePick = () => {
    setRole(null);
    setCompanyCode("");
    setLockedOut(false);
    setUnlockNote("");
    setMasterRole("supervisor");
    setCode("");
    setError("");
    setCompanyTicket(null);
    setRosterCompanyName("");
    setRosterNames([]);
    setNameFilter("");
    setSelectedRoster(null);
    setPin("");
    setMasterTicket(null);
    setMasterCompanies([]);
    setCompanyFilter("");
    setPendingMasterCompanyId(null);
    setTotpRequired(false);
    setTotpCode("");
    setEnrollTicket(null);
    setEnrollLinkHint(null);
  };

  const handleSubmit = async () => {
    setError("");
    setChecking(true);
    const entered = code.trim();

    if (!entered) {
      setError("Please enter your code.");
      setChecking(false);
      return;
    }

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, code: entered, ...(totpRequired ? { totp: totpCode } : {}) }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setChecking(false);
        return;
      }

      if (totpRequired && data.stage === "need_totp") {
        setError("Incorrect code. Try again.");
        setTotpCode("");
        setChecking(false);
        return;
      }

      if (data.stage === "pick_company") {
        setMasterTicket(data.masterTicket);
        setMasterCompanies(data.companies || []);
        setChecking(false);
        return;
      }

      if (data.stage === "need_totp") {
        setTotpRequired(true);
        setChecking(false);
        return;
      }

      // data.session holds the role/company info; data.token is the signed
      // pass we'll use so other pages can prove this login was real.
      const s = { ...data.session, token: data.token };
      saveSession(s);
      setSession(s);
    } catch (e) {
      setError("Connection error. Please try again.");
    }
    setChecking(false);
  };

  const submitCompanyCode = async () => {
    const entered = companyCode.trim();
    if (!entered) { setError("Enter your company code."); return; }
    setError("");
    setChecking(true);
    try {
      const found = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "find_company", code: entered }),
      });
      const company = await found.json();
      if (!found.ok) {
        setError(company.error || "Something went wrong. Please try again.");
        setChecking(false);
        return;
      }
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_roster_names", companyTicket: company.companyTicket }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setChecking(false);
        return;
      }
      setCompanyTicket(company.companyTicket);
      setRosterCompanyName(company.companyName || "");
      setRosterNames(data.names || []);
    } catch (e) {
      setError("Connection error. Please try again.");
    }
    setChecking(false);
  };

  // The Account Owner's way back in after a lockout: an emailed single-use link.
  // The server answers the same whoever asks, so this never says whether it sent.
  const requestUnlockLink = async () => {
    if (!selectedRoster) return;
    setUnlockNote("");
    setChecking(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_unlock_link", companyTicket, rosterId: selectedRoster.id }),
      });
      const data = await res.json();
      setUnlockNote(res.ok
        ? "If you are the Account Owner and have an email on file, an unlock link is on its way. Check your inbox."
        : (data.error || "Something went wrong. Please try again."));
    } catch (e) {
      setUnlockNote("Connection error. Please try again.");
    }
    setChecking(false);
  };

  const pickRosterName = (member) => {
    setSelectedRoster(member);
    setPin("");
    setError("");
    setLockedOut(false);
    setUnlockNote("");
  };

  const pickMasterCompany = async (companyId) => {
    setError("");
    setChecking(true);
    setPendingMasterCompanyId(companyId);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "master_login", masterTicket, companyId, role: masterRole,
          ...(totpRequired ? { totp: totpCode } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setChecking(false);
        return;
      }
      if (data.stage === "need_totp") {
        if (totpRequired) {
          setError("Incorrect code. Try again.");
          setTotpCode("");
        }
        setTotpRequired(true);
        setChecking(false);
        return;
      }
      const s = { ...data.session, token: data.token };
      saveSession(s);
      setSession(s);
    } catch (e) {
      setError("Connection error. Please try again.");
    }
    setChecking(false);
  };

  const submitTotp = () => {
    if (selectedRoster) {
      submitPin(pin, totpCode.trim());
    } else if (pendingMasterCompanyId) {
      pickMasterCompany(pendingMasterCompanyId);
    } else {
      handleSubmit();
    }
  };

  const submitPin = async (pinValue, totpValue) => {
    setError("");
    setChecking(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "roster_login", companyTicket, rosterId: selectedRoster.id, pin: pinValue,
          ...(totpValue ? { totp: totpValue } : {}),
        }),
      });
      const data = await res.json();
      // Wrong authenticator code: stay on the code screen with the PIN kept.
      if (data.stage === "need_totp" && !res.ok) {
        setError(data.error || "Incorrect code. Try again.");
        setTotpCode("");
        setChecking(false);
        return;
      }
      if (!res.ok) {
        const msg = data.error || "Something went wrong. Please try again.";
        // PIN rejected or locked while on the code screen: back to the start.
        if (totpRequired) resetToRolePick();
        setLockedOut(!!data.locked);
        setError(msg);
        setPin("");
        setChecking(false);
        return;
      }
      if (data.stage === "need_totp") {
        setTotpRequired(true);
        setChecking(false);
        return;
      }
      if (data.stage === "enroll_link_sent") {
        setTotpRequired(false);
        setEnrollLinkHint(data.emailHint || "your email");
        setChecking(false);
        return;
      }
      const s = { ...data.session, token: data.token };
      saveSession(s);
      setSession(s);
    } catch (e) {
      setError("Connection error. Please try again.");
      setPin("");
    }
    setChecking(false);
  };

  // PINs moved from 4 to 6 digits (see docs/security/soc2-readiness-gaps.md
  // item 8) for anything newly set — but existing roster members keep
  // whatever length PIN they already have until it's reset, and login only
  // ever compares against the stored hash, never a fixed length. So this
  // auto-submits at the new 6-digit length (the common case going forward)
  // but never blocks someone with an older, shorter PIN from finishing:
  // Enter, or the "Log in" button below once 4+ digits are in, submits
  // whatever's typed so far.
  const onPinChange = (val) => {
    const digits = val.replace(/\D/g, "").slice(0, 6);
    setPin(digits);
    if (digits.length === 6) submitPin(digits);
  };

  const logout = () => {
    clearSession();
    setSession(null);
    resetToRolePick();
  };

  // ── Authenticated views ──────────────────────────────────
  // Drafts are keyed per signed-in user; set before any child form mounts.
  setDraftUser(session ? session.userId : null);
  if (session) {
    // An auditor is an outside reader. They get the read-only audit view and
    // nothing else, never the supervisor dashboard the fall-through below
    // would hand any other role.
    if (session.role === "auditor") {
      return <AuditorView token={session.token} companyName={session.companyName} userName={session.userName || ""} onLogout={logout} />;
    }

    if (session.role === "worker") {
      return <WorkerMenu companyId={session.companyId} companyName={session.companyName} userName={session.userName || ""} userId={session.userId || null} onLogout={logout} token={session.token} />;
    }

    if (session.role === "admin") {
      // Admin drilled into a specific company's FLHA dashboard
      if (adminDashCompany) {
        return (
          <Dashboard
            forcedCompanyId={adminDashCompany}
            isAdmin={false}
            viewerRole="admin"
            onLogout={() => setAdminDashCompany(null)}
            backLabel="← Back to onboarding"
            token={session.token}
          />
        );
      }
      // Admin home = onboarding panel
      return <AdminPanel onViewDashboard={(cid) => setAdminDashCompany(cid)} onLogout={logout} token={session.token} />;
    }

    // supervisor → their company dashboard
    return (
      <Dashboard
        forcedCompanyId={session.companyId}
        isAdmin={false}
        viewerRole="supervisor"
        onLogout={logout}
        suspended={session.suspended}
        userName={session.userName || ""}
        userId={session.userId || null}
        token={session.token}
      />
    );
  }

  // ── Styles ───────────────────────────────────────────────
  // Same design system as Dashboard.jsx/WorkerMenu.jsx (src/theme.js) —
  // dark surfaces, two-part shadows, orange glow accent — reskinned onto
  // theme tokens instead of hand-copied hex. No layout/logic changes.
  const styles = {
    wrap: {
      fontFamily: FONT.body,
      background: C.bg, minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16
    },
    card: {
      background: `linear-gradient(160deg, ${C.panelRaised} 0%, ${C.panel} 100%)`,
      borderRadius: RAD.xl, padding: 28, width: "100%", maxWidth: 420,
      border: `1px solid ${C.orangeDim}`, boxShadow: `${SHAD.lg}, ${GLOW.orangeSoft}`
    },
    roleBtn: (accent) => ({
      width: "100%", padding: "16px 18px", borderRadius: RAD.md, border: `1.5px solid ${C.line}`,
      background: C.panelInset, cursor: "pointer", marginBottom: 12, textAlign: "left",
      display: "flex", alignItems: "center", gap: 14, transition: "all 0.15s", minHeight: 64, boxSizing: "border-box"
    }),
    adminBtn: (accent) => ({
      width: "auto", padding: "8px 14px", borderRadius: RAD.md, border: `1.5px solid ${C.line}`,
      background: C.panelInset, cursor: "pointer", margin: "4px auto 0", textAlign: "left",
      display: "flex", alignItems: "center", gap: 8, transition: "all 0.15s", minHeight: 36, boxSizing: "border-box"
    }),
    input: {
      width: "100%", padding: "12px 14px", borderRadius: RAD.md, border: `1.5px solid ${C.orangeDim}`,
      background: C.panelInset, color: C.text.primary,
      fontSize: 16, boxSizing: "border-box", outline: "none", marginBottom: 12, minHeight: 46
    },
    primaryBtn: {
      width: "100%", background: C.orange, color: C.text.onOrange, border: "none", borderRadius: RAD.md,
      padding: "14px", fontWeight: 700, fontSize: 16, cursor: "pointer", minHeight: 48
    },
    backBtn: {
      width: "100%", background: C.panelInset, color: C.orange, border: `1.5px solid ${C.orangeDim}`, borderRadius: RAD.md,
      padding: "12px", fontWeight: 600, fontSize: 14, cursor: "pointer", marginTop: 10, minHeight: 44,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    },
    nameBtn: (active) => ({
      width: "100%", padding: "13px 14px", borderRadius: RAD.md, border: `1.5px solid ${active ? C.orange : C.line}`,
      background: active ? C.orangeSoft : C.panelInset, color: C.text.primary, cursor: "pointer", marginBottom: 8,
      textAlign: "left", fontSize: 15, display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 48, boxSizing: "border-box"
    }),
    pinDots: {
      display: "flex", justifyContent: "center", gap: 14, margin: "20px 0"
    },
    pinDot: (filled) => ({
      width: 18, height: 18, borderRadius: "50%",
      border: `1.5px solid ${C.orange}`, background: filled ? C.orange : "transparent"
    }),
  };

  const adminAccent = "#7C3AED";

  const filteredNames = rosterNames.filter(m => m.name.toLowerCase().includes(nameFilter.trim().toLowerCase()));
  const filteredMasterCompanies = masterCompanies.filter(c => c.name.toLowerCase().includes(companyFilter.trim().toLowerCase()));

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <img
            src="/fora-logo.png"
            alt="FORA Field Solutions"
            style={{ maxWidth: 220, maxHeight: 110, objectFit: "contain", marginBottom: 8 }}
          />
          <div style={{ fontSize: 13, color: C.text.muted }}>AI-powered field documentation portal</div>
        </div>

        {enrollLinkHint ? (
          // ── PIN accepted, but an authenticator must be set up first. The
          // link is in the person's inbox, not on this screen. ─────────────
          <>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 16, color: C.orange, marginBottom: 2 }}>Check your email</div>
            <div style={{ fontSize: 13, color: C.text.body, marginBottom: 16, lineHeight: 1.5 }}>
              Your role requires an authenticator app. We sent a setup link to {enrollLinkHint}. Open it, finish setup, and you'll be signed in. The link expires in 30 minutes.
            </div>
            <button style={styles.backBtn} onClick={resetToRolePick}><ChevronLeft size={14} /> Start over</button>
          </>
        ) : enrollTicket ? (
          // ── Forced authenticator setup, opened from the emailed link. No session
          // exists until the person confirms a code and saves their backup
          // codes; the session comes back from mfa_enroll_confirm. ────────
          <MfaSetup
            forced
            onCancel={resetToRolePick}
            start={async () => {
              try {
                const res = await fetch("/api/login", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "mfa_enroll_start", enrollTicket }),
                });
                const data = await res.json();
                return res.ok ? data : { error: data.error || "Couldn't start setup." };
              } catch (e) { return { error: "Connection error. Please try again." }; }
            }}
            confirm={async (codeValue) => {
              try {
                const res = await fetch("/api/login", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "mfa_enroll_confirm", enrollTicket, code: codeValue }),
                });
                const data = await res.json();
                return res.ok ? data : { error: data.error || "Incorrect code. Try again." };
              } catch (e) { return { error: "Connection error. Please try again." }; }
            }}
            onDone={(result) => {
              const s = { ...result.session, token: result.token };
              saveSession(s);
              setSession(s);
            }}
          />
        ) : totpRequired ? (
          // ── MFA challenge — required on the admin role and master-code
          // paths once enrolled from the Admin Panel ──────────────────
          <>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 16, color: C.orange, marginBottom: 2 }}>Enter your authenticator code</div>
            <div style={{ fontSize: 12, color: C.text.muted, marginBottom: 16 }}>Or a backup code, if you don't have your device.</div>

            <input
              style={styles.input}
              type="text"
              inputMode="numeric"
              placeholder="6-digit code or backup code"
              value={totpCode}
              onChange={e => setTotpCode(e.target.value)}
              autoFocus
              onKeyDown={e => { if (e.key === "Enter" && !checking) submitTotp(); }}
            />

            {error && (
              <div style={{ background: C.status.danger.bg, border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "10px 12px", margin: "12px 0", fontSize: 13, color: C.status.danger.text, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} /> {error}
              </div>
            )}

            <button style={styles.primaryBtn} disabled={checking || !totpCode.trim()} onClick={submitTotp}>
              {checking ? "Checking…" : "Verify"}
            </button>
            <button style={styles.backBtn} onClick={resetToRolePick}><ChevronLeft size={14} /> Start over</button>
          </>
        ) : masterTicket ? (
          // ── Master code: pick any company ──────────────────────────
          <>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 16, color: C.orange, marginBottom: 2 }}>Master login</div>
            <div style={{ fontSize: 12, color: C.text.muted, marginBottom: 10 }}>Pick a company, and whether to open it as a worker or a supervisor.</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {["supervisor", "worker"].map(r => (
                <button key={r} style={{ ...styles.nameBtn(masterRole === r), justifyContent: "center", marginBottom: 0, textTransform: "capitalize" }} onClick={() => setMasterRole(r)}>{r}</button>
              ))}
            </div>

            <input
              style={styles.input}
              type="text"
              placeholder="Type to filter…"
              value={companyFilter}
              onChange={e => setCompanyFilter(e.target.value)}
              autoFocus
            />

            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {filteredMasterCompanies.length === 0 && (
                <div style={{ fontSize: 13, color: C.text.muted, textAlign: "center", padding: "12px 0" }}>No companies match.</div>
              )}
              {filteredMasterCompanies.map(c => (
                <button key={c.id} style={styles.nameBtn(false)} disabled={checking} onClick={() => pickMasterCompany(c.id)}>
                  <span>{c.name}</span>
                </button>
              ))}
            </div>

            {error && (
              <div style={{ background: C.status.danger.bg, border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "10px 12px", margin: "12px 0", fontSize: 13, color: C.status.danger.text, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} /> {error}
              </div>
            )}

            <button style={styles.backBtn} onClick={resetToRolePick}><ChevronLeft size={14} /> Start over</button>
          </>
        ) : companyTicket && !selectedRoster ? (
          // ── Step 2: pick your name from this company's active roster ──
          <>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 16, color: C.orange, marginBottom: 2 }}>{rosterCompanyName}</div>
            <div style={{ fontSize: 12, color: C.text.muted, marginBottom: 16 }}>Which of these is you?</div>

            <input
              style={styles.input}
              type="text"
              placeholder="Start typing your name…"
              value={nameFilter}
              onChange={e => setNameFilter(e.target.value)}
              autoFocus
            />

            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {nameFilter.trim().length === 0 ? (
                <div style={{ fontSize: 13, color: C.text.muted, textAlign: "center", padding: "12px 0" }}>Start typing to find your name.</div>
              ) : filteredNames.length === 0 ? (
                <div style={{ fontSize: 13, color: C.text.muted, textAlign: "center", padding: "12px 0" }}>No names match.</div>
              ) : (
                filteredNames.map(m => (
                  <button key={m.id} style={styles.nameBtn(false)} onClick={() => pickRosterName(m)}>
                    <span>{m.name}</span>
                  </button>
                ))
              )}
            </div>

            {error && (
              <div style={{ background: C.status.danger.bg, border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "10px 12px", margin: "12px 0", fontSize: 13, color: C.status.danger.text, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} /> {error}
              </div>
            )}

            <button style={styles.backBtn} onClick={resetToRolePick}><ChevronLeft size={14} /> Start over</button>
          </>
        ) : companyTicket && selectedRoster ? (
          // ── Step 3: PIN ──────────────────────────────────────────────
          <>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 16, color: C.orange, marginBottom: 2 }}>{selectedRoster.name}</div>
            <div style={{ fontSize: 12, color: C.text.muted, marginBottom: 8 }}>Enter your PIN</div>

            <input
              style={{ ...styles.input, textAlign: "center", fontSize: 28, letterSpacing: 12, marginBottom: 0 }}
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              onChange={e => onPinChange(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && pin.length >= 4 && !checking) submitPin(pin); }}
              autoFocus
              disabled={checking}
            />
            <div style={styles.pinDots}>
              {[0, 1, 2, 3, 4, 5].map(i => <div key={i} style={styles.pinDot(i < pin.length)} />)}
            </div>

            {error && (
              <div style={{ background: C.status.danger.bg, border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: C.status.danger.text, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} /> {error}
              </div>
            )}

            {pin.length >= 4 && pin.length < 6 && (
              <button style={{ ...styles.primaryBtn, marginBottom: 10 }} disabled={checking} onClick={() => submitPin(pin)}>
                {checking ? "Checking…" : "Log in"}
              </button>
            )}

            {lockedOut && (
              <div style={{ marginBottom: 10 }}>
                <button style={styles.backBtn} disabled={checking} onClick={requestUnlockLink}>
                  Account Owner? Email me an unlock link
                </button>
                {unlockNote && <div style={{ fontSize: 12, color: C.text.muted, marginTop: 8, lineHeight: 1.5 }}>{unlockNote}</div>}
              </div>
            )}

            <button style={styles.backBtn} onClick={() => { setSelectedRoster(null); setPin(""); setError(""); setLockedOut(false); setUnlockNote(""); }}>
              <ChevronLeft size={14} /> Not {selectedRoster.name}?
            </button>
          </>
        ) : role === "admin" ? (
          // ── Founder access: admin code or master code ───────────────
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <KeyRound size={26} strokeWidth={2} color={adminAccent} />
              <div>
                <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 16, color: C.orange }}>Founder access</div>
                <div style={{ fontSize: 12, color: C.text.muted }}>Enter your admin code</div>
              </div>
            </div>

            <input
              style={styles.input}
              type="password"
              placeholder="Admin code"
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
              autoFocus
            />

            {error && (
              <div style={{ background: C.status.danger.bg, border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: C.status.danger.text, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} /> {error}
              </div>
            )}

            <button style={{ ...styles.primaryBtn, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={handleSubmit} disabled={checking}>
              {checking ? "Checking…" : (<>Continue <ChevronRight size={16} /></>)}
            </button>
            <button style={styles.backBtn} onClick={resetToRolePick}>
              <ChevronLeft size={14} /> Back
            </button>
          </>
        ) : (
          // ── Step 1: type your company code ──────────────────────────
          <>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 16, color: C.orange, marginBottom: 2 }}>Sign in</div>
            <div style={{ fontSize: 12, color: C.text.muted, marginBottom: 16 }}>Enter your company code. Your supervisor can give it to you.</div>

            <input
              style={{ ...styles.input, textTransform: "uppercase", letterSpacing: 1 }}
              type="text"
              placeholder="Company code"
              value={companyCode}
              onChange={e => { setCompanyCode(e.target.value); setError(""); }}
              onKeyDown={e => { if (e.key === "Enter" && !checking) submitCompanyCode(); }}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
            />

            {error && (
              <div style={{ background: C.status.danger.bg, border: `1px solid ${C.status.danger.border}`, borderRadius: RAD.sm, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: C.status.danger.text, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} /> {error}
              </div>
            )}

            <button style={{ ...styles.primaryBtn, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={submitCompanyCode} disabled={checking || !companyCode.trim()}>
              {checking ? "Checking…" : (<>Continue <ChevronRight size={16} /></>)}
            </button>

            <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
              <button style={styles.adminBtn(adminAccent)} onClick={() => { setRole("admin"); setError(""); setCode(""); }}>
                <KeyRound size={15} strokeWidth={2.25} color={adminAccent} />
                <span style={{ fontWeight: 600, fontSize: 12, color: C.text.muted }}>Founder access</span>
              </button>
            </div>
          </>
        )}
      </div>

      <div style={{ position: "fixed", bottom: 14, left: 0, right: 0, textAlign: "center", fontSize: 12, color: C.text.faint }}>
        <a href="https://forafieldsolutions.com/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: C.text.faint }}>Privacy Policy</a>
        <span style={{ margin: "0 8px" }}>·</span>
        <a href="https://forafieldsolutions.com/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: C.text.faint }}>Terms of Use</a>
      </div>
    </div>
  );
}
