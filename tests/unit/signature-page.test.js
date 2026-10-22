// Send & Sign: the signature page appended to a sent PDF, and the
// complete_sent_document action that uses it.
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

process.env.SESSION_SECRET ||= 'test-session-secret';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';

const { appendSignaturePage, decodeSignatureDataUrl, sha256Hex, MAX_SIGNATURE_BYTES } =
  await import('../../server-lib/signaturePage.js');
const { handleSentDocument } = await import('../../server-lib/sentDocuments.js');

// A 1x1 transparent PNG.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const SIGNATURE = `data:image/png;base64,${PNG_B64}`;

async function samplePdf(pages = 2) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return Buffer.from(await doc.save());
}

test('decodeSignatureDataUrl accepts a PNG and rejects everything else', () => {
  assert.ok(decodeSignatureDataUrl(SIGNATURE).bytes.length > 0);
  for (const bad of [null, '', 'data:image/jpeg;base64,AAAA', 'data:image/png;base64,', `data:image/png;base64,${Buffer.from('not a png').toString('base64')}`, 'javascript:alert(1)']) {
    assert.ok(decodeSignatureDataUrl(bad).error, String(bad));
  }
  const huge = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(MAX_SIGNATURE_BYTES)]);
  assert.ok(decodeSignatureDataUrl(`data:image/png;base64,${huge.toString('base64')}`).error);
});

test('decodeSignatureDataUrl rejects a PNG that declares an oversized canvas', () => {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8); header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(60000, 16); header.writeUInt32BE(60000, 20);
  assert.ok(decodeSignatureDataUrl(`data:image/png;base64,${header.toString('base64')}`).error);
});

test('an encrypted or oversized PDF is refused rather than signed', async () => {
  const { PDFDocument: P } = await import('pdf-lib');
  const big = await P.create();
  for (let i = 0; i < 501; i++) big.addPage([100, 100]);
  await assert.rejects(appendSignaturePage({ originalBytes: Buffer.from(await big.save()), signerName: 'A', title: 'T', mode: 'read' }), /more than 500 pages/);
});

test('a signed copy is the original pages plus one record page', async () => {
  const original = await samplePdf(2);
  const out = await appendSignaturePage({
    originalBytes: original, signerName: 'Dana Fox', title: 'Winter driving', mode: 'sign',
    signatureBytes: decodeSignatureDataUrl(SIGNATURE).bytes, companyName: 'ABC Earthworks Company',
    signedAt: new Date('2026-10-21T17:03:00Z'),
  });
  assert.equal(out.pageCount, 3);
  assert.equal(out.originalSha256, sha256Hex(original));
  const reread = await PDFDocument.load(out.bytes);
  assert.equal(reread.getPageCount(), 3);
});

test('a read-only copy needs no signature image', async () => {
  const out = await appendSignaturePage({ originalBytes: await samplePdf(1), signerName: 'Dana Fox', title: 'Notice', mode: 'read' });
  assert.equal(out.pageCount, 2);
});

test('names and titles with characters Helvetica cannot draw do not break signing', async () => {
  const out = await appendSignaturePage({ originalBytes: await samplePdf(1), signerName: 'Zoë 山田', title: 'Règlement ☃', mode: 'read' });
  assert.equal(out.pageCount, 2);
});

test('a file that is not a PDF fails to sign', async () => {
  await assert.rejects(appendSignaturePage({ originalBytes: Buffer.from('not a pdf'), signerName: 'A', title: 'T', mode: 'read' }));
});

// ── complete_sent_document ────────────────────────────────────────────────

