// server-lib/gatehousePdf.js
// Server-side (Node) rendering for Gatehouse's daily station report —
// same jsPDF approach as server-lib/reportPdfs.js's other report PDFs.
// Lives outside api/ on purpose: Vercel only turns files directly under
// api/ into functions, and this is imported by api/gatehouse.js.

import { jsPDF } from 'jspdf';

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

// `report` is the shape built by buildDailyReport() in api/gatehouse.js:
// { companyName, stationName, businessDate, transactions, redirectedCount,
//   totalsByTier, cashTotal, chequeTotal, grandTotal, reconciliation }
export function renderGatehouseDailyReportPdf(report) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, margin = 16, contentW = W - margin * 2;
  let y = 20;

  doc.setFillColor(196, 118, 31); doc.rect(0, 0, W, 28, 'F');
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text('Gatehouse — Daily Station Report', margin, 13);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(`${report.stationName} — ${report.businessDate}`, margin, 21);
  y = 38;

  doc.setFillColor(246, 247, 243); doc.roundedRect(margin, y, contentW, 16, 2, 2, 'F');
  doc.setTextColor(87, 101, 95); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  doc.text('COUNTY / OPERATION', margin + 4, y + 6);
  doc.setTextColor(24, 36, 32); doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text(report.companyName || '—', margin + 4, y + 12);
  y += 24;

  // ── Summary tiles ──────────────────────────────────────────────────────
  const tileW = (contentW - 12) / 4;
  const tiles = [
    ['Loads logged', String(report.transactions.length)],
    ['Redirected', String(report.redirectedCount)],
    ['Cash total', money(report.cashTotal)],
    ['Grand total', money(report.grandTotal)],
  ];
  tiles.forEach((t, i) => {
    const x = margin + i * (tileW + 4);
    doc.setDrawColor(203, 209, 200); doc.setLineWidth(0.2);
    doc.roundedRect(x, y, tileW, 20, 2, 2, 'S');
    doc.setTextColor(87, 101, 95); doc.setFontSize(7.5); doc.setFont('helvetica', 'bold');
    doc.text(t[0].toUpperCase(), x + 3, y + 7);
    doc.setTextColor(24, 36, 32); doc.setFontSize(13); doc.setFont('helvetica', 'bold');
    doc.text(t[1], x + 3, y + 16);
  });
  y += 30;

  // ── Reconciliation ─────────────────────────────────────────────────────
  if (report.reconciliation) {
    const r = report.reconciliation;
    const variance = Number(r.variance || 0);
    const signoffLine = `Counted by ${r.submitted_by || '—'}` + (r.reviewed_by ? `  ·  Reviewed by ${r.reviewed_by}` : '  ·  Not yet reviewed');
    const boxH = r.reason ? 28 : 22;
    doc.setFillColor(variance === 0 ? 240 : 253, variance === 0 ? 250 : 237, variance === 0 ? 245 : 230);
    doc.roundedRect(margin, y, contentW, boxH, 2, 2, 'F');
    doc.setTextColor(24, 36, 32); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('CASH RECONCILIATION', margin + 4, y + 6);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`Expected ${money(r.expected_cash)}  ·  Counted ${money(r.cash_counted)}  ·  Variance ${money(r.variance)}`, margin + 4, y + 12);
    if (r.reason) doc.text(`Reason for difference: ${r.reason}`, margin + 4, y + 18);
    doc.text(signoffLine, margin + 4, y + boxH - 4);
    y += boxH + 6;
  }

  // ── Breakdown by charge type ────────────────────────────────────────────
  // Counts per tier label (e.g. "12 x Minimum Fee, 3 x Fridge Surcharge"),
  // parsed server-side from each transaction's tier_label — see
  // buildTierBreakdown() in api/gatehouse.js.
  if (report.tierBreakdown && report.tierBreakdown.length > 0) {
    const rowH = 6.5;
    const boxH = 10 + report.tierBreakdown.length * rowH;
    if (y + boxH > 270) { doc.addPage(); y = 20; }
    doc.setFillColor(246, 247, 243); doc.roundedRect(margin, y, contentW, boxH, 2, 2, 'F');
    doc.setTextColor(24, 36, 32); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('BREAKDOWN BY CHARGE TYPE', margin + 4, y + 6.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    let by = y + 6.5;
    report.tierBreakdown.forEach((row) => {
      by += rowH;
      doc.text(String(row.quantity), margin + 4, by);
      doc.text(row.label, margin + 14, by);
    });
    y += boxH + 6;
  }

  // ── Transactions table ─────────────────────────────────────────────────
  const cRcpt = margin, cRcptW = 18;
  const cTime = cRcpt + cRcptW, cTimeW = 16;
  const cTier = cTime + cTimeW, cTierW = 38;
  const cPlate = cTier + cTierW, cPlateW = 20;
  const cOperator = cPlate + cPlateW, cOperatorW = 28;
  const cPay = cOperator + cOperatorW, cPayW = 20;
  const cAmt = cPay + cPayW, cAmtW = contentW - cRcptW - cTimeW - cTierW - cPlateW - cOperatorW - cPayW;

  const drawHeader = () => {
    doc.setFillColor(196, 118, 31); doc.rect(margin, y, contentW, 8, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    doc.text('RECEIPT #', cRcpt + 2, y + 5.5);
    doc.text('TIME', cTime + 2, y + 5.5);
    doc.text('LOAD', cTier + 2, y + 5.5);
    doc.text('PLATE', cPlate + 2, y + 5.5);
    doc.text('OPERATOR', cOperator + 2, y + 5.5);
    doc.text('PAYMENT', cPay + 2, y + 5.5);
    doc.text('AMOUNT', cAmt + 2, y + 5.5);
    y += 8;
  };

  if (report.transactions.length === 0) {
    doc.setTextColor(87, 101, 95); doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text('No transactions logged for this station today.', margin, y + 6);
    y += 14;
  } else {
    drawHeader();
    report.transactions.forEach((t, i) => {
      if (y + 8 > 280) { doc.addPage(); y = 20; drawHeader(); }
      const zebra = i % 2 === 1;
      doc.setFillColor(...(zebra ? [246, 247, 243] : [255, 255, 255]));
      doc.rect(margin, y, contentW, 8, 'F');
      doc.setTextColor(24, 36, 32); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(String(t.receipt_number), cRcpt + 2, y + 5.5);
      doc.text(new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), cTime + 2, y + 5.5);
      const tierLabel = t.redirected ? 'Redirected' : (t.tier_label || '—');
      doc.text(doc.splitTextToSize(tierLabel, cTierW - 4)[0] || '—', cTier + 2, y + 5.5);
      doc.text(t.plate || '—', cPlate + 2, y + 5.5);
      doc.text(doc.splitTextToSize(t.operator_name || '—', cOperatorW - 4)[0] || '—', cOperator + 2, y + 5.5);
      doc.text(t.redirected ? '—' : (t.payment_method || '—'), cPay + 2, y + 5.5);
      doc.text(t.redirected ? '—' : money(t.amount), cAmt + 2, y + 5.5);
      y += 8;
    });
  }

  y += 6;
  if (y > 270) { doc.addPage(); y = 20; }
  doc.setDrawColor(203, 209, 200); doc.setLineWidth(0.2); doc.line(margin, y, margin + contentW, y);
  y += 8;
  doc.setTextColor(87, 101, 95); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text('Generated automatically by Gatehouse. Every receipt number above is issued strictly in sequence for this station.', margin, y);

  return doc;
}

export function gatehouseReportFilename(report) {
  const safeName = (report.stationName || 'station').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `gatehouse-${safeName}-${report.businessDate}.pdf`;
}
