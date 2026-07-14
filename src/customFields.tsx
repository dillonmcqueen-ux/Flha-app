import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";

// Loads a company's custom fields for one document type and tracks their values.
// Usage:
//   const cf = useCustomFields(companyId, "inspection");
//   ...render:  <CustomFieldInputs cf={cf} />
//   ...validate: cf.missingRequired()  -> array of labels not filled
//   ...save:     cf.entries()          -> [{label, value}] for storing/PDF
export function useCustomFields(companyId, docType) {
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});

  useEffect(() => {
    async function load() {
      if (!companyId) return;
      const { data, error } = await supabase
        .from("custom_fields")
        .select("id, label, field_type, options, required")
        .eq("company_id", companyId)
        .eq("doc_type", docType)
        .order("id");
      if (error) { console.error("custom fields read error:", error.message); return; }
      setFields(data || []);
    }
    load();
  }, [companyId, docType]);

  const setValue = (id, val) => setValues(v => ({ ...v, [id]: val }));
  const missingRequired = () => fields.filter(f => f.required && !(values[f.id] || "").trim()).map(f => f.label);
  const entries = () => fields
    .map(f => ({ label: f.label, value: (values[f.id] || "").trim() }))
    .filter(e => e.value);

  return { fields, values, setValue, missingRequired, entries };
}

// Renders the inputs. Pass your existing label/input styles so it matches each form.
export function CustomFieldInputs({ cf, labelStyle, inputStyle }) {
  if (!cf.fields.length) return null;
  const lbl = labelStyle || { display: "block", fontWeight: 700, fontSize: 12, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 };
  const inp = inputStyle || { width: "100%", padding: "11px 13px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 11, background: "#F8FAFC" };
  return (
    <>
      {cf.fields.map(f => (
        <div key={f.id}>
          <label style={lbl}>{f.label}{f.required ? " *" : ""}</label>
          {f.field_type === "dropdown" ? (
            <select style={inp} value={cf.values[f.id] || ""} onChange={e => cf.setValue(f.id, e.target.value)}>
              <option value="">Select…</option>
              {(f.options || "").split(",").map(o => o.trim()).filter(Boolean).map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input style={inp} placeholder={f.label} value={cf.values[f.id] || ""} onChange={e => cf.setValue(f.id, e.target.value)} />
          )}
        </div>
      ))}
    </>
  );
}

// Shared PDF renderer — draws a two-column label/value block. Returns the new y.
export function drawCustomFieldsPDF(doc, entries, { margin, contentW, y, accent = [100, 116, 139] }) {
  if (!entries || entries.length === 0) return y;
  const boxH = 6 + Math.ceil(entries.length / 2) * 9;
  if (y + boxH > 275) { doc.addPage(); y = 20; }
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, contentW, boxH, 2, 2, "F");
  let cy = y + 6, col = 0;
  entries.forEach(f => {
    const x = margin + 4 + col * (contentW / 2);
    doc.setTextColor(...accent);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(String(f.label || "").toUpperCase(), x, cy);
    doc.setTextColor(30, 41, 59);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(String(f.value || "—"), x, cy + 4.5, { maxWidth: contentW / 2 - 8 });
    col++;
    if (col > 1) { col = 0; cy += 9; }
  });
  return y + boxH + 6;
}
