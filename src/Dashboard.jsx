import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";

const RISK_COLOR = {
  High: { bg: "#FEF2F2", border: "#FCA5A5", text: "#991B1B", dot: "#DC2626" },
  Medium: { bg: "#FFFBEB", border: "#FCD34D", text: "#92400E", dot: "#D97706" },
  Low: { bg: "#F0FDF4", border: "#86EFAC", text: "#166534", dot: "#16A34A" },
};

function RiskBadge({ risk }) {
  const c = RISK_COLOR[risk] || RISK_COLOR.Low;
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700
    }}>{risk}</span>
  );
}

function FLHACard({ flha, onClose }) {
  const h = flha.hazards_json || {};
  return (
    <div style={{
      position: "fixed", inset: 0, background: "#00000080", zIndex: 100,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "16px", overflowY: "auto"
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 14, padding: 24, width: "100%",
        maxWidth: 640, marginTop: 8
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: "#1E3A5F" }}>FLHA Report</div>
            <div style={{ fontSize: 13, color: "#6B7280" }}>
              {new Date(flha.created_at).toLocaleString("en-CA")} · {flha.job_site}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "#F3F4F6", border: "none", borderRadius: 8,
            padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer"
          }}>✕ Close</button>
        </div>

        <div style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#0369A1", marginBottom: 4 }}>WORKER</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#1E3A5F" }}>{flha.worker_name}</div>
          <div style={{ fontSize: 13, color: "#374151", marginTop: 2 }}>Signed by: {flha.signed_by}</div>
        </div>

        {h.taskSummary && (
          <div style={{ background: "#F9FAFB", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>TASK SUMMARY</div>
            <div style={{ fontSize: 14, color: "#374151" }}>{h.taskSummary}</div>
          </div>
        )}

        {h.sopAlerts?.length > 0 && (
          <div style={{ background: "#FFF7ED", border: "1.5px solid #FED7AA", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#C2410C", marginBottom: 6 }}>⚠️ SOP ALERTS TRIGGERED</div>
            {h.sopAlerts.map((a, i) => <div key={i} style={{ fontSize: 13, color: "#9A3412", marginBottom: 2 }}>• {a}</div>)}
          </div>
        )}

        {h.hazards?.length > 0 && (
          <>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: "#1E3A5F" }}>Hazards & Controls</div>
            {h.hazards.map((hz, i) => {
              const c = RISK_COLOR[hz.risk] || RISK_COLOR.Low;
              return (
                <div key={i} style={{
                  border: `1.5px solid ${c.border}`, background: c.bg,
                  borderRadius: 10, padding: "12px 14px", marginBottom: 8
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{hz.hazard}</div>
                    <RiskBadge risk={hz.risk} />
                  </div>
                  <div style={{ fontSize: 13, color: "#374151" }}>🛡 {hz.control}</div>
                </div>
              );
            })}
          </>
        )}

        {h.ppeRequired?.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: "#1E3A5F" }}>Required PPE</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {h.ppeRequired.map((p, i) => (
                <span key={i} style={{
                  background: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1D4ED8",
                  borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600
                }}>{p}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [companies, setCompanies] = useState([]);
  const [flhas, setFlhas] = useState([]);
  const [sops, setSops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [selectedFlha, setSelectedFlha] = useState(null);
  const [activeTab, setActiveTab] = useState("flhas");

  useEffect(() => {
    async function loadAll() {
      const [{ data: cos }, { data: fs }, { data: ss }] = await Promise.all([
        supabase.from("companies").select("*"),
        supabase.from("flhas").select("*").order("created_at", { ascending: false }),
        supabase.from("sops").select("*"),
      ]);
      setCompanies(cos || []);
      setFlhas(fs || []);
      setSops(ss || []);
      if (cos?.length) setSelectedCompany(cos[0].id);
      setLoading(false);
    }
    loadAll();
  }, []);

  const company = companies.find(c => c.id === selectedCompany);
  const companyFlhas = flhas.filter(f => f.company_id === selectedCompany || !f.company_id);
  const companySops = sops.filter(s => s.company_id === selectedCompany);

  const highRiskCount = companyFlhas.filter(f => {
    const hazards = f.hazards_json?.hazards || [];
    return hazards.some(h => h.risk === "High");
  }).length;

  const styles = {
    wrap: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#F0F4F8", minHeight: "100vh" },
    header: {
      background: "linear-gradient(135deg,#1E3A5F,#2D5F8A)",
      padding: "16px 20px", color: "#fff",
      display: "flex", justifyContent: "space-between", alignItems: "center"
    },
    card: { background: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 4px #0001" },
    stat: (accent) => ({
      background: "#fff", borderRadius: 12, padding: "14px 16px",
      borderLeft: `4px solid ${accent}`, boxShadow: "0 1px 4px #0001"
    }),
    tab: (active) => ({
      padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14,
      background: active ? "#1E3A5F" : "transparent", color: active ? "#fff" : "#6B7280"
    }),
    flhaRow: { padding: "12px 14px", borderBottom: "1px solid #F3F4F6", cursor: "pointer" },
  };

  if (loading) return (
    <div style={{ ...styles.wrap, display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <div style={{ textAlign: "center", color: "#6B7280" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
        Loading dashboard...
      </div>
    </div>
  );

  return (
    <div style={styles.wrap}>
      {selectedFlha && <FLHACard flha={selectedFlha} onClose={() => setSelectedFlha(null)} />}

      <div style={styles.header}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>🦺 SafeField Dashboard</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Supervisor View</div>
        </div>
        <a href="/" style={{ color: "#fff", fontSize: 13, textDecoration: "none", background: "#ffffff20", padding: "6px 12px", borderRadius: 8 }}>
          + New FLHA
        </a>
      </div>

      <div style={{ padding: 16 }}>

        {/* Company selector */}
        {companies.length > 1 && (
          <div style={styles.card}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 8 }}>COMPANY</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {companies.map(c => (
                <button key={c.id} onClick={() => setSelectedCompany(c.id)} style={{
                  padding: "8px 14px", borderRadius: 8, border: "1.5px solid",
                  borderColor: selectedCompany === c.id ? "#1E3A5F" : "#E5E7EB",
                  background: selectedCompany === c.id ? "#1E3A5F" : "#fff",
                  color: selectedCompany === c.id ? "#fff" : "#374151",
                  fontWeight: 600, fontSize: 14, cursor: "pointer"
                }}>{c.name}</button>
              ))}
            </div>
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div style={styles.stat("#F97316")}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#1E3A5F" }}>{companyFlhas.length}</div>
            <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 600 }}>TOTAL FLHAs</div>
          </div>
          <div style={styles.stat("#DC2626")}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#DC2626" }}>{highRiskCount}</div>
            <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 600 }}>HIGH RISK</div>
          </div>
          <div style={styles.stat("#16A34A")}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#16A34A" }}>{companySops.length}</div>
            <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 600 }}>SOPs LOADED</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ ...styles.card, padding: "8px 10px", display: "flex", gap: 4, marginBottom: 12 }}>
          <button style={styles.tab(activeTab === "flhas")} onClick={() => setActiveTab("flhas")}>📋 FLHAs</button>
          <button style={styles.tab(activeTab === "sops")} onClick={() => setActiveTab("sops")}>📄 SOPs</button>
        </div>

        {/* FLHAs tab */}
        {activeTab === "flhas" && (
          <div style={styles.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 4 }}>
              {company?.name} — Field Assessments
            </div>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>Tap any row to view full report</div>

            {companyFlhas.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                No FLHAs submitted yet for this company.
              </div>
            ) : (
              companyFlhas.map((f, i) => {
                const hazards = f.hazards_json?.hazards || [];
                const highRisk = hazards.filter(h => h.risk === "High").length;
                const medRisk = hazards.filter(h => h.risk === "Medium").length;
                return (
                  <div key={f.id} style={{
                    ...styles.flhaRow,
                    borderBottom: i < companyFlhas.length - 1 ? "1px solid #F3F4F6" : "none",
                    borderRadius: i === companyFlhas.length - 1 ? "0 0 8px 8px" : 0
                  }} onClick={() => setSelectedFlha(f)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#1E3A5F" }}>{f.worker_name || "Unknown Worker"}</div>
                        <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>📍 {f.job_site || "No location"}</div>
                        <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>
                          {new Date(f.created_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                        {highRisk > 0 && <RiskBadge risk="High" />}
                        {medRisk > 0 && <RiskBadge risk="Medium" />}
                        {highRisk === 0 && medRisk === 0 && <RiskBadge risk="Low" />}
                        <div style={{ fontSize: 11, color: f.pdf_url ? "#F97316" : "#9CA3AF" }}>{f.pdf_url ? "📄 PDF ready" : "No PDF"} · {hazards.length} hazards →</div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* SOPs tab */}
        {activeTab === "sops" && (
          <div style={styles.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#1E3A5F", marginBottom: 12 }}>
              {company?.name} — Safety Policies
            </div>
            {companySops.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#9CA3AF" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                No SOPs loaded for this company.
              </div>
            ) : (
              companySops.map((s, i) => (
                <div key={s.id} style={{
                  padding: "10px 0", borderBottom: i < companySops.length - 1 ? "1px solid #F3F4F6" : "none",
                  display: "flex", gap: 10, alignItems: "flex-start"
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", background: "#1E3A5F",
                    color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center"
                  }}>{i + 1}</div>
                  <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.5 }}>{s.policy_text}</div>
                </div>
              ))
            )}
          </div>
        )}

      </div>
    </div>
  );
}
