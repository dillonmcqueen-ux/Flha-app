// src/companyProfile.js
// docs/scope-company-brain.md Phase 5 — fetches a company's learned
// profile (built at onboarding by Phase 2, refreshed over time by Phase
// 4's cron) and formats it into a small, additive block shared across the
// document-generation prompts built in App.jsx and the other 7 form
// components. A plain DB read via the existing get_company_profile action
// (Phase 1) — no extra model call, so this doesn't add latency beyond one
// more small fetch alongside the SOPs/sites/custom-fields loads these
// forms already do on mount.
//
// Cold start: a company with no profile row yet, or one with every field
// still empty, gets "" back from buildCompanyContextBlock — callers splice
// it into their prompt unconditionally, so a company with nothing learned
// yet behaves exactly like the prompt did before this phase existed.

export async function fetchCompanyProfile(token, companyId) {
  if (!companyId) return null;
  try {
    const res = await fetch("/api/companydata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_company_profile", token, companyId }),
    });
    const data = await res.json();
    if (!res.ok) return null;
    return data.profile || null;
  } catch (e) {
    return null;
  }
}

// `includeHazardEmphasis` should only be true for the FLHA hazard-
// generation prompt — hazard_emphasis is specifically about which hazard
// categories this company's own history emphasizes (docs/scope-company-
// brain.md Phase 4), not relevant to the other document types' prompts
// (toolbox talk topics, near-miss report structuring, etc.), which only
// benefit from the general industry/terminology context.
export function buildCompanyContextBlock(profile, { includeHazardEmphasis = false } = {}) {
  if (!profile) return "";
  const lines = [];
  if (profile.industry_inference) lines.push(`Industry: ${profile.industry_inference}`);
  if (profile.terminology_notes) lines.push(`Company-specific terminology/phrasing to reuse where it naturally fits: ${profile.terminology_notes}`);
  if (includeHazardEmphasis && Array.isArray(profile.hazard_emphasis) && profile.hazard_emphasis.length > 0) {
    const emphasisLines = profile.hazard_emphasis
      .filter((e) => e && e.category)
      .map((e) => `- ${e.category}${e.note ? `: ${e.note}` : ""}`)
      .join("\n");
    if (emphasisLines) {
      lines.push(
        "This company's own history suggests extra attention to the topics below. " +
        "This is CONTEXT ONLY — it never overrides the hazard-identification and risk-rating rules above, " +
        "never lowers a risk rating, and never justifies skipping a required hazard category:\n" +
        emphasisLines
      );
    }
  }
  if (lines.length === 0) return "";
  return `\n\nCompany context (learned from this company's own usage over time):\n${lines.join("\n")}`;
}
