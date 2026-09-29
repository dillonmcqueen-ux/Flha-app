import { useState, useEffect } from "react";
import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";
import { colors as T, font as FONT, radius as RAD, shadow as SHAD } from "./theme";
import { PORTAL_DEPARTMENTS, PORTAL_DEPARTMENT_LABELS } from "../server-lib/portalDepartments";
import { PORTAL_FIELD_TYPES, fieldTypeNeedsOptions, fieldTypeCanEscalate } from "../server-lib/portalFieldTypes";
import { Upload, Plus, Trash2, Loader2, FileText, CheckCircle2, AlertTriangle } from "lucide-react";

const C = {
  ink: T.text.primary, inkSoft: T.text.body, muted: T.text.faint,
  bg: T.bg, panel: T.panel, panelInset: T.panelInset, line: T.line,
  amber: T.orange, onOrange: T.text.onOrange, status: T.status,
};

const s = {
  card: { background: C.panel, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: 18, marginBottom: 14, boxShadow: SHAD.sm },
  input: { width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: RAD.sm, border: `1.5px solid ${C.line}`, background: C.panelInset, color: C.ink, fontSize: 13.5 },
  label: { display: "block", fontSize: 11.5, fontWeight: 700, color: C.muted, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.03em" },
  btn: (bg, textColor = C.onOrange) => ({ background: bg, color: textColor, border: "none", borderRadius: RAD.sm, padding: "10px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }),
  ghostBtn: { background: "transparent", border: `1.5px solid ${C.line}`, borderRadius: RAD.sm, padding: "10px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", color: C.inkSoft },
  chip: (selected) => ({
    padding: "7px 14px", borderRadius: RAD.pill, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
    border: `1.5px solid ${selected ? C.amber : C.line}`,
    background: selected ? `${C.amber}22` : C.panelInset,
    color: selected ? C.amber : C.muted,
  }),
};

const emptyQuestion = () => ({ questionText: "", fieldType: "short_text", options: [], escalationDepartment: null, escalationTriggerValue: null });

export default function PortalDocumentBuilder({ companies, token }) {
  const [companyId, setCompanyId] = useState("");
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [categories, setCategories] = useState([]);

  // null = list view; object = building/editing a document
  const [draft, setDraft] = useState(null);
  const [draftDocumentId, setDraftDocumentId] = useState(null);

  const [starting, setStarting] = useState(false); // upload/AI in flight
  const [startError, setStartError] = useState("");
  const [structureNotes, setStructureNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Company Portal phase 4 — assignment rules. Only meaningful for an
  // already-published document (a rule needs a real documentId), so this
  // section only shows once draftDocumentId is set.
  const [assignmentRules, setAssignmentRules] = useState([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [companyRoster, setCompanyRoster] = useState([]);
  const [newRule, setNewRule] = useState({ targetType: "everyone", targetRole: "worker", targetRosterId: "", dueDays: "7", autoApplyNewHires: true });
  const [savingRule, setSavingRule] = useState(false);

  const loadDocuments = async (id) => {
    if (!id) { setDocuments([]); return; }
    setLoadingDocs(true);
    try {
      const res = await fetch("/api/portal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_documents", token, companyId: id }),
      });
      const data = await res.json();
      if (res.ok) setDocuments(data.documents || []);
    } catch (e) { /* leave list as-is */ }
    setLoadingDocs(false);
  };

  useEffect(() => { loadDocuments(companyId); }, [companyId]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/portal", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_portal_categories", token }),
        });
        const data = await res.json();
        if (res.ok) setCategories(data.categories || []);
      } catch (e) { /* leave empty */ }
    })();
  }, []);

  const startFromUpload = async (file) => {
    if (!companyId) { setStartError("Pick a company first."); return; }
    setStarting(true); setStartError("");
    try {
      const { receipt } = await uploadViaSignedUrl({
        endpoint: "/api/portal", action: "create_source_upload_url", token,
        bucket: "portal-sources", filename: file.name, file, contentType: file.type, extra: { companyId },
      });
      const res = await fetch("/api/portal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ai_draft_document", token, companyId, sourceReceipt: receipt }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Couldn't read that file.");
      setDraft(data.draft);
      setDraftDocumentId(null);
    } catch (e) {
      setStartError(e.message || "Couldn't read that file. Try starting from scratch instead.");
    }
    setStarting(false);
  };

  const startFromDescription = async () => {
    if (!companyId) { setStartError("Pick a company first."); return; }
    if (!structureNotes.trim()) { setStartError("Describe the document first, or start from scratch instead."); return; }
    setStarting(true); setStartError("");
    try {
      const res = await fetch("/api/portal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ai_draft_document", token, companyId, structureNotes }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Couldn't build a draft from that.");
      setDraft(data.draft);
      setDraftDocumentId(null);
    } catch (e) {
      setStartError(e.message || "Couldn't build a draft from that.");
    }
    setStarting(false);
  };

  const startFromScratch = () => {
    setDraft({ title: "", icon: "📄", category: "", departments: [], questions: [emptyQuestion()] });
    setDraftDocumentId(null);
    setStartError("");
  };

  const openExisting = async (doc) => {
    setStarting(true); setStartError("");
    try {
      const res = await fetch("/api/portal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_document", token, documentId: doc.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDraft({
        title: data.document.title, icon: data.document.icon || "📄", category: data.document.category || "",
        departments: data.document.departments || [],
        questions: (data.questions || []).map(q => ({
          questionText: q.question_text, fieldType: q.field_type, options: q.options || [],
          escalationDepartment: q.escalation_department || null, escalationTriggerValue: q.escalation_trigger_value || null,
        })),
      });
      setDraftDocumentId(doc.id);
    } catch (e) {
      setMsg(e.message || "Couldn't load this document.");
    }
    setStarting(false);
  };

  const loadAssignmentRules = async (documentId) => {
    setLoadingRules(true);
    try {
      const res = await fetch("/api/portal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_assignment_rules", token, documentId }),
      });
      const data = await res.json();
      if (res.ok) setAssignmentRules(data.rules || []);
    } catch (e) { /* leave as-is */ }
    setLoadingRules(false);
  };

  useEffect(() => {
    if (!draftDocumentId) { setAssignmentRules([]); return; }
    loadAssignmentRules(draftDocumentId);
    (async () => {
      try {
        const res = await fetch("/api/companydata", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_roster", token, companyId }),
        });
        const data = await res.json();
        if (res.ok) setCompanyRoster(data.members || []);
      } catch (e) { /* leave as-is */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftDocumentId]);

  const createRule = async () => {
    setSavingRule(true);
    try {
      const res = await fetch("/api/portal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_assignment_rule", token, documentId: draftDocumentId,
          targetType: newRule.targetType,
          targetRole: newRule.targetType === "role" ? newRule.targetRole : undefined,
          targetRosterId: newRule.targetType === "individual" ? newRule.targetRosterId : undefined,
          dueDays: newRule.dueDays === "" ? null : newRule.dueDays,
          autoApplyNewHires: newRule.autoApplyNewHires,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await loadAssignmentRules(draftDocumentId);
    } catch (e) {
      setMsg(e.message || "Couldn't create assignment rule.");
    }
    setSavingRule(false);
  };

  const deleteRule = async (ruleId) => {
    await fetch("/api/portal", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_assignment_rule", token, ruleId }),
    });
    loadAssignmentRules(draftDocumentId);
  };

  const toggleDept = (dept) => setDraft(d => ({
    ...d, departments: d.departments.includes(dept) ? d.departments.filter(x => x !== dept) : [...d.departments, dept],
  }));

  const updateQuestion = (i, patch) => setDraft(d => ({
    ...d, questions: d.questions.map((q, idx) => idx === i ? { ...q, ...patch } : q),
  }));
  const addQuestion = () => setDraft(d => ({ ...d, questions: [...d.questions, emptyQuestion()] }));
  const removeQuestion = (i) => setDraft(d => ({ ...d, questions: d.questions.filter((_, idx) => idx !== i) }));

  const canPublish = draft && draft.title.trim() && draft.questions.length > 0
    && draft.questions.every(q => q.questionText.trim() && (!fieldTypeNeedsOptions(q.fieldType) || q.options.filter(o => o.trim()).length >= 2));

  const publish = async () => {
    setSaving(true); setMsg("");
    try {
      const res = await fetch("/api/portal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish_document", token, documentId: draftDocumentId, companyId,
          title: draft.title.trim(), icon: draft.icon, category: draft.category.trim(),
          departments: draft.departments, questions: draft.questions,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't publish.");
      setMsg("Published.");
      setDraft(null);
      setDraftDocumentId(null);
      loadDocuments(companyId);
    } catch (e) {
      setMsg(e.message || "Couldn't publish.");
    }
    setSaving(false);
  };

  const toggleActive = async (doc) => {
    await fetch("/api/portal", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle_document", token, documentId: doc.id, isActive: !doc.is_active }),
    });
    loadDocuments(companyId);
  };

  const deleteDoc = async (doc) => {
    if (!window.confirm(`Delete "${doc.title}"? This only works if it has no submissions yet.`)) return;
    const res = await fetch("/api/portal", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_document", token, documentId: doc.id }),
    });
    const data = await res.json();
    if (!res.ok) { setMsg(data.error || "Couldn't delete."); return; }
    loadDocuments(companyId);
  };

  // ── Builder / draft-review screen ──────────────────────────────────────
  if (draft) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontFamily: FONT.heading, fontWeight: 800, fontSize: 20, color: C.ink }}>
            {draftDocumentId ? "Edit document" : "New document"}
          </div>
          <button style={s.ghostBtn} onClick={() => { setDraft(null); setDraftDocumentId(null); }}>Discard</button>
        </div>

        <div style={{ ...s.card, background: `${C.amber}12`, border: `1px solid ${C.amber}55`, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <AlertTriangle size={16} color={C.amber} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: C.inkSoft }}>Nothing here is live until you publish. Review every field below — especially any AI-suggested field type — before publishing.</div>
        </div>

        <div style={s.card}>
          <label style={s.label}>Document title</label>
          <input style={{ ...s.input, marginBottom: 12 }} value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />

          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <div style={{ width: 80 }}>
              <label style={s.label}>Icon</label>
              <input style={s.input} value={draft.icon} onChange={e => setDraft(d => ({ ...d, icon: e.target.value }))} placeholder="📄" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={s.label}>Category (for cross-company analytics)</label>
              <input style={s.input} list="portal-category-options" value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} placeholder="e.g. Vehicle Pre-Trip Inspection" />
              <datalist id="portal-category-options">
                {categories.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>

          <label style={s.label}>Routes to department(s)</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {PORTAL_DEPARTMENTS.map(dept => (
              <button key={dept} type="button" style={s.chip(draft.departments.includes(dept))} onClick={() => toggleDept(dept)}>
                {draft.departments.includes(dept) ? "✓ " : ""}{PORTAL_DEPARTMENT_LABELS[dept]}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 15, color: C.ink }}>Questions ({draft.questions.length})</div>
          <button style={s.btn(C.panelInset, C.inkSoft)} onClick={addQuestion}><Plus size={14} /> Add question</button>
        </div>

        {draft.questions.map((q, i) => (
          <div key={i} style={s.card}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <input style={{ ...s.input, marginBottom: 8, fontWeight: 600 }} value={q.questionText} onChange={e => updateQuestion(i, { questionText: e.target.value })} placeholder="Question text" />
                {fieldTypeNeedsOptions(q.fieldType) && (
                  <input
                    style={s.input} placeholder="Options, comma-separated (e.g. Pass, Fail, N/A)"
                    value={(q.options || []).join(", ")}
                    onChange={e => updateQuestion(i, { options: e.target.value.split(",").map(o => o.trim()) })}
                  />
                )}
              </div>
              <select
                style={{ ...s.input, width: 150, flexShrink: 0 }} value={q.fieldType}
                onChange={e => updateQuestion(i, {
                  fieldType: e.target.value, options: fieldTypeNeedsOptions(e.target.value) ? q.options : [],
                  escalationDepartment: fieldTypeCanEscalate(e.target.value) ? q.escalationDepartment : null,
                  escalationTriggerValue: fieldTypeCanEscalate(e.target.value) ? q.escalationTriggerValue : null,
                })}
              >
                {PORTAL_FIELD_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <button onClick={() => removeQuestion(i)} style={{ background: "transparent", border: "none", color: C.status.danger.text, cursor: "pointer", padding: 8, flexShrink: 0 }}><Trash2 size={16} /></button>
            </div>

            {fieldTypeCanEscalate(q.fieldType) && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <AlertTriangle size={14} color={C.status.danger.text} />
                <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>Escalate if answer is</span>
                <select
                  style={{ ...s.input, width: 160 }}
                  value={q.escalationTriggerValue || ""}
                  onChange={e => updateQuestion(i, { escalationTriggerValue: e.target.value || null, escalationDepartment: e.target.value ? (q.escalationDepartment || PORTAL_DEPARTMENTS[0]) : null })}
                >
                  <option value="">— none —</option>
                  {(q.fieldType === "yesno" ? ["yes", "no"] : (q.options || []).filter(o => o.trim())).map(v => (
                    <option key={v} value={v}>{q.fieldType === "yesno" ? (v === "yes" ? "Yes" : "No") : v}</option>
                  ))}
                </select>
                {q.escalationTriggerValue && (
                  <>
                    <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>send to</span>
                    <select style={{ ...s.input, width: 170 }} value={q.escalationDepartment || ""} onChange={e => updateQuestion(i, { escalationDepartment: e.target.value })}>
                      {PORTAL_DEPARTMENTS.map(dept => <option key={dept} value={dept}>{PORTAL_DEPARTMENT_LABELS[dept]}</option>)}
                    </select>
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {draftDocumentId && (
          <div style={s.card}>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 4 }}>Who needs to complete this</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Assignment rules. A rule applies immediately to everyone it matches today, and (when "auto-apply to new hires" is on) to anyone added later who matches it.</div>

            {loadingRules ? (
              <div style={{ fontSize: 13, color: C.muted }}>Loading…</div>
            ) : assignmentRules.length === 0 ? (
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>No assignment rules yet — this document is available but not assigned to anyone.</div>
            ) : (
              <div style={{ marginBottom: 12 }}>
                {assignmentRules.map(r => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
                    <div style={{ flex: 1, fontSize: 13, color: C.inkSoft }}>
                      {r.target_type === "everyone" && "Everyone"}
                      {r.target_type === "role" && `Every ${r.target_role}`}
                      {r.target_type === "individual" && (companyRoster.find(m => m.id === r.target_roster_id)?.name || `Roster #${r.target_roster_id}`)}
                      {r.due_days != null ? ` · due ${r.due_days} day${r.due_days === 1 ? "" : "s"} after assignment` : " · no due date"}
                      {r.auto_apply_new_hires ? " · auto-applies to new hires" : ""}
                    </div>
                    <button onClick={() => deleteRule(r.id)} style={{ background: "transparent", border: "none", color: C.status.danger.text, cursor: "pointer", padding: 4 }}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={s.label}>Assign to</label>
                <select style={s.input} value={newRule.targetType} onChange={e => setNewRule(r => ({ ...r, targetType: e.target.value }))}>
                  <option value="everyone">Everyone</option>
                  <option value="role">By role</option>
                  <option value="individual">One person</option>
                </select>
              </div>
              {newRule.targetType === "role" && (
                <div>
                  <label style={s.label}>Role</label>
                  <select style={s.input} value={newRule.targetRole} onChange={e => setNewRule(r => ({ ...r, targetRole: e.target.value }))}>
                    <option value="worker">Worker</option>
                    <option value="supervisor">Supervisor</option>
                  </select>
                </div>
              )}
              {newRule.targetType === "individual" && (
                <div>
                  <label style={s.label}>Person</label>
                  <select style={s.input} value={newRule.targetRosterId} onChange={e => setNewRule(r => ({ ...r, targetRosterId: e.target.value }))}>
                    <option value="">Select…</option>
                    {companyRoster.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              )}
              <div style={{ width: 130 }}>
                <label style={s.label}>Due (days)</label>
                <input style={s.input} type="number" min="0" value={newRule.dueDays} onChange={e => setNewRule(r => ({ ...r, dueDays: e.target.value }))} placeholder="No due date" />
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.inkSoft, paddingBottom: 9 }}>
                <input type="checkbox" checked={newRule.autoApplyNewHires} onChange={e => setNewRule(r => ({ ...r, autoApplyNewHires: e.target.checked }))} />
                Auto-apply to new hires
              </label>
              <button style={s.btn(savingRule ? C.panelInset : C.amber, savingRule ? C.muted : C.onOrange)} disabled={savingRule || (newRule.targetType === "individual" && !newRule.targetRosterId)} onClick={createRule}>
                {savingRule ? <Loader2 size={14} className="fora-spin" /> : <Plus size={14} />} Add rule
              </button>
            </div>
          </div>
        )}

        {msg && <div style={{ ...s.card, color: /couldn't|error/i.test(msg) ? C.status.danger.text : C.status.success.text }}>{msg}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button style={s.btn(saving || !canPublish ? C.panelInset : C.amber, saving || !canPublish ? C.muted : C.onOrange)} disabled={saving || !canPublish} onClick={publish}>
            {saving ? <><Loader2 size={16} className="fora-spin" /> Publishing…</> : <><CheckCircle2 size={16} /> Publish document</>}
          </button>
        </div>
        <style>{"@keyframes fora-spin { to { transform: rotate(360deg); } } .fora-spin { animation: fora-spin 0.8s linear infinite; }"}</style>
      </div>
    );
  }

  // ── List / start screen ─────────────────────────────────────────────────
  return (
    <div>
      <div style={{ fontFamily: FONT.heading, fontWeight: 800, fontSize: 20, color: C.ink, marginBottom: 4 }}>Document Builder</div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Turn a customer's own paper form into a live Company Portal document. Nothing reaches a customer login until you publish.</div>

      <div style={{ ...s.card, marginBottom: 20 }}>
        <label style={s.label}>Building for</label>
        <select style={s.input} value={companyId} onChange={e => setCompanyId(e.target.value)}>
          <option value="">Select a company…</option>
          {(companies || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {companyId && (
        <>
          <div style={{ ...s.card }}>
            <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 10 }}>New document</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <label style={{ ...s.btn(C.amber), cursor: starting ? "default" : "pointer", opacity: starting ? 0.6 : 1 }}>
                <Upload size={15} /> Upload a file
                <input type="file" accept=".pdf,image/*" style={{ display: "none" }} disabled={starting}
                  onChange={e => { const f = e.target.files?.[0]; if (f) startFromUpload(f); }} />
              </label>
              <button style={s.ghostBtn} disabled={starting} onClick={startFromScratch}><FileText size={15} style={{ marginRight: 6 }} />Start from scratch</button>
            </div>
            <label style={s.label}>Or describe it (no file to upload)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={s.input} value={structureNotes} onChange={e => setStructureNotes(e.target.value)} placeholder="e.g. Weekly forklift pre-use checklist, about 8 items, mostly pass/fail" />
              <button style={s.btn(C.panelInset, C.inkSoft)} disabled={starting} onClick={startFromDescription}>Draft it</button>
            </div>
            {starting && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}><Loader2 size={14} className="fora-spin" /> Reading document…</div>}
            {startError && <div style={{ fontSize: 12.5, color: C.status.danger.text, marginTop: 10 }}>{startError}</div>}
          </div>

          <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 15, color: C.ink, margin: "20px 0 10px" }}>Existing documents</div>
          {loadingDocs ? (
            <div style={{ color: C.muted, fontSize: 13 }}>Loading…</div>
          ) : documents.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 13 }}>No documents built for this company yet.</div>
          ) : (
            documents.map(doc => (
              <div key={doc.id} style={{ ...s.card, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 22 }}>{doc.icon || "📄"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.ink }}>{doc.title}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>
                    {doc.category || "No category"} · {(doc.departments || []).map(d => PORTAL_DEPARTMENT_LABELS[d]).join(", ") || "No department set"}
                  </div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700, borderRadius: RAD.pill, padding: "3px 9px",
                  background: doc.is_active ? C.status.success.bg : C.status.danger.bg,
                  color: doc.is_active ? C.status.success.text : C.status.danger.text,
                }}>{doc.is_active ? "ACTIVE" : "OFF"}</span>
                <button style={s.ghostBtn} onClick={() => openExisting(doc)}>Edit</button>
                <button style={s.ghostBtn} onClick={() => toggleActive(doc)}>{doc.is_active ? "Turn off" : "Turn on"}</button>
                <button onClick={() => deleteDoc(doc)} style={{ background: "transparent", border: "none", color: C.status.danger.text, cursor: "pointer", padding: 8 }}><Trash2 size={16} /></button>
              </div>
            ))
          )}
        </>
      )}
      <style>{"@keyframes fora-spin { to { transform: rotate(360deg); } } .fora-spin { animation: fora-spin 0.8s linear infinite; }"}</style>
    </div>
  );
}
