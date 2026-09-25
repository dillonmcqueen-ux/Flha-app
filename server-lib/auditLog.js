// server-lib/auditLog.js
// Records administrative/access-control actions to the audit_log table —
// see docs/schema/audit-log-migration.sql for what this does and does not
// cover (config/access changes, not every read or form submission).
//
// Best-effort and never allowed to fail the action it's logging: an audit
// log write failing is not a reason to undo (or block) the admin action
// that already happened, the same reasoning api/login.js's
// sendOnboardingNotification uses for its own best-effort side effects.
export async function logAuditEvent(supabaseAdmin, {
  actorRole, action, companyId = null, targetType = null, targetId = null, details = null,
}) {
  try {
    await supabaseAdmin.from('audit_log').insert({
      actor_role: actorRole,
      action,
      company_id: companyId,
      target_type: targetType,
      target_id: targetId !== null && targetId !== undefined ? String(targetId) : null,
      details,
    });
  } catch (e) {
    console.error(`audit_log write failed for action "${action}":`, e.message);
  }
}
