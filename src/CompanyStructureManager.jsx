// src/CompanyStructureManager.jsx
// The Account Owner's (and the founder's) editor for a company's departments
// and divisions. Both are tags for routing, filtering and reporting: holding
// one never grants access by itself.
import { useState } from "react";
import { X, Plus } from "lucide-react";
import { colors as C, radius as RAD } from "./theme";
import { companyCall } from "./useCompanyStructure.js";

const chip = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: RAD.pill,
  fontSize: 12.5, fontWeight: 700, background: C.panelInset, color: C.text.body, border: `1px solid ${C.line}`,
};
const input = {
  flex: "1 1 160px", boxSizing: "border-box", padding: "9px 12px", borderRadius: RAD.sm,
  border: `1.5px solid ${C.line}`, background: C.panelInset, color: C.text.primary, fontSize: 14, minHeight: 40,
};
const addBtn = {
  display: "inline-flex", alignItems: "center", gap: 4, padding: "9px 14px", borderRadius: RAD.sm, cursor: "pointer",
  fontWeight: 700, fontSize: 13, minHeight: 40, background: "transparent", color: C.orange, border: `1.5px solid ${C.orange}`,
};

export default function CompanyStructureManager({ token, companyId, departments, divisions, sites = [], onChanged }) {
  const [deptName, setDeptName] = useState("");
  const [divName, setDivName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (body, after) => {
    setError("");
    setBusy(true);
    const r = await companyCall({ token, ...(companyId ? { companyId } : {}), ...body });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    after && after();
    onChanged && onChanged();
  };

  const custom = departments.filter(d => !d.builtin);

  return (
    <div style={{ background: C.panelInset, border: `1px solid ${C.line}`, borderRadius: RAD.md, padding: 14, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.text.primary, marginBottom: 2 }}>Departments and divisions</div>
      <div style={{ fontSize: 12, color: C.text.faint, marginBottom: 12, lineHeight: 1.5 }}>
        Tags for routing, filtering and reporting. A department or division on its own never gives anyone access to a document.
      </div>
      {error && <div style={{ fontSize: 12.5, color: C.status.danger.text, marginBottom: 8 }}>{error}</div>}

      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text.muted, marginBottom: 6 }}>Departments</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {departments.filter(d => d.builtin).map(d => <span key={d.key} style={chip}>{d.label}</span>)}
        {custom.map(d => (
          <span key={d.key} style={chip}>
            {d.label}
            <button type="button" aria-label={`Remove ${d.label}`} disabled={busy}
              onClick={() => { if (window.confirm(`Remove the ${d.label} department? Everyone tagged with it loses the tag.`)) run({ action: "delete_department", key: d.key }); }}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: C.text.faint, padding: 0, display: "flex" }}><X size={13} /></button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <input style={input} value={deptName} onChange={e => setDeptName(e.target.value)} placeholder="Add a department, e.g. Yard Crew" aria-label="New department name"
          onKeyDown={e => { if (e.key === "Enter" && deptName.trim() && !busy) run({ action: "add_department", label: deptName }, () => setDeptName("")); }} />
        <button type="button" style={addBtn} disabled={busy || !deptName.trim()} onClick={() => run({ action: "add_department", label: deptName }, () => setDeptName(""))}><Plus size={14} />Add</button>
      </div>

      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text.muted, marginBottom: 6 }}>Divisions</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {divisions.length === 0 && <span style={{ fontSize: 12, color: C.text.faint }}>None yet, e.g. Water and Sewer, Paving.</span>}
        {divisions.map(d => (
          <span key={d.id} style={chip}>
            {d.name}
            <button type="button" aria-label={`Rename ${d.name}`} disabled={busy}
              onClick={() => { const n = window.prompt("Rename division", d.name); if (n && n.trim() && n.trim() !== d.name) run({ action: "rename_division", id: d.id, name: n }); }}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: C.text.faint, padding: 0, fontSize: 11, fontWeight: 700 }}>Edit</button>
            <button type="button" aria-label={`Remove ${d.name}`} disabled={busy}
              onClick={() => { if (window.confirm(`Remove the ${d.name} division? Everyone tagged with it loses the tag.`)) run({ action: "delete_division", id: d.id }); }}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: C.text.faint, padding: 0, display: "flex" }}><X size={13} /></button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input style={input} value={divName} onChange={e => setDivName(e.target.value)} placeholder="Add a division" aria-label="New division name"
          onKeyDown={e => { if (e.key === "Enter" && divName.trim() && !busy) run({ action: "add_division", name: divName }, () => setDivName("")); }} />
        <button type="button" style={addBtn} disabled={busy || !divName.trim()} onClick={() => run({ action: "add_division", name: divName }, () => setDivName(""))}><Plus size={14} />Add</button>
      </div>

      {divisions.length > 0 && sites.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.text.muted, marginBottom: 2 }}>Sites by division</div>
          <div style={{ fontSize: 12, color: C.text.faint, marginBottom: 8, lineHeight: 1.5 }}>
            A division usually runs a set of sites. Put each site under its division so supervisors tagged with that division see those sites' records.
          </div>
          {sites.map(s => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              <span style={{ flex: "1 1 140px", fontSize: 13, color: C.text.body, fontWeight: 600 }}>{s.name}</span>
              <select style={{ ...input, flex: "1 1 160px" }} disabled={busy} aria-label={`Division for ${s.name}`}
                value={s.divisionId || ""}
                onChange={e => run({ action: "set_site_division", siteId: s.id, divisionId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">No division</option>
                {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
