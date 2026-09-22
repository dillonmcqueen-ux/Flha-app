// Pins the employee-number rules on a roster row.
//
// `roster.employee_id` is the employer's own number for a person, added so a
// future HRIS sync (Workday, BambooHR, ADP) can say which FORA roster row is
// which of its workers. Nothing reads it yet — that is deliberate and is
// recorded on the interaction map — but the rules around it have to be right
// from the first row that carries one, because a join key that goes
// ambiguous is worse than no join key.
//
// What these cases exist to stop coming back:
//   * a supervisor setting a number on ANOTHER company's person;
//   * two roster rows in one company answering to the same number, which is
//     exactly the ambiguity an HRIS sync cannot resolve;
//   * that check ignoring DEACTIVATED people — the rule here is deliberately
//     the opposite of equipment asset IDs (activeUnitNumberClash, which
//     ignores retired machines because unit numbers get reused). An employee
//     number is not reused when somebody leaves;
//   * losing the ability to CLEAR one, which is the only way to move a
//     number off the wrong person and onto the right one.
//
// Runs the real handler against a stand-in PostgREST server, the approach
// tests/unit/stripe-webhook-handler.test.js and
// tests/unit/retired-equipment-scope.test.js both use, so what is asserted
// is what the handler puts on the wire. That file's stand-in is GET-only;
// this one needs PATCH, so it carries its own rather than changing a harness
// another test depends on.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const SESSION_SECRET = 'test-session-secret';
process.env.SESSION_SECRET = SESSION_SECRET;
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

// One company with four people. Dana is DEACTIVATED and holds a number —
// she is the whole point of the deactivated case below. Erin belongs to
// somebody else and must never be reachable.
let ROSTER = [];
function resetRoster() {
  ROSTER = [
    { id: 1, company_id: 'acme', name: 'Alex',  role: 'worker',     active: true,  employee_id: 'A-1001' },
    { id: 2, company_id: 'acme', name: 'Bailey', role: 'worker',    active: true,  employee_id: null },
    { id: 3, company_id: 'acme', name: 'Dana',  role: 'worker',     active: false, employee_id: 'A-1099' },
    { id: 9, company_id: 'rival', name: 'Erin', role: 'supervisor', active: true,  employee_id: null },
  ];
}
resetRoster();

function startFakeSupabase() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const table = url.pathname.replace('/rest/v1/', '');

    // `.single()` sends Accept: application/vnd.pgrst.object+json and real
    // PostgREST answers it with a BARE OBJECT, not a one-element array.
    // Getting this wrong makes `data.employee_id` undefined on a response
    // the handler reads correctly in production — a stand-in that lies is
    // worse than no stand-in, so it is modelled here.
    const wantsObject = String(req.headers.accept || '').includes('vnd.pgrst.object');
    const send = (code, rows) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(wantsObject && Array.isArray(rows) ? (rows[0] ?? null) : rows));
    };
    if (table !== 'roster') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: `fake PostgREST: no table ${table}` }));
    }

    const match = (row) => {
      for (const [key, value] of url.searchParams.entries()) {
        if (key === 'select' || key === 'order' || key === 'limit' || key === 'offset') continue;
        const [op, raw] = value.split(/\.(.+)/);
        const v = row[key];
        if (op === 'eq' && String(v) !== raw) return false;
        if (op === 'is' && !(raw === 'null' ? (v === null || v === undefined) : String(v) === raw)) return false;
      }
      return true;
    };

    if (req.method === 'GET') {
      return send(200, ROSTER.filter(match).map(r => ({ ...r })));
    }

    if (req.method === 'PATCH') {
      let raw = '';
      req.on('data', c => { raw += c; });
      return req.on('end', () => {
        const patch = JSON.parse(raw || '{}');
        const targets = ROSTER.filter(match);

        // The partial unique index the migration creates, modelled: per
        // company, case-insensitive, blanks excluded. Without this the test
        // could not tell a handler-side check from a database-side one.
        if (patch.employee_id) {
          const wanted = String(patch.employee_id).trim().toLowerCase();
          const clash = ROSTER.some(r =>
            r.company_id === targets[0]?.company_id &&
            !targets.includes(r) &&
            String(r.employee_id || '').trim().toLowerCase() === wanted);
          if (clash) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint' }));
          }
        }

        targets.forEach(r => Object.assign(r, patch));
        send(200, targets.map(r => ({ ...r })));
      });
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'fake PostgREST: method not allowed' }));
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

