// src/documentEngine/renderLayout.js
// Draws a unified-engine document's PDF from its layout JSON
// (server-lib/documentEngine/layoutSchema.js) and the record's data. Runs in
// the browser with the bundled jsPDF (src/loadJsPDF.js), and in Node with the
// same library, which is how the tests render real PDFs.
//
// Nothing here fetches, uploads or reads the database. The caller passes in
// everything as data: the company logo as a data URL, signatures as data
// URLs. That keeps one rule easy to hold: a layout can only ever draw what
// the caller handed over, and images must be PNG, JPEG or WEBP data URLs of
// sane size (anything else is skipped, never fetched).
//
// FLOW blocks stack down A4 pages and continue onto new pages. PLACED blocks
// (a `rect`) are drawn inside their box on their page and clipped to it, for
// reproducing a customer's paper form box for box. The numbers below
// (offsets, sizes, colors) are copied from src/generatePDF.js so the FLHA
// template prints as it always has; tests/unit/document-engine-layout.test.js
// compares the two.

import { blockVisible, isPlaced, defaultLayout, validateLayout, PAGE_W, PAGE_H } from '../../server-lib/documentEngine/layoutSchema.js';
import { loadJsPDF } from '../loadJsPDF.js';

const MAX_ROWS = 300;
const MAX_ITEMS = 100;
const MAX_TEXT = 5000;
const MAX_IMAGE_CHARS = 2.5 * 1024 * 1024;

const PAL = {
  navy: [30, 58, 95], text: [55, 65, 81], ink: [30, 41, 59], muted: [107, 114, 128], faint: [148, 163, 184],
  line: [209, 213, 219], rule: [226, 232, 240], panel: [249, 250, 251], infoBg: [240, 249, 255], infoLabel: [3, 105, 161],
  chipBg: [239, 246, 255], chipLine: [191, 219, 254], chipText: [29, 78, 216], groupBg: [239, 246, 255], zebra: [248, 250, 252],
};
const TONE = {
  danger: { bg: [127, 29, 29], text: [255, 255, 255], soft: [254, 226, 226], line: [254, 202, 202], ink: [127, 29, 29] },
  warning: { bg: [180, 83, 9], text: [255, 255, 255], soft: [255, 247, 237], line: [254, 215, 170], ink: [194, 65, 12], body: [154, 52, 18] },
  info: { bg: [30, 58, 95], text: [255, 255, 255], soft: [239, 246, 255], line: [191, 219, 254], ink: [30, 58, 95] },
  success: { bg: [22, 101, 52], text: [255, 255, 255], soft: [240, 253, 244], line: [22, 163, 74], ink: [22, 101, 52] },
};
const BADGE_DEFAULT = {
  Extreme: { bg: [254, 226, 226], text: [127, 29, 29] },
  High: { bg: [254, 242, 242], text: [220, 38, 38] },
  Medium: { bg: [255, 251, 235], text: [217, 119, 6] },
  Low: { bg: [240, 253, 244], text: [22, 163, 74] },
};

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const text = (v, max = MAX_TEXT) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);

function imageFormat(url) {
  if (typeof url !== 'string' || url.length > MAX_IMAGE_CHARS) return null;
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.exec(url);
  if (!m) return null;
  return m[1] === 'png' ? 'PNG' : m[1] === 'webp' ? 'WEBP' : 'JPEG';
}

function addImageSafe(doc, url, x, y, w, h) {
  const fmt = imageFormat(url);
  if (!fmt) return false;
  try { doc.addImage(url, fmt, x, y, w, h); return true; } catch (e) { return false; }
}

function answerText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((v) => (v && typeof v === 'object' ? (v.label || '') : String(v))).filter(Boolean).join(', ');
  // An equipment, site, person or document answer carries the label the server stored.
  if (typeof value === 'object') return Array.isArray(value.labels) ? value.labels.join(', ') : String(value.label || '');
  const s = String(value);
  return s === 'yes' ? 'Yes' : s === 'no' ? 'No' : s;
}

