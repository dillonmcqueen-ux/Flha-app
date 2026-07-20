import { useState, useEffect } from "react";

// Design tokens — matches AdminPanel.jsx
const C = {
  ink: "#1E293B",
  inkSoft: "#475569",
  amber: "#F59E0B",
  amberDark: "#B45309",
  green: "#16A34A",
  bg: "#EEF2F6",
  line: "#E2E8F0",
  white: "#FFFFFF",
  muted: "#94A3B8",
};

export default function MonthlyInspectionBuilder({ companyId, token }) {
  const [forms, setForms] = useState([]);
  const [selectedFormId, setSelectedFormId] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [newFormTitle, setNewFormTitle] = useState("");
  const [newQuestionText, setNewQuestionText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const call = async (action, body = {}) => {
    const res = await fetch("/api/monthly", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, token, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  };

  const loadForms = async () => {
    setLoading(true); setMsg("");
    try {
      const data = await call("list_forms", { companyId });
      const list = data.forms || [];
      setForms(list);
      if (!selectedFormId && list.length > 0) setSelectedFormId(list[0].id);
    } catch (e) {
      setMsg(e.message);
    }
    setLoading(false);
  };

  const loadQuestions = async (formId) => {
    if (!formId) { setQuestions([]); return; }
    try {
      const data = await call("list_questions", { formId });
      setQuestions(data.questions || []);
    } catch (e) {
      setMsg(e.message);
    }
  };

  useEffect(() => { loadForms(); }, [companyId]);
  useEffect(() => { loadQuestions(selectedFormId); }, [selectedFormId]);

  const handleCreateForm = async () => {
    if (!newFormTitle.trim()) return;
    setSaving(true); setMsg("");
    try {
      const data = await call("create_form", { companyId, title: newFormTitle });
      setNewFormTitle("");
      setForms(prev => [data.form, ...prev]);
      setSelectedFormId(data.form.id);
    } catch (e) {
      setMsg(e.message);
    }
    setSaving(false);
  };

  const handleToggleActive = async (form) => {
    try {
      await call("toggle_form", { formId: form.id, isActive: !form.is_active });
      setForms(prev => prev.map(f => f.id === form.id ? { ...f, is_active: !f.is_active } : f));
    } catch (e) {
      setMsg(e.message);
    }
  };

  const handleDeleteForm = async (form) => {
    if (!window.confirm(`Delete "${form.title}"? This removes all its questions. This cannot be undone.`)) return;
    try {
      await call("delete_form", { formId: form.id });
      setForms(prev => prev.filter(f => f.id !== form.id));
      if (selectedFormId === form.id) setSelectedFormId(null);
    } catch (e) {
      setMsg(e.message);
    }
  };

  const handleAddQuestion = async () => {
    if (!newQuestionText.trim() || !selectedFormId) return;
    setSaving(true); setMsg("");
    try {
      const data = await call("add_question", { formId: selectedFormId, questionText: newQuestionText });
      setNewQuestionText("");
      setQuestions(prev => [...prev, data.question]);
    } catch (e) {
      setMsg(e.message);
    }
    setSaving(false);
  };

  const handleDeleteQuestion = async (questionId) => {
    try {
      await call("delete_question", { questionId });
      setQuestions(prev => prev.filter(q => q.id !== questionId));
    } catch (e) {
      setMsg(e.message);
    }
  };

  const handleReorder = async (index, direction) => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= questions.length) return;
    const reordered = [...questions];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    const updates = reordered.map((q, i) => ({ ...q, sort_order: i }));
    setQuestions(updates);
    try {
      await call("reorder_questions", { updates: updates.map(q => ({ id: q.id, sort_order: q.sort_order })) });
    } catch (e) {
      setMsg(e.message);
    }
  };

  const selectedForm = forms.find(f => f.id === selectedFormId);

  const st = {
    card: { background: C.white, borderRadius: 14, padding: 18, boxShadow: "0 1px 3px #0f172a12" },
    input: { width: "100%", padding: "11px 13px", borderRadius: 9, border: `1.5px solid ${C.line}`, fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 11, background: "#F8FAFC" },
    label: { display: "block", fontWeight: 700, fontSize: 12, color: C.inkSoft, marginBottom: 6, letterSpacing: 0.3, textTransform: "uppercase" },
    darkBtn: { background: C.ink, color: C.white, border: "none", borderRadius: 10, padding: "12px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer" },
  };

  if (loading) return <div style={{ ...st.card, color: C.inkSoft, textAlign: "center" }}>Loading forms…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {msg && <div style={{ ...st.card, background: msg.toLowerCase().includes("couldn't") ? "#FEE2E2" : "#DCFCE7", color: msg.toLowerCase().includes("couldn't") ? "#991B1B" : "#166534", fontSize: 14 }}>{msg}</div>}

      {/* Form list + create */}
      <div style={st.card}>
        <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, marginBottom: 4 }}>Monthly Inspection Forms</div>
        <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 12 }}>Build the question list your field crews fill out every month. Only "Active" forms are available to workers.</div>

        {forms.length === 0 ? (
          <div style={{ color: C.muted, padding: "14px 0", textAlign: "center" }}>No forms yet. Create the first one below.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {forms.map(form => (
              <div
                key={form.id}
                onClick={() => setSelectedFormId(form.id)}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "11px 13px", borderRadius: 9, cursor: "pointer",
                  border: `1.5px solid ${form.id === selectedFormId ? C.amber : C.line}`,
                  background: form.id === selectedFormId ? "#FFFBEB" : "#fff",
                }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{form.title}</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggleActive(form); }}
                    style={{
                      fontSize: 11, fontWeight: 700, borderRadius: 20, padding: "4px 10px", border: "none", cursor: "pointer",
                      background: form.is_active ? "#DCFCE7" : "#F1F5F9",
                      color: form.is_active ? C.green : C.muted,
                    }}>
                    {form.is_active ? "Active" : "Inactive"}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteForm(form); }}
                    style={{ background: "transparent", border: "none", color: "#DC2626", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...st.input, marginBottom: 0, flex: 1 }}
            placeholder="New form title (e.g. Monthly Site Inspection)"
            value={newFormTitle}
            onChange={e => setNewFormTitle(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreateForm(); }}
          />
          <button style={{ ...st.darkBtn, flexShrink: 0 }} onClick={handleCreateForm} disabled={saving || !newFormTitle.trim()}>
            {saving ? "…" : "Create"}
          </button>
        </div>
      </div>

      {/* Question builder */}
      {selectedForm && (
        <div style={st.card}>
          <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, marginBottom: 2 }}>Questions — {selectedForm.title}</div>
          <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 12 }}>Each one gets a Yes/No answer in the field. A "No" answer prompts for a corrective action.</div>

          {questions.length === 0 ? (
            <div style={{ color: C.muted, padding: "14px 0", textAlign: "center" }}>No questions yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {questions.map((q, i) => (
                <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 13px", borderRadius: 9, border: `1.5px solid ${C.line}` }}>
                  <span style={{ width: 20, flexShrink: 0, fontSize: 12, color: C.muted, fontWeight: 700 }}>{i + 1}.</span>
                  <span style={{ flex: 1, fontSize: 14, color: C.ink }}>{q.question_text}</span>
                  <button onClick={() => handleReorder(i, "up")} disabled={i === 0} style={{ background: "transparent", border: "none", color: i === 0 ? "#CBD5E1" : C.inkSoft, cursor: i === 0 ? "default" : "pointer", fontSize: 13 }}>▲</button>
                  <button onClick={() => handleReorder(i, "down")} disabled={i === questions.length - 1} style={{ background: "transparent", border: "none", color: i === questions.length - 1 ? "#CBD5E1" : C.inkSoft, cursor: i === questions.length - 1 ? "default" : "pointer", fontSize: 13 }}>▼</button>
                  <button onClick={() => handleDeleteQuestion(q.id)} style={{ background: "transparent", border: "none", color: "#DC2626", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...st.input, marginBottom: 0, flex: 1 }}
              placeholder="Add a question (e.g. Fire extinguishers accessible and charged?)"
              value={newQuestionText}
              onChange={e => setNewQuestionText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAddQuestion(); }}
            />
            <button style={{ ...st.darkBtn, flexShrink: 0 }} onClick={handleAddQuestion} disabled={saving || !newQuestionText.trim()}>
              {saving ? "…" : "Add"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
