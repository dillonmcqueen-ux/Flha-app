import { uploadViaSignedUrl } from "./uploadViaSignedUrl.js";
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

const CHECK_COLS = [
  { key: "Good", label: "G", color: [22, 163, 74] },
  { key: "Monitor", label: "M", color: [217, 119, 6] },
  { key: "Defective", label: "D", color: [220, 38, 38] },
];
const BOX = 4, PITCH = 7; // mm — checkbox size and spacing between the three boxes

// Compact one-line-per-item checklist: item name on the left, a small
// Good/Monitor/Defective checkbox trio on the right (the matching box is
// filled). Deliberately carries no notes — those go in the deficiencies
// section below so every row stays a single line.
function drawChecklistCompact(doc, items, { margin, contentW, y, W }) {
  const trioW = BOX + PITCH * 2 + 4; // total width reserved for the 3 boxes + labels
  const textMaxW = contentW - trioW - 6;
  const boxesRightEdge = W - margin;
  const boxX = (colIdx) => boxesRightEdge - BOX - (2 - colIdx) * PITCH;

  // legend header
  doc.setFontSize(6.5); doc.setFont("helvetica", "bold"); doc.setTextColor(148, 163, 184);
  CHECK_COLS.forEach((c, i) => doc.text(c.label, boxX(i) + BOX / 2, y, { align: "center" }));
  y += 4;

  let lastCategory = null;
  let lastUnit = null;
  items.forEach((it) => {
    if (y > 270) { doc.addPage(); y = 20; }
    // A trailer attached to a tow unit gets its own checklist appended,
    // tagged by unit — call that out with its own banner so a reader can't
    // mistake a trailer defect for a defect on the tow vehicle, or vice
    // versa, the same way the on-screen checklist separates them.
    if (it.unit && it.unit !== lastUnit) {
      if (y > 265) { doc.addPage(); y = 20; }
      const isTrailer = it.unit === "trailer";
      doc.setFillColor(...(isTrailer ? [237, 233, 254] : [219, 234, 254]));
      doc.roundedRect(margin, y - 4, contentW, 7, 1.5, 1.5, "F");
      doc.setFontSize(8.5); doc.setFont("helvetica", "bold");
      doc.setTextColor(...(isTrailer ? [91, 33, 182] : [30, 64, 175]));
      doc.text(`${isTrailer ? "TRAILER" : "TRUCK / TOW VEHICLE"}${it.unitLabel ? ` — ${it.unitLabel}` : ""}`, margin + 3, y);
      y += 6.5;
      lastUnit = it.unit;
      lastCategory = null; // force the category header to redraw under the new unit
    }
    if (it.category && it.category !== lastCategory) {
      doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(148, 163, 184);
      doc.text(it.category.toUpperCase(), margin, y);
      y += 4.5;
      lastCategory = it.category;
    }

    doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(it.item, textMaxW);
    doc.text(lines[0], margin + 1, y);

    CHECK_COLS.forEach((c, i) => {
      const bx = boxX(i);
      const checked = it.condition === c.key;
      doc.setDrawColor(...(checked ? c.color : [203, 213, 225]));
      doc.setLineWidth(checked ? 0.6 : 0.3);
      if (checked) doc.setFillColor(...c.color);
      doc.rect(bx, y - BOX + 1, BOX, BOX, checked ? "FD" : "S");
      if (checked) {
        // Drawn checkmark, not a text glyph — jsPDF's base Helvetica font
        // has no ✓ in its encoding and silently drops it.
        doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.6);
        const cx = bx + BOX / 2, cy = y - BOX / 2 + 1;
        doc.line(bx + 0.8, cy, cx - 0.2, cy + 1.3);
        doc.line(cx - 0.2, cy + 1.3, bx + BOX - 0.8, cy - 1.4);
      }
    });

    doc.setDrawColor(241, 245, 249); doc.setLineWidth(0.15);
    doc.line(margin, y + 1.8, W - margin, y + 1.8);
    y += 6.3;
  });

  return y;
}

