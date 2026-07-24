// Pure aggregation helpers for the supervisor Dashboard's Analytics tab.
// No JSX, no side effects — every function takes already-loaded,
// company-scoped arrays (the same ones Dashboard.jsx already holds in
// state) and returns plain data for Analytics.jsx to render.

function pct(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

function normalizeSiteKey(site) {
  return (site || "").trim().toLowerCase();
}

// ── Severity / review / risk ────────────────────────────────

export function severityBreakdown(nearMisses, incidents) {
  const counts = { Low: 0, Medium: 0, High: 0, Critical: 0 };
  [...nearMisses, ...incidents].forEach(r => {
    const sev = r.report_json?.severity;
    if (counts[sev] !== undefined) counts[sev] += 1;
  });
  return counts;
}

export function nearMissIncidentRatio(nearMisses, incidents) {
  const nm = nearMisses.length, inc = incidents.length;
  const ratioLabel = inc > 0 ? `${(nm / inc).toFixed(1)} : 1` : (nm > 0 ? `${nm} : 0` : "—");
  return { nearMiss: nm, incident: inc, ratioLabel };
}

export function reviewBacklog(nearMisses, incidents) {
  const all = [...nearMisses, ...incidents];
  const reviewed = all.filter(r => r.reviewed).length;
  const total = all.length;
  return { reviewed, outstanding: total - reviewed, total, pct: pct(reviewed, total), caughtUp: total > 0 && reviewed === total };
}

// Matches the FLHA tab's own `highRiskCount` definition exactly (High only,
// not Extreme) so this number always reconciles with the one shown there.
export function highRiskFlhaRate(flhas) {
  const total = flhas.length;
  const highRisk = flhas.filter(f => (f.hazards_json?.hazards || []).some(h => h.risk === "High")).length;
  return { total, highRisk, pct: pct(highRisk, total) };
}

// ── Equipment ────────────────────────────────────────────────

// defectiveCount/monitorCount only exist on pretrip results_json (posttrip
// rows don't have them), matching Dashboard.jsx's own inspIssueCount logic.
export function equipmentIssueStats(inspections) {
  const buckets = {};
  inspections.forEach(i => {
    if (i.trip_type !== "pretrip") return;
    const label = (i.equipment_label || "Unlabeled equipment").trim();
    const r = i.results_json || {};
    if (!buckets[label]) buckets[label] = { label, defective: 0, monitor: 0, pretripCount: 0, lastFlaggedAt: null };
    const b = buckets[label];
    b.pretripCount += 1;
    b.defective += r.defectiveCount || 0;
    b.monitor += r.monitorCount || 0;
    if ((r.defectiveCount || 0) + (r.monitorCount || 0) > 0) {
      if (!b.lastFlaggedAt || new Date(i.created_at) > new Date(b.lastFlaggedAt)) b.lastFlaggedAt = i.created_at;
    }
  });
  return Object.values(buckets).sort((a, b) => (b.defective + b.monitor) - (a.defective + a.monitor));
}

// ── Sites — kept as two separate tables on purpose. Free-text `site`
// (workers typing/picking a name on FLHA/toolbox/daily/near-miss/incident)
// and FK-resolved `site_name` (monthly/custom, backed by the real sites
// table) are not safe to merge — casing/typo drift and fallback labels like
// "Unknown site" would collide across the two systems.

export function fieldSiteActivity(flhas, toolbox, daily, nearMisses, incidents) {
  const buckets = {};
  const bump = (rawSite, field) => {
    const key = normalizeSiteKey(rawSite);
    if (!key) return;
    if (!buckets[key]) buckets[key] = { labelCounts: {}, flhas: 0, toolbox: 0, daily: 0, nearMisses: 0, incidents: 0 };
    const b = buckets[key];
    const label = rawSite.trim();
    b.labelCounts[label] = (b.labelCounts[label] || 0) + 1;
    b[field] += 1;
  };
  flhas.forEach(f => bump(f.job_site, "flhas"));
  toolbox.forEach(t => bump(t.site, "toolbox"));
  daily.forEach(d => bump(d.site, "daily"));
  nearMisses.forEach(n => bump(n.site, "nearMisses"));
  incidents.forEach(i => bump(i.site, "incidents"));

  return Object.values(buckets)
    .map(b => {
      let label = "", bestCount = 0;
      Object.entries(b.labelCounts).forEach(([l, count]) => { if (count > bestCount) { label = l; bestCount = count; } });
      return { site: label, flhas: b.flhas, toolbox: b.toolbox, daily: b.daily, nearMisses: b.nearMisses, incidents: b.incidents };
    })
    .sort((a, b) => (b.nearMisses + b.incidents) - (a.nearMisses + a.incidents));
}

export function scheduledSiteActivity(monthlyRecords, monthlyActions, customDocs) {
  const buckets = {};
  const bump = (siteName, field) => {
    const key = normalizeSiteKey(siteName);
    if (!key) return;
    if (!buckets[key]) buckets[key] = { site: (siteName || "").trim(), monthly: 0, openActions: 0, customDocs: 0 };
    buckets[key][field] += 1;
  };
  monthlyRecords.forEach(r => bump(r.site_name, "monthly"));
  customDocs.forEach(c => bump(c.site_name, "customDocs"));
  monthlyActions.forEach(a => { if (a.status !== "resolved") bump(a.site_name, "openActions"); });
  return Object.values(buckets).sort((a, b) => b.openActions - a.openActions || b.monthly - a.monthly);
}

// ── Trend / aging / leaderboard / compliance ────────────────

export function monthlyTrend(nearMisses, incidents) {
  const now = new Date();
  const buckets = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("en-CA", { month: "short", year: "2-digit" }), nearMiss: 0, incident: 0 });
  }
  const bucketMap = {};
  buckets.forEach(b => { bucketMap[b.key] = b; });
  const bump = (list, field) => list.forEach(r => {
    if (!r.created_at) return;
    const d = new Date(r.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (bucketMap[key]) bucketMap[key][field] += 1;
  });
  bump(nearMisses, "nearMiss");
  bump(incidents, "incident");
  return buckets;
}

