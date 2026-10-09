import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE, snap, fitRect, addBlock, moveBlock, resizeBlock, deleteBlock, duplicateBlock, placeFlowBlock,
  alignBlocks, hitTest, reorder, pageCount, checkedLayout, emptyLayout, updateBlock, setRect, movePage, mmToPx, pxToMm,
} from '../../src/documentEngine/editorModel.js';
import { BLOCK_TYPES, MAX_BLOCKS } from '../../server-lib/documentEngine/layoutSchema.js';
import { FLHA_LAYOUT } from './_fixtures/flhaLayout.js';

const rectOf = (l, id) => l.blocks.find((b) => b.id === id).rect;

test('every palette block validates on the server schema', () => {
  for (const p of PALETTE) {
    assert.ok(BLOCK_TYPES.includes(p.type), p.type);
    const { layout, id, error } = addBlock(emptyLayout(), p.type, 1, 10, 10);
    assert.equal(error, undefined);
    const out = checkedLayout(layout);
    assert.equal(out.error, undefined, `${p.type}: ${out.error}`);
    assert.ok(id);
  }
});

test('snap and fitRect keep boxes on the page and no smaller than the minimum', () => {
  assert.equal(snap(10.4), 10);
  assert.equal(snap(10.6), 11);
  assert.deepEqual(fitRect({ page: 1, x: 500, y: -5, w: 1, h: 1000 }), { page: 1, x: 204, y: 0, w: 6, h: 297 });
});

test('addBlock gives unique ids, clamps to the page, and respects the block cap', () => {
  let l = emptyLayout();
  l = addBlock(l, 'text', 1, 200, 290).layout;
  l = addBlock(l, 'text', 1, 5, 5).layout;
  assert.deepEqual(l.blocks.map((b) => b.id), ['text_1', 'text_2']);
  const r = rectOf(l, 'text_1');
  assert.ok(r.x + r.w <= 210 && r.y + r.h <= 297);
  assert.ok(addBlock(l, 'nope', 1, 0, 0).error);
  const full = { ...emptyLayout(), blocks: Array.from({ length: MAX_BLOCKS }, (_, i) => ({ id: `s${i}`, type: 'spacer' })) };
  assert.ok(addBlock(full, 'text', 1, 0, 0).error);
});

test('move and resize snap, clamp, and ignore flow blocks', () => {
  let l = addBlock(emptyLayout(), 'box', 1, 10, 10).layout;
  l = moveBlock(l, 'box_1', 3.4, 5.6);
  assert.deepEqual([rectOf(l, 'box_1').x, rectOf(l, 'box_1').y], [13, 16]);
  l = moveBlock(l, 'box_1', -500, -500);
  assert.deepEqual([rectOf(l, 'box_1').x, rectOf(l, 'box_1').y], [0, 0]);
  l = resizeBlock(l, 'box_1', -500, 1000);
  assert.deepEqual([rectOf(l, 'box_1').w, rectOf(l, 'box_1').h], [6, 297]);
  const flow = { ...emptyLayout(), blocks: [{ id: 'f', type: 'spacer', height: 5 }] };
  assert.deepEqual(moveBlock(flow, 'f', 10, 10), flow);
});

test('delete, duplicate, reorder, page moves and updates', () => {
  let l = addBlock(emptyLayout(), 'text', 1, 10, 10).layout;
  const d = duplicateBlock(l, 'text_1');
  assert.equal(d.layout.blocks.length, 2);
  assert.equal(rectOf(d.layout, d.id).x, 14);
  l = reorder(d.layout, 'text_1', true);
  assert.equal(l.blocks[1].id, 'text_1');
  l = movePage(l, 'text_1', 3);
  assert.equal(pageCount(l), 3);
  l = updateBlock(l, 'text_1', { value: 'Hi', type: 'box', id: 'x', rect: null });
  const b = l.blocks.find((x) => x.id === 'text_1');
  assert.equal(b.value, 'Hi'); assert.equal(b.type, 'text'); assert.ok(b.rect);
  l = setRect(l, 'text_1', { w: 3 });
  assert.equal(rectOf(l, 'text_1').w, 6);
  assert.equal(deleteBlock(l, 'text_1').blocks.length, 1);
});

