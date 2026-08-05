// server-lib/reportPdfs.js
// Server-side (Node) rendering for the two report PDFs that used to be
// generated in the browser and uploaded with the anon key. Same jsPDF
// drawing calls as their old src/generate*PDF.js counterparts — jsPDF runs
// fine headlessly in Node, so this just swaps the CDN-loaded browser build
// for the npm package and drops the DOM-only bits (FileReader, <script>
// injection). Lives outside api/ on purpose: Vercel only turns files
// directly under api/ into functions, and this is imported by two of them.

import { jsPDF } from 'jspdf';

function wrap(doc, text, x, y, maxW, lh, limit = 276) {
  const lines = doc.splitTextToSize(text || '', maxW);
  lines.forEach(line => { if (y > limit) { doc.addPage(); y = 20; } doc.text(line, x, y); y += lh; });
  return y;
}

async function fetchLogoDataUrl(url) {
  if (!url) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    const contentType = resp.headers.get('content-type') || 'image/png';
    return `data:${contentType};base64,${buf.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

export async function renderEquipmentReportPdf({ report, companyName, companyLogo }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, margin = 16, contentW = W - margin * 2;
  let y = 20;

  const logoDataUrl = await fetchLogoDataUrl(companyLogo);

  const rj = report.report_json || {};
  const equipment = rj.equipment || [];

  // header
  doc.setFillColor(3, 105, 161); doc.rect(0, 0, W, 30, 'F');
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text('Weekly Equipment Usage Report', margin, 13);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(`${rj.weekStart} to ${rj.weekEnd}`, margin, 20);
  if (logoDataUrl) { try { const fmt = logoDataUrl.includes('image/png') ? 'PNG' : 'JPEG'; doc.addImage(logoDataUrl, fmt, W - margin - 20, 5, 20, 20); } catch (e) {} }
  y = 40;

  // company box
  doc.setFillColor(240, 249, 255); doc.roundedRect(margin, y, contentW, 16, 3, 3, 'F');
  doc.setTextColor(3, 105, 161); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  doc.text('COMPANY', margin + 4, y + 6);
  doc.setTextColor(30, 41, 59); doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text(companyName || '—', margin + 4, y + 12);
  y += 24;

  if (equipment.length === 0) {
    doc.setTextColor(100, 116, 139); doc.setFontSize(11);
    doc.text('No equipment activity recorded this week.', margin, y);
  }

  const cLabelX = margin, cLabelW = 60;
  const cUsageX = cLabelX + cLabelW, cUsageW = 34;
  const cEndX = cUsageX + cUsageW, cEndW = 34;
  const cIssuesX = cEndX + cEndW, cIssuesW = contentW - cLabelW - cUsageW - cEndW;

  const drawHeader = () => {
    doc.setFillColor(3, 105, 161); doc.rect(margin, y, contentW, 8, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text('EQUIPMENT', cLabelX + 2, y + 5.5);
    doc.text('USED THIS WK', cUsageX + 2, y + 5.5);
    doc.text('ENDING READING', cEndX + 2, y + 5.5);
    doc.text('OUTSTANDING ISSUES', cIssuesX + 2, y + 5.5);
    y += 8;
  };

  if (equipment.length > 0) {
    drawHeader();
    equipment.forEach((eq, i) => {
      const issueLines = eq.issues.length > 0
        ? eq.issues.map(iss => `${iss.type}: ${iss.note}`)
        : (eq.noPostTripCount > 0 ? ['Currently checked out (no post-trip logged)'] : ['None']);
      const wrappedIssues = issueLines.flatMap(line => doc.splitTextToSize(line, cIssuesW - 4));

      // Trailers report no reading of their own — their usage is whatever
      // towed them. Group this week's trips by tow unit rather than listing
      // every individual trip, so a trailer moved several times by the same
      // truck gets one summed line instead of one per trip.
      let usageLines;
      if (eq.attachments && eq.attachments.length > 0) {
        const byTow = {};
        eq.attachments.forEach(a => {
          if (!byTow[a.towUnit]) byTow[a.towUnit] = { distance: 0, unit: a.unit };
          byTow[a.towUnit].distance += a.distance;
        });
        const rawLines = Object.entries(byTow).map(([towUnit, v]) => `Attached to ${towUnit} for ${v.distance.toFixed(1)} ${v.unit}`);
        usageLines = rawLines.flatMap(line => doc.splitTextToSize(line, cUsageW - 4));
      } else {
        usageLines = [eq.usage > 0 ? `${eq.usage.toFixed(1)} ${eq.unit || ''}` : '—'];
      }

      const rowH = Math.max(9, Math.max(wrappedIssues.length, usageLines.length) * 4.2 + 3);

      if (y + rowH > 280) { doc.addPage(); y = 20; drawHeader(); }

      const zebra = i % 2 === 1;
      doc.setFillColor(...(zebra ? [248, 250, 252] : [255, 255, 255]));
      doc.rect(margin, y, contentW, rowH, 'F');
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.15);
      doc.rect(margin, y, contentW, rowH, 'S');

      const textY = y + 5;
      doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      const labelLines = doc.splitTextToSize(eq.equipmentLabel, cLabelW - 4);
      labelLines.forEach((line, li) => doc.text(line, cLabelX + 2, textY + li * 4.2));

      doc.setFont('helvetica', 'normal'); doc.setTextColor(55, 65, 81);
      usageLines.forEach((line, li) => doc.text(line, cUsageX + 2, textY + li * 4.2));
      doc.text(eq.endingReading != null ? `${eq.endingReading} ${eq.unit || ''}` : '—', cEndX + 2, textY);

      const hasIssues = eq.issues.length > 0;
      doc.setTextColor(hasIssues ? 220 : 100, hasIssues ? 38 : 116, hasIssues ? 38 : 139);
      wrappedIssues.forEach((line, li) => doc.text(line, cIssuesX + 2, textY + li * 4.2));

      y += rowH;
    });
    y += 6;
  }

  const H = 297; const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(margin, H - 12, W - margin, H - 12);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(3, 105, 161);
    doc.text('FORA', margin, H - 7);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(148, 163, 184);
    doc.text('AI-generated field safety documentation', margin + 11, H - 7);
    doc.text(`Page ${p} of ${pageCount}`, W - margin, H - 6.5, { align: 'right' });
  }

  return Buffer.from(doc.output('arraybuffer'));
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
}

export async function renderTimeClockReportPdf({ report, companyName, companyLogo }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, margin = 16, contentW = W - margin * 2;
  let y = 20;

  const logoDataUrl = await fetchLogoDataUrl(companyLogo);

  const rj = report.report_json || {};
  const entries = rj.entries || [];
  const grandTotal = entries.reduce((sum, p) => sum + (p.totalHours || 0), 0);

  doc.setFillColor(8, 145, 178); doc.rect(0, 0, W, 30, 'F');
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text('Weekly Time Clock Report', margin, 13);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(`${rj.weekStart} to ${rj.weekEnd}`, margin, 20);
  if (logoDataUrl) { try { const fmt = logoDataUrl.includes('image/png') ? 'PNG' : 'JPEG'; doc.addImage(logoDataUrl, fmt, W - margin - 20, 5, 20, 20); } catch (e) {} }
  y = 40;

  doc.setFillColor(236, 254, 255); doc.roundedRect(margin, y, contentW, 16, 3, 3, 'F');
  doc.setTextColor(8, 145, 178); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  doc.text('COMPANY', margin + 4, y + 6);
  doc.setTextColor(30, 41, 59); doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text(companyName || '—', margin + 4, y + 12);
  doc.setTextColor(8, 145, 178); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  doc.text('TOTAL HOURS', margin + contentW - 45, y + 6);
  doc.setTextColor(30, 41, 59); doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text(grandTotal.toFixed(1), margin + contentW - 45, y + 12);
  y += 24;

  if (entries.length === 0) {
    doc.setTextColor(100, 116, 139); doc.setFontSize(11);
    doc.text('No time clock activity recorded this week.', margin, y);
  }

  const cDateX = margin, cDateW = 42;
  const cInX = cDateX + cDateW, cInW = 26;
  const cOutX = cInX + cInW, cOutW = 26;
  const cHoursX = cOutX + cOutW, cHoursW = 24;
  const cEditedX = cHoursX + cHoursW, cEditedW = contentW - cDateW - cInW - cOutW - cHoursW;

  const drawColumnHeader = () => {
    doc.setFillColor(8, 145, 178); doc.rect(margin, y, contentW, 7, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    doc.text('DATE', cDateX + 2, y + 5);
    doc.text('IN', cInX + 2, y + 5);
    doc.text('OUT', cOutX + 2, y + 5);
    doc.text('HOURS', cHoursX + 2, y + 5);
    doc.text('EDITED', cEditedX + 2, y + 5);
    y += 7;
  };

  const drawPersonHeader = (person) => {
    if (y + 10 > 280) { doc.addPage(); y = 20; }
    doc.setFillColor(224, 247, 250); doc.rect(margin, y, contentW, 8, 'F');
    doc.setTextColor(14, 116, 144); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    doc.text(`${person.name}  (${person.role})`, margin + 2, y + 5.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
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
      doc.rect(margin, y, contentW, rowH, 'F');
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.15);
      doc.rect(margin, y, contentW, rowH, 'S');

      const textY = y + 4.7;
      doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(fmtDate(d.date), cDateX + 2, textY);
      doc.text(fmtTime(d.clockIn), cInX + 2, textY);
      doc.text(d.openAtReportTime ? 'still open' : fmtTime(d.clockOut), cOutX + 2, textY);
      doc.text(d.hours != null ? d.hours.toFixed(2) : '—', cHoursX + 2, textY);
      doc.setTextColor(d.edited ? 217 : 148, d.edited ? 119 : 163, d.edited ? 6 : 184);
      doc.text(d.edited ? 'Yes' : '—', cEditedX + 2, textY);
      y += rowH;
    });
    y += 4;
  });

  const H = 297; const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); doc.line(margin, H - 12, W - margin, H - 12);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(8, 145, 178);
    doc.text('FORA', margin, H - 7);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(148, 163, 184);
    doc.text('AI-generated field safety documentation', margin + 11, H - 7);
    doc.text(`Page ${p} of ${pageCount}`, W - margin, H - 6.5, { align: 'right' });
  }

  return Buffer.from(doc.output('arraybuffer'));
}

export function equipmentReportFilename({ companyName, report }) {
  const rj = report.report_json || {};
  return `EQUIPMENT_${companyName || 'co'}_${rj.weekStart}_${report.id}.pdf`.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-.]/g, '');
}

export function timeClockReportFilename({ companyName, report }) {
  const rj = report.report_json || {};
  return `TIMECLOCK_${companyName || 'co'}_${rj.weekStart}_${report.id}.pdf`.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-.]/g, '');
}
