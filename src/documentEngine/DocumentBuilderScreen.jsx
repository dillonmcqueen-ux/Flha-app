import { useState, useEffect } from "react";
import { colors as C, radius as RAD, shadow as SHAD } from "../theme";
import LayoutEditor from "./LayoutEditor.jsx";
import WorkerFormPreview from "./WorkerFormPreview.jsx";
import { callDocuments, fieldsForSave, rulesForSave, sampleAnswers, sampleRecord } from "./builderApi.js";
import { emptyLayout, checkedLayout } from "./editorModel.js";
import {
  BUILDER_FIELD_TYPES, DEPARTMENTS, ROUTABLE_TYPES, ATTACHMENT_KINDS, ATTACHMENT_FIELD_TYPES,
  addField, removeField, moveField, updateField, setOptions, fieldUsage, fieldProblems,
  rulesToView, viewToRules, rulesProblems, routingSummary,
} from "./builderModel.js";
import { defaultLayout } from "../../server-lib/documentEngine/layoutSchema.js";
import { renderDocumentPDF } from "./renderLayout.js";

// Admin Panel > Documents (founder only). Pick a company and one of its
// documents, then edit fields, signatures and routing, notifications, the PDF
// layout and the company switches, with three previews. A FORA template is
// cloned to the company first; editing a template itself is not offered here.

const card = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: 16, marginBottom: 14, boxShadow: SHAD.sm };
const btn = { background: C.panelInset, color: C.text.body, border: `1px solid ${C.line}`, borderRadius: RAD.sm, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const primary = { ...btn, background: C.orange, color: C.text.onOrange, border: "none" };
const input = { width: "100%", boxSizing: "border-box", padding: "7px 9px", borderRadius: RAD.sm, border: `1px solid ${C.line}`, background: C.panelInset, color: C.text.primary, fontSize: 13 };
const lab = { display: "block", fontSize: 11, fontWeight: 700, color: C.text.muted, textTransform: "uppercase", margin: "8px 0 3px" };
const row = { border: `1px solid ${C.line}`, borderRadius: RAD.md, padding: 10, marginBottom: 8 };
const TABS = [["fields", "Fields"], ["routing", "Signatures and routing"], ["notify", "Notifications"], ["layout", "PDF layout"], ["preview", "Previews"], ["settings", "Company settings"]];

async function logoDataUrl(path) {
  try {
    const blob = await (await fetch(path)).blob();
    return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(blob); });
  } catch (e) { return undefined; }
}

function Check({ checked, onChange, children }) {
  return <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: C.text.body, marginRight: 14 }}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{children}</label>;
}

function DeptPicker({ value, onChange }) {
  return <div>{DEPARTMENTS.map(([k, l]) => <Check key={k} checked={value.includes(k)} onChange={(on) => onChange(on ? [...value, k] : value.filter((x) => x !== k))}>{l}</Check>)}</div>;
}

