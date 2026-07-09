// generatePDF.js — builds a full FLHA report PDF and uploads to Supabase Storage
// Uses jsPDF loaded from CDN via dynamic import (no build step needed)

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

function wrapText(doc, text, x, y, maxWidth, lineHeight) {
  const lines = doc.splitTextToSize(text, maxWidth);
  lines.forEach(line => {
    if (y > 276) { doc.addPage(); y = 20; }
    doc.text(line, x, y);
    y += lineHeight;
  });
  return y;
}

export async function generateAndUploadFLHA({ flha, workerName, jobSite, signName, companyName, signatureDataUrl, companyLogo }) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const W = 210, margin = 16, contentW = W - margin * 2;
  let y = 20;

  // Try to load the company logo (remote URL → data URL) before drawing.
  // Use fetch→blob→dataURL which avoids canvas CORS tainting issues.
  let logoDataUrl = null;
  if (companyLogo) {
    try {
      const resp = await fetch(companyLogo, { mode: "cors" });
      const blob = await resp.blob();
      logoDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      logoDataUrl = null; // skip logo if it can't load
    }
  }

  // ── Header ──────────────────────────────────────────────
  doc.setFillColor(30, 58, 95); // #1E3A5F
  doc.rect(0, 0, W, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("SafeField FLHA Report", margin, 13);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Field Level Hazard Assessment", margin, 20);

  // Logo top-right (if available), else date
  if (logoDataUrl) {
    try {
      const fmt = logoDataUrl.includes("image/png") ? "PNG" : logoDataUrl.includes("image/webp") ? "WEBP" : "JPEG";
      doc.addImage(logoDataUrl, fmt, W - margin - 20, 5, 20, 20);
    } catch (e) {}
    doc.setFontSize(7);
    doc.text(new Date().toLocaleDateString("en-CA"), W - margin, 28, { align: "right" });
  } else {
    doc.text(new Date().toLocaleString("en-CA"), W - margin, 13, { align: "right" });
  }
  y = 40;

  // ── Company / Worker info ────────────────────────────────
  doc.setFillColor(240, 249, 255);
  doc.roundedRect(margin, y, contentW, 22, 3, 3, "F");
  doc.setTextColor(3, 105, 161);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("COMPANY", margin + 4, y + 7);
  doc.text("WORKER", margin + 70, y + 7);
  doc.text("JOB SITE", margin + 130, y + 7);
  doc.setTextColor(30, 58, 95);
  doc.setFontSize(11);
  doc.text(companyName || "—", margin + 4, y + 16, { maxWidth: 62 });
  doc.setFontSize(10);
  doc.text(workerName || "—", margin + 70, y + 16, { maxWidth: 55 });
  doc.text(jobSite || "—", margin + 130, y + 16, { maxWidth: 60 });
  y += 30;

  // ── Task Summary ─────────────────────────────────────────
  if (flha.taskSummary) {
    doc.setFillColor(249, 250, 251);
    doc.roundedRect(margin, y, contentW, 6, 2, 2, "F");
    doc.setTextColor(30, 58, 95);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("TASK SUMMARY", margin + 4, y + 4.5);
    y += 10;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(55, 65, 81);
    doc.setFontSize(9);
    y = wrapText(doc, flha.taskSummary, margin + 2, y, contentW - 4, 5);
    y += 4;
  }

  // ── SOP Alerts ───────────────────────────────────────────
  if (flha.sopAlerts?.length) {
    const alertsBoxH = 12 + flha.sopAlerts.length * 6;
    if (y + alertsBoxH > 275) { doc.addPage(); y = 20; }
    doc.setFillColor(255, 247, 237);
    doc.setDrawColor(254, 215, 170);
    doc.roundedRect(margin, y, contentW, 7 + flha.sopAlerts.length * 6, 2, 2, "FD");
    doc.setTextColor(194, 65, 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("SOP ALERTS TRIGGERED", margin + 4, y + 5);
    y += 10;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(154, 52, 18);
    flha.sopAlerts.forEach(alert => {
      y = wrapText(doc, `• ${alert}`, margin + 4, y, contentW - 8, 5);
    });
    y += 4;
  }

  // ── Hazards & Controls ───────────────────────────────────
  if (flha.hazards?.length) {
    doc.setTextColor(30, 58, 95);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Hazards & Controls", margin, y);
    y += 6;

    flha.hazards.forEach(hz => {
      const riskColors = {
        High: [254, 242, 242],
        Medium: [255, 251, 235],
        Low: [240, 253, 244],
      };
      const riskText = {
        High: [220, 38, 38],
        Medium: [217, 119, 6],
        Low: [22, 163, 74],
      };
      const bg = riskColors[hz.risk] || riskColors.Low;
      const tc = riskText[hz.risk] || riskText.Low;

      // estimate height
      const hazardLines = doc.splitTextToSize(hz.hazard, contentW - 30).length;
      const controlLines = doc.splitTextToSize(`Control: ${hz.control}`, contentW - 8).length;
      const boxH = 8 + hazardLines * 5 + controlLines * 5 + (hz.sopRef ? 5 : 0) + 4;

      // Break to next page if the whole box won't fit above the footer (footer ~285mm)
      if (y + boxH > 275) { doc.addPage(); y = 20; }

      doc.setFillColor(...bg);
      doc.roundedRect(margin, y, contentW, boxH, 2, 2, "F");

      // Risk badge
      doc.setFillColor(...tc);
      doc.roundedRect(W - margin - 22, y + 2, 20, 6, 1, 1, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.text(hz.risk || "Low", W - margin - 12, y + 6.5, { align: "center" });

      // Hazard name
      doc.setTextColor(30, 58, 95);
      doc.setFontSize(9);
      doc.text(hz.hazard, margin + 4, y + 6, { maxWidth: contentW - 30 });
      let rowY = y + 6 + hazardLines * 5;

      // Control
      doc.setFont("helvetica", "normal");
      doc.setTextColor(55, 65, 81);
      doc.setFontSize(8);
      rowY = wrapText(doc, `Control: ${hz.control}`, margin + 4, rowY, contentW - 8, 4.5);

      // SOP ref
      if (hz.sopRef) {
        doc.setTextColor(107, 114, 128);
        doc.setFontSize(7);
        rowY = wrapText(doc, `SOP: ${hz.sopRef}`, margin + 4, rowY, contentW - 8, 4);
      }

      y += boxH + 3;
    });
  }

  // ── PPE Required ─────────────────────────────────────────
  if (flha.ppeRequired?.length) {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setTextColor(30, 58, 95);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Required PPE", margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(29, 78, 216);

    let ppeX = margin;
    flha.ppeRequired.forEach(ppe => {
      const w = doc.getTextWidth(ppe) + 8;
      if (ppeX + w > W - margin) { ppeX = margin; y += 8; }
      doc.setFillColor(239, 246, 255);
      doc.setDrawColor(191, 219, 254);
      doc.roundedRect(ppeX, y - 5, w, 7, 1, 1, "FD");
      doc.text(ppe, ppeX + 4, y);
      ppeX += w + 3;
    });
    y += 12;
  }

  // ── Signature block ──────────────────────────────────────
  if (y > 230) { doc.addPage(); y = 20; }
  y += 4;
  doc.setDrawColor(209, 213, 219);
  doc.line(margin, y, W - margin, y);
  y += 8;

  doc.setTextColor(30, 58, 95);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Worker Signature", margin, y);
  y += 4;

  // Embed the drawn signature image if provided
  if (signatureDataUrl) {
    try {
      doc.addImage(signatureDataUrl, "PNG", margin, y, 70, 21);
    } catch (e) {
      // if image fails, skip silently
    }
  }
  // signature underline
  doc.setDrawColor(150, 150, 150);
  doc.line(margin, y + 23, margin + 70, y + 23);

  doc.setTextColor(107, 114, 128);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`Printed name: ${signName}`, margin, y + 29);
  doc.text(`Date: ${new Date().toLocaleString("en-CA")}`, W - margin, y + 29, { align: "right" });

  // ── FORA branding footer on every page ───────────────────
  const H = 297; // A4 height mm
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(margin, H - 12, W - margin, H - 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(30, 58, 95);
    doc.text("FORA", margin, H - 7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    doc.text("AI-generated field safety documentation", margin + 11, H - 7);
    doc.text(`Page ${p} of ${pageCount}`, W - margin, H - 7, { align: "right" });
  }

  // ── Generate filename & upload ───────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${companyName || "company"}_${workerName || "worker"}_${timestamp}.pdf`
    .replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-.]/g, "");

  const pdfBlob = doc.output("blob");

  const { data, error } = await supabase.storage
    .from("flha-reports")
    .upload(filename, pdfBlob, { contentType: "application/pdf", upsert: false });

  if (error) {
    console.error("PDF upload failed:", error.message);
    return null;
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from("flha-reports")
    .getPublicUrl(filename);

  return urlData?.publicUrl || null;
}
