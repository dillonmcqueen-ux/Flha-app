// server-lib/documentEngine/layoutSchema.js
// The layout JSON that drives a unified-engine document's PDF
// (document_layouts.layout_json), and the check that makes it safe to store
// and render. Pure: no database, no network, no Node-only imports, so the
// builder, the server and the browser renderer (src/documentEngine/) all use
// this one file. See docs/unified-document-engine-spec.md section 6.
//
// A layout is an ordered list of blocks on A4 pages, in millimetres:
//
//   { version: 1,
//     page:   { size: 'A4', margin: 16, footer: true },
//     colors: { primary: '#1E3A5F' },                 (optional)
//     blocks: [ { id, type, ...props, rect?, showIf? } ] }
//
// A block with no `rect` FLOWS: blocks stack down the page and a long block
// (a table, a paragraph) continues on the next page. A block with a `rect`
// ({ page, x, y, w, h }) is PLACED: it is drawn inside that box on that page
// and clipped to it, which is how the drag and drop editor reproduces a
// customer's paper form box for box.
//
// Bindings. Any text prop may use {{document.title}}, {{company.name}},
// {{record.site}}, {{record.author}}, {{record.date}}, {{record.dateTime}},
// {{count}} or {{answer:<fieldKey>}}. Anything else is left as typed.
//
// validateLayout returns { layout } (a cleaned copy: unknown props dropped,
// numbers clamped, colors checked) or { error }. It never throws.

export const LAYOUT_SCHEMA_VERSION = 1;
export const PAGE_W = 210;
export const PAGE_H = 297;
export const MAX_BLOCKS = 200;
export const MAX_COLUMNS = 8;
export const MAX_LAYOUT_BYTES = 200 * 1024;

export const BLOCK_TYPES = [
  'header', 'banner', 'info_box', 'kv_grid', 'text', 'callout', 'table', 'chips',
  'signature', 'signature_grid', 'approvals', 'divider', 'spacer', 'image', 'box', 'field_value',
];

const KEY_RE = /^[a-z0-9_]{1,60}$/;
const COLKEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const TONES = ['danger', 'warning', 'info', 'success'];
const CELL_STYLES = ['bold', 'normal', 'italic', 'muted'];
const CELL_TYPES = ['text', 'index', 'badge'];

const fail = (message) => ({ error: message });

const str = (v, max = 500) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : undefined);
const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, min), max) : undefined);
const hex = (v) => (typeof v === 'string' && HEX_RE.test(v) ? v.toUpperCase() : undefined);
const key = (v) => (typeof v === 'string' && KEY_RE.test(v) ? v : undefined);
const oneOf = (v, list) => (list.includes(v) ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);

// Drops undefined so a cleaned block carries only what was valid.
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function cleanRect(r) {
  if (r == null) return { rect: undefined };
  if (typeof r !== 'object' || Array.isArray(r)) return fail('A placed block has an invalid box.');
  const page = Number.isInteger(r.page) ? r.page : NaN;
  const x = num(r.x, 0, PAGE_W); const y = num(r.y, 0, PAGE_H);
  const w = num(r.w, 2, PAGE_W); const h = num(r.h, 2, PAGE_H);
  if (!(page >= 1 && page <= 20) || x == null || y == null || w == null || h == null) return fail('A placed block needs a page (1 to 20) and a box in millimetres.');
  if (x + w > PAGE_W + 0.01 || y + h > PAGE_H + 0.01) return fail('A placed block runs off the page.');
  return { rect: { page, x, y, w, h } };
}

function cleanShowIf(s) {
  if (s == null) return { showIf: undefined };
  if (typeof s !== 'object' || Array.isArray(s)) return fail('A show condition is invalid.');
  const out = {};
  if (s.status !== undefined) {
    if (!Array.isArray(s.status) || s.status.length === 0 || s.status.length > 6 || s.status.some((x) => typeof x !== 'string')) return fail('A show condition has an invalid status list.');
    out.status = s.status.map((x) => x.slice(0, 30));
  }
  if (s.answer !== undefined) {
    if (!key(s.answer)) return fail('A show condition names an invalid field.');
    out.answer = s.answer;
    if (s.equals !== undefined) {
      if (!Array.isArray(s.equals) || s.equals.length > 10) return fail('A show condition has an invalid value list.');
      out.equals = s.equals.map((x) => String(x).slice(0, 100));
    }
  }
  if (s.awaitingSignature !== undefined) out.awaitingSignature = s.awaitingSignature === true;
  if (Object.keys(out).length === 0) return fail('A show condition is empty.');
  return { showIf: out };
}

function cleanColumns(cols) {
  if (!Array.isArray(cols) || cols.length === 0 || cols.length > MAX_COLUMNS) return fail(`A table needs 1 to ${MAX_COLUMNS} columns.`);
  const out = [];
  for (const c of cols) {
    if (!c || typeof c !== 'object') return fail('A table column is invalid.');
    const k = (typeof c.key === 'string' && COLKEY_RE.test(c.key) ? c.key : undefined) || (c.type === 'index' ? 'index' : undefined);
    if (!k) return fail('A table column needs a key.');
    const w = num(c.width, 4, 200);
    if (w == null) return fail('A table column needs a width in millimetres.');
    out.push(clean({
      key: k, header: str(c.header, 60) ?? '', width: w,
      style: oneOf(c.style, CELL_STYLES) || 'normal',
      type: oneOf(c.type, CELL_TYPES) || 'text',
      fontSize: num(c.fontSize, 5, 14), emptyText: str(c.emptyText, 20),
    }));
  }
  return { columns: out };
}

