// generateSafetyAnalyticsPDF.js
// Snapshot export of the Dashboard's Safety-side analytics (severity mix,
// review backlog, high-risk FLHA rate, site activity, corrective actions,
// reporter engagement). Reuses the exact same aggregation functions the
// on-screen Analytics tab uses (analyticsUtils.js) so the PDF always
// reconciles with what's shown on screen. Downloaded directly in the
// browser — this is a point-in-time snapshot, not a stored document, so
// there's nothing to upload or sign a URL for.

import {
  loadJsPDF, PAGE, drawBanner, loadLogoDataUrl, drawStatTiles, drawSectionTitle,
  drawBarList, drawTable, drawFooter, pdfFilename,
} from "./analyticsPdfHelpers.js";
import {
  severityBreakdown, nearMissIncidentRatio, reviewBacklog, highRiskFlhaRate,
  fieldSiteActivity, monthlyTrend, correctiveActionAging, reporterLeaderboard, toolboxAvgAttendance,
} from "./analyticsUtils.js";

const NAVY = [30, 58, 95];
const SEV_COLOR = { Critical: [127, 29, 29], High: [220, 38, 38], Medium: [217, 119, 6], Low: [22, 163, 74] };

export async function generateSafetyAnalyticsPDF({
  companyName, companyLogo,
  flhas = [], toolbox = [], nearMisses = [], incidents = [], daily = [], monthlyActions = [],
}) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const logoDataUrl = await loadLogoDataUrl(companyLogo);

  const redrawHeader = () => drawBanner(doc, {
    title: "Safety Analytics",
    subtitle: `${companyName || "Company"} · ${new Date().toLocaleDateString("en-CA")}`,
    color: NAVY, logoDataUrl,
  });
  let y = redrawHeader();

  const sev = severityBreakdown(nearMisses, incidents);
  const ratio = nearMissIncidentRatio(nearMisses, incidents);
  const backlog = reviewBacklog(nearMisses, incidents);
  const riskRate = highRiskFlhaRate(flhas);
  const fieldSites = fieldSiteActivity(flhas, toolbox, daily, nearMisses, incidents);
  const trend = monthlyTrend(nearMisses, incidents);
  const aging = correctiveActionAging(monthlyActions);
  const leaderboard = reporterLeaderboard(flhas, [], toolbox);
  const attendance = toolboxAvgAttendance(toolbox);
  const openActionsCount = monthlyActions.filter(a => a.status !== "resolved").length;

  y = drawStatTiles(doc, y, [
    { label: "Total FLHAs", value: flhas.length },
    { label: "Incidents", value: incidents.length, color: incidents.length > 0 ? [220, 38, 38] : [22, 163, 74] },
    { label: "Near Misses", value: nearMisses.length, color: nearMisses.length > 0 ? [217, 119, 6] : [22, 163, 74] },
    { label: "Near-Miss : Incident", value: ratio.ratioLabel },
    { label: "Open Corrective Actions", value: openActionsCount, color: openActionsCount > 0 ? [217, 119, 6] : [22, 163, 74] },
    { label: "Toolbox Talks", value: toolbox.length + (attendance.count > 0 ? ` (avg ${attendance.avg})` : "") },
  ], NAVY);

  y = drawSectionTitle(doc, y, "Severity Mix", "Near misses + incidents combined, by potential/actual severity", NAVY);
  y = drawBarList(doc, y, ["Critical", "High", "Medium", "Low"].map(k => ({ label: k, count: sev[k], color: SEV_COLOR[k] })),
    { emptyLabel: "No near misses or incidents reported yet." });

  y = drawSectionTitle(doc, y, "Top Sites — Near Misses & Incidents", null, NAVY);
  y = drawBarList(doc, y, fieldSites.slice(0, 5).map(s => ({ label: s.site, count: s.nearMisses + s.incidents })),
    { emptyLabel: "No near misses or incidents reported yet.", barColor: [153, 27, 27] });

  if (y > 230) { doc.addPage(); y = redrawHeader(); }
  y = drawSectionTitle(doc, y, "Review Backlog", "Near misses + incidents reviewed vs outstanding", NAVY);
  if (backlog.total === 0) {
    doc.setTextColor(156, 163, 175); doc.setFont("helvetica", "italic"); doc.setFontSize(9);
    doc.text("No reports to review yet.", PAGE.margin, y); y += 8;
  } else {
    doc.setTextColor(51, 65, 85); doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    doc.text(`${backlog.reviewed} reviewed · ${backlog.outstanding} outstanding (${backlog.pct}% caught up)`, PAGE.margin, y);
    y += 8;
  }

  y = drawSectionTitle(doc, y, "High-Risk FLHA Rate", "Share of FLHAs with at least one High-risk hazard", NAVY);
  if (riskRate.total === 0) {
    doc.setTextColor(156, 163, 175); doc.setFont("helvetica", "italic"); doc.setFontSize(9);
    doc.text("No FLHAs submitted yet.", PAGE.margin, y); y += 8;
  } else {
    doc.setTextColor(riskRate.pct > 0 ? 220 : 22, riskRate.pct > 0 ? 38 : 163, riskRate.pct > 0 ? 38 : 74);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
    doc.text(`${riskRate.pct}% — ${riskRate.highRisk} of ${riskRate.total} FLHAs flagged High risk`, PAGE.margin, y);
    y += 8;
  }

  if (y > 220) { doc.addPage(); y = redrawHeader(); }
  y = drawSectionTitle(doc, y, "6-Month Trend", "Near misses and incidents per month", NAVY);
  y = drawTable(doc, y, {
    emptyLabel: "No near misses or incidents in the last 6 months.",
    columns: [
      { key: "label", label: "Month", width: 70 },
      { key: "nearMiss", label: "Near Miss", align: "right", width: 54 },
      { key: "incident", label: "Incident", align: "right", width: 54 },
    ],
    rows: trend,
  }, redrawHeader);

  if (y > 230) { doc.addPage(); y = redrawHeader(); }
  y = drawSectionTitle(doc, y, "Field Site Activity", "FLHAs, toolbox talks, daily reports, near misses & incidents by site", NAVY);
  y = drawTable(doc, y, {
    emptyLabel: "No site-tagged records yet.",
    columns: [
      { key: "site", label: "Site", width: 58 },
      { key: "flhas", label: "FLHAs", align: "right", width: 24 },
      { key: "toolbox", label: "Toolbox", align: "right", width: 24 },
      { key: "daily", label: "Daily", align: "right", width: 24 },
      { key: "nearMisses", label: "Near Miss", align: "right", width: 24 },
      { key: "incidents", label: "Incidents", align: "right", width: 24 },
    ],
    rows: fieldSites,
  }, redrawHeader);

  if (y > 230) { doc.addPage(); y = redrawHeader(); }
  y = drawSectionTitle(doc, y, "Corrective Action Aging", null, NAVY);
  if (aging.openCount === 0 && aging.resolvedCount === 0) {
    doc.setTextColor(156, 163, 175); doc.setFont("helvetica", "italic"); doc.setFontSize(9);
    doc.text("No corrective actions logged yet.", PAGE.margin, y); y += 8;
  } else {
    doc.setTextColor(51, 65, 85); doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    doc.text(`Open: ${aging.openCount} · Resolved: ${aging.resolvedCount} · Avg. resolution: ${aging.avgResolutionDays != null ? `${aging.avgResolutionDays}d` : "—"}`, PAGE.margin, y);
    y += 8;
    y = drawBarList(doc, y, [
      { label: "Open < 30 days", count: aging.buckets.under30, color: [22, 163, 74] },
      { label: "Open 30–60 days", count: aging.buckets.days30to60, color: [217, 119, 6] },
      { label: "Open 60+ days", count: aging.buckets.over60, color: [220, 38, 38] },
    ], { emptyLabel: "No open corrective actions." });
  }

  if (y > 230) { doc.addPage(); y = redrawHeader(); }
  y = drawSectionTitle(doc, y, "Most Active Safety Reporters", "FLHAs and toolbox talks by name", NAVY);
  y = drawBarList(doc, y, leaderboard, { emptyLabel: "No reports submitted yet.", barColor: [67, 56, 202] });

  await drawFooter(doc, NAVY);
  doc.save(pdfFilename("SAFETY_ANALYTICS", companyName));
}
