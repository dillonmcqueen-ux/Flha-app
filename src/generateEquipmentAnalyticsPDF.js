// generateEquipmentAnalyticsPDF.js
// Snapshot export of the Dashboard's Equipment/Operations-side analytics
// (equipment issue history, preventative maintenance, monthly inspection
// pass rate, scheduled-inspection site activity). Mirrors the same split
// as the Operations menu group. Reuses analyticsUtils.js so the PDF always
// reconciles with the on-screen Analytics tab. Downloaded directly in the
// browser — a point-in-time snapshot, not a stored document.

import {
  loadJsPDF, PAGE, drawBanner, loadLogoDataUrl, drawStatTiles, drawSectionTitle,
  drawBarList, drawTable, drawFooter, pdfFilename,
} from "./analyticsPdfHelpers.js";
import {
  equipmentIssueStats, maintenanceSummary, monthlyPassRate, scheduledSiteActivity,
} from "./analyticsUtils.js";

const BLUE = [3, 105, 161];

export async function generateEquipmentAnalyticsPDF({
  companyName, companyLogo,
  inspections = [], maintenanceStatus = [], monthlyRecords = [], monthlyActions = [], customDocs = [],
}) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const logoDataUrl = await loadLogoDataUrl(companyLogo);

  const redrawHeader = () => drawBanner(doc, {
    title: "Equipment Analytics",
    subtitle: `${companyName || "Company"} · ${new Date().toLocaleDateString("en-CA")}`,
    color: BLUE, logoDataUrl,
  });
  let y = redrawHeader();

  const equipStats = equipmentIssueStats(inspections);
  const maintenance = maintenanceSummary(maintenanceStatus);
  const passRate = monthlyPassRate(monthlyRecords);
  const scheduledSites = scheduledSiteActivity(monthlyRecords, monthlyActions, customDocs);
  const pretripCount = inspections.filter(i => i.trip_type === "pretrip").length;

  y = drawStatTiles(doc, y, [
    { label: "Pretrip Inspections", value: pretripCount },
    { label: "Equipment Tracked (Maintenance)", value: maintenance.total },
    { label: "Overdue Maintenance", value: maintenance.overdue, color: maintenance.overdue > 0 ? [220, 38, 38] : [22, 163, 74] },
    { label: "Maintenance Due Soon", value: maintenance.dueSoon, color: maintenance.dueSoon > 0 ? [217, 119, 6] : [22, 163, 74] },
    { label: "Monthly Inspections", value: monthlyRecords.length },
    { label: "Monthly Pass Rate", value: passRate.total > 0 ? `${passRate.pct}%` : "—", color: passRate.total === 0 ? undefined : (passRate.pct >= 90 ? [22, 163, 74] : passRate.pct >= 70 ? [217, 119, 6] : [220, 38, 38]) },
  ], BLUE);

  y = drawSectionTitle(doc, y, "Top Equipment Issues", "Pretrip inspections flagged Defective or Monitor", BLUE);
  y = drawBarList(doc, y, equipStats.slice(0, 5).map(e => ({ label: e.label, count: e.defective + e.monitor })),
    { emptyLabel: "No equipment issues flagged yet.", barColor: [180, 83, 9] });

  if (y > 220) { doc.addPage(); y = redrawHeader(); }
  y = drawSectionTitle(doc, y, "Equipment Issue Detail", "All equipment with pretrip inspection history", BLUE);
  y = drawTable(doc, y, {
    emptyLabel: "No pretrip inspections yet.",
    columns: [
      { key: "label", label: "Equipment", width: 62 },
      { key: "defective", label: "Defective", align: "right", width: 26 },
      { key: "monitor", label: "Monitor", align: "right", width: 26 },
      { key: "pretripCount", label: "Pretrips", align: "right", width: 26 },
      { key: "lastFlaggedAt", label: "Last Flagged", align: "right", width: 38, render: r => r.lastFlaggedAt ? new Date(r.lastFlaggedAt).toLocaleDateString("en-CA") : "—" },
    ],
    rows: equipStats,
  }, redrawHeader);

  if (y > 230) { doc.addPage(); y = redrawHeader(); }
  y = drawSectionTitle(doc, y, "Monthly Inspection Pass Rate", "Share of monthly inspections with no items flagged", BLUE);
  if (passRate.total === 0) {
    doc.setTextColor(156, 163, 175); doc.setFont("helvetica", "italic"); doc.setFontSize(9);
    doc.text("No monthly inspections submitted yet.", PAGE.margin, y); y += 8;
  } else {
    doc.setTextColor(passRate.pct >= 90 ? 22 : passRate.pct >= 70 ? 217 : 220, passRate.pct >= 90 ? 163 : passRate.pct >= 70 ? 119 : 38, passRate.pct >= 90 ? 74 : passRate.pct >= 70 ? 6 : 38);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
    doc.text(`${passRate.pct}% — ${passRate.passed} of ${passRate.total} inspections passed clean`, PAGE.margin, y);
    y += 8;
  }

  if (y > 220) { doc.addPage(); y = redrawHeader(); }
  y = drawSectionTitle(doc, y, "Scheduled Inspection Sites", "Monthly inspections, open corrective actions, and custom document submissions by site", BLUE);
  y = drawTable(doc, y, {
    emptyLabel: "No monthly inspections or custom documents submitted yet.",
    columns: [
      { key: "site", label: "Site", width: 70 },
      { key: "monthly", label: "Monthly", align: "right", width: 36 },
      { key: "openActions", label: "Open Actions", align: "right", width: 36 },
      { key: "customDocs", label: "Custom Docs", align: "right", width: 36 },
    ],
    rows: scheduledSites,
  }, redrawHeader);

  await drawFooter(doc, BLUE);
  doc.save(pdfFilename("EQUIPMENT_ANALYTICS", companyName));
}
