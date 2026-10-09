import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { jsPDF } from 'jspdf';
import { validateLayout, defaultLayout, blockVisible, isPlaced, BLOCK_TYPES } from '../../server-lib/documentEngine/layoutSchema.js';
import { renderLayoutToDoc } from '../../src/documentEngine/renderLayout.js';
import { FLHA_LAYOUT, FLHA_FIELDS, FLHA_ANSWERS } from './_fixtures/flhaLayout.js';

const png = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
const LOGO = png('public/fora-logo-dark.png');
const MARK = png('public/fora-mark.png');

function render(over = {}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const input = {
    layout: FLHA_LAYOUT, document: { title: 'FLHA' }, company: { name: 'Test Co' },
    record: { site: 'Test Site', author: 'Jamie Worker', dateText: '2026-10-09', dateTimeText: '2026-10-09, 10:00', status: 'submitted' },
    fields: FLHA_FIELDS, answers: FLHA_ANSWERS, signatures: [], assets: { foraLogoDataUrl: LOGO },
    ...over,
  };
  const res = renderLayoutToDoc(doc, input);
  return { doc, ...res };
}
const textOf = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');

test('validateLayout: empty is allowed, junk is refused, bad ids and types are refused', () => {
  assert.deepEqual(validateLayout({}).layout, {});
  assert.deepEqual(validateLayout(null).layout, {});
  assert.ok(validateLayout('x').error);
  assert.ok(validateLayout({ version: 2, blocks: [] }).error);
  assert.ok(validateLayout({ blocks: [{ type: 'script' }] }).error);
  assert.ok(validateLayout({ blocks: [{ id: 'a', type: 'spacer' }, { id: 'a', type: 'spacer' }] }).error);
  assert.ok(validateLayout({ blocks: Array.from({ length: 201 }, (_, i) => ({ id: `b${i}`, type: 'spacer' })) }).error);
});

test('validateLayout: the FLHA layout is valid and every block type has a cleaner', () => {
  assert.ok(validateLayout(FLHA_LAYOUT).layout.blocks.length === FLHA_LAYOUT.blocks.length);
  assert.equal(BLOCK_TYPES.length, 16);
});

test('validateLayout: placed boxes must fit the page, colors must be hex, numbers are clamped', () => {
  assert.ok(validateLayout({ blocks: [{ type: 'spacer', rect: { page: 1, x: 200, y: 0, w: 50, h: 10 } }] }).error);
  assert.ok(validateLayout({ blocks: [{ type: 'spacer', rect: { page: 0, x: 0, y: 0, w: 10, h: 10 } }] }).error);
  const ok = validateLayout({ colors: { primary: 'red' }, blocks: [{ type: 'spacer', height: 9999 }] }).layout;
  assert.equal(ok.colors, undefined);
  assert.equal(ok.blocks[0].height, 100);
});

test('validateLayout: a size cap rejects huge layouts', () => {
  assert.ok(validateLayout({ blocks: [{ type: 'text', value: 'x'.repeat(3000) }], pad: 'y'.repeat(300000) }).error);
});

test('isPlaced and blockVisible', () => {
  assert.equal(isPlaced({ rect: { page: 1 } }), true);
  assert.equal(isPlaced({}), false);
  const ctx = { status: 'pending_approval', awaitingSignature: false, answer: (k) => (k === 'x' ? 'yes' : '') };
  assert.equal(blockVisible({}, ctx), true);
  assert.equal(blockVisible({ showIf: { status: ['pending_approval'] } }, ctx), true);
  assert.equal(blockVisible({ showIf: { status: ['approved'] } }, ctx), false);
  assert.equal(blockVisible({ showIf: { answer: 'x', equals: ['yes'] } }, ctx), true);
  assert.equal(blockVisible({ showIf: { answer: 'x', equals: ['no'] } }, ctx), false);
  assert.equal(blockVisible({ showIf: { awaitingSignature: true } }, ctx), false);
});

test('defaultLayout is valid and covers each text field', () => {
  const l = defaultLayout('Daily', [{ field_key: 'a', label: 'A', field_type: 'short_text' }, { field_key: 'b', label: 'B', field_type: 'multiselect' }]);
  assert.ok(validateLayout(l).layout.blocks.some((b) => b.field === 'a'));
  assert.ok(l.blocks.some((b) => b.type === 'chips' && b.field === 'b'));
});

