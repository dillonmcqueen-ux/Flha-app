// What drainQueue does with a submission the server will NEVER accept.
//
// Before this, drainQueue caught every failure the same way: markAttempt,
// then `break`. There is no attempt cap, so one permanently-rejected item
// wedged that worker's whole queue for that form type forever — every later
// submission of the same form sat behind it and was never sent. Thirteen
// components drain queues, and the items behind the stuck one are signed
// safety documents.
//
// That was survivable only because nothing on the server rejected a
// well-formed submit permanently. Break #21 changes that: a submit for a
// module the company does not have now 403s, and a 403 is the same answer
// every time. So the drop path has to exist FIRST, or the gate wedges every
// offline worker at a company that drops a module.
//
// The rule these cases pin:
//   * 4xx (except 401/408/425/429) — the server will never accept this
//     payload. Drop it, and REPORT it, because it is still lost work.
//   * network failure, 5xx, anything with no status — retry is correct.
//     Keep the existing stop-and-preserve-order behaviour.
//   * 401 in particular is NOT permanent: the payload is fine, the token is
//     stale. A worker who logs back in must still get their queue drained.
//
// IndexedDB is stood up in-process below rather than mocked away, so the
// ordering these cases assert is the real store's ordering.

import test from 'node:test';
import assert from 'node:assert/strict';

import { installFakeIndexedDB } from './helpers/fakeIndexedDB.js';

const fakeIdb = installFakeIndexedDB();

const { enqueueSubmission, drainQueue, listQueued } = await import('../../src/offlineQueue.js');

function rejection(status, message) {
  const err = new Error(message || `Save failed (${status})`);
  err.isServerError = true;
  err.status = status;
  return err;
}

function networkFailure() {
  const err = new Error('Failed to fetch');
  err.isNetworkFailure = true;
  return err;
}

test.beforeEach(() => { fakeIdb.reset(); });

test('a permanently-rejected item is dropped instead of wedging the queue behind it', async () => {
  await enqueueSubmission('fuellog', 'csid-1', { note: 'first' });
  await enqueueSubmission('fuellog', 'csid-2', { note: 'second' });
  await enqueueSubmission('fuellog', 'csid-3', { note: 'third' });

  const seen = [];
  const result = await drainQueue('fuellog', async (payload) => {
    seen.push(payload.note);
    // The shape break #21 introduces: the company does not have the Fuel
    // module, so this answer never changes no matter how often it is asked.
    if (payload.note === 'first') throw rejection(403, "Your company doesn't have Fuel & Consumables turned on.");
    return { ok: true };
  });

  assert.deepEqual(seen, ['first', 'second', 'third'], 'the two behind it must still be sent, in order');
  assert.equal(result.succeeded, 2);
  assert.equal(result.remaining, 0, 'nothing is left queued — the poison item is gone, not stuck');
  assert.equal((await listQueued('fuellog')).length, 0);
});

test('the dropped item is reported back, not silently discarded', async () => {
  await enqueueSubmission('fuellog', 'csid-1', { note: 'first', litres: 40 });

  const result = await drainQueue('fuellog', async () => {
    throw rejection(403, "Your company doesn't have Fuel & Consumables turned on.");
  });

  assert.ok(Array.isArray(result.dropped), 'drainQueue must report drops the way it reports pdfUnlinked');
  assert.equal(result.dropped.length, 1);
  const dropped = result.dropped[0];
  assert.equal(dropped.clientSubmissionId, 'csid-1');
  assert.equal(dropped.formType, 'fuellog');
  assert.equal(dropped.status, 403);
  assert.match(dropped.reason, /Fuel & Consumables/, 'the worker has to be told why their entry went nowhere');
  assert.deepEqual(dropped.payload, { note: 'first', litres: 40 }, 'the work itself comes back, so it can be shown or re-entered');
});

