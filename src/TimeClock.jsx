import { useState, useEffect } from "react";
import { getPunchLocation } from "./punchLocation";
import { colors as C, font as FONT, radius as RAD, shadow as SHAD, glow as GLOW } from "./theme";
import { Clock, ChevronLeft, MapPin, CalendarClock, AlertTriangle } from "lucide-react";

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

// Same design system as WorkerMenu.jsx (src/theme.js) — dark surfaces,
// two-part shadows, orange glow accent. This screen is used to punch in/out
// on a phone in the field, so the clock-in/out button stays large (full-
// width, tall) and the status text stays high-contrast for outdoor use.
// `clockOutOnly`: the company no longer has Time Clock (break #27). The worker
// only gets here to close a shift that was already open, so there is no
// Clock In button once it is closed; the server refuses clock_in anyway.
export default function TimeClock({ companyId, companyName, userName = "", userId, onBack, token, clockOutOnly = false }) {
  const [status, setStatus] = useState(null); // { open, recent } | null while loading
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
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
    setGettingLocation(true);
    try {
      const loc = await getPunchLocation();
      setGettingLocation(false);
      const res = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: status?.open ? "clock_out" : "clock_in", token, lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setWorking(false);
        return;
      }
      if (loc.lat == null) setError("Punched in, but location wasn't available.");
      await loadStatus();
    } catch (e) {
      setError("Connection error. Please try again.");
    }
    setWorking(false);
  };

  const s = {
    wrap: { fontFamily: FONT.body, background: C.bg, minHeight: "100vh", color: C.text.primary },
    body: { padding: "18px 16px 40px", maxWidth: 640, margin: "0 auto" },
    card: {
      background: `linear-gradient(160deg, ${C.panelRaised} 0%, ${C.panel} 100%)`,
      border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: 20,
      boxShadow: SHAD.md, marginBottom: 14,
    },
    row: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${C.line}` },
  };

  const elapsedMs = status?.open ? now - new Date(status.open.clock_in).getTime() : 0;
  const clockedIn = !!status?.open;

  return (
    <div style={s.wrap}>
      <header style={{
        position: "sticky", top: 0, zIndex: 40,
        background: "rgba(10,10,10,0.88)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        borderBottom: `1px solid ${C.line}`, padding: "14px 20px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div style={{
            width: 38, height: 38, borderRadius: RAD.md, flexShrink: 0,
            background: C.orangeSoft, border: `1px solid ${C.orangeDim}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Clock size={19} color={C.orange} strokeWidth={2.25} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.text.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {companyName}{userName ? ` · ${userName}` : ""}
            </div>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 17, color: C.text.primary, letterSpacing: "-0.01em" }}>Time Clock</div>
          </div>
        </div>
        {onBack && (
          <button onClick={onBack} style={{
            display: "flex", alignItems: "center", gap: 6, color: C.text.body, fontSize: 13,
            border: `1px solid ${C.line}`, background: "transparent", padding: "8px 14px",
            borderRadius: RAD.md, cursor: "pointer", fontWeight: 600, flexShrink: 0, minHeight: 36,
          }}>
            <ChevronLeft size={14} /> Menu
          </button>
        )}
      </header>

      <div style={s.body}>
        <div style={{ ...s.card, textAlign: "center", position: "relative", overflow: "hidden" }}>
          {clockedIn && (
            <div style={{
              position: "absolute", width: 280, height: 280, borderRadius: "50%",
              background: `radial-gradient(circle, ${C.status.success.bg} 0%, transparent 68%)`,
              top: -140, right: -100, pointerEvents: "none",
            }} />
          )}
          <div style={{ position: "relative" }}>
            {loading ? (
              <div style={{ color: C.text.muted, padding: "20px 0" }}>Loading…</div>
            ) : (
              <>
                {clockedIn ? (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.status.success.text, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Clocked in since {fmtClock(status.open.clock_in)}
                    </div>
                    <div style={{ fontFamily: FONT.heading, fontSize: "clamp(34px,10vw,44px)", fontWeight: 700, color: C.text.primary, margin: "10px 0", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
                      {fmtElapsed(elapsedMs)}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 14, color: C.text.muted, margin: "10px 0 20px" }}>You're not clocked in.</div>
                )}
                {!clockedIn && clockOutOnly ? (
                  <div style={{ fontSize: 13, color: C.text.muted }}>
                    Time Clock isn't part of your company's plan anymore, so you can't clock in. Your recorded hours are kept.
                  </div>
                ) : (
                  <button
                    onClick={toggle}
                    disabled={working}
                    style={{
                      width: "100%", padding: "17px", borderRadius: RAD.md, border: "none", cursor: working ? "default" : "pointer",
                      fontWeight: 800, fontSize: 17, color: "#fff", minHeight: 56,
                      background: working ? C.panelInset : clockedIn ? C.status.danger.solid : C.status.success.solid,
                      boxShadow: working ? "none" : clockedIn ? `0 0 0 1px ${C.status.danger.border}` : `0 0 0 1px ${C.status.success.border}`,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    }}
                  >
                    {gettingLocation ? (<><MapPin size={18} /> Getting location…</>) : working ? "Please wait…" : clockedIn ? "Clock Out" : "Clock In"}
                  </button>
                )}
                {error && (
                  <div style={{
                    marginTop: 12, display: "flex", alignItems: "center", gap: 6, justifyContent: "center",
                    color: C.status.danger.text, fontSize: 13, fontWeight: 600,
                  }}>
                    <AlertTriangle size={14} /> {error}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div style={s.card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <CalendarClock size={16} color={C.text.muted} />
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 15, color: C.text.primary }}>Your recent entries</div>
          </div>
          <div style={{ fontSize: 12, color: C.text.faint, marginBottom: 8 }}>Only a supervisor can correct a punch — if one looks wrong, let them know.</div>
          {!loading && (!status?.recent || status.recent.length === 0) ? (
            <div style={{ color: C.text.muted, padding: "14px 0", textAlign: "center" }}>No entries yet.</div>
          ) : (
            status?.recent?.map((e, i, arr) => {
              const hours = e.clock_out ? (new Date(e.clock_out) - new Date(e.clock_in)) / 3600000 : null;
              return (
                <div key={e.id} style={{ ...s.row, borderBottom: i < arr.length - 1 ? s.row.borderBottom : "none" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.text.primary }}>{fmtDate(e.clock_in)}</div>
                    <div style={{ fontSize: 12, color: C.text.muted }}>{fmtClock(e.clock_in)} – {e.clock_out ? fmtClock(e.clock_out) : "in progress"}</div>
                  </div>
                  <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 13, color: hours != null ? C.orange : C.text.faint, fontVariantNumeric: "tabular-nums" }}>
                    {hours != null ? `${hours.toFixed(2)} hrs` : "—"}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
