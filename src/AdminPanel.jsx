import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import MonthlyInspectionBuilder from "./MonthlyInspectionBuilder.jsx";
import CustomFormBuilder from "./CustomFormBuilder.jsx";

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

export default function AdminPanel({ onViewDashboard, onLogout, token }) {
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

  const [equipList, setEquipList] = useState([]);
  const [fieldList, setFieldList] = useState([]);
  const [newField, setNewField] = useState({ doc_type: "flha", label: "", field_type: "text", options: "", required: false });
  const [newEquip, setNewEquip] = useState({ year: "", make: "", model: "", type: "", unit_number: "" });

  // ── document active/deactivated toggles ────────────────────
  const [docSettings, setDocSettings] = useState([]);
  const [loadingDocSettings, setLoadingDocSettings] = useState(false);

  const loadDocSettings = async (companyId) => {
    setLoadingDocSettings(true);
    try {
      const res = await fetch("/api/customforms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_document_settings", token, companyId }),
      });
      const data = await res.json();
      if (res.ok) setDocSettings(data.documents || []);
    } catch (e) { /* leave list as-is */ }
    setLoadingDocSettings(false);
  };

  const toggleDocSetting = async (doc) => {
    const nextActive = !doc.isActive;
    setDocSettings(prev => prev.map(d => d.key === doc.key ? { ...d, isActive: nextActive } : d));
    try {
      await fetch("/api/customforms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_document_setting", token, companyId: activeId, documentKey: doc.key, isActive: nextActive }),
      });
    } catch (e) { /* leave optimistic state if the request fails */ }
  };

  // ── analytics dashboard tier (basic/advanced) ───────────────
  const [analyticsTier, setAnalyticsTierState] = useState("basic");

  const setAnalyticsTier = async (tier) => {
    const prev = analyticsTier;
    setAnalyticsTierState(tier);
    try {
      const res = await fetch("/api/admin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_analytics_tier", token, companyId: activeId, tier }),
      });
      if (!res.ok) setAnalyticsTierState(prev);
    } catch (e) {
      setAnalyticsTierState(prev);
    }
  };

  // Companies now come from our protected server endpoint (it has the real
  // worker/supervisor codes and contact info, so it needs to be admin-only).
  const loadAll = async () => {
    let cos = [];
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_companies", token }),
      });
      const data = await res.json();
      if (res.ok) cos = data.companies || [];
      else setMsg(data.error || "Could not load companies.");
    } catch (e) {
      setMsg("Could not load companies.");
    }

    // SOP counts (for the completeness meter) now come from the protected
    // /api/companydata endpoint instead of a direct table read.
    let sopCounts = {};
    try {
      const res = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_sops_counts", token }),
      });
      const data = await res.json();
      if (res.ok) sopCounts = data.counts || {};
    } catch (e) { /* leave counts empty if the request fails */ }

    // FLHA counts still come from the protected /api/flhas endpoint.
    let flhaCounts = {};
    try {
      const res = await fetch("/api/flhas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "count", token }),
      });
      const data = await res.json();
      if (res.ok) flhaCounts = data.counts || {};
    } catch (e) { /* leave counts empty if the request fails */ }

    setCompanies(cos);
    const c = {};
    cos.forEach(co => { c[co.id] = { flhas: flhaCounts[co.id] || 0, sops: sopCounts[co.id] || 0 }; });
    setCounts(c);
    setLoading(false);
  };
  useEffect(() => { loadAll(); }, [token]);

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
    else arr.sort((a, b) => (a.account_number || a.id) - (b.account_number || b.id));
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

  // Company creation now goes through our protected server endpoint.
  const addCompany = async () => {
    setMsg("");
    if (!newName.trim()) { setMsg("Enter a company name."); return; }
    if (!newWorkerCode.trim() || !newSupervisorCode.trim()) { setMsg("Codes cannot be empty."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_company", token, name: newName, workerCode: newWorkerCode, supervisorCode: newSupervisorCode }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Couldn't add company."); setSaving(false); return; }
      setNewName(""); setNewWorkerCode(""); setNewSupervisorCode(""); await loadAll(); setView("home");
    } catch (e) {
      setMsg("Couldn't add company. Try again.");
    }
    setSaving(false);
  };

  const openManage = async (c) => {
    setActiveId(c.id);
    setProfile({
      name: c.name || "", contact_name: c.contact_name || "", contact_email: c.contact_email || "",
      contact_phone: c.contact_phone || "", address: c.address || "", logo_url: c.logo_url || "",
    });
    setAnalyticsTierState(c.analytics_tier || "basic");

    try {
      const res = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_sops", token, companyId: c.id }),
      });
      const data = await res.json();
      setExistingSops(res.ok ? (data.sops || []) : []);
    } catch (e) { setExistingSops([]); }

    try {
      const res = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_sites", token, companyId: c.id }),
      });
      const data = await res.json();
      setSiteList(res.ok ? (data.sites || []) : []);
    } catch (e) { setSiteList([]); }
    setNewSite("");

    try {
      const res = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_equipment", token, companyId: c.id }),
      });
      const data = await res.json();
      if (res.ok) setEquipList(data.equipment || []);
      else { setMsg("Equipment read error: " + data.error); setEquipList([]); }
    } catch (e) { setMsg("Equipment read error: " + e.message); setEquipList([]); }
    setNewEquip({ year: "", make: "", model: "", type: "", unit_number: "" });

    try {
      const res = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_custom_fields", token, companyId: c.id }),
      });
      const data = await res.json();
      setFieldList(res.ok ? (data.fields || []) : []);
    } catch (e) { setFieldList([]); }
    setNewField({ doc_type: "flha", label: "", field_type: "text", options: "", required: false });

    setManageTab("profile");
    setSopText(""); setMsg("");
    setView("manage");
  };

  // Profile edits now go through our protected server endpoint.
  const saveProfile = async () => {
    setMsg("");
    if (!profile.name.trim()) { setMsg("Company name cannot be empty."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_profile", token, companyId: activeId, profile }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Couldn't save."); setSaving(false); return; }
      setMsg("Profile saved"); await loadAll();
    } catch (e) {
      setMsg("Couldn't save. Try again.");
    }
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
    try {
      const res = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_sops", token, companyId: activeId, policies: lines }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg("Couldn't add policies: " + data.error); setSaving(false); return; }
      setMsg(`Added ${lines.length} ${lines.length > 1 ? "policies" : "policy"}`);
      setSopText("");
      const listRes = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_sops", token, companyId: activeId }),
      });
      const listData = await listRes.json();
      setExistingSops(listRes.ok ? (listData.sops || []) : []);
      await loadAll();
    } catch (e) {
      setMsg("Couldn't add policies. Try again.");
    }
    setSaving(false);
  };

  // ── SOP condenser: long document → short policy lines ────
  const [rawSop, setRawSop] = useState("");
  const [condensing, setCondensing] = useState(false);
  const [condenseError, setCondenseError] = useState("");

  const condenseSop = async () => {
    setCondenseError(""); setMsg("");
    if (!rawSop.trim()) { setCondenseError("Paste a document first."); return; }
    setCondensing(true);
    const prompt = `You are a construction safety officer converting a long, formal SOP or safety policy document into a set of short, specific, actionable safety rules for a field hazard-assessment system.

The system uses these rules by matching them to a worker's described task, so each rule must be SELF-CONTAINED and SPECIFIC — a worker or an AI should be able to tell at a glance whether it applies to a given task.

Document to convert:
"""
${rawSop.slice(0, 12000)}
"""

INSTRUCTIONS:
- Extract the actual safety requirements. Ignore boilerplate, headers, revision history, tables of contents, definitions, and legal preamble.
- Write each rule as ONE line — a clear, direct requirement. Start with the condition or activity where possible (e.g. "Trenches deeper than 1.2m require a trench box, sloping, or benching before entry.").
- Be specific and keep concrete details that matter: depths, distances, voltages, weights, durations, PPE types.
- Do NOT invent requirements that aren't in the document.
- Do NOT number the lines or add bullets — one plain rule per line.
- Aim for 5-25 rules depending on the document's length and content.

Respond ONLY with valid JSON (no markdown, no backticks):
{ "policies": ["rule one", "rule two"] }`;

    try {
      const res = await fetch("/api/generate-flha", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const text = data.content?.map(b => b.text || "").join("") || "";
      const a = text.indexOf("{"), b = text.lastIndexOf("}");
      if (a === -1 || b === -1) throw new Error("bad response");
      const parsed = JSON.parse(text.slice(a, b + 1));
      const lines = (parsed.policies || []).filter(Boolean);
      if (lines.length === 0) throw new Error("no policies found");
      // Drop the condensed rules into the existing SOP box for review before saving
      setSopText(prev => (prev.trim() ? prev.trim() + "\n" : "") + lines.join("\n"));
      setRawSop("");
      setMsg(`Condensed into ${lines.length} ${lines.length > 1 ? "policies" : "policy"} — review below, then Add.`);
    } catch (e) {
      setCondenseError("Couldn't condense that document. Try a shorter section, or check your connection.");
    }
    setCondensing(false);
  };

  const deleteSop = async (id) => {
    try {
      await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_sop", token, id }),
      });
    } catch (e) { /* leave list as-is if the request fails */ }
    setExistingSops(prev => prev.filter(s => s.id !== id));
    await loadAll();
  };
  const copyText = (t) => { try { navigator.clipboard?.writeText(t); setMsg("Copied " + t); setTimeout(() => setMsg(""), 1500); } catch (e) {} };

  // Suspend/reactivate now goes through our protected server endpoint.
  const toggleSuspend = async (c, e) => {
    if (e) e.stopPropagation(); // don't open the card
    const next = !c.suspended;
    if (next && !window.confirm(`Suspend "${c.name}"? Workers will be blocked from creating FLHAs. Supervisors can still view and export existing records.`)) return;
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_suspend", token, companyId: c.id, suspended: next }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Couldn't update."); return; }
    } catch (e2) {
      setMsg("Couldn't update. Try again.");
      return;
    }
    await loadAll();
    setMsg(next ? `${c.name} suspended` : `${c.name} reactivated`);
    setTimeout(() => setMsg(""), 2500);
  };

  const addSite = async () => {
    setMsg("");
    const name = newSite.trim();
    if (!name) { setMsg("Enter a site name."); return; }
    if (siteList.some(s => s.name.toLowerCase() === name.toLowerCase())) { setMsg("That site already exists."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_site", token, companyId: activeId, name }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg("Couldn't add site: " + data.error); setSaving(false); return; }
      setNewSite("");
      const listRes = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_sites", token, companyId: activeId }),
      });
      const listData = await listRes.json();
      setSiteList(listRes.ok ? (listData.sites || []) : []);
    } catch (e) {
      setMsg("Couldn't add site. Try again.");
    }
    setSaving(false);
  };
  const deleteSite = async (id) => {
    try {
      await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_site", token, id }),
      });
    } catch (e) { /* leave list as-is if the request fails */ }
    setSiteList(prev => prev.filter(s => s.id !== id));
  };

  const addEquip = async () => {
    setMsg("");
    const { make, model, type } = newEquip;
    if (!make.trim() && !model.trim() && !type.trim()) { setMsg("Enter at least a make, model or type."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_equipment", token, companyId: activeId,
          year: newEquip.year, make: newEquip.make, model: newEquip.model, type: newEquip.type, unitNumber: newEquip.unit_number,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg("Couldn't add equipment: " + data.error); setSaving(false); return; }
      setNewEquip({ year: "", make: "", model: "", type: "", unit_number: "" });
      const listRes = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_equipment", token, companyId: activeId }),
      });
      const listData = await listRes.json();
      if (listRes.ok) setEquipList(listData.equipment || []);
      else setMsg("Equipment read error: " + listData.error);
    } catch (e) {
      setMsg("Couldn't add equipment. Try again.");
    }
    setSaving(false);
  };
  const deleteEquip = async (id) => {
    try {
      await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_equipment", token, id }),
      });
    } catch (e) { /* leave list as-is if the request fails */ }
    setEquipList(prev => prev.filter(e => e.id !== id));
  };

  const addField = async () => {
    setMsg("");
    if (!newField.label.trim()) { setMsg("Give the field a label."); return; }
    if (newField.field_type === "dropdown" && !newField.options.trim()) { setMsg("Add dropdown options, separated by commas."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_custom_field", token, companyId: activeId,
          docType: newField.doc_type, label: newField.label, fieldType: newField.field_type,
          options: newField.options, required: newField.required,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg("Couldn't add field: " + data.error); setSaving(false); return; }
      setNewField({ doc_type: newField.doc_type, label: "", field_type: "text", options: "", required: false });
      const listRes = await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_custom_fields", token, companyId: activeId }),
      });
      const listData = await listRes.json();
      setFieldList(listRes.ok ? (listData.fields || []) : []);
      setMsg("Field added");
    } catch (e) {
      setMsg("Couldn't add field. Try again.");
    }
    setSaving(false);
  };
  const deleteField = async (id) => {
    try {
      await fetch("/api/companydata", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_custom_field", token, id }),
      });
    } catch (e) { /* leave list as-is if the request fails */ }
    setFieldList(prev => prev.filter(f => f.id !== id));
  };

  // Company deletion now goes through our protected server endpoint, which
  // checks ALL record types (not just FLHAs) before allowing the delete.
  const deleteCompany = async () => {
    if (!window.confirm(`Delete "${activeCompany?.name}"? This removes the company, its SOPs and sites. This cannot be undone.`)) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_company", token, companyId: activeId }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Couldn't delete."); setSaving(false); return; }
      await loadAll();
      setSaving(false);
      setView("home");
    } catch (e) {
      setMsg("Couldn't delete. Try again.");
      setSaving(false);
    }
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
        ...st.card, cursor: "pointer",
        borderLeft: `4px solid ${c.suspended ? "#DC2626" : active ? C.green : C.amber}`,
        opacity: c.suspended ? 0.85 : 1,
        transition: "transform 0.1s", display: "flex", flexDirection: "column", gap: 14
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <div style={{ width: 52, height: 52, borderRadius: 11, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, border: `1px solid ${C.line}` }}>
            {c.logo_url ? <img src={c.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22 }}>🏗️</span>}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
            <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 1 }}>#{c.account_number || c.id} · {cnt.flhas} FLHAs · {cnt.sops} SOPs</div>
          </div>
          {c.suspended
            ? <span style={{ fontSize: 11, fontWeight: 800, color: "#DC2626", background: "#FEE2E2", padding: "3px 9px", borderRadius: 20, flexShrink: 0 }}>SUSPENDED</span>
            : active
              ? <span style={{ fontSize: 11, fontWeight: 800, color: C.green, background: "#DCFCE7", padding: "3px 9px", borderRadius: 20, flexShrink: 0 }}>ACTIVE</span>
              : <span style={{ fontSize: 11, fontWeight: 800, color: C.amberDark, background: "#FEF3C7", padding: "3px 9px", borderRadius: 20, flexShrink: 0 }}>{doneCount(c)}/4</span>}
        </div>
        <Meter c={c} />
        <button
          onClick={(e) => toggleSuspend(c, e)}
          style={{
            width: "100%", borderRadius: 8, padding: "8px", fontSize: 13, fontWeight: 700, cursor: "pointer",
            border: c.suspended ? "none" : `1.5px solid ${C.line}`,
            background: c.suspended ? C.green : "#F8FAFC",
            color: c.suspended ? "#fff" : C.inkSoft
          }}>
          {c.suspended ? "Reactivate access" : "Suspend access"}
        </button>
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
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: C.amber, textTransform: "uppercase" }}>FORA Admin</div>
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
                <option value="id">Account number</option>
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

  // ═══ MANAGE — CUSTOM DOCUMENTS (full-screen builder) ═════════
  if (view === "manage" && manageTab === "custom") {
    return (
      <CustomFormBuilder
        companyId={activeId}
        companyName={activeCompany?.name}
        onBack={() => setManageTab("profile")}
        token={token}
      />
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
              <div style={{ fontSize: 12, color: "#CBD5E1" }}>#{activeCompany?.account_number || activeId} · {cnt.flhas} FLHAs · {cnt.sops} SOPs</div>
            </div>
          </div>
          <button style={st.ghost} onClick={() => { setView("home"); setMsg(""); loadAll(); }}>← Console</button>
        </div>
      </div>

      <div style={st.body}>
        {msg && <div style={{ ...st.card, marginBottom: 14, background: (msg.toLowerCase().includes("couldn't") || msg.toLowerCase().includes("failed")) ? "#FEE2E2" : "#DCFCE7", color: (msg.toLowerCase().includes("couldn't") || msg.toLowerCase().includes("failed")) ? "#991B1B" : "#166534", fontSize: 14 }}>{msg}</div>}

        <div style={{ ...st.card, padding: "8px 10px", display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
          <button style={st.tab(manageTab === "profile")} onClick={() => { setManageTab("profile"); setMsg(""); }}>Profile</button>
          <button style={st.tab(manageTab === "sops")} onClick={() => { setManageTab("sops"); setMsg(""); }}>SOPs</button>
          <button style={st.tab(manageTab === "sites")} onClick={() => { setManageTab("sites"); setMsg(""); }}>Sites</button>
          <button style={st.tab(manageTab === "equipment")} onClick={() => { setManageTab("equipment"); setMsg(""); }}>Equipment</button>
          <button style={st.tab(manageTab === "fields")} onClick={() => { setManageTab("fields"); setMsg(""); }}>Fields</button>
          <button style={st.tab(manageTab === "monthly")} onClick={() => { setManageTab("monthly"); setMsg(""); }}>Monthly</button>
          <button style={st.tab(manageTab === "custom")} onClick={() => { setManageTab("custom"); setMsg(""); }}>Custom</button>
          <button style={st.tab(manageTab === "forms")} onClick={() => { setManageTab("forms"); setMsg(""); loadDocSettings(activeId); }}>Forms</button>
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
            <div style={{ ...st.card, borderLeft: `4px solid ${C.amber}` }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, marginBottom: 4 }}>✨ Condense a long SOP document</div>
              <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 12 }}>Paste a full safety policy or SOP document — even many pages. The AI pulls out the actual requirements and turns them into short, specific rules the FLHA system can use. Review them below before adding.</div>
              <textarea style={{ ...st.input, minHeight: 130, resize: "vertical", fontFamily: "inherit" }}
                placeholder="Paste the full SOP document text here…"
                value={rawSop} onChange={e => setRawSop(e.target.value)} />
              {condenseError && <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8, padding: "9px 12px", marginBottom: 10, fontSize: 13, color: "#991B1B" }}>{condenseError}</div>}
              <button style={{ background: condensing ? "#94A3B8" : C.amber, color: "#1E293B", border: "none", borderRadius: 9, padding: "12px", fontWeight: 800, fontSize: 14, cursor: "pointer", width: "100%" }} onClick={condenseSop} disabled={condensing}>
                {condensing ? "⏳ Condensing…" : "✨ Condense into policies"}
              </button>
            </div>

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

        {manageTab === "equipment" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={st.card}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, marginBottom: 4 }}>Add equipment</div>
              <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 12 }}>Register machines so workers can pick them from a fleet list. Inspections are generated specific to each machine.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input style={{ ...st.input, marginBottom: 0 }} placeholder="Year (e.g. 2019)" value={newEquip.year} onChange={e => setNewEquip(p => ({ ...p, year: e.target.value }))} />
                <input style={{ ...st.input, marginBottom: 0 }} placeholder="Make (e.g. Caterpillar)" value={newEquip.make} onChange={e => setNewEquip(p => ({ ...p, make: e.target.value }))} />
                <input style={{ ...st.input, marginBottom: 0 }} placeholder="Model (e.g. 320)" value={newEquip.model} onChange={e => setNewEquip(p => ({ ...p, model: e.target.value }))} />
                <input style={{ ...st.input, marginBottom: 0 }} placeholder="Type (e.g. Excavator)" value={newEquip.type} onChange={e => setNewEquip(p => ({ ...p, type: e.target.value }))} />
                <input style={{ ...st.input, marginBottom: 0, gridColumn: "1 / -1" }} placeholder="Unit / asset number (optional)" value={newEquip.unit_number} onChange={e => setNewEquip(p => ({ ...p, unit_number: e.target.value }))} />
              </div>
              <button style={{ ...st.darkBtn, width: "100%", marginTop: 12 }} onClick={addEquip} disabled={saving}>{saving ? "Adding…" : "Add to fleet"}</button>
            </div>
            <div style={st.card}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, marginBottom: 10 }}>Fleet ({equipList.length})</div>
              {equipList.length === 0 ? (
                <div style={{ color: C.muted, padding: "14px 0", textAlign: "center" }}>No equipment yet.</div>
              ) : equipList.map((eq, i) => (
                <div key={eq.id} style={{ display: "flex", gap: 11, alignItems: "center", padding: "11px 0", borderBottom: i < equipList.length - 1 ? `1px solid ${C.line}` : "none" }}>
                  <span style={{ fontSize: 18 }}>🚜</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#334155" }}>{[eq.year, eq.make, eq.model, eq.type].filter(Boolean).join(" ")}</div>
                    {eq.unit_number && <div style={{ fontSize: 12, color: C.muted }}>Unit {eq.unit_number}</div>}
                  </div>
                  <button onClick={() => deleteEquip(eq.id)} style={{ background: "transparent", border: "none", color: "#DC2626", fontSize: 13, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {manageTab === "fields" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={st.card}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, marginBottom: 4 }}>Add a custom field</div>
              <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 12 }}>If this company's paper forms track something extra — a permit number, crew size, client contact — add it here. Workers will fill it in, and it appears on the PDF.</div>

              <label style={st.label}>Which document?</label>
              <select style={st.input} value={newField.doc_type} onChange={e => setNewField(p => ({ ...p, doc_type: e.target.value }))}>
                <option value="flha">FLHA</option>
                <option value="inspection">Equipment Inspection</option>
                <option value="toolbox">Toolbox Talk</option>
                <option value="nearmiss">Near Miss Report</option>
                <option value="incident">Incident Report</option>
                <option value="daily">Daily Report</option>
              </select>

              <label style={st.label}>Field label</label>
              <input style={st.input} placeholder="e.g. Permit Number" value={newField.label} onChange={e => setNewField(p => ({ ...p, label: e.target.value }))} />

              <label style={st.label}>Field type</label>
              <div style={{ display: "flex", gap: 6, marginBottom: 11 }}>
                {[{ k: "text", l: "Text box" }, { k: "dropdown", l: "Dropdown" }].map(t => (
                  <button key={t.k} onClick={() => setNewField(p => ({ ...p, field_type: t.k }))} style={{ flex: 1, padding: "10px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", border: `1.5px solid ${newField.field_type === t.k ? C.ink : C.line}`, background: newField.field_type === t.k ? C.ink : "#fff", color: newField.field_type === t.k ? "#fff" : C.muted }}>{t.l}</button>
                ))}
              </div>

              {newField.field_type === "dropdown" && (
                <>
                  <label style={st.label}>Dropdown options (comma separated)</label>
                  <input style={st.input} placeholder="e.g. Day shift, Night shift, Weekend" value={newField.options} onChange={e => setNewField(p => ({ ...p, options: e.target.value }))} />
                </>
              )}

              <div onClick={() => setNewField(p => ({ ...p, required: !p.required }))} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: newField.required ? "#FFFBEB" : "#F8FAFC", border: `1.5px solid ${newField.required ? C.amber : C.line}`, borderRadius: 9, marginBottom: 12, cursor: "pointer" }}>
                <div style={{ width: 20, height: 20, borderRadius: 5, background: newField.required ? C.amber : "#fff", border: `1.5px solid ${newField.required ? C.amber : "#CBD5E1"}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#1E293B", fontSize: 13, fontWeight: 800 }}>{newField.required ? "✓" : ""}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Required — worker must fill this in</div>
              </div>

              <button style={{ ...st.darkBtn, width: "100%" }} onClick={addField} disabled={saving}>{saving ? "Adding…" : "Add field"}</button>
            </div>

            <div style={st.card}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, marginBottom: 10 }}>Custom fields ({fieldList.length})</div>
              {fieldList.length === 0 ? (
                <div style={{ color: C.muted, padding: "14px 0", textAlign: "center" }}>No custom fields — this company uses the standard forms.</div>
              ) : fieldList.map((f, i) => (
                <div key={f.id} style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "11px 0", borderBottom: i < fieldList.length - 1 ? `1px solid ${C.line}` : "none" }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: C.amber, background: C.ink, padding: "3px 7px", borderRadius: 5, flexShrink: 0, textTransform: "uppercase" }}>{f.doc_type}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#334155" }}>{f.label}{f.required ? <span style={{ color: "#DC2626" }}> *</span> : null}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{f.field_type === "dropdown" ? `Dropdown: ${f.options}` : "Text box"}</div>
                  </div>
                  <button onClick={() => deleteField(f.id)} style={{ background: "transparent", border: "none", color: "#DC2626", fontSize: 13, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {manageTab === "monthly" && (
          <MonthlyInspectionBuilder companyId={activeId} token={token} />
        )}

        {manageTab === "forms" && (
          <>
            <div style={st.card}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, marginBottom: 4 }}>Analytics Dashboard Tier</div>
              <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 14 }}>Controls how much detail this company's supervisors see on the Dashboard's Analytics tab. Advanced adds trend charts, site scorecards, and corrective-action aging on top of everything in Basic.</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["basic", "advanced"].map(t => (
                  <button key={t} onClick={() => setAnalyticsTier(t)} style={{
                    flex: 1, textTransform: "capitalize", border: analyticsTier === t ? "none" : `1.5px solid ${C.line}`,
                    background: analyticsTier === t ? C.ink : "#fff", color: analyticsTier === t ? "#fff" : C.inkSoft,
                    borderRadius: 10, padding: "10px", fontWeight: 800, fontSize: 13, cursor: "pointer",
                  }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div style={st.card}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, marginBottom: 4 }}>Forms — Active / Deactivated</div>
            <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 16 }}>Control which document types this company's workers can see and submit. Deactivating a form hides it from the worker menu, but doesn't delete any submitted records.</div>

            {loadingDocSettings ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: C.muted }}>Loading…</div>
            ) : docSettings.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: C.muted }}>Nothing to show yet.</div>
            ) : (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginTop: 4 }}>Built-in forms</div>
                {docSettings.filter(d => !d.isCustom).map((d, i, arr) => (
                  <div key={d.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 0", borderBottom: i < arr.length - 1 ? `1px solid ${C.line}` : "none" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#334155" }}>{d.label}</div>
                    <button onClick={() => toggleDocSetting(d)} style={{
                      background: d.isActive ? "#DCFCE7" : "#F1F5F9",
                      color: d.isActive ? C.green : C.muted,
                      border: "none", borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer",
                    }}>
                      {d.isActive ? "● Active" : "○ Inactive"}
                    </button>
                  </div>
                ))}

                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginTop: 20 }}>Custom documents</div>
                {docSettings.filter(d => d.isCustom).length === 0 ? (
                  <div style={{ color: C.muted, padding: "10px 0", fontSize: 13 }}>No custom documents created yet for this company.</div>
                ) : (
                  docSettings.filter(d => d.isCustom).map((d, i, arr) => (
                    <div key={d.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 0", borderBottom: i < arr.length - 1 ? `1px solid ${C.line}` : "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span>{d.icon}</span>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#334155" }}>{d.label}</div>
                      </div>
                      <button onClick={() => toggleDocSetting(d)} style={{
                        background: d.isActive ? "#DCFCE7" : "#F1F5F9",
                        color: d.isActive ? C.green : C.muted,
                        border: "none", borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer",
                      }}>
                        {d.isActive ? "● Active" : "○ Inactive"}
                      </button>
                    </div>
                  ))
                )}
              </>
            )}
            </div>
          </>
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

            <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 8 }}>Danger zone</div>
              <button
                onClick={deleteCompany}
                disabled={saving}
                style={{ width: "100%", background: "#FEF2F2", color: "#DC2626", border: "1.5px solid #FCA5A5", borderRadius: 10, padding: "11px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                Delete company
              </button>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
                Only companies with no submitted records (FLHAs, incidents, near misses, inspections, toolbox talks, or daily reports) can be deleted.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
