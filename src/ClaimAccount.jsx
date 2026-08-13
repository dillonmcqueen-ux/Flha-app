import { useEffect, useState } from "react";

// Public claim-link page — no login required, same pattern as
// src/Onboarding.jsx. A brand-new company's contact lands here from the
// email sent right after admin approval to finish setup themselves:
// assign PINs to their own roster (never emailed in plaintext), and
// review/confirm the AI-drafted equipment and SOPs before either is saved
// or (for SOPs) visible to workers. Every write this page makes is scoped
// server-side by the claim token — see resolveClaimRequest in
// api/login.js — never by anything this page sends as a company id.

const styles = {
  wrap: {
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    background: "#0A0A0A", minHeight: "100vh",
    display: "flex", justifyContent: "center", padding: "40px 16px",
  },
  card: {
    background: "#161616", borderRadius: 16, padding: 32, width: "100%", maxWidth: 720,
    border: "1px solid #F9731640", boxShadow: "0 4px 30px #F9731622", height: "fit-content", marginBottom: 20,
  },
  h1: { fontSize: 22, fontWeight: 700, color: "#fff" },
  h2: { fontSize: 15, fontWeight: 700, color: "#F97316", marginBottom: 10, marginTop: 4 },
  hint: { fontSize: 12, color: "#9CA3AF", marginBottom: 12 },
  input: {
    padding: "10px 12px", borderRadius: 8, border: "1.5px solid #2A2A2A",
    background: "#1E1E1E", color: "#fff", fontSize: 14, boxSizing: "border-box", outline: "none",
  },
  row: { display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" },
  primaryBtn: {
    background: "#F97316", color: "#fff", border: "none", borderRadius: 8,
    padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer",
  },
  ghostBtn: {
    background: "transparent", color: "#9CA3AF", border: "1px solid #2A2A2A", borderRadius: 8,
    padding: "10px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer",
  },
  code: { fontFamily: "monospace", background: "#1E1E1E", padding: "2px 8px", borderRadius: 6, color: "#F97316", fontWeight: 700 },
};

export default function ClaimAccount() {
  const claimToken = new URLSearchParams(window.location.search).get("token") || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [company, setCompany] = useState(null);
  const [roster, setRoster] = useState([]);
  const [equipmentDraft, setEquipmentDraft] = useState([]);
  const [sopDrafts, setSopDrafts] = useState([]);
  const [draftStatus, setDraftStatus] = useState("pending");
  const [pins, setPins] = useState({}); // { [rosterId]: "1234" }
  const [pinSaved, setPinSaved] = useState({}); // { [rosterId]: true }
  const [pinSaving, setPinSaving] = useState(null);
  const [equipmentConfirmed, setEquipmentConfirmed] = useState(false);
  const [sopsConfirmed, setSopsConfirmed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim_get_details", claimToken }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "That claim link isn't valid."); setLoading(false); return; }
      setCompany(data.company);
      setRoster(data.roster || []);
      setEquipmentDraft((data.equipmentDraft || []).map((r) => ({ ...r })));
      setSopDrafts(data.sopDrafts || []);
      setDraftStatus(data.draftStatus || "pending");
      if (data.equipmentDraft?.length === 0) setEquipmentConfirmed(true);
      if (data.sopDrafts?.length === 0) setSopsConfirmed(true);
    } catch (e) {
      setError("Couldn't load your claim link. Please try again.");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!claimToken) { setError("Missing claim link."); setLoading(false); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimToken]);

  const savePin = async (rosterId) => {
    const pin = (pins[rosterId] || "").trim();
    if (!/^\d{4}$/.test(pin)) { setMsg("Enter a 4-digit PIN."); return; }
    setPinSaving(rosterId);
    setMsg("");
    try {
      const res = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim_set_roster_pin", claimToken, rosterId, pin }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Couldn't save that PIN."); setPinSaving(null); return; }
      setPinSaved((p) => ({ ...p, [rosterId]: true }));
    } catch (e) {
      setMsg("Couldn't save that PIN.");
    }
    setPinSaving(null);
  };

  const updateEquipmentField = (idx, field, value) => {
    setEquipmentDraft((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };
  const removeEquipmentRow = (idx) => setEquipmentDraft((rows) => rows.filter((_, i) => i !== idx));

  const confirmEquipment = async () => {
    setMsg("");
    try {
      const res = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim_confirm_equipment", claimToken, items: equipmentDraft }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Couldn't save equipment."); return; }
      setEquipmentConfirmed(true);
    } catch (e) {
      setMsg("Couldn't save equipment.");
    }
  };

  const updateSopText = (idx, value) => setSopDrafts((rows) => rows.map((r, i) => (i === idx ? value : r)));
  const removeSop = (idx) => setSopDrafts((rows) => rows.filter((_, i) => i !== idx));

  const confirmSops = async () => {
    setMsg("");
    try {
      const res = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim_confirm_sops", claimToken, policies: sopDrafts }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Couldn't save SOPs."); return; }
      setSopsConfirmed(true);
    } catch (e) {
      setMsg("Couldn't save SOPs.");
    }
  };

  const finish = async () => {
    try {
      await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim_finalize", claimToken }),
      });
    } catch (e) { /* not fatal — everything already saved individually */ }
    setFinished(true);
  };

  if (loading) {
    return <div style={styles.wrap}><div style={{ ...styles.card, maxWidth: 480, textAlign: "center", marginTop: 80 }}>Loading…</div></div>;
  }
  if (error) {
    return (
      <div style={styles.wrap}>
        <div style={{ ...styles.card, maxWidth: 480, textAlign: "center", marginTop: 80 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#F97316", marginBottom: 8 }}>Link not available</div>
          <div style={{ fontSize: 14, color: "#9CA3AF" }}>{error}</div>
        </div>
      </div>
    );
  }
  if (finished) {
    return (
      <div style={styles.wrap}>
        <div style={{ ...styles.card, maxWidth: 480, textAlign: "center", marginTop: 80 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#F97316", marginBottom: 8 }}>You're all set</div>
          <div style={{ fontSize: 14, color: "#9CA3AF", lineHeight: 1.6 }}>
            Your team can log in now with company code <span style={styles.code}>{company?.company_code}</span> and the PINs you set.
            This link still works if you need to come back and finish anything.
          </div>
        </div>
      </div>
    );
  }

  const allPinsSet = roster.length === 0 || roster.every((m) => pinSaved[m.id]);

  return (
    <div style={styles.wrap}>
      <div style={{ width: "100%", maxWidth: 720 }}>
        <div style={styles.card}>
          <div style={styles.h1}>Welcome to FORA, {company?.name}</div>
          <div style={{ fontSize: 13, color: "#9CA3AF", marginTop: 6 }}>
            Company code: <span style={styles.code}>{company?.company_code}</span>
          </div>
          <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 10 }}>
            Finish setup below — none of this was emailed to you as plaintext credentials, so this is the only place PINs get set.
          </div>
        </div>

        {roster.length > 0 && (
          <div style={styles.card}>
            <div style={styles.h2}>Assign PINs to your team</div>
            <div style={styles.hint}>Give each person a 4-digit PIN — they'll use their name + this PIN to log in.</div>
            {roster.map((m) => (
              <div key={m.id} style={styles.row}>
                <div style={{ width: 200, color: "#fff", fontSize: 14 }}>{m.name} <span style={{ color: "#9CA3AF", fontSize: 12 }}>({m.role})</span></div>
                <input
                  style={{ ...styles.input, width: 90 }} inputMode="numeric" maxLength={4}
                  placeholder="1234"
                  value={pins[m.id] || ""}
                  onChange={(e) => setPins((p) => ({ ...p, [m.id]: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                />
                <button style={styles.primaryBtn} disabled={pinSaving === m.id} onClick={() => savePin(m.id)}>
                  {pinSaved[m.id] ? "✓ Saved — change" : pinSaving === m.id ? "Saving…" : "Save PIN"}
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={styles.card}>
          <div style={styles.h2}>Equipment — confirm the draft we parsed</div>
          {draftStatus === "pending" ? (
            <div style={styles.hint}>Still preparing your equipment draft — <button style={{ ...styles.ghostBtn, padding: "2px 8px" }} onClick={load}>refresh</button></div>
          ) : equipmentDraft.length === 0 ? (
            <div style={styles.hint}>{equipmentConfirmed ? "No equipment to add — you can add units any time from the app." : "We couldn't draft anything from what was submitted — you can add equipment later from the app."}</div>
          ) : equipmentConfirmed ? (
            <div style={styles.hint}>✓ Equipment saved.</div>
          ) : (
            <>
              <div style={styles.hint}>Edit anything that's off, remove anything that's wrong, then confirm — nothing is saved until you do.</div>
              {equipmentDraft.map((eq, i) => (
                <div key={i} style={styles.row}>
                  <input style={{ ...styles.input, width: 70 }} placeholder="Year" value={eq.year || ""} onChange={(e) => updateEquipmentField(i, "year", e.target.value)} />
                  <input style={{ ...styles.input, width: 130 }} placeholder="Make" value={eq.make || ""} onChange={(e) => updateEquipmentField(i, "make", e.target.value)} />
                  <input style={{ ...styles.input, width: 130 }} placeholder="Model" value={eq.model || ""} onChange={(e) => updateEquipmentField(i, "model", e.target.value)} />
                  <input style={{ ...styles.input, width: 100 }} placeholder="Unit #" value={eq.unitNumber || ""} onChange={(e) => updateEquipmentField(i, "unitNumber", e.target.value)} />
                  <button style={styles.ghostBtn} onClick={() => removeEquipmentRow(i)}>Remove</button>
                </div>
              ))}
              <button style={styles.primaryBtn} onClick={confirmEquipment}>Confirm equipment</button>
            </>
          )}
        </div>

        <div style={styles.card}>
          <div style={styles.h2}>SOPs — review before your team sees them</div>
          {draftStatus === "pending" ? (
            <div style={styles.hint}>Still preparing your SOP draft — <button style={{ ...styles.ghostBtn, padding: "2px 8px" }} onClick={load}>refresh</button></div>
          ) : sopDrafts.length === 0 ? (
            <div style={styles.hint}>{sopsConfirmed ? "No SOPs added yet — you can add them any time from the app." : "We couldn't draft anything from your uploaded files — your raw files are still saved on file; add SOPs manually from the app."}</div>
          ) : sopsConfirmed ? (
            <div style={styles.hint}>✓ SOPs saved.</div>
          ) : (
            <>
              <div style={styles.hint}>These stay hidden from your workers and from generated paperwork until you confirm them here.</div>
              {sopDrafts.map((s, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <textarea
                    style={{ ...styles.input, width: "100%", minHeight: 50, resize: "vertical", boxSizing: "border-box" }}
                    value={s} onChange={(e) => updateSopText(i, e.target.value)}
                  />
                  <button style={{ ...styles.ghostBtn, marginTop: 4 }} onClick={() => removeSop(i)}>Remove</button>
                </div>
              ))}
              <button style={styles.primaryBtn} onClick={confirmSops}>Confirm SOPs</button>
            </>
          )}
        </div>

        {msg && (
          <div style={{ ...styles.card, background: "#2A1212", border: "1px solid #DC262660", color: "#FCA5A5", fontSize: 13, padding: "10px 12px" }}>{msg}</div>
        )}

        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <button style={{ ...styles.primaryBtn, opacity: allPinsSet ? 1 : 0.6 }} onClick={finish}>
            {allPinsSet ? "Finish" : "Finish (some PINs not set yet)"}
          </button>
        </div>
      </div>
    </div>
  );
}