// Every Monitor/Defective item, spelled out with its note — the one place
// on the PDF a supervisor needs to actually read closely.
function drawDeficienciesSection(doc, items, { margin, contentW, y, W }) {
  const flagged = (items || []).filter(it => it.condition === "Defective" || it.condition === "Monitor");

  if (y > 250) { doc.addPage(); y = 20; }
  doc.setFontSize(9); doc.setFont("helvetica", "bold");
  doc.setTextColor(51, 65, 85);
  doc.text("DEFICIENCIES & ITEMS TO MONITOR", margin, y);
  y += 6;

  if (flagged.length === 0) {
    doc.setFillColor(240, 253, 244); doc.setDrawColor(134, 239, 172);
    doc.roundedRect(margin, y, contentW, 10, 2, 2, "FD");
    doc.setTextColor(22, 101, 52); doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text("None — all items Good", margin + 4, y + 6.5);
    return y + 16;
  }

  // A trailer's deficiencies must never read as the tow vehicle's (or vice
  // versa), so group by unit when items carry that tag — a plain,
  // non-combined inspection (no unit tags at all) renders exactly as before.
  const anyUnitTagged = flagged.some(it => it.unit);
  const groups = anyUnitTagged
    ? [...new Set(flagged.map(it => it.unit || "—"))].map(u => ({ unit: u, list: flagged.filter(it => (it.unit || "—") === u) }))
    : [{ unit: null, list: flagged }];

  groups.forEach(({ unit, list }) => {
    if (unit) {
      if (y > 270) { doc.addPage(); y = 20; }
      const isTrailer = unit === "trailer";
      doc.setFontSize(7.5); doc.setFont("helvetica", "bold");
      doc.setTextColor(...(isTrailer ? [91, 33, 182] : [30, 64, 175]));
      doc.text(`${isTrailer ? "TRAILER" : "TRUCK / TOW VEHICLE"}${list[0]?.unitLabel ? ` — ${list[0].unitLabel}` : ""}`, margin, y);
      y += 5;
    }
    list
      .sort((a, b) => (a.condition === "Defective" ? 0 : 1) - (b.condition === "Defective" ? 0 : 1))
      .forEach((it) => {
        const isDef = it.condition === "Defective";
        const col = isDef ? [220, 38, 38] : [217, 119, 6];
        const bg = isDef ? [254, 242, 242] : [255, 251, 235];
        const border = isDef ? [252, 165, 165] : [252, 211, 77];
        const noteLines = doc.splitTextToSize(it.note || "No note provided.", contentW - 10);
        const boxH = 9 + noteLines.length * 4.2;
        if (y + boxH > 280) { doc.addPage(); y = 20; }

        doc.setFillColor(...bg); doc.setDrawColor(...border); doc.setLineWidth(0.4);
        doc.roundedRect(margin, y, contentW, boxH, 1.5, 1.5, "FD");
        doc.setTextColor(...col); doc.setFontSize(8.5); doc.setFont("helvetica", "bold");
        doc.text(`${isDef ? "DEFECTIVE" : "MONITOR"} — ${it.item}`, margin + 3, y + 5.5, { maxWidth: contentW - 6 });
        doc.setTextColor(71, 85, 105); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
        doc.text(noteLines, margin + 3, y + 10);
        y += boxH + 3;
      });
  });

  return y + 3;
}

function drawInfoBox(doc, { margin, contentW, y, W, rows }) {
  const rowH = 16;
  doc.setFillColor(240, 249, 255);
  doc.roundedRect(margin, y, contentW, rowH * rows.length, 3, 3, "F");
  rows.forEach((cols, ri) => {
    const ry = y + ri * rowH;
    const colW = contentW / cols.length;
    cols.forEach((c, ci) => {
      const cx = margin + ci * colW;
      doc.setTextColor(3, 105, 161); doc.setFontSize(7.5); doc.setFont("helvetica", "bold");
      doc.text(c.label, cx + 4, ry + 6);
      doc.setTextColor(30, 41, 59); doc.setFontSize(9.5); doc.setFont("helvetica", "normal");
      doc.text(c.value || "—", cx + 4, ry + 13, { maxWidth: colW - 6 });
    });
  });
  return y + rowH * rows.length + 8;
}

