// Pins break #15: retiring a machine has to retire its maintenance clock and
// its compliance expiries, without retiring its history.
//
// `equipment.retired_at` is what a supervisor sets when a machine is sold or
// scrapped. It already took the machine out of every worker-facing picker
// (api/companydata.js's list_equipment filters it), but every surface that
// reads the `equipment` table DIRECTLY bypassed that filter. For two of them
// that was wrong: a sold machine kept a permanently-overdue PM clock feeding
// the Overdue tile and the Equipment nav badge, and its expired CVIP kept
// counting on the Compliance tab, on the dashboard banner and on the printed
// weekly report.
//
// The approved semantics, which these cases exist to pin:
//   * operationally gone  — no PM status, no expiry counts, not on the
//     weekly report;
//   * historically present — every service record still listed, the id still
//     resolvable on submit, still in Fleet Overview behind its toggle.
//
// The "historically present" half is not a nicety. resolveEquipmentId
// filtering on retired_at would 403 a worker whose report sat in the offline
// queue while the machine was retired, and src/offlineQueue.js's drainQueue
// has no attempt cap and no drop path, so that one 403 wedges their whole
// queue forever. The cases at the bottom are there to stop a later "make it
// consistent" pass from doing exactly that.
//
// These run the real handlers against the real @supabase/supabase-js client,
// pointed at a stand-in PostgREST server — the approach
// tests/unit/stripe-webhook-handler.test.js uses — so what is asserted is
// what the handler actually puts on the wire and gets back, not a
// reimplementation of its filtering.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const SESSION_SECRET = 'test-session-secret';
process.env.SESSION_SECRET = SESSION_SECRET;
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

// ───────────────────────────────────────────────────────── the fake fleet
//
// One company, three machines. #1 is working, #2 was sold in June, #3
// belongs to somebody else and must never appear for any reason.
const EQUIPMENT = [
  { id: 1, company_id: 'acme', year: 2019, make: 'Cat', model: '320', type: 'Excavator', unit_number: '12', pm_interval: 250, retired_at: null, is_attachment: false },
  { id: 2, company_id: 'acme', year: 2011, make: 'Deere', model: '650', type: 'Dozer', unit_number: '7', pm_interval: 250, retired_at: '2026-06-02T00:00:00.000Z', is_attachment: false },
  { id: 3, company_id: 'other-co', year: 2020, make: 'Kubota', model: 'SVL', type: 'Skid steer', unit_number: '1', pm_interval: 250, retired_at: null, is_attachment: false },
];

// Both acme machines are far past their 250-hour interval. #2's readings
// stopped the day it left, which is exactly why it is stuck overdue.
const INSPECTIONS = [
  { id: 101, company_id: 'acme', equipment_id: 1, trip_type: 'pretrip', start_reading: 900, end_reading: null, reading_unit: 'hrs', created_at: '2026-09-14T13:00:00.000Z', equipment_label: 'Cat 320', worker_name: 'Sam', linked_inspection_id: null, has_changes: false, results_json: {} },
  { id: 102, company_id: 'acme', equipment_id: 2, trip_type: 'pretrip', start_reading: 4400, end_reading: null, reading_unit: 'hrs', created_at: '2026-05-29T13:00:00.000Z', equipment_label: 'Deere 650', worker_name: 'Sam', linked_inspection_id: null, has_changes: false, results_json: {} },
];

const MAINTENANCE_LOG = [
  { id: 201, company_id: 'acme', equipment_id: 1, entry_type: 'pm_service', service_date: '2026-07-01', service_reading: 500, reading_unit: 'hrs', performed_by: 'Shop', notes: null, created_at: '2026-07-01T16:00:00.000Z' },
  { id: 202, company_id: 'acme', equipment_id: 2, entry_type: 'pm_service', service_date: '2026-01-10', service_reading: 4000, reading_unit: 'hrs', performed_by: 'Shop', notes: null, created_at: '2026-01-10T16:00:00.000Z' },
  { id: 203, company_id: 'acme', equipment_id: 2, entry_type: 'field_service', service_date: '2026-05-20', service_reading: null, reading_unit: null, performed_by: 'Sam', notes: 'Greased the pins', created_at: '2026-05-20T16:00:00.000Z' },
];

