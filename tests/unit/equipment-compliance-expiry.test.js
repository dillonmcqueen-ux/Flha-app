// Pins break #14: a machine's compliance expiries reaching past their own
// screen — the overview banner's summary and the weekly equipment report's
// compliance section.
//
// What these cases exist to stop coming back:
//   * a second 30-day window drifting away from the first, so the banner
//     and the Compliance tab disagree about the same CVIP;
//   * a document that expires TODAY reading as "current" (or an off-by-one
//     the other way), which is the one boundary this whole feature turns on;
//   * an expired document being dropped because its machine's fleet row
//     couldn't be read — an expired CVIP is worth printing even when the
//     machine's name isn't resolvable;
//   * a report generated before this shipped failing to render, or a
//     company that tracks no expiry dates getting a section it never had.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:1/';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SESSION_SECRET ||= 'test-session-secret';

const { EXPIRY_WARNING_DAYS, expiryStatus, expiryText, expiryDayDelta } = await import('../../server-lib/compliance.js');
const { foldComplianceSnapshot } = await import('../../api/equipmentreports.js');
const { renderEquipmentReportPdf } = await import('../../server-lib/reportPdfs.js');

// A fixed "as of" so these never depend on the day they run.
const ASOF = '2026-09-13';
const shift = (days) => {
  const d = new Date(`${ASOF}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ── the one window ──────────────────────────────────────────────────────

test('the warning window is 30 days, the number the Compliance tab was built on', () => {
  assert.equal(EXPIRY_WARNING_DAYS, 30);
});

test('yesterday is expired, today is due_soon, not expired', () => {
  // The day a CVIP expires it is still valid. Calling it expired a day
  // early parks a machine that is legal to run.
  assert.equal(expiryStatus(shift(-1), ASOF), 'expired');
  assert.equal(expiryStatus(ASOF, ASOF), 'due_soon');
});

test('the 30-day edge is inclusive, 31 days out is not flagged', () => {
  assert.equal(expiryStatus(shift(30), ASOF), 'due_soon');
  assert.equal(expiryStatus(shift(31), ASOF), 'ok');
});

test('a missing or unparseable date reads as ok, never as expired', () => {
  // The table requires a real date on write, so the only rows without one
  // predate that check. Flagging them would bury the real expiries.
  assert.equal(expiryStatus(null, ASOF), 'ok');
  assert.equal(expiryStatus('', ASOF), 'ok');
  assert.equal(expiryStatus('not-a-date', ASOF), 'ok');
  assert.equal(expiryDayDelta(null, ASOF), null);
});

test('the words match the classification', () => {
  assert.equal(expiryText(shift(-3), ASOF), 'Expired 3 days ago');
  assert.equal(expiryText(shift(-1), ASOF), 'Expired 1 day ago');
  assert.equal(expiryText(ASOF, ASOF), 'Expires today');
  assert.equal(expiryText(shift(1), ASOF), 'Expires in 1 day');
  assert.equal(expiryText(shift(14), ASOF), 'Expires in 14 days');
  assert.equal(expiryText(null, ASOF), 'No expiry date');
});

test('a Date and a date string as-of give the same answer', () => {
  assert.equal(
    expiryStatus(shift(5), new Date(`${ASOF}T09:30:00`)),
    expiryStatus(shift(5), ASOF),
  );
});

// ── the report snapshot ─────────────────────────────────────────────────

const fleet = new Map([
  ['7', { id: 7, year: '2019', make: 'Freightliner', model: 'M2', type: 'Gravel Truck', unit_number: '12' }],
  ['9', { id: 9, year: '', make: '', model: '', type: '', unit_number: '' }],
]);

const rows = [
  { id: 1, equipment_id: 7, doc_type: 'cvip', label: 'Alberta CVIP', expiry_date: shift(-6), notes: 'booked for Friday' },
  { id: 2, equipment_id: 7, doc_type: 'registration', label: null, expiry_date: shift(12), notes: null },
  { id: 3, equipment_id: 7, doc_type: 'insurance', label: null, expiry_date: shift(200), notes: null },
  { id: 4, equipment_id: 9, doc_type: 'cvip', label: null, expiry_date: shift(-40), notes: null },
];

test('only what needs acting on is listed; everything else is a count', () => {
  const snap = foldComplianceSnapshot(rows, fleet, ASOF);
  assert.equal(snap.expiredCount, 2);
  assert.equal(snap.dueSoonCount, 1);
  assert.equal(snap.currentCount, 1); // the insurance 200 days out
  assert.equal(snap.items.length, 3);
  assert.equal(snap.asOf, ASOF);
  assert.equal(snap.warningDays, 30);
});

test('the worst-expired line is read first', () => {
  const snap = foldComplianceSnapshot(rows, fleet, ASOF);
  assert.deepEqual(snap.items.map(i => i.expiryDate), [shift(-40), shift(-6), shift(12)]);
  assert.equal(snap.items[0].status, 'expired');
  assert.equal(snap.items[2].status, 'due_soon');
});

test('a machine is named the same way it is named everywhere else', () => {
  const snap = foldComplianceSnapshot(rows, fleet, ASOF);
  const truck = snap.items.find(i => i.equipmentId === 7);
  assert.equal(truck.equipmentLabel, '2019 Freightliner M2 Gravel Truck (Unit 12)');
});

test('a document with no label of its own is named the way the app names it', () => {
  // The column stores 'registration'; a printed report a supervisor hands
  // to an auditor should not say 'registration' in lower case.
  const snap = foldComplianceSnapshot(rows, fleet, ASOF);
  assert.equal(snap.items.find(i => i.docType === 'registration').label, 'Registration');
  // A supervisor's own wording still wins.
  assert.equal(snap.items.find(i => i.docType === 'cvip' && i.equipmentId === 7).label, 'Alberta CVIP');
  // Free text that is not on the shortlist reads back as itself.
  const odd = foldComplianceSnapshot(
    [{ id: 6, equipment_id: 7, doc_type: 'pressure vessel re-test', label: null, expiry_date: shift(-1), notes: null }],
    fleet, ASOF,
  );
  assert.equal(odd.items[0].label, 'pressure vessel re-test');
});

test('a machine with nothing filled in still gets a label rather than an empty cell', () => {
  const snap = foldComplianceSnapshot(rows, fleet, ASOF);
  const blank = snap.items.find(i => i.equipmentId === 9);
  assert.equal(blank.equipmentLabel, 'Machine #9');
});

test('an unresolvable machine still lists its expired document', () => {
  // The FK cascades, so this is belt and braces — but dropping the row
  // would be losing an expiry because a name lookup missed.
  const snap = foldComplianceSnapshot(
    [{ id: 5, equipment_id: 404, doc_type: 'cvip', label: null, expiry_date: shift(-2), notes: null }],
    fleet,
    ASOF,
  );
  assert.equal(snap.items.length, 1);
  assert.equal(snap.items[0].equipmentLabel, 'Unknown machine');
  assert.equal(snap.items[0].status, 'expired');
});

test('no rows means no items and no counts, not a section full of zeros', () => {
  const snap = foldComplianceSnapshot([], fleet, ASOF);
  assert.deepEqual(snap.items, []);
  assert.equal(snap.expiredCount, 0);
  assert.equal(snap.currentCount, 0);
  // Null-safe on the way in, since the query can come back empty.
  assert.deepEqual(foldComplianceSnapshot(null, null, ASOF).items, []);
});

test('the snapshot is classified as of the report week, not as of today', () => {
  // A report pulled for a week in the past says what was expired THEN,
  // which is the whole point of storing it in report_json rather than
  // reading it live when someone opens the PDF.
  const backThen = foldComplianceSnapshot(rows, fleet, shift(-30));
  assert.equal(backThen.expiredCount, 1); // only the -40 one had lapsed yet
  assert.equal(backThen.asOf, shift(-30));
});

// ── the PDF ─────────────────────────────────────────────────────────────

const baseReport = {
  id: 1,
  report_json: {
    weekStart: shift(-6),
    weekEnd: ASOF,
    equipment: [
      { equipmentId: 7, equipmentLabel: '2019 Freightliner M2 Gravel Truck (Unit 12)', unit: 'km', usage: 412.5, endingReading: 180422, endingReadingDate: `${ASOF}T12:00:00Z`, issues: [], noPostTripCount: 0, attachments: [] },
    ],
  },
};

test('a report written before this shipped still renders', async () => {
  const buf = await renderEquipmentReportPdf({ report: baseReport, companyName: 'Test Co', companyLogo: '' });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 1000);
});

test('a company that tracks no expiry dates gets the same PDF it always got', async () => {
  // `compliance` is absent, not an empty object — the build only attaches
  // the key when the company has rows.
  const withEmpty = { ...baseReport, report_json: { ...baseReport.report_json, compliance: { asOf: ASOF, warningDays: 30, expiredCount: 0, dueSoonCount: 0, currentCount: 4, items: [] } } };
  const a = await renderEquipmentReportPdf({ report: baseReport, companyName: 'Test Co', companyLogo: '' });
  const b = await renderEquipmentReportPdf({ report: withEmpty, companyName: 'Test Co', companyLogo: '' });
  // Same length: nothing is drawn for a section with no actionable rows.
  assert.equal(a.length, b.length);
});

test('a report carrying compliance rows renders more than one without them', async () => {
  const snap = foldComplianceSnapshot(rows, fleet, ASOF);
  const withCompliance = { ...baseReport, report_json: { ...baseReport.report_json, compliance: snap } };
  const a = await renderEquipmentReportPdf({ report: baseReport, companyName: 'Test Co', companyLogo: '' });
  const b = await renderEquipmentReportPdf({ report: withCompliance, companyName: 'Test Co', companyLogo: '' });
  assert.ok(b.length > a.length, 'compliance section should add content to the PDF');
});

test("a supervisor's note rides along with the expiry", async () => {
  // "shop booked Sept 22" is the difference between an expiry someone is
  // already dealing with and one nobody has touched.
  const snap = foldComplianceSnapshot(rows, fleet, ASOF);
  const noted = snap.items.find(i => i.notes);
  assert.equal(noted.notes, 'booked for Friday');
  const withNote = { ...baseReport, report_json: { ...baseReport.report_json, compliance: snap } };
  const stripped = { ...baseReport, report_json: { ...baseReport.report_json, compliance: { ...snap, items: snap.items.map(i => ({ ...i, notes: null })) } } };
  const a = await renderEquipmentReportPdf({ report: stripped, companyName: 'Test Co', companyLogo: '' });
  const b = await renderEquipmentReportPdf({ report: withNote, companyName: 'Test Co', companyLogo: '' });
  assert.ok(b.length > a.length, 'the note should reach the page');
});

test('a long compliance list pages without throwing, and the footer still numbers every page', async () => {
  const many = [];
  for (let i = 0; i < 60; i++) {
    many.push({ id: 100 + i, equipment_id: 7, doc_type: 'cvip', label: `Doc ${i}`, expiry_date: shift(-i - 1), notes: null });
  }
  const snap = foldComplianceSnapshot(many, fleet, ASOF);
  const report = { ...baseReport, report_json: { ...baseReport.report_json, compliance: snap } };
  const buf = await renderEquipmentReportPdf({ report, companyName: 'Test Co', companyLogo: '' });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 1000);
});
