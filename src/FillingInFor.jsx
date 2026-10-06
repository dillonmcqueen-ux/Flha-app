// src/FillingInFor.jsx
// "Filling this in for ..." for a crew lead on the two documents that capture
// no personal signature (Daily Report, Fuel Log). Shows nothing to anyone who
// is not a lead. The crew member becomes the author and the lead is recorded
// as having entered it; the server checks the choice against the lead's own
// crew (server-lib/leadAccess.js), so this picker is only a convenience.
import { useEffect, useState } from "react";
import { colors as C, radius as RAD } from "./theme";

export default function FillingInFor({ token, value, onChange }) {
  const [crew, setCrew] = useState([]);
  const [isLead, setIsLead] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/companydata", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_my_crew", token }),
        });
        const data = await res.json();
        if (!cancelled && res.ok && data.isLead) { setIsLead(true); setCrew(data.crew || []); }
      } catch (e) { /* not a lead, or offline: no picker */ }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (!isLead || crew.length === 0) return null;
  return (
    <div style={{ margin: "0 0 14px" }}>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: C.text.muted, marginBottom: 4 }}>Filling this in for</label>
      <select
        value={value ? value.id : ""}
        onChange={e => {
          const picked = crew.find(p => String(p.id) === e.target.value);
          onChange(picked ? { id: picked.id, name: picked.name } : null);
        }}
        style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: RAD.sm, border: `1.5px solid ${C.line}`, background: C.panelInset, color: C.text.primary, fontSize: 15, minHeight: 44 }}
      >
        <option value="">Myself</option>
        {crew.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {value && <div style={{ fontSize: 12, color: C.text.faint, marginTop: 4 }}>{value.name} stays the author. You are recorded as having entered it.</div>}
    </div>
  );
}
