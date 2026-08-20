// generateBrainProfilePDF.js
// Admin-triggered "Learning Snapshot" export of a company's Brain profile
// (docs/scope-company-brain.md Phase 6). Current-state snapshot only — no
// signal counts, no edit history — so it stays provable ("here's what
// we've learned about your company") without inviting "why only N signals"
// scrutiny. Reuses the same jsPDF helpers as the Safety/Equipment
// Analytics PDFs so header/footer/branding stay consistent across exports.

import {
  loadJsPDF, PAGE, drawBanner, loadLogoDataUrl, drawSectionTitle, drawFooter, pdfFilename,
} from "./analyticsPdfHelpers.js";

const AMBER = [180, 83, 9];

function drawParagraph(doc, y, text, { color = [51, 65, 85], size = 9.5, italic = false } = {}) {
  const { margin, W } = PAGE;
  const contentW = W - margin * 2;
  doc.setTextColor(...color);
  doc.setFont("helvetica", italic ? "italic" : "normal");
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(text, contentW);
  doc.text(lines, margin, y);
  return y + lines.length * (size * 0.42) + 4;
}

export async function generateBrainProfilePDF({ companyName, companyLogo, profile }) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const logoDataUrl = await loadLogoDataUrl(companyLogo);

  let y = drawBanner(doc, {
    title: "Company Brain — Learning Snapshot",
    subtitle: `${companyName || "Company"} · ${new Date().toLocaleDateString("en-CA")}`,
    color: AMBER, logoDataUrl,
  });

  y = drawSectionTitle(doc, y, "What FORA has learned about your company", "Built from your own SOPs, equipment, and real usage — never from another company's data or outside research.", AMBER);

  const hasIndustry = !!profile?.industry_inference;
  const hasEquip = !!profile?.equipment_summary;
  const hasTerms = !!profile?.terminology_notes;

  if (!hasIndustry && !hasEquip && !hasTerms) {
    y = drawParagraph(doc, y, "Nothing learned yet — this company hasn't accumulated enough activity for a profile.", { color: [156, 163, 175], italic: true });
  } else {
    if (hasIndustry) {
      doc.setTextColor(71, 85, 105); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.text("INDUSTRY", PAGE.margin, y); y += 5;
      y = drawParagraph(doc, y, profile.industry_inference);
    }
    if (hasEquip) {
      doc.setTextColor(71, 85, 105); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.text("EQUIPMENT", PAGE.margin, y); y += 5;
      y = drawParagraph(doc, y, profile.equipment_summary);
    }
    if (hasTerms) {
      doc.setTextColor(71, 85, 105); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.text("TERMINOLOGY", PAGE.margin, y); y += 5;
      y = drawParagraph(doc, y, profile.terminology_notes);
    }
  }

  y += 4;
  y = drawSectionTitle(doc, y, "Hazard emphasis", "Areas of emphasis learned from this company's own FLHA edits, toolbox talks, incidents, and near misses.", AMBER);
  const emphasis = profile?.hazard_emphasis || [];
  if (emphasis.length === 0) {
    y = drawParagraph(doc, y, "Nothing learned yet — needs more activity from this company first.", { color: [156, 163, 175], italic: true });
  } else {
    emphasis.forEach((e) => {
      doc.setTextColor(51, 65, 85); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
      doc.text(`• ${e.category}`, PAGE.margin, y);
      y += 5;
      if (e.note) y = drawParagraph(doc, y, e.note, { color: [100, 116, 139], size: 8.5 });
    });
  }

  if (y > 250) { doc.addPage(); y = 20; }
  y += 4;
  doc.setDrawColor(253, 230, 138); doc.setFillColor(255, 251, 235);
  doc.roundedRect(PAGE.margin, y, PAGE.W - PAGE.margin * 2, 22, 2, 2, "FD");
  y = drawParagraph(doc, y + 6, "This reflects emphasis and terminology only. It can never lower a required risk rating, weaken a required control, or omit a required hazard category — that safety floor is enforced structurally, not by policy. All FORA Generated Content, including this profile, remains a drafting aid and must be reviewed by a qualified person before it's relied on. See FORA's Terms of Use.", { size: 8, color: [146, 64, 14] });

  if (profile?.last_summarized_at) {
    y = drawParagraph(doc, y + 2, `Profile last refreshed from activity: ${new Date(profile.last_summarized_at).toLocaleDateString("en-CA")}.`, { size: 8, color: [148, 163, 184], italic: true });
  }

  await drawFooter(doc, AMBER);
  doc.save(pdfFilename("BRAIN_SNAPSHOT", companyName));
}
