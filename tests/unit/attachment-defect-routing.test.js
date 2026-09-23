// Break #17: an attachment's defect opened its corrective action against
// whatever was carrying it.
//
// api/logs.js handed openCorrectiveActions the HOST record's equipment_id
// and label for every Defective item, including the attachment's. So a bent
// set of forks flagged on Loader 3's pre-trip opened an action against
// Loader 3; move the forks to Loader 5 and the fault stayed with Loader 3,
// and recurrence counted the wrong machine. Meanwhile the weekly report
// routed the same defect to the forks' own line (attachmentForItem). Two
// features disagreed about which machine a defect belongs to, from one row.
//
// Pinned here: every finding carries the machine it belongs to, and
// groupFindingsByMachine splits one inspection's findings per machine with
// only VETTED fleet ids, so an attachment id the client made up can never
// reach corrective_actions.equipment_id.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  correctiveActionsFromInspection,
  resolvedItemsFromPosttrip,
  groupFindingsByMachine,
} = await import('../../server-lib/correctiveActions.js');

const item = (over = {}) => ({ item: 'Fork tines for cracks or bends', category: 'Forks', condition: 'Good', note: '', ...over });
const HOST = { equipmentId: 3, equipmentLabel: 'CAT 950 Loader (Unit 3)' };

test("an attachment item's finding names the attachment, by id", () => {
  const [finding] = correctiveActionsFromInspection({
    items: [item({ condition: 'Defective', unit: 'attachment', unitLabel: 'Pallet Forks (Unit 12)', attachmentId: 12 })],
    attachments: [{ id: 12, label: 'Pallet Forks (Unit 12)' }],
  }, HOST.equipmentLabel);
  assert.deepEqual(finding.attachment, { id: 12, label: 'Pallet Forks (Unit 12)' });
});

test("the host machine's own item carries no attachment", () => {
  const [finding] = correctiveActionsFromInspection({
    items: [item({ item: 'Hydraulic hoses', condition: 'Defective', unit: 'truck' })],
  }, HOST.equipmentLabel);
  assert.equal(finding.attachment ?? null, null);
});

test('a post-trip item keeps its attachment even when the post-trip has no attachments list', () => {
  // buildPosttripItems carries attachmentId forward on each item; the
  // post-trip record itself may not repeat the attachments array.
  const [fixed] = resolvedItemsFromPosttrip({
    items: [item({ unit: 'attachment', unitLabel: 'Pallet Forks (Unit 12)', attachmentId: 12, carriedFrom: true, carriedCondition: 'Defective', resolution: 'fixed' })],
  });
  assert.deepEqual(fixed.attachment, { id: 12, label: 'Pallet Forks (Unit 12)' });
});

test('findings split per machine: the loader keeps its own, the forks get theirs', () => {
  const findings = correctiveActionsFromInspection({
    items: [
      item({ item: 'Hydraulic hoses', condition: 'Defective', unit: 'truck' }),
      item({ condition: 'Defective', unit: 'attachment', unitLabel: 'Pallet Forks (Unit 12)', attachmentId: 12 }),
    ],
    attachments: [{ id: 12, label: 'Pallet Forks (Unit 12)' }],
  }, HOST.equipmentLabel);
  const groups = groupFindingsByMachine(findings, HOST, new Set(['12']));
  assert.equal(groups.length, 2);
  const loader = groups.find(g => g.equipmentId === 3);
  const forks = groups.find(g => g.equipmentId === 12);
  assert.equal(loader.findings.length, 1);
  assert.equal(forks.equipmentLabel, 'Pallet Forks (Unit 12)');
  assert.match(forks.findings[0].description, /^Pallet Forks \(Unit 12\):/);
});

test('an attachment id that did not pass vetting keeps its label and loses the id', () => {
  // Another company's machine, or a number that does not exist. The label
  // still names the right thing on the action; the id never reaches the row.
  const findings = correctiveActionsFromInspection({
    items: [item({ condition: 'Defective', unit: 'attachment', unitLabel: 'Pallet Forks (Unit 12)', attachmentId: 999 })],
  }, HOST.equipmentLabel);
  const [group] = groupFindingsByMachine(findings, HOST, new Set());
  assert.equal(group.equipmentId, null);
  assert.equal(group.equipmentLabel, 'Pallet Forks (Unit 12)');
});

test('a free-text attachment (no id) still gets its own group, by label', () => {
  const findings = correctiveActionsFromInspection({
    items: [item({ condition: 'Defective', unit: 'trailer', unitLabel: 'Borrowed tilt deck' })],
  }, HOST.equipmentLabel);
  const [group] = groupFindingsByMachine(findings, HOST, new Set());
  assert.equal(group.equipmentId, null);
  assert.equal(group.equipmentLabel, 'Borrowed tilt deck');
});