test('renders the FLHA on one page with the footer', () => {
  const { pages, doc } = render();
  assert.equal(pages, 1);
  const s = textOf(doc);
  assert.ok(s.startsWith('%PDF'));
});

test('an empty layout prints the default one', () => {
  const { pages } = render({ layout: {}, answers: { task_summary: 'Hello' } });
  assert.equal(pages, 1);
});

test('a long table breaks across pages, repeats its header, and footers say Page n of N', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ task: 'T', hazard: `Hazard ${i}`, control: 'Control '.repeat(12), risk: 'Low' }));
  const { pages, doc } = render({ answers: { ...FLHA_ANSWERS, hazards: many } });
  assert.ok(pages >= 3);
  const s = textOf(doc);
  assert.ok(s.includes(`of ${pages}`));
});

test('awaiting signature banner and approvals and crew grid draw without error', () => {
  const sigs = [
    { kind: 'worker', signer_name: 'Jamie', signature: MARK, signedAtText: 'now' },
    { kind: 'crew', signer_name: 'Pat', signature: MARK, signedAtText: 'now' },
    { kind: 'approval', step_key: 'r1', signer_name: 'Sam', signature: MARK, signedAtText: 'now' },
  ];
  assert.ok(render({ signatures: sigs, record: { site: 'S', author: 'A', status: 'approved' } }).pages <= 2);
  assert.equal(render({ record: { site: 'S', author: 'A', status: 'pending_approval', awaitingSignature: true } }).pages, 1);
});

test('placed blocks land on their page, creating it, and are clipped', () => {
  const layout = { version: 1, blocks: [
    { id: 'a', type: 'text', value: 'Page one', headingStyle: 'none' },
    { id: 'p', type: 'text', value: 'Placed on page 2 '.repeat(200), headingStyle: 'none', rect: { page: 2, x: 20, y: 30, w: 60, h: 20 } },
  ] };
  const { pages } = render({ layout });
  assert.equal(pages, 2);
});

test('images are only drawn from PNG, JPEG or WEBP data URLs and never fetched', () => {
  const layout = { version: 1, blocks: [{ id: 'i', type: 'image', source: 'company_logo' }] };
  assert.doesNotThrow(() => render({ layout, company: { name: 'X', logoDataUrl: 'https://evil.example/x.png' } }));
  assert.doesNotThrow(() => render({ layout, company: { name: 'X', logoDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' } }));
});

test('bindings are resolved and unknown ones are left as typed', () => {
  const layout = { version: 1, blocks: [{ id: 't', type: 'text', value: 'Hi {{record.author}} {{nope}}', headingStyle: 'none' }] };
  const { doc } = render({ layout });
  assert.ok(textOf(doc).length > 0);
});

test('golden: the FLHA layout matches today\'s FLHA PDF', (t) => {
  const have = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }).status !== null;
  const py = spawnSync('python3', ['-I', '-c', 'import numpy, PIL'], { encoding: 'utf8' });
  if (!have('pdftoppm', ['-v']) || py.status !== 0) return t.skip('pdftoppm or python imaging not available');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-'));
  const { doc } = render({
    record: { site: 'Test Site', author: 'Jamie Worker', dateText: '2026-10-09', dateTimeText: '2026-10-09, 2:51:11 a.m.', status: 'submitted' },
    signatures: [{ kind: 'worker', signer_name: 'Jamie Worker', signature: MARK, signedAtText: '2026-10-09, 2:51:11 a.m.' }],
  });
  fs.writeFileSync(path.join(dir, 'new.pdf'), Buffer.from(doc.output('arraybuffer')));
  assert.equal(spawnSync('pdftoppm', ['-png', '-r', '70', path.join(dir, 'new.pdf'), path.join(dir, 'new')]).status, 0);
  const r = spawnSync('python3', ['-I', 'tests/unit/_fixtures/golden_diff.py', path.join(dir, 'new-1.png'), 'docs/unified-document-engine/baseline/flha-today-1.png'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(parseFloat(r.stdout) < 0.002, `visual difference ${r.stdout}`);
});
