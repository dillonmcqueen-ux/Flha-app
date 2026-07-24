import {
  severityBreakdown, nearMissIncidentRatio, reviewBacklog, highRiskFlhaRate,
  equipmentIssueStats, fieldSiteActivity, scheduledSiteActivity, monthlyTrend,
  correctiveActionAging, reporterLeaderboard, monthlyPassRate, toolboxAvgAttendance,
} from "./analyticsUtils";

const TONE = { neutral: "#1E3A5F", good: "#16A34A", warn: "#D97706", bad: "#DC2626" };
const SEV_COLOR = { Low: "#16A34A", Medium: "#D97706", High: "#DC2626", Critical: "#7F1D1D" };

function SectionCard({ title, subtitle, children }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: "0 1px 4px #0001" }}>
      <div style={{ fontWeight: 800, fontSize: 15, color: "#1E3A5F", marginBottom: subtitle ? 2 : 10 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 12 }}>{subtitle}</div>}
      {children}
    </div>
  );
}

function StatTile({ label, value, sub, tone = "neutral" }) {
  const color = TONE[tone] || TONE.neutral;
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", borderLeft: `4px solid ${color}`, boxShadow: "0 1px 4px #0001", minWidth: 128, flex: "1 1 128px" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.3, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function RankedBarList({ items, limit, emptyLabel = "Not enough data yet.", barColor = "#1E3A5F" }) {
  const list = limit ? items.slice(0, limit) : items;
  const hasData = list.some(it => it.count > 0);
  if (!hasData) return <div style={{ color: "#9CA3AF", fontSize: 13, padding: "8px 0" }}>{emptyLabel}</div>;
  const max = Math.max(...list.map(it => it.count), 1);
  return (
    <div>
      {list.map((it, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
            <span style={{ color: "#334155", fontWeight: 600 }}>{it.label}</span>
            <span style={{ color: "#6B7280", fontWeight: 700 }}>{it.count}</span>
          </div>
          <div style={{ background: "#F1F5F9", borderRadius: 6, height: 8 }}>
            <div style={{ width: `${it.count > 0 ? Math.max((it.count / max) * 100, 4) : 0}%`, background: it.color || barColor, height: 8, borderRadius: 6, transition: "width .2s" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SimpleTable({ columns, rows, emptyLabel = "Not enough data yet." }) {
  if (rows.length === 0) return <div style={{ color: "#9CA3AF", fontSize: 13, padding: "8px 0" }}>{emptyLabel}</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={{ textAlign: c.align || "left", padding: "6px 8px", fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.3, borderBottom: "1.5px solid #E5E7EB", whiteSpace: "nowrap" }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c, ci) => (
                <td key={c.key} style={{ textAlign: c.align || "left", padding: "7px 8px", borderBottom: "1px solid #F3F4F6", color: "#334155", fontWeight: ci === 0 ? 700 : 500, whiteSpace: "nowrap" }}>
                  {c.render ? c.render(row) : (row[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendBars({ buckets, series, emptyLabel = "Not enough data yet." }) {
  const hasData = buckets.some(b => series.some(s => (b[s.key] || 0) > 0));
  if (!hasData) return <div style={{ color: "#9CA3AF", fontSize: 13, padding: "8px 0" }}>{emptyLabel}</div>;
  const max = Math.max(...buckets.flatMap(b => series.map(s => b[s.key] || 0)), 1);
  return (
    <div>
      <div style={{ display: "flex", gap: 14, marginBottom: 10, flexWrap: "wrap" }}>
        {series.map(s => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#6B7280" }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, display: "inline-block" }} />
            {s.label}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
        {buckets.map((b, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 84 }}>
              {series.map(s => {
                const v = b[s.key] || 0;
                return (
                  <div key={s.key} title={`${s.label}: ${v}`} style={{
                    width: 14, height: v > 0 ? Math.max((v / max) * 80, 4) : 0,
                    background: s.color, borderRadius: "3px 3px 0 0",
                  }} />
                );
              })}
            </div>
            <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 4 }}>{b.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsPanel({
  tier, companyName,
  flhas = [], inspections = [], toolbox = [], nearMisses = [], incidents = [],
  daily = [], monthlyRecords = [], monthlyActions = [], customDocs = [],
}) {
  const isAdvanced = tier === "advanced";

  const sev = severityBreakdown(nearMisses, incidents);
  const ratio = nearMissIncidentRatio(nearMisses, incidents);
  const backlog = reviewBacklog(nearMisses, incidents);
  const riskRate = highRiskFlhaRate(flhas);
  const equipStats = equipmentIssueStats(inspections);
  const fieldSites = fieldSiteActivity(flhas, toolbox, daily, nearMisses, incidents);
  const openActionsCount = monthlyActions.filter(a => a.status !== "resolved").length;
  const attendance = toolboxAvgAttendance(toolbox);

  const severityItems = ["Critical", "High", "Medium", "Low"].map(k => ({ label: k, count: sev[k], color: SEV_COLOR[k] }));
  const topEquipment = equipStats.slice(0, 5).map(e => ({ label: e.label, count: e.defective + e.monitor }));
  const topFieldSites = fieldSites.slice(0, 5).map(s => ({ label: s.site, count: s.nearMisses + s.incidents }));

  return (
    <div>
      <SectionCard title={`📊 Analytics — ${companyName || "Company"}`} subtitle={isAdvanced ? "Advanced tier — set by your admin" : "Basic tier — set by your admin"}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatTile label="Total FLHAs" value={flhas.length} />
          <StatTile label="Incidents" value={incidents.length} tone={incidents.length > 0 ? "bad" : "good"} />
          <StatTile label="Near Misses" value={nearMisses.length} tone={nearMisses.length > 0 ? "warn" : "good"} />
          <StatTile label="Near-Miss : Incident" value={ratio.ratioLabel} />
          <StatTile label="Open Corrective Actions" value={openActionsCount} tone={openActionsCount > 0 ? "warn" : "good"} />
          <StatTile label="Toolbox Talks" value={toolbox.length} sub={attendance.count > 0 ? `avg ${attendance.avg} attendees` : null} />
          <StatTile label="Daily Reports" value={daily.length} />
        </div>
      </SectionCard>

      <SectionCard title="Severity Mix" subtitle="Near misses + incidents combined, by potential/actual severity">
        <RankedBarList items={severityItems} emptyLabel="No near misses or incidents reported yet." />
      </SectionCard>

      <SectionCard title="Top Equipment Issues" subtitle="Pretrip inspections flagged Defective or Monitor">
        <RankedBarList items={topEquipment} emptyLabel="No equipment issues flagged yet." barColor="#B45309" />
      </SectionCard>

      <SectionCard title="Top Sites — Near Misses & Incidents">
        <RankedBarList items={topFieldSites} emptyLabel="No near misses or incidents reported yet." barColor="#991B1B" />
      </SectionCard>

      <SectionCard title="Review Backlog" subtitle="Near misses + incidents reviewed vs outstanding">
        {backlog.total === 0 ? (
          <div style={{ color: "#9CA3AF", fontSize: 13 }}>No reports to review yet.</div>
        ) : backlog.caughtUp ? (
          <div style={{ color: "#16A34A", fontWeight: 700, fontSize: 14 }}>✓ All {backlog.total} reports reviewed</div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "#334155", marginBottom: 6 }}>
              <strong>{backlog.reviewed}</strong> reviewed · <strong style={{ color: "#B45309" }}>{backlog.outstanding}</strong> outstanding ({backlog.pct}% caught up)
            </div>
            <div style={{ background: "#F1F5F9", borderRadius: 6, height: 8 }}>
              <div style={{ width: `${backlog.pct}%`, background: "#16A34A", height: 8, borderRadius: 6 }} />
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard title="High-Risk FLHA Rate" subtitle="Share of FLHAs with at least one High-risk hazard">
        {riskRate.total === 0 ? (
          <div style={{ color: "#9CA3AF", fontSize: 13 }}>No FLHAs submitted yet.</div>
        ) : (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: riskRate.pct > 0 ? "#DC2626" : "#16A34A" }}>{riskRate.pct}%</div>
            <div style={{ fontSize: 13, color: "#6B7280" }}>{riskRate.highRisk} of {riskRate.total} FLHAs flagged High risk</div>
          </div>
        )}
      </SectionCard>

      {isAdvanced && <AdvancedSections
        nearMisses={nearMisses} incidents={incidents} equipStats={equipStats} fieldSites={fieldSites}
        monthlyRecords={monthlyRecords} monthlyActions={monthlyActions} customDocs={customDocs}
        flhas={flhas} inspections={inspections} toolbox={toolbox}
      />}

      {!isAdvanced && (
        <div style={{ textAlign: "center", fontSize: 12, color: "#9CA3AF", padding: "10px 4px" }}>
          Ask your admin to enable Advanced Analytics for trend charts, site scorecards, corrective-action aging, and more.
        </div>
      )}
    </div>
  );
}

function AdvancedSections({ nearMisses, incidents, equipStats, fieldSites, monthlyRecords, monthlyActions, customDocs, flhas, inspections, toolbox }) {
  const trend = monthlyTrend(nearMisses, incidents);
  const scheduledSites = scheduledSiteActivity(monthlyRecords, monthlyActions, customDocs);
  const aging = correctiveActionAging(monthlyActions);
  const leaderboard = reporterLeaderboard(flhas, inspections, toolbox);
  const passRate = monthlyPassRate(monthlyRecords);

  const agingItems = [
    { label: "Open < 30 days", count: aging.buckets.under30, color: "#16A34A" },
    { label: "Open 30–60 days", count: aging.buckets.days30to60, color: "#D97706" },
    { label: "Open 60+ days", count: aging.buckets.over60, color: "#DC2626" },
  ];

  return (
    <>
      <SectionCard title="6-Month Trend" subtitle="Near misses and incidents per month">
        <TrendBars
          buckets={trend}
          series={[{ key: "nearMiss", label: "Near Miss", color: "#D97706" }, { key: "incident", label: "Incident", color: "#DC2626" }]}
          emptyLabel="No near misses or incidents in the last 6 months."
        />
      </SectionCard>

      <SectionCard title="Equipment Issue Detail" subtitle="All equipment with pretrip inspection history">
        <SimpleTable
          emptyLabel="No pretrip inspections yet."
          columns={[
            { key: "label", label: "Equipment" },
            { key: "defective", label: "Defective", align: "right" },
            { key: "monitor", label: "Monitor", align: "right" },
            { key: "pretripCount", label: "Pretrips", align: "right" },
            { key: "lastFlaggedAt", label: "Last Flagged", render: r => r.lastFlaggedAt ? new Date(r.lastFlaggedAt).toLocaleDateString("en-CA") : "—" },
          ]}
          rows={equipStats}
        />
      </SectionCard>

      <SectionCard title="Field Site Activity" subtitle="FLHAs, toolbox talks, daily reports, near misses & incidents by site">
        <SimpleTable
          emptyLabel="No site-tagged records yet."
          columns={[
            { key: "site", label: "Site" },
            { key: "flhas", label: "FLHAs", align: "right" },
            { key: "toolbox", label: "Toolbox", align: "right" },
            { key: "daily", label: "Daily", align: "right" },
            { key: "nearMisses", label: "Near Miss", align: "right" },
            { key: "incidents", label: "Incidents", align: "right" },
          ]}
          rows={fieldSites}
        />
      </SectionCard>

      <SectionCard title="Scheduled Inspection Sites" subtitle="Monthly inspections, open corrective actions, and custom document submissions by site">
        <SimpleTable
          emptyLabel="No monthly inspections or custom documents submitted yet."
          columns={[
            { key: "site", label: "Site" },
            { key: "monthly", label: "Monthly Submissions", align: "right" },
            { key: "openActions", label: "Open Actions", align: "right" },
            { key: "customDocs", label: "Custom Docs", align: "right" },
          ]}
          rows={scheduledSites}
        />
      </SectionCard>

      <SectionCard title="Corrective Action Aging">
        {aging.openCount === 0 && aging.resolvedCount === 0 ? (
          <div style={{ color: "#9CA3AF", fontSize: 13 }}>No corrective actions logged yet.</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
              <StatTile label="Open" value={aging.openCount} tone={aging.openCount > 0 ? "warn" : "good"} />
              <StatTile label="Resolved" value={aging.resolvedCount} tone="good" />
              <StatTile label="Avg. Resolution Time" value={aging.avgResolutionDays != null ? `${aging.avgResolutionDays}d` : "—"} />
            </div>
            <RankedBarList items={agingItems} emptyLabel="No open corrective actions." />
          </>
        )}
      </SectionCard>

      <SectionCard title="Most Active Safety Reporters" subtitle="FLHAs, inspections, and toolbox talks by name">
        <RankedBarList items={leaderboard} emptyLabel="No reports submitted yet." barColor="#4338CA" />
      </SectionCard>

      <SectionCard title="Monthly Inspection Pass Rate" subtitle="Share of monthly inspections with no items flagged">
        {passRate.total === 0 ? (
          <div style={{ color: "#9CA3AF", fontSize: 13 }}>No monthly inspections submitted yet.</div>
        ) : (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: passRate.pct >= 90 ? "#16A34A" : passRate.pct >= 70 ? "#D97706" : "#DC2626" }}>{passRate.pct}%</div>
            <div style={{ fontSize: 13, color: "#6B7280" }}>{passRate.passed} of {passRate.total} inspections passed clean</div>
          </div>
        )}
      </SectionCard>
    </>
  );
}
