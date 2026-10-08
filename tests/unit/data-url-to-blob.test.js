// A data: URL must be decoded in place, never fetched. The Content Security
// Policy in vercel.json has no data: in connect-src, so fetch(dataUrl) is
// refused in Chromium and signatures on Near Miss, Incident and Sign
// Afterwards failed to save.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dataUrlToBlob } from '../../src/dataUrlToBlob.js';

test('decodes a base64 PNG with the right type and bytes', async () => {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const url = 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
  const blob = dataUrlToBlob(url);
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
});

test('decodes a percent encoded data URL', async () => {
  const blob = dataUrlToBlob('data:image/svg+xml;utf8,<svg%20xmlns="x"/>');
  assert.equal(blob.type, 'image/svg+xml');
  assert.equal(await blob.text(), '<svg xmlns="x"/>');
});

test('rejects anything that is not a data URL', () => {
  assert.throws(() => dataUrlToBlob('https://example.com/a.png'));
  assert.throws(() => dataUrlToBlob(''));
  assert.throws(() => dataUrlToBlob(null));
});

test('the signing screens no longer fetch a data URL', () => {
  for (const f of ['NearMiss.jsx', 'Incident.jsx', 'SignAfterwards.jsx']) {
    const src = readFileSync(new URL('../../src/' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /fetch\((sig|signature)\)/, f);
    assert.match(src, /dataUrlToBlob\(/, f);
  }
});
