// generateRosterPinsPDF.js
// Renders a just-regenerated batch of roster PINs to a PDF the browser
// downloads directly. Deliberately never uploaded anywhere — PINs are
// stored as one-way hashes, so this plaintext list only ever exists for
// the moment it's generated, same "shown once" rule as everywhere else.

import { getForaLogoDataUrl } from "./foraLogo.js";

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

export async function generateRosterPinsPDF({ companyName, companyCode, roster }) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, margin = 16, contentW = W - margin * 2;
  let y = 20;

  doc.setFillColor(217, 119, 6); doc.rect(0, 0, W, 30, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text("Roster Login PINs", margin, 13);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(new Date().toLocaleDateString("en-CA"), margin, 20);
  y = 40;

  doc.setFillColor(255, 251, 235); doc.roundedRect(margin, y, contentW, 24, 3, 3, "F");
  doc.setTextColor(217, 119, 6); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  doc.text("COMPANY", margin + 4, y + 6);
  doc.setTextColor(30, 41, 59); doc.setFontSize(11); doc.setFont("helvetica", "normal");
  doc.text(companyName || "—", margin + 4, y + 12);
  doc.setTextColor(217, 119, 6); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  doc.text("COMPANY CODE", margin + 4, y + 18);
  doc.setTextColor(30, 41, 59); doc.setFontSize(11); doc.setFont("helvetica", "bold");
  doc.text(companyCode || "—", margin + 44, y + 18);
  y += 32;

  doc.setTextColor(153, 27, 27); doc.setFontSize(9); doc.setFont("helvetica", "bold");
  y = (() => {
    const lines = doc.splitTextToSize(
      "Every PIN below was just regenerated and replaces each person's previous PIN immediately. This is the only copy — distribute it now and store it somewhere secure.",
      contentW
    );
    lines.forEach(line => { doc.text(line, margin, y); y += 4.6; });
    return y + 4;
  })();

  const cNameX = margin, cNameW = 80;
  const cRoleX = cNameX + cNameW, cRoleW = 34;
  const cPinX = cRoleX + cRoleW, cPinW = contentW - cNameW - cRoleW;

  const drawHeader = () => {
    doc.setFillColor(217, 119, 6); doc.rect(margin, y, contentW, 8, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.text("NAME", cNameX + 2, y + 5.5);
    doc.text("ROLE", cRoleX + 2, y + 5.5);
    doc.text("PIN", cPinX + 2, y + 5.5);
    y += 8;
  };

  drawHeader();
  (roster || []).forEach((m, i) => {
    if (y + 9 > 280) { doc.addPage(); y = 20; drawHeader(); }
    const zebra = i % 2 === 1;
    doc.setFillColor(...(zebra ? [255, 251, 235] : [255, 255, 255]));
    doc.rect(margin, y, contentW, 9, "F");
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.15);
    doc.rect(margin, y, contentW, 9, "S");

    const textY = y + 6;
    doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text(m.name, cNameX + 2, textY);
    doc.setFont("helvetica", "normal"); doc.setTextColor(55, 65, 81);
    doc.text(m.role, cRoleX + 2, textY);
    doc.setFont("helvetica", "bold"); doc.setTextColor(217, 119, 6); doc.setFontSize(11);
    doc.text(m.pin, cPinX + 2, textY);
    y += 9;
  });

  const foraLogo = await getForaLogoDataUrl();
  const H = 297; const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(margin, H - 12, W - margin, H - 12);
    if (foraLogo) {
      try { doc.addImage(foraLogo, "PNG", margin, H - 10, 16, 6.55); } catch (e) {}
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
      doc.text("AI-generated field safety documentation", margin + 19, H - 7);
    } else {
      doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(217, 119, 6);
      doc.text("FORA", margin, H - 7);
      doc.setFont("helvetica", "normal"); doc.setTextColor(148, 163, 184);
      doc.text("AI-generated field safety documentation", margin + 11, H - 7);
    }
    doc.text(`Page ${p} of ${pageCount}`, W - margin, H - 6.5, { align: "right" });
  }

  const filename = `ROSTER_PINS_${companyName || "co"}_${new Date().toISOString().slice(0, 10)}.pdf`.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-.]/g, "");
  doc.save(filename);
}
