import { useState, useEffect } from "react";

const ICON_OPTIONS = ["📄", "🧯", "🦺", "🔧", "🏗️", "🧪", "🔥", "🚧", "📦", "🧰", "⚡", "🌡️", "🛠", "📋", "✅"];
const COLOR_OPTIONS = ["#4338CA", "#0369A1", "#7C3AED", "#D97706", "#DC2626", "#16A34A", "#DB2777", "#0F766E"];

export default function CustomFormBuilder({ companyId, companyName, onBack, token }) {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingForm, setEditingForm] = useState(null); // null = list view, object = editing/creating
  const [questions, setQuestions] = useState([]);
  const [newQuestion, setNewQuestion] = useState("");
  const [saving, setSaving] = useState(false);

  const loadForms = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/customforms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_forms", token, companyId }),
      });
      const data = await res.json();
      if (res.ok) setForms(data.forms || []);
    } catch (e) { /* leave list as-is */ }
    setLoading(false);
  };

  useEffect(() => { loadForms(); }, [companyId]);

  const loadQuestions = async (formId) => {
    try {
      const res = await fetch("/api/customforms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_questions", token, formId }),
      });
      const data = await res.json();
      if (res.ok) setQuestions(data.questions || []);
    } catch (e) { /* leave questions as-is */ }
  };

  const startNew = () => {
    setEditingForm({ id: null, title: "", icon: "📄", accent_color: "#4338CA", is_active: true });
    setQuestions([]);
  };

  const startEdit = async (form) => {
    setEditingForm(form);
    await loadQuestions(form.id);
  };

  const saveFormDetails = async () => {
    if (!editingForm.title.trim()) return;
    setSaving(true);
    try {
      if (editingForm.id) {
        await fetch("/api/customforms", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update_form", token, formId: editingForm.id,
            title: editingForm.title, icon: editingForm.icon, accentColor: editingForm.accent_color,
          }),
        });
      } else {
        const res = await fetch("/api/customforms", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create_form", token, companyId,
            title: editingForm.title, icon: editingForm.icon, accentColor: editingForm.accent_color,
          }),
        });
        const data = await res.json();
        if (res.ok) setEditingForm(data.form);
      }
      await loadForms();
    } catch (e) { /* keep local state */ }
    setSaving(false);
  };

  const addQuestion = async () => {
    if (!newQuestion.trim() || !editingForm.id) return;
    try {
      const res = await fetch("/api/customforms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_question", token, formId: editingForm.id, questionText: newQuestion }),
      });
      const data = await res.json();
      if (res.ok) setQuestions(prev => [...prev, data.question]);
      setNewQuestion("");
    } catch (e) { /* ignore */ }
  };

  const removeQuestion = async (questionId) => {
    try {
      await fetch("/api/customforms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_question", token, questionId }),
      });
    } catch (e) { /* ignore */ }
    setQuestions(prev => prev.filter(q => q.id !== questionId));
  };

  const moveQuestion = async (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= questions.length) return;
    const reordered = [...questions];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];
    setQuestions(reordered);
    const updates = reordered.map((q, i) => ({ id: q.id, sort_order: i }));
    try {
      await fetch("/api/customforms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reorder_questions", token, updates }),
      });
    } catch (e) { /* ignore */ }
  };

  const toggleFormActive = async (form) => {
    try {
      await fetch("/api/customforms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_form", token, formId: form.id, isActive: !form.is_active }),
      });
    } catch (e) { /* ignore */ }
    setForms(prev => prev.map(f => f.id === form.id ? { ...f, is_active: !f.is_active } : f));
  };

  const deleteForm = async (form) => {
    if (!window.confirm(`Delete "${form.title}"? This only works if no one has submitted this document yet.`)) return;
    try {
      const res = await fetch("/api/customforms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_form", token, formId: form.id }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Couldn't delete."); return; }
      setForms(prev => prev.filter(f => f.id !== form.id));
    } catch (e) { /* ignore */ }
  };

  const s = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#F0F4F8", minHeight: "100vh", padding: 16 },
    header: { background: "linear-gradient(135deg,#1E3A5F,#2D5F8A)", borderRadius: 14, padding: "18px 20px", marginBottom: 16, color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" },
    card: { background: "#fff", borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: "0 1px 3px #0f172a12" },
    label: { display: "block", fontWeight: 700, fontSize: 12, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 },
    input: { width: "100%", padding: "11px 13px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 11, background: "#F8FAFC" },
    btn: (bg, fg = "#fff") => ({ background: bg, color: fg, border: "none", borderRadius: 10, padding: "13px", fontWeight: 800, fontSize: 15, cursor: "pointer", width: "100%" }),
    ghost: { background: "#F1F5F9", color: "#334155", border: "none", borderRadius: 10, padding: "11px", fontWeight: 600, fontSize: 14, cursor: "pointer", width: "100%", marginTop: 10 },
  };

  // ── LIST VIEW ────────────────────────────────────────────
  if (!editingForm) {
    return (
      <div style={s.wrap}>
        <div style={s.header}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, opacity: 0.8, textTransform: "uppercase" }}>{companyName}</div>
            <div style={{ fontWeight: 800, fontSize: 20, marginTop: 2 }}>Custom Documents</div>
          </div>
          <button onClick={onBack} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "7px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>← Back</button>
        </div>

        <div style={s.card}>
          <button style={s.btn("#4338CA")} onClick={startNew}>+ New Custom Document</button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: "#94A3B8" }}>Loading…</div>
        ) : forms.length === 0 ? (
          <div style={{ ...s.card, textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
            No custom documents yet for this company.
          </div>
        ) : (
          forms.map(f => (
            <div key={f.id} style={{ ...s.card, borderLeft: `4px solid ${f.accent_color}`, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>{f.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }} onClick={() => startEdit(f)}>
                <div style={{ fontWeight: 800, fontSize: 16, color: "#1E293B", cursor: "pointer" }}>{f.title}</div>
                <div style={{ fontSize: 12, color: f.is_active ? "#16A34A" : "#9CA3AF", fontWeight: 700, marginTop: 2 }}>
                  {f.is_active ? "● Active" : "○ Inactive"}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                <button onClick={() => toggleFormActive(f)} style={{ background: f.is_active ? "#FEF2F2" : "#F0FDF4", color: f.is_active ? "#DC2626" : "#16A34A", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {f.is_active ? "Deactivate" : "Activate"}
                </button>
                <button onClick={() => deleteForm(f)} style={{ background: "#F1F5F9", color: "#64748B", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Delete</button>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  // ── EDIT / CREATE VIEW ──────────────────────────────────
  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, opacity: 0.8, textTransform: "uppercase" }}>{companyName}</div>
          <div style={{ fontWeight: 800, fontSize: 20, marginTop: 2 }}>{editingForm.id ? "Edit Document" : "New Custom Document"}</div>
        </div>
        <button onClick={() => setEditingForm(null)} style={{ background: "#ffffff20", color: "#fff", border: "none", borderRadius: 8, padding: "7px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>← Back</button>
      </div>

      <div style={s.card}>
        <label style={s.label}>Document name</label>
        <input style={s.input} placeholder="e.g. Confined Space Entry Checklist" value={editingForm.title} onChange={e => setEditingForm({ ...editingForm, title: e.target.value })} />

        <label style={s.label}>Icon</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {ICON_OPTIONS.map(icon => (
            <button key={icon} onClick={() => setEditingForm({ ...editingForm, icon })}
              style={{
                width: 44, height: 44, borderRadius: 10, fontSize: 20, cursor: "pointer",
                border: editingForm.icon === icon ? "2px solid #4338CA" : "1.5px solid #E2E8F0",
                background: editingForm.icon === icon ? "#EEF2FF" : "#fff",
              }}>{icon}</button>
          ))}
        </div>

        <label style={s.label}>Accent color</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {COLOR_OPTIONS.map(color => (
            <button key={color} onClick={() => setEditingForm({ ...editingForm, accent_color: color })}
              style={{
                width: 36, height: 36, borderRadius: "50%", cursor: "pointer", background: color,
                border: editingForm.accent_color === color ? "3px solid #1E293B" : "3px solid transparent",
              }} />
          ))}
        </div>

        <button style={s.btn(saving ? "#94A3B8" : "#4338CA")} disabled={saving || !editingForm.title.trim()} onClick={saveFormDetails}>
          {saving ? "Saving…" : editingForm.id ? "Save Changes" : "Create & Add Questions →"}
        </button>
      </div>

      {editingForm.id && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: 15, color: "#1E293B", marginBottom: 4 }}>Checklist Questions</div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 14 }}>Workers answer Yes/No to each. A "No" answer requires a note.</div>

          {questions.map((q, i) => (
            <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderBottom: i < questions.length - 1 ? "1px solid #F3F4F6" : "none" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <button onClick={() => moveQuestion(i, -1)} disabled={i === 0} style={{ background: "none", border: "none", cursor: i === 0 ? "default" : "pointer", color: i === 0 ? "#CBD5E1" : "#64748B", fontSize: 12, padding: 2 }}>▲</button>
                <button onClick={() => moveQuestion(i, 1)} disabled={i === questions.length - 1} style={{ background: "none", border: "none", cursor: i === questions.length - 1 ? "default" : "pointer", color: i === questions.length - 1 ? "#CBD5E1" : "#64748B", fontSize: 12, padding: 2 }}>▼</button>
              </div>
              <div style={{ flex: 1, fontSize: 14, color: "#334155" }}>{i + 1}. {q.question_text}</div>
              <button onClick={() => removeQuestion(q.id)} style={{ background: "#FEF2F2", color: "#DC2626", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Remove</button>
            </div>
          ))}

          {questions.length === 0 && (
            <div style={{ textAlign: "center", padding: "20px 0", color: "#9CA3AF", fontSize: 13 }}>No questions added yet.</div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <input style={{ ...s.input, marginBottom: 0, flex: 1 }} placeholder="Add a checklist question…" value={newQuestion} onChange={e => setNewQuestion(e.target.value)} onKeyDown={e => e.key === "Enter" && addQuestion()} />
            <button onClick={addQuestion} disabled={!newQuestion.trim()} style={{ background: newQuestion.trim() ? "#4338CA" : "#94A3B8", color: "#fff", border: "none", borderRadius: 9, padding: "0 18px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Add</button>
          </div>
        </div>
      )}

      {editingForm.id && (
        <div style={s.card}>
          <button style={s.btn("#16A34A")} onClick={() => setEditingForm(null)}>✓ Done — Back to Documents</button>
        </div>
      )}
    </div>
  );
}
