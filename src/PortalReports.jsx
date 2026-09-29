import { useState, useEffect } from "react";
import { colors as T, font as FONT, radius as RAD } from "./theme";
import { PORTAL_DEPARTMENTS, PORTAL_DEPARTMENT_LABELS } from "../server-lib/portalDepartments";
import { Plus, Trash2, Loader2, Send, X } from "lucide-react";

// Supervisor tool: "email this department's completed Portal documents",
// on a schedule. Each schedule picks a department, a frequency, and who
// gets it (the department's supervisors and/or extra addresses added here).
// The server (api/portal.js save_report_schedule) does all the checking.
const C = {
  ink: T.text.primary, inkSoft: T.text.body, muted: T.text.faint,
  panelInset: T.panelInset, panel: T.panel, line: T.line, amber: T.orange, onOrange: T.text.onOrange, status: T.status,
};
const s = {
  input: { width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: RAD.sm, border: `1.5px solid ${C.line}`, background: C.panel, color: C.ink, fontSize: 13.5 },
  label: { display: "block", fontSize: 11.5, fontWeight: 700, color: C.muted, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.03em" },
  btn: (bg, fg = C.onOrange) => ({ background: bg, color: fg, border: "none", borderRadius: RAD.sm, padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }),
  ghost: { background: "transparent", border: `1.5px solid ${C.line}`, borderRadius: RAD.sm, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", color: C.inkSoft, display: "inline-flex", alignItems: "center", gap: 6 },
};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const blank = () => ({ id: null, name: "", department: "safety", frequency: "daily", weekday: 1, includeDepartmentSupervisors: true, recipients: [], active: true });

async function post(body) {
  const res = await fetch("/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

export default function PortalReports({ token, companyId }) {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(null);
  const [emailInput, setEmailInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [msg, setMsg] = useState({ text: "", bad: false });

  const load = async () => {
    setLoading(true);
    try {
      const data = await post({ action: "list_report_schedules", token, companyId });
      setSchedules(data.schedules || []);
    } catch (e) { setMsg({ text: e.message, bad: true }); }
    setLoading(false);
  };
  useEffect(() => { if (companyId) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId]);

  const addEmail = () => {
    const e = emailInput.trim();
    if (!e) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setMsg({ text: `"${e}" doesn't look like a valid email address.`, bad: true }); return; }
    setMsg({ text: "", bad: false });
    setDraft(d => (d.recipients.some(x => x.toLowerCase() === e.toLowerCase()) ? d : { ...d, recipients: [...d.recipients, e] }));
    setEmailInput("");
  };

  const save = async () => {
    setSaving(true);
    try {
      await post({ action: "save_report_schedule", token, companyId, ...draft });
      setDraft(null); setMsg({ text: "Saved.", bad: false });
      await load();
    } catch (e) { setMsg({ text: e.message, bad: true }); }
    setSaving(false);
  };

  const remove = async (id) => {
    try { await post({ action: "delete_report_schedule", token, id }); await load(); }
    catch (e) { setMsg({ text: e.message, bad: true }); }
  };

  const sendNow = async (id) => {
    setSendingId(id);
    try {
      const r = await post({ action: "send_report_schedule_now", token, id });
      setMsg({ text: r.recordCount === 0 ? "Nothing new to send since the last report." : `Sent ${r.recordCount} document${r.recordCount === 1 ? "" : "s"} to ${r.sent} address${r.sent === 1 ? "" : "es"}.`, bad: r.recordCount > 0 && r.sent === 0 });
      await load();
    } catch (e) { setMsg({ text: e.message, bad: true }); }
    setSendingId(null);
  };

  const describe = (r) => `${PORTAL_DEPARTMENT_LABELS[r.department] || r.department}, ${r.frequency === "weekly" ? `every ${DAYS[r.weekday]}` : "every day"}`;

  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
        Email a department's completed Portal documents automatically. Each report lists what was submitted since the last one, with PDF links that work for 7 days. Reports go out around 7 am Mountain (times are UTC based, so an hour earlier or later in winter).
      </div>

      {loading ? <div style={{ color: C.muted, fontSize: 13 }}>Loading...</div> : schedules.length === 0 && !draft ? (
        <div style={{ color: C.muted, fontSize: 13, marginBottom: 12 }}>No report schedules yet.</div>
      ) : (
        schedules.map(r => (
          <div key={r.id} style={{ padding: "12px 4px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.ink }}>{r.name}{!r.active && <span style={{ marginLeft: 8, fontSize: 10, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 99, padding: "2px 7px" }}>PAUSED</span>}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                {describe(r)}{r.includeDepartmentSupervisors ? ", department supervisors" : ""}{r.recipients.length ? `, ${r.recipients.length} extra address${r.recipients.length === 1 ? "" : "es"}` : ""}
                {r.lastSentAt ? `, last sent ${new Date(r.lastSentAt).toLocaleDateString("en-CA")}` : ", not sent yet"}
              </div>
            </div>
            <button style={s.ghost} disabled={sendingId === r.id} onClick={() => sendNow(r.id)}>
              {sendingId === r.id ? <Loader2 size={14} className="fora-spin" /> : <Send size={14} />} Send now
            </button>
            <button style={s.ghost} onClick={() => { setDraft({ ...blank(), ...r, weekday: r.weekday ?? 1 }); setMsg({ text: "", bad: false }); }}>Edit</button>
            <button onClick={() => remove(r.id)} aria-label={`Delete ${r.name}`} style={{ background: "transparent", border: "none", color: C.status.danger.text, cursor: "pointer", padding: 8 }}><Trash2 size={16} /></button>
          </div>
        ))
      )}

      {!draft && (
        <button style={{ ...s.btn(C.amber), marginTop: 14 }} onClick={() => { setDraft(blank()); setMsg({ text: "", bad: false }); }}><Plus size={14} /> New schedule</button>
      )}

      {draft && (
        <div style={{ background: C.panelInset, border: `1px solid ${C.line}`, borderRadius: RAD.md, padding: 14, marginTop: 14 }}>
          <div style={{ fontFamily: FONT.heading, fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 10 }}>{draft.id ? "Edit schedule" : "New schedule"}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "2 1 200px" }}>
              <label style={s.label}>Name</label>
              <input style={s.input} value={draft.name} maxLength={80} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Safety daily digest" />
            </div>
            <div style={{ flex: "1 1 150px" }}>
              <label style={s.label}>Department</label>
              <select style={s.input} value={draft.department} onChange={e => setDraft(d => ({ ...d, department: e.target.value }))}>
                {PORTAL_DEPARTMENTS.map(d => <option key={d} value={d}>{PORTAL_DEPARTMENT_LABELS[d]}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 120px" }}>
              <label style={s.label}>How often</label>
              <select style={s.input} value={draft.frequency} onChange={e => setDraft(d => ({ ...d, frequency: e.target.value }))}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            {draft.frequency === "weekly" && (
              <div style={{ flex: "1 1 130px" }}>
                <label style={s.label}>Day</label>
                <select style={s.input} value={draft.weekday} onChange={e => setDraft(d => ({ ...d, weekday: Number(e.target.value) }))}>
                  {DAYS.map((n, i) => <option key={n} value={i}>{n}</option>)}
                </select>
              </div>
            )}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.inkSoft, marginTop: 12 }}>
            <input type="checkbox" checked={draft.includeDepartmentSupervisors} onChange={e => setDraft(d => ({ ...d, includeDepartmentSupervisors: e.target.checked }))} />
            Send to the supervisors in this department
          </label>

          <label style={{ ...s.label, marginTop: 12 }}>Extra email addresses</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={s.input} type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } }} placeholder="name@company.com" aria-label="Add an email address" />
            <button type="button" style={s.btn(C.amber)} onClick={addEmail}><Plus size={14} /> Add email</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {draft.recipients.map(e => (
              <span key={e} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 99, padding: "4px 6px 4px 12px", fontSize: 12.5, color: C.inkSoft }}>
                {e}
                <button type="button" aria-label={`Remove ${e}`} onClick={() => setDraft(d => ({ ...d, recipients: d.recipients.filter(x => x !== e) }))}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: C.muted, padding: 2, display: "flex" }}><X size={14} /></button>
              </span>
            ))}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.inkSoft, marginTop: 12 }}>
            <input type="checkbox" checked={draft.active} onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))} />
            Active (untick to pause)
          </label>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button style={s.btn(saving || !draft.name.trim() ? C.panel : C.amber, saving || !draft.name.trim() ? C.muted : C.onOrange)} disabled={saving || !draft.name.trim()} onClick={save}>
              {saving && <Loader2 size={14} className="fora-spin" />} Save schedule
            </button>
            <button style={s.ghost} onClick={() => { setDraft(null); setEmailInput(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {msg.text && <div style={{ marginTop: 12, fontSize: 13, color: msg.bad ? C.status.danger.text : C.status.success.text }}>{msg.text}</div>}
    </div>
  );
}
