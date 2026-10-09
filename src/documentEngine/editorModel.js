// Pure state helpers for the drag and drop layout editor. No React, no DOM,
// so every rule (snapping, clamping, aligning, placing) is unit tested.
// Layouts are the JSON in server-lib/documentEngine/layoutSchema.js; the
// editor works in millimetres on A4 pages and only converts to pixels to draw.

import { PAGE_W, PAGE_H, MAX_BLOCKS, validateLayout, isPlaced } from '../../server-lib/documentEngine/layoutSchema.js';

export const MIN_BOX = 6;
export const SNAP_MM = 1;
export const MAX_PAGES = 20;

export const snap = (v, step = SNAP_MM) => (step > 0 ? Math.round(v / step) * step : v);
export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Sensible starting box and props for each block type when it is dropped on a page. */
export const PALETTE = [
  { type: 'text', label: 'Text', w: 80, h: 14, props: { headingStyle: 'none', value: 'Text' } },
  { type: 'field_value', label: 'Field value', w: 60, h: 12, props: { label: 'Label' } },
  { type: 'box', label: 'Box', w: 60, h: 20, props: { border: '#000000' } },
  { type: 'table', label: 'Table', w: 178, h: 80, props: { field: 'items', columns: [{ key: 'item', header: 'ITEM', width: 100, type: 'text' }, { key: 'detail', header: 'DETAIL', width: 78, type: 'text' }] } },
  { type: 'chips', label: 'Chips', w: 100, h: 14, props: { heading: 'List' } },
  { type: 'signature', label: 'Signature', w: 80, h: 32, props: { heading: 'Signature' } },
  { type: 'signature_grid', label: 'Crew signatures', w: 178, h: 50, props: { heading: 'Crew' } },
  { type: 'approvals', label: 'Approvals', w: 178, h: 40, props: { heading: 'Approval' } },
  { type: 'image', label: 'Logo', w: 30, h: 20, props: { source: 'company_logo' } },
  { type: 'info_box', label: 'Info box', w: 178, h: 22, props: { items: [{ label: 'COMPANY', value: '{{company.name}}', x: 4 }, { label: 'SITE', value: '{{record.site}}', x: 70 }] } },
  { type: 'divider', label: 'Divider', w: 178, h: 2, props: {} },
];

export function pageCount(layout) {
  let n = 1;
  for (const b of layout.blocks || []) if (isPlaced(b)) n = Math.max(n, b.rect.page);
  return n;
}

/** Keeps a box inside its page and no smaller than MIN_BOX. */
export function fitRect(r) {
  const w = clamp(r.w, MIN_BOX, PAGE_W);
  const h = clamp(r.h, MIN_BOX, PAGE_H);
  return { page: r.page, x: clamp(r.x, 0, PAGE_W - w), y: clamp(r.y, 0, PAGE_H - h), w, h };
}

const nextId = (layout, type) => {
  const used = new Set((layout.blocks || []).map((b) => b.id));
  for (let i = 1; i < 1000; i += 1) { const id = `${type}_${i}`; if (!used.has(id)) return id; }
  return `${type}_${Date.now()}`;
};

const withBlocks = (layout, blocks) => ({ ...layout, version: 1, blocks });
const mapBlock = (layout, id, fn) => withBlocks(layout, layout.blocks.map((b) => (b.id === id ? fn(b) : b)));

/** Drops a new block of `type` on `page` with its top-left at (x, y) mm. */
export function addBlock(layout, type, page, x, y) {
  if ((layout.blocks || []).length >= MAX_BLOCKS) return { layout, error: `A layout can have at most ${MAX_BLOCKS} blocks.` };
  const def = PALETTE.find((p) => p.type === type);
  if (!def) return { layout, error: 'Unknown block type.' };
  const id = nextId(layout, type);
  const rect = fitRect({ page, x: snap(x), y: snap(y), w: def.w, h: def.h });
  const block = { id, type, ...structuredClone(def.props), rect };
  return { layout: withBlocks(layout, [...(layout.blocks || []), block]), id };
}

export function moveBlock(layout, id, dx, dy, step = SNAP_MM) {
  return mapBlock(layout, id, (b) => (isPlaced(b) ? { ...b, rect: fitRect({ ...b.rect, x: snap(b.rect.x + dx, step), y: snap(b.rect.y + dy, step) }) } : b));
}

