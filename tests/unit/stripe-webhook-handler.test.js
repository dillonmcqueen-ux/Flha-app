// Integration tests for api/stripe-webhook.js's checkout.session.completed
// path — the code that turns a completed Stripe Checkout into the
// stripe_checkouts row submit_onboarding_intake later claims.
//
// This path had never executed. Not in a test, and not in production: as of
// writing, stripe_checkouts, onboarding_requests and stripe_webhook_events
// are all empty. So it is exercised here as close to for real as possible
// without a browser and a card:
//
//   - real Stripe signature verification, over a payload signed with
//     stripe.webhooks.generateTestHeaderString
//   - the real @supabase/supabase-js client, making real HTTP calls
//   - a stand-in PostgREST server over those calls, so what the handler
//     actually puts on the wire is what gets asserted
//   - an event body shaped like a real one, taken from a Checkout Session
//     created against live test-mode Stripe
//
// What it does not cover: Stripe actually delivering the event, and the real
// Supabase accepting the row. The second is checked separately against the
// live schema.
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import Stripe from 'stripe';

const WEBHOOK_SECRET = 'whsec_test_secret_for_signing_only';

process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_placeholder';
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

// ---------------------------------------------------------------- fake DB

// Minimal PostgREST stand-in. Holds two tables in memory and speaks just
// enough of the protocol for supabase-js: 409 + code 23505 on a duplicate
// primary key, and the object-vs-array Accept negotiation maybeSingle uses.
function startFakeSupabase() {
  const state = { events: new Map(), checkouts: new Map(), companies: [], fail: null, calls: [] };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const table = url.pathname.replace('/rest/v1/', '');
    const body = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
    const json = body ? JSON.parse(body) : null;
    state.calls.push({ method: req.method, table, json });

    const send = (code, payload) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(payload === undefined ? '' : JSON.stringify(payload));
    };

    // Lets a test make one specific write blow up, the way a transient
    // Supabase failure would.
    if (state.fail && state.fail.table === table && state.fail.method === req.method) {
      state.fail = null;
      return send(500, { code: 'XX000', message: 'simulated database failure' });
    }

    if (table === 'stripe_webhook_events') {
      if (req.method === 'POST') {
        const row = Array.isArray(json) ? json[0] : json;
        if (state.events.has(row.id)) {
          return send(409, {
            code: '23505',
            message: 'duplicate key value violates unique constraint "stripe_webhook_events_pkey"',
          });
        }
        state.events.set(row.id, { ...row, processed_at: null });
        return send(201, []);
      }
      if (req.method === 'GET') {
        const id = (url.searchParams.get('id') || '').replace('eq.', '');
        const row = state.events.get(id);
        const wantsObject = (req.headers.accept || '').includes('pgrst.object');
        const projected = row ? { processed_at: row.processed_at } : null;
        if (wantsObject) {
          if (!projected) return send(406, { code: 'PGRST116', message: 'no rows', details: '0 rows' });
          return send(200, projected);
        }
        return send(200, projected ? [projected] : []);
      }
      if (req.method === 'PATCH') {
        const id = (url.searchParams.get('id') || '').replace('eq.', '');
        const row = state.events.get(id);
        if (row) Object.assign(row, json);
        return send(204);
      }
    }

    if (table === 'stripe_checkouts' && req.method === 'POST') {
      const row = Array.isArray(json) ? json[0] : json;
      state.checkouts.set(row.session_id, row);   // upsert, keyed on session_id
      return send(201, []);
    }

    if (table === 'companies' && req.method === 'PATCH') {
      state.companies.push({ filter: url.search, updates: json });
      return send(204);
    }

    send(404, { message: `unhandled ${req.method} ${req.url}` });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      state.url = `http://127.0.0.1:${server.address().port}`;
      state.close = () => new Promise(r => server.close(r));
      resolve(state);
    });
  });
}

// ------------------------------------------------------------- fake req/res

function makeReq(bodyString, secret = WEBHOOK_SECRET) {
  const stripe = new Stripe('sk_test_placeholder');
  const req = Readable.from([Buffer.from(bodyString)]);
  req.headers = {
    'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload: bodyString, secret }),
  };
  return req;
}

function makeRes() {
  const out = {};
  return {
    out,
    status(code) { out.code = code; return this; },
    json(payload) { out.body = payload; return this; },
    send(payload) { out.body = payload; return this; },
  };
}

// A checkout.session.completed shaped like the real thing. The session id,
// amounts and metadata come from a Session created against live test-mode
// Stripe with the payload server-lib/pricing.js builds.
function completedEvent(overrides = {}) {
  const id = overrides.eventId || `evt_test_${Math.random().toString(36).slice(2, 10)}`;
  return JSON.stringify({
    id,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: overrides.sessionId || 'cs_test_b1OIpqQlSswXsvzG4uA6YLK6y0oaLiCzk6kkKXrsSxPb7yof5PhXyCEMtp',
        object: 'checkout.session',
        mode: 'subscription',
        status: 'complete',
        currency: 'cad',
        amount_total: 68495,
        customer: 'customer' in overrides ? overrides.customer : 'cus_test_ABC123',
        subscription: 'subscription' in overrides ? overrides.subscription : 'sub_test_XYZ789',
        customer_details: { email: 'email' in overrides ? overrides.email : 'buyer@example.com' },
        metadata: 'metadata' in overrides ? overrides.metadata : {
          plan_tier: 'basic',
          modules: 'safety,inspections,maintenance,timeclock,daily,certifications,fuel,monthly',
          quoted_monthly: '315',
          quoted_setup: '350',
        },
      },
    },
  });
}

