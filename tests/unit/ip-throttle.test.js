// server-lib/ipThrottle.js: the decision must come from the count the atomic
// bump_ip_throttle RPC returns, and only fall back to the old read-then-write
// path when that function is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIpThrottle } from '../../server-lib/ipThrottle.js';

function fakeClient({ rpcResult, row = null }) {
  const calls = { rpc: [], upsert: [], update: [] };
  const client = {
    calls,
    rpc(name, args) {
      calls.rpc.push({ name, args });
      return Promise.resolve(rpcResult);
    },
    from() {
      const q = {
        select() { return q; },
        eq() { return q; },
        limit() { return Promise.resolve({ data: row ? [row] : [] }); },
        upsert(v) { calls.upsert.push(v); return Promise.resolve({}); },
        update(v) { calls.update.push(v); return { eq: () => Promise.resolve({}) }; },
      };
      return q;
    },
  };
  return client;
}

test('allows while the returned count is within the cap', async () => {
  const c = fakeClient({ rpcResult: { data: 5, error: null } });
  assert.equal(await checkIpThrottle(c, 'pin:1.2.3.4', 5, 60_000), true);
  assert.deepEqual(c.calls.rpc[0], { name: 'bump_ip_throttle', args: { p_key: 'pin:1.2.3.4', p_window_seconds: 60 } });
  assert.equal(c.calls.upsert.length + c.calls.update.length, 0);
});

test('rejects once the returned count passes the cap', async () => {
  const c = fakeClient({ rpcResult: { data: 6, error: null } });
  assert.equal(await checkIpThrottle(c, 'pin:1.2.3.4', 5, 60_000), false);
});

test('falls back to the legacy path when the RPC is missing', async () => {
  const recent = { window_start: new Date().toISOString(), count: 5 };
  const c = fakeClient({ rpcResult: { data: null, error: { message: 'function does not exist' } }, row: recent });
  assert.equal(await checkIpThrottle(c, 'k', 5, 60_000), false);
  const c2 = fakeClient({ rpcResult: { data: null, error: { message: 'missing' } }, row: { ...recent, count: 2 } });
  assert.equal(await checkIpThrottle(c2, 'k', 5, 60_000), true);
  assert.deepEqual(c2.calls.update, [{ count: 3 }]);
});