export function resizeBlock(layout, id, dw, dh, step = SNAP_MM) {
  return mapBlock(layout, id, (b) => (isPlaced(b) ? { ...b, rect: fitRect({ ...b.rect, w: snap(b.rect.w + dw, step), h: snap(b.rect.h + dh, step) }) } : b));
}

export function setRect(layout, id, patch) {
  return mapBlock(layout, id, (b) => (isPlaced(b) ? { ...b, rect: fitRect({ ...b.rect, ...patch }) } : b));
}

export function movePage(layout, id, page) {
  const p = clamp(Math.round(page), 1, MAX_PAGES);
  return mapBlock(layout, id, (b) => (isPlaced(b) ? { ...b, rect: { ...b.rect, page: p } } : b));
}

export function updateBlock(layout, id, patch) {
  return mapBlock(layout, id, (b) => ({ ...b, ...patch, id: b.id, type: b.type, rect: b.rect }));
}

export function deleteBlock(layout, id) {
  return withBlocks(layout, (layout.blocks || []).filter((b) => b.id !== id));
}

export function duplicateBlock(layout, id) {
  const src = (layout.blocks || []).find((b) => b.id === id);
  if (!src || !isPlaced(src)) return { layout, error: 'Only a placed block can be duplicated.' };
  const added = addBlock(layout, src.type, src.rect.page, src.rect.x + 4, src.rect.y + 4);
  if (added.error) return added;
  const copy = { ...structuredClone(src), id: added.id, rect: fitRect({ ...src.rect, x: src.rect.x + 4, y: src.rect.y + 4 }) };
  return { layout: withBlocks(layout, added.layout.blocks.map((b) => (b.id === added.id ? copy : b))), id: added.id };
}

/** Takes a flow block and gives it a box so the editor can move it. */
export function placeFlowBlock(layout, id, page = 1) {
  return mapBlock(layout, id, (b) => {
    if (isPlaced(b)) return b;
    const def = PALETTE.find((p) => p.type === b.type);
    return { ...b, rect: fitRect({ page, x: 16, y: 16, w: def ? def.w : 100, h: def ? def.h : 20 }) };
  });
}

/** Aligns the chosen placed blocks on one page to the first block's edge or centre. */
export function alignBlocks(layout, ids, how) {
  const list = (layout.blocks || []).filter((b) => ids.includes(b.id) && isPlaced(b));
  if (list.length < 2) return layout;
  const ref = list[0].rect;
  return withBlocks(layout, layout.blocks.map((b) => {
    if (!ids.includes(b.id) || !isPlaced(b) || b.id === list[0].id || b.rect.page !== ref.page) return b;
    const r = { ...b.rect };
    if (how === 'left') r.x = ref.x;
    else if (how === 'right') r.x = ref.x + ref.w - r.w;
    else if (how === 'top') r.y = ref.y;
    else if (how === 'bottom') r.y = ref.y + ref.h - r.h;
    else if (how === 'center') r.x = ref.x + (ref.w - r.w) / 2;
    else if (how === 'middle') r.y = ref.y + (ref.h - r.h) / 2;
    else if (how === 'width') r.w = ref.w;
    else if (how === 'height') r.h = ref.h;
    return { ...b, rect: fitRect(r) };
  }));
}

/** Topmost placed block at a point (later blocks draw on top). */
export function hitTest(layout, page, x, y) {
  const list = (layout.blocks || []).filter((b) => isPlaced(b) && b.rect.page === page);
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const r = list[i].rect;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return list[i].id;
  }
  return null;
}

/** Bring to front / send to back inside the draw order. */
export function reorder(layout, id, toFront) {
  const blocks = layout.blocks || [];
  const b = blocks.find((x) => x.id === id);
  if (!b) return layout;
  const rest = blocks.filter((x) => x.id !== id);
  return withBlocks(layout, toFront ? [...rest, b] : [b, ...rest]);
}

/** The layout, cleaned by the same check the server runs. */
export function checkedLayout(layout) {
  const out = validateLayout(layout);
  return out.error ? { error: out.error } : { layout: out.layout };
}

export const emptyLayout = () => ({ version: 1, page: { size: 'A4', margin: 16, footer: true }, blocks: [] });

/** Millimetres to screen pixels for a page drawn `widthPx` wide. */
export const mmToPx = (mm, widthPx) => (mm * widthPx) / PAGE_W;
export const pxToMm = (px, widthPx) => (px * PAGE_W) / widthPx;