// The handler builds its Supabase client at module load, so the fake server
// has to exist and SUPABASE_URL has to point at it before the import.
const db = await startFakeSupabase();
process.env.SUPABASE_URL = db.url;
const { default: handler } = await import('../../api/stripe-webhook.js');

test.after(() => db.close());

function reset() {
  db.events.clear(); db.checkouts.clear(); db.companies.length = 0;
  db.calls.length = 0; db.fail = null;
}

// ------------------------------------------------------------------- tests

test('a completed checkout is staged into stripe_checkouts', async () => {
  reset();
  const res = makeRes();
  await handler(makeReq(completedEvent()), res);

  assert.equal(res.out.code, 200);
  assert.equal(db.checkouts.size, 1);

  const row = [...db.checkouts.values()][0];
  assert.equal(row.session_id, 'cs_test_b1OIpqQlSswXsvzG4uA6YLK6y0oaLiCzk6kkKXrsSxPb7yof5PhXyCEMtp');
  assert.equal(row.customer_id, 'cus_test_ABC123');
  assert.equal(row.subscription_id, 'sub_test_XYZ789');
  assert.equal(row.plan_tier, 'basic');
  assert.equal(row.email, 'buyer@example.com');
  // The whole point of the modules column: an array, not the comma string.
  assert.deepEqual(row.modules, [
    'safety', 'inspections', 'maintenance', 'timeclock',
    'daily', 'certifications', 'fuel', 'monthly',
  ]);
});

test('the event is stamped processed only after the work succeeds', async () => {
  reset();
  const body = completedEvent({ eventId: 'evt_stamp_me' });
  await handler(makeReq(body), makeRes());
  assert.ok(db.events.get('evt_stamp_me').processed_at, 'processed_at should be set');

  // And the stamp lands after the staging write, not before it.
  const order = db.calls.filter(c =>
    (c.table === 'stripe_checkouts' && c.method === 'POST') ||
    (c.table === 'stripe_webhook_events' && c.method === 'PATCH'));
  assert.deepEqual(order.map(c => c.table), ['stripe_checkouts', 'stripe_webhook_events']);
});

test('a genuine redelivery is a no-op duplicate', async () => {
  reset();
  const body = completedEvent({ eventId: 'evt_dupe' });
  await handler(makeReq(body), makeRes());
  const writesAfterFirst = db.calls.filter(c => c.table === 'stripe_checkouts').length;

  const res2 = makeRes();
  await handler(makeReq(body), res2);
  assert.equal(res2.out.code, 200);
  assert.equal(res2.out.body.duplicate, true);
  assert.equal(db.calls.filter(c => c.table === 'stripe_checkouts').length, writesAfterFirst,
    'a duplicate must not write again');
});

// THE REGRESSION, end to end. Before the fix the retry returned 200
// duplicate without staging, and the purchase was lost for good.
test('a retry after a failed first delivery stages the purchase', async () => {
  reset();
  const body = completedEvent({ eventId: 'evt_retry_me' });

  db.fail = { table: 'stripe_checkouts', method: 'POST' };
  const first = makeRes();
  await handler(makeReq(body), first);
  assert.equal(first.out.code, 500, 'first delivery should fail');
  assert.equal(db.checkouts.size, 0, 'nothing staged yet');
  assert.equal(db.events.get('evt_retry_me').processed_at, null, 'claim must stay unfinished');

  const second = makeRes();
  await handler(makeReq(body), second);
  assert.equal(second.out.code, 200);
  assert.notEqual(second.out.body?.duplicate, true, 'the retry must NOT be dismissed as a duplicate');
  assert.equal(db.checkouts.size, 1, 'the retry must stage the purchase');
  assert.ok(db.events.get('evt_retry_me').processed_at);
});

test('a forged signature is rejected before any database call', async () => {
  reset();
  const res = makeRes();
  const req = makeReq(completedEvent(), 'whsec_the_wrong_secret');
  await handler(req, res);
  assert.equal(res.out.code, 400);
  assert.equal(db.calls.length, 0, 'an unverified payload must never reach the database');
});

test('a legacy session with no modules stages NULL rather than an empty array', async () => {
  reset();
  await handler(makeReq(completedEvent({
    eventId: 'evt_legacy',
    metadata: { plan_tier: 'basic' },
  })), makeRes());

  const row = [...db.checkouts.values()][0];
  assert.equal(row.modules, null, 'NULL means "unknown, leave the defaults alone"');
  assert.equal(row.plan_tier, 'basic');
});

test('missing optional session fields become NULL, not undefined', async () => {
  reset();
  await handler(makeReq(completedEvent({
    eventId: 'evt_sparse',
    customer: null, subscription: null, email: undefined, metadata: {},
  })), makeRes());

  const row = [...db.checkouts.values()][0];
  for (const k of ['customer_id', 'subscription_id', 'plan_tier', 'modules', 'email']) {
    assert.equal(row[k], null, `${k} should be null`);
  }
});

test('subscription lifecycle events sync the company, not stripe_checkouts', async () => {
  reset();
  const body = JSON.stringify({
    id: 'evt_sub_update',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_test_XYZ789', customer: 'cus_test_ABC123', status: 'canceled' } },
  });
  const res = makeRes();
  await handler(makeReq(body), res);

  assert.equal(res.out.code, 200);
  assert.equal(db.checkouts.size, 0);
  assert.equal(db.companies.length, 1);
  assert.equal(db.companies[0].updates.suspended, true, 'canceled should suspend');
  assert.equal(db.companies[0].updates.stripe_subscription_status, 'canceled');
  assert.match(db.companies[0].filter, /stripe_customer_id=eq\.cus_test_ABC123/);
});
