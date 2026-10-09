import fs from 'node:fs';
import { jsPDF } from 'jspdf';
import { renderLayoutToDoc } from '../../../src/documentEngine/renderLayout.js';
import { FLHA_LAYOUT, FLHA_FIELDS, FLHA_ANSWERS } from './flhaLayout.js';
const png = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
const sig = png('public/fora-mark.png');
renderLayoutToDoc(doc, {
  layout: FLHA_LAYOUT, document: { title: 'FLHA' }, company: { name: 'Test Co' },
  record: { site: 'Test Site', author: 'Jamie Worker', dateText: '2026-10-09', dateTimeText: '2026-10-09, 10:00:00 a.m.', status: 'submitted' },
  fields: FLHA_FIELDS, answers: FLHA_ANSWERS,
  signatures: [{ kind: 'worker', signer_name: 'Jamie Worker', signature: sig, signedAtText: '2026-10-09, 10:00' }],
  assets: { foraLogoDataUrl: png('public/fora-logo-dark.png') },
});
fs.writeFileSync(process.argv[2], Buffer.from(doc.output('arraybuffer')));
