// Tests for server-lib/auditLog.js — a best-effort logger for
// administrative/access-control actions (see
// docs/schema/audit-log-migration.sql for scope).
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { logAuditEvent } from '../../server-lib/auditLog.js';

function fakeSupabase({ throwOnInsert = false } = {}) {
  let inserted = null;
  const client = {
    from(table) {
      assert.equal(table, 'audit_log');
      return {
        insert(row) {
          if (throwOnInsert) return Promise.reject(new Error('boom'));
          inserted = row;
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return { client, getInserted: () => inserted };
}

test('logs the given fields, defaulting the optional ones to null', async () => {
  const { client, getInserted } = fakeSupabase();
  await logAuditEvent(client, { actorRole: 'admin', action: 'set_plan_tier', companyId: 7, targetType: 'company', targetId: 7, details: { tier: 'advanced' } });
  const row = getInserted();
  assert.equal(row.actor_role, 'admin');
  assert.equal(row.action, 'set_plan_tier');
  assert.equal(row.company_id, 7);
  assert.equal(row.target_type, 'company');
  assert.equal(row.target_id, '7');
  assert.deepEqual(row.details, { tier: 'advanced' });
});

test('a call with only the required fields logs nulls for the rest', async () => {
  const { client, getInserted } = fakeSupabase();
  await logAuditEvent(client, { actorRole: 'admin', action: 'set_master_code' });
  const row = getInserted();
  assert.equal(row.company_id, null);
  assert.equal(row.target_type, null);
  assert.equal(row.target_id, null);
  assert.equal(row.details, null);
});

test('targetId is stringified so a numeric id round-trips as text', async () => {
  const { client, getInserted } = fakeSupabase();
  await logAuditEvent(client, { actorRole: 'admin', action: 'delete_company', targetId: 42 });
  assert.equal(getInserted().target_id, '42');
  assert.equal(typeof getInserted().target_id, 'string');
});

test('a failed insert never throws — the audit write is best-effort', async () => {
  const { client } = fakeSupabase({ throwOnInsert: true });
  await assert.doesNotReject(() => logAuditEvent(client, { actorRole: 'admin', action: 'set_master_code' }));
});
