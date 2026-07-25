import { useState, useEffect } from "react";

function fmtClock(iso) {
  return new Date(iso).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
}
function fmtElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const sec = String(totalSec % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

export default function TimeClock({ companyId, companyName, userName = "", userId, onBack, token }) {
  const [status, setStatus] = useState(null); // { open, recent } | null while loading
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  const loadStatus = async () => {
    try {
      const res = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "my_time_status", token }),
      });
      const data = await res.json();
      if (res.ok) setStatus(data);
      else setError(data.error || "Couldn't load your time clock status.");
    } catch (e) {
      setError("Connection error. Please try again.");
    }
    setLoading(false);
  };

  useEffect(() => { loadStatus(); }, [token]);

  useEffect(() => {
    if (!status?.open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status?.open]);

  const toggle = async () => {
    setError("");
    setWorking(true);
    try {
      const res = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: status?.open ? "clock_out" : "clock_in", token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setWorking(false);
        return;
      }
      await loadStatus();
    } catch (e) {
      setError("Connection error. Please try again.");
    }
    setWorking(false);
  };

  const s = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#F0F4F8", minHeight: "100vh", padding: 16 },
    header: { background: "linear-gradient(135deg,#0E7490,#0891B2)", borderRadius: 14, padding: "18px 20px", marginBottom: 16, color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" },
    card: { background: "#fff", borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: "0 1px 3px #0f172a12" },
    row: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #F3F4F6" },
  };

  const elapsedMs = status?.open ? now - new Date(status.open.clock_in).getTime() : 0;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 26 }}>⏱️</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>Time Clock</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{companyName}{userName ? ` · ${userName}` : ""}</div>
          </div>
        </div>
        <button onClick={onBack} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>← Menu</button>
      </div>

      <div style={{ ...s.card, textAlign: "center" }}>
        {loading ? (
          <div style={{ color: "#9CA3AF", padding: "20px 0" }}>Loading…</div>
        ) : (
          <>
            {status?.open ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5 }}>Clocked in since {fmtClock(status.open.clock_in)}</div>
                <div style={{ fontSize: 40, fontWeight: 800, color: "#0E7490", margin: "10px 0", fontVariantNumeric: "tabular-nums" }}>{fmtElapsed(elapsedMs)}</div>
              </>
            ) : (
              <div style={{ fontSize: 14, color: "#6B7280", margin: "10px 0 20px" }}>You're not clocked in.</div>
            )}
            <button
              onClick={toggle}
              disabled={working}
              style={{
                width: "100%", padding: "16px", borderRadius: 12, border: "none", cursor: "pointer",
                fontWeight: 800, fontSize: 17, color: "#fff",
                background: working ? "#94A3B8" : status?.open ? "#DC2626" : "#16A34A",
              }}
            >
              {working ? "Please wait…" : status?.open ? "Clock Out" : "Clock In"}
            </button>
            {error && <div style={{ marginTop: 12, color: "#DC2626", fontSize: 13, fontWeight: 600 }}>{error}</div>}
          </>
        )}
      </div>

      <div style={s.card}>
        <div style={{ fontWeight: 800, fontSize: 15, color: "#1E293B", marginBottom: 4 }}>Your recent entries</div>
        <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 8 }}>Only a supervisor can correct a punch — if one looks wrong, let them know.</div>
        {!loading && (!status?.recent || status.recent.length === 0) ? (
          <div style={{ color: "#9CA3AF", padding: "14px 0", textAlign: "center" }}>No entries yet.</div>
        ) : (
          status?.recent?.map((e, i, arr) => {
            const hours = e.clock_out ? (new Date(e.clock_out) - new Date(e.clock_in)) / 3600000 : null;
            return (
              <div key={e.id} style={{ ...s.row, borderBottom: i < arr.length - 1 ? s.row.borderBottom : "none" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#1E293B" }}>{fmtDate(e.clock_in)}</div>
                  <div style={{ fontSize: 12, color: "#6B7280" }}>{fmtClock(e.clock_in)} – {e.clock_out ? fmtClock(e.clock_out) : "in progress"}</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#0E7490" }}>{hours != null ? `${hours.toFixed(2)} hrs` : "—"}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