class Ctx {
  constructor(doc, input, layout) {
    this.doc = doc;
    this.input = input;
    this.layout = layout;
    this.margin = layout.page?.margin ?? 16;
    this.W = PAGE_W;
    this.H = PAGE_H;
    this.left = this.margin;
    this.width = PAGE_W - this.margin * 2;
    this.y = 20;
    this.atPageTop = true;
    this.placed = false;
    this.bottomLimit = 280;
    this.fieldsByKey = new Map((input.fields || []).map((f) => [f.field_key, f]));
    const c = layout.colors || {};
    this.primary = c.primary ? rgb(c.primary) : PAL.navy;
  }

  answer(key) { return this.input.answers ? this.input.answers[key] : undefined; }

  bind(value) {
    const i = this.input;
    return text(value).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, name) => {
      if (name === 'document.title') return text(i.document?.title);
      if (name === 'company.name') return text(i.company?.name);
      if (name === 'record.site') return text(i.record?.site);
      if (name === 'record.author') return text(i.record?.author);
      if (name === 'record.date') return text(i.record?.dateText);
      if (name === 'record.dateTime') return text(i.record?.dateTimeText);
      if (name === 'count') return String(this.count ?? '');
      if (name.startsWith('answer:')) return text(answerText(this.answer(name.slice(7))));
      return m;
    });
  }

  signatures(kind) { return (this.input.signatures || []).filter((s) => s.kind === kind); }

  // Room check for a flow block. In a placed block nothing can page, so the
  // block stops at its box instead.
  ensure(h, bottom = this.bottomLimit) {
    if (this.y + h <= bottom) return true;
    if (this.placed) return false;
    this.newPage();
    return true;
  }

  newPage() {
    this.doc.addPage();
    this.y = 20;
    this.atPageTop = true;
  }

  fits(h) { return !this.placed || this.y + h <= this.bottomLimit + 0.001; }
}

function wrapText(ctx, str, x, width, lineHeight) {
  const { doc } = ctx;
  const lines = doc.splitTextToSize(str, width);
  for (const line of lines) {
    if (ctx.placed) { if (ctx.y > ctx.bottomLimit) break; } else if (ctx.y > 276) ctx.newPage();
    doc.text(line, x, ctx.y);
    ctx.y += lineHeight;
  }
}

// ── Blocks ──────────────────────────────────────────────────────────────────