export function correctiveActionAging(monthlyActions) {
  const now = Date.now();
  const buckets = { under30: 0, days30to60: 0, over60: 0 };
  let openCount = 0, resolvedCount = 0, totalResolutionDays = 0;
  monthlyActions.forEach(a => {
    if (a.status === "resolved") {
      resolvedCount += 1;
      if (a.resolved_at && a.created_at) totalResolutionDays += (new Date(a.resolved_at) - new Date(a.created_at)) / 86400000;
    } else {
      openCount += 1;
      const ageDays = a.created_at ? (now - new Date(a.created_at)) / 86400000 : 0;
      if (ageDays < 30) buckets.under30 += 1;
      else if (ageDays < 60) buckets.days30to60 += 1;
      else buckets.over60 += 1;
    }
  });
  return { openCount, resolvedCount, buckets, avgResolutionDays: resolvedCount > 0 ? Math.round(totalResolutionDays / resolvedCount) : null };
}

// Positive framing on purpose — this is meant to recognize engagement, not
// call out low performers.
export function reporterLeaderboard(flhas, inspections, toolbox) {
  const counts = {};
  const bump = (name) => {
    const n = (name || "").trim();
    if (!n) return;
    counts[n] = (counts[n] || 0) + 1;
  };
  flhas.forEach(f => bump(f.worker_name));
  inspections.forEach(i => bump(i.worker_name));
  toolbox.forEach(t => bump(t.presenter_name));
  return Object.entries(counts)
    .map(([name, count]) => ({ label: name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

export function monthlyPassRate(monthlyRecords) {
  const total = monthlyRecords.length;
  const passed = monthlyRecords.filter(r => (r.open_actions || 0) === 0).length;
  return { total, passed, pct: pct(passed, total) };
}

export function toolboxAvgAttendance(toolbox) {
  if (toolbox.length === 0) return { count: 0, avg: 0 };
  const total = toolbox.reduce((sum, t) => sum + (t.attendees_json || []).length, 0);
  return { count: toolbox.length, avg: Math.round((total / toolbox.length) * 10) / 10 };
}
