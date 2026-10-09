import { useState, useEffect } from "react";
import { colors as C, radius as RAD, shadow as SHAD } from "../theme";
import LayoutEditor from "./LayoutEditor.jsx";
import { callDocuments, fieldsForSave, rulesForSave, sampleAnswers, sampleRecord } from "./builderApi.js";
import { emptyLayout, checkedLayout } from "./editorModel.js";
import { defaultLayout } from "../../server-lib/documentEngine/layoutSchema.js";
import { renderDocumentPDF } from "./renderLayout.js";

// Admin Panel > Document Layouts (founder only). Pick a company and one of
// its documents, lay the PDF out by dragging boxes, preview it, save the
// draft, publish. A FORA template is cloned to the company first; editing a
// template itself is not offered here.

const card = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: 16, marginBottom: 14, boxShadow: SHAD.sm };
const btn = { background: C.panelInset, color: C.text.body, border: `1px solid ${C.line}`, borderRadius: RAD.sm, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const primary = { ...btn, background: C.orange, color: C.text.onOrange, border: "none" };

async function logoDataUrl(path) {
  try {
    const blob = await (await fetch(path)).blob();
    return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(blob); });
  } catch (e) { return undefined; }
}

export default function DocumentLayoutScreen({ companies, token }) {
  const [companyId, setCompanyId] = useState("");
  const [docs, setDocs] = useState([]);
  const [def, setDef] = useState(null); // { definition, shownVersion, fields, rules, layout }
  const [layout, setLayout] = useState(emptyLayout());
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const company = companies.find((c) => String(c.id) === String(companyId));

  const run = async (fn) => {
    setBusy(true); setMsg("");
    try { await fn(); } catch (e) { setMsg(e.message || "Something went wrong."); }
    setBusy(false);
  };

  useEffect(() => {
    setDef(null); setDocs([]); setDirty(false);
    if (!companyId) return;
    run(async () => { setDocs((await callDocuments(token, "list_company_documents", { companyId: Number(companyId) })).documents || []); });
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (d) => run(async () => {
    const got = await callDocuments(token, "get_definition", { companyId: Number(companyId), definitionId: d.id });
    const l = got.layout && Object.keys(got.layout).length ? got.layout : defaultLayout(got.definition.title, got.fields);
    setDef(got); setLayout(l); setDirty(false);
  });

  const clone = (d) => run(async () => {
    await callDocuments(token, "clone_template", { companyId: Number(companyId), templateId: d.id });
    setDocs((await callDocuments(token, "list_company_documents", { companyId: Number(companyId) })).documents || []);
    setMsg(`Cloned "${d.title}" for ${company?.name || "this company"}. Open the copy to edit it.`);
  });

  const change = (next) => { setLayout(next); setDirty(true); };

  const save = () => run(async () => {
    const ok = checkedLayout(layout);
    if (ok.error) throw new Error(ok.error);
    await callDocuments(token, "save_draft", {
      companyId: Number(companyId), definitionId: def.definition.id, title: def.shownVersion?.title || def.definition.title,
      fields: fieldsForSave(def.fields), rules: rulesForSave(def.rules), layout: ok.layout,
    });
    setDirty(false); setMsg("Draft saved.");
  });

  const publish = () => run(async () => {
    if (dirty) throw new Error("Save the draft first.");
    await callDocuments(token, "publish", { companyId: Number(companyId), definitionId: def.definition.id });
    setMsg("Published. New submissions use this layout; older records keep theirs.");
  });

  const preview = () => run(async () => {
    const ok = checkedLayout(layout);
    if (ok.error) throw new Error(ok.error);
    const doc = await renderDocumentPDF({
      layout: ok.layout, document: { title: def.shownVersion?.title || def.definition.title },
      company: { name: company?.name || "Company" }, record: sampleRecord(), fields: def.fields, answers: sampleAnswers(def.fields),
      signatures: [], assets: { foraLogoDataUrl: await logoDataUrl("/fora-logo-dark.png") },
    });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(doc.output("blob")));
  });

  return (
    <div>
      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 16, color: C.text.primary, marginBottom: 8 }}>Document Layouts</div>
        <select aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}
          style={{ padding: 8, borderRadius: RAD.sm, border: `1px solid ${C.line}`, background: C.panelInset, color: C.text.primary, minWidth: 240 }}>
          <option value="">Choose a company</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {msg && <div role="status" style={{ marginTop: 10, fontSize: 13, color: C.text.body }}>{msg}</div>}
      </div>

      {companyId && !def && (
        <div style={card}>
          {docs.length === 0 && <div style={{ fontSize: 13, color: C.text.muted }}>{busy ? "Loading..." : "No engine documents yet."}</div>}
          {docs.map((d) => (
            <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ color: C.text.primary, fontWeight: 700 }}>{d.title} <span style={{ color: C.text.muted, fontWeight: 500, fontSize: 12 }}>{d.companyOwned ? "company copy" : "FORA template"}</span></div>
              {d.companyOwned ? <button style={btn} disabled={busy} onClick={() => open(d)}>Edit layout</button> : <button style={btn} disabled={busy} onClick={() => clone(d)}>Clone to this company</button>}
            </div>
          ))}
        </div>
      )}

      {def && (
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            <div style={{ fontWeight: 800, color: C.text.primary }}>{def.shownVersion?.title || def.definition.title} <span style={{ color: C.text.muted, fontWeight: 500, fontSize: 12 }}>{def.shownVersion?.status} v{def.shownVersion?.versionNumber}{dirty ? " (unsaved)" : ""}</span></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={btn} onClick={() => setDef(null)}>Back</button>
              <button style={btn} disabled={busy} onClick={save}>Save draft</button>
              <button style={primary} disabled={busy || dirty} onClick={publish}>Publish</button>
            </div>
          </div>
          <LayoutEditor layout={layout} onChange={change} fields={def.fields} onPreview={preview} />
        </div>
      )}

      {previewUrl && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", flexDirection: "column", padding: 20 }}>
          <button style={{ ...btn, alignSelf: "flex-end", marginBottom: 8 }} onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(""); }}>Close preview</button>
          <iframe title="PDF preview" src={previewUrl} style={{ flex: 1, border: 0, background: "#fff", borderRadius: RAD.md }} />
        </div>
      )}
    </div>
  );
}