// One expired document on the working machine, one on the sold one. Same
// doc type, same lapse, so the only thing separating them is retirement.
const COMPLIANCE = [
  { id: 301, company_id: 'acme', equipment_id: 1, doc_type: 'cvip', label: 'Alberta CVIP', expiry_date: '2026-08-01', notes: null, updated_at: '2026-01-01T00:00:00.000Z' },
  { id: 302, company_id: 'acme', equipment_id: 2, doc_type: 'cvip', label: 'Alberta CVIP', expiry_date: '2026-08-02', notes: null, updated_at: '2026-01-01T00:00:00.000Z' },
  { id: 303, company_id: 'acme', equipment_id: 1, doc_type: 'registration', label: null, expiry_date: '2027-12-31', notes: null, updated_at: '2026-01-01T00:00:00.000Z' },
];

const TABLES = {
  equipment: EQUIPMENT,
  inspections: INSPECTIONS,
  equipment_maintenance_log: MAINTENANCE_LOG,
  equipment_compliance: COMPLIANCE,
  fuel_logs: [],
};

// ─────────────────────────────────────────────── the PostgREST stand-in
//
// Just enough of the protocol for what these handlers send: eq / neq /
// is.null / not.is.null / in / gte / gt / lte / lt, plus order and limit.
// Anything it does not recognise throws rather than silently matching
// everything — a filter this server quietly ignored would make a passing
// test that proves nothing.
function applyFilter(rows, column, expr) {
  let negated = false;
  let rest = expr;
  if (rest.startsWith('not.')) { negated = true; rest = rest.slice(4); }
  const dot = rest.indexOf('.');
  const op = rest.slice(0, dot);
  const raw = decodeURIComponent(rest.slice(dot + 1));
  const test_ = (row) => {
    const v = row[column];
    switch (op) {
      case 'eq': return String(v) === raw;
      case 'neq': return String(v) !== raw;
      case 'is': return raw === 'null' ? (v === null || v === undefined) : String(v) === raw;
      case 'in': return raw.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(v));
      case 'gte': return String(v) >= raw;
      case 'gt': return String(v) > raw;
      case 'lte': return String(v) <= raw;
      case 'lt': return String(v) < raw;
      default: throw new Error(`fake PostgREST: unsupported operator "${op}" on ${column}`);
    }
  };
  return rows.filter(r => (negated ? !test_(r) : test_(r)));
}