const DRAW = {
  header(ctx, b) {
    const { doc } = ctx;
    const h = ctx.placed ? ctx.placedH : (b.height || 30);
    const top = ctx.placed ? ctx.y : (ctx.atPageTop ? 0 : ctx.y);
    const x0 = ctx.placed ? ctx.left : 0;
    const w = ctx.placed ? ctx.width : ctx.W;
    const pad = ctx.placed ? ctx.left + 4 : ctx.margin;
    const rightEdge = ctx.placed ? ctx.left + ctx.width - 4 : ctx.W - ctx.margin;
    doc.setFillColor(...(b.color ? rgb(b.color) : ctx.primary));
    doc.rect(x0, top, w, h, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(ctx.bind(b.title || '{{document.title}}'), pad, top + 13, { maxWidth: rightEdge - pad - 24 });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    if (b.subtitle) doc.text(ctx.bind(b.subtitle), pad, top + 20);
    const logo = ctx.input.company?.logoDataUrl;
    if (b.showLogo !== false && imageFormat(logo)) {
      addImageSafe(doc, logo, rightEdge - 20, top + 5, 20, 20);
      if (b.showDate !== 'none') { doc.setFontSize(7); doc.text(text(ctx.input.record?.dateText), rightEdge, top + 28, { align: 'right' }); }
    } else if (b.showDate !== 'none') {
      doc.text(text(b.showDate === 'date' ? ctx.input.record?.dateText : ctx.input.record?.dateTimeText), rightEdge, top + 13, { align: 'right' });
    }
    if (!ctx.placed) { ctx.y = top + h + 10; ctx.atPageTop = false; }
  },

  banner(ctx, b) {
    const { doc } = ctx;
    const tone = TONE[b.tone] || TONE.danger;
    const h = ctx.placed ? ctx.placedH : 12;
    if (!ctx.ensure(h + 6)) return;
    doc.setFillColor(...tone.bg);
    doc.roundedRect(ctx.left, ctx.y, ctx.width, h, 2, 2, 'F');
    doc.setTextColor(...tone.text);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(ctx.bind(b.text || ''), ctx.left + ctx.width / 2, ctx.y + 5.5, { align: 'center' });
    if (b.subtext) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text(ctx.bind(b.subtext), ctx.left + ctx.width / 2, ctx.y + 9.5, { align: 'center' });
    }
    ctx.y += 18;
  },

  info_box(ctx, b) {
    const { doc } = ctx;
    const h = ctx.placed ? ctx.placedH : (b.height || 22);
    if (!ctx.ensure(h + 8)) return;
    doc.setFillColor(...PAL.infoBg);
    doc.roundedRect(ctx.left, ctx.y, ctx.width, h, 3, 3, 'F');
    const n = b.items.length;
    b.items.forEach((item, i) => {
      const x = item.x != null ? item.x : (ctx.width / n) * i + 4;
      const next = b.items[i + 1] && (b.items[i + 1].x != null ? b.items[i + 1].x : (ctx.width / n) * (i + 1) + 4);
      const maxW = (next != null ? next : ctx.width) - x - 4;
      doc.setTextColor(...PAL.infoLabel);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(text(item.label), ctx.left + x, ctx.y + 7);
      doc.setTextColor(...ctx.primary);
      doc.setFontSize(item.size || (i === 0 ? 11 : 10));
      doc.text(ctx.bind(item.value) || 'N/A', ctx.left + x, ctx.y + 16, { maxWidth: maxW });
    });
    ctx.y += h + 8;
  },

  kv_grid(ctx, b) {
    const { doc } = ctx;
    const rows = b.fields.map((k) => ctx.fieldsByKey.get(k)).filter(Boolean);
    if (rows.length === 0) return;
    const cols = b.columns || 2;
    const boxH = 6 + Math.ceil(rows.length / cols) * 9;
    if (!ctx.ensure(boxH)) return;
    doc.setFillColor(...PAL.zebra);
    doc.roundedRect(ctx.left, ctx.y, ctx.width, boxH, 2, 2, 'F');
    let cy = ctx.y + 6;
    let col = 0;
    rows.forEach((f) => {
      const x = ctx.left + 4 + col * (ctx.width / cols);
      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.text(text(f.label).toUpperCase(), x, cy);
      doc.setTextColor(...PAL.ink);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(text(answerText(ctx.answer(f.field_key))) || 'N/A', x, cy + 4.5, { maxWidth: ctx.width / cols - 8 });
      col += 1;
      if (col >= cols) { col = 0; cy += 9; }
    });
    ctx.y += boxH + 6;
  },

  text(ctx, b) {
    const { doc } = ctx;
    const body = b.field ? answerText(ctx.answer(b.field)) : ctx.bind(b.value || '');
    if (!body && b.skipIfEmpty !== false) return;
    const size = b.size || 9;
    const lh = b.lineHeight || 5;
    const hs = b.headingSize || 9;
    if (b.heading && b.headingStyle !== 'none') {
      if (!ctx.ensure(16)) return;
      if (b.headingStyle === 'plain') {
        doc.setTextColor(...PAL.muted);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(hs);
        doc.text(ctx.bind(b.heading), ctx.left, ctx.y);
        ctx.y += 5;
      } else {
        doc.setFillColor(...PAL.panel);
        doc.roundedRect(ctx.left, ctx.y, ctx.width, 6, 2, 2, 'F');
        doc.setTextColor(...ctx.primary);
        doc.setFontSize(hs);
        doc.setFont('helvetica', 'bold');
        doc.text(ctx.bind(b.heading).toUpperCase(), ctx.left + 4, ctx.y + 4.5);
        ctx.y += 10;
      }
    }
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...PAL.text);
    doc.setFontSize(size);
    wrapText(ctx, text(body), ctx.left + (b.headingStyle === 'plain' ? 0 : 2), ctx.width - (b.headingStyle === 'plain' ? 0 : 4), lh);
    ctx.y += 4;
  },

  callout(ctx, b) {
    const { doc } = ctx;
    const items = (Array.isArray(ctx.answer(b.field)) ? ctx.answer(b.field) : []).map((v) => text(v, 300)).filter(Boolean).slice(0, MAX_ITEMS);
    if (items.length === 0) return;
    const tone = TONE[b.tone] || TONE.warning;
    if (!ctx.ensure(12 + items.length * 6)) return;
    doc.setFillColor(...tone.soft);
    doc.setDrawColor(...tone.line);
    doc.roundedRect(ctx.left, ctx.y, ctx.width, 7 + items.length * 6, 2, 2, 'FD');
    doc.setTextColor(...tone.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(ctx.bind(b.heading || '').toUpperCase(), ctx.left + 4, ctx.y + 5);
    ctx.y += 10;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...(tone.body || tone.ink));
    items.forEach((it) => wrapText(ctx, `• ${it}`, ctx.left + 4, ctx.width - 8, 5));
    ctx.y += 4;
  },

  table(ctx, b) {
    const { doc } = ctx;
    const raw = ctx.answer(b.field);
    const rows = (Array.isArray(raw) ? raw : []).filter((r) => r && typeof r === 'object').slice(0, MAX_ROWS);
    if (rows.length === 0) return;
    const total = b.columns.reduce((s, c) => s + c.width, 0);
    const scale = total > ctx.width ? ctx.width / total : 1;
    const cols = b.columns.map((c, i) => ({ ...c, width: c.width * scale }));
    // The last column takes whatever width is left, as the original table did.
    const used = cols.slice(0, -1).reduce((s, c) => s + c.width, 0);
    cols[cols.length - 1].width = Math.max(ctx.width - used, 4);
    let x = ctx.left;
    cols.forEach((c) => { c.x = x; x += c.width; });
    const header = b.headerColor ? rgb(b.headerColor) : ctx.primary;

    const drawHeader = () => {
      doc.setFillColor(...header);
      doc.rect(ctx.left, ctx.y, ctx.width, 7, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      cols.forEach((c) => doc.text(text(c.header, 60), c.x + 2, ctx.y + 4.8));
      ctx.y += 7;
    };

    if (b.title) {
      if (!ctx.ensure(24)) return;
      doc.setTextColor(...ctx.primary);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(ctx.bind(b.title), ctx.left, ctx.y);
      ctx.y += 6;
    }
    if (!ctx.fits(7)) return;
    drawHeader();

    const sizeFor = (c) => c.fontSize || (c.type === 'index' ? 8 : (c.style === 'italic' || c.style === 'muted') ? 6.8 : 7.5);
    const fontFor = (c) => (c.type === 'index' ? 'bold' : c.style === 'bold' ? 'bold' : (c.style === 'italic' ? 'italic' : (c.style === 'muted' ? 'italic' : 'normal')));
    const seenGroups = [];

    for (let idx = 0; idx < rows.length; idx += 1) {
      const row = rows[idx];
      if (b.groupBy) {
        const g = text(row[b.groupBy], 300);
        const prev = idx > 0 ? text(rows[idx - 1][b.groupBy], 300) : null;
        if (g && g !== prev) {
          if (!seenGroups.includes(g)) seenGroups.push(g);
          if (ctx.y + 10 > 275) { if (ctx.placed) return; ctx.newPage(); drawHeader(); }
          doc.setFillColor(...PAL.groupBg);
          doc.rect(ctx.left, ctx.y, ctx.width, 8, 'F');
          doc.setTextColor(...ctx.primary);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          const label = `${text(b.groupLabel || 'GROUP')} ${seenGroups.length}: `;
          doc.text(label, ctx.left + 2, ctx.y + 5.2);
          doc.setFont('helvetica', 'normal');
          const lw = doc.getTextWidth(label);
          doc.text(doc.splitTextToSize(g, ctx.width - lw - 6)[0], ctx.left + 2 + lw, ctx.y + 5.2);
          ctx.y += 8;
        }
      }

      // Wrap each cell. The original FLHA table measured every column with
      // the bold 7.5 pt font that was current; measureBold keeps that.
      const wrapped = cols.map((c) => {
        if (c.type === 'index' || c.type === 'badge') return [];
        if (b.measureBold) { doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); } else { doc.setFont('helvetica', fontFor(c)); doc.setFontSize(sizeFor(c)); }
        return doc.splitTextToSize(text(row[c.key], 1000) || c.emptyText || '', c.width - 4);
      });
      const maxLines = Math.max(...wrapped.map((l) => l.length), 1);
      const rowH = Math.max(9, maxLines * 4.2 + 3);

      if (ctx.y + rowH > 280) {
        if (ctx.placed) return;
        ctx.newPage();
        drawHeader();
      }

      doc.setFillColor(...((b.zebra !== false && idx % 2 === 1) ? PAL.zebra : [255, 255, 255]));
      doc.rect(ctx.left, ctx.y, ctx.width, rowH, 'F');
      doc.setDrawColor(...PAL.rule);
      doc.setLineWidth(0.15);
      doc.rect(ctx.left, ctx.y, ctx.width, rowH, 'S');

      const textY = ctx.y + 4.5;
      cols.forEach((c, ci) => {
        if (c.type === 'index') {
          doc.setTextColor(...PAL.faint);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(sizeFor(c));
          doc.text(String(idx + 1), c.x + 2, textY);
        } else if (c.type === 'badge') {
          const value = text(row[c.key], 40) || 'Low';
          const custom = b.badgeColors && b.badgeColors[value];
          const colors = custom ? { bg: rgb(custom.bg), text: rgb(custom.text) } : (BADGE_DEFAULT[value] || BADGE_DEFAULT.Low);
          const bw = c.width - 4; const bh = 6; const by = ctx.y + rowH / 2 - bh / 2;
          doc.setFillColor(...colors.bg);
          doc.roundedRect(c.x + 2, by, bw, bh, 1, 1, 'F');
          doc.setTextColor(...colors.text);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.text(value.toUpperCase(), c.x + 2 + bw / 2, by + 4.2, { align: 'center' });
        } else {
          doc.setTextColor(...(c.style === 'bold' ? PAL.ink : (c.style === 'muted' || c.style === 'italic') ? PAL.muted : PAL.text));
          doc.setFont('helvetica', fontFor(c));
          doc.setFontSize(sizeFor(c));
          wrapped[ci].forEach((line, li) => doc.text(line, c.x + 2, textY + li * 4.2));
        }
      });
      ctx.y += rowH;
    }
    ctx.y += 2;
  },

  chips(ctx, b) {
    const { doc } = ctx;
    const items = (Array.isArray(ctx.answer(b.field)) ? ctx.answer(b.field) : []).map((v) => text(v, 80)).filter(Boolean).slice(0, MAX_ITEMS);
    if (items.length === 0) return;
    if (ctx.y > 250 && !ctx.placed) ctx.newPage();
    if (b.heading) {
      doc.setTextColor(...ctx.primary);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(ctx.bind(b.heading), ctx.left, ctx.y);
      ctx.y += 6;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...PAL.chipText);
    let x = ctx.left;
    const right = ctx.left + ctx.width;
    for (const item of items) {
      const w = doc.getTextWidth(item) + 8;
      if (x + w > right) { x = ctx.left; ctx.y += 8; }
      if (ctx.placed && ctx.y > ctx.bottomLimit) break;
      doc.setFillColor(...PAL.chipBg);
      doc.setDrawColor(...PAL.chipLine);
      doc.roundedRect(x, ctx.y - 5, w, 7, 1, 1, 'FD');
      doc.text(item, x + 4, ctx.y);
      x += w + 3;
    }
    ctx.y += 12;
  },

  signature(ctx, b) {
    const { doc } = ctx;
    if (ctx.y > 230 && !ctx.placed) ctx.newPage();
    const sig = ctx.signatures('worker')[0];
    const w = b.width || 70;
    if (!ctx.placed) {
      ctx.y += 4;
      doc.setDrawColor(...PAL.line);
      doc.line(ctx.left, ctx.y, ctx.left + ctx.width, ctx.y);
      ctx.y += 8;
    }
    doc.setTextColor(...ctx.primary);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(ctx.bind(b.heading || 'Signature'), ctx.left, ctx.y);
    ctx.y += 4;
    if (ctx.input.record?.awaitingSignature) {
      doc.setTextColor(180, 83, 9);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('AWAITING WORKER SIGNATURE', ctx.left, ctx.y + 12);
      doc.setFont('helvetica', 'normal');
    } else if (sig && sig.signature) {
      addImageSafe(doc, sig.signature, ctx.left, ctx.y, w, 21);
    }
    doc.setDrawColor(150, 150, 150);
    doc.line(ctx.left, ctx.y + 23, ctx.left + w, ctx.y + 23);
    doc.setTextColor(...PAL.muted);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    if (b.showName !== false) doc.text(`Printed name: ${text((sig && sig.signer_name) || ctx.input.record?.author)}`, ctx.left, ctx.y + 29);
    if (b.showDate !== false) doc.text(`Date: ${text(ctx.input.record?.dateTimeText)}`, ctx.left + ctx.width, ctx.y + 29, { align: 'right' });
    if (ctx.input.record?.amendedNote) {
      doc.setTextColor(180, 83, 9);
      doc.setFont('helvetica', 'italic');
      doc.text(text(ctx.input.record.amendedNote, 200), ctx.left, ctx.y + 34);
      doc.setFont('helvetica', 'normal');
    }
    ctx.y += 40;
  },

  signature_grid(ctx, b) {
    const { doc } = ctx;
    const list = ctx.signatures('crew').slice(0, 50);
    if (list.length === 0) return;
    ctx.count = list.length;
    if (ctx.y > 245 && !ctx.placed) ctx.newPage();
    doc.setDrawColor(...PAL.line);
    doc.line(ctx.left, ctx.y, ctx.left + ctx.width, ctx.y);
    ctx.y += 8;
    doc.setTextColor(...ctx.primary);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(ctx.bind(b.heading || 'Crew Sign-Off ({{count}})'), ctx.left, ctx.y);
    ctx.y += 6;
    const sigW = (ctx.width - 8) / 2; const sigH = 30;
    let col = 0;
    for (const c of list) {
      if (col === 0 && ctx.y + sigH > 280) { if (ctx.placed) return; ctx.newPage(); }
      const x = ctx.left + col * (sigW + 8);
      doc.setDrawColor(...PAL.rule);
      doc.setLineWidth(0.2);
      doc.roundedRect(x, ctx.y, sigW, sigH, 2, 2, 'S');
      if (c.signature) addImageSafe(doc, c.signature, x + 3, ctx.y + 2, sigW - 6, 14);
      doc.setDrawColor(180, 180, 180);
      doc.line(x + 3, ctx.y + 17, x + sigW - 3, ctx.y + 17);
      doc.setTextColor(71, 85, 105);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text(text(c.signer_name, 80) || 'N/A', x + 3, ctx.y + 22, { maxWidth: sigW - 6 });
      if (c.signedAtText) {
        doc.setTextColor(...PAL.faint);
        doc.setFontSize(6.5);
        doc.text(text(c.signedAtText, 40), x + 3, ctx.y + 26.5, { maxWidth: sigW - 6 });
      }
      if (col === 1) { ctx.y += sigH + 6; col = 0; } else col = 1;
    }
    if (col === 1) ctx.y += sigH + 6;
    ctx.y += 2;
  },

  approvals(ctx, b) {
    const { doc } = ctx;
    const list = ctx.signatures('approval').filter((s) => !b.stepKey || s.step_key === b.stepKey).slice(0, 10);
    if (list.length === 0) return;
    const tone = TONE[b.tone] || TONE.success;
    for (const a of list) {
      let sy = ctx.y + 6;
      if (sy > 240) { if (ctx.placed) return; ctx.newPage(); sy = 20; }
      doc.setDrawColor(...tone.line);
      doc.setLineWidth(0.4);
      doc.line(ctx.left, sy, ctx.left + ctx.width, sy);
      sy += 8;
      doc.setTextColor(...tone.ink);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(ctx.bind(b.heading || 'Approval'), ctx.left, sy);
      sy += 4;
      if (a.signature) addImageSafe(doc, a.signature, ctx.left, sy, 70, 21);
      doc.setDrawColor(150, 150, 150);
      doc.line(ctx.left, sy + 23, ctx.left + 70, sy + 23);
      doc.setTextColor(...PAL.muted);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(`Approved by: ${text(a.signer_name, 80)}`, ctx.left, sy + 29);
      doc.text(`Date: ${text(a.signedAtText, 40)}`, ctx.left + ctx.width, sy + 29, { align: 'right' });
      ctx.y = sy + 34;
    }
  },

  divider(ctx, b) {
    ctx.doc.setDrawColor(...(b.color ? rgb(b.color) : PAL.line));
    ctx.doc.setLineWidth(0.2);
    ctx.doc.line(ctx.left, ctx.y, ctx.left + ctx.width, ctx.y);
    ctx.y += 4;
  },

  spacer(ctx, b) { ctx.y += b.height || 6; },

  image(ctx, b) {
    const logo = b.source === 'fora_logo' ? ctx.input.assets?.foraLogoDataUrl : ctx.input.company?.logoDataUrl;
    const h = ctx.placed ? ctx.placedH : 20;
    if (!imageFormat(logo)) return;
    addImageSafe(ctx.doc, logo, ctx.left, ctx.y, ctx.placed ? ctx.width : 20, h);
    ctx.y += h + 4;
  },

  box(ctx, b) {
    const { doc } = ctx;
    if (!ctx.placed) return;
    const style = b.fill && b.border ? 'FD' : b.fill ? 'F' : 'S';
    if (b.fill) doc.setFillColor(...rgb(b.fill));
    doc.setDrawColor(...(b.border ? rgb(b.border) : PAL.rule));
    doc.setLineWidth(b.lineWidth || 0.2);
    doc.roundedRect(ctx.left, ctx.y, ctx.width, ctx.placedH, b.radius || 0, b.radius || 0, style);
  },

  field_value(ctx, b) {
    const { doc } = ctx;
    const value = b.field ? answerText(ctx.answer(b.field)) : '';
    if (b.border && ctx.placed) {
      doc.setDrawColor(...rgb(b.border));
      doc.setLineWidth(0.2);
      doc.rect(ctx.left, ctx.y, ctx.width, ctx.placedH, 'S');
    }
    let y = ctx.y + 4;
    if (b.label) {
      doc.setTextColor(...PAL.faint);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.text(text(b.label, 80).toUpperCase(), ctx.left + 1.5, y);
      y += 4.5;
    }
    doc.setTextColor(...PAL.ink);
    doc.setFont('helvetica', b.bold ? 'bold' : 'normal');
    // A placed value shrinks to fit its box instead of spilling out of it.
    let size = b.size || 10;
    const room = ctx.placed ? ctx.y + ctx.placedH - y : 1000;
    let lines;
    for (;;) {
      doc.setFontSize(size);
      lines = doc.splitTextToSize(text(value), ctx.width - 3);
      if (!ctx.placed || size <= 5 || lines.length * size * 0.4 <= room) break;
      size -= 0.5;
    }
    lines.forEach((l, i) => doc.text(l, ctx.left + 1.5, y + i * size * 0.4));
    if (!ctx.placed) ctx.y += 12;
  },
};

