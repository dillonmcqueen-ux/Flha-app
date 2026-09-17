// generateEquipmentAnalyticsPDF.js
// Snapshot export of the Dashboard's Equipment-side analytics (equipment
// issue history, preventative maintenance). Mirrors the Operations menu
// group — monthly/site inspections live under Safety instead, see
// generateSafetyAnalyticsPDF.js. Reuses analyticsUtils.js so the PDF
// always reconciles with the on-screen Analytics tab. Downloaded directly
// in the browser — a point-in-time snapshot, not a stored document.

import {
  loadJsPDF, drawBanner, loadLogoDataUrl, drawStatTiles, drawSectionTitle,
  drawBarList, drawTable, drawFooter, pdfFilename,
} from "./analyticsPdfHelpers.js";
import { equipmentIssueStats, maintenanceSummary, fuelSummary } from "./analyticsUtils.js";

const BLUE = [3, 105, 161];

export async function generateEquipmentAnalyticsPDF({
  companyName, companyLogo,
  inspections = [], maintenanceStatus = [], customDocs = [], fuelLogs = [], siteNames = {},
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
  const fuel = fuelSummary(fuelLogs, siteNames);
  const inspectionCount = inspections.length;

  y = drawStatTiles(doc, y, [
    { label: "Inspections", value: inspectionCount },
    { label: "Equipment Tracked (Maintenance)", value: maintenance.total },
    { label: "Overdue Maintenance", value: maintenance.overdue, color: maintenance.overdue > 0 ? [220, 38, 38] : [22, 163, 74] },
    { label: "Maintenance Due Soon", value: maintenance.dueSoon, color: maintenance.dueSoon > 0 ? [217, 119, 6] : [22, 163, 74] },
    { label: "Custom Operations Docs", value: customDocs.length },
    { label: "Fuel-Ups Logged", value: fuel.count },
    { label: "Fuel Cost", value: `$${fuel.totalCost.toFixed(0)}` },
  ], BLUE);

  y = drawSectionTitle(doc, y, "Top Equipment Issues", "Pre-trip and post-trip inspections flagged Defective or Monitor", BLUE);
  y = drawBarList(doc, y, equipStats.slice(0, 5).map(e => ({ label: e.label, count: e.defective + e.monitor })),
    { emptyLabel: "No equipment issues flagged yet.", barColor: [180, 83, 9] });

  if (y > 220) { doc.addPage(); y = redrawHeader(); }
  y = drawSectionTitle(doc, y, "Equipment Issue Detail", "All equipment with inspection history", BLUE);
  y = drawTable(doc, y, {
    emptyLabel: "No inspections yet.",
    columns: [
      { key: "label", label: "Equipment", width: 62 },
      { key: "defective", label: "Defective", align: "right", width: 26 },
      { key: "monitor", label: "Monitor", align: "right", width: 26 },
      { key: "inspectionCount", label: "Inspections", align: "right", width: 26 },
      { key: "lastFlaggedAt", label: "Last Flagged", align: "right", width: 38, render: r => r.lastFlaggedAt ? new Date(r.lastFlaggedAt).toLocaleDateString("en-CA") : "—" },
    ],
    rows: equipStats,
  }, redrawHeader);

  if (fuel.count > 0) {
    if (y > 220) { doc.addPage(); y = redrawHeader(); }
    y = drawSectionTitle(doc, y, "Fuel Cost & Consumption", "Cost and burn rate by machine", BLUE);
    y = drawTable(doc, y, {
      emptyLabel: "No fuel logged yet.",
      columns: [
        { key: "label", label: "Equipment", width: 50 },
        { key: "count", label: "Fuel-Ups", align: "right", width: 22 },
        { key: "cost", label: "Cost", align: "right", width: 24, render: r => `$${r.cost.toFixed(2)}` },
        { key: "avgBurnRate", label: "Avg Rate", align: "right", width: 26, render: r => r.avgBurnRate != null ? r.avgBurnRate.toFixed(2) : "—" },
        { key: "latestBurnRate", label: "Latest Rate", align: "right", width: 30, render: r => r.latestBurnRate != null ? r.latestBurnRate.toFixed(2) : "—" },
      ],
      rows: fuel.equipmentSummary,
    }, redrawHeader);

    if (y > 220) { doc.addPage(); y = redrawHeader(); }
    y = drawSectionTitle(doc, y, "Fuel Cost by Site", "Cost grouped by the site logged on each fuel-up, if any", BLUE);
    y = drawTable(doc, y, {
      emptyLabel: "No site-tagged fuel logs yet.",
      columns: [
        { key: "label", label: "Site", width: 70 },
        { key: "count", label: "Fuel-Ups", align: "right", width: 30 },
        { key: "cost", label: "Cost", align: "right", width: 30, render: r => `$${r.cost.toFixed(2)}` },
      ],
      rows: fuel.siteSummary,
    }, redrawHeader);
  }

  await drawFooter(doc, BLUE);
  doc.save(pdfFilename("EQUIPMENT_ANALYTICS", companyName));
}
