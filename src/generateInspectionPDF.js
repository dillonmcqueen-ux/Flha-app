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

function wrapText(doc, text, x, y, maxWidth, lineHeight) {
  const lines = doc.splitTextToSize(text, maxWidth);
  lines.forEach(line => { if (y > 275) { doc.addPage(); y = 20; } doc.text(line, x, y); y += lineHeight; });
  return y;
}

export async function generateAndUploadInspection({
  equipmentLabel, workerName, companyName, companyLogo, results, signatureDataUrl,
  tripType = "pretrip", startReading, endReading, readingUnit, hasChanges, changeCondition, changeNotes, linkedPretrip,
}) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, margin = 16, contentW = W - margin * 2;
  let y = 20;

  // logo → data url
  let logoDataUrl = null;
  if (companyLogo) {
    try {
      logoDataUrl = await new Promise((resolve, reject) => {
        const img = new Image(); img.crossOrigin = "anonymous";
        img.onload = () => { const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d").drawImage(img, 0, 0); resolve(c.toDataURL("image/png")); };
        img.onerror = () => reject(new Error("logo")); img.src = companyLogo;
      });
    } catch (e) { logoDataUrl = null; }
  }

  const isPost = tripType === "posttrip";

  // header
  doc.setFillColor(12, 74, 110); doc.rect(0, 0, W, 30, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text(isPost ? "Post-Trip Inspection" : "Pre-Trip Inspection", margin, 13);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(isPost ? "End-of-shift equipment check" : "Pre-use machine inspection", margin, 20);
  if (logoDataUrl) { try { doc.addImage(logoDataUrl, "PNG", W - margin - 20, 5, 20, 20); } catch (e) {} doc.setFontSize(7); doc.text(new Date().toLocaleDateString("en-CA"), W - margin, 28, { align: "right" }); }
  else doc.text(new Date().toLocaleString("en-CA"), W - margin, 13, { align: "right" });
  y = 40;

  // info box
  doc.setFillColor(240, 249, 255); doc.roundedRect(margin, y, contentW, 24, 3, 3, "F");
  doc.setTextColor(3, 105, 161); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  doc.text("MACHINE", margin + 4, y + 7); doc.text("COMPANY", margin + 90, y + 7); doc.text(isPost ? "TECHNICIAN" : "INSPECTOR", margin + 140, y + 7);
  doc.setTextColor(30, 41, 59); doc.setFontSize(10);
  doc.text(equipmentLabel || "—", margin + 4, y + 15, { maxWidth: 82 });
  doc.setFontSize(9);
  doc.text(companyName || "—", margin + 90, y + 15, { maxWidth: 45 });
  doc.text(workerName || "—", margin + 140, y + 15, { maxWidth: 50 });
  y += 32;

  // readings box
  doc.setFillColor(249, 250, 251); doc.roundedRect(margin, y, contentW, 20, 3, 3, "F");
  doc.setTextColor(71, 85, 105); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  if (isPost) {
    doc.text("STARTING READING", margin + 4, y + 7); doc.text("ENDING READING", margin + 90, y + 7);
    doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`${startReading || "—"} ${readingUnit || ""}`, margin + 4, y + 15);
    doc.text(`${endReading || "—"} ${readingUnit || ""}`, margin + 90, y + 15);
  } else {
    doc.text("STARTING READING", margin + 4, y + 7);
    doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`${startReading || "—"} ${readingUnit || ""}`, margin + 4, y + 15);
  }
  y += 28;

  // company custom fields (pre-trip only — post-trip is intentionally short)
  if (!isPost) {
    y = drawCustomFieldsPDF(doc, results?.customFields, { margin, contentW, y, accent: [3, 105, 161] });
  }

  if (isPost) {
    // ── Post-trip: link back to the pre-trip, then changes summary ──────
    if (linkedPretrip) {
      doc.setFillColor(239, 246, 255); doc.roundedRect(margin, y, contentW, 14, 2, 2, "F");
      doc.setTextColor(3, 105, 161); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.text("LINKED PRE-TRIP", margin + 4, y + 5.5);
      doc.setFont("helvetica", "normal"); doc.setTextColor(30, 41, 59); doc.setFontSize(9);
      doc.text(`${linkedPretrip.worker_name || "—"} · ${linkedPretrip.created_at ? new Date(linkedPretrip.created_at).toLocaleString("en-CA") : ""}`, margin + 4, y + 11);
      y += 20;
    }

    if (!hasChanges) {
      doc.setFillColor(240, 253, 244); doc.setDrawColor(134, 239, 172);
      doc.roundedRect(margin, y, contentW, 16, 2, 2, "FD");
      doc.setTextColor(22, 101, 52); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      doc.text("✓ NO CHANGES REPORTED SINCE PRE-TRIP", margin + 4, y + 10);
      y += 24;
    } else {
      const condColors = { Monitor: [217, 119, 6], Defective: [220, 38, 38] };
      const col = condColors[changeCondition] || condColors.Monitor;
      doc.setFillColor(...(changeCondition === "Defective" ? [254, 242, 242] : [255, 251, 235]));
      doc.setDrawColor(...col);
      const notesLines = doc.splitTextToSize(changeNotes || "—", contentW - 8);
      const boxH = 16 + notesLines.length * 5;
      doc.roundedRect(margin, y, contentW, boxH, 2, 2, "FD");
      doc.setTextColor(...col); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      doc.text(`⚠ CHANGE REPORTED — ${(changeCondition || "").toUpperCase()}`, margin + 4, y + 8);
      doc.setFont("helvetica", "normal"); doc.setTextColor(51, 65, 85); doc.setFontSize(9);
      doc.text(notesLines, margin + 4, y + 14);
      y += boxH + 8;
    }
  } else {
    // ── Pre-trip: full checklist (unchanged from before) ────────────────
    const items = results?.items || [];
    const def = results?.defectiveCount || 0, mon = results?.monitorCount || 0;
    doc.setFontSize(9); doc.setFont("helvetica", "bold");
    if (def > 0) { doc.setTextColor(220, 38, 38); doc.text(`${def} DEFECTIVE`, margin, y); }
    if (mon > 0) { doc.setTextColor(217, 119, 6); doc.text(`${mon} MONITOR`, margin + (def > 0 ? 40 : 0), y); }
    if (def === 0 && mon === 0) { doc.setTextColor(22, 163, 74); doc.text("ALL ITEMS GOOD", margin, y); }
    y += 8;

    const condColor = { Good: [22, 163, 74], Monitor: [217, 119, 6], Defective: [220, 38, 38] };
    items.forEach(it => {
      if (y > 265) { doc.addPage(); y = 20; }
      const col = condColor[it.condition] || condColor.Good;
      doc.setDrawColor(...col); doc.setLineWidth(0.8); doc.line(margin, y - 3, margin, y + 5);
      doc.setTextColor(30, 41, 59); doc.setFontSize(10); doc.setFont("helvetica", "bold");
      doc.text(it.item, margin + 4, y, { maxWidth: contentW - 40 });
      doc.setTextColor(...col); doc.setFontSize(9);
      doc.text(it.condition.toUpperCase(), W - margin, y, { align: "right" });
      y += 5;
      if (it.note) {
        doc.setTextColor(100, 116, 139); doc.setFont("helvetica", "italic"); doc.setFontSize(8);
        y = wrapText(doc, `Note: ${it.note}`, margin + 4, y, contentW - 8, 4.5);
      }
      y += 3;
    });
  }

  // signature
  if (y > 235) { doc.addPage(); y = 20; }
  y += 4; doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3); doc.line(margin, y, W - margin, y); y += 8;
  doc.setTextColor(30, 41, 59); doc.setFontSize(9); doc.setFont("helvetica", "bold");
  doc.text(isPost ? "Technician Signature" : "Inspector Signature", margin, y); y += 4;
  if (signatureDataUrl) { try { doc.addImage(signatureDataUrl, "PNG", margin, y, 70, 21); } catch (e) {} }
  doc.setDrawColor(150, 150, 150); doc.line(margin, y + 23, margin + 70, y + 23);
  doc.setTextColor(100, 116, 139); doc.setFontSize(8); doc.setFont("helvetica", "normal");
  doc.text(`Printed name: ${workerName}`, margin, y + 29);
  doc.text(`Date: ${new Date().toLocaleString("en-CA")}`, W - margin, y + 29, { align: "right" });

  // upload
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `INSPECTION_${isPost ? "POST" : "PRE"}_${companyName || "co"}_${workerName || "w"}_${ts}.pdf`.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-.]/g, "");
  const blob = doc.output("blob");
  const { error } = await supabase.storage.from("flha-reports").upload(filename, blob, { contentType: "application/pdf", upsert: false });
  if (error) { console.error("inspection pdf upload failed", error.message); return null; }
  const { data } = supabase.storage.from("flha-reports").getPublicUrl(filename);
  return data?.publicUrl || null;
}
