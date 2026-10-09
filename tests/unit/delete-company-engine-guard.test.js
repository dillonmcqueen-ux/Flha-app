// Break #54: deleting a company must refuse when it has unified-engine records,
// because document_records.company_id is ON DELETE CASCADE and would otherwise
// take every engine record, answer and signature with it. The guard is the
// list of record tables delete_company counts before it cleans anything up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('delete_company counts document_records before it deletes anything', () => {
  const src = readFileSync(new URL('../../api/admin.js', import.meta.url), 'utf8');
  const start = src.indexOf("if (action === 'delete_company')");
  assert.ok(start > 0);
  const body = src.slice(start, start + 6000);
  const list = /const tables = \[([^\]]*)\]/.exec(body);
  assert.ok(list, 'the guard list is missing');
  assert.match(list[1], /'document_records'/);
  // The count runs before the first cleanup step.
  assert.ok(body.indexOf("'document_records'") < body.indexOf('cleanupSteps'));
});
