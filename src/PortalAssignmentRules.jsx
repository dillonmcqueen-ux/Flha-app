import { useState, useEffect } from "react";
import { colors as T, font as FONT, radius as RAD } from "./theme";
import { Plus, Trash2, Loader2 } from "lucide-react";

// Who has to complete one Company Portal document. Used by the founder's
// document builder and by the supervisor's Portal > Assignments tab, so both
// see the same rules and the server (api/portal.js, loadManageableDocument)
// decides what each session may touch.
const C = {
  ink: T.text.primary, inkSoft: T.text.body, muted: T.text.faint,
  panelInset: T.panelInset, line: T.line, amber: T.orange, onOrange: T.text.onOrange, status: T.status,
};
const s = {
  input: { width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: RAD.sm, border: `1.5px solid ${C.line}`, background: C.panelInset, color: C.ink, fontSize: 13.5 },
  label: { display: "block", fontSize: 11.5, fontWeight: 700, color: C.muted, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.03em" },
  btn: (bg, textColor = C.onOrange) => ({ background: bg, color: textColor, border: "none", borderRadius: RAD.sm, padding: "10px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }),
};

async function post(body) {
  const res = await fetch("/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

export default function PortalAssignmentRules({ token, companyId, documentId, onChanged }) {
  const [rules, setRules] = useState([]);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [newRule, setNewRule] = useState({ targetType: "everyone", targetRole: "worker", targetRosterId: "", dueDays: "7", autoApplyNewHires: true });

  const loadRules = async () => {
    setLoading(true);
    try {
      const data = await post({ action: "list_assignment_rules", token, documentId });
      setRules(data.rules || []);
      setMsg("");
    } catch (e) { setMsg(e.message); }
    setLoading(false);
  };

  useEffect(() => {
    if (!documentId) { setRules([]); return; }
    loadRules();
    (async () => {
      try {
        const res = await fetch("/api/companydata", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_roster", token, companyId }),
        });
        const data = await res.json();
        if (res.ok) setRoster((data.members || []).filter(m => m.active !== false));
      } catch (e) { /* the person picker just stays empty */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const createRule = async () => {
    setSaving(true);
    try {
      await post({
        action: "create_assignment_rule", token, documentId,
        targetType: newRule.targetType,
        targetRole: newRule.targetType === "role" ? newRule.targetRole : undefined,
        targetRosterId: newRule.targetType === "individual" ? newRule.targetRosterId : undefined,
        dueDays: newRule.dueDays === "" ? null : newRule.dueDays,
        autoApplyNewHires: newRule.autoApplyNewHires,
      });
      await loadRules();
      if (onChanged) onChanged();
    } catch (e) { setMsg(e.message || "Couldn't create assignment rule."); }
    setSaving(false);
  };

  const deleteRule = async (ruleId) => {
    try {
      await post({ action: "delete_assignment_rule", token, ruleId });
      await loadRules();
      if (onChanged) onChanged();
    } catch (e) { setMsg(e.message || "Couldn't delete that rule."); }
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
        A rule applies right away to everyone it matches today, and, when "auto-apply to new hires" is on, to anyone added later who matches it. Deleting a rule does not take back assignments it already made.
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: C.muted }}>Loading...</div>
      ) : rules.length === 0 ? (
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>No assignment rules yet. This document is available but not assigned to anyone.</div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          {rules.map(r => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ flex: 1, fontSize: 13, color: C.inkSoft }}>
                {r.target_type === "everyone" && "Everyone"}
                {r.target_type === "role" && `Every ${r.target_role}`}
                {r.target_type === "individual" && (roster.find(m => m.id === r.target_roster_id)?.name || `Roster #${r.target_roster_id}`)}
                {r.due_days != null ? `, due ${r.due_days} day${r.due_days === 1 ? "" : "s"} after assignment` : ", no due date"}
                {r.auto_apply_new_hires ? ", auto-applies to new hires" : ""}
              </div>
              <button onClick={() => deleteRule(r.id)} aria-label="Delete rule" style={{ background: "transparent", border: "none", color: C.status.danger.text, cursor: "pointer", padding: 8 }}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ minWidth: 130 }}>
          <label style={s.label}>Assign to</label>
          <select style={s.input} value={newRule.targetType} onChange={e => setNewRule(r => ({ ...r, targetType: e.target.value }))}>
            <option value="everyone">Everyone</option>
            <option value="role">By role</option>
            <option value="individual">One person</option>
          </select>
        </div>
        {newRule.targetType === "role" && (
          <div style={{ minWidth: 120 }}>
            <label style={s.label}>Role</label>
            <select style={s.input} value={newRule.targetRole} onChange={e => setNewRule(r => ({ ...r, targetRole: e.target.value }))}>
              <option value="worker">Worker</option>
              <option value="supervisor">Supervisor</option>
            </select>
          </div>
        )}
        {newRule.targetType === "individual" && (
          <div style={{ minWidth: 160 }}>
            <label style={s.label}>Person</label>
            <select style={s.input} value={newRule.targetRosterId} onChange={e => setNewRule(r => ({ ...r, targetRosterId: e.target.value }))}>
              <option value="">Select...</option>
              {roster.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        )}
        <div style={{ width: 130 }}>
          <label style={s.label}>Due (days)</label>
          <input style={s.input} type="number" min="0" max="365" value={newRule.dueDays} onChange={e => setNewRule(r => ({ ...r, dueDays: e.target.value }))} placeholder="No due date" />
        </div>
        {newRule.targetType !== "individual" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.inkSoft, paddingBottom: 9 }}>
            <input type="checkbox" checked={newRule.autoApplyNewHires} onChange={e => setNewRule(r => ({ ...r, autoApplyNewHires: e.target.checked }))} />
            Auto-apply to new hires
          </label>
        )}
        <button style={s.btn(saving ? C.panelInset : C.amber, saving ? C.muted : C.onOrange)} disabled={saving || (newRule.targetType === "individual" && !newRule.targetRosterId)} onClick={createRule}>
          {saving ? <Loader2 size={14} className="fora-spin" /> : <Plus size={14} />} Add rule
        </button>
      </div>
      {msg && <div style={{ marginTop: 10, fontSize: 13, color: C.status.danger.text }}>{msg}</div>}
    </div>
  );
}
