import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";

// Generate a short random suffix like "W7K2"
function randomSuffix(len = 3) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function codePrefix(name) {
  const clean = (name || "").trim().toUpperCase();
  if (!clean) return "CO";
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3);
  return words.map(w => w[0]).join("").slice(0, 3);
}

export default function AdminPanel({ onViewDashboard, onLogout }) {
  const [companies, setCompanies] = useState([]);
  const [counts, setCounts] = useState({}); // { companyId: { flhas, sops } }
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("home"); // home | addCompany | manage
  const [activeId, setActiveId] = useState(null);
  const [manageTab, setManageTab] = useState("profile"); // profile | sops | codes
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // add company
  const [newName, setNewName] = useState("");
  const [newWorkerCode, setNewWorkerCode] = useState("");
  const [newSupervisorCode, setNewSupervisorCode] = useState("");

  // profile edit
  const [profile, setProfile] = useState({ name: "", contact_name: "", contact_email: "", contact_phone: "", address: "", logo_url: "" });
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // sops
  const [sopText, setSopText] = useState("");
  const [existingSops, setExistingSops] = useState([]);

  const loadAll = async () => {
    const [{ data: cos }, { data: fs }, { data: ss }] = await Promise.all([
      supabase.from("companies").select("id, name, worker_code, supervisor_code, contact_name, contact_email, contact_phone, address, logo_url").order("id"),
      supabase.from("flhas").select("id, company_id"),
      supabase.from("sops").select("id, company_id"),
    ]);
    setCompanies(cos || []);
    const c = {};
    (cos || []).forEach(co => { c[co.id] = { flhas: 0, sops: 0 }; });
    (fs || []).forEach(f => { if (c[f.company_id]) c[f.company_id].flhas++; });
    (ss || []).forEach(s => { if (c[s.company_id]) c[s.company_id].sops++; });
    setCounts(c);
    setLoading(false);
  };
  useEffect(() => { loadAll(); }, []);

  const activeCompany = companies.find(c => c.id === activeId);

  // ── Add company ──────────────────────────────────────────
  const handleNameChange = (val) => {
    setNewName(val);
    const p = codePrefix(val);
    setNewWorkerCode(`${p}-W${randomSuffix()}`);
    setNewSupervisorCode(`${p}-S${randomSuffix()}`);
  };
  const addCompany = async () => {
    setMsg("");
    if (!newName.trim()) { setMsg("Enter a company name."); return; }
    if (!newWorkerCode.trim() || !newSupervisorCode.trim()) { setMsg("Codes cannot be empty."); return; }
    setSaving(true);
    const { data: existing } = await supabase.from("companies").select("id")
      .or(`worker_code.eq.${newWorkerCode.trim()},supervisor_code.eq.${newSupervisorCode.trim()}`);
    if (existing && existing.length > 0) { setMsg("One of those codes is already in use. Edit and try again."); setSaving(false); return; }
    const { error } = await supabase.from("companies").insert({
      name: newName.trim(), worker_code: newWorkerCode.trim(), supervisor_code: newSupervisorCode.trim(),
    });
    if (error) { setMsg("Couldn't add company: " + error.message); }
    else { setNewName(""); setNewWorkerCode(""); setNewSupervisorCode(""); await loadAll(); setView("home"); }
    setSaving(false);
  };

  // ── Open manage view for a company ───────────────────────
  const openManage = async (c) => {
    setActiveId(c.id);
    setProfile({
      name: c.name || "", contact_name: c.contact_name || "", contact_email: c.contact_email || "",
      contact_phone: c.contact_phone || "", address: c.address || "", logo_url: c.logo_url || "",
    });
    const { data: ss } = await supabase.from("sops").select("id, policy_text").eq("company_id", c.id).order("id");
    setExistingSops(ss || []);
    setManageTab("profile");
    setSopText("");
    setMsg("");
    setView("manage");
  };

  const saveProfile = async () => {
    setMsg("");
    if (!profile.name.trim()) { setMsg("Company name cannot be empty."); return; }
    setSaving(true);
    const { error } = await supabase.from("companies").update({
      name: profile.name.trim(), contact_name: profile.contact_name.trim(),
      contact_email: profile.contact_email.trim(), contact_phone: profile.contact_phone.trim(),
      address: profile.address.trim(), logo_url: profile.logo_url || null,
    }).eq("id", activeId);
    if (error) setMsg("Couldn't save: " + error.message);
    else { setMsg("Profile saved"); await loadAll(); }
    setSaving(false);
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    setUploadingLogo(true); setMsg("");
    const ext = file.name.split(".").pop();
    const filename = `logo_${activeId}_${Date.now()}.${ext}`.replace(/[^a-zA-Z0-9_.\-]/g, "");
    const { error } = await supabase.storage.from("company-logos").upload(filename, file, { contentType: file.type, upsert: true });
    if (error) { setMsg("Logo upload failed: " + error.message); setUploadingLogo(false); return; }
    const { data } = supabase.storage.from("company-logos").getPublicUrl(filename);
    setProfile(p => ({ ...p, logo_url: data?.publicUrl || "" }));
    setUploadingLogo(false);
    setMsg("Logo uploaded — tap Save profile to keep it");
  };

  const addSops = async () => {
    setMsg("");
    const lines = sopText.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) { setMsg("Enter at least one policy, one per line."); return; }
    setSaving(true);
    const rows = lines.map(policy_text => ({ company_id: activeId, policy_text }));
    const { error } = await supabase.from("sops").insert(rows);
    if (error) setMsg("Couldn't add policies: " + error.message);
    else {
      setMsg(`Added ${lines.length} ${lines.length > 1 ? "policies" : "policy"}`);
      setSopText("");
      const { data: ss } = await supabase.from("sops").select("id, policy_text").eq("company_id", activeId).order("id");
      setExistingSops(ss || []);
      await loadAll();
    }
    setSaving(false);
  };

  const deleteSop = async (id) => {
    await supabase.from("sops").delete().eq("id", id);
    setExistingSops(prev => prev.filter(s => s.id !== id));
    await loadAll();
  };

  const copyText = (t) => { try { navigator.clipboard?.writeText(t); setMsg("Copied " + t); setTimeout(() => setMsg(""), 1500); } catch (e) {} };

  // ── Styles ───────────────────────────────────────────────
  const s = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#F0F4F8", minHeight: "100vh" },
    header: { background: "linear-gradient(135deg,#4C1D95,#7C3AED)", padding: "18px 20px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" },
    body: { padding: 16, maxWidth: 900, margin: "0 auto" },
    card: { background: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 4px #0001" },
    input: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #E5E7EB", fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 10 },
    label: { display: "block", fontWeight: 600, fontSize: 13, color: "#374151", marginBottom: 6 },
    btn: (bg, fg = "#fff") => ({ background: bg, color: fg, border: "none", borderRadius: 9, padding: "11px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer" }),
    ghostBtn: { background: "#F3F4F6", color: "#374151", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
    tab: (active) => ({ padding: "8px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14, background: active ? "#7C3AED" : "transparent", color: active ? "#fff" : "#6B7280" }),
    codePill: { fontFamily: "monospace", background: "#F3F4F6", borderRadius: 6, padding: "4px 10px", fontSize: 14, cursor: "pointer", border: "1px solid #E5E7EB" },
    check: (done) => ({ fontSize: 12, fontWeight: 600, color: done ? "#166534" : "#9CA3AF" }),
  };

  const statusBadge = (done, label) => (
    <span style={s.check(done)}>{done ? "✓" : "○"} {label}</span>
  );

  if (loading) return <div style={{ ...s.wrap, padding: 24, color: "#6B7280" }}>Loading…</div>;

  // ═══ HOME: company grid ═══════════════════════════════════
  if (view === "home") {
    return (
      <div style={s.wrap}>
        <div style={s.header}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>🔑 Admin — Company Onboarding</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{companies.length} {companies.length === 1 ? "company" : "companies"}</div>
          </div>
          <button style={{ ...s.btn("#ffffff", "#4C1D95") }} onClick={() => { setView("addCompany"); handleNameChange(""); setMsg(""); }}>+ Add Company</button>
        </div>

        <div style={s.body}>
          {onLogout && <div style={{ textAlign: "right", marginBottom: 8 }}><button style={{ background: "transparent", border: "none", color: "#7C3AED", fontSize: 13, fontWeight: 600, cursor: "pointer" }} onClick={onLogout}>Exit admin</button></div>}
          {msg && <div style={{ ...s.card, background: "#F0FDF4", border: "1px solid #86EFAC", color: "#166534", fontSize: 14 }}>{msg}</div>}

          {companies.length === 0 ? (
            <div style={{ ...s.card, textAlign: "center", padding: "40px 20px", color: "#6B7280" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🏢</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#1E3A5F", marginBottom: 4 }}>No companies yet</div>
              <div style={{ fontSize: 14, marginBottom: 16 }}>Add your first company to start onboarding.</div>
              <button style={s.btn("#7C3AED")} onClick={() => { setView("addCompany"); handleNameChange(""); }}>+ Add Company</button>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
              {companies.map(c => {
                const cnt = counts[c.id] || { flhas: 0, sops: 0 };
                return (
                  <div key={c.id} onClick={() => openManage(c)} style={{ ...s.card, marginBottom: 0, cursor: "pointer", border: "1.5px solid #F0F0F5" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                      <div style={{ width: 48, height: 48, borderRadius: 10, background: "#F5F3FF", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                        {c.logo_url ? <img src={c.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22 }}>🏢</span>}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 16, color: "#1E3A5F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                        <div style={{ fontSize: 12, color: "#6B7280" }}>{cnt.flhas} FLHAs · {cnt.sops} SOPs</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", paddingTop: 10, borderTop: "1px solid #F3F4F6" }}>
                      {statusBadge(!!(c.worker_code && c.supervisor_code), "Codes")}
                      {statusBadge(cnt.sops > 0, "SOPs")}
                      {statusBadge(!!c.logo_url, "Logo")}
                      {statusBadge(!!c.contact_email, "Contact")}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══ ADD COMPANY ══════════════════════════════════════════
  if (view === "addCompany") {
    return (
      <div style={s.wrap}>
        <div style={s.header}>
          <div style={{ fontWeight: 800, fontSize: 19 }}>+ Add Company</div>
          <button style={s.ghostBtn} onClick={() => { setView("home"); setMsg(""); }}>← Back</button>
        </div>
        <div style={s.body}>
          {msg && <div style={{ ...s.card, background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#991B1B", fontSize: 14 }}>{msg}</div>}
          <div style={s.card}>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 14 }}>Enter the company name — access codes are generated automatically and you can edit them.</div>
            <label style={s.label}>Company name</label>
            <input style={s.input} placeholder="e.g. Northern Builders Ltd." value={newName} onChange={e => handleNameChange(e.target.value)} autoFocus />
            <label style={s.label}>Worker code</label>
            <input style={s.input} value={newWorkerCode} onChange={e => setNewWorkerCode(e.target.value.toUpperCase())} />
            <label style={s.label}>Supervisor code</label>
            <input style={s.input} value={newSupervisorCode} onChange={e => setNewSupervisorCode(e.target.value.toUpperCase())} />
            <button style={{ ...s.btn("#7C3AED"), width: "100%", marginTop: 6 }} onClick={addCompany} disabled={saving}>
              {saving ? "Adding…" : "Create company"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══ MANAGE ONE COMPANY ═══════════════════════════════════
  const cnt = counts[activeId] || { flhas: 0, sops: 0 };
  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: "#ffffff20", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {profile.logo_url ? <img src={profile.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 20 }}>🏢</span>}
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{activeCompany?.name}</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{cnt.flhas} FLHAs · {cnt.sops} SOPs</div>
          </div>
        </div>
        <button style={s.ghostBtn} onClick={() => { setView("home"); setMsg(""); loadAll(); }}>← All companies</button>
      </div>

      <div style={s.body}>
        {msg && <div style={{ ...s.card, background: msg.toLowerCase().includes("couldn't") || msg.toLowerCase().includes("failed") ? "#FEF2F2" : "#F0FDF4", border: `1px solid ${msg.toLowerCase().includes("couldn't") || msg.toLowerCase().includes("failed") ? "#FCA5A5" : "#86EFAC"}`, color: msg.toLowerCase().includes("couldn't") || msg.toLowerCase().includes("failed") ? "#991B1B" : "#166534", fontSize: 14 }}>{msg}</div>}

        <div style={{ ...s.card, padding: "8px 10px", display: "flex", gap: 4 }}>
          <button style={s.tab(manageTab === "profile")} onClick={() => { setManageTab("profile"); setMsg(""); }}>🏢 Profile</button>
          <button style={s.tab(manageTab === "sops")} onClick={() => { setManageTab("sops"); setMsg(""); }}>📄 SOPs</button>
          <button style={s.tab(manageTab === "codes")} onClick={() => { setManageTab("codes"); setMsg(""); }}>🔑 Codes</button>
        </div>

        {/* PROFILE */}
        {manageTab === "profile" && (
          <div style={s.card}>
            <label style={s.label}>Company logo</label>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
              <div style={{ width: 64, height: 64, borderRadius: 10, border: "1.5px solid #E5E7EB", background: "#F9FAFB", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                {profile.logo_url ? <img src={profile.logo_url} alt="logo" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 24, color: "#9CA3AF" }}>🏢</span>}
              </div>
              <label style={{ background: "#F5F3FF", color: "#7C3AED", border: "1px solid #DDD6FE", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                {uploadingLogo ? "Uploading…" : "Upload logo"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => uploadLogo(e.target.files?.[0])} disabled={uploadingLogo} />
              </label>
            </div>
            <label style={s.label}>Company name</label>
            <input style={s.input} value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} />
            <label style={s.label}>Contact name</label>
            <input style={s.input} placeholder="e.g. Jane Doe" value={profile.contact_name} onChange={e => setProfile(p => ({ ...p, contact_name: e.target.value }))} />
            <label style={s.label}>Contact email</label>
            <input style={s.input} type="email" placeholder="e.g. safety@company.com" value={profile.contact_email} onChange={e => setProfile(p => ({ ...p, contact_email: e.target.value }))} />
            <label style={s.label}>Contact phone</label>
            <input style={s.input} type="tel" placeholder="e.g. (403) 555-0123" value={profile.contact_phone} onChange={e => setProfile(p => ({ ...p, contact_phone: e.target.value }))} />
            <label style={s.label}>Address</label>
            <input style={s.input} placeholder="e.g. 123 Main St, Calgary, AB" value={profile.address} onChange={e => setProfile(p => ({ ...p, address: e.target.value }))} />
            <button style={{ ...s.btn("#7C3AED"), width: "100%", marginTop: 6 }} onClick={saveProfile} disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>
          </div>
        )}

        {/* SOPS */}
        {manageTab === "sops" && (
          <>
            <div style={s.card}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 4 }}>Add safety policies</div>
              <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 12 }}>Paste one policy per line. Each line becomes a separate SOP.</div>
              <textarea style={{ ...s.input, minHeight: 160, resize: "vertical", fontFamily: "inherit" }}
                placeholder={"All workers must conduct a FLHA before beginning any task.\nPPE is mandatory on all sites.\nFall protection required above 3 metres."}
                value={sopText} onChange={e => setSopText(e.target.value)} />
              <button style={{ ...s.btn("#7C3AED"), width: "100%" }} onClick={addSops} disabled={saving}>{saving ? "Adding…" : "Add policies"}</button>
            </div>
            <div style={s.card}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 10 }}>Current policies ({existingSops.length})</div>
              {existingSops.length === 0 ? (
                <div style={{ color: "#9CA3AF", padding: "12px 0", textAlign: "center" }}>No policies yet.</div>
              ) : existingSops.map((sop, i) => (
                <div key={sop.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderBottom: i < existingSops.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#7C3AED", color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</div>
                  <div style={{ flex: 1, fontSize: 14, color: "#374151", lineHeight: 1.5 }}>{sop.policy_text}</div>
                  <button onClick={() => deleteSop(sop.id)} style={{ background: "transparent", border: "none", color: "#DC2626", fontSize: 13, cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>Remove</button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* CODES */}
        {manageTab === "codes" && (
          <div style={s.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 4 }}>Access codes</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 14 }}>Share these with the company. Tap a code to copy it.</div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>WORKER CODE</div>
              <span style={s.codePill} onClick={() => copyText(activeCompany?.worker_code)}>{activeCompany?.worker_code || "—"}</span>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>SUPERVISOR CODE</div>
              <span style={s.codePill} onClick={() => copyText(activeCompany?.supervisor_code)}>{activeCompany?.supervisor_code || "—"}</span>
            </div>
            {onViewDashboard && (
              <button style={{ ...s.btn("#1E3A5F"), width: "100%", marginTop: 20 }} onClick={() => onViewDashboard(activeId)}>
                View this company's FLHA dashboard →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
