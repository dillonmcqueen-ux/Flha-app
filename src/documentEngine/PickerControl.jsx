import { useState, useEffect } from "react";
import { colors as C, radius as RAD } from "../theme";
import { callDocuments } from "./builderApi.js";

// Equipment, attachment, site, person and linked-document answers. The list
// comes from the server (get_picker_options, scoped to the company); what the
// worker picks is sent as an id and checked again on submit.

const KIND = { equipment_picker: "equipment", attachment_picker: "attachment", site_picker: "site", person_picker: "person", linked_document: "document" };
const input = { width: "100%", padding: "12px 13px", borderRadius: RAD.md, border: `1.5px solid ${C.line}`, fontSize: 15, boxSizing: "border-box", background: C.panelInset, color: C.text.primary };

// What the form keeps for each type. Stored answers (from a returned document) come back as
// { equipment_id, label } etc., so every reader accepts both spellings.
const idOf = (type, v) => {
  if (v == null) return "";
  if (type === "equipment_picker") return v.equipmentId ?? v.equipment_id ?? "";
  if (type === "site_picker") return v.siteId ?? v.site_id ?? "";
  if (type === "person_picker") return v.rosterId ?? v.roster_id ?? "";
  if (type === "linked_document") return v.recordId ?? v.record_id ?? "";
  return "";
};
const idsOf = (v) => (v && (v.equipmentIds || v.equipment_ids)) || [];

export default function PickerControl({ field, value, onChange, token, companyId }) {
  const kind = KIND[field.field_type];
  const [options, setOptions] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    callDocuments(token, "get_picker_options", { companyId, kind }).then((r) => live && setOptions(r.options || [])).catch((e) => live && (setErr(e.message), setOptions([])));
    return () => { live = false; };
  }, [token, companyId, kind]);

  if (options === null) return <div style={{ fontSize: 13, color: C.text.muted }}>Loading...</div>;
  if (err) return <div role="alert" style={{ fontSize: 13, color: C.status.danger.text }}>{err}</div>;

  if (field.field_type === "attachment_picker") {
    const chosen = idsOf(value).map(String);
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {options.length === 0 && <div style={{ fontSize: 13, color: C.text.muted }}>No attachments in the fleet.</div>}
        {options.map((o) => {
          const on = chosen.includes(String(o.id));
          return <button key={o.id} type="button" aria-pressed={on} onClick={() => {
            const next = on ? chosen.filter((x) => x !== String(o.id)) : [...chosen, String(o.id)];
            onChange(next.length ? { equipmentIds: next.map(Number) } : "");
          }} style={{ minHeight: 44, padding: "8px 14px", borderRadius: RAD.pill, fontSize: 14, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${on ? C.orange : C.line}`, background: on ? `${C.orange}22` : C.panelInset, color: on ? C.orange : C.text.faint }}>{on ? "✓ " : ""}{o.label}</button>;
        })}
      </div>
    );
  }

  const current = String(idOf(field.field_type, value));
  const isText = field.field_type === "equipment_picker" && value && !current && value.text !== undefined;
  const key = { equipment_picker: "equipmentId", site_picker: "siteId", person_picker: "rosterId", linked_document: "recordId" }[field.field_type];
  return (
    <div>
      <select aria-label={field.label} style={input} value={isText ? "__other" : current}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") onChange("");
          else if (v === "__other") onChange({ text: "" });
          else onChange({ [key]: Number(v) });
        }}>
        <option value="">Select...</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        {field.field_type === "equipment_picker" && <option value="__other">Other machine (type it in)</option>}
      </select>
      {isText && <input aria-label={`${field.label} name`} style={{ ...input, marginTop: 10 }} placeholder="Machine name or unit" value={value.text || ""} onChange={(e) => onChange({ text: e.target.value })} />}
    </div>
  );
}
