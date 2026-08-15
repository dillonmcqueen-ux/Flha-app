import { useState, useEffect } from "react";
import App from "./App.jsx";
import Dashboard from "./Dashboard.jsx";
import AdminPanel from "./AdminPanel.jsx";
import WorkerMenu from "./WorkerMenu.jsx";

// Session storage — split by role. window.name survives a reload but not a
// fully closed-and-reopened tab, which is exactly the case that matters most
// for a worker relaunching the app from a home-screen icon on a jobsite with
// no signal (docs/scope-offline-capability.md Phase 0), so worker sessions
// still go in localStorage, which survives that.
//
// Supervisor and (especially) admin sessions are a different risk profile —
// an admin session can reach every company's data, so leaving it in
// localStorage means it's still logged in the next time anyone opens that
// browser, indefinitely (bounded only by the server's 7-day TTL), even after
// Chrome is fully closed and reopened. That's the exact bug reported: closed
// Chrome while logged in as admin, reopened later, still logged in. Elevated
// roles now go in sessionStorage instead, which Chrome clears when the
// browser's last window/tab closes — the offline-worker case doesn't apply
// to a supervisor/admin, who are on the portal, not the field app. Server-
// side sessions still carry their own 7-day TTL (SESSION_TTL_MS in
// api/*.js) — a stale local copy just fails on the next API call either way.
const SESSION_STORAGE_KEY = "fora_session";
function storageFor(role) {
  return role === "worker" ? localStorage : sessionStorage;
}
function saveSession(session) {
  try { storageFor(session?.role).setItem(SESSION_STORAGE_KEY, JSON.stringify(session)); } catch (e) {}
}
function loadSession() {
  try {
    const fromSession = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (fromSession) return JSON.parse(fromSession);

    const fromLocal = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!fromLocal) return null;
    const session = JSON.parse(fromLocal);
    // A supervisor/admin session found in localStorage is either a leftover
    // from before this fix, or (impossible under the current saveSession,
    // but checked defensively) otherwise misplaced — either way, elevated
    // roles are never meant to persist past a closed browser. Clear it and
    // sign the user out rather than silently restoring an admin session.
    if (session && session.role !== "worker") {
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
      background: "#0A0A0A", minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16
    },
    card: {
      background: "#161616", borderRadius: 16, padding: 28, width: "100%", maxWidth: 420,
      border: "1px solid #F9731640", boxShadow: "0 4px 30px #F9731622"
    },
    roleBtn: (accent) => ({
      width: "100%", padding: "16px 18px", borderRadius: 12, border: "1.5px solid #2A2A2A",
      background: "#1E1E1E", cursor: "pointer", marginBottom: 12, textAlign: "left",
      display: "flex", alignItems: "center", gap: 14, transition: "all 0.15s"
    }),
    adminBtn: (accent) => ({
      width: "auto", padding: "8px 14px", borderRadius: 10, border: "1.5px solid #2A2A2A",
      background: "#1E1E1E", cursor: "pointer", margin: "4px auto 0", textAlign: "left",
      display: "flex", alignItems: "center", gap: 8, transition: "all 0.15s"
    }),
    input: {
      width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #F9731660",
      background: "#1E1E1E", color: "#fff",
      fontSize: 16, boxSizing: "border-box", outline: "none", marginBottom: 12
    },
    primaryBtn: {
      width: "100%", background: "#F97316", color: "#fff", border: "none", borderRadius: 10,
      padding: "13px", fontWeight: 700, fontSize: 16, cursor: "pointer"
    },
    backBtn: {
      width: "100%", background: "#1E1E1E", color: "#F97316", border: "1.5px solid #F9731660", borderRadius: 10,
      padding: "11px", fontWeight: 600, fontSize: 14, cursor: "pointer", marginTop: 10
    },
    nameBtn: (active) => ({
      width: "100%", padding: "13px 14px", borderRadius: 10, border: `1.5px solid ${active ? "#F97316" : "#2A2A2A"}`,
      background: active ? "#2A1A0F" : "#1E1E1E", color: "#fff", cursor: "pointer", marginBottom: 8,
      textAlign: "left", fontSize: 15, display: "flex", justifyContent: "space-between", alignItems: "center"
    }),
    pinDots: {
      display: "flex", justifyContent: "center", gap: 14, margin: "20px 0"
    },
    pinDot: (filled) => ({
      width: 18, height: 18, borderRadius: "50%",
      border: "1.5px solid #F97316", background: filled ? "#F97316" : "transparent"
    }),
  };

  const roleMeta = {
    worker: { icon: "🦺", title: "Worker", desc: "Complete a hazard assessment", accent: "#F97316" },
    supervisor: { icon: "📋", title: "Supervisor / Safety", desc: "View your company dashboard", accent: "#1E3A5F" },
    admin: { icon: "🔑", title: "Admin", desc: "Access all companies", accent: "#7C3AED" },
  };

  const filteredNames = rosterNames.filter(m => m.name.toLowerCase().includes(nameFilter.trim().toLowerCase()));
  const filteredMasterCompanies = masterCompanies.filter(c => c.name.toLowerCase().includes(companyFilter.trim().toLowerCase()));

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <img
            src="/fora-logo.png"
            alt="FORA"
            style={{ maxWidth: 180, maxHeight: 90, objectFit: "contain", marginBottom: 8 }}
          />
          <div style={{ fontSize: 13, color: "#9CA3AF" }}>AI-powered field documentation portal</div>
        </div>

        {!role ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#9CA3AF", marginBottom: 12, textAlign: "center" }}>
              Select your role to continue
            </div>
            {["worker", "supervisor"].map(r => {
              const m = roleMeta[r];
              return (
                <button key={r} style={styles.roleBtn(m.accent)} onClick={() => { setRole(r); setError(""); setCode(""); }}>
                  <span style={{ fontSize: 26 }}>{m.icon}</span>
                  <span>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 15, color: "#F97316" }}>{m.title}</span>
                    <span style={{ display: "block", fontSize: 12, color: "#9CA3AF" }}>{m.desc}</span>
                  </span>
                </button>
              );
            })}

            <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
              <button style={styles.adminBtn(roleMeta.admin.accent)} onClick={() => { setRole("admin"); setError(""); setCode(""); }}>
                <span style={{ fontSize: 15 }}>{roleMeta.admin.icon}</span>
                <span style={{ fontWeight: 600, fontSize: 12, color: "#9CA3AF" }}>{roleMeta.admin.title}</span>
              </button>
            </div>
          </>
        ) : masterTicket ? (
          // ── Master code: pick any company ──────────────────────────
          <>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#F97316", marginBottom: 2 }}>Master login</div>
            <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 16 }}>Pick a company to log into as {role}.</div>

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
                <div style={{ fontSize: 13, color: "#9CA3AF", textAlign: "center", padding: "12px 0" }}>No companies match.</div>
              )}
              {filteredMasterCompanies.map(c => (
                <button key={c.id} style={styles.nameBtn(false)} disabled={checking} onClick={() => pickMasterCompany(c.id)}>
                  <span>{c.name}</span>
                </button>
              ))}
            </div>

            {error && (
              <div style={{ background: "#2A1212", border: "1px solid #DC262660", borderRadius: 8, padding: "10px 12px", margin: "12px 0", fontSize: 13, color: "#FCA5A5" }}>
                {error}
              </div>
            )}

            <button style={styles.backBtn} onClick={resetToRolePick}>← Start over</button>
          </>
        ) : companyTicket && !selectedRoster ? (
          // ── Step 2: pick your name from this company's active roster ──
          <>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#F97316", marginBottom: 2 }}>{rosterCompanyName}</div>
            <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 16 }}>Which of these is you?</div>

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
                <div style={{ fontSize: 13, color: "#9CA3AF", textAlign: "center", padding: "12px 0" }}>Start typing to find your name.</div>
              ) : filteredNames.length === 0 ? (
                <div style={{ fontSize: 13, color: "#9CA3AF", textAlign: "center", padding: "12px 0" }}>No names match.</div>
              ) : (
                filteredNames.map(m => (
                  <button key={m.id} style={styles.nameBtn(false)} onClick={() => pickRosterName(m)}>
                    <span>{m.name}</span>
                    <span style={{ fontSize: 11, color: "#9CA3AF", textTransform: "uppercase" }}>{m.role}</span>
                  </button>
                ))
              )}
            </div>

            {error && (
              <div style={{ background: "#2A1212", border: "1px solid #DC262660", borderRadius: 8, padding: "10px 12px", margin: "12px 0", fontSize: 13, color: "#FCA5A5" }}>
                {error}
              </div>
            )}

            <button style={styles.backBtn} onClick={resetToRolePick}>← Start over</button>
          </>
        ) : companyTicket && selectedRoster ? (
          // ── Step 3: PIN ──────────────────────────────────────────────
          <>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#F97316", marginBottom: 2 }}>{selectedRoster.name}</div>
            <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 8 }}>Enter your 4-digit PIN</div>

            <input
              style={{ ...styles.input, textAlign: "center", fontSize: 28, letterSpacing: 12, marginBottom: 0 }}
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={pin}
              onChange={e => onPinChange(e.target.value)}
              autoFocus
              disabled={checking}
            />
            <div style={styles.pinDots}>
              {[0, 1, 2, 3].map(i => <div key={i} style={styles.pinDot(i < pin.length)} />)}
            </div>

            {error && (
              <div style={{ background: "#2A1212", border: "1px solid #DC262660", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: "#FCA5A5" }}>
                {error}
              </div>
            )}

            <button style={styles.backBtn} onClick={() => { setSelectedRoster(null); setPin(""); setError(""); }}>
              ← Not {selectedRoster.name}?
            </button>
          </>
        ) : (
          // ── Step 1: admin code, or company code ─────────────────────
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 26 }}>{roleMeta[role].icon}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#F97316" }}>{roleMeta[role].title}</div>
                <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                  {role === "admin" ? "Enter your admin code" : "Enter your company code"}
                </div>
              </div>
            </div>

            <input
              style={styles.input}
              type="text"
              placeholder={role === "admin" ? "Admin code" : "Company code"}
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
              autoFocus
            />
            <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 12 }}>
              Codes are case sensitive — enter it exactly as given.
            </div>

            {error && (
              <div style={{ background: "#2A1212", border: "1px solid #DC262660", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: "#FCA5A5" }}>
                {error}
              </div>
            )}

            <button style={styles.primaryBtn} onClick={handleSubmit} disabled={checking}>
              {checking ? "Checking…" : "Continue →"}
            </button>
            <button style={styles.backBtn} onClick={resetToRolePick}>
              ← Back
            </button>
          </>
        )}
      </div>

      <div style={{ position: "fixed", bottom: 14, left: 0, right: 0, textAlign: "center", fontSize: 12, color: "#6B7280" }}>
        <a href="https://forafieldsolutions.com/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: "#6B7280" }}>Privacy Policy</a>
        <span style={{ margin: "0 8px" }}>·</span>
        <a href="https://forafieldsolutions.com/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: "#6B7280" }}>Terms of Use</a>
      </div>
    </div>
  );
}