function fakeCompletionDb({ row, original, state = {} }) {
  state.uploads = []; state.removed = []; state.updates = [];
  const from = (table) => {
    const q = { filters: {} };
    q.select = () => q; q.eq = (k, v) => { q.filters[k] = v; return q; }; q.in = () => q; q.neq = () => q;
    q.update = (patch) => { q.patch = patch; return q; };
    q.limit = () => {
      if (table === 'sent_documents') return Promise.resolve({ data: row ? [row] : [], error: null });
      if (table === 'roster') return Promise.resolve({ data: [{ id: 3, name: 'Dana Fox', role: 'worker', is_owner: false, departments: [], divisions: [], default_site_id: null, company_id: 5 }], error: null });
      if (table === 'companies') return Promise.resolve({ data: [{ name: 'ABC Earthworks Company' }], error: null });
      return Promise.resolve({ data: [], error: null });
    };
    q.then = (resolve) => {
      if (q.patch) { state.updates.push(q.patch); return resolve({ data: state.updateRows ?? [{ id: row.id }], error: null }); }
      return resolve({ data: [], error: null });
    };
    return q;
  };
  return {
    from,
    storage: {
      from: () => ({
        download: async () => ({ data: { arrayBuffer: async () => original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength) }, error: null }),
        upload: async (path, bytes) => { state.uploads.push({ path, size: bytes.length }); return { error: null }; },
        remove: async (paths) => { state.removed.push(...paths); return { error: null }; },
      }),
    },
  };
}

const baseRow = { id: 9, roster_id: 3, company_id: 5, status: 'opened', mode: 'sign', category: 'training', title: 'Winter driving', original_path: '5/originals/abc-a.pdf' };
const worker = { role: 'worker', userId: 3, companyId: 5 };

test('complete_sent_document signs, files under company/person/category, and marks it done', async () => {
  const state = {};
  const db = fakeCompletionDb({ row: baseRow, original: await samplePdf(1), state });
  const out = await handleSentDocument({ supabase: db, session: worker, companyId: 5, action: 'complete_sent_document', body: { id: 9, signature: SIGNATURE } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.match(state.uploads[0].path, /^5\/3\/training\/\d+-[0-9a-f]{16}-signed\.pdf$/);
  assert.equal(state.updates[0].status, 'completed');
  assert.ok(state.updates[0].signed_sha256 && state.updates[0].original_sha256);
});

test('complete_sent_document refuses a missing or bad signature on a Sign document', async () => {
  const db = fakeCompletionDb({ row: baseRow, original: await samplePdf(1) });
  for (const signature of [undefined, 'data:image/png;base64,AAAA']) {
    const out = await handleSentDocument({ supabase: db, session: worker, companyId: 5, action: 'complete_sent_document', body: { id: 9, signature } });
    assert.equal(out.status, 400);
  }
});

test('complete_sent_document: Read documents need no signature', async () => {
  const db = fakeCompletionDb({ row: { ...baseRow, mode: 'read' }, original: await samplePdf(1) });
  const out = await handleSentDocument({ supabase: db, session: worker, companyId: 5, action: 'complete_sent_document', body: { id: 9 } });
  assert.equal(out.status, 200);
});

test('complete_sent_document: only the recipient, only after opening, only once', async () => {
  const original = await samplePdf(1);
  const call = (rowPatch, session = worker) => handleSentDocument({
    supabase: fakeCompletionDb({ row: { ...baseRow, ...rowPatch }, original }), session, companyId: 5,
    action: 'complete_sent_document', body: { id: 9, signature: SIGNATURE },
  });
  assert.equal((await call({ roster_id: 4 })).status, 403);   // someone else's document
  assert.equal((await call({ status: 'sent' })).status, 400);  // not opened yet
  assert.equal((await call({ status: 'completed' })).status, 400);
  assert.equal((await call({ status: 'cancelled' })).status, 404);
});

test('complete_sent_document removes the signed file if the row changed underneath it', async () => {
  const state = { updateRows: [] };
  const db = fakeCompletionDb({ row: baseRow, original: await samplePdf(1), state });
  const out = await handleSentDocument({ supabase: db, session: worker, companyId: 5, action: 'complete_sent_document', body: { id: 9, signature: SIGNATURE } });
  assert.equal(out.status, 409);
  assert.equal(state.removed.length, 1);
  assert.equal(state.removed[0], state.uploads[0].path);
});
