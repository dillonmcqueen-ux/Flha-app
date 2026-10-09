import { useState, useEffect } from "react";
import { colors as C, radius as RAD } from "../theme";
import { callDocuments } from "./builderApi.js";
import SignaturePad from "./SignaturePad.jsx";

// Additional crew sign-off on a document with a crew_signatures field (the
// FLHA). Each crew member is picked from the company roster and signs on this
// screen. The server takes the name from the roster row, so only the roster id
// travels with the signature.

const select = { width: "100%", padding: "12px 13px", borderRadius: RAD.md, border: `1.5px solid ${C.line}`, fontSize: 15, boxSizing: "border-box", background: C.panelInset, color: C.text.primary, marginBottom: 10 };

export default function CrewSignOff({ crew, onChange, token, companyId, authorId }) {
  const [people, setPeople] = useState(null);
  const [rosterId, setRosterId] = useState("");
  const [sig, setSig] = useState(null);
  const [padKey, setPadKey] = useState(0);

  useEffect(() => {
    let live = true;
    callDocuments(token, "get_picker_options", { companyId, kind: "person" }).then((r) => live && setPeople(r.options || [])).catch(() => live && setPeople([]));
    return () => { live = false; };
  }, [token, companyId]);

  const taken = new Set(crew.map((c) => String(c.rosterId)));
  const choices = (people || []).filter((p) => !taken.has(String(p.id)) && String(p.id) !== String(authorId));
  const add = () => {
    const p = (people || []).find((x) => String(x.id) === String(rosterId));
    if (!p || !sig) return;
    onChange([...crew, { rosterId: p.id, name: p.label, signature: sig }]);
    setRosterId(""); setSig(null); setPadKey((k) => k + 1);
  };

  return (
    <div>
      {crew.map((c) => (
        <div key={c.rosterId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
          <img src={c.signature} alt={`${c.name}'s signature`} style={{ height: 36, background: "#fff", borderRadius: 4 }} />
          <div style={{ flex: 1, fontWeight: 700, color: C.text.primary }}>{c.name}</div>
          <button type="button" onClick={() => onChange(crew.filter((x) => x.rosterId !== c.rosterId))} style={{ background: "transparent", border: "none", color: C.text.muted, fontWeight: 700, cursor: "pointer" }}>Remove</button>
        </div>
      ))}
      <div style={{ marginTop: 12 }}>
        <select aria-label="Crew member" style={select} value={rosterId} onChange={(e) => setRosterId(e.target.value)}>
          <option value="">{people === null ? "Loading..." : "Choose a crew member"}</option>
          {choices.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {rosterId && <SignaturePad key={padKey} value={sig} onChange={setSig} height={100} label="Crew member signs here" />}
        <button type="button" disabled={!rosterId || !sig} onClick={add}
          style={{ background: !rosterId || !sig ? C.text.faint : C.orange, color: "#fff", border: "none", borderRadius: RAD.md, padding: "12px", fontWeight: 800, fontSize: 14, cursor: "pointer", width: "100%", marginTop: 6 }}>
          Add crew sign-off
        </button>
      </div>
    </div>
  );
}
