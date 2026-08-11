import { useState, useEffect } from "react";
import {
  HardHat, ClipboardText, Key, Lock, ArrowLeft, ArrowRight,
  MagnifyingGlass, WarningCircle, CircleNotch, CaretRight,
} from "@phosphor-icons/react";
import App from "./App.jsx";
import Dashboard from "./Dashboard.jsx";
import AdminPanel from "./AdminPanel.jsx";
import WorkerMenu from "./WorkerMenu.jsx";

// Session storage — kept in memory for the browser session
function saveSession(session) {
  try { window.name = JSON.stringify(session); } catch (e) {}
}
function loadSession() {
  try { return window.name ? JSON.parse(window.name) : null; } catch (e) { return null; }
}
function clearSession() {
  try { window.name = ""; } catch (e) {}
}

// Scoped styles for interaction states (:hover / :focus-visible / :active /
// prefers-reduced-motion) that plain inline style objects can't express.
const CSS = `
.flha-login { --accent: #F97316; --accent-dim: #F9731633; --accent-mid: #F9731660; }
.flha-login *, .flha-login *::before, .flha-login *::after { box-sizing: border-box; }
.flha-login button { font-family: inherit; touch-action: manipulation; }
.flha-login .role-btn { cursor: pointer; }
.flha-login .role-btn:hover { border-color: var(--accent-mid); background: #202020; transform: translateY(-1px); }
.flha-login .role-btn:active { transform: translateY(0) scale(0.99); }
.flha-login .admin-btn { cursor: pointer; }
.flha-login .admin-btn:hover { border-color: var(--accent-mid); background: #202020; }
.flha-login .name-btn { cursor: pointer; }
.flha-login .name-btn:hover { border-color: var(--accent-mid); background: #232323; }
.flha-login .primary-btn { cursor: pointer; }
.flha-login .primary-btn:hover:not(:disabled) { background: #FB8332; }
.flha-login .primary-btn:active:not(:disabled) { transform: scale(0.98); }
.flha-login .primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.flha-login .back-btn { cursor: pointer; }
.flha-login .back-btn:hover { background: #232323; }
.flha-login .text-input { cursor: text; }
.flha-login .text-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
.flha-login button:focus-visible,
.flha-login a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.flha-login .pin-dot { transition: transform 150ms ease, background 150ms ease; }
.flha-login .pin-dot.filled { transform: scale(1.1); }
.flha-login .step-enter { animation: flha-fade-in 220ms ease-out both; }
.flha-login .error-banner { animation: flha-fade-in 180ms ease-out both; }
.flha-login .spin { animation: flha-spin 800ms linear infinite; }
@keyframes flha-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes flha-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .flha-login .role-btn, .flha-login .primary-btn, .flha-login .step-enter,
  .flha-login .error-banner, .flha-login .pin-dot, .flha-login .spin {
    animation: none !important;
    transition: none !important;
    transform: none !important;
  }
}
`;

function ErrorBanner({ children }) {
  if (!children) return null;
  return (
    <div
      className="error-banner"
      role="alert"
      style={{
        background: "#2A1212", border: "1px solid #DC262660", borderRadius: 10,
        padding: "10px 12px", marginBottom: 12, fontSize: 13.5, color: "#FCA5A5",
        display: "flex", alignItems: "flex-start", gap: 8,
      }}
    >
      <WarningCircle size={18} weight="fill" style={{ flexShrink: 0, marginTop: 1, color: "#F87171" }} />
      <span>{children}</span>
    </div>
  );
}

