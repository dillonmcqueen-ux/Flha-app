// src/generatePortalDocumentPDF.js
// PDF generation for a submitted Company Portal document — generalizes
// src/generateCustomFormPDF.js's yes/no-only rendering to the 8 field types
// in server-lib/portalFieldTypes.js. Same header/info-box/footer layout so
// a Portal PDF looks like every other FORA-generated document.
import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";
import { loadJsPDF } from "./loadJsPDF.js";
import { getForaLogoDataUrl } from "./foraLogo.js";

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const bigint = parseInt(h, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

// One line (or a short block) per answer, in whatever shape its field type
// needs. Returns the new y position.
function drawAnswer(doc, item, y, margin, contentW, W) {
  const { question_text, field_type, value } = item;
  doc.setTextColor(30, 41, 59); doc.setFontSize(10); doc.setFont("helvetica", "normal");

  if (field_type === "yesno") {
    const yes = value === "yes";
    doc.setDrawColor(...(yes ? [22, 163, 74] : [220, 38, 38])); doc.setLineWidth(0.8);
    doc.line(margin, y - 3, margin, y + 5);
    doc.text(question_text, margin + 4, y, { maxWidth: contentW - 30 });
    doc.setTextColor(...(yes ? [22, 163, 74] : [220, 38, 38])); doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text(yes ? "YES" : "NO", W - margin, y, { align: "right" });
    y += 5;
    if (!yes && item.note) {
      doc.setTextColor(100, 116, 139); doc.setFont("helvetica", "italic"); doc.setFontSize(8);
      const noteLines = doc.splitTextToSize(`Note: ${item.note}`, contentW - 8);
      noteLines.forEach(line => { doc.text(line, margin + 4, y); y += 4.5; });
    }
    return y + 3;
  }

  if (field_type === "signature" || field_type === "file_upload") {
    doc.text(question_text, margin, y, { maxWidth: contentW - 60 });
    doc.setTextColor(100, 116, 139); doc.setFontSize(9); doc.setFont("helvetica", "italic");
    doc.text(value ? "Attached" : "Not provided", W - margin, y, { align: "right" });
    return y + 8;
  }

  // short_text, number, date, dropdown, multiselect all render the same way:
  // label, then the value (joined with commas for multiselect's array).
  const displayValue = Array.isArray(value) ? (value.length ? value.join(", ") : "—") : (value || "—");
  doc.text(question_text, margin, y, { maxWidth: contentW - 4 });
  y += 5;
  doc.setTextColor(15, 23, 42); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  const lines = doc.splitTextToSize(String(displayValue), contentW - 4);
  lines.forEach(line => { doc.text(line, margin, y); y += 5; });
  return y + 3;
}

export async function generateAndUploadPortalDocument({
  documentTitle, siteName, companyName, companyLogo, submittedBy, aiSummary, items, signatureDataUrl, token, footerNote,
}) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, margin = 16, contentW = W - margin * 2;
  let y = 20;
  const accent = hexToRgb("#F97316"); // FORA orange — Portal documents don't carry a per-form accent color

  let logoDataUrl = null;
  if (companyLogo) {
    try {
      const resp = await fetch(companyLogo, { mode: "cors" });
      const blob = await resp.blob();
      logoDataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    } catch (e) { logoDataUrl = null; }
  }

  doc.setFillColor(...accent); doc.rect(0, 0, W, 30, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text(documentTitle || "Document", margin, 13, { maxWidth: 160 });
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }), margin, 20);
  if (logoDataUrl) { try { const fmt = logoDataUrl.includes("image/png") ? "PNG" : "JPEG"; doc.addImage(logoDataUrl, fmt, W - margin - 20, 5, 20, 20); } catch (e) {} }
  y = 40;

  doc.setFillColor(245, 245, 250); doc.roundedRect(margin, y, contentW, 24, 3, 3, "F");
  doc.setTextColor(...accent); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  doc.text("SITE", margin + 4, y + 7); doc.text("COMPANY", margin + 90, y + 7); doc.text("SUBMITTED BY", margin + 140, y + 7);
  doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(siteName || "—", margin + 4, y + 15, { maxWidth: 82 });
  doc.setFontSize(9);
  doc.text(companyName || "—", margin + 90, y + 15, { maxWidth: 45 });
  doc.text(submittedBy || "—", margin + 140, y + 15, { maxWidth: 50 });
  y += 32;

  if (aiSummary) {
    doc.setTextColor(71, 85, 105); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.text("SUMMARY", margin, y); y += 6;
    doc.setTextColor(51, 65, 85); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const lines = doc.splitTextToSize(aiSummary, contentW);
    lines.forEach(line => { if (y > 275) { doc.addPage(); y = 20; } doc.text(line, margin, y); y += 5; });
    y += 6;
  }

  items.forEach((item, i) => {
    if (y > 255) { doc.addPage(); y = 20; }
    y = drawAnswer(doc, { ...item, question_text: `${i + 1}. ${item.question_text}` }, y, margin, contentW, W);
  });

  if (y > 235) { doc.addPage(); y = 20; }
  y += 4; doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3); doc.line(margin, y, W - margin, y); y += 8;
  doc.setTextColor(30, 41, 59); doc.setFontSize(9); doc.setFont("helvetica", "bold");
  doc.text("Signature", margin, y); y += 4;
  if (signatureDataUrl) { try { doc.addImage(signatureDataUrl, "PNG", margin, y, 70, 21); } catch (e) {} }
  doc.setDrawColor(150, 150, 150); doc.line(margin, y + 23, margin + 70, y + 23);
  doc.setTextColor(100, 116, 139); doc.setFontSize(8); doc.setFont("helvetica", "normal");
  doc.text(`Printed name: ${submittedBy}`, margin, y + 29);
  doc.text(`Date: ${new Date().toLocaleString("en-CA")}`, W - margin, y + 29, { align: "right" });
  if (footerNote) {
    // Used when a supervisor regenerates a copy: the hand-drawn signature is
    // only ever drawn into the original PDF, so say so on the copy.
    doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    doc.splitTextToSize(footerNote, contentW).forEach((line, i) => doc.text(line, margin, y + 36 + i * 4));
  }

  const foraLogo = await getForaLogoDataUrl();
  const H = 297; const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(margin, H - 12, W - margin, H - 12);
    if (foraLogo) {
      try { doc.addImage(foraLogo, "PNG", margin, H - 10.5, 14, 6.74); } catch (e) {}
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
      doc.text("AI-powered field safety documentation", margin + 17, H - 7);
    } else {
      doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...accent);
      doc.text("FORA", margin, H - 7);
      doc.setFont("helvetica", "normal"); doc.setTextColor(148, 163, 184);
      doc.text("AI-powered field safety documentation", margin + 11, H - 7);
    }
    doc.text(`Page ${p} of ${pageCount}`, W - margin, H - 7, { align: "right" });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `PORTAL_${documentTitle || "doc"}_${companyName || "co"}_${siteName || "site"}_${ts}.pdf`.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-.]/g, "");
  const blob = doc.output("blob");
  try {
    const { receipt } = await uploadViaSignedUrl({
      endpoint: "/api/portal", action: "create_portal_upload_url", token,
      bucket: "flha-reports", filename, file: blob, contentType: "application/pdf",
    });
    return receipt || null;
  } catch (e) {
    console.error("portal document pdf upload failed", e.message);
    return null;
  }
}
