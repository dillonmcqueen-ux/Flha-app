// generateTimeClockReportPDF.js
// Renders the weekly time clock report (already computed and stored
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

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
}

export async function generateAndUploadTimeClockReport({ report, companyName, companyLogo }) {
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
  const entries = rj.entries || [];
  const grandTotal = entries.reduce((sum, p) => sum + (p.totalHours || 0), 0);

  // header
  doc.setFillColor(8, 145, 178); doc.rect(0, 0, W, 30, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text("Weekly Time Clock Report", margin, 13);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(`${rj.weekStart} to ${rj.weekEnd}`, margin, 20);
  if (logoDataUrl) { try { const fmt = logoDataUrl.includes("image/png") ? "PNG" : "JPEG"; doc.addImage(logoDataUrl, fmt, W - margin - 20, 5, 20, 20); } catch (e) {} }
  y = 40;

  // company box
  doc.setFillColor(236, 254, 255); doc.roundedRect(margin, y, contentW, 16, 3, 3, "F");
  doc.setTextColor(8, 145, 178); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  doc.text("COMPANY", margin + 4, y + 6);
  doc.setTextColor(30, 41, 59); doc.setFontSize(11); doc.setFont("helvetica", "normal");
  doc.text(companyName || "—", margin + 4, y + 12);
  doc.setTextColor(8, 145, 178); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  doc.text("TOTAL HOURS", margin + contentW - 45, y + 6);
  doc.setTextColor(30, 41, 59); doc.setFontSize(11); doc.setFont("helvetica", "normal");
  doc.text(grandTotal.toFixed(1), margin + contentW - 45, y + 12);
  y += 24;

  if (entries.length === 0) {
    doc.setTextColor(100, 116, 139); doc.setFontSize(11);
    doc.text("No time clock activity recorded this week.", margin, y);
  }

  const cDateX = margin, cDateW = 42;
  const cInX = cDateX + cDateW, cInW = 26;
  const cOutX = cInX + cInW, cOutW = 26;
  const cHoursX = cOutX + cOutW, cHoursW = 24;
  const cEditedX = cHoursX + cHoursW, cEditedW = contentW - cDateW - cInW - cOutW - cHoursW;

  const drawColumnHeader = () => {
    doc.setFillColor(8, 145, 178); doc.rect(margin, y, contentW, 7, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
    doc.text("DATE", cDateX + 2, y + 5);
    doc.text("IN", cInX + 2, y + 5);
    doc.text("OUT", cOutX + 2, y + 5);
    doc.text("HOURS", cHoursX + 2, y + 5);
    doc.text("EDITED", cEditedX + 2, y + 5);
    y += 7;
  };

  const drawPersonHeader = (person) => {
    if (y + 10 > 280) { doc.addPage(); y = 20; }
    doc.setFillColor(224, 247, 250); doc.rect(margin, y, contentW, 8, "F");
    doc.setTextColor(14, 116, 144); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
    doc.text(`${person.name}  (${person.role})`, margin + 2, y + 5.5);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(`${person.totalHours.toFixed(1)} hrs this week`, margin + contentW - 32, y + 5.5);
    y += 8;
  };

  entries.forEach((person) => {
    drawPersonHeader(person);
    drawColumnHeader();
    person.days.forEach((d, i) => {
      const rowH = 7;
      if (y + rowH > 280) { doc.addPage(); y = 20; drawColumnHeader(); }
      const zebra = i % 2 === 1;
      doc.setFillColor(...(zebra ? [248, 250, 252] : [255, 255, 255]));
      doc.rect(margin, y, contentW, rowH, "F");
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.15);
      doc.rect(margin, y, contentW, rowH, "S");

      const textY = y + 4.7;
      doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      doc.text(fmtDate(d.date), cDateX + 2, textY);
      doc.text(fmtTime(d.clockIn), cInX + 2, textY);
      doc.text(d.openAtReportTime ? "still open" : fmtTime(d.clockOut), cOutX + 2, textY);
      doc.text(d.hours != null ? d.hours.toFixed(2) : "—", cHoursX + 2, textY);
      doc.setTextColor(d.edited ? 217 : 148, d.edited ? 119 : 163, d.edited ? 6 : 184);
      doc.text(d.edited ? "Yes" : "—", cEditedX + 2, textY);
      y += rowH;
    });
    y += 4;
  });

  // footer
  const H = 297; const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(margin, H - 12, W - margin, H - 12);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(8, 145, 178);
    doc.text("FORA", margin, H - 7);
    doc.setFont("helvetica", "normal"); doc.setTextColor(148, 163, 184);
    doc.text("AI-generated field safety documentation", margin + 11, H - 7);
    doc.text(`Page ${p} of ${pageCount}`, W - margin, H - 6.5, { align: "right" });
  }

  // Filename includes report.id so re-generating never collides with a
  // previously uploaded file for the same company/week.
  const filename = `TIMECLOCK_${companyName || "co"}_${rj.weekStart}_${report.id}.pdf`.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-.]/g, "");
  const blob = doc.output("blob");
  const { error } = await supabase.storage.from("flha-reports").upload(filename, blob, { contentType: "application/pdf", upsert: true });
  if (error) { throw new Error("Upload failed: " + error.message); }
  const { data: pub } = supabase.storage.from("flha-reports").getPublicUrl(filename);
  return pub?.publicUrl || null;
}
