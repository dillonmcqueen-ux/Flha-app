import {
  severityBreakdown, nearMissIncidentRatio, reviewBacklog, highRiskFlhaRate,
  equipmentIssueStats, fieldSiteActivity, scheduledSiteActivity, monthlyTrend,
  correctiveActionAging, reporterLeaderboard, monthlyPassRate, toolboxAvgAttendance,
  maintenanceSummary,
} from "./analyticsUtils";
import { colors as C, radius as RAD, shadow as SHAD } from "./theme";

const TONE = { neutral: C.orange, good: C.status.success.solid, warn: C.status.warning.solid, bad: C.status.danger.solid };
const SEV_COLOR = { Low: C.risk.low.solid, Medium: C.risk.medium.solid, High: C.risk.high.solid, Critical: C.risk.extreme.solid };

function SectionCard({ title, subtitle, children }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: RAD.lg, padding: 16, marginBottom: 12, boxShadow: SHAD.md }}>
      <div style={{ fontWeight: 800, fontSize: 15, color: C.text.primary, marginBottom: subtitle ? 2 : 10 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: C.text.muted, marginBottom: 12 }}>{subtitle}</div>}
      {children}
    </div>
  );
}

function StatTile({ label, value, sub, tone = "neutral" }) {
  const color = TONE[tone] || TONE.neutral;
  return (
    <div style={{ background: C.panelInset, borderRadius: RAD.md, padding: "14px 16px", borderLeft: `4px solid ${color}`, border: `1px solid ${C.line}`, borderLeftWidth: 4, borderLeftColor: color, minWidth: 128, flex: "1 1 128px" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.text.muted, textTransform: "uppercase", letterSpacing: 0.3, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.text.faint, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function RankedBarList({ items, limit, emptyLabel = "Not enough data yet.", barColor = C.orange }) {
  const list = limit ? items.slice(0, limit) : items;
  const hasData = list.some(it => it.count > 0);
  if (!hasData) return <div style={{ color: C.text.faint, fontSize: 13, padding: "8px 0" }}>{emptyLabel}</div>;
  const max = Math.max(...list.map(it => it.count), 1);
  return (
    <div>
      {list.map((it, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
            <span style={{ color: C.text.body, fontWeight: 600 }}>{it.label}</span>
            <span style={{ color: C.text.muted, fontWeight: 700 }}>{it.count}</span>
          </div>
          <div style={{ background: C.panelInset, borderRadius: 6, height: 8 }}>
            <div style={{ width: `${it.count > 0 ? Math.max((it.count / max) * 100, 4) : 0}%`, background: it.color || barColor, height: 8, borderRadius: 6, transition: "width .2s" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SimpleTable({ columns, rows, emptyLabel = "Not enough data yet." }) {
  if (rows.length === 0) return <div style={{ color: C.text.faint, fontSize: 13, padding: "8px 0" }}>{emptyLabel}</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={{ textAlign: c.align || "left", padding: "6px 8px", fontSize: 11, fontWeight: 700, color: C.text.muted, textTransform: "uppercase", letterSpacing: 0.3, borderBottom: `1.5px solid ${C.line}`, whiteSpace: "nowrap" }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c, ci) => (
                <td key={c.key} style={{ textAlign: c.align || "left", padding: "7px 8px", borderBottom: `1px solid ${C.line}`, color: C.text.body, fontWeight: ci === 0 ? 700 : 500, whiteSpace: "nowrap" }}>
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
  if (!hasData) return <div style={{ color: C.text.faint, fontSize: 13, padding: "8px 0" }}>{emptyLabel}</div>;
  const max = Math.max(...buckets.flatMap(b => series.map(s => b[s.key] || 0)), 1);
  return (
    <div>
      <div style={{ display: "flex", gap: 14, marginBottom: 10, flexWrap: "wrap" }}>
        {series.map(s => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.text.muted }}>
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
            <div style={{ fontSize: 10, color: C.text.faint, marginTop: 4 }}>{b.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Safety Analytics — FLHAs, toolbox talks, near misses, incidents,
// corrective actions, and monthly site inspections. Mirrors the Safety
// menu group and generateSafetyAnalyticsPDF.js's section split exactly,
// so the on-screen tab and its PDF export always agree on what counts as
// "safety" data.
export function SafetyAnalyticsPanel({
  tier, companyName,
  flhas = [], toolbox = [], nearMisses = [], incidents = [],
  daily = [], monthlyRecords = [], monthlyActions = [], customDocs = [],
}) {
  const isAdvanced = tier === "advanced";

  const sev = severityBreakdown(nearMisses, incidents);
  const ratio = nearMissIncidentRatio(nearMisses, incidents);
  const backlog = reviewBacklog(nearMisses, incidents);
  const riskRate = highRiskFlhaRate(flhas);
  const fieldSites = fieldSiteActivity(flhas, toolbox, daily, nearMisses, incidents);
  const openActionsCount = monthlyActions.filter(a => a.status !== "resolved").length;
  const attendance = toolboxAvgAttendance(toolbox);
  const passRate = monthlyPassRate(monthlyRecords);

  const severityItems = ["Critical", "High", "Medium", "Low"].map(k => ({ label: k, count: sev[k], color: SEV_COLOR[k] }));
  const topFieldSites = fieldSites.slice(0, 5).map(s => ({ label: s.site, count: s.nearMisses + s.incidents }));

  return (
    <div>
      <SectionCard title={`🦺 Safety Analytics — ${companyName || "Company"}`} subtitle={isAdvanced ? "Advanced tier — set by your admin" : "Basic tier — set by your admin"}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatTile label="Total FLHAs" value={flhas.length} />
          <StatTile label="Incidents" value={incidents.length} tone={incidents.length > 0 ? "bad" : "good"} />
          <StatTile label="Near Misses" value={nearMisses.length} tone={nearMisses.length > 0 ? "warn" : "good"} />
          <StatTile label="Near-Miss : Incident" value={ratio.ratioLabel} />
          <StatTile label="Open Corrective Actions" value={openActionsCount} tone={openActionsCount > 0 ? "warn" : "good"} />
          <StatTile label="Toolbox Talks" value={toolbox.length} sub={attendance.count > 0 ? `avg ${attendance.avg} attendees` : null} />
          <StatTile label="Monthly Site Inspections" value={monthlyRecords.length} />
          <StatTile label="Custom Safety Docs" value={customDocs.length} />
        </div>
      </SectionCard>

      <SectionCard title="Severity Mix" subtitle="Near misses + incidents combined, by potential/actual severity">
        <RankedBarList items={severityItems} emptyLabel="No near misses or incidents reported yet." />
      </SectionCard>

      <SectionCard title="Top Sites — Near Misses & Incidents">
        <RankedBarList items={topFieldSites} emptyLabel="No near misses or incidents reported yet." barColor={C.status.danger.solid} />
      </SectionCard>

      <SectionCard title="Review Backlog" subtitle="Near misses + incidents reviewed vs outstanding">
        {backlog.total === 0 ? (
          <div style={{ color: C.text.faint, fontSize: 13 }}>No reports to review yet.</div>
        ) : backlog.caughtUp ? (
          <div style={{ color: C.status.success.solid, fontWeight: 700, fontSize: 14 }}>✓ All {backlog.total} reports reviewed</div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: C.text.body, marginBottom: 6 }}>
              <strong>{backlog.reviewed}</strong> reviewed · <strong style={{ color: C.status.warning.text }}>{backlog.outstanding}</strong> outstanding ({backlog.pct}% caught up)
            </div>
            <div style={{ background: C.panelInset, borderRadius: 6, height: 8 }}>
              <div style={{ width: `${backlog.pct}%`, background: C.status.success.solid, height: 8, borderRadius: 6 }} />
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard title="High-Risk FLHA Rate" subtitle="Share of FLHAs with at least one High-risk hazard">
        {riskRate.total === 0 ? (
          <div style={{ color: C.text.faint, fontSize: 13 }}>No FLHAs submitted yet.</div>
        ) : (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: riskRate.pct > 0 ? C.status.danger.solid : C.status.success.solid }}>{riskRate.pct}%</div>
            <div style={{ fontSize: 13, color: C.text.muted }}>{riskRate.highRisk} of {riskRate.total} FLHAs flagged High risk</div>
          </div>
        )}
      </SectionCard>

      {isAdvanced && <SafetyAdvancedSections
        nearMisses={nearMisses} incidents={incidents} fieldSites={fieldSites}
        monthlyRecords={monthlyRecords} monthlyActions={monthlyActions} customDocs={customDocs}
        flhas={flhas} toolbox={toolbox} passRate={passRate}
      />}

      {!isAdvanced && (
        <div style={{ textAlign: "center", fontSize: 12, color: C.text.faint, padding: "10px 4px" }}>
          Ask your admin to enable Advanced Analytics for trend charts, site scorecards, corrective-action aging, and more.
        </div>
      )}
    </div>
  );
}

function SafetyAdvancedSections({ nearMisses, incidents, fieldSites, monthlyRecords, monthlyActions, customDocs, flhas, toolbox, passRate }) {
  const trend = monthlyTrend(nearMisses, incidents);
  const scheduledSites = scheduledSiteActivity(monthlyRecords, monthlyActions, customDocs);
  const aging = correctiveActionAging(monthlyActions);
  const leaderboard = reporterLeaderboard(flhas, [], toolbox);

  const agingItems = [
    { label: "Open < 30 days", count: aging.buckets.under30, color: C.status.success.solid },
    { label: "Open 30–60 days", count: aging.buckets.days30to60, color: C.status.warning.solid },
    { label: "Open 60+ days", count: aging.buckets.over60, color: C.status.danger.solid },
  ];

  return (
    <>
      <SectionCard title="6-Month Trend" subtitle="Near misses and incidents per month">
        <TrendBars
          buckets={trend}
          series={[{ key: "nearMiss", label: "Near Miss", color: C.status.warning.solid }, { key: "incident", label: "Incident", color: C.status.danger.solid }]}
          emptyLabel="No near misses or incidents in the last 6 months."
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

      <SectionCard title="Scheduled Inspection Sites" subtitle="Monthly site inspections, open corrective actions, and custom document submissions by site">
        <SimpleTable
          emptyLabel="No monthly site inspections or custom documents submitted yet."
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
          <div style={{ color: C.text.faint, fontSize: 13 }}>No corrective actions logged yet.</div>
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

      <SectionCard title="Most Active Safety Reporters" subtitle="FLHAs and toolbox talks by name">
        <RankedBarList items={leaderboard} emptyLabel="No reports submitted yet." barColor={C.status.info.solid} />
      </SectionCard>

      <SectionCard title="Monthly Site Inspection Pass Rate" subtitle="Share of monthly site inspections with no items flagged">
        {passRate.total === 0 ? (
          <div style={{ color: C.text.faint, fontSize: 13 }}>No monthly site inspections submitted yet.</div>
        ) : (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: passRate.pct >= 90 ? C.status.success.solid : passRate.pct >= 70 ? C.status.warning.solid : C.status.danger.solid }}>{passRate.pct}%</div>
            <div style={{ fontSize: 13, color: C.text.muted }}>{passRate.passed} of {passRate.total} inspections passed clean</div>
          </div>
        )}
      </SectionCard>
    </>
  );
}

// ── Equipment Analytics — pretrip/posttrip inspection issues and
// preventative maintenance. Mirrors the Operations menu group and
// generateEquipmentAnalyticsPDF.js's section split.
export function EquipmentAnalyticsPanel({ tier, companyName, inspections = [], daily = [], maintenanceStatus = [], customDocs = [] }) {
  const isAdvanced = tier === "advanced";

  const equipStats = equipmentIssueStats(inspections);
  const maintenance = maintenanceSummary(maintenanceStatus);
  const pretripCount = inspections.filter(i => i.trip_type === "pretrip").length;
  const topEquipment = equipStats.slice(0, 5).map(e => ({ label: e.label, count: e.defective + e.monitor }));

  return (
    <div>
      <SectionCard title={`🔧 Equipment Analytics — ${companyName || "Company"}`} subtitle={isAdvanced ? "Advanced tier — set by your admin" : "Basic tier — set by your admin"}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatTile label="Pretrip Inspections" value={pretripCount} />
          <StatTile label="Daily Reports" value={daily.length} />
          <StatTile label="Equipment Tracked (Maintenance)" value={maintenance.total} />
          <StatTile label="Overdue Maintenance" value={maintenance.overdue} tone={maintenance.overdue > 0 ? "bad" : "good"} />
          <StatTile label="Maintenance Due Soon" value={maintenance.dueSoon} tone={maintenance.dueSoon > 0 ? "warn" : "good"} />
          <StatTile label="Custom Operations Docs" value={customDocs.length} />
        </div>
      </SectionCard>

      <SectionCard title="Top Equipment Issues" subtitle="Pretrip inspections flagged Defective or Monitor">
        <RankedBarList items={topEquipment} emptyLabel="No equipment issues flagged yet." barColor={C.status.warning.solid} />
      </SectionCard>

      {isAdvanced && (
        <>
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

          {maintenance.total > 0 && (
            <SectionCard title="Preventative Maintenance" subtitle="Tracked equipment, by usage since last service">
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <StatTile label="Tracked Equipment" value={maintenance.total} />
                <StatTile label="Overdue" value={maintenance.overdue} tone={maintenance.overdue > 0 ? "bad" : "good"} />
                <StatTile label="Due Soon" value={maintenance.dueSoon} tone={maintenance.dueSoon > 0 ? "warn" : "good"} />
              </div>
            </SectionCard>
          )}
        </>
      )}

      {!isAdvanced && (
        <div style={{ textAlign: "center", fontSize: 12, color: C.text.faint, padding: "10px 4px" }}>
          Ask your admin to enable Advanced Analytics for equipment issue detail and preventative maintenance tracking.
        </div>
      )}
    </div>
  );
}
