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

function wrap(doc, text, x, y, maxW, lh, limit = 276) {
  const lines = doc.splitTextToSize(text || "", maxW);
  lines.forEach(line => { if (y > limit) { doc.addPage(); y = 20; } doc.text(line, x, y); y += lh; });
  return y;
}

export async function generateAndUploadIncident(data) {
  const { reporter, site, occurredAt, incidentType, injuredPerson, bodyPart, treatment, medicalAttention, witnesses, evidence, report, companyName, companyLogo, signatureDataUrl } = data;
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
  doc.setFillColor(153, 27, 27); doc.rect(0, 0, W, 30, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text("Incident Report", margin, 13);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(incidentType || "Incident", margin, 20);
  if (logoDataUrl) { try { const fmt = logoDataUrl.includes("image/png") ? "PNG" : "JPEG"; doc.addImage(logoDataUrl, fmt, W - margin - 20, 5, 20, 20); } catch (e) {} }
  y = 40;

  // severity banner
  const sevColors = { Low: [22, 163, 74], Medium: [217, 119, 6], High: [220, 38, 38], Critical: [127, 29, 29] };
  const sev = report?.severity || "Medium";
  const sc = sevColors[sev] || sevColors.Medium;
  doc.setFillColor(...sc); doc.roundedRect(margin, y, contentW, 14, 2, 2, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(`SEVERITY: ${sev.toUpperCase()}`, margin + 5, y + 6);
  if (report?.severityReason) { doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text(doc.splitTextToSize(report.severityReason, contentW - 10)[0], margin + 5, y + 11); }
  y += 20;
  y = drawCustomFieldsPDF(doc, customFields, { margin, contentW, y, accent: [153, 27, 27] });

  // details box
  doc.setFillColor(254, 242, 242); doc.roundedRect(margin, y, contentW, 40, 3, 3, "F");
  doc.setTextColor(153, 27, 27); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  const L = margin + 4, R = margin + contentW / 2 + 2;
  doc.text("REPORTED BY", L, y + 7); doc.text("SITE", R, y + 7);
  doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(reporter || "—", L, y + 12, { maxWidth: contentW / 2 - 8 }); doc.text(site || "—", R, y + 12, { maxWidth: contentW / 2 - 8 });
  doc.setTextColor(153, 27, 27); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
  doc.text("WHEN", L, y + 19); doc.text("MEDICAL ATTENTION", R, y + 19);
  doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(occurredAt || "—", L, y + 24, { maxWidth: contentW / 2 - 8 }); doc.text(medicalAttention || "None", R, y + 24, { maxWidth: contentW / 2 - 8 });
  doc.setTextColor(153, 27, 27); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
  doc.text("INJURED PERSON", L, y + 31); doc.text("BODY PART", R, y + 31);
  doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(injuredPerson || "n/a", L, y + 36, { maxWidth: contentW / 2 - 8 }); doc.text(bodyPart || "n/a", R, y + 36, { maxWidth: contentW / 2 - 8 });
  y += 46;

  // treatment / witnesses / evidence lines
  doc.setTextColor(71, 85, 105); doc.setFontSize(9); doc.setFont("helvetica", "normal");
  if (treatment) { y = wrap(doc, `Treatment given: ${treatment}`, margin, y, contentW, 5); }
  if (witnesses) { y = wrap(doc, `Witnesses: ${witnesses}`, margin, y, contentW, 5); }
  if (evidence) { y = wrap(doc, `Evidence on file: ${evidence}`, margin, y, contentW, 5); }
  y += 4;

  const section = (title, body) => {
    if (y > 265) { doc.addPage(); y = 20; }
    doc.setTextColor(153, 27, 27); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(title, margin, y); y += 6;
    doc.setTextColor(51, 65, 85); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    if (Array.isArray(body)) {
      body.forEach(item => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.setTextColor(153, 27, 27); doc.setFont("helvetica", "bold"); doc.text("•", margin, y);
        doc.setTextColor(51, 65, 85); doc.setFont("helvetica", "normal");
        y = wrap(doc, item, margin + 5, y, contentW - 5, 5);
      });
    } else {
      y = wrap(doc, body, margin, y, contentW, 5);
    }
    y += 6;
  };

  section("Summary", report?.summary || "—");
  section("Sequence of Events", report?.sequenceOfEvents || []);
  section("Contributing Factors", report?.contributingFactors || []);
  section("Root Cause", report?.rootCause || "—");
  section("Immediate Actions Taken", report?.immediateActions || []);
  section("Corrective Actions", report?.correctiveActions || []);

  // signature
  if (y > 235) { doc.addPage(); y = 20; }
  y += 2; doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3); doc.line(margin, y, W - margin, y); y += 8;
  doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text("Reported By", margin, y); y += 4;
  if (signatureDataUrl) { try { doc.addImage(signatureDataUrl, "PNG", margin, y, 60, 18); } catch (e) {} }
  doc.setDrawColor(150, 150, 150); doc.line(margin, y + 20, margin + 60, y + 20);
  doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text(`${reporter}`, margin, y + 26);
  doc.text(`Date: ${new Date().toLocaleString("en-CA")}`, W - margin, y + 26, { align: "right" });

  // footer
  const H = 297; const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(margin, H - 12, W - margin, H - 12);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(153, 27, 27);
    doc.text("FORA", margin, H - 7);
    doc.setFont("helvetica", "normal"); doc.setTextColor(148, 163, 184);
    doc.text("AI-generated field safety documentation", margin + 11, H - 7);
    doc.text(`Page ${p} of ${pageCount}`, W - margin, H - 7, { align: "right" });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `INCIDENT_${companyName || "co"}_${ts}.pdf`.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-.]/g, "");
  const blob = doc.output("blob");
  const { error } = await supabase.storage.from("flha-reports").upload(filename, blob, { contentType: "application/pdf", upsert: false });
  if (error) { console.error("incident pdf upload failed", error.message); return null; }
  const { data: pub } = supabase.storage.from("flha-reports").getPublicUrl(filename);
  return pub?.publicUrl || null;
}
