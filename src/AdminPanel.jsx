import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";

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

// Design tokens
const C = {
  ink: "#1E293B",       // deep slate — authority
  inkSoft: "#475569",
  amber: "#F59E0B",     // safety accent
  amberDark: "#B45309",
  green: "#16A34A",     // active truth only
  bg: "#EEF2F6",
  line: "#E2E8F0",
  white: "#FFFFFF",
  muted: "#94A3B8",
};

export default function AdminPanel({ onViewDashboard, onLogout }) {
  const [companies, setCompanies] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("home");
  const [activeId, setActiveId] = useState(null);
  const [manageTab, setManageTab] = useState("profile");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [sortBy, setSortBy] = useState("name");

  const [newName, setNewName] = useState("");
  const [newWorkerCode, setNewWorkerCode] = useState("");
  const [newSupervisorCode, setNewSupervisorCode] = useState("");

  const [profile, setProfile] = useState({ name: "", contact_name: "", contact_email: "", contact_phone: "", address: "", logo_url: "" });
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [sopText, setSopText] = useState("");
  const [existingSops, setExistingSops] = useState([]);

  const [siteList, setSiteList] = useState([]);
  const [newSite, setNewSite] = useState("");

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

  // Completeness: 4 steps
  const steps = (c) => {
    const cnt = counts[c.id] || { sops: 0 };
    return {
      codes: !!(c.worker_code && c.supervisor_code),
      sops: cnt.sops > 0,
      logo: !!c.logo_url,
      contact: !!c.contact_email,
    };
  };
  const doneCount = (c) => Object.values(steps(c)).filter(Boolean).length;
  const isActive = (c) => doneCount(c) === 4;

  const sortCompanies = (list) => {
    const arr = [...list];
    if (sortBy === "name") arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    else arr.sort((a, b) => a.id - b.id);
    return arr;
  };

  const activeCompanies = sortCompanies(companies.filter(isActive));
  const setupCompanies = sortCompanies(companies.filter(c => !isActive(c)));

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

  const openManage = async (c) => {
    setActiveId(c.id);
    setProfile({
      name: c.name || "", contact_name: c.contact_name || "", contact_email: c.contact_email || "",
      contact_phone: c.contact_phone || "", address: c.address || "", logo_url: c.logo_url || "",
    });
    const { data: ss } = await supabase.from("sops").select("id, policy_text").eq("company_id", c.id).order("id");
    setExistingSops(ss || []);
    const { data: siteRows } = await supabase.from("sites").select("id, name").eq("company_id", c.id).order("name");
    setSiteList(siteRows || []);
    setNewSite("");
    setManageTab("profile");
    setSopText(""); setMsg("");
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
      setExistingSops(ss || []); await loadAll();
    }
    setSaving(false);
  };
  const deleteSop = async (id) => {
    await supabase.from("sops").delete().eq("id", id);
    setExistingSops(prev => prev.filter(s => s.id !== id));
    await loadAll();
  };
  const copyText = (t) => { try { navigator.clipboard?.writeText(t); setMsg("Copied " + t); setTimeout(() => setMsg(""), 1500); } catch (e) {} };

  const addSite = async () => {
    setMsg("");
    const name = newSite.trim();
    if (!name) { setMsg("Enter a site name."); return; }
    if (siteList.some(s => s.name.toLowerCase() === name.toLowerCase())) { setMsg("That site already exists."); return; }
    setSaving(true);
    const { error } = await supabase.from("sites").insert({ company_id: activeId, name });
    if (error) setMsg("Couldn't add site: " + error.message);
    else {
      setNewSite("");
      const { data } = await supabase.from("sites").select("id, name").eq("company_id", activeId).order("name");
      setSiteList(data || []);
    }
    setSaving(false);
  };
  const deleteSite = async (id) => {
    await supabase.from("sites").delete().eq("id", id);
    setSiteList(prev => prev.filter(s => s.id !== id));
  };

  // ── shared styles ────────────────────────────────────────
  const st = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: C.bg, minHeight: "100vh" },
    topbar: { background: C.ink, color: C.white, padding: "20px 22px" },
    body: { padding: "18px 16px 40px", maxWidth: 960, margin: "0 auto" },
    card: { background: C.white, borderRadius: 14, padding: 18, boxShadow: "0 1px 3px #0f172a12" },
    input: { width: "100%", padding: "11px 13px", borderRadius: 9, border: `1.5px solid ${C.line}`, fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 11, background: "#F8FAFC" },
    label: { display: "block", fontWeight: 700, fontSize: 12, color: C.inkSoft, marginBottom: 6, letterSpacing: 0.3, textTransform: "uppercase" },
    amberBtn: { background: C.amber, color: C.ink, border: "none", borderRadius: 10, padding: "12px 18px", fontWeight: 800, fontSize: 14, cursor: "pointer" },
    darkBtn: { background: C.ink, color: C.white, border: "none", borderRadius: 10, padding: "12px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer" },
    ghost: { background: "transparent", color: C.white, border: "1px solid #ffffff40", borderRadius: 9, padding: "7px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
    tab: (a) => ({ padding: "9px 16px", borderRadius: 9, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 14, background: a ? C.ink : "transparent", color: a ? C.white : C.inkSoft }),
    code: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", background: C.ink, color: C.amber, borderRadius: 8, padding: "6px 12px", fontSize: 15, cursor: "pointer", fontWeight: 600, letterSpacing: 0.5 },
    sectionTitle: { display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 13, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 12 },
  };

  // Completeness meter — the signature element
  const Meter = ({ c }) => {
    const stp = steps(c);
    const order = [["codes", "Codes"], ["sops", "SOPs"], ["logo", "Logo"], ["contact", "Contact"]];
    return (
      <div>
        <div style={{ display: "flex", gap: 3, marginBottom: 8 }}>
          {order.map(([k]) => (
            <div key={k} style={{ flex: 1, height: 5, borderRadius: 3, background: stp[k] ? C.green : C.line }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {order.map(([k, lbl]) => (
            <span key={k} style={{ fontSize: 11, fontWeight: 600, color: stp[k] ? C.green : C.muted }}>
              {stp[k] ? "●" : "○"} {lbl}
            </span>
          ))}
        </div>
      </div>
    );
  };

  const CompanyCard = ({ c }) => {
    const cnt = counts[c.id] || { flhas: 0, sops: 0 };
    const active = isActive(c);
    return (
      <div onClick={() => openManage(c)} style={{
        ...st.card, cursor: "pointer", borderLeft: `4px solid ${active ? C.green : C.amber}`,
        transition: "transform 0.1s", display: "flex", flexDirection: "column", gap: 14
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <div style={{ width: 52, height: 52, borderRadius: 11, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, border: `1px solid ${C.line}` }}>
            {c.logo_url ? <img src={c.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22 }}>🏗️</span>}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
            <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 1 }}>#{c.id} · {cnt.flhas} FLHAs · {cnt.sops} SOPs</div>
          </div>
          {active
            ? <span style={{ fontSize: 11, fontWeight: 800, color: C.green, background: "#DCFCE7", padding: "3px 9px", borderRadius: 20, flexShrink: 0 }}>ACTIVE</span>
            : <span style={{ fontSize: 11, fontWeight: 800, color: C.amberDark, background: "#FEF3C7", padding: "3px 9px", borderRadius: 20, flexShrink: 0 }}>{doneCount(c)}/4</span>}
        </div>
        <Meter c={c} />
      </div>
    );
  };

  if (loading) return <div style={{ ...st.wrap, padding: 30, color: C.inkSoft }}>Loading console…</div>;

  // ═══ HOME ═════════════════════════════════════════════════
  if (view === "home") {
    return (
      <div style={st.wrap}>
        <div style={st.topbar}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: C.amber, textTransform: "uppercase" }}>SafeField Admin</div>
              <div style={{ fontWeight: 800, fontSize: 24, marginTop: 2 }}>Company Console</div>
            </div>
            {onLogout && <button style={st.ghost} onClick={onLogout}>Sign out</button>}
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 16 }}>
            <div><span style={{ fontSize: 22, fontWeight: 800, color: C.green }}>{activeCompanies.length}</span> <span style={{ fontSize: 13, color: "#CBD5E1" }}>active</span></div>
            <div><span style={{ fontSize: 22, fontWeight: 800, color: C.amber }}>{setupCompanies.length}</span> <span style={{ fontSize: 13, color: "#CBD5E1" }}>need setup</span></div>
          </div>
        </div>

        <div style={st.body}>
          {msg && <div style={{ ...st.card, marginBottom: 14, background: "#DCFCE7", color: "#166534", fontSize: 14 }}>{msg}</div>}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 10, flexWrap: "wrap" }}>
            <button style={st.amberBtn} onClick={() => { setView("addCompany"); handleNameChange(""); setMsg(""); }}>+ Onboard Company</button>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>Sort</span>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${C.line}`, fontSize: 13, background: C.white, color: C.ink, fontWeight: 600, cursor: "pointer" }}>
                <option value="name">Name (A–Z)</option>
                <option value="id">Company ID</option>
              </select>
            </div>
          </div>

          {companies.length === 0 ? (
            <div style={{ ...st.card, textAlign: "center", padding: "44px 20px" }}>
              <div style={{ fontSize: 42, marginBottom: 10 }}>🏗️</div>
              <div style={{ fontWeight: 800, fontSize: 17, color: C.ink, marginBottom: 4 }}>No companies yet</div>
              <div style={{ fontSize: 14, color: C.inkSoft, marginBottom: 18 }}>Onboard your first company to get started.</div>
              <button style={st.amberBtn} onClick={() => { setView("addCompany"); handleNameChange(""); }}>+ Onboard Company</button>
            </div>
          ) : (
            <>
              {/* Needs setup first — it's the actionable section */}
              {setupCompanies.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ ...st.sectionTitle, color: C.amberDark }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: C.amber }} /> Needs setup ({setupCompanies.length})
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                    {setupCompanies.map(c => <CompanyCard key={c.id} c={c} />)}
                  </div>
                </div>
              )}

              {activeCompanies.length > 0 && (
                <div>
                  <div style={{ ...st.sectionTitle, color: C.green }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: C.green }} /> Active ({activeCompanies.length})
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                    {activeCompanies.map(c => <CompanyCard key={c.id} c={c} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ═══ ADD COMPANY ══════════════════════════════════════════
  if (view === "addCompany") {
    return (
      <div style={st.wrap}>
        <div style={st.topbar}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 800, fontSize: 20 }}>Onboard Company</div>
            <button style={st.ghost} onClick={() => { setView("home"); setMsg(""); }}>← Console</button>
          </div>
        </div>
        <div style={st.body}>
          {msg && <div style={{ ...st.card, marginBottom: 14, background: "#FEE2E2", color: "#991B1B", fontSize: 14 }}>{msg}</div>}
          <div style={st.card}>
            <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 16 }}>Start with the company name. Access codes generate automatically — edit them if you like. You'll add SOPs, logo and contact details next.</div>
            <label style={st.label}>Company name</label>
            <input style={st.input} placeholder="e.g. Northern Builders Ltd." value={newName} onChange={e => handleNameChange(e.target.value)} autoFocus />
            <label style={st.label}>Worker code</label>
            <input style={st.input} value={newWorkerCode} onChange={e => setNewWorkerCode(e.target.value.toUpperCase())} />
            <label style={st.label}>Supervisor code</label>
            <input style={st.input} value={newSupervisorCode} onChange={e => setNewSupervisorCode(e.target.value.toUpperCase())} />
            <button style={{ ...st.amberBtn, width: "100%", marginTop: 6 }} onClick={addCompany} disabled={saving}>{saving ? "Creating…" : "Create & continue setup"}</button>
          </div>
        </div>
      </div>
    );
  }

  // ═══ MANAGE ═══════════════════════════════════════════════
  const cnt = counts[activeId] || { flhas: 0, sops: 0 };
  const stp = activeCompany ? steps(activeCompany) : {};
  return (
    <div style={st.wrap}>
      <div style={st.topbar}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: "#ffffff18", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              {profile.logo_url ? <img src={profile.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 20 }}>🏗️</span>}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 19 }}>{activeCompany?.name}</div>
              <div style={{ fontSize: 12, color: "#CBD5E1" }}>#{activeId} · {cnt.flhas} FLHAs · {cnt.sops} SOPs</div>
            </div>
          </div>
          <button style={st.ghost} onClick={() => { setView("home"); setMsg(""); loadAll(); }}>← Console</button>
        </div>
      </div>

      <div style={st.body}>
        {msg && <div style={{ ...st.card, marginBottom: 14, background: (msg.toLowerCase().includes("couldn't") || msg.toLowerCase().includes("failed")) ? "#FEE2E2" : "#DCFCE7", color: (msg.toLowerCase().includes("couldn't") || msg.toLowerCase().includes("failed")) ? "#991B1B" : "#166534", fontSize: 14 }}>{msg}</div>}

        <div style={{ ...st.card, padding: "8px 10px", display: "flex", gap: 4, marginBottom: 14 }}>
          <button style={st.tab(manageTab === "profile")} onClick={() => { setManageTab("profile"); setMsg(""); }}>Profile</button>
          <button style={st.tab(manageTab === "sops")} onClick={() => { setManageTab("sops"); setMsg(""); }}>SOPs</button>
          <button style={st.tab(manageTab === "sites")} onClick={() => { setManageTab("sites"); setMsg(""); }}>Sites</button>
          <button style={st.tab(manageTab === "codes")} onClick={() => { setManageTab("codes"); setMsg(""); }}>Codes</button>
        </div>

        {manageTab === "profile" && (
          <div style={st.card}>
            <label style={st.label}>Company logo</label>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              <div style={{ width: 66, height: 66, borderRadius: 12, border: `1.5px solid ${C.line}`, background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                {profile.logo_url ? <img src={profile.logo_url} alt="logo" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 26, color: C.muted }}>🏗️</span>}
              </div>
              <label style={{ background: C.bg, color: C.ink, border: `1.5px solid ${C.line}`, borderRadius: 9, padding: "10px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {uploadingLogo ? "Uploading…" : "Upload logo"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => uploadLogo(e.target.files?.[0])} disabled={uploadingLogo} />
              </label>
            </div>
            <label style={st.label}>Company name</label>
            <input style={st.input} value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} />
            <label style={st.label}>Contact name</label>
            <input style={st.input} placeholder="e.g. Jane Doe" value={profile.contact_name} onChange={e => setProfile(p => ({ ...p, contact_name: e.target.value }))} />
            <label style={st.label}>Contact email</label>
            <input style={st.input} type="email" placeholder="e.g. safety@company.com" value={profile.contact_email} onChange={e => setProfile(p => ({ ...p, contact_email: e.target.value }))} />
            <label style={st.label}>Contact phone</label>
            <input style={st.input} type="tel" placeholder="e.g. (403) 555-0123" value={profile.contact_phone} onChange={e => setProfile(p => ({ ...p, contact_phone: e.target.value }))} />
            <label style={st.label}>Address</label>
            <input style={st.input} placeholder="e.g. 123 Main St, Calgary, AB" value={profile.address} onChange={e => setProfile(p => ({ ...p, address: e.target.value }))} />
            <button style={{ ...st.darkBtn, width: "100%", marginTop: 6 }} onClick={saveProfile} disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>
          </div>
        )}

        {manageTab === "sops" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={st.card}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, marginBottom: 4 }}>Add safety policies</div>
              <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 12 }}>Paste one policy per line. Each line becomes a separate SOP.</div>
              <textarea style={{ ...st.input, minHeight: 150, resize: "vertical", fontFamily: "inherit" }}
                placeholder={"All workers must conduct a FLHA before beginning any task.\nPPE is mandatory on all sites.\nFall protection required above 3 metres."}
                value={sopText} onChange={e => setSopText(e.target.value)} />
              <button style={{ ...st.darkBtn, width: "100%" }} onClick={addSops} disabled={saving}>{saving ? "Adding…" : "Add policies"}</button>
            </div>
            <div style={st.card}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, marginBottom: 10 }}>Current policies ({existingSops.length})</div>
              {existingSops.length === 0 ? (
                <div style={{ color: C.muted, padding: "14px 0", textAlign: "center" }}>No policies yet.</div>
              ) : existingSops.map((sop, i) => (
                <div key={sop.id} style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "11px 0", borderBottom: i < existingSops.length - 1 ? `1px solid ${C.line}` : "none" }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: C.ink, color: C.amber, fontSize: 11, fontWeight: 800, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</div>
                  <div style={{ flex: 1, fontSize: 14, color: "#334155", lineHeight: 1.5 }}>{sop.policy_text}</div>
                  <button onClick={() => deleteSop(sop.id)} style={{ background: "transparent", border: "none", color: "#DC2626", fontSize: 13, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {manageTab === "sites" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={st.card}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, marginBottom: 4 }}>Add a site</div>
              <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 12 }}>Saved sites appear in a dropdown for workers, so they don't have to type (or misspell) locations. Workers can still enter a one-off site, which saves here automatically.</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ ...st.input, marginBottom: 0, flex: 1 }} placeholder="e.g. Hwy 2 & 42 Ave, Red Deer" value={newSite}
                  onChange={e => setNewSite(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addSite(); }} />
                <button style={{ ...st.darkBtn, flexShrink: 0 }} onClick={addSite} disabled={saving}>Add</button>
              </div>
            </div>
            <div style={st.card}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, marginBottom: 10 }}>Saved sites ({siteList.length})</div>
              {siteList.length === 0 ? (
                <div style={{ color: C.muted, padding: "14px 0", textAlign: "center" }}>No sites yet. Add recurring locations, or let them build up from worker entries.</div>
              ) : siteList.map((site, i) => (
                <div key={site.id} style={{ display: "flex", gap: 11, alignItems: "center", padding: "11px 0", borderBottom: i < siteList.length - 1 ? `1px solid ${C.line}` : "none" }}>
                  <span style={{ fontSize: 15 }}>📍</span>
                  <div style={{ flex: 1, fontSize: 14, color: "#334155" }}>{site.name}</div>
                  <button onClick={() => deleteSite(site.id)} style={{ background: "transparent", border: "none", color: "#DC2626", fontSize: 13, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {manageTab === "codes" && (
          <div style={st.card}>
            <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, marginBottom: 4 }}>Access codes</div>
            <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 16 }}>Share these with the company. Tap to copy.</div>
            <div style={{ marginBottom: 16 }}>
              <div style={st.label}>Worker code</div>
              <span style={st.code} onClick={() => copyText(activeCompany?.worker_code)}>{activeCompany?.worker_code || "—"}</span>
            </div>
            <div>
              <div style={st.label}>Supervisor code</div>
              <span style={st.code} onClick={() => copyText(activeCompany?.supervisor_code)}>{activeCompany?.supervisor_code || "—"}</span>
            </div>
            {onViewDashboard && (
              <button style={{ ...st.darkBtn, width: "100%", marginTop: 22 }} onClick={() => onViewDashboard(activeId)}>
                Open FLHA dashboard →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
