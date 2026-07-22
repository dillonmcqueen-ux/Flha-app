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

export async function generateAndUploadFLHA({ flha, workerName, jobSite, signName, companyName, signatureDataUrl, companyLogo, amendedNote, pendingApproval, supervisorApproval, crewSignatures }) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const W = 210, margin = 16, contentW = W - margin * 2;
  let y = 20;

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
      logoDataUrl = null;
    }
  }

  // ── Header ──────────────────────────────────────────────
  doc.setFillColor(30, 58, 95); // #1E3A5F
  doc.rect(0, 0, W, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Job Hazard Analysis (JHA)", margin, 13);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Field Level Hazard Assessment", margin, 20);

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

  // ── Company custom fields ────────────────────────────────
  if (flha.customFields?.length) {
    const rows = flha.customFields;
    const boxH = 6 + Math.ceil(rows.length / 2) * 9;
    if (y + boxH > 275) { doc.addPage(); y = 20; }
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, contentW, boxH, 2, 2, "F");
    let cy = y + 6, col = 0;
    rows.forEach((f) => {
      const x = margin + 4 + col * (contentW / 2);
      doc.setTextColor(100, 116, 139);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(String(f.label || "").toUpperCase(), x, cy);
      doc.setTextColor(30, 41, 59);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(String(f.value || "—"), x, cy + 4.5, { maxWidth: contentW / 2 - 8 });
      col++;
      if (col > 1) { col = 0; cy += 9; }
    });
    y += boxH + 6;
  }

  // ── Pending supervisor approval banner ───────────────────
  if (pendingApproval) {
    doc.setFillColor(127, 29, 29);
    doc.roundedRect(margin, y, contentW, 12, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("PENDING SUPERVISOR APPROVAL — EXTREME RISK", W / 2, y + 5.5, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text("Work must not begin until a supervisor has signed off below.", W / 2, y + 9.5, { align: "center" });
    y += 18;
  }

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

  // ── Hazard / Control / SOP Ref — JHA-style table ─────────
  const COL = {
    num: margin,
    numW: 8,
    hazard: margin + 8,
    hazardW: contentW * 0.30,
    control: margin + 8 + contentW * 0.30,
    controlW: contentW * 0.34,
    sop: margin + 8 + contentW * 0.64,
    sopW: contentW * 0.19,
    risk: margin + contentW - (contentW - contentW * 0.83) + (contentW * 0.02),
    riskW: contentW * 0.17,
  };
  // simpler fixed columns (mm), sums to contentW
  const cNumX = margin, cNumW = 8;
  const cHazX = cNumX + cNumW, cHazW = 46;
  const cCtrlX = cHazX + cHazW, cCtrlW = 56;
  const cSopX = cCtrlX + cCtrlW, cSopW = 40;
  const cRiskX = cSopX + cSopW, cRiskW = contentW - cNumW - cHazW - cCtrlW - cSopW;

  const drawTableHeader = () => {
    doc.setFillColor(30, 58, 95);
    doc.rect(margin, y, contentW, 7, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("#", cNumX + 2, y + 4.8);
    doc.text("HAZARD", cHazX + 2, y + 4.8);
    doc.text("CONTROL MEASURE", cCtrlX + 2, y + 4.8);
    doc.text("SOP REF", cSopX + 2, y + 4.8);
    doc.text("RISK", cRiskX + 2, y + 4.8);
    y += 7;
  };

  const riskColors = {
    Extreme: { bg: [254, 226, 226], text: [127, 29, 29] },
    High: { bg: [254, 242, 242], text: [220, 38, 38] },
    Medium: { bg: [255, 251, 235], text: [217, 119, 6] },
    Low: { bg: [240, 253, 244], text: [22, 163, 74] },
  };

  if (flha.hazards?.length) {
    doc.setTextColor(30, 58, 95);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Hazard / Control / SOP Reference Checklist", margin, y);
    y += 6;

    drawTableHeader();

    flha.hazards.forEach((hz, hzIdx) => {
      // Task section header when the task changes
      const prevTask = hzIdx > 0 ? flha.hazards[hzIdx - 1].task : null;
      if (hz.task && hz.task !== prevTask) {
        const taskNum = [...new Set(flha.hazards.slice(0, hzIdx + 1).map(x => x.task))].length;
        if (y + 10 > 275) { doc.addPage(); y = 20; drawTableHeader(); }
        doc.setFillColor(239, 246, 255);
        doc.rect(margin, y, contentW, 8, "F");
        doc.setTextColor(30, 58, 95);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.text(`TASK ${taskNum}: `, margin + 2, y + 5.2);
        doc.setFont("helvetica", "normal");
        const taskLabelW = doc.getTextWidth(`TASK ${taskNum}: `);
        const taskLine = doc.splitTextToSize(hz.task, contentW - taskLabelW - 6)[0];
        doc.text(taskLine, margin + 2 + taskLabelW, y + 5.2);
        y += 8;
      }

      const hazardLines = doc.splitTextToSize(hz.hazard || "", cHazW - 4);
      const controlLines = doc.splitTextToSize(hz.control || "", cCtrlW - 4);
      const sopLines = doc.splitTextToSize(hz.sopRef || "—", cSopW - 4);
      const maxLines = Math.max(hazardLines.length, controlLines.length, sopLines.length, 1);
      const rowH = Math.max(9, maxLines * 4.2 + 3);

      if (y + rowH > 280) { doc.addPage(); y = 20; drawTableHeader(); }

      const rc = riskColors[hz.risk] || riskColors.Low;
      const zebra = hzIdx % 2 === 1;
      doc.setFillColor(...(zebra ? [248, 250, 252] : [255, 255, 255]));
      doc.rect(margin, y, contentW, rowH, "F");
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.15);
      doc.rect(margin, y, contentW, rowH, "S");

      const textY = y + 4.5;
      doc.setTextColor(148, 163, 184);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(String(hzIdx + 1), cNumX + 2, textY);

      doc.setTextColor(30, 41, 59);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      hazardLines.forEach((line, li) => doc.text(line, cHazX + 2, textY + li * 4.2));

      doc.setTextColor(55, 65, 81);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      controlLines.forEach((line, li) => doc.text(line, cCtrlX + 2, textY + li * 4.2));

      doc.setTextColor(107, 114, 128);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(6.8);
      sopLines.forEach((line, li) => doc.text(line, cSopX + 2, textY + li * 4.2));

      // Risk badge, vertically centered in the row
      const badgeW = cRiskW - 4, badgeH = 6;
      const badgeY = y + rowH / 2 - badgeH / 2;
      doc.setFillColor(...rc.bg);
      doc.roundedRect(cRiskX + 2, badgeY, badgeW, badgeH, 1, 1, "F");
      doc.setTextColor(...rc.text);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.text((hz.risk || "Low").toUpperCase(), cRiskX + 2 + badgeW / 2, badgeY + 4.2, { align: "center" });

      y += rowH;
    });

    // Column divider lines for the whole table run (visual polish)
    y += 2;
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

  if (flha.additionalNotes) {
    if (y > 255) { doc.addPage(); y = 20; }
    doc.setFillColor(249, 250, 251);
    doc.roundedRect(margin, y, contentW, 6, 2, 2, "F");
    doc.setTextColor(30, 58, 95);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("ADDITIONAL NOTES", margin + 4, y + 4.5);
    y += 10;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(55, 65, 81);
    doc.setFontSize(8.5);
    y = wrapText(doc, flha.additionalNotes, margin + 2, y, contentW - 4, 4.5);
    y += 4;
  }

  // ── Primary worker signature block ───────────────────────
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

  if (signatureDataUrl) {
    try {
      doc.addImage(signatureDataUrl, "PNG", margin, y, 70, 21);
    } catch (e) {}
  }
  doc.setDrawColor(150, 150, 150);
  doc.line(margin, y + 23, margin + 70, y + 23);

  doc.setTextColor(107, 114, 128);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`Printed name: ${workerName || signName || ""}`, margin, y + 29);
  doc.text(`Date: ${new Date().toLocaleString("en-CA")}`, W - margin, y + 29, { align: "right" });
  if (amendedNote) {
    doc.setTextColor(180, 83, 9);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text(amendedNote, margin, y + 34);
    doc.setFont("helvetica", "normal");
  }
  y += 40;

  // ── Crew sign-off block — other workers covered by this FLHA ──
  if (crewSignatures && crewSignatures.length > 0) {
    if (y > 245) { doc.addPage(); y = 20; }
    doc.setDrawColor(209, 213, 219);
    doc.line(margin, y, W - margin, y);
    y += 8;
    doc.setTextColor(30, 58, 95);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Additional Crew Sign-Off (${crewSignatures.length})`, margin, y);
    y += 6;

    const sigW = (contentW - 8) / 2, sigH = 26;
    let col = 0;
    crewSignatures.forEach((c) => {
      if (col === 0 && y + sigH > 280) { doc.addPage(); y = 20; }
      const x = margin + col * (sigW + 8);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      doc.roundedRect(x, y, sigW, sigH, 2, 2, "S");
      if (c.signature) {
        try { doc.addImage(c.signature, "PNG", x + 3, y + 2, sigW - 6, 14); } catch (e) {}
      }
      doc.setDrawColor(180, 180, 180);
      doc.line(x + 3, y + 17, x + sigW - 3, y + 17);
      doc.setTextColor(71, 85, 105);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text(c.name || "—", x + 3, y + 22, { maxWidth: sigW - 6 });
      if (col === 1) { y += sigH + 6; col = 0; } else { col = 1; }
    });
    if (col === 1) y += sigH + 6;
    y += 2;
  }

  // ── Supervisor approval block (extreme-risk sign-off) ────
  if (supervisorApproval) {
    let sy = y + 6;
    if (sy > 240) { doc.addPage(); sy = 20; }
    doc.setDrawColor(22, 163, 74);
    doc.setLineWidth(0.4);
    doc.line(margin, sy, W - margin, sy);
    sy += 8;
    doc.setTextColor(22, 101, 52);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Supervisor Approval — Extreme-Risk Sign-Off", margin, sy);
    sy += 4;
    if (supervisorApproval.signature) {
      try { doc.addImage(supervisorApproval.signature, "PNG", margin, sy, 70, 21); } catch (e) {}
    }
    doc.setDrawColor(150, 150, 150);
    doc.line(margin, sy + 23, margin + 70, sy + 23);
    doc.setTextColor(107, 114, 128);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Approved by: ${supervisorApproval.name}`, margin, sy + 29);
    doc.text(`Date: ${supervisorApproval.date}`, W - margin, sy + 29, { align: "right" });
  }

  // Load the FORA brand logo for the footer (once)
  let foraLogo = null;
  try {
    const fResp = await fetch("https://wzyvbtzxxdcxgvbkcqmt.supabase.co/storage/v1/object/public/company-logos/IMG_0113.jpeg", { mode: "cors" });
    const fBlob = await fResp.blob();
    foraLogo = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(fBlob);
    });
  } catch (e) { foraLogo = null; }

  // ── FORA branding footer on every page ───────────────────
  const H = 297;
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(margin, H - 12, W - margin, H - 12);
    if (foraLogo) {
      try {
        const fmt = foraLogo.includes("image/png") ? "PNG" : "JPEG";
        doc.addImage(foraLogo, fmt, margin, H - 10, 14, 5.5);
      } catch (e) {}
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text("AI-generated field safety documentation", margin + 17, H - 6.5);
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(30, 58, 95);
      doc.text("FORA", margin, H - 7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(148, 163, 184);
      doc.text("AI-generated field safety documentation", margin + 11, H - 7);
    }
    doc.setTextColor(148, 163, 184);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(`Page ${p} of ${pageCount}`, W - margin, H - 6.5, { align: "right" });
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

  const { data: urlData } = supabase.storage
    .from("flha-reports")
    .getPublicUrl(filename);

  return urlData?.publicUrl || null;
}