test('a transient failure still stops the drain and keeps everything queued, in order', async () => {
  await enqueueSubmission('inspection', 'csid-1', { note: 'first' });
  await enqueueSubmission('inspection', 'csid-2', { note: 'second' });

  const seen = [];
  const result = await drainQueue('inspection', async (payload) => {
    seen.push(payload.note);
    throw networkFailure();
  });

  assert.deepEqual(seen, ['first'], 'a dead connection must not be hammered with the rest of the queue');
  assert.equal(result.remaining, 2, 'nothing is dropped on a failure that could succeed later');
  assert.deepEqual(result.dropped, []);
  const still = await listQueued('inspection');
  assert.equal(still.length, 2);
  assert.equal(still[0].clientSubmissionId, 'csid-1', 'order is preserved for the retry');
  assert.equal(still[0].attempts, 1, 'the attempt is still counted');
});

test('a 5xx is transient — the server is broken, the submission is not', async () => {
  await enqueueSubmission('daily', 'csid-1', { note: 'first' });
  const result = await drainQueue('daily', async () => { throw rejection(500, 'Server error. Please try again.'); });
  assert.equal(result.remaining, 1);
  assert.deepEqual(result.dropped, []);
  assert.equal((await listQueued('daily')).length, 1, 'a 500 must never lose a signed document');
});

test('a 401 is NOT permanent: the token is stale, the payload is fine', async () => {
  // Receipts carry no expiry and a queued item can drain days later, so an
  // expired session is a normal thing to meet on the way out. Dropping here
  // would throw away a shift's work over a re-login.
  await enqueueSubmission('toolbox', 'csid-1', { note: 'first' });
  const result = await drainQueue('toolbox', async () => { throw rejection(401, 'Not logged in. Please log in again.'); });
  assert.equal(result.remaining, 1);
  assert.deepEqual(result.dropped, []);
  assert.equal((await listQueued('toolbox')).length, 1);
});

test('a 503 from the module gate itself keeps the submission queued', async () => {
  // requireDocKey answers a FAILED settings lookup with 503 rather than
  // 403 precisely so this stays true: "I could not check" must not cost a
  // worker their queued shift the way "you do not have this module" does.
  await enqueueSubmission('fuellog', 'csid-1', { note: 'first' });
  const result = await drainQueue('fuellog', async () => {
    throw rejection(503, "Couldn't check which modules your company has. Please try again.");
  });
  assert.equal(result.remaining, 1);
  assert.deepEqual(result.dropped, []);
});

test('a 429 is NOT permanent — it is the server asking to be asked again', async () => {
  await enqueueSubmission('nearmiss', 'csid-1', { note: 'first' });
  const result = await drainQueue('nearmiss', async () => { throw rejection(429, 'Too many requests.'); });
  assert.equal(result.remaining, 1);
  assert.deepEqual(result.dropped, []);
});

test('an error with no status at all is treated as transient', async () => {
  // The resubmit functions do more than one round trip (PDF generation, a
  // signed-upload step). A throw from one of those inner steps carries no
  // HTTP status, and guessing "permanent" there would delete real work.
  await enqueueSubmission('incident', 'csid-1', { note: 'first' });
  const result = await drainQueue('incident', async () => { throw new Error('upload failed'); });
  assert.equal(result.remaining, 1);
  assert.deepEqual(result.dropped, []);
  assert.equal((await listQueued('incident')).length, 1);
});

test('a 400 from a validation rule the payload can never satisfy is dropped', async () => {
  await enqueueSubmission('monthly', 'csid-1', { note: 'first' });
  await enqueueSubmission('monthly', 'csid-2', { note: 'second' });
  const result = await drainQueue('monthly', async (payload) => {
    if (payload.note === 'first') throw rejection(400, 'Missing details.');
    return { ok: true };
  });
  assert.equal(result.dropped.length, 1);
  assert.equal(result.dropped[0].status, 400);
  assert.equal(result.succeeded, 1);
  assert.equal(result.remaining, 0);
});

test('drops and pdfUnlinked are counted independently in the same drain', async () => {
  await enqueueSubmission('flha', 'csid-1', { note: 'first' });
  await enqueueSubmission('flha', 'csid-2', { note: 'second' });
  const result = await drainQueue('flha', async (payload) => {
    if (payload.note === 'first') throw rejection(403, 'no module');
    return { pdfLinked: false };
  });
  assert.equal(result.dropped.length, 1);
  assert.equal(result.pdfUnlinked, 1);
  assert.equal(result.succeeded, 1);
});