test('placeFlowBlock turns a flow block into a placed one and keeps placed ones', () => {
  const l = placeFlowBlock(FLHA_LAYOUT, 'summary', 2);
  const b = l.blocks.find((x) => x.id === 'summary');
  assert.equal(b.rect.page, 2);
  assert.equal(checkedLayout(l).error, undefined);
  const again = placeFlowBlock(l, 'summary', 3);
  assert.equal(again.blocks.find((x) => x.id === 'summary').rect.page, 2);
});

test('alignBlocks lines up to the first block on the same page only', () => {
  let l = addBlock(emptyLayout(), 'box', 1, 10, 10).layout;
  l = addBlock(l, 'box', 1, 50, 60).layout;
  l = addBlock(l, 'box', 2, 90, 90).layout;
  const ids = ['box_1', 'box_2', 'box_3'];
  const a = alignBlocks(l, ids, 'left');
  assert.equal(rectOf(a, 'box_2').x, 10);
  assert.equal(rectOf(a, 'box_3').x, 90);
  assert.equal(rectOf(alignBlocks(l, ids, 'top'), 'box_2').y, 10);
  assert.equal(rectOf(alignBlocks(l, ids, 'width'), 'box_2').w, rectOf(l, 'box_1').w);
  assert.equal(alignBlocks(l, ['box_1'], 'left'), l);
});

test('hitTest returns the topmost block on that page', () => {
  let l = addBlock(emptyLayout(), 'box', 1, 10, 10).layout;
  l = addBlock(l, 'box', 1, 20, 20).layout;
  assert.equal(hitTest(l, 1, 25, 25), 'box_2');
  assert.equal(hitTest(l, 1, 12, 12), 'box_1');
  assert.equal(hitTest(l, 2, 25, 25), null);
  assert.equal(hitTest(l, 1, 200, 200), null);
});

test('mm and px conversions round trip', () => {
  assert.equal(mmToPx(210, 630), 630);
  assert.ok(Math.abs(pxToMm(mmToPx(37, 500), 500) - 37) < 1e-9);
});

import { fieldsForSave, rulesForSave, sampleAnswers } from '../../src/documentEngine/builderApi.js';
import { normalizeFields, normalizeRules } from '../../server-lib/documentEngine/validate.js';

test('database rows map back to what saveDraft accepts', () => {
  const rows = [
    { field_key: 'a', label: 'A', field_type: 'short_text', config: {}, required: true, section: null, help_text: null, attachment_rules: null },
    { field_key: 'b', label: 'B', field_type: 'dropdown', config: { options: ['x', 'y'] }, required: false },
  ];
  assert.equal(normalizeFields(fieldsForSave(rows)).error, undefined);
  assert.equal(normalizeFields(fieldsForSave(rows)).fields[1].config.options.length, 2);
  assert.equal(normalizeRules(rulesForSave([{ rule_type: 'notify', config: {} }])).error, undefined);
});

test('sampleAnswers fills every field kind', () => {
  const a = sampleAnswers([
    { field_key: 'h', field_type: 'hazard_table' }, { field_key: 'p', field_type: 'ppe_list' },
    { field_key: 't', field_type: 'long_text' }, { field_key: 'n', field_type: 'number' }, { field_key: 'z', field_type: 'short_text', label: 'Z' },
  ]);
  assert.ok(Array.isArray(a.h) && a.h[0].risk);
  assert.ok(a.p.length > 0 && a.t.length > 20 && a.n === 12 && a.z === 'Sample Z');
});

import { jsPDF } from 'jspdf';
import { renderLayoutToDoc } from '../../src/documentEngine/renderLayout.js';
import { FLHA_FIELDS, FLHA_ANSWERS } from './_fixtures/flhaLayout.js';

test('a layout the editor placed box by box still renders', () => {
  let l = FLHA_LAYOUT;
  let y = 10;
  for (const b of l.blocks) { l = placeFlowBlock(l, b.id, 1); l = setRect(l, b.id, { y, x: 16, w: 178, h: 24 }); y += 26; }
  assert.equal(checkedLayout(l).error, undefined);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const { pages } = renderLayoutToDoc(doc, { layout: l, document: { title: 'FLHA' }, company: { name: 'Co' }, record: { site: 'S', author: 'A', status: 'submitted' }, fields: FLHA_FIELDS, answers: FLHA_ANSWERS, signatures: [], assets: {} });
  assert.equal(pages, 1);
});
