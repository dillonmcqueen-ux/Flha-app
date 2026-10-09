// Guards docs/schema/document-engine-wp1-migration.sql: every engine table
// is created, has RLS enabled, and no policy is ever added (deny by default,
// all access through api/*.js with the service role).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../docs/schema/document-engine-wp1-migration.sql', import.meta.url), 'utf8');

const TABLES = [
  'document_definitions', 'document_versions', 'document_fields', 'document_layouts',
  'document_rules', 'document_reference_files', 'company_documents', 'document_records',
  'document_answers', 'document_signatures', 'document_attachments',
];

test('creates every engine table', () => {
  for (const t of TABLES) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t} \\(`), `missing create for ${t}`);
  }
  const created = [...sql.matchAll(/create table if not exists public\.(\w+) \(/g)].map(m => m[1]);
  assert.deepEqual([...created].sort(), [...TABLES].sort(), 'unexpected extra or missing table');
});

test('enables RLS on every engine table', () => {
  for (const t of TABLES) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security;`), `RLS missing on ${t}`);
  }
});

test('never creates a policy', () => {
  assert.doesNotMatch(sql, /create\s+policy/i);
});

test('company-owned tables carry a company_id', () => {
  for (const t of ['document_definitions', 'company_documents', 'document_records']) {
    const block = sql.slice(sql.indexOf(`create table if not exists public.${t} (`));
    const body = block.slice(0, block.indexOf(');'));
    assert.match(body, /company_id bigint/, `${t} needs company_id`);
  }
});

test('a replayed submit cannot create a second record', () => {
  assert.match(sql, /document_records_client_submission_uidx[\s\S]*client_submission_id is not null/);
});

test('contains no em dash', () => {
  assert.equal(sql.includes('—'), false);
});