function cleanBadgeColors(map) {
  if (map == null) return undefined;
  if (typeof map !== 'object' || Array.isArray(map)) return undefined;
  const out = {};
  for (const [name, c] of Object.entries(map).slice(0, 12)) {
    const bg = hex(c && c.bg); const text = hex(c && c.text);
    if (bg && text) out[String(name).slice(0, 40)] = { bg, text };
  }
  return out;
}

// Per type: turns the raw props into the cleaned ones, or an { error }.
const CLEANERS = {
  header: (b) => clean({
    title: str(b.title, 200), subtitle: str(b.subtitle, 200),
    showDate: oneOf(b.showDate, ['datetime', 'date', 'none']) || 'datetime',
    showLogo: bool(b.showLogo), height: num(b.height, 12, 60), color: hex(b.color),
  }),
  banner: (b) => clean({ text: str(b.text, 200), subtext: str(b.subtext, 300), tone: oneOf(b.tone, TONES) || 'danger' }),
  info_box: (b) => {
    if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 6) return fail('An info box needs 1 to 6 items.');
    return clean({
      items: b.items.map((i) => clean({ label: str(i && i.label, 60) ?? '', value: str(i && i.value, 200) ?? '', x: num(i && i.x, 0, 200), size: num(i && i.size, 6, 16) })),
      height: num(b.height, 10, 60),
    });
  },
  kv_grid: (b) => {
    if (!Array.isArray(b.fields) || b.fields.length === 0 || b.fields.length > 40 || b.fields.some((f) => !key(f))) return fail('A field grid needs 1 to 40 valid field keys.');
    return clean({ fields: b.fields, columns: Number.isInteger(b.columns) && b.columns >= 1 && b.columns <= 3 ? b.columns : 2, heading: str(b.heading, 100) });
  },
  text: (b) => clean({
    heading: str(b.heading, 100), headingStyle: oneOf(b.headingStyle, ['pill', 'plain', 'none']) || 'pill',
    value: str(b.value, 2000), field: key(b.field),
    size: num(b.size, 5, 16), headingSize: num(b.headingSize, 5, 16), lineHeight: num(b.lineHeight, 3, 10),
    skipIfEmpty: b.skipIfEmpty === false ? false : true,
  }),
  callout: (b) => clean({ heading: str(b.heading, 100), field: key(b.field), tone: oneOf(b.tone, TONES) || 'warning' }),
  table: (b) => {
    const cols = cleanColumns(b.columns);
    if (cols.error) return cols;
    if (!key(b.field)) return fail('A table needs a field to read its rows from.');
    return clean({
      title: str(b.title, 120), field: b.field, columns: cols.columns, groupBy: typeof b.groupBy === 'string' && COLKEY_RE.test(b.groupBy) ? b.groupBy : undefined, groupLabel: str(b.groupLabel, 30),
      zebra: b.zebra === false ? false : true, badgeColors: cleanBadgeColors(b.badgeColors), headerColor: hex(b.headerColor),
      // Wrap every column as bold text. The original FLHA PDF measured its rows
      // that way, so the FLHA template sets this to print exactly as before.
      measureBold: b.measureBold === true ? true : undefined,
    });
  },
  chips: (b) => clean({ heading: str(b.heading, 100), field: key(b.field) }),
  signature: (b) => clean({
    heading: str(b.heading, 100), signer: oneOf(b.signer, ['worker']) || 'worker',
    width: num(b.width, 20, 120), showName: b.showName === false ? false : true, showDate: b.showDate === false ? false : true,
  }),
  signature_grid: (b) => clean({ heading: str(b.heading, 100), kind: oneOf(b.kind, ['crew']) || 'crew' }),
  approvals: (b) => clean({ heading: str(b.heading, 100), stepKey: str(b.stepKey, 40), tone: oneOf(b.tone, TONES) || 'success' }),
  divider: (b) => clean({ color: hex(b.color) }),
  spacer: (b) => clean({ height: num(b.height, 1, 100) ?? 6 }),
  image: (b) => clean({ source: oneOf(b.source, ['company_logo', 'fora_logo']) || 'company_logo', fit: oneOf(b.fit, ['contain', 'cover']) || 'contain' }),
  box: (b) => clean({ fill: hex(b.fill), border: hex(b.border), radius: num(b.radius, 0, 10), lineWidth: num(b.lineWidth, 0.05, 2) }),
  field_value: (b) => clean({ label: str(b.label, 80), field: key(b.field), size: num(b.size, 5, 20), bold: bool(b.bold), border: hex(b.border) }),
};

/**
 * Checks and cleans a layout. An empty or missing layout is allowed and
 * stored as {}: the document then prints with defaultLayout().
 */
