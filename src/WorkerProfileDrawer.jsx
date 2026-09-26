import { useEffect, useState } from "react";
import { X, Mail, Phone, HardHat, CircleUserRound, ShieldCheck, MapPin } from "lucide-react";
import TimeClockMap from "./TimeClockMap";
import CollapsibleGroup from "./CollapsibleGroup";
import { colors as C, radius as RAD, shadow as SHAD } from "./theme";

const DOC_LABEL = {
  flha: "FLHA", inspection: "Equipment Inspection", toolbox: "Toolbox Talk",
  daily: "Daily Report", incident: "Incident Report", nearmiss: "Near Miss Report",
  monthly: "Monthly Inspection", customform: "Custom Document",
};

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: RAD.sm,
  border: `1.5px solid ${C.line}`, background: C.panelInset, color: C.text.primary, fontSize: 13,
};
const rowBtn = (tone) => ({
  background: tone.bg, color: tone.text, border: `1px solid ${tone.border}`, borderRadius: RAD.sm,
  padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
});

// Click a name in the Roster tab → this drawer. Everything it shows is
// pulled fresh from get_worker_profile (api/companydata.js) rather than
// reusing whatever the Roster tab already had in memory, so it's correct
// whichever tab it was opened from.
export default function WorkerProfileDrawer({
  open, loading, error, profile, certifications, certsModuleActive,
  onClose, onSave, saving, saveError, onToggleActive, togglingActive,
}) {
  const [draft, setDraft] = useState({ email: "", phone: "", role: "worker" });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (profile?.member) {
      setDraft({ email: profile.member.email || "", phone: profile.member.phone || "", role: profile.member.role });
      setDirty(false);
    }
  }, [profile?.member?.id, profile?.member?.email, profile?.member?.phone, profile?.member?.role]);

  if (!open) return null;

  const member = profile?.member;
  const set = (field) => (e) => { setDraft(d => ({ ...d, [field]: e.target.value })); setDirty(true); };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000B3", zIndex: 200, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div
        style={{ background: C.panel, width: "100%", maxWidth: 480, height: "100%", overflowY: "auto", padding: 20, boxShadow: SHAD.md, borderLeft: `1px solid ${C.line}` }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.text.primary }}>{member?.name || "Loading…"}</div>
            {member && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                {member.role === "supervisor" ? <HardHat size={13} color={C.text.muted} /> : <CircleUserRound size={13} color={C.text.muted} />}
                <span style={{ fontSize: 12, color: C.text.muted, textTransform: "capitalize" }}>{member.role}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, borderRadius: RAD.pill, padding: "1px 8px", marginLeft: 4,
                  background: member.active ? C.status.success.bg : C.status.danger.bg,
                  color: member.active ? C.status.success.text : C.status.danger.text,
                  border: `1px solid ${member.active ? C.status.success.border : C.status.danger.border}`,
                }}>{member.active ? "ACTIVE" : "INACTIVE"}</span>
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: C.text.muted, padding: 4 }}><X size={20} /></button>
        </div>

        {loading && <div style={{ textAlign: "center", padding: "32px 0", color: C.text.faint }}>Loading…</div>}
        {error && <div style={{ fontSize: 13, color: C.status.danger.text, marginBottom: 12 }}>{error}</div>}

        {member && (
          <>
            {/* ── Editable details. Name and Employee ID stay off this
                drawer on purpose: name is identity (never edited), and
                Employee ID already has its own clash-checked inline editor
                on the Roster row. ── */}
            <div style={{ background: C.panelInset, border: `1px solid ${C.line}`, borderRadius: RAD.md, padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.text.faint, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>Details</div>

              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: C.text.muted, marginBottom: 4 }}><Mail size={12} />Email</label>
              <input style={{ ...inputStyle, marginBottom: 10 }} type="email" value={draft.email} onChange={set("email")} placeholder="No email on file" />

              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: C.text.muted, marginBottom: 4 }}><Phone size={12} />Phone</label>
              <input style={{ ...inputStyle, marginBottom: 10 }} type="tel" value={draft.phone} onChange={set("phone")} placeholder="No phone on file" />

              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.text.muted, marginBottom: 4 }}>Role</label>
              <select style={{ ...inputStyle, marginBottom: 10, cursor: "pointer" }} value={draft.role} onChange={set("role")}>
                <option value="worker">Worker</option>
                <option value="supervisor">Supervisor</option>
              </select>

              {member.employeeId && <div style={{ fontSize: 12, color: C.text.faint, marginBottom: 10 }}>Employee ID: <strong style={{ color: C.text.body }}>{member.employeeId}</strong></div>}

              {saveError && <div style={{ fontSize: 12, color: C.status.danger.text, marginBottom: 8 }}>{saveError}</div>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => onSave(draft)}
                  disabled={!dirty || saving}
                  style={{ ...rowBtn(C.status.success), opacity: (!dirty || saving) ? 0.5 : 1 }}
                >{saving ? "Saving…" : "Save changes"}</button>
                <button
                  onClick={() => onToggleActive(member)}
                  disabled={togglingActive}
                  style={rowBtn(member.active ? C.status.danger : C.status.success)}
                >{togglingActive ? "Working…" : member.active ? "Deactivate" : "Reactivate"}</button>
              </div>
            </div>

            {certsModuleActive && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: C.text.primary, marginBottom: 8 }}>
                  <ShieldCheck size={14} color={C.text.muted} />Certifications
                </div>
                {(!certifications || certifications.length === 0) ? (
                  <div style={{ fontSize: 12, color: C.text.faint }}>No certifications uploaded yet.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {certifications.map(c => (
                      <div key={c.id} style={{ fontSize: 12.5, color: C.text.body, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontWeight: 600 }}>{c.cert_name}</span>
                        <span style={{ color: C.text.faint }}>({c.cert_type})</span>
                        {c.expiry_date && (
                          <span style={{ color: c.status === "expired" ? C.status.danger.text : c.status === "expiring_soon" ? C.status.warning.text : C.text.faint }}>
                            {c.status === "expired" ? "Expired" : "Valid to"} {new Date(c.expiry_date).toLocaleDateString("en-CA")}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text.primary, marginBottom: 8 }}>Signed Documents ({(profile.documents || []).length})</div>
              {(!profile.documents || profile.documents.length === 0) ? (
                <div style={{ fontSize: 12, color: C.text.faint }}>Nothing signed under this name yet.</div>
              ) : (
                <CollapsibleGroup label="documents" count={profile.documents.length} colorPreset="purple" defaultOpen={true}>
                  {profile.documents.map((d, i) => (
                    <div key={`${d.type}-${d.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 4px", borderBottom: i < profile.documents.length - 1 ? `1px solid ${C.line}` : "none" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text.body }}>{DOC_LABEL[d.type] || d.title}</div>
                        <div style={{ fontSize: 11.5, color: C.text.faint }}>
                          {d.subtitle ? `${d.subtitle} · ` : ""}{new Date(d.createdAt).toLocaleDateString("en-CA")}
                        </div>
                      </div>
                      {d.pdf_url && <a href={d.pdf_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.orange, fontWeight: 700, textDecoration: "none", flexShrink: 0 }}>View</a>}
                    </div>
                  ))}
                </CollapsibleGroup>
              )}
            </div>

            {profile.timeclockActive && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: C.text.primary, marginBottom: 8 }}>
                  <MapPin size={14} color={C.text.muted} />Punch Locations (last 60 days)
                </div>
                <TimeClockMap
                  entries={profile.timeClockEntries || []}
                  rosterById={{ [member.id]: member }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
