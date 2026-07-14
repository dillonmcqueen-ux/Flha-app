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

export async function generateAndUploadDaily(data) {
  const { reporter, site, reportDate, weather, temperature, crew, equipment, visitors, report, companyName, companyLogo } = data;
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

  // header
  doc.setFillColor(21, 128, 61); doc.rect(0, 0, W, 30, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text("Daily Report", margin, 13);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text("End-of-day site summary", margin, 20);
  if (logoDataUrl) { try { const fmt = logoDataUrl.includes("image/png") ? "PNG" : "JPEG"; doc.addImage(logoDataUrl, fmt, W - margin - 20, 5, 20, 20); } catch (e) {} }
  y = 40;

  // info box
  doc.setFillColor(240, 253, 244); doc.roundedRect(margin, y, contentW, 30, 3, 3, "F");
  const L = margin + 4, R = margin + contentW / 2 + 2;
  doc.setTextColor(21, 128, 61); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  doc.text("SITE", L, y + 7); doc.text("DATE", R, y + 7);
  doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(site || "—", L, y + 13, { maxWidth: contentW / 2 - 8 });
  doc.text(reportDate || "—", R, y + 13, { maxWidth: contentW / 2 - 8 });
  doc.setTextColor(21, 128, 61); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
  doc.text("WEATHER", L, y + 21); doc.text("PREPARED BY", R, y + 21);
  doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`${weather || "—"}${temperature ? `, ${temperature}` : ""}`, L, y + 27, { maxWidth: contentW / 2 - 8 });
  doc.text(reporter || "—", R, y + 27, { maxWidth: contentW / 2 - 8 });
  y += 38;

  // crew / equipment / visitors
  doc.setTextColor(71, 85, 105); doc.setFontSize(9); doc.setFont("helvetica", "normal");
  if (crew) y = wrap(doc, `Crew: ${crew}`, margin, y, contentW, 5);
  if (equipment) y = wrap(doc, `Equipment: ${equipment}`, margin, y, contentW, 5);
  if (visitors) y = wrap(doc, `Visitors: ${visitors}`, margin, y, contentW, 5);
  y += 5;

  const section = (title, body) => {
    if (y > 262) { doc.addPage(); y = 20; }
    doc.setTextColor(21, 128, 61); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(title, margin, y); y += 6;
    doc.setTextColor(51, 65, 85); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    y = wrap(doc, body, margin, y, contentW, 5);
    y += 7;
  };

  section("Work Completed", report?.workSummary || "—");
  section("Delays / Issues", report?.delaysSummary || "—");
  section("Plan for Tomorrow", report?.tomorrowPlan || "—");

  // prepared-by line
  if (y > 250) { doc.addPage(); y = 20; }
  y += 4; doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3); doc.line(margin, y, W - margin, y); y += 7;
  doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`Prepared by: ${reporter}`, margin, y);
  doc.text(`Submitted: ${new Date().toLocaleString("en-CA")}`, W - margin, y, { align: "right" });

  // footer
  const H = 297; const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(margin, H - 12, W - margin, H - 12);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(21, 128, 61);
    doc.text("FORA", margin, H - 7);
    doc.setFont("helvetica", "normal"); doc.setTextColor(148, 163, 184);
    doc.text("AI-generated field safety documentation", margin + 11, H - 7);
    doc.text(`Page ${p} of ${pageCount}`, W - margin, H - 7, { align: "right" });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `DAILY_${companyName || "co"}_${ts}.pdf`.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-.]/g, "");
  const blob = doc.output("blob");
  const { error } = await supabase.storage.from("flha-reports").upload(filename, blob, { contentType: "application/pdf", upsert: false });
  if (error) { console.error("daily pdf upload failed", error.message); return null; }
  const { data: pub } = supabase.storage.from("flha-reports").getPublicUrl(filename);
  return pub?.publicUrl || null;
}
