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

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const bigint = parseInt(h, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

export async function generateAndUploadCustomForm({
  formTitle, accentColor, siteName, companyName, companyLogo, submittedBy, aiSummary, items, signatureDataUrl,
}) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, margin = 16, contentW = W - margin * 2;
  let y = 20;
  const accent = hexToRgb(accentColor || "#4338CA");

  let logoDataUrl = null;
  if (companyLogo) {
    try {
      const resp = await fetch(companyLogo, { mode: "cors" });
      const blob = await resp.blob();
      logoDataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    } catch (e) { logoDataUrl = null; }
  }

  // header
  doc.setFillColor(...accent); doc.rect(0, 0, W, 30, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text(formTitle || "Document", margin, 13, { maxWidth: 160 });
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }), margin, 20);
  if (logoDataUrl) { try { const fmt = logoDataUrl.includes("image/png") ? "PNG" : "JPEG"; doc.addImage(logoDataUrl, fmt, W - margin - 20, 5, 20, 20); } catch (e) {} }
  y = 40;

  // info box
  doc.setFillColor(245, 245, 250); doc.roundedRect(margin, y, contentW, 24, 3, 3, "F");
  doc.setTextColor(...accent); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  doc.text("SITE", margin + 4, y + 7); doc.text("COMPANY", margin + 90, y + 7); doc.text("SUBMITTED BY", margin + 140, y + 7);
  doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(siteName || "—", margin + 4, y + 15, { maxWidth: 82 });
  doc.setFontSize(9);
  doc.text(companyName || "—", margin + 90, y + 15, { maxWidth: 45 });
  doc.text(submittedBy || "—", margin + 140, y + 15, { maxWidth: 50 });
  y += 32;

  // AI summary
  if (aiSummary) {
    doc.setTextColor(71, 85, 105); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.text("SUMMARY", margin, y);
    y += 6;
    doc.setTextColor(51, 65, 85); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const lines = doc.splitTextToSize(aiSummary, contentW);
    lines.forEach(line => { if (y > 275) { doc.addPage(); y = 20; } doc.text(line, margin, y); y += 5; });
    y += 6;
  }

  const flaggedCount = items.filter(it => !it.answer).length;
  doc.setFontSize(9); doc.setFont("helvetica", "bold");
  if (flaggedCount > 0) { doc.setTextColor(220, 38, 38); doc.text(`${flaggedCount} ITEM${flaggedCount > 1 ? "S" : ""} FLAGGED "NO"`, margin, y); }
  else { doc.setTextColor(22, 163, 74); doc.text("ALL ITEMS PASSED", margin, y); }
  y += 8;

  items.forEach((it, i) => {
    if (y > 260) { doc.addPage(); y = 20; }
    const yes = it.answer;
    doc.setDrawColor(...(yes ? [22, 163, 74] : [220, 38, 38])); doc.setLineWidth(0.8);
    doc.line(margin, y - 3, margin, y + 5);
    doc.setTextColor(30, 41, 59); doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.text(`${i + 1}. ${it.question}`, margin + 4, y, { maxWidth: contentW - 30 });
    doc.setTextColor(...(yes ? [22, 163, 74] : [220, 38, 38])); doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text(yes ? "YES" : "NO", W - margin, y, { align: "right" });
    y += 5;
    if (!yes && it.note) {
      doc.setTextColor(100, 116, 139); doc.setFont("helvetica", "italic"); doc.setFontSize(8);
      const noteLines = doc.splitTextToSize(`Note: ${it.note}`, contentW - 8);
      noteLines.forEach(line => { if (y > 275) { doc.addPage(); y = 20; } doc.text(line, margin + 4, y); y += 4.5; });
    }
    y += 3;
  });

  // signature
  if (y > 235) { doc.addPage(); y = 20; }
  y += 4; doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3); doc.line(margin, y, W - margin, y); y += 8;
  doc.setTextColor(30, 41, 59); doc.setFontSize(9); doc.setFont("helvetica", "bold");
  doc.text("Signature", margin, y); y += 4;
  if (signatureDataUrl) { try { doc.addImage(signatureDataUrl, "PNG", margin, y, 70, 21); } catch (e) {} }
  doc.setDrawColor(150, 150, 150); doc.line(margin, y + 23, margin + 70, y + 23);
  doc.setTextColor(100, 116, 139); doc.setFontSize(8); doc.setFont("helvetica", "normal");
  doc.text(`Printed name: ${submittedBy}`, margin, y + 29);
  doc.text(`Date: ${new Date().toLocaleString("en-CA")}`, W - margin, y + 29, { align: "right" });

  // footer
  const H = 297; const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(margin, H - 12, W - margin, H - 12);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...accent);
    doc.text("FORA", margin, H - 7);
    doc.setFont("helvetica", "normal"); doc.setTextColor(148, 163, 184);
    doc.text("AI-powered field safety documentation", margin + 11, H - 7);
    doc.text(`Page ${p} of ${pageCount}`, W - margin, H - 7, { align: "right" });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `CUSTOM_${formTitle || "doc"}_${companyName || "co"}_${siteName || "site"}_${ts}.pdf`.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-.]/g, "");
  const blob = doc.output("blob");
  const { error } = await supabase.storage.from("flha-reports").upload(filename, blob, { contentType: "application/pdf", upsert: false });
  if (error) { console.error("custom form pdf upload failed", error.message); return null; }
  const { data } = supabase.storage.from("flha-reports").getPublicUrl(filename);
  return data?.publicUrl || null;
}
