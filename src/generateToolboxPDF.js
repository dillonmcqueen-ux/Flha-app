import { supabase } from "./supabaseClient";
import { drawCustomFieldsPDF } from "./customFields.jsx";

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

function wrap(doc, text, x, y, maxW, lh, footerLimit = 276) {
  const lines = doc.splitTextToSize(text, maxW);
  lines.forEach(line => { if (y > footerLimit) { doc.addPage(); y = 20; } doc.text(line, x, y); y += lh; });
  return y;
}

export async function generateAndUploadToolbox({ presenter, meetingType, site, topic, companyName, companyLogo, points, attendees, customFields }) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, margin = 16, contentW = W - margin * 2;
  let y = 20;

  // logo
  let logoDataUrl = null;
  if (companyLogo) {
    try {
      const resp = await fetch(companyLogo, { mode: "cors" });
      const blob = await resp.blob();
      logoDataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    } catch (e) { logoDataUrl = null; }
  }

  // header
  doc.setFillColor(91, 33, 182); doc.rect(0, 0, W, 30, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text("Toolbox Talk", margin, 13);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text("Safety meeting record", margin, 20);
  if (logoDataUrl) {
    try { const fmt = logoDataUrl.includes("image/png") ? "PNG" : "JPEG"; doc.addImage(logoDataUrl, fmt, W - margin - 20, 5, 20, 20); } catch (e) {}
  }
  y = 40;

  // info box
  doc.setFillColor(250, 245, 255); doc.roundedRect(margin, y, contentW, 22, 3, 3, "F");
  doc.setTextColor(91, 33, 182); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  doc.text("TYPE", margin + 4, y + 7); doc.text("PRESENTER", margin + 55, y + 7); doc.text("SITE", margin + 120, y + 7);
  doc.setTextColor(30, 41, 59); doc.setFontSize(10);
  doc.text(meetingType || "—", margin + 4, y + 15);
  doc.text(presenter || "—", margin + 55, y + 15, { maxWidth: 60 });
  doc.text(site || "—", margin + 120, y + 15, { maxWidth: 70 });
  y += 28;
  doc.setTextColor(100, 116, 139); doc.setFontSize(8);
  doc.text(`Date: ${new Date().toLocaleString("en-CA")}`, margin, y); y += 8;

  y = drawCustomFieldsPDF(doc, customFields, { margin, contentW, y, accent: [91, 33, 182] });

  // summary
  if (points?.summary) {
    doc.setFillColor(249, 250, 251); doc.roundedRect(margin, y, contentW, 6, 2, 2, "F");
    doc.setTextColor(30, 41, 59); doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text("TALK SUMMARY", margin + 3, y + 4.2); y += 10;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(51, 65, 85);
    y = wrap(doc, points.summary, margin, y, contentW, 5); y += 4;
  }

  // sections
  (points?.sections || []).forEach(sec => {
    if (y > 260) { doc.addPage(); y = 20; }
    doc.setTextColor(91, 33, 182); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    y = wrap(doc, sec.heading, margin, y, contentW, 5); y += 1;
    doc.setTextColor(51, 65, 85); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    (sec.bullets || []).forEach(b => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setTextColor(124, 58, 237); doc.setFont("helvetica", "bold");
      doc.text("•", margin, y);
      doc.setTextColor(51, 65, 85); doc.setFont("helvetica", "normal");
      y = wrap(doc, b, margin + 5, y, contentW - 5, 5);
    });
    y += 4;
  });

  // discussion
  if (points?.discussion?.length) {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFillColor(250, 245, 255); doc.setDrawColor(233, 213, 255);
    const boxStart = y;
    doc.setTextColor(91, 33, 182); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text("Discussion — questions for the crew", margin + 3, y + 6); y += 12;
    doc.setTextColor(51, 65, 85); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    points.discussion.forEach((d, i) => {
      if (y > 270) { doc.addPage(); y = 20; }
      y = wrap(doc, `${i + 1}. ${d}`, margin + 3, y, contentW - 6, 5);
    });
    y += 4;
  }

  // attendees & signatures
  if (y > 240) { doc.addPage(); y = 20; }
  doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3); doc.line(margin, y, W - margin, y); y += 8;
  doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(`Attendance & Signatures (${(attendees || []).length})`, margin, y); y += 8;

  const colW = contentW / 2;
  let col = 0;
  (attendees || []).forEach((a) => {
    if (y > 250) { doc.addPage(); y = 20; col = 0; }
    const x = margin + col * colW;
    if (a.signature) { try { doc.addImage(a.signature, "PNG", x, y, 45, 14); } catch (e) {} }
    doc.setDrawColor(150, 150, 150); doc.line(x, y + 15, x + 50, y + 15);
    doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.text(a.name + (a.presenter ? "  (Presenter)" : ""), x, y + 19, { maxWidth: colW - 6 });
    col++;
    if (col > 1) { col = 0; y += 24; }
  });
  if (col === 1) y += 24;

  // footer
  const H = 297; const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(margin, H - 12, W - margin, H - 12);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(91, 33, 182);
    doc.text("FORA", margin, H - 7);
    doc.setFont("helvetica", "normal"); doc.setTextColor(148, 163, 184);
    doc.text("AI-generated field safety documentation", margin + 11, H - 7);
    doc.text(`Page ${p} of ${pageCount}`, W - margin, H - 7, { align: "right" });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `TOOLBOX_${companyName || "co"}_${ts}.pdf`.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-.]/g, "");
  const blob = doc.output("blob");
  const { error } = await supabase.storage.from("flha-reports").upload(filename, blob, { contentType: "application/pdf", upsert: false });
  if (error) { console.error("toolbox pdf upload failed", error.message); return null; }
  const { data } = supabase.storage.from("flha-reports").getPublicUrl(filename);
  return data?.publicUrl || null;
}
