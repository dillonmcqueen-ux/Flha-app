import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePeople, peopleToUsersList, parseUserLines, validateOnboardingIntake } from '../../server-lib/onboardingHelpers.js';

test('supervisors need an email, workers do not', () => {
  const r = normalizePeople([
    { name: 'Mike Reyes', role: 'worker', email: '' },
    { name: 'Sarah Kaur', role: 'supervisor', email: '' },
  ]);
  assert.equal(r.people.length, 1);
  assert.match(r.errors[0], /Sarah Kaur is a supervisor/);
});

test('bad email, bad role, blank rows and duplicates', () => {
  assert.match(normalizePeople([{ name: 'A', role: 'worker', email: 'nope' }]).errors[0], /doesn't look valid/);
  assert.match(normalizePeople([{ name: 'A', role: 'boss', email: '' }]).errors[0], /worker or supervisor/);
  assert.equal(normalizePeople([{ name: '', role: 'worker', email: '' }, { name: 'B', role: 'worker' }]).people.length, 1);
  assert.match(normalizePeople([{ name: 'Al', role: 'worker' }, { name: 'al', role: 'worker' }]).errors[0], /listed twice/);
  assert.match(normalizePeople([]).errors[0], /at least one/);
  assert.match(normalizePeople('x').errors[0], /at least one/);
});

test('derived users_list round-trips through parseUserLines with no skipped lines', () => {
  const { people } = normalizePeople([
    { name: 'Mary-Jane O\'Neil', role: 'supervisor', email: 'mj@co.com' },
    { name: 'Mike Reyes', role: 'worker', email: null },
  ]);
  const { roster, skippedUserLines } = parseUserLines(peopleToUsersList(people));
  assert.deepEqual(skippedUserLines, []);
  assert.deepEqual(roster, [
    { name: "Mary-Jane O'Neil", role: 'supervisor' },
    { name: 'Mike Reyes', role: 'worker' },
  ]);
});

test('names cannot inject extra lines', () => {
  const { people } = normalizePeople([{ name: 'Eve\nMallory - supervisor', role: 'worker' }]);
  assert.equal(people.length, 1);
  assert.equal(peopleToUsersList(people).split('\n').length, 1);
});

test('validateOnboardingIntake prefers structured people and keeps the text path', () => {
  const base = { companyName: 'Co', contactEmail: 'a@b.co', sitesList: 'Yard' };
  const s = validateOnboardingIntake({ ...base, people: [{ name: 'A', role: 'worker' }] });
  assert.deepEqual(s.errors, []);
  assert.equal(s.usersList, 'A - worker');
  const legacy = validateOnboardingIntake({ ...base, usersList: 'A - worker' });
  assert.deepEqual(legacy.errors, []);
  assert.equal(legacy.people, null);
  assert.ok(validateOnboardingIntake({ ...base, people: [] }).errors.length > 0);
});