const fake = await startFakeSupabase();
process.env.SUPABASE_URL = fake.url; // before the import: the client is built at module scope
const companyDataHandler = (await import('../../api/companydata.js')).default;

test.after(() => fake.server.close());

function supervisorToken(companyId = 'acme') {
  const payload = Buffer.from(JSON.stringify({ role: 'supervisor', companyId, name: 'Sup', issuedAt: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

async function setEmployeeId(body, companyId = 'acme') {
  let captured = { code: null, body: null };
  const res = {
    status(code) { captured.code = code; return res; },
    json(payload) { captured.body = payload; return res; },
  };
  await companyDataHandler(
    { method: 'POST', body: { token: supervisorToken(companyId), action: 'set_roster_employee_id', ...body } },
    res,
  );
  return captured;
}

test('a supervisor sets an employee number on their own roster', async () => {
  resetRoster();
  const { code, body } = await setEmployeeId({ id: 2, employeeId: 'A-1002' });
  assert.equal(code, 200);
  assert.equal(body.member.employee_id, 'A-1002');
  assert.equal(ROSTER.find(r => r.id === 2).employee_id, 'A-1002');
});

test("another company's person is a 403, not a silent no-op", async () => {
  resetRoster();
  const { code, body } = await setEmployeeId({ id: 9, employeeId: 'X-1' }, 'acme');
  assert.equal(code, 403);
  assert.match(body.error, /Not allowed/);
  assert.equal(ROSTER.find(r => r.id === 9).employee_id, null, "the rival company's row must be untouched");
});

test('a number already held by an ACTIVE colleague is refused, and names them', async () => {
  resetRoster();
  const { code, body } = await setEmployeeId({ id: 2, employeeId: 'A-1001' });
  assert.equal(code, 409);
  assert.match(body.error, /Alex/);
  assert.equal(ROSTER.find(r => r.id === 2).employee_id, null);
});

test('a number held by a DEACTIVATED colleague is refused too — this is where employees differ from machines', async () => {
  // Equipment asset IDs deliberately ignore retired machines, because unit
  // numbers get reused. Employee numbers do not, and a rehire keeps their
  // own row via reactivate_roster_member rather than getting a second one.
  resetRoster();
  const { code, body } = await setEmployeeId({ id: 2, employeeId: 'A-1099' });
  assert.equal(code, 409);
  assert.match(body.error, /Dana/);
  assert.match(body.error, /deactivated/i, 'the message should say why that person is not on screen');
});

test('case and surrounding space do not create a second number', async () => {
  resetRoster();
  const { code } = await setEmployeeId({ id: 2, employeeId: '  a-1001  ' });
  assert.equal(code, 409, '"  a-1001  " and "A-1001" are the same number to anyone typing it');
});

test('setting a number on a deactivated person is allowed — an HRIS export names leavers', async () => {
  resetRoster();
  const { code, body } = await setEmployeeId({ id: 3, employeeId: 'A-2000' });
  assert.equal(code, 200);
  assert.equal(body.member.employee_id, 'A-2000');
});

test('blank clears it, which is the only way to move a number to the right person', async () => {
  resetRoster();
  const cleared = await setEmployeeId({ id: 1, employeeId: '   ' });
  assert.equal(cleared.code, 200);
  assert.equal(cleared.body.member.employee_id, null, 'blank stores null, not an empty string');

  // And now it is free for somebody else.
  const reassigned = await setEmployeeId({ id: 2, employeeId: 'A-1001' });
  assert.equal(reassigned.code, 200);
  assert.equal(reassigned.body.member.employee_id, 'A-1001');
});

test('re-saving the same number on the same person is not a self-collision', async () => {
  resetRoster();
  const { code } = await setEmployeeId({ id: 1, employeeId: 'A-1001' });
  assert.equal(code, 200, 'excludeId must keep a row from clashing with itself');
});

test('a missing id is rejected before any query', async () => {
  resetRoster();
  const { code } = await setEmployeeId({ employeeId: 'A-3000' });
  assert.equal(code, 400);
});
