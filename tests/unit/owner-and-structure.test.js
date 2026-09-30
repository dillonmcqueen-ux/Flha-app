import test from 'node:test';
import assert from 'node:assert/strict';
import { planRoster } from '../../server-lib/onboardingRoster.js';
import { normalizePeople } from '../../server-lib/onboardingHelpers.js';
import { isFounder, isOwner, canManageCompany } from '../../server-lib/ownerAccess.js';
import { departmentKeyFromLabel, cleanLabel, cleanTitle } from '../../server-lib/companyStructure.js';
import { prettifyDepartmentKey } from '../../server-lib/portalDepartments.js';

const roster = [
  { name: 'Pat Lee', role: 'supervisor' },
  { name: 'Sam Roe', role: 'worker' },
];
const details = new Map([
  ['pat lee', { email: 'pat@acme.ca', title: 'Superintendent', departments: ['safety'], division: 'Paving', site: 'Main Yard' }],
  ['sam roe', { email: null, title: 'Operator', departments: [], division: 'Paving', site: null }],
]);

test('the contact is matched to a listed person by email and becomes the owner', () => {
  const plan = planRoster(roster, details, { name: 'Someone', email: 'PAT@acme.ca' });
  assert.equal(plan.length, 2);
  assert.equal(plan[0].isOwner, true);
  assert.equal(plan[1].isOwner, false);
  assert.equal(plan[0].title, 'Superintendent');
  assert.deepEqual(plan[0].departments, ['safety']);
});

test('a contact listed as a worker is promoted to supervisor when made owner', () => {
  const plan = planRoster(roster, details, { name: 'Sam Roe', email: 'sam@acme.ca' });
  const sam = plan.find((p) => p.name === "Sam Roe");
  assert.equal(sam.isOwner, true);
  assert.equal(sam.role, 'supervisor');
  assert.equal(sam.email, 'sam@acme.ca');
});

test('a contact who is not listed is added as a supervisor owner', () => {
  const plan = planRoster(roster, details, { name: 'Dana Owner', email: 'dana@acme.ca' });
  assert.equal(plan.length, 3);
  const dana = plan[2];
  assert.equal(dana.isOwner, true);
  assert.equal(dana.role, 'supervisor');
  assert.equal(dana.email, 'dana@acme.ca');
});

test('no contact email means no owner is invented', () => {
  const plan = planRoster(roster, details, { name: '', email: '' });
  assert.equal(plan.some((p) => p.isOwner), false);
});

test('intake keeps only built-in departments and trims profile fields', () => {
  const { people, errors } = normalizePeople([
    { name: 'Pat Lee', role: 'supervisor', email: 'pat@acme.ca', title: '  Foreman ', division: 'Paving', site: 'Main Yard', departments: ['safety', 'bogus', 'safety'] },
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(people[0].departments, ['safety']);
  assert.equal(people[0].title, 'Foreman');
});

test('owner and founder gates', () => {
  assert.equal(isFounder({ role: 'admin' }), true);
  assert.equal(isFounder({ role: 'admin', userId: 4 }), false);
  assert.equal(isOwner({ role: 'supervisor', userId: 4, isOwner: true }), true);
  assert.equal(isOwner({ role: 'supervisor', userId: 4 }), false);
  assert.equal(isOwner({ role: 'worker', userId: 4, isOwner: true }), false);
  assert.equal(canManageCompany({ role: 'supervisor', userId: 4 }), false);
  assert.equal(canManageCompany({ role: 'supervisor', userId: 4, isOwner: true }), true);
  assert.equal(canManageCompany({ role: 'admin' }), true);
  assert.equal(canManageCompany(null), false);
});

test('custom department keys are prefixed so they never equal a built-in', () => {
  assert.equal(departmentKeyFromLabel('Yard Crew'), 'c_yard_crew');
  assert.equal(departmentKeyFromLabel('Safety'), 'c_safety');
  assert.equal(departmentKeyFromLabel('!!!'), '');
  assert.equal(prettifyDepartmentKey('c_yard_crew'), 'Yard Crew');
  assert.equal(cleanLabel('  a   b  '), 'a b');
  assert.equal(cleanTitle('x'.repeat(200)).length, 80);
});

test('a same-name person with a different email does not become the owner', () => {
  const plan = planRoster(
    [{ name: 'Bob Stone', role: 'supervisor' }],
    new Map([['bob stone', { email: 'bob@x.ca' }]]),
    { name: 'Bob Stone', email: 'contact@y.ca' },
  );
  assert.equal(plan.length, 2);
  assert.equal(plan[0].isOwner, false);
  assert.equal(plan[1].isOwner, true);
  assert.equal(plan[1].email, 'contact@y.ca');
});
