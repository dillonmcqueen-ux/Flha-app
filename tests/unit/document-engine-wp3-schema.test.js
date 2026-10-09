// Guards docs/schema/document-engine-wp3-migration.sql the way the WP1 test
// guards its migration: RLS on, no policy, and the columns the sweeps use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../docs/schema/document-engine-wp3-migration.sql', import.meta.url), 'utf8');

test('adds the review and sweep columns to document_records', () => {
  for (const col of ['review_step', 'unsigned_alerted_at', 'review_alerted_at']) {
    assert.match(sql, new RegExp(`add column if not exists ${col} `), col);
  }
});

test('creates document_escalations with RLS on and no policy', () => {
  assert.match(sql, /create table if not exists public\.document_escalations \(/);
  assert.match(sql, /alter table public\.document_escalations enable row level security;/);
  assert.doesNotMatch(sql, /create\s+policy/i);
});

test('an escalation is unique per field per record and scoped to a company', () => {
  assert.match(sql, /unique \(record_id, field_key\)/);
  assert.match(sql, /company_id bigint not null references public\.companies\(id\)/);
});

test('never stores the answer value', () => {
  const block = sql.slice(sql.indexOf('create table if not exists public.document_escalations'));
  assert.doesNotMatch(block, /value_text|value_json|answer_value/);
});

test('contains no em dash', () => {
  assert.equal(sql.includes('—'), false);
});