export default function DocumentBuilderScreen({ companies, token }) {
  const [companyId, setCompanyId] = useState("");
  const [docs, setDocs] = useState([]);
  const [def, setDef] = useState(null);
  const [tab, setTab] = useState("fields");
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState([]);
  const [view, setView] = useState(rulesToView([]));
  const [layout, setLayout] = useState(emptyLayout());
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [addType, setAddType] = useState("short_text");
  const company = companies.find((c) => String(c.id) === String(companyId));
  const cid = Number(companyId);
  const setting = def ? docs.find((d) => d.id === def.definition.id) : null;

  const run = async (fn) => {
    setBusy(true); setMsg("");
    try { await fn(); } catch (e) { setMsg(e.message || "Something went wrong."); }
    setBusy(false);
  };
  const reload = async () => setDocs((await callDocuments(token, "list_company_documents", { companyId: cid })).documents || []);

  useEffect(() => {
    setDef(null); setDocs([]); setDirty(false);
    if (companyId) run(reload);
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const touch = (fn) => (...a) => { fn(...a); setDirty(true); };
  const setFieldsD = touch(setFields); const setViewD = touch(setView); const setLayoutD = touch(setLayout); const setTitleD = touch(setTitle);

  const open = (d) => run(async () => {
    const got = await callDocuments(token, "get_definition", { companyId: cid, definitionId: d.id });
    setDef(got); setTitle(got.shownVersion?.title || got.definition.title); setFields(got.fields || []);
    setView(rulesToView(got.rules)); setTab("fields"); setDirty(false);
    setLayout(got.layout && Object.keys(got.layout).length ? got.layout : defaultLayout(got.definition.title, got.fields));
  });
  const clone = (d) => run(async () => {
    await callDocuments(token, "clone_template", { companyId: cid, templateId: d.id });
    await reload(); setMsg(`Cloned "${d.title}" for ${company?.name || "this company"}. Open the copy to edit it.`);
  });
  const create = () => run(async () => {
    if (!newTitle.trim()) throw new Error("Give the new document a title.");
    const out = await callDocuments(token, "create_definition", { companyId: cid, title: newTitle.trim() });
    setNewTitle(""); await reload();
    await open({ id: out.definition.id });
  });

  const problems = [...fieldProblems(fields), ...rulesProblems(view, fields)];

  const save = () => run(async () => {
    if (problems.length) throw new Error(problems[0]);
    const ok = checkedLayout(layout);
    if (ok.error) throw new Error(ok.error);
    await callDocuments(token, "save_draft", {
      companyId: cid, definitionId: def.definition.id, title,
      fields: fieldsForSave(fields), rules: rulesForSave(viewToRules(view)), layout: ok.layout,
    });
    setDirty(false); setMsg("Draft saved.");
  });
  const publish = () => run(async () => {
    if (dirty) throw new Error("Save the draft first.");
    await callDocuments(token, "publish", { companyId: cid, definitionId: def.definition.id });
    await reload(); setMsg("Published. New submissions use this version; older records keep theirs.");
  });
  const setSwitch = (patch) => run(async () => {
    await callDocuments(token, "set_company_document", { companyId: cid, definitionId: def.definition.id, ...patch });
    await reload();
  });

  const preview = () => run(async () => {
    const ok = checkedLayout(layout);
    if (ok.error) throw new Error(ok.error);
    const doc = await renderDocumentPDF({
      layout: ok.layout, document: { title }, company: { name: company?.name || "Company" }, record: sampleRecord(),
      fields, answers: sampleAnswers(fields), signatures: [], assets: { foraLogoDataUrl: await logoDataUrl("/fora-logo-dark.png") },
    });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(doc.output("blob")));
  });

  const removeFieldAsk = (f) => {
    const used = fieldUsage(f.field_key, layout, viewToRules(view));
    if (used.length && !window.confirm(`"${f.label}" is still used by ${used.join(", ")}. Remove it anyway?`)) return;
    setFieldsD(removeField(fields, f.field_key));
  };

  const routableFields = fields.filter((f) => ROUTABLE_TYPES.includes(f.field_type));
  const ctrl = (f) => (patch) => setFieldsD(updateField(fields, f.field_key, patch));

  return (
    <div>
      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 16, color: C.text.primary, marginBottom: 8 }}>Documents</div>
        <select aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} style={{ ...input, width: 260 }}>
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
              <div style={{ color: C.text.primary, fontWeight: 700 }}>{d.title} <span style={{ color: C.text.muted, fontWeight: 500, fontSize: 12 }}>
                {d.companyOwned ? `company copy, ${d.enabled ? "on" : "off"}` : "FORA template"}</span></div>
              {d.companyOwned ? <button style={btn} disabled={busy} onClick={() => open(d)}>Edit</button> : <button style={btn} disabled={busy} onClick={() => clone(d)}>Clone to this company</button>}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input aria-label="New document title" style={input} placeholder="New blank document title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <button style={btn} disabled={busy} onClick={create}>Create</button>
          </div>
        </div>
      )}

      {def && (
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <div style={{ fontWeight: 800, color: C.text.primary }}>{title}
              <span style={{ color: C.text.muted, fontWeight: 500, fontSize: 12 }}> {def.shownVersion ? `${def.shownVersion.status} v${def.shownVersion.versionNumber}` : "new"}{dirty ? " (unsaved)" : ""}</span></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={btn} onClick={() => setDef(null)}>Back</button>
              <button style={btn} disabled={busy} onClick={save}>Save draft</button>
              <button style={primary} disabled={busy || dirty} onClick={publish}>Publish</button>
            </div>
          </div>
          {problems.length > 0 && <div role="alert" style={{ fontSize: 12.5, color: C.status?.danger?.text || "#b91c1c", marginBottom: 8 }}>{problems[0]}{problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}</div>}
          <div role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} style={{ ...btn, borderColor: tab === k ? C.orange : C.line }} onClick={() => setTab(k)}>{l}</button>)}
          </div>

          {tab === "fields" && (
            <div>
              <span style={lab}>Document title</span>
              <input style={input} value={title} onChange={(e) => setTitleD(e.target.value)} />
              <div style={{ height: 10 }} />
              {fields.map((f, i) => (
                <div key={f.field_key} style={row}>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr auto", gap: 8, alignItems: "end" }}>
                    <div><span style={lab}>Label</span><input aria-label={`Label ${i + 1}`} style={input} value={f.label} onChange={(e) => ctrl(f)({ label: e.target.value })} /></div>
                    <div><span style={lab}>Type</span>
                      <select style={input} value={f.field_type} onChange={(e) => ctrl(f)({ field_type: e.target.value })}>
                        {BUILDER_FIELD_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}{t.notYet ? " (not answerable yet)" : ""}</option>)}
                      </select></div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button style={btn} aria-label="Move up" onClick={() => setFieldsD(moveField(fields, f.field_key, -1))}>Up</button>
                      <button style={btn} aria-label="Move down" onClick={() => setFieldsD(moveField(fields, f.field_key, 1))}>Down</button>
                      <button style={btn} onClick={() => removeFieldAsk(f)}>Remove</button>
                    </div>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Check checked={f.required} onChange={(v) => ctrl(f)({ required: v })}>Required</Check>
                    <span style={{ fontSize: 11, color: C.text.muted }}>key: {f.field_key}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div><span style={lab}>Section</span><input style={input} value={f.section || ""} onChange={(e) => ctrl(f)({ section: e.target.value || null })} /></div>
                    <div><span style={lab}>Help text</span><input style={input} value={f.help_text || ""} onChange={(e) => ctrl(f)({ help_text: e.target.value || null })} /></div>
                  </div>
                  {BUILDER_FIELD_TYPES.find((t) => t.key === f.field_type)?.needsOptions && (
                    <div><span style={lab}>Options, one per line</span>
                      <textarea style={{ ...input, minHeight: 60 }} value={(f.config?.options || []).join("\n")} onChange={(e) => setFieldsD(setOptions(fields, f.field_key, e.target.value.split("\n")))} /></div>
                  )}
                  {ATTACHMENT_FIELD_TYPES.includes(f.field_type) && (
                    <div><span style={lab}>Attachment rules</span>
                      {ATTACHMENT_KINDS.map(([k, l]) => (
                        <Check key={k} checked={(f.attachment_rules?.allowed || []).includes(k)} onChange={(on) => {
                          const cur = f.attachment_rules?.allowed || [];
                          ctrl(f)({ attachment_rules: { ...f.attachment_rules, allowed: on ? [...cur, k] : cur.filter((x) => x !== k) } });
                        }}>{l}</Check>
                      ))}
                      <input aria-label="Max MB" type="number" min={1} max={10} style={{ ...input, width: 90 }} placeholder="Max MB" value={f.attachment_rules?.maxMb || ""}
                        onChange={(e) => ctrl(f)({ attachment_rules: { ...f.attachment_rules, maxMb: e.target.value ? Number(e.target.value) : undefined } })} />
                    </div>
                  )}
                </div>
              ))}
              <div style={{ display: "flex", gap: 8 }}>
                <select aria-label="Field type to add" style={{ ...input, width: 240 }} value={addType} onChange={(e) => setAddType(e.target.value)}>
                  {BUILDER_FIELD_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                <button style={btn} onClick={() => { const o = addField(fields, addType); if (o.error) setMsg(o.error); else setFieldsD(o.fields); }}>Add field</button>
              </div>
            </div>
          )}

          {tab === "routing" && (
            <div>
              <Check checked={view.signatureRequired} onChange={(v) => setViewD({ ...view, signatureRequired: v })}>Worker signature required (can be signed later)</Check>
              <span style={lab}>Review chain, in order</span>
              {view.reviewers.map((s, i) => (
                <div key={i} style={row}>
                  <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
                    <div style={{ flex: 1 }}><span style={lab}>Step name</span><input style={input} placeholder={`Review ${i + 1}`} value={s.label} onChange={(e) => setViewD({ ...view, reviewers: view.reviewers.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /></div>
                    <select aria-label={`Step ${i + 1} role`} style={{ ...input, width: 170 }} value={s.role} onChange={(e) => setViewD({ ...view, reviewers: view.reviewers.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })}>
                      <option value="supervisor">Supervisor</option><option value="owner">Account Owner only</option>
                    </select>
                    <button style={btn} onClick={() => setViewD({ ...view, reviewers: view.reviewers.filter((_, j) => j !== i) })}>Remove</button>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    {s.role !== "owner" && <Check checked={s.allowLeads} onChange={(v) => setViewD({ ...view, reviewers: view.reviewers.map((x, j) => (j === i ? { ...x, allowLeads: v } : x)) })}>Crew leads can review their crew</Check>}
                    <Check checked={s.distinct} onChange={(v) => setViewD({ ...view, reviewers: view.reviewers.map((x, j) => (j === i ? { ...x, distinct: v } : x)) })}>Different person from other steps</Check>
                  </div>
                </div>
              ))}
              <button style={btn} onClick={() => setViewD({ ...view, reviewers: [...view.reviewers, { label: "", role: "supervisor", allowLeads: false, distinct: true }] })}>Add review step</button>

              <span style={{ ...lab, marginTop: 16 }}>Route by answer</span>
              {view.routes.map((r, i) => (
                <div key={i} style={{ ...row, display: "grid", gridTemplateColumns: "1.3fr 1.3fr 1fr auto", gap: 8, alignItems: "end" }}>
                  <div><span style={lab}>When field</span>
                    <select style={input} value={r.fieldKey} onChange={(e) => setViewD({ ...view, routes: view.routes.map((x, j) => (j === i ? { ...x, fieldKey: e.target.value } : x)) })}>
                      <option value="">Choose</option>{routableFields.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
                    </select></div>
                  <div><span style={lab}>Equals (comma separated)</span>
                    <input style={input} value={r.equals.join(", ")} onChange={(e) => setViewD({ ...view, routes: view.routes.map((x, j) => (j === i ? { ...x, equals: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : x)) })} /></div>
                  <div><span style={lab}>Send to</span>
                    <select style={input} value={r.department} onChange={(e) => setViewD({ ...view, routes: view.routes.map((x, j) => (j === i ? { ...x, department: e.target.value } : x)) })}>
                      <option value="">Choose</option>{DEPARTMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select></div>
                  <button style={btn} onClick={() => setViewD({ ...view, routes: view.routes.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              ))}
              <button style={btn} onClick={() => setViewD({ ...view, routes: [...view.routes, { fieldKey: "", equals: [], department: "" }] })}>Add routing rule</button>
            </div>
          )}

          {tab === "notify" && (
            <div>
              <span style={lab}>Tell these departments about every new record</span>
              <DeptPicker value={view.notifyDepartments} onChange={(v) => setViewD({ ...view, notifyDepartments: v })} />
              <span style={lab}>Also place with supervisors in these departments</span>
              <DeptPicker value={view.scopeDepartments} onChange={(v) => setViewD({ ...view, scopeDepartments: v })} />
              <div style={{ fontSize: 12, color: C.text.muted, marginTop: 10 }}>Emails name only the document, site and department. Reviewers are always told when a record reaches their step.</div>
            </div>
          )}

          {tab === "layout" && (
            <div>
              <button style={{ ...btn, marginBottom: 10 }} onClick={() => { if (window.confirm("Replace the layout with one built from the current fields?")) setLayoutD(defaultLayout(title, fields)); }}>Reset layout from fields</button>
              <LayoutEditor layout={layout} onChange={setLayoutD} fields={fields} onPreview={preview} />
            </div>
          )}

          {tab === "preview" && (
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <div><span style={lab}>Worker form (phone)</span><WorkerFormPreview title={title} fields={fields} signatureRequired={view.signatureRequired} /></div>
              <div style={{ flex: 1, minWidth: 260 }}>
                <span style={lab}>Routing</span>
                {routingSummary(view, fields).map((l, i) => (
                  <div key={i} style={{ ...row, marginBottom: 6 }}><div style={{ fontWeight: 800, fontSize: 13, color: C.text.primary }}>{l.step}</div><div style={{ fontSize: 12.5, color: C.text.body }}>{l.detail}</div></div>
                ))}
                <span style={lab}>PDF</span>
                <button style={primary} disabled={busy} onClick={preview}>Open PDF preview</button>
              </div>
            </div>
          )}

          {tab === "settings" && (
            <div>
              {!def.definition.current_version_id && <div style={{ fontSize: 13, color: C.text.muted }}>Publish a version first. These switches apply to published documents.</div>}
              <div style={{ marginTop: 8 }}>
                <Check checked={!!setting?.enabled} onChange={(v) => setSwitch({ isEnabled: v })}>On for {company?.name || "this company"} (workers see it)</Check>
              </div>
              <div style={{ marginTop: 8 }}>
                <Check checked={setting ? setting.brainEnabled : true} onChange={(v) => setSwitch({ brainEnabled: v })}>Feed the Company Brain</Check>
              </div>
              <div style={{ marginTop: 8 }}>
                <Check checked={!!setting?.ownerMuted} onChange={(v) => setSwitch({ ownerMuted: v })}>Mute notifications for the Account Owner</Check>
              </div>
            </div>
          )}
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
