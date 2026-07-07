import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";

// Generate a short random suffix like "W7K2"
function randomSuffix(len = 4) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// Build a code prefix from company name (first letters of words, up to 3)
function codePrefix(name) {
  const clean = (name || "").trim().toUpperCase();
  if (!clean) return "CO";
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3);
  return words.map(w => w[0]).join("").slice(0, 3);
}

export default function AdminPanel() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // "list" | "addCompany" | "addSops"

  // Add-company form state
  const [newName, setNewName] = useState("");
  const [newWorkerCode, setNewWorkerCode] = useState("");
  const [newSupervisorCode, setNewSupervisorCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Add-SOPs form state
  const [sopCompanyId, setSopCompanyId] = useState(null);
  const [sopText, setSopText] = useState("");

  const loadCompanies = async () => {
    const { data } = await supabase
      .from("companies")
      .select("id, name, worker_code, supervisor_code")
      .order("id", { ascending: true });
    setCompanies(data || []);
    setLoading(false);
  };

  useEffect(() => { loadCompanies(); }, []);

  // When name changes on the add form, auto-suggest codes (editable)
  const handleNameChange = (val) => {
    setNewName(val);
    const prefix = codePrefix(val);
    setNewWorkerCode(`${prefix}-W${randomSuffix(3)}`);
    setNewSupervisorCode(`${prefix}-S${randomSuffix(3)}`);
  };

  const addCompany = async () => {
    setMsg("");
    if (!newName.trim()) { setMsg("Enter a company name."); return; }
    if (!newWorkerCode.trim() || !newSupervisorCode.trim()) { setMsg("Codes cannot be empty."); return; }
    setSaving(true);

    // Check codes aren't already in use
    const { data: existing } = await supabase
      .from("companies")
      .select("id")
      .or(`worker_code.eq.${newWorkerCode.trim()},supervisor_code.eq.${newSupervisorCode.trim()}`);
    if (existing && existing.length > 0) {
      setMsg("One of those codes is already in use. Edit and try again.");
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("companies").insert({
      name: newName.trim(),
      worker_code: newWorkerCode.trim(),
      supervisor_code: newSupervisorCode.trim(),
    });

    if (error) {
      setMsg("Error: " + error.message);
    } else {
      setMsg("Company added ✓");
      setNewName(""); setNewWorkerCode(""); setNewSupervisorCode("");
      await loadCompanies();
      setView("list");
    }
    setSaving(false);
  };

  const addSops = async () => {
    setMsg("");
    if (!sopCompanyId) { setMsg("Select a company."); return; }
    const lines = sopText.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) { setMsg("Enter at least one SOP (one per line)."); return; }
    setSaving(true);

    const rows = lines.map(policy_text => ({ company_id: sopCompanyId, policy_text }));
    const { error } = await supabase.from("sops").insert(rows);

    if (error) {
      setMsg("Error: " + error.message);
    } else {
      setMsg(`Added ${lines.length} SOP${lines.length > 1 ? "s" : ""} ✓`);
      setSopText("");
    }
    setSaving(false);
  };

  const copyText = (text) => {
    try {
      navigator.clipboard?.writeText(text);
      setMsg("Copied: " + text);
      setTimeout(() => setMsg(""), 2000);
    } catch (e) {}
  };

  const styles = {
    card: { background: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 4px #0001" },
    input: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #E5E7EB", fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 10 },
    label: { display: "block", fontWeight: 600, fontSize: 13, color: "#374151", marginBottom: 6 },
    btn: (bg, fg = "#fff") => ({ background: bg, color: fg, border: "none", borderRadius: 9, padding: "11px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer" }),
    tab: (active) => ({ padding: "8px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14, background: active ? "#7C3AED" : "transparent", color: active ? "#fff" : "#6B7280" }),
    codePill: { fontFamily: "monospace", background: "#F3F4F6", borderRadius: 6, padding: "3px 8px", fontSize: 13, cursor: "pointer", border: "1px solid #E5E7EB" },
  };

  if (loading) return <div style={{ padding: 20, color: "#6B7280" }}>Loading admin panel…</div>;

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ ...styles.card, padding: "8px 10px", display: "flex", gap: 4 }}>
        <button style={styles.tab(view === "list")} onClick={() => { setView("list"); setMsg(""); }}>🏢 Companies</button>
        <button style={styles.tab(view === "addCompany")} onClick={() => { setView("addCompany"); setMsg(""); }}>➕ Add Company</button>
        <button style={styles.tab(view === "addSops")} onClick={() => { setView("addSops"); setMsg(""); }}>📄 Add SOPs</button>
      </div>

      {msg && (
        <div style={{ ...styles.card, background: msg.startsWith("Error") ? "#FEF2F2" : "#F0FDF4", border: `1px solid ${msg.startsWith("Error") ? "#FCA5A5" : "#86EFAC"}`, color: msg.startsWith("Error") ? "#991B1B" : "#166534", fontSize: 14 }}>
          {msg}
        </div>
      )}

      {/* Company list with codes */}
      {view === "list" && (
        <div style={styles.card}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 4 }}>All Companies & Access Codes</div>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 12 }}>Tap a code to copy it. Share these with the company.</div>
          {companies.length === 0 ? (
            <div style={{ color: "#9CA3AF", padding: "16px 0", textAlign: "center" }}>No companies yet. Add one to get started.</div>
          ) : companies.map((c, i) => (
            <div key={c.id} style={{ padding: "12px 0", borderBottom: i < companies.length - 1 ? "1px solid #F3F4F6" : "none" }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 6 }}>{c.name}</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <span style={{ fontSize: 11, color: "#6B7280", marginRight: 6 }}>WORKER</span>
                  <span style={styles.codePill} onClick={() => copyText(c.worker_code)}>{c.worker_code || "—"}</span>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: "#6B7280", marginRight: 6 }}>SUPERVISOR</span>
                  <span style={styles.codePill} onClick={() => copyText(c.supervisor_code)}>{c.supervisor_code || "—"}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add company form */}
      {view === "addCompany" && (
        <div style={styles.card}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 12 }}>Add New Company</div>

          <label style={styles.label}>Company Name</label>
          <input style={styles.input} placeholder="e.g. Northern Builders Ltd." value={newName} onChange={e => handleNameChange(e.target.value)} />

          <label style={styles.label}>Worker Code (editable)</label>
          <input style={styles.input} value={newWorkerCode} onChange={e => setNewWorkerCode(e.target.value.toUpperCase())} />

          <label style={styles.label}>Supervisor Code (editable)</label>
          <input style={styles.input} value={newSupervisorCode} onChange={e => setNewSupervisorCode(e.target.value.toUpperCase())} />

          <button style={{ ...styles.btn("#7C3AED"), width: "100%", marginTop: 6 }} onClick={addCompany} disabled={saving}>
            {saving ? "Saving…" : "Create Company"}
          </button>
        </div>
      )}

      {/* Add SOPs form */}
      {view === "addSops" && (
        <div style={styles.card}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 4 }}>Add SOPs to a Company</div>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 12 }}>Paste one SOP per line. Each line becomes a separate policy.</div>

          <label style={styles.label}>Company</label>
          <select style={styles.input} value={sopCompanyId || ""} onChange={e => setSopCompanyId(Number(e.target.value) || e.target.value)}>
            <option value="">Select a company…</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <label style={styles.label}>SOPs (one per line)</label>
          <textarea
            style={{ ...styles.input, minHeight: 200, resize: "vertical", fontFamily: "inherit" }}
            placeholder={"All workers must conduct a FLHA before beginning any task.\nPPE is mandatory on all sites.\nFall protection required above 3 metres."}
            value={sopText}
            onChange={e => setSopText(e.target.value)}
          />

          <button style={{ ...styles.btn("#7C3AED"), width: "100%" }} onClick={addSops} disabled={saving}>
            {saving ? "Saving…" : "Add SOPs"}
          </button>
        </div>
      )}
    </div>
  );
}