function startFakeSupabase() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const table = url.pathname.replace('/rest/v1/', '');
    calls.push({ method: req.method, table, query: url.search });

    if (req.method !== 'GET' || !(table in TABLES)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: `fake PostgREST: no table ${table}` }));
    }

    let rows = TABLES[table].map(r => ({ ...r }));
    let order = null;
    let limit = null;
    for (const [key, value] of url.searchParams.entries()) {
      if (key === 'select') continue;
      if (key === 'order') { order = value; continue; }
      if (key === 'limit') { limit = Number(value); continue; }
      if (key === 'offset') continue;
      rows = applyFilter(rows, key, value);
    }
    if (order) {
      for (const clause of order.split(',').reverse()) {
        const [col, dir] = clause.split('.');
        rows.sort((a, b) => {
          const x = a[col], y = b[col];
          const cmp = x === y ? 0 : (x === null ? -1 : y === null ? 1 : (x > y ? 1 : -1));
          return dir === 'desc' ? -cmp : cmp;
        });
      }
    }
    if (limit != null) rows = rows.slice(0, limit);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rows));
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}`, calls });
    });
  });
}

const fake = await startFakeSupabase();
// Set before the handlers are imported: both build their supabase client at
// module scope, so the URL has to be in the environment first.
process.env.SUPABASE_URL = fake.url;

const maintenanceHandler = (await import('../../api/maintenance.js')).default;
const companyDataHandler = (await import('../../api/companydata.js')).default;
const { buildReportForCompanyWeek } = await import('../../api/equipmentreports.js');
const { resolveEquipmentId, resolveEquipmentIds, companyEquipmentIndex, retiredEquipmentIds, withoutRetiredEquipment } =
  await import('../../server-lib/equipmentScope.js');

test.after(() => fake.server.close());

// A supervisor session for acme. No userId, so verifySession accepts it on
// signature and TTL alone — the legacy/pre-roster shape, which is what keeps
// this test off the roster table.
function supervisorToken(companyId = 'acme') {
  const payload = Buffer.from(JSON.stringify({ role: 'supervisor', companyId, name: 'Sup', issuedAt: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

async function call(handler, body) {
  let captured = { code: null, body: null };
  const res = {
    status(code) { captured.code = code; return res; },
    json(payload) { captured.body = payload; return res; },
  };
  await handler({ method: 'POST', body: { token: supervisorToken(), ...body } }, res);
  return captured;
}

// ── operationally gone: preventative maintenance ────────────────────────

test('a retired machine is absent from PM status, and the machine still working is not', async () => {
  const { code, body } = await call(maintenanceHandler, { action: 'list_status' });
  assert.equal(code, 200);
  const ids = body.equipment.map(e => e.id);
  assert.deepEqual(ids, [1], 'only the active acme machine should have a PM status');
  assert.ok(!ids.includes(2), 'the machine sold in June must not have a PM clock');
  assert.ok(!ids.includes(3), "another company's machine must never appear");
});

test('the retired machine was the one stuck permanently overdue — that is what this removes', async () => {
  const { body } = await call(maintenanceHandler, { action: 'list_status' });
  // #1 is 900 - 500 = 400 hours past a 250-hour interval: genuinely overdue,
  // and still reported, so this filter is not just hiding everything.
  assert.equal(body.equipment.find(e => e.id === 1).status, 'overdue');
  // #2 would have been 4400 - 4000 = 400 hours over, frozen there forever
  // because its readings stopped when it left the fleet.
  assert.equal(body.equipment.find(e => e.id === 2), undefined);
  // Which is the Overdue stat tile and the Equipment nav badge, both of
  // which count exactly this array (src/Dashboard.jsx).
  assert.equal(body.equipment.filter(e => e.status === 'overdue').length, 1);
});

test('a company that has never retired a machine sees exactly what it saw before', async () => {
  // The combination most customers are actually in. Nothing about this
  // change may alter it — the filter has to be invisible until somebody
  // uses the retire button.
  const saved = EQUIPMENT[1].retired_at;
  EQUIPMENT[1].retired_at = null;
  try {
    const pm = await call(maintenanceHandler, { action: 'list_status' });
    assert.deepEqual(pm.body.equipment.map(e => e.id), [1, 2]);
    assert.equal(pm.body.equipment.filter(e => e.status === 'overdue').length, 2);

    const list = await call(companyDataHandler, { action: 'list_equipment_compliance' });
    assert.deepEqual(list.body.compliance.map(r => r.id).sort(), [301, 302, 303]);

    const summary = await call(companyDataHandler, { action: 'compliance_summary' });
    assert.equal(summary.body.expiredCount, 2);

    const report = await buildReportForCompanyWeek('acme', '2026-09-14', '2026-09-21');
    assert.equal(report.compliance.expiredCount, 2);
  } finally {
    EQUIPMENT[1].retired_at = saved;
  }
});

// ── operationally gone: compliance ──────────────────────────────────────

test('a retired machine\'s expiry rows are absent from the Compliance tab list', async () => {
  const { code, body } = await call(companyDataHandler, { action: 'list_equipment_compliance' });
  assert.equal(code, 200);
  assert.deepEqual(body.compliance.map(r => r.id).sort(), [301, 303]);
  assert.ok(!body.compliance.some(r => r.equipment_id === 2), "the sold machine's CVIP must not be listed");
});

test('the banner counts and the tab list agree — the same expired CVIP, dropped on both', async () => {
  const summary = await call(companyDataHandler, { action: 'compliance_summary' });
  assert.equal(summary.code, 200);
  assert.equal(summary.body.expiredCount, 1, 'only the active machine\'s lapsed CVIP is a live problem');
  assert.deepEqual(summary.body.expired.map(r => r.id), [301]);

  // The comparison that matters: #14 shipped without this filter precisely
  // because a banner counting 2 over a screen listing 3 is worse than
  // either number alone. Now both sides filter, so both sides answer the
  // same — pinned here rather than left to two separate assertions.
  const list = await call(companyDataHandler, { action: 'list_equipment_compliance' });
  const { expiryStatus } = await import('../../server-lib/compliance.js');
  const listExpired = list.body.compliance.filter(r => expiryStatus(r.expiry_date) === 'expired');
  assert.equal(listExpired.length, summary.body.expiredCount);
});

test('a company that tracks no expiry dates makes no extra query and sees no change', async () => {
  const before = fake.calls.length;
  const saved = TABLES.equipment_compliance;
  TABLES.equipment_compliance = [];
  try {
    const { code, body } = await call(companyDataHandler, { action: 'list_equipment_compliance' });
    assert.equal(code, 200);
    assert.deepEqual(body.compliance, []);
  } finally {
    TABLES.equipment_compliance = saved;
  }
  const made = fake.calls.slice(before);
  assert.equal(made.filter(c => c.table === 'equipment').length, 0, 'nothing to filter means no fleet query at all');
});

// ── operationally gone: the printed weekly report ───────────────────────

test('a retired machine is absent from the weekly report\'s compliance snapshot', async () => {
  const report = await buildReportForCompanyWeek('acme', '2026-09-14', '2026-09-21');
  const items = report.compliance.items;
  assert.ok(!items.some(i => i.equipmentId === 2), "the sold machine's CVIP must not print");
  assert.deepEqual(items.map(i => i.equipmentId), [1]);
  // The counts in the section's header line come from the same folded set,
  // so they move with it rather than being computed separately.
  assert.equal(report.compliance.expiredCount, 1);
  // #1's registration is good until 2027 and is still counted as current.
  assert.equal(report.compliance.currentCount, 1);
});

// ── historically present: everything that must NOT change ───────────────

test('the retired machine keeps its full service history in list_records', async () => {
  const { code, body } = await call(maintenanceHandler, { action: 'list_records' });
  assert.equal(code, 200);
  const mine = body.records.filter(r => r.equipmentId === 2);
  assert.equal(mine.length, 2, 'both the PM service and the field service survive retirement');
  assert.ok(mine.every(r => r.equipmentRetired === true), 'and are still labelled as the retired machine');
  assert.ok(mine.every(r => r.equipmentLabel.includes('Deere')), 'a history that cannot name the machine is not a history');
});

test('a retired machine\'s id still resolves on submit — filtering here wedges an offline queue', async () => {
  // A worker inspects the dozer, goes out of service, the supervisor retires
  // it, the worker's queue drains a day later. This must still succeed:
  // drainQueue has no attempt cap, so a 403 blocks every later submission of
  // that form type forever.
  assert.equal(await resolveEquipmentId({ from: () => fakeSelect([{ id: 2, company_id: 'acme' }]) }, 'acme', 2), 2);
  assert.deepEqual(await resolveEquipmentIds({ from: () => fakeSelect([{ id: 2, company_id: 'acme' }]) }, 'acme', [2]), [2]);
});

test('companyEquipmentIndex still vets a retired machine\'s id, so stored records keep their join', async () => {
  const index = await companyEquipmentIndex({ from: () => fakeSelect(EQUIPMENT.filter(e => e.company_id === 'acme')) }, 'acme');
  assert.equal(index.get('2'), 2, 'a historical id that stopped resolving would silently lose its machine');
});

// Minimal builder stand-in for the three helpers above, which take a client
// rather than reading the module-scope one.
function fakeSelect(rows) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    not: () => builder,
    is: () => builder,
    limit: () => builder,
    then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  };
  return builder;
}

// ── the shared rule itself ──────────────────────────────────────────────

test('retiredEquipmentIds returns null on a read failure, so an outage shows too much rather than too little', async () => {
  const failing = { from: () => ({ select: () => ({ eq: () => ({ not: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }) }) };
  assert.equal(await retiredEquipmentIds(failing, 'acme'), null);
  // …and null means "unknown", which must leave every row in place.
  const rows = [{ equipment_id: 2 }];
  assert.deepEqual(withoutRetiredEquipment(rows, null), rows);
});

test('a row naming no machine, or a machine that is not known to be retired, is kept', () => {
  const retired = new Set(['2']);
  const rows = [{ equipment_id: 1 }, { equipment_id: 2 }, { equipment_id: null }, { equipment_id: 99 }];
  assert.deepEqual(withoutRetiredEquipment(rows, retired), [{ equipment_id: 1 }, { equipment_id: null }, { equipment_id: 99 }]);
});

test('ids are matched as strings, so a jsonb round trip cannot slip a retired machine through', () => {
  assert.deepEqual(withoutRetiredEquipment([{ equipment_id: '2' }], new Set(['2'])), []);
  assert.deepEqual(withoutRetiredEquipment([{ equipment_id: 2 }], new Set(['2'])), []);
});