export default function Login() {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null); // "worker" | "supervisor" | "admin" — only used to pick the code-entry copy/legacy lookup column; the actual logged-in role comes back from the server
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [adminDashCompany, setAdminDashCompany] = useState(null); // admin viewing a specific company's dashboard

  // Roster login (companies that have cut over from the shared code)
  const [companyTicket, setCompanyTicket] = useState(null);
  const [rosterCompanyName, setRosterCompanyName] = useState("");
  const [rosterNames, setRosterNames] = useState([]);
  const [nameFilter, setNameFilter] = useState("");
  const [selectedRoster, setSelectedRoster] = useState(null); // { id, name, role }
  const [pin, setPin] = useState("");

  // Master-code login (picks any company, either role)
  const [masterTicket, setMasterTicket] = useState(null);
  const [masterCompanies, setMasterCompanies] = useState([]);
  const [companyFilter, setCompanyFilter] = useState("");

  // Restore session on load
  useEffect(() => {
    const s = loadSession();
    if (s && s.role) setSession(s);
  }, []);

  const resetToRolePick = () => {
    setRole(null);
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
  };

  const handleSubmit = async () => {
    setError("");
    setChecking(true);
    const entered = code.trim();

    if (!entered) {
      setError("Please enter a code.");
      setChecking(false);
      return;
    }

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, code: entered }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setChecking(false);
        return;
      }

      if (data.stage === "pick_company") {
        setMasterTicket(data.masterTicket);
        setMasterCompanies(data.companies || []);
        setChecking(false);
        return;
      }

      if (data.stage === "need_identity") {
        // This company has moved to individual roster logins — fetch the
        // active name list and move on to the picker instead of logging in.
        setCompanyTicket(data.companyTicket);
        setRosterCompanyName(data.companyName || "");
        try {
          const namesRes = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "list_roster_names", companyTicket: data.companyTicket }),
          });
          const namesData = await namesRes.json();
          if (!namesRes.ok) {
            setError(namesData.error || "Something went wrong. Please try again.");
            setChecking(false);
            return;
          }
          setRosterNames(namesData.names || []);
        } catch (e) {
          setError("Connection error. Please try again.");
        }
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

  const pickRosterName = (member) => {
    setSelectedRoster(member);
    setPin("");
    setError("");
  };

  const pickMasterCompany = async (companyId) => {
    setError("");
    setChecking(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "master_login", masterTicket, companyId, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
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

  const submitPin = async (pinValue) => {
    setError("");
    setChecking(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "roster_login", companyTicket, rosterId: selectedRoster.id, pin: pinValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setPin("");
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

  const onPinChange = (val) => {
    const digits = val.replace(/\D/g, "").slice(0, 4);
    setPin(digits);
    if (digits.length === 4) submitPin(digits);
  };

  const logout = () => {
    clearSession();
    setSession(null);
    resetToRolePick();
  };

  // ── Authenticated views ──────────────────────────────────
  if (session) {
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
  const styles = {
    wrap: {
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      background: "radial-gradient(circle at 18% 12%, #1E140A 0%, #0A0A0A 42%), #0A0A0A",
      minHeight: "100dvh",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    },
    card: {
      background: "#161616", borderRadius: 18, padding: 28, width: "100%", maxWidth: 420,
      border: "1px solid #F9731640", boxShadow: "0 24px 60px -20px #000000CC, 0 4px 30px #F9731622",
    },
    label: {
      display: "block", fontSize: 12.5, fontWeight: 600, color: "#B5BAC4", marginBottom: 6,
    },
    input: {
      width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #2E2E2E",
      background: "#1E1E1E", color: "#fff",
      fontSize: 16, boxSizing: "border-box", outline: "none", marginBottom: 8,
      minHeight: 46, transition: "border-color 150ms ease, box-shadow 150ms ease",
    },
    primaryBtn: {
      width: "100%", background: "#F97316", color: "#fff", border: "none", borderRadius: 10,
      padding: "13px", fontWeight: 700, fontSize: 16, minHeight: 48,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      transition: "background 150ms ease, transform 100ms ease",
    },
    backBtn: {
      width: "100%", background: "#1E1E1E", color: "#F97316", border: "1.5px solid #F9731660", borderRadius: 10,
      padding: "11px", fontWeight: 600, fontSize: 14, marginTop: 10, minHeight: 44,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      transition: "background 150ms ease",
    },
    nameBtn: (active) => ({
      width: "100%", padding: "13px 14px", borderRadius: 10, border: `1.5px solid ${active ? "#F97316" : "#2A2A2A"}`,
      background: active ? "#2A1A0F" : "#1E1E1E", color: "#fff", marginBottom: 8, minHeight: 44,
      textAlign: "left", fontSize: 15, display: "flex", justifyContent: "space-between", alignItems: "center",
      transition: "border-color 150ms ease, background 150ms ease",
    }),
    pinDots: {
      display: "flex", justifyContent: "center", gap: 14, margin: "20px 0",
    },
    pinDot: (filled) => ({
      width: 18, height: 18, borderRadius: "50%",
      border: "1.5px solid #F97316", background: filled ? "#F97316" : "transparent",
    }),
  };

  const roleMeta = {
    worker: { Icon: HardHat, title: "Worker", desc: "Complete a hazard assessment", accent: "#F97316" },
    supervisor: { Icon: ClipboardText, title: "Supervisor / Safety", desc: "View your company dashboard", accent: "#5B9BD5" },
    admin: { Icon: Key, title: "Admin", desc: "Access all companies", accent: "#A78BFA" },
  };

  const filteredNames = rosterNames.filter(m => m.name.toLowerCase().includes(nameFilter.trim().toLowerCase()));
  const filteredMasterCompanies = masterCompanies.filter(c => c.name.toLowerCase().includes(companyFilter.trim().toLowerCase()));

  return (
    <div className="flha-login" style={styles.wrap}>
      <style>{CSS}</style>
      <div style={styles.card}>
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <img
            src="/fora-logo.png"
            alt="FORA"
            style={{ maxWidth: 180, maxHeight: 90, objectFit: "contain", marginBottom: 10 }}
          />
          <div style={{ fontSize: 13.5, color: "#A3A3AA", letterSpacing: 0.2 }}>AI-powered field documentation portal</div>
        </div>

        {!role ? (
          <div className="step-enter" key="role-pick">
            <div style={{ fontSize: 13, fontWeight: 600, color: "#A3A3AA", marginBottom: 12, textAlign: "center" }}>
              Select your role to continue
            </div>
            {["worker", "supervisor"].map(r => {
              const m = roleMeta[r];
              const Icon = m.Icon;
              return (
                <button
                  key={r}
                  className="role-btn"
                  style={{
                    width: "100%", padding: "16px 18px", borderRadius: 12, border: "1.5px solid #2A2A2A",
                    background: "#1E1E1E", marginBottom: 12, textAlign: "left",
                    display: "flex", alignItems: "center", gap: 14, transition: "border-color 150ms ease, background 150ms ease, transform 100ms ease",
                  }}
                  onClick={() => { setRole(r); setError(""); setCode(""); }}
                >
                  <span style={{
                    width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: `${m.accent}22`, color: m.accent,
                  }}>
                    <Icon size={24} weight="regular" />
                  </span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 15, color: "#F5F5F5" }}>{m.title}</span>
                    <span style={{ display: "block", fontSize: 12.5, color: "#A3A3AA" }}>{m.desc}</span>
                  </span>
                  <CaretRight size={18} color="#6B7280" style={{ flexShrink: 0 }} />
                </button>
              );
            })}

            <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
              <button
                className="admin-btn"
                style={{
                  width: "auto", padding: "9px 16px", borderRadius: 10, border: "1.5px solid #2A2A2A",
                  background: "#1E1E1E", margin: "4px auto 0", minHeight: 40,
                  display: "flex", alignItems: "center", gap: 8, transition: "border-color 150ms ease, background 150ms ease",
                }}
                onClick={() => { setRole("admin"); setError(""); setCode(""); }}
              >
                <Key size={15} color="#A3A3AA" />
                <span style={{ fontWeight: 600, fontSize: 12.5, color: "#A3A3AA" }}>{roleMeta.admin.title}</span>
              </button>
            </div>
          </div>
        ) : masterTicket ? (
          // ── Master code: pick any company ──────────────────────────
          <div className="step-enter" key="master-pick">
            <div style={{ fontWeight: 700, fontSize: 16, color: "#F97316", marginBottom: 2 }}>Master login</div>
            <div style={{ fontSize: 12.5, color: "#A3A3AA", marginBottom: 16 }}>Pick a company to log into as {role}.</div>

            <label style={styles.label} htmlFor="company-filter">Filter companies</label>
            <div style={{ position: "relative", marginBottom: 8 }}>
              <MagnifyingGlass size={17} color="#6B7280" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }} />
              <input
                id="company-filter"
                className="text-input"
                style={{ ...styles.input, paddingLeft: 38 }}
                type="text"
                placeholder="Type to filter…"
                value={companyFilter}
                onChange={e => setCompanyFilter(e.target.value)}
                autoFocus
              />
            </div>

            <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 8 }}>
              {filteredMasterCompanies.length === 0 && (
                <div style={{ fontSize: 13, color: "#A3A3AA", textAlign: "center", padding: "12px 0" }}>No companies match.</div>
              )}
              {filteredMasterCompanies.map(c => (
                <button key={c.id} className="name-btn" style={styles.nameBtn(false)} disabled={checking} onClick={() => pickMasterCompany(c.id)}>
                  <span>{c.name}</span>
                  <CaretRight size={16} color="#6B7280" />
                </button>
              ))}
            </div>

            <ErrorBanner>{error}</ErrorBanner>

            <button className="back-btn" style={styles.backBtn} onClick={resetToRolePick}>
              <ArrowLeft size={15} /> Start over
            </button>
          </div>
        ) : companyTicket && !selectedRoster ? (
          // ── Step 2: pick your name from this company's active roster ──
          <div className="step-enter" key="roster-pick">
            <div style={{ fontWeight: 700, fontSize: 16, color: "#F97316", marginBottom: 2 }}>{rosterCompanyName}</div>
            <div style={{ fontSize: 12.5, color: "#A3A3AA", marginBottom: 16 }}>Which of these is you?</div>

            <label style={styles.label} htmlFor="name-filter">Your name</label>
            <div style={{ position: "relative", marginBottom: 8 }}>
              <MagnifyingGlass size={17} color="#6B7280" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }} />
              <input
                id="name-filter"
                className="text-input"
                style={{ ...styles.input, paddingLeft: 38 }}
                type="text"
                placeholder="Start typing your name…"
                value={nameFilter}
                onChange={e => setNameFilter(e.target.value)}
                autoFocus
              />
            </div>

            <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 8 }}>
              {nameFilter.trim().length === 0 ? (
                <div style={{ fontSize: 13, color: "#A3A3AA", textAlign: "center", padding: "12px 0" }}>Start typing to find your name.</div>
              ) : filteredNames.length === 0 ? (
                <div style={{ fontSize: 13, color: "#A3A3AA", textAlign: "center", padding: "12px 0" }}>No names match.</div>
              ) : (
                filteredNames.map(m => (
                  <button key={m.id} className="name-btn" style={styles.nameBtn(false)} onClick={() => pickRosterName(m)}>
                    <span>{m.name}</span>
                    <span style={{ fontSize: 11, color: "#A3A3AA", textTransform: "uppercase", letterSpacing: 0.3 }}>{m.role}</span>
                  </button>
                ))
              )}
            </div>

            <ErrorBanner>{error}</ErrorBanner>

            <button className="back-btn" style={styles.backBtn} onClick={resetToRolePick}>
              <ArrowLeft size={15} /> Start over
            </button>
          </div>
        ) : companyTicket && selectedRoster ? (
          // ── Step 3: PIN ──────────────────────────────────────────────
          <div className="step-enter" key="pin-entry">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "#F9731622", color: "#F97316",
              }}>
                <Lock size={20} weight="regular" />
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#F5F5F5" }}>{selectedRoster.name}</div>
                <div style={{ fontSize: 12.5, color: "#A3A3AA" }}>Enter your 4-digit PIN</div>
              </div>
            </div>

            <label style={{ ...styles.label, textAlign: "center", marginTop: 12 }} htmlFor="pin-input">PIN</label>
            <input
              id="pin-input"
              className="text-input"
              style={{ ...styles.input, textAlign: "center", fontSize: 28, letterSpacing: 12, marginBottom: 0, fontVariantNumeric: "tabular-nums" }}
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={pin}
              onChange={e => onPinChange(e.target.value)}
              autoFocus
              disabled={checking}
              aria-label="4-digit PIN"
            />
            <div style={styles.pinDots}>
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`pin-dot${i < pin.length ? " filled" : ""}`} style={styles.pinDot(i < pin.length)} />
              ))}
            </div>

            {checking && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#A3A3AA", fontSize: 13, marginBottom: 12 }}>
                <CircleNotch size={16} className="spin" />
                Checking…
              </div>
            )}

            <ErrorBanner>{error}</ErrorBanner>

            <button className="back-btn" style={styles.backBtn} onClick={() => { setSelectedRoster(null); setPin(""); setError(""); }}>
              <ArrowLeft size={15} /> Not {selectedRoster.name}?
            </button>
          </div>
        ) : (
          // ── Step 1: admin code, or company code ─────────────────────
          <div className="step-enter" key="code-entry">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              {(() => {
                const m = roleMeta[role];
                const Icon = m.Icon;
                return (
                  <span style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: `${m.accent}22`, color: m.accent,
                  }}>
                    <Icon size={20} weight="regular" />
                  </span>
                );
              })()}
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#F5F5F5" }}>{roleMeta[role].title}</div>
                <div style={{ fontSize: 12.5, color: "#A3A3AA" }}>
                  {role === "admin" ? "Enter your admin code" : "Enter your company code"}
                </div>
              </div>
            </div>

            <label style={styles.label} htmlFor="access-code">
              {role === "admin" ? "Admin code" : "Company code"}
            </label>
            <input
              id="access-code"
              className="text-input"
              style={styles.input}
              type="text"
              placeholder={role === "admin" ? "Admin code" : "e.g. FORA-1234"}
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <div style={{ fontSize: 12, color: "#8B8F99", marginBottom: 14 }}>
              Codes are case sensitive — enter it exactly as given.
            </div>

            <ErrorBanner>{error}</ErrorBanner>

            <button className="primary-btn" style={styles.primaryBtn} onClick={handleSubmit} disabled={checking}>
              {checking ? (
                <>
                  <CircleNotch size={18} className="spin" /> Checking…
                </>
              ) : (
                <>
                  Continue <ArrowRight size={17} />
                </>
              )}
            </button>
            <button className="back-btn" style={styles.backBtn} onClick={resetToRolePick}>
              <ArrowLeft size={15} /> Back
            </button>
          </div>
        )}
      </div>

      <div style={{ position: "fixed", bottom: 14, left: 0, right: 0, textAlign: "center", fontSize: 12, color: "#6B7280", padding: "0 16px" }}>
        <a href="https://forafieldsolutions.com/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: "#8B8F99" }}>Privacy Policy</a>
        <span style={{ margin: "0 8px" }}>·</span>
        <a href="https://forafieldsolutions.com/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: "#8B8F99" }}>Terms of Use</a>
      </div>
    </div>
  );
}