export async function generateAndUploadInspection({
  equipmentLabel, workerName, companyName, companyLogo, results, signatureDataUrl,
  tripType = "pretrip", startReading, endReading, readingUnit, hasChanges, changeCondition, changeNotes, linkedPretrip, token,
}) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, margin = 16, contentW = W - margin * 2;
  let y = 20;

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
  const pretripItems = isPost ? (linkedPretrip?.results_json?.items || []) : [];
  const attachedTrailerLabel = isPost
    ? linkedPretrip?.results_json?.attachedTrailer?.label
    : results?.attachedTrailer?.label;

  // header
  doc.setFillColor(12, 74, 110); doc.rect(0, 0, W, 30, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text(isPost ? "Pre-Trip & Post-Trip Inspection" : "Pre-Trip Inspection", margin, 13);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(isPost ? "Complete inspection record" : "Pre-use machine inspection", margin, 20);
  if (logoDataUrl) { try { doc.addImage(logoDataUrl, "PNG", W - margin - 20, 5, 20, 20); } catch (e) {} doc.setFontSize(7); doc.text(new Date().toLocaleDateString("en-CA"), W - margin, 28, { align: "right" }); }
  else doc.text(new Date().toLocaleString("en-CA"), W - margin, 13, { align: "right" });
  y = 40;

  // info box
  if (isPost) {
    y = drawInfoBox(doc, {
      margin, contentW, y, W,
      rows: [
        attachedTrailerLabel
          ? [{ label: "TOW VEHICLE", value: equipmentLabel }, { label: "TRAILER", value: attachedTrailerLabel }, { label: "COMPANY", value: companyName }]
          : [{ label: "MACHINE", value: equipmentLabel }, { label: "COMPANY", value: companyName }],
        [
          { label: "PRE-TRIP INSPECTOR", value: linkedPretrip ? `${linkedPretrip.worker_name || "—"} · ${linkedPretrip.created_at ? new Date(linkedPretrip.created_at).toLocaleString("en-CA", { dateStyle: "short", timeStyle: "short" }) : ""}` : "—" },
          { label: "POST-TRIP TECHNICIAN", value: `${workerName || "—"} · ${new Date().toLocaleString("en-CA", { dateStyle: "short", timeStyle: "short" })}` },
        ],
      ],
    });
  } else {
    y = drawInfoBox(doc, {
      margin, contentW, y, W,
      rows: attachedTrailerLabel
        ? [
            [{ label: "TOW VEHICLE", value: equipmentLabel }, { label: "TRAILER", value: attachedTrailerLabel }],
            [{ label: "COMPANY", value: companyName }, { label: "INSPECTOR", value: workerName }],
          ]
        : [[{ label: "MACHINE", value: equipmentLabel }, { label: "COMPANY", value: companyName }, { label: "INSPECTOR", value: workerName }]],
    });
  }

  // readings box
  doc.setFillColor(249, 250, 251); doc.roundedRect(margin, y, contentW, 20, 3, 3, "F");
  doc.setTextColor(71, 85, 105); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  if (isPost) {
    doc.text("STARTING READING", margin + 4, y + 7); doc.text("ENDING READING", margin + 90, y + 7);
    doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`${(linkedPretrip?.start_reading ?? startReading) || "—"} ${readingUnit || ""}`, margin + 4, y + 15);
    doc.text(`${endReading || "—"} ${readingUnit || ""}`, margin + 90, y + 15);
  } else {
    doc.text("STARTING READING", margin + 4, y + 7);
    doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`${startReading || "—"} ${readingUnit || ""}`, margin + 4, y + 15);
  }
  y += 28;

  if (isPost) {
    // ── PRE-TRIP section, reproduced in full so this one PDF is the whole story ──
    doc.setFillColor(219, 234, 254); doc.roundedRect(margin, y, contentW, 7, 1.5, 1.5, "F");
    doc.setTextColor(30, 64, 175); doc.setFontSize(8.5); doc.setFont("helvetica", "bold");
    doc.text("PRE-TRIP CHECKLIST", margin + 3, y + 5);
    y += 11;

    if (pretripItems.length > 0) {
      y = drawCustomFieldsPDF(doc, linkedPretrip?.results_json?.customFields, { margin, contentW, y, accent: [3, 105, 161] });
      y = drawChecklistCompact(doc, pretripItems, { margin, contentW, y, W });
      y = drawDeficienciesSection(doc, pretripItems, { margin, contentW, y, W });
    } else {
      doc.setFontSize(9); doc.setTextColor(148, 163, 184); doc.setFont("helvetica", "italic");
      doc.text("Pre-trip checklist not available.", margin, y);
      y += 10;
    }

    // pre-trip signature — text-only confirmation (the signature image lives
    // only on the pre-trip's own PDF, generated at the time it was signed)
    if (y > 265) { doc.addPage(); y = 20; }
    doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3); doc.line(margin, y, W - margin, y); y += 6;
    doc.setTextColor(100, 116, 139); doc.setFontSize(8); doc.setFont("helvetica", "italic");
    doc.text(`Pre-Trip signed by ${linkedPretrip?.worker_name || "—"} — see the original Pre-Trip record for the signature image.`, margin, y);
    y += 10;

    // ── POST-TRIP section ──────────────────────────────────────────────
    doc.setFillColor(237, 233, 254); doc.roundedRect(margin, y, contentW, 7, 1.5, 1.5, "F");
    doc.setTextColor(91, 33, 182); doc.setFontSize(8.5); doc.setFont("helvetica", "bold");
    doc.text("POST-TRIP — CHANGES SINCE PRE-TRIP", margin + 3, y + 5);
    y += 11;

    if (!hasChanges) {
      doc.setFillColor(240, 253, 244); doc.setDrawColor(134, 239, 172);
      doc.roundedRect(margin, y, contentW, 12, 2, 2, "FD");
      doc.setTextColor(22, 101, 52); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
      doc.text("No changes reported since Pre-Trip", margin + 4, y + 7.5);
      y += 20;
    } else {
      const isDef = changeCondition === "Defective";
      const col = isDef ? [220, 38, 38] : [217, 119, 6];
      doc.setFillColor(...(isDef ? [254, 242, 242] : [255, 251, 235]));
      doc.setDrawColor(...col);
      const notesLines = doc.splitTextToSize(changeNotes || "—", contentW - 8);
      const boxH = 14 + notesLines.length * 4.5;
      doc.roundedRect(margin, y, contentW, boxH, 2, 2, "FD");
      doc.setTextColor(...col); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
      doc.text(`CHANGE REPORTED — ${(changeCondition || "").toUpperCase()}`, margin + 4, y + 7);
      doc.setFont("helvetica", "normal"); doc.setTextColor(51, 65, 85); doc.setFontSize(8.5);
      doc.text(notesLines, margin + 4, y + 13);
      y += boxH + 6;
    }
  } else {
    // ── Pre-trip-only PDF (no post-trip yet) ─────────────────────────────
    y = drawCustomFieldsPDF(doc, results?.customFields, { margin, contentW, y, accent: [3, 105, 161] });
    const items = results?.items || [];
    y = drawChecklistCompact(doc, items, { margin, contentW, y, W });
    y = drawDeficienciesSection(doc, items, { margin, contentW, y, W });
  }

  // signature (post-trip technician, or pre-trip inspector when there's no post-trip yet)
  if (y > 235) { doc.addPage(); y = 20; }
  y += 4; doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3); doc.line(margin, y, W - margin, y); y += 8;
  doc.setTextColor(30, 41, 59); doc.setFontSize(9); doc.setFont("helvetica", "bold");
  doc.text(isPost ? "Post-Trip Technician Signature" : "Inspector Signature", margin, y); y += 4;
  if (signatureDataUrl) { try { doc.addImage(signatureDataUrl, "PNG", margin, y, 70, 21); } catch (e) {} }
  doc.setDrawColor(150, 150, 150); doc.line(margin, y + 23, margin + 70, y + 23);
  doc.setTextColor(100, 116, 139); doc.setFontSize(8); doc.setFont("helvetica", "normal");
  doc.text(`Printed name: ${workerName}`, margin, y + 29);
  doc.text(`Date: ${new Date().toLocaleString("en-CA")}`, W - margin, y + 29, { align: "right" });

  // upload
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `INSPECTION_${isPost ? "POST" : "PRE"}_${companyName || "co"}_${workerName || "w"}_${ts}.pdf`.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-.]/g, "");
  const blob = doc.output("blob");
  try {
    const { publicUrl } = await uploadViaSignedUrl({
      endpoint: "/api/logs", action: "create_upload_url", token,
      bucket: "flha-reports", filename, file: blob, contentType: "application/pdf",
    });
    return publicUrl || null;
  } catch (e) {
    console.error("inspection pdf upload failed", e.message);
    return null;
  }
}