export function validateLayout(raw) {
  if (raw == null) return { layout: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return fail('The layout is not valid.');
  if (Object.keys(raw).length === 0) return { layout: {} };
  let size = 0;
  try { size = JSON.stringify(raw).length; } catch (e) { return fail('The layout is not valid.'); }
  if (size > MAX_LAYOUT_BYTES) return fail('The layout is too large.');
  if (raw.version !== undefined && raw.version !== LAYOUT_SCHEMA_VERSION) return fail('This layout was made by a newer version of the editor.');
  if (!Array.isArray(raw.blocks)) return fail('A layout needs a list of blocks.');
  if (raw.blocks.length > MAX_BLOCKS) return fail(`A layout can have at most ${MAX_BLOCKS} blocks.`);

  const page = raw.page && typeof raw.page === 'object' ? raw.page : {};
  const colors = {};
  if (raw.colors && typeof raw.colors === 'object') {
    for (const name of ['primary', 'accent', 'text', 'muted']) {
      const c = hex(raw.colors[name]);
      if (c) colors[name] = c;
    }
  }

  const ids = new Set();
  const blocks = [];
  for (let i = 0; i < raw.blocks.length; i += 1) {
    const b = raw.blocks[i];
    if (!b || typeof b !== 'object' || Array.isArray(b)) return fail(`Block ${i + 1} is not valid.`);
    if (!BLOCK_TYPES.includes(b.type)) return fail(`Block ${i + 1} has an unknown type.`);
    const id = key(b.id) || `b${i + 1}`;
    if (ids.has(id)) return fail(`Two blocks share the id "${id}".`);
    ids.add(id);
    const props = CLEANERS[b.type](b);
    if (props.error) return fail(`Block ${i + 1}: ${props.error}`);
    const rect = cleanRect(b.rect);
    if (rect.error) return fail(`Block ${i + 1}: ${rect.error}`);
    const showIf = cleanShowIf(b.showIf);
    if (showIf.error) return fail(`Block ${i + 1}: ${showIf.error}`);
    blocks.push(clean({ id, type: b.type, ...props, rect: rect.rect, showIf: showIf.showIf }));
  }
  return {
    layout: clean({
      version: LAYOUT_SCHEMA_VERSION,
      page: { size: 'A4', margin: num(page.margin, 5, 30) ?? 16, footer: page.footer === false ? false : true },
      colors: Object.keys(colors).length ? colors : undefined,
      blocks,
    }),
  };
}

export function isPlaced(block) {
  return !!(block && block.rect);
}

/** Is this block shown for this record? `ctx` is { status, awaitingSignature, answer(key) }. */
export function blockVisible(block, ctx) {
  const s = block.showIf;
  if (!s) return true;
  if (s.status && !s.status.includes(ctx.status)) return false;
  if (s.awaitingSignature !== undefined && (ctx.awaitingSignature === true) !== s.awaitingSignature) return false;
  if (s.answer) {
    const v = ctx.answer(s.answer);
    const have = Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : (v == null || v === '' ? [] : [String(v).toLowerCase()]);
    if (s.equals) return s.equals.some((e) => have.includes(String(e).toLowerCase()));
    return have.length > 0;
  }
  return true;
}

/**
 * A sensible layout for a document that has none: title banner, who and
 * where, every field in order, then the signature and any approvals. Used so
 * a document prints well before anyone opens the editor.
 */
export function defaultLayout(title, fields = []) {
  const blocks = [
    { id: 'header', type: 'header', title: title || '{{document.title}}', subtitle: '{{company.name}}' },
    { id: 'info', type: 'info_box', items: [{ label: 'COMPANY', value: '{{company.name}}', x: 4 }, { label: 'SUBMITTED BY', value: '{{record.author}}', x: 70 }, { label: 'SITE', value: '{{record.site}}', x: 130 }] },
    { id: 'pending', type: 'banner', text: 'PENDING REVIEW', subtext: 'This document is waiting for a reviewer.', tone: 'warning', showIf: { status: ['pending_approval'] } },
  ];
  const textual = ['short_text', 'long_text', 'number', 'date', 'dropdown', 'yesno', 'condition3'];
  let n = 0;
  for (const f of fields.slice(0, 150)) {
    n += 1;
    if (textual.includes(f.field_type)) {
      blocks.push({ id: `f${n}`, type: 'text', heading: f.label, headingStyle: 'plain', field: f.field_key, size: 9, headingSize: 8 });
    } else if (f.field_type === 'multiselect') {
      blocks.push({ id: `f${n}`, type: 'chips', heading: f.label, field: f.field_key });
    }
  }
  blocks.push({ id: 'sign', type: 'signature', heading: 'Worker Signature' });
  blocks.push({ id: 'crew', type: 'signature_grid', heading: 'Additional Crew Sign-Off ({{count}})' });
  blocks.push({ id: 'approval', type: 'approvals', heading: 'Review Sign-Off' });
  return validateLayout({ version: LAYOUT_SCHEMA_VERSION, page: { size: 'A4', margin: 16, footer: true }, blocks }).layout;
}