// ── Page footer ─────────────────────────────────────────────────────────────

function drawFooters(doc, ctx) {
  if (ctx.layout.page && ctx.layout.page.footer === false) return;
  const logo = ctx.input.assets?.foraLogoDataUrl;
  const { margin, W, H } = ctx;
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(...PAL.rule);
    doc.setLineWidth(0.2);
    doc.line(margin, H - 12, W - margin, H - 12);
    if (imageFormat(logo) && addImageSafe(doc, logo, margin, H - 10.5, 14, 6.74)) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...PAL.faint);
      doc.text('AI-generated field safety documentation', margin + 17, H - 6.5);
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...PAL.navy);
      doc.text('FORA', margin, H - 7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...PAL.faint);
      doc.text('AI-generated field safety documentation', margin + 11, H - 7);
    }
    doc.setTextColor(...PAL.faint);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`Page ${p} of ${pages}`, W - margin, H - 6.5, { align: 'right' });
  }
}

/**
 * Draws the document onto a jsPDF instance and returns { pages }.
 *
 * input = {
 *   layout,                       layout JSON (validated here again; {} means the default layout)
 *   document: { title },
 *   company:  { name, logoDataUrl },
 *   record:   { site, author, dateText, dateTimeText, status, awaitingSignature, amendedNote },
 *   fields:   [{ field_key, label, field_type }],
 *   answers:  { [fieldKey]: value },
 *   signatures: [{ kind: 'worker'|'crew'|'approval', step_key, signer_name, signature (data URL), signedAtText }],
 *   assets:   { foraLogoDataUrl },
 * }
 */
