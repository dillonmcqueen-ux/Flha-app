// generateEquipmentReportPDF.js
// Renders the weekly equipment usage report (already computed and stored
// server-side as report_json) into a PDF, the same jsPDF-via-CDN pattern
// used everywhere else in the app, then uploads it to storage.

import { supabase } from "./supabaseClient";

async function loadJsPDF() {
  if (window.jspdf) return window.jspdf.jsPDF;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => resolve(window.jspdf.jsPDF);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function wrap(doc, text, x, y, maxW, lh, limit = 276) {
  const lines = doc.splitTextToSize(text || "", maxW);
  lines.forEach(line => { if (y > limit) { doc.addPage(); y = 20; } doc.text(line, x, y); y += lh; });
  return y;
}

export async function generateAndUploadEquipmentReport({ report, companyName, companyLogo }) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, margin = 16, contentW = W - margin * 2;
  let y = 20;

  let logoDataUrl = null;
  if (companyLogo) {
    try {
      const resp = await fetch(companyLogo, { mode: "cors" });
      const blob = await resp.blob();
      logoDataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    } catch (e) { logoDataUrl = null; }
  }

  const rj = report.report_json || {};
  const equipment = rj.equipment || [];

  // header
  doc.setFillColor(3, 105, 161); doc.rect(0, 0, W, 30, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text("Weekly Equipment Usage Report", margin, 13);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(`${rj.weekStart} to ${rj.weekEnd}`, margin, 20);
  if (logoDataUrl) { try { const fmt = logoDataUrl.includes("image/png") ? "PNG" : "JPEG"; doc.addImage(logoDataUrl, fmt, W - margin - 20, 5, 20, 20); } catch (e) {} }
  y = 40;

  // company box
  doc.setFillColor(240, 249, 255); doc.roundedRect(margin, y, contentW, 16, 3, 3, "F");
  doc.setTextColor(3, 105, 161); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  doc.text("COMPANY", margin + 4, y + 6);
  doc.setTextColor(30, 41, 59); doc.setFontSize(11); doc.setFont("helvetica", "normal");
  doc.text(companyName || "—", margin + 4, y + 12);
  y += 24;

  if (equipment.length === 0) {
    doc.setTextColor(100, 116, 139); doc.setFontSize(11);
    doc.text("No equipment activity recorded this week.", margin, y);
  }

  // table header
  const cLabelX = margin, cLabelW = 60;
  const cUsageX = cLabelX + cLabelW, cUsageW = 34;
  const cEndX = cUsageX + cUsageW, cEndW = 34;
  const cIssuesX = cEndX + cEndW, cIssuesW = contentW - cLabelW - cUsageW - cEndW;

  const drawHeader = () => {
    doc.setFillColor(3, 105, 161); doc.rect(margin, y, contentW, 8, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.text("EQUIPMENT", cLabelX + 2, y + 5.5);
    doc.text("USED THIS WK", cUsageX + 2, y + 5.5);
    doc.text("ENDING READING", cEndX + 2, y + 5.5);
    doc.text("OUTSTANDING ISSUES", cIssuesX + 2, y + 5.5);
    y += 8;
  };

  if (equipment.length > 0) {
    drawHeader();
    equipment.forEach((eq, i) => {
      const issueLines = eq.issues.length > 0
        ? eq.issues.map(iss => `${iss.type}: ${iss.note}`)
        : (eq.noPostTripCount > 0 ? ["Currently checked out (no post-trip logged)"] : ["None"]);
      const wrappedIssues = issueLines.flatMap(line => doc.splitTextToSize(line, cIssuesW - 4));
      const rowH = Math.max(9, wrappedIssues.length * 4.2 + 3);

      if (y + rowH > 280) { doc.addPage(); y = 20; drawHeader(); }

      const zebra = i % 2 === 1;
      doc.setFillColor(...(zebra ? [248, 250, 252] : [255, 255, 255]));
      doc.rect(margin, y, contentW, rowH, "F");
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.15);
      doc.rect(margin, y, contentW, rowH, "S");

      const textY = y + 5;
      doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      const labelLines = doc.splitTextToSize(eq.equipmentLabel, cLabelW - 4);
      labelLines.forEach((line, li) => doc.text(line, cLabelX + 2, textY + li * 4.2));

      doc.setFont("helvetica", "normal"); doc.setTextColor(55, 65, 81);
      doc.text(eq.usage > 0 ? `${eq.usage.toFixed(1)} ${eq.unit || ""}` : "—", cUsageX + 2, textY);
      doc.text(eq.endingReading != null ? `${eq.endingReading} ${eq.unit || ""}` : "—", cEndX + 2, textY);

      const hasIssues = eq.issues.length > 0;
      doc.setTextColor(hasIssues ? 220 : 100, hasIssues ? 38 : 116, hasIssues ? 38 : 139);
      wrappedIssues.forEach((line, li) => doc.text(line, cIssuesX + 2, textY + li * 4.2));

      y += rowH;
    });
    y += 6;
  }

  // footer
  const H = 297; const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(margin, H - 12, W - margin, H - 12);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(3, 105, 161);
    doc.text("FORA", margin, H - 7);
    doc.setFont("helvetica", "normal"); doc.setTextColor(148, 163, 184);
    doc.text("AI-generated field safety documentation", margin + 11, H - 7);
    doc.text(`Page ${p} of ${pageCount}`, W - margin, H - 6.5, { align: "right" });
  }

  // Filename includes report.id so re-generating never collides with a
  // previously uploaded file for the same company/week.
  const filename = `EQUIPMENT_${companyName || "co"}_${rj.weekStart}_${report.id}.pdf`.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-.]/g, "");
  const blob = doc.output("blob");
  const { error } = await supabase.storage.from("flha-reports").upload(filename, blob, { contentType: "application/pdf", upsert: true });
  if (error) { throw new Error("Upload failed: " + error.message); }
  const { data: pub } = supabase.storage.from("flha-reports").getPublicUrl(filename);
  return pub?.publicUrl || null;
}
