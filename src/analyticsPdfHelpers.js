// analyticsPdfHelpers.js
// Shared jsPDF drawing helpers for the Safety and Equipment analytics PDF
// exports. Both PDFs render the same handful of shapes (stat tiles, ranked
// bar lists, simple tables) against the same page geometry, so those are
// kept here once instead of duplicated across the two generator files.

import { getForaLogoDataUrl } from "./foraLogo.js";

export function loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => resolve(window.jspdf.jsPDF);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export const PAGE = { W: 210, H: 297, margin: 16 };

export async function loadLogoDataUrl(companyLogo) {
  if (!companyLogo) return null;
  try {
    const resp = await fetch(companyLogo, { mode: "cors" });
    const blob = await resp.blob();
    return await new Promise((res, rej) => {
      const r = new FileReader();
      r.onloadend = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  }
}

export function drawBanner(doc, { title, subtitle, color, logoDataUrl }) {
  const { W, margin } = PAGE;
  doc.setFillColor(...color); doc.rect(0, 0, W, 30, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text(title, margin, 13);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(subtitle, margin, 20);
  if (logoDataUrl) {
    try {
      const fmt = logoDataUrl.includes("image/png") ? "PNG" : "JPEG";
      doc.addImage(logoDataUrl, fmt, W - margin - 20, 5, 20, 20);
    } catch (e) { /* bad/unreachable logo image — skip it, rest of the PDF still renders */ }
  }
  return 40;
}

// 3-across grid of small stat boxes, wrapping to further rows as needed.
export function drawStatTiles(doc, y, tiles, defaultColor) {
  const { margin, W } = PAGE;
  const contentW = W - margin * 2;
  const cols = 3, gap = 4, tileH = 20;
  const tileW = (contentW - gap * (cols - 1)) / cols;
  tiles.forEach((t, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = margin + col * (tileW + gap);
    const ty = y + row * (tileH + gap);
    const color = t.color || defaultColor;
    doc.setFillColor(248, 250, 252); doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3);
    doc.roundedRect(x, ty, tileW, tileH, 2, 2, "FD");
    doc.setFillColor(...color); doc.rect(x, ty, 1.4, tileH, "F");
    doc.setTextColor(...color); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text(String(t.value), x + 6, ty + 10);
    doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "bold"); doc.setFontSize(6.5);
    doc.text((t.label || "").toUpperCase(), x + 6, ty + 16, { maxWidth: tileW - 10 });
  });
  const rows = Math.ceil(tiles.length / cols);
  return y + rows * (tileH + gap) + 4;
}

export function drawSectionTitle(doc, y, title, subtitle, color) {
  const { margin } = PAGE;
  doc.setTextColor(...color); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text(title, margin, y);
  y += 5.5;
  if (subtitle) {
    doc.setTextColor(107, 114, 128); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.text(subtitle, margin, y);
    y += 6;
  } else {
    y += 2;
  }
  return y;
}

export function drawBarList(doc, y, items, { emptyLabel = "Not enough data yet.", barColor = [30, 58, 95] } = {}) {
  const { margin, W } = PAGE;
  const contentW = W - margin * 2;
  const hasData = items.some(it => it.count > 0);
  if (!hasData) {
    doc.setTextColor(156, 163, 175); doc.setFont("helvetica", "italic"); doc.setFontSize(9);
    doc.text(emptyLabel, margin, y);
    return y + 8;
  }
  const max = Math.max(...items.map(it => it.count), 1);
  items.forEach(it => {
    doc.setTextColor(51, 65, 85); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text(it.label, margin, y);
    doc.setTextColor(107, 114, 128);
    doc.text(String(it.count), margin + contentW, y, { align: "right" });
    y += 2;
    doc.setFillColor(241, 245, 249); doc.rect(margin, y, contentW, 2.6, "F");
    const w = it.count > 0 ? Math.max((it.count / max) * contentW, 3) : 0;
    doc.setFillColor(...(it.color || barColor));
    doc.rect(margin, y, w, 2.6, "F");
    y += 6.5;
  });
  return y + 2;
}

// `redrawHeader` (optional): called after a mid-table page break to redraw
// the banner on the new page, returning the y position to resume at.
export function drawTable(doc, y, { columns, rows, emptyLabel = "Not enough data yet." }, redrawHeader) {
  const { margin, W, H } = PAGE;
  const contentW = W - margin * 2;
  if (!rows || rows.length === 0) {
    doc.setTextColor(156, 163, 175); doc.setFont("helvetica", "italic"); doc.setFontSize(9);
    doc.text(emptyLabel, margin, y);
    return y + 8;
  }
  const colWidths = columns.map(c => c.width || contentW / columns.length);
  const colX = [];
  let acc = margin;
  colWidths.forEach(w => { colX.push(acc); acc += w; });

  const drawHead = (yy) => {
    doc.setFillColor(241, 245, 249); doc.rect(margin, yy, contentW, 6.5, "F");
    doc.setTextColor(71, 85, 105); doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
    columns.forEach((c, i) => {
      const x = c.align === "right" ? colX[i] + colWidths[i] - 2 : colX[i] + 2;
      doc.text((c.label || "").toUpperCase(), x, yy + 4.5, c.align === "right" ? { align: "right" } : undefined);
    });
    return yy + 6.5;
  };

  y = drawHead(y);
  rows.forEach((row, ri) => {
    if (y + 7 > H - 20) {
      doc.addPage();
      y = redrawHeader ? redrawHeader() : 20;
      y = drawHead(y);
    }
    if (ri % 2 === 1) { doc.setFillColor(248, 250, 252); doc.rect(margin, y, contentW, 7, "F"); }
    doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    columns.forEach((c, i) => {
      const val = c.render ? c.render(row) : (row[c.key] ?? "—");
      const x = c.align === "right" ? colX[i] + colWidths[i] - 2 : colX[i] + 2;
      doc.text(String(val), x, y + 5, c.align === "right" ? { align: "right" } : undefined);
    });
    y += 7;
  });
  return y + 4;
}

export async function drawFooter(doc, brandColor = [30, 58, 95]) {
  const { margin, W, H } = PAGE;
  const foraLogo = await getForaLogoDataUrl();
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(margin, H - 12, W - margin, H - 12);
    if (foraLogo) {
      try { doc.addImage(foraLogo, "PNG", margin, H - 10, 16, 6.55); } catch (e) {}
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
      doc.text("AI-generated field safety documentation", margin + 19, H - 7);
    } else {
      doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...brandColor);
      doc.text("FORA", margin, H - 7);
      doc.setFont("helvetica", "normal"); doc.setTextColor(148, 163, 184);
      doc.text("AI-generated field safety documentation", margin + 11, H - 7);
    }
    doc.text(`Page ${p} of ${pageCount}`, W - margin, H - 7, { align: "right" });
  }
}

export function pdfFilename(prefix, companyName) {
  const ts = new Date().toISOString().slice(0, 10);
  return `${prefix}_${companyName || "co"}_${ts}.pdf`.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-.]/g, "");
}
