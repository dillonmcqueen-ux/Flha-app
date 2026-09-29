import { useState, useEffect } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { colors as C, radius as RAD, shadow as SHAD } from "./theme";

// Founder-only platform dashboard (Admin Panel > Platform). Rendered only
// inside AdminPanel, and the data comes from api/admin.js's platform_overview,
// which answers nothing but the global ADMIN_CODE session. Aggregates only:
// no document content, no worker names.

const tooltipStyle = {
  contentStyle: { background: C.panelRaised, border: `1px solid ${C.line}`, borderRadius: RAD.sm, fontSize: 12, color: C.text.primary },
  labelStyle: { color: C.text.muted, fontWeight: 700, marginBottom: 4 },
  itemStyle: { color: C.text.body },
  cursor: { fill: C.panelInset },
};
const axisTick = { fill: C.text.muted, fontSize: 11 };

function Card({ title, subtitle, children }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: 16, marginBottom: 12, boxShadow: SHAD.md }}>
      <div style={{ fontWeight: 800, fontSize: 15, color: C.text.primary, marginBottom: subtitle ? 2 : 10 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: C.text.muted, marginBottom: 12 }}>{subtitle}</div>}
      {children}
    </div>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div style={{ background: C.panelInset, borderRadius: RAD.md, padding: "14px 16px", border: `1px solid ${C.line}`, borderLeft: `4px solid ${C.orange}`, minWidth: 128, flex: "1 1 128px" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.orange }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.text.muted, textTransform: "uppercase", letterSpacing: 0.3, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.text.faint, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Table({ columns, rows, empty }) {
  if (rows.length === 0) return <div style={{ color: C.text.faint, fontSize: 13, padding: "8px 0" }}>{empty}</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>{columns.map(c => (
            <th key={c.key} style={{ textAlign: c.align || "left", padding: "6px 8px", fontSize: 11, fontWeight: 700, color: C.text.muted, textTransform: "uppercase", letterSpacing: 0.3, borderBottom: `1.5px solid ${C.line}`, whiteSpace: "nowrap" }}>{c.label}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{columns.map((c, ci) => (
              <td key={c.key} style={{ textAlign: c.align || "left", padding: "7px 8px", borderBottom: `1px solid ${C.line}`, color: C.text.body, fontWeight: ci === 0 ? 700 : 500, whiteSpace: "nowrap" }}>{c.render ? c.render(r) : (r[c.key] ?? "n/a")}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const shortDay = (iso) => iso.slice(5);
const money = (n) => `$${Math.round(n).toLocaleString("en-CA")}`;
const BAND_LABEL = { healthy: "Healthy", watch: "Watch", at_risk: "At risk", new: "New" };
const BAND_COLOR = { healthy: C.status.success.text, watch: C.status.warning.text, at_risk: C.status.danger.text, new: C.text.muted };

function BusinessSection({ business }) {
  const { mrr, health, timeToFirstDocument: ttfd, seats } = business;
  const tierRows = Object.entries(mrr.byTier).map(([tier, amount]) => ({ tier, amount }));
  const scored = business.perCompany.slice().sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  return (
    <>
      <Card title="Revenue (estimate)" subtitle={mrr.note}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Tile label="Estimated MRR" value={money(mrr.estimated)} sub="all live companies, list price" />
          <Tile label="Billed via Stripe" value={money(mrr.billed)} sub="subscription active or trialing" />
          <Tile label="Not billed via Stripe" value={money(mrr.notBilled)} sub="no subscription on file" />
          <Tile label="Payment at risk" value={money(mrr.atRisk)} sub="past due, unpaid or canceled" />
        </div>
        {mrr.unpriced > 0 && <div style={{ fontSize: 12, color: C.status.warning.text, marginTop: 10 }}>{mrr.unpriced} live compan{mrr.unpriced === 1 ? "y has" : "ies have"} no plan tier set, so {mrr.unpriced === 1 ? "it is" : "they are"} not priced.</div>}
        <div style={{ marginTop: 12 }}>
          <Table empty="No priced companies yet." rows={tierRows} columns={[{ key: "tier", label: "Tier" }, { key: "amount", label: "Estimated MRR", align: "right", render: r => money(r.amount) }]} />
        </div>
      </Card>

      <Card title="Company health" subtitle="Rule-based score out of 100: recent documents (40), worker logins this week (30), paid modules in use (20), payment status (10). Companies under 14 days old are not scored. Reasons are listed so you can see why.">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <Tile label="Healthy" value={health.healthy} />
          <Tile label="Watch" value={health.watch} />
          <Tile label="At risk" value={health.atRisk} />
          <Tile label="New" value={health.new} />
          <Tile label="Median days to first document" value={ttfd.medianDays === null ? "n/a" : ttfd.medianDays} sub={`${ttfd.filed} filed, ${ttfd.neverFiled} never`} />
        </div>
        <Table empty="No live companies." rows={scored} columns={[
          { key: "name", label: "Company" },
          { key: "score", label: "Score", align: "right", render: r => r.score === null ? "n/a" : r.score },
          { key: "band", label: "Status", render: r => <span style={{ color: BAND_COLOR[r.band], fontWeight: 700 }}>{BAND_LABEL[r.band]}</span> },
          { key: "monthly", label: "Est. MRR", align: "right", render: r => r.monthly === null ? "no tier" : money(r.monthly) },
          { key: "reasons", label: "Why", render: r => r.reasons.length ? r.reasons.join("; ") : "n/a" },
        ]} />
      </Card>

      <Card title="Seats" subtitle="Companies at 80% or more of their plan's seat cap, the natural upgrade conversation">
        <Table empty="No company is near its seat cap." rows={seats.nearCap} columns={[
          { key: "name", label: "Company" },
          { key: "used", label: "Seats used", align: "right" },
          { key: "cap", label: "Cap", align: "right" },
          { key: "pct", label: "Used", align: "right", render: r => `${r.pct}%` },
        ]} />
      </Card>
    </>
  );
}

export default function PlatformDashboard({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/admin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "platform_overview", token }),
      });
      const body = await res.json();
      if (res.ok) setData(body); else setError(body.error || "Could not load the platform overview.");
    } catch (e) { setError("Could not load the platform overview."); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  if (loading && !data) return <div style={{ textAlign: "center", padding: "40px 0", color: C.text.faint }}>Loading…</div>;
  if (error && !data) return <div style={{ color: C.status.danger.text, padding: 16 }}>{error}</div>;
  if (!data) return null;

  const { totals, documents, signups, plans, modules, perCompany, business } = data;
  const hasDocs = documents.perDay.some(d => d.total > 0);
  const typeBars = documents.byType.filter(t => t.last30 > 0).map(t => ({ label: t.label, count: t.last30 }));
  const funnelRows = Object.entries(signups.funnel).map(([status, count]) => ({ status, count }));
  const tierRows = Object.entries(plans.byTier).map(([tier, count]) => ({ tier, count }));
  const subRows = Object.entries(plans.bySubscription).map(([status, count]) => ({ status, count }));

  return (
    <div>
      <Card title="Platform" subtitle={`Aggregates across every company. Generated ${new Date(data.generatedAt).toLocaleString("en-CA")}.`}>
        {data.truncated && (
          <div style={{ fontSize: 12, color: C.status.warning.text, marginBottom: 10 }}>Some tables hit the row cap, so older history is partial. Recent numbers are complete.</div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Tile label="Companies" value={totals.companies} sub={`${totals.live} live, ${totals.suspended} suspended`} />
          <Tile label="Active companies" value={totals.activeCompanies7} sub={`${totals.activeCompanies30} in 30 days`} />
          <Tile label="Active workers" value={totals.activeWorkers7} sub={`${totals.activeWorkers30} in 30 days, of ${totals.rosterActive}`} />
          <Tile label="Documents (30 days)" value={documents.perDay.reduce((n, d) => n + d.total, 0)} />
        </div>
      </Card>

      {business && <BusinessSection business={business} />}

      <Card title="Documents per day" subtitle="Every document type, last 30 days">
        {!hasDocs ? <div style={{ color: C.text.faint, fontSize: 13 }}>No documents in the last 30 days.</div> : (
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={documents.perDay} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDay} tick={axisTick} axisLine={{ stroke: C.line }} tickLine={false} interval={4} />
                <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} width={28} />
                <Tooltip {...tooltipStyle} />
                <Line type="monotone" dataKey="total" name="Documents" stroke={C.orange} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card title="Documents by type" subtitle="Last 30 days, with 7-day and all-time counts in the table">
        {typeBars.length > 0 && (
          <div style={{ width: "100%", height: typeBars.length * 30 + 10, marginBottom: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={typeBars} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={8}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="label" width={150} tick={axisTick} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="count" name="Last 30 days" fill={C.orange} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <Table empty="No documents yet." rows={documents.byType} columns={[
          { key: "label", label: "Type" },
          { key: "last7", label: "7 days", align: "right" },
          { key: "last30", label: "30 days", align: "right" },
          { key: "total", label: "All time", align: "right" },
        ]} />
      </Card>

      <Card title="Modules: bought vs used" subtitle="Bought means switched on for a live company. Used means it filed at least one of that module's documents in the last 30 days. Preventative Maintenance and Equipment Compliance read other documents, so they have no filing to count.">
        <Table empty="No companies yet." rows={modules} columns={[
          { key: "label", label: "Module" },
          { key: "bought", label: "Bought", align: "right" },
          { key: "used", label: "Used", align: "right", render: r => r.used === null ? "not measurable" : r.used },
          { key: "adoptionPct", label: "Adoption", align: "right", render: r => r.adoptionPct === null ? "n/a" : `${r.adoptionPct}%` },
        ]} />
      </Card>

      <Card title="Plans" subtitle="Live companies by seat tier, and every company by Stripe subscription status">
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 220px" }}>
            <Table empty="No companies." rows={tierRows} columns={[{ key: "tier", label: "Tier" }, { key: "count", label: "Companies", align: "right" }]} />
          </div>
          <div style={{ flex: "1 1 220px" }}>
            <Table empty="No companies." rows={subRows} columns={[{ key: "status", label: "Subscription" }, { key: "count", label: "Companies", align: "right" }]} />
          </div>
        </div>
      </Card>

      <Card title="Sign-ups" subtitle="New companies and onboarding requests per month, plus where every request currently sits">
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={signups.months} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
              <XAxis dataKey="label" tick={axisTick} axisLine={{ stroke: C.line }} tickLine={false} />
              <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} width={28} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="requests" name="Onboarding requests" fill={C.text.muted} radius={[4, 4, 0, 0]} />
              <Bar dataKey="signups" name="New companies" fill={C.orange} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ marginTop: 12 }}>
          <Table empty="No onboarding requests yet." rows={funnelRows} columns={[{ key: "status", label: "Request status" }, { key: "count", label: "Requests", align: "right" }]} />
        </div>
      </Card>

      <Card title="Companies by activity" subtitle="Documents filed in the last 30 days, and how long since the last one">
        <Table empty="No live companies." rows={perCompany} columns={[
          { key: "name", label: "Company" },
          { key: "tier", label: "Tier" },
          { key: "subscription", label: "Subscription", render: r => r.subscription || "none" },
          { key: "docs30", label: "Docs (30d)", align: "right" },
          { key: "daysSinceLastDoc", label: "Days since last", align: "right", render: r => r.daysSinceLastDoc === null ? "never" : r.daysSinceLastDoc },
        ]} />
      </Card>
    </div>
  );
}
