// server-lib/portalAssignments.js
// Company Portal phase 4 (assignment + compliance). Two entry points:
//
//   - applyRuleToExistingRoster: called right after an assignment rule is
//     created (api/portal.js) — materializes portal_assignments rows for
//     everyone the rule already matches.
//   - applyRulesToNewRosterMember: called right after a roster row is
//     created (api/companydata.js's add_roster_member/onboard_new_employee)
//     — the spec's "auto-applies to new hires". Runs for every rule across
//     every one of the company's Portal documents that has
//     auto_apply_new_hires set and matches the new member's role.
//
// Both are best-effort and non-blocking by design: a failure here must
// never undo or fail the roster/rule write that already succeeded, same
// posture as this app's other best-effort side effects (onboarding email,
// the phase-3 submission-notification email). Callers wrap these in
// try/catch and log rather than surfacing a 500 for something that isn't
// the caller's own request failing.
//
// Idempotent by construction: portal_assignments has a unique
// (document_id, roster_id) index, so re-applying a rule that already
// covered someone is a harmless no-op (upsert ... onConflict: 'do nothing'
// shape, achieved here with a plain insert and swallowing the unique
// violation rather than a separate existence check per row).

function dueAtFor(dueDays) {
  if (dueDays === null || dueDays === undefined) return null;
  const d = new Date();
  d.setDate(d.getDate() + Number(dueDays));
  return d.toISOString();
}

async function insertAssignmentsIgnoringConflicts(supabaseAdmin, rows) {
  if (rows.length === 0) return;
  // Supabase's .upsert with ignoreDuplicates does exactly this in one
  // round trip rather than insert-then-catch per row.
  await supabaseAdmin.from('portal_assignments').upsert(rows, {
    onConflict: 'document_id,roster_id',
    ignoreDuplicates: true,
  });
}

export async function applyRuleToExistingRoster(supabaseAdmin, rule) {
  let query = supabaseAdmin.from('roster').select('id, role').eq('active', true);
  const { data: docRows } = await supabaseAdmin.from('portal_documents').select('company_id').eq('id', rule.document_id).limit(1);
  const companyId = docRows?.[0]?.company_id;
  if (!companyId) return;
  query = query.eq('company_id', companyId);
  if (rule.target_type === 'role') query = query.eq('role', rule.target_role);
  if (rule.target_type === 'individual') query = query.eq('id', rule.target_roster_id);

  const { data: members } = await query;
  const dueAt = dueAtFor(rule.due_days);
  const rows = (members || []).map(m => ({
    rule_id: rule.id, document_id: rule.document_id, roster_id: m.id, due_at: dueAt,
  }));
  await insertAssignmentsIgnoringConflicts(supabaseAdmin, rows);
}

export async function applyRulesToNewRosterMember(supabaseAdmin, companyId, rosterMember) {
  // Every auto-applying rule on any of this company's Portal documents.
  const { data: documents } = await supabaseAdmin.from('portal_documents').select('id').eq('company_id', companyId);
  const documentIds = (documents || []).map(d => d.id);
  if (documentIds.length === 0) return;

  const { data: rules } = await supabaseAdmin
    .from('portal_assignment_rules')
    .select('*')
    .in('document_id', documentIds)
    .eq('auto_apply_new_hires', true);

  const matching = (rules || []).filter(r =>
    r.target_type === 'everyone' ||
    (r.target_type === 'role' && r.target_role === rosterMember.role)
    // 'individual' rules never auto-apply to a DIFFERENT new hire — they
    // name one specific person, already handled at rule-creation time.
  );

  const rows = matching.map(r => ({
    rule_id: r.id, document_id: r.document_id, roster_id: rosterMember.id, due_at: dueAtFor(r.due_days),
  }));
  await insertAssignmentsIgnoringConflicts(supabaseAdmin, rows);
}
