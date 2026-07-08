import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import App from "./App.jsx";
import Dashboard from "./Dashboard.jsx";
import AdminPanel from "./AdminPanel.jsx";

const ADMIN_CODE = "admin_2023";

// Session storage keys — kept in memory for the browser session
function saveSession(session) {
  try { window.name = JSON.stringify(session); } catch (e) {}
}
function loadSession() {
  try { return window.name ? JSON.parse(window.name) : null; } catch (e) { return null; }
}
function clearSession() {
  try { window.name = ""; } catch (e) {}
}

export default function Login() {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null); // "worker" | "supervisor" | "admin"
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [adminDashCompany, setAdminDashCompany] = useState(null); // admin viewing a specific company's dashboard

  // Restore session on load
  useEffect(() => {
    const s = loadSession();
    if (s && s.role) setSession(s);
  }, []);

  const handleSubmit = async () => {
    setError("");
    setChecking(true);
    const entered = code.trim();

    if (!entered) {
      setError("Please enter a code.");
      setChecking(false);
      return;
    }

    // Admin path — master code, no company lookup
    if (role === "admin") {
      if (entered === ADMIN_CODE) {
        const s = { role: "admin", companyId: null };
        saveSession(s);
        setSession(s);
      } else {
        setError("Incorrect admin code.");
      }
      setChecking(false);
      return;
    }

    // Worker / Supervisor — look up company by matching code
    const column = role === "supervisor" ? "supervisor_code" : "worker_code";
    const { data, error: qErr } = await supabase
      .from("companies")
      .select("id, name, worker_code, supervisor_code")
      .eq(column, entered)
      .limit(1);

    if (qErr) {
      setError("Connection error. Please try again.");
      setChecking(false);
      return;
    }
    if (!data || data.length === 0) {
      setError("Code not recognized. Check with your supervisor.");
      setChecking(false);
      return;
    }

    const company = data[0];
    const s = { role, companyId: company.id, companyName: company.name };
    saveSession(s);
    setSession(s);
    setChecking(false);
  };

  const logout = () => {
    clearSession();
    setSession(null);
    setRole(null);
    setCode("");
    setError("");
  };

  // ── Authenticated views ──────────────────────────────────
  if (session) {
    if (session.role === "worker") {
      return <App forcedCompanyId={session.companyId} onLogout={logout} />;
    }

    if (session.role === "admin") {
      // Admin drilled into a specific company's FLHA dashboard
      if (adminDashCompany) {
        return (
          <Dashboard
            forcedCompanyId={adminDashCompany}
            isAdmin={false}
            onLogout={() => setAdminDashCompany(null)}
            backLabel="← Back to onboarding"
          />
        );
      }
      // Admin home = onboarding panel
      return <AdminPanel onViewDashboard={(cid) => setAdminDashCompany(cid)} onLogout={logout} />;
    }

    // supervisor → their company dashboard
    return (
      <Dashboard
        forcedCompanyId={session.companyId}
        isAdmin={false}
        onLogout={logout}
      />
    );
  }

  // ── Styles ───────────────────────────────────────────────
  const styles = {
    wrap: {
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      background: "#F0F4F8", minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16
    },
    card: {
      background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 420,
      boxShadow: "0 4px 24px #0002"
    },
    roleBtn: (accent) => ({
      width: "100%", padding: "16px 18px", borderRadius: 12, border: "1.5px solid #E5E7EB",
      background: "#fff", cursor: "pointer", marginBottom: 12, textAlign: "left",
      display: "flex", alignItems: "center", gap: 14, transition: "all 0.15s"
    }),
    input: {
      width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid #E5E7EB",
      fontSize: 16, boxSizing: "border-box", outline: "none", marginBottom: 12
    },
    primaryBtn: {
      width: "100%", background: "#F97316", color: "#fff", border: "none", borderRadius: 10,
      padding: "13px", fontWeight: 700, fontSize: 16, cursor: "pointer"
    },
    backBtn: {
      width: "100%", background: "#F3F4F6", color: "#374151", border: "none", borderRadius: 10,
      padding: "11px", fontWeight: 600, fontSize: 14, cursor: "pointer", marginTop: 10
    },
  };

  const roleMeta = {
    worker: { icon: "🦺", title: "Worker", desc: "Complete a hazard assessment", accent: "#F97316" },
    supervisor: { icon: "📋", title: "Supervisor / Safety", desc: "View your company dashboard", accent: "#1E3A5F" },
    admin: { icon: "🔑", title: "Admin", desc: "Access all companies", accent: "#7C3AED" },
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 6 }}>🦺</div>
          <div style={{ fontWeight: 800, fontSize: 22, color: "#1E3A5F" }}>SafeField FLHA</div>
          <div style={{ fontSize: 13, color: "#6B7280" }}>AI-powered Field Level Hazard Assessment</div>
        </div>

        {!role ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#6B7280", marginBottom: 12, textAlign: "center" }}>
              Select your role to continue
            </div>
            {["worker", "supervisor", "admin"].map(r => {
              const m = roleMeta[r];
              return (
                <button key={r} style={styles.roleBtn(m.accent)} onClick={() => { setRole(r); setError(""); setCode(""); }}>
                  <span style={{ fontSize: 26 }}>{m.icon}</span>
                  <span>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 15, color: "#1E3A5F" }}>{m.title}</span>
                    <span style={{ display: "block", fontSize: 12, color: "#6B7280" }}>{m.desc}</span>
                  </span>
                </button>
              );
            })}
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 26 }}>{roleMeta[role].icon}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#1E3A5F" }}>{roleMeta[role].title}</div>
                <div style={{ fontSize: 12, color: "#6B7280" }}>
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

            {error && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: "#991B1B" }}>
                {error}
              </div>
            )}

            <button style={styles.primaryBtn} onClick={handleSubmit} disabled={checking}>
              {checking ? "Checking…" : "Continue →"}
            </button>
            <button style={styles.backBtn} onClick={() => { setRole(null); setError(""); setCode(""); }}>
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