export function renderLayoutToDoc(doc, input) {
  let layout = input.layout;
  const checked = validateLayout(layout && Object.keys(layout).length ? layout : defaultLayout(input.document?.title, input.fields));
  if (checked.error) throw new Error(`Cannot draw this document: ${checked.error}`);
  layout = Object.keys(checked.layout).length ? checked.layout : defaultLayout(input.document?.title, input.fields);

  const ctx = new Ctx(doc, input, layout);
  const visible = (b) => blockVisible(b, {
    status: input.record?.status,
    awaitingSignature: input.record?.awaitingSignature === true,
    answer: (k) => ctx.answer(k),
  });

  // Flow blocks first, so the page count is known; then placed blocks on
  // their own pages.
  for (const b of layout.blocks.filter((x) => !isPlaced(x) && visible(x))) {
    ctx.placed = false;
    ctx.left = ctx.margin;
    ctx.width = ctx.W - ctx.margin * 2;
    ctx.bottomLimit = 280;
    DRAW[b.type](ctx, b);
    if (b.type !== 'header') ctx.atPageTop = false;
  }

  for (const b of layout.blocks.filter((x) => isPlaced(x) && visible(x))) {
    const r = b.rect;
    while (doc.internal.getNumberOfPages() < r.page) doc.addPage();
    doc.setPage(r.page);
    ctx.placed = true;
    ctx.left = r.x;
    ctx.width = r.w;
    ctx.y = r.y;
    ctx.placedH = r.h;
    ctx.bottomLimit = r.y + r.h;
    doc.saveGraphicsState();
    doc.rect(r.x, r.y, r.w, r.h);
    doc.clip();
    doc.discardPath();
    try { DRAW[b.type](ctx, b); } finally { doc.restoreGraphicsState(); }
  }

  drawFooters(doc, ctx);
  return { pages: doc.internal.getNumberOfPages() };
}

/** Browser entry: builds the jsPDF document and returns it. The caller outputs or uploads it. */
export async function renderDocumentPDF(input) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  renderLayoutToDoc(doc, input);
  return doc;
}
