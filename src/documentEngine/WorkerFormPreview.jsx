import { colors as C, radius as RAD } from "../theme";

// A phone-width mock of what a worker will see. Read-only: it shows labels,
// field kinds, required marks and options so the builder can check order and
// wording. The real form (WP7) draws from the same field list.

const box = { width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: RAD.sm, border: "1px solid #cbd5e1", background: "#fff", color: "#64748b", fontSize: 14 };

function Control({ f }) {
  const opts = f.config?.options || [];
  switch (f.field_type) {
    case "yesno": return <div style={{ display: "flex", gap: 8 }}>{["Yes", "No"].map((o) => <div key={o} style={{ ...box, textAlign: "center" }}>{o}</div>)}</div>;
    case "condition3": return <div style={{ display: "flex", gap: 6 }}>{["Good", "Monitor", "Defective"].map((o) => <div key={o} style={{ ...box, textAlign: "center", padding: "9px 4px", fontSize: 12 }}>{o}</div>)}</div>;
    case "dropdown": return <div style={box}>Choose one{opts.length ? ` (${opts.length} options)` : ""}</div>;
    case "multiselect": return <div>{opts.map((o) => <div key={o} style={{ fontSize: 14, color: "#334155", padding: "3px 0" }}>[ ] {o}</div>)}</div>;
    case "long_text": return <div style={{ ...box, minHeight: 64 }}>Type here</div>;
    case "number": return <div style={box}>0</div>;
    case "date": return <div style={box}>Pick a date</div>;
    case "signature": return <div style={{ ...box, height: 70 }}>Sign here</div>;
    case "file_upload": case "photo": return <div style={{ ...box, textAlign: "center" }}>{f.field_type === "photo" ? "Take or choose a photo" : "Attach a file"}</div>;
    case "hazard_table": return <div style={box}>Hazard, control and risk rows</div>;
    case "ppe_list": return <div style={box}>PPE checklist</div>;
    case "text_list": return <div style={box}>Add items one by one</div>;
    case "crew_signatures": return <div style={box}>Crew members pick their name and sign</div>;
    case "section_table": return <div style={box}>Repeating rows</div>;
    default: return <div style={box}>{f.field_type.replace(/_/g, " ")}</div>;
  }
}

export default function WorkerFormPreview({ title, fields, signatureRequired }) {
  let section = null;
  return (
    <div data-testid="worker-preview" style={{ width: 390, maxWidth: "100%", border: `1px solid ${C.line}`, borderRadius: 24, padding: 14, background: "#f8fafc" }}>
      <div style={{ fontWeight: 800, fontSize: 18, color: "#0f172a", marginBottom: 10 }}>{title || "Untitled document"}</div>
      {fields.filter((f) => !(f.config && f.config.hidden)).map((f) => {
        const head = f.section && f.section !== section ? <div style={{ fontWeight: 800, fontSize: 13, color: "#1e3a5f", margin: "12px 0 6px", textTransform: "uppercase" }}>{f.section}</div> : null;
        section = f.section || section;
        return (
          <div key={f.field_key}>
            {head}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>{f.label}{f.required && <span style={{ color: "#dc2626" }}> *</span>}</div>
              {f.help_text && <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{f.help_text}</div>}
              <Control f={f} />
            </div>
          </div>
        );
      })}
      {signatureRequired && <div style={{ marginTop: 6 }}><div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>Your signature</div><div style={{ ...box, height: 70 }}>Sign now or sign later</div></div>}
      <div style={{ marginTop: 12, background: C.orange, color: C.text.onOrange, borderRadius: RAD.sm, padding: 12, textAlign: "center", fontWeight: 800 }}>Submit</div>
    </div>
  );
}
