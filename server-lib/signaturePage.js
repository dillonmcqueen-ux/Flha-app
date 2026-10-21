// server-lib/signaturePage.js
// Send & Sign: appends one record page to the end of a sent PDF.
//
// The original pages are copied through untouched. The added page states who
// signed (or acknowledged), when, the document's title, and the SHA-256 of
// the ORIGINAL file, so anyone holding the original can show it matches what
// was signed. For a Sign document it carries the drawn signature; for a
// Read-only document it carries an acknowledgement line instead.
//
// Server side only: pdf-lib is not imported anywhere in src/.

import crypto from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const MAX_SIGNATURE_BYTES = 300 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * A PNG data URL from the signature pad, as bytes. Returns { bytes } or
 * { error }. Checks the prefix, the size and the PNG magic number, so
 * whatever arrives is a real PNG before pdf-lib is asked to embed it.
 */
export function decodeSignatureDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) return { error: 'Sign in the box first.' };
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_SIGNATURE_BYTES) return { error: 'That signature is not valid. Clear it and sign again.' };
  if (!bytes.subarray(0, 8).equals(PNG_MAGIC)) return { error: 'That signature is not valid. Clear it and sign again.' };
  return { bytes };
}

// Helvetica can only draw WinAnsi characters, and drawText throws on
// anything else. A name with other characters gets '?' in their place
// instead of failing the whole signing.
function drawable(text, font) {
  return Array.from(String(text || '')).map((ch) => {
    try { font.encodeText(ch); return ch; } catch (e) { return '?'; }
  }).join('');
}

function formatUtc(date) {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * originalBytes   the sent PDF
 * signerName      the roster name of the person signing
 * title           the document title the sender gave it
 * mode            'sign' | 'read'
 * signatureBytes  PNG bytes, required for 'sign'
 * companyName     printed on the page
 * signedAt        a Date
 *
 * Returns { bytes, originalSha256, pageCount }. Throws if the PDF cannot be
 * read; the caller turns that into a message.
 */
export async function appendSignaturePage({ originalBytes, signerName, title, mode, signatureBytes, companyName = '', signedAt = new Date() }) {
  const originalSha256 = sha256Hex(originalBytes);
  const doc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.addPage([612, 792]);
  const margin = 54;
  let y = 792 - margin;
  const ink = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.4, 0.4, 0.4);

  const line = (text, { size = 11, face = font, color = ink, gap = 18 } = {}) => {
    page.drawText(drawable(text, face), { x: margin, y, size, font: face, color });
    y -= gap;
  };
  // Long values wrap by characters so a 64 character hash never runs off the page.
  const wrapped = (text, { size = 9, face = font, color = ink, width = 100 } = {}) => {
    const safe = drawable(text, face);
    for (let i = 0; i < safe.length; i += width) line(safe.slice(i, i + width), { size, face, color, gap: size + 4 });
  };

  line(mode === 'sign' ? 'Signature record' : 'Acknowledgement record', { size: 20, face: bold, gap: 30 });
  if (companyName) line(companyName, { size: 12, color: grey, gap: 26 });

  line('Document', { size: 9, color: grey, gap: 13 });
  wrapped(title, { size: 12, face: bold, width: 80 });
  y -= 10;

  line(mode === 'sign' ? 'Signed by' : 'Read and acknowledged by', { size: 9, color: grey, gap: 13 });
  line(signerName, { size: 14, face: bold, gap: 24 });

  line('Date and time', { size: 9, color: grey, gap: 13 });
  line(formatUtc(signedAt), { size: 12, gap: 26 });

  if (mode === 'sign') {
    const image = await doc.embedPng(signatureBytes);
    const maxW = 300;
    const maxH = 110;
    const scale = Math.min(maxW / image.width, maxH / image.height, 1);
    const w = image.width * scale;
    const h = image.height * scale;
    line('Signature', { size: 9, color: grey, gap: 13 });
    page.drawRectangle({ x: margin, y: y - h - 8, width: w + 16, height: h + 16, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1 });
    page.drawImage(image, { x: margin + 8, y: y - h, width: w, height: h });
    y -= h + 36;
  } else {
    line('The person named above opened this document and confirmed they have read it.', { size: 11, gap: 28 });
  }

  line('SHA-256 of the original document', { size: 9, color: grey, gap: 13 });
  wrapped(originalSha256, { size: 9, width: 64 });
  y -= 6;
  line('The pages before this one are the original document, unchanged.', { size: 9, color: grey, gap: 13 });

  const bytes = await doc.save();
  return { bytes: Buffer.from(bytes), originalSha256, pageCount: doc.getPageCount() };
}
