// server-lib/documentEngine/service.js
// Database operations for the unified document engine (WP2). Every function
// takes the Supabase client as its first argument, the way
// server-lib/docKeyGate.js and server-lib/equipmentScope.js do, so the same
// code runs behind api/documents.js and in unit tests against an in-memory
// client. Nothing here reads a session token: the handler resolves who is
// calling and which company, and passes both in.
//
// Tenant rule: every read and write is scoped by an explicit companyId from
// the handler (the session's company, or the requested one for a founder).
// A definition that belongs to another company answers 404, the same as one
// that does not exist, so ids cannot be probed across tenants.
//
// What is NOT here yet, on purpose:
//   - Acting on rules (routing chains, notifications, corrective actions,
//     Brain signals) is WP3. WP2 stores rules and reads two of them:
//     reviewer_step (the record starts pending_approval) and signature_step
//     with signer 'worker' (a worker signature is required).
//   - Document assignments and the crew lead's approval rules are WP3/WP7.
//     Supervisors see records through the existing rule A scope
//     (server-lib/documentAccess.js scopeRecords), which already understands
//     site_id and submitted_by_roster_id.

import { normalizeFields, normalizeLayout, normalizeRules, validateDefinitionInput, validateAnswers } from './validate.js';
import { authorRosterId } from '../authorStamp.js';
import { scopeRecords } from '../documentAccess.js';

export class EngineError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const asId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const same = (a, b) => a != null && b != null && Number(a) === Number(b);
const isAdmin = (session) => !!session && session.role === 'admin';
const isSupervisorTier = (session) => isAdmin(session) || session?.role === 'supervisor';
// The database's own message is never sent to the browser.
const dbFail = (error, what) => {
  if (error) console.error(`documents: couldn't ${what}:`, error.message || error);
  return new EngineError(500, `Couldn't ${what}.`);
};

async function one(query, what) {
  const { data, error } = await query.limit(1);
  if (error) throw dbFail(error, what);
  return (data && data[0]) || null;
}

// An update that must touch exactly the row it expects. Returns the rows it
// changed, so a caller can tell a lost race (nothing changed) from success.
async function updated(query, what) {
  const { data, error } = await query.select('id');
  if (error) throw dbFail(error, what);
  return data || [];
}

async function many(query, what) {
  const { data, error } = await query;
  if (error) throw dbFail(error, what);
  return data || [];
}

async function must(query, what) {
  const { error } = await query;
  if (error) throw dbFail(error, what);
}

// ── Definitions ────────────────────────────────────────────────────────────

/**
 * Loads a definition the caller may touch. A FORA template (company_id null)
 * is readable by any company; editing one is refused in requireEditable. A
 * definition owned by a different company answers 404.
 */
async function loadDefinition(db, definitionId, { companyId }) {
  const id = asId(definitionId);
  if (!id) throw new EngineError(400, 'Missing document id.');
  const def = await one(db.from('document_definitions').select('*').eq('id', id), 'load the document');
  if (!def) throw new EngineError(404, 'Document not found.');
  if (def.company_id == null) return { ...def, _template: true };
  if (!same(def.company_id, companyId)) throw new EngineError(404, 'Document not found.');
  return { ...def, _template: false };
}

function requireEditable(def, { companyId }) {
  // Editing a template needs no company (founder editing FORA's own library).
  if (def._template && companyId != null) throw new EngineError(403, 'FORA templates cannot be edited for a company. Clone it first.');
}

export async function createDefinition(db, { companyId, title, icon, category, key }) {
  const input = validateDefinitionInput({ title, icon, category, key });
  if (input.error) throw new EngineError(400, input.error);
  const cid = companyId == null ? null : asId(companyId);
  if (companyId != null && !cid) throw new EngineError(400, 'Missing company id.');

  const existing = cid
    ? await one(db.from('document_definitions').select('id').eq('company_id', cid).eq('key', input.key), 'check the document key')
    : await one(db.from('document_definitions').select('id').is('company_id', null).eq('key', input.key), 'check the document key');
  if (existing) throw new EngineError(409, 'A document with that name already exists.');

  const { data, error } = await db.from('document_definitions').insert({
    company_id: cid,
    key: input.key,
    title: input.title,
    icon: input.icon,
    category: input.category,
    origin: cid ? 'custom' : 'template',
  }).select('*');
  if (error || !data || !data[0]) throw dbFail(error, 'create the document');
  const definition = data[0];
  const draft = await insertVersion(db, definition.id, 1, input.title);
  return { definition, draftVersionId: draft.id };
}

async function insertVersion(db, definitionId, versionNumber, title) {
  const { data, error } = await db.from('document_versions').insert({
    definition_id: definitionId,
    version_number: versionNumber,
    status: 'draft',
    title,
  }).select('*');
  if (error || !data || !data[0]) throw dbFail(error, 'start a new version');
  return data[0];
}

async function copyVersionContent(db, fromVersionId, toVersionId) {
  const fields = await many(db.from('document_fields').select('*').eq('version_id', fromVersionId), 'read the fields');
  if (fields.length > 0) {
    await must(db.from('document_fields').insert(fields.map(({ id, version_id, ...rest }) => ({ ...rest, version_id: toVersionId }))), 'copy the fields');
  }
  const layout = await one(db.from('document_layouts').select('*').eq('version_id', fromVersionId), 'read the layout');
  if (layout) {
    const { id, version_id, created_at, ...rest } = layout;
    await must(db.from('document_layouts').insert({ ...rest, version_id: toVersionId }), 'copy the layout');
  }
  const rules = await many(db.from('document_rules').select('*').eq('version_id', fromVersionId), 'read the rules');
  if (rules.length > 0) {
    await must(db.from('document_rules').insert(rules.map(({ id, version_id, ...rest }) => ({ ...rest, version_id: toVersionId }))), 'copy the rules');
  }
  const refs = await many(db.from('document_reference_files').select('*').eq('version_id', fromVersionId), 'read the reference files');
  if (refs.length > 0) {
    await must(db.from('document_reference_files').insert(refs.map(({ id, version_id, created_at, ...rest }) => ({ ...rest, version_id: toVersionId }))), 'copy the reference files');
  }
}

/**
 * Gives a company its own editable copy of a FORA template. The copy starts
 * as a draft so nothing reaches workers until it is published.
 */
export async function cloneTemplate(db, { companyId, templateId }) {
  const cid = asId(companyId);
  if (!cid) throw new EngineError(400, 'Missing company id.');
  const template = await loadDefinition(db, templateId, { companyId: null });
  if (!template.current_version_id) throw new EngineError(409, 'That template has no published version yet.');

  const existing = await one(db.from('document_definitions').select('id').eq('company_id', cid).eq('key', template.key), 'check for an existing copy');
  if (existing) throw new EngineError(409, 'This company already has its own copy of that template.');

  const { data, error } = await db.from('document_definitions').insert({
    company_id: cid,
    key: template.key,
    title: template.title,
    icon: template.icon,
    category: template.category,
    origin: 'custom',
    template_id: template.id,
  }).select('*');
  if (error || !data || !data[0]) throw dbFail(error, 'copy the template');
  const definition = data[0];
  const draft = await insertVersion(db, definition.id, 1, template.title);
  await copyVersionContent(db, template.current_version_id, draft.id);
  return { definition, draftVersionId: draft.id };
}

/**
 * Saves the editable draft: fields, layout and rules replace what the draft
 * held. A published version is never touched. If the definition has no open
 * draft, a new one is started as the next version number.
 */
export async function saveDraft(db, { companyId, definitionId, title, fields, layout, rules }) {
  const def = await loadDefinition(db, definitionId, { companyId });
  requireEditable(def, { companyId });

  const f = normalizeFields(fields);
  if (f.error) throw new EngineError(400, f.error);
  const l = normalizeLayout(layout);
  if (l.error) throw new EngineError(400, l.error);
  const r = normalizeRules(rules);
  if (r.error) throw new EngineError(400, r.error);
  const cleanTitle = String(title || def.title || '').trim();
  if (!cleanTitle || cleanTitle.length > 150) throw new EngineError(400, 'Give the document a title (150 characters max).');

  let draft = await one(db.from('document_versions').select('*').eq('definition_id', def.id).eq('status', 'draft'), 'find the draft');
  if (!draft) {
    const versions = await many(db.from('document_versions').select('version_number').eq('definition_id', def.id), 'read the versions');
    const next = versions.reduce((m, v) => Math.max(m, Number(v.version_number) || 0), 0) + 1;
    draft = await insertVersion(db, def.id, next, cleanTitle);
  } else if (draft.title !== cleanTitle) {
    await must(db.from('document_versions').update({ title: cleanTitle }).eq('id', draft.id), 'update the draft');
  }

  // A draft has never had a record filed against it (records point only at
  // published versions), so replacing its children cannot orphan an answer.
  await must(db.from('document_fields').delete().eq('version_id', draft.id), 'replace the fields');
  await must(db.from('document_fields').insert(f.fields.map((x) => ({ ...x, version_id: draft.id }))), 'save the fields');
  await must(db.from('document_layouts').delete().eq('version_id', draft.id), 'replace the layout');
  await must(db.from('document_layouts').insert({ version_id: draft.id, layout_json: l.layout }), 'save the layout');
  await must(db.from('document_rules').delete().eq('version_id', draft.id), 'replace the rules');
  if (r.rules.length > 0) {
    await must(db.from('document_rules').insert(r.rules.map((x) => ({ ...x, version_id: draft.id }))), 'save the rules');
  }
  return { versionId: draft.id, versionNumber: draft.version_number, fieldCount: f.fields.length };
}

/**
 * Publishes the open draft. The previous published version is retired, but
 * stays in the database forever: records filed on it keep rendering with it.
 */
export async function publishDraft(db, { companyId, definitionId }) {
  const def = await loadDefinition(db, definitionId, { companyId });
  requireEditable(def, { companyId });
  const draft = await one(db.from('document_versions').select('*').eq('definition_id', def.id).eq('status', 'draft'), 'find the draft');
  if (!draft) throw new EngineError(409, 'There is no draft to publish.');
  const fields = await many(db.from('document_fields').select('id').eq('version_id', draft.id), 'read the fields');
  if (fields.length === 0) throw new EngineError(409, 'Add at least one field before publishing.');

  const nowIso = new Date().toISOString();
  await must(db.from('document_versions').update({ status: 'published', published_at: nowIso }).eq('id', draft.id), 'publish');
  await must(db.from('document_definitions').update({ current_version_id: draft.id, title: draft.title, updated_at: nowIso }).eq('id', def.id), 'point the document at the new version');
  if (def.current_version_id && !same(def.current_version_id, draft.id)) {
    await must(db.from('document_versions').update({ status: 'retired' }).eq('id', def.current_version_id), 'retire the old version');
  }
  return { versionId: draft.id, versionNumber: draft.version_number };
}

// ── Per-company switch ─────────────────────────────────────────────────────

export async function setCompanyDocument(db, { companyId, definitionId, isEnabled, brainEnabled, ownerMuted }) {
  const cid = asId(companyId);
  if (!cid) throw new EngineError(400, 'Missing company id.');
  const def = await loadDefinition(db, definitionId, { companyId: cid });
  if (isEnabled === true && !def.current_version_id) throw new EngineError(409, 'Publish the document before switching it on.');

  const patch = {};
  if (typeof isEnabled === 'boolean') {
    patch.is_enabled = isEnabled;
    if (isEnabled) patch.enabled_at = new Date().toISOString();
  }
  if (typeof brainEnabled === 'boolean') patch.brain_enabled = brainEnabled;
  if (typeof ownerMuted === 'boolean') patch.owner_muted = ownerMuted;

  const row = await one(db.from('company_documents').select('*').eq('company_id', cid).eq('definition_id', def.id), 'read the document setting');
  if (row) {
    if (Object.keys(patch).length > 0) {
      await must(db.from('company_documents').update(patch).eq('id', row.id), 'save the document setting');
    }
    return { ...row, ...patch };
  }
  const { data, error } = await db.from('company_documents').insert({ company_id: cid, definition_id: def.id, ...patch }).select('*');
  if (error || !data || !data[0]) throw dbFail(error, 'save the document setting');
  return data[0];
}

/** Everything the builder shows for one company: its own documents plus the FORA templates. */
export async function listCompanyDocuments(db, { companyId }) {
  const cid = asId(companyId);
  if (!cid) throw new EngineError(400, 'Missing company id.');
  const own = await many(db.from('document_definitions').select('*').eq('company_id', cid), 'list the documents');
  const templates = await many(db.from('document_definitions').select('*').is('company_id', null), 'list the templates');
  const settings = await many(db.from('company_documents').select('*').eq('company_id', cid), 'list the document settings');
  const bySetting = new Map(settings.map((s) => [Number(s.definition_id), s]));
  const shape = (d, owned) => {
    const s = bySetting.get(Number(d.id));
    return {
      id: d.id,
      key: d.key,
      title: d.title,
      icon: d.icon,
      category: d.category,
      origin: d.origin,
      templateId: d.template_id || null,
      companyOwned: owned,
      currentVersionId: d.current_version_id || null,
      archived: !!d.archived_at,
      enabled: !!(s && s.is_enabled),
      brainEnabled: s ? s.brain_enabled !== false : true,
      ownerMuted: !!(s && s.owner_muted),
    };
  };
  return {
    documents: [...own.map((d) => shape(d, true)), ...templates.map((d) => shape(d, false))]
      .sort((a, b) => String(a.title).localeCompare(String(b.title))),
  };
}

async function readVersionContent(db, version) {
  const fields = await many(db.from('document_fields').select('*').eq('version_id', version.id), 'read the fields');
  fields.sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
  const layoutRow = await one(db.from('document_layouts').select('*').eq('version_id', version.id), 'read the layout');
  const rules = await many(db.from('document_rules').select('*').eq('version_id', version.id), 'read the rules');
  rules.sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
  const reference = await many(db.from('document_reference_files').select('*').eq('version_id', version.id), 'read the reference files');
  return { fields, layout: layoutRow ? layoutRow.layout_json : {}, rules, reference };
}

/** The admin editor's view: the open draft if there is one, else the published version. */
export async function getDefinitionForBuilder(db, { companyId, definitionId }) {
  const def = await loadDefinition(db, definitionId, { companyId });
  const versions = await many(db.from('document_versions').select('*').eq('definition_id', def.id), 'read the versions');
  versions.sort((a, b) => b.version_number - a.version_number);
  const draft = versions.find((v) => v.status === 'draft') || null;
  const published = versions.find((v) => same(v.id, def.current_version_id)) || null;
  const shown = draft || published;
  const content = shown ? await readVersionContent(db, shown) : { fields: [], layout: {}, rules: [], reference: [] };
  return {
    definition: def,
    shownVersion: shown ? { id: shown.id, versionNumber: shown.version_number, status: shown.status, title: shown.title } : null,
    versions: versions.map((v) => ({ id: v.id, versionNumber: v.version_number, status: v.status, publishedAt: v.published_at })),
    ...content,
  };
}

/**
 * What a worker needs to fill a document: only if the company has it
 * switched on and published. Rules are not sent, apart from the signature
 * steps the form must show.
 */
export async function getDocumentForWorker(db, { companyId, definitionId }) {
  const cid = asId(companyId);
  if (!cid) throw new EngineError(400, 'Missing company id.');
  const def = await loadDefinition(db, definitionId, { companyId: cid });
  const setting = await one(db.from('company_documents').select('*').eq('company_id', cid).eq('definition_id', def.id), 'read the document setting');
  if (!setting || !setting.is_enabled || !def.current_version_id || def.archived_at) throw new EngineError(404, 'Document not found.');
  const version = await one(db.from('document_versions').select('*').eq('id', def.current_version_id), 'read the version');
  if (!version || version.status !== 'published') throw new EngineError(404, 'Document not found.');
  const content = await readVersionContent(db, version);
  return {
    definition: { id: def.id, key: def.key, title: version.title, icon: def.icon, category: def.category },
    versionId: version.id,
    fields: content.fields,
    layout: content.layout,
    reference: content.reference,
    signatureSteps: content.rules.filter((r) => r.rule_type === 'signature_step').map((r) => r.config),
  };
}

export async function listWorkerDocuments(db, { companyId }) {
  const cid = asId(companyId);
  if (!cid) throw new EngineError(400, 'Missing company id.');
  const settings = await many(db.from('company_documents').select('*').eq('company_id', cid).eq('is_enabled', true), 'list the documents');
  if (settings.length === 0) return { documents: [] };
  const ids = settings.map((s) => s.definition_id);
  const defs = await many(db.from('document_definitions').select('*').in('id', ids), 'list the documents');
  return {
    documents: defs
      .filter((d) => d.current_version_id && !d.archived_at && (d.company_id == null || same(d.company_id, cid)))
      .map((d) => ({ id: d.id, key: d.key, title: d.title, icon: d.icon, category: d.category }))
      .sort((a, b) => String(a.title).localeCompare(String(b.title))),
  };
}

// ── Records ────────────────────────────────────────────────────────────────

function ruleFlags(rules) {
  return {
    needsReview: rules.some((r) => r.rule_type === 'reviewer_step'),
    needsWorkerSignature: rules.some((r) => r.rule_type === 'signature_step' && r.config?.signer === 'worker'),
  };
}

/**
 * Crew signers are validated against the roster. The client names a roster
 * id and a signature receipt; the NAME on the record always comes from the
 * roster row, never from the request (the interaction map's crew signature
 * weak point is that today's FLHA trusts a client-sent name). The author
 * cannot countersign their own document and nobody signs twice.
 */
async function resolveCrew(db, { companyId, authorId, crew, resolveFile }) {
  if (crew == null) return [];
  if (!Array.isArray(crew)) throw new EngineError(400, 'The crew list is not valid.');
  if (crew.length > 50) throw new EngineError(400, 'Too many crew signatures.');
  const ids = [];
  for (const c of crew) {
    const id = asId(c?.rosterId);
    if (!id) throw new EngineError(400, 'Every crew signature needs a crew member.');
    if (same(id, authorId)) throw new EngineError(400, 'You cannot sign as your own crew member.');
    if (ids.includes(id)) throw new EngineError(400, 'A crew member can only sign once.');
    ids.push(id);
  }
  if (ids.length === 0) return [];
  const rows = await many(db.from('roster').select('id, name, active').eq('company_id', companyId).in('id', ids), 'check the crew');
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  return crew.map((c) => {
    const row = byId.get(Number(c.rosterId));
    if (!row || row.active === false) throw new EngineError(400, 'A crew member is not on this company\'s active roster.');
    const path = resolveFile(c.signature, { field_type: 'signature' });
    if (!path) throw new EngineError(400, `${row.name} still needs to sign.`);
    return { kind: 'crew', signer_roster_id: row.id, signer_name: row.name, signer_role: 'crew', signature_path: path };
  });
}

/**
 * Files a record. `deps.resolveFile(value, field)` turns a client upload
 * receipt into the stored path (null if it is not one this server issued for
 * this company). `deps.resolveSiteId(raw)` vets a site id.
 */
export async function submitRecord(db, { session, companyId, definitionId, answers, notes, siteId, clientSubmissionId, signLater, signature, pdfReceipt, crew, deps }) {
  const cid = asId(companyId);
  if (!cid) throw new EngineError(400, 'Missing company id.');
  const def = await loadDefinition(db, definitionId, { companyId: cid });
  const setting = await one(db.from('company_documents').select('*').eq('company_id', cid).eq('definition_id', def.id), 'read the document setting');
  if (!setting || !setting.is_enabled || !def.current_version_id || def.archived_at) throw new EngineError(403, 'This document is not switched on for your company.');

  const csid = clientSubmissionId ? String(clientSubmissionId).slice(0, 100) : null;
  if (csid) {
    // Scoped to the author too: a coworker who sends the same id must not
    // be handed someone else's record id and status.
    const mine = authorRosterId(session);
    let dupQuery = db.from('document_records').select('*').eq('company_id', cid).eq('definition_id', def.id).eq('client_submission_id', csid);
    dupQuery = mine == null ? dupQuery.is('submitted_by_roster_id', null) : dupQuery.eq('submitted_by_roster_id', mine);
    const dup = await one(dupQuery, 'check for a repeat submission');
    if (dup) return { record: dup, duplicate: true };
  }

  const version = await one(db.from('document_versions').select('*').eq('id', def.current_version_id), 'read the version');
  if (!version || version.status !== 'published') throw new EngineError(403, 'This document is not available.');
  const content = await readVersionContent(db, version);
  const flags = ruleFlags(content.rules);

  const checked = validateAnswers(content.fields, answers, { notes, resolveFile: deps.resolveFile });
  if (checked.error) throw new EngineError(400, checked.error);

  const authorId = authorRosterId(session);
  const wantsSignLater = signLater === true;
  if (wantsSignLater && !authorId) throw new EngineError(400, 'Signing afterwards needs an individual sign in.');
  if (wantsSignLater && !flags.needsWorkerSignature) throw new EngineError(400, 'This document has nothing to sign afterwards.');

  const workerSigPath = signature ? deps.resolveFile(signature, { field_type: 'signature' }) : null;
  if (flags.needsWorkerSignature && !wantsSignLater && !workerSigPath) throw new EngineError(400, 'Sign the document before submitting.');

  const crewSigs = await resolveCrew(db, { companyId: cid, authorId, crew, resolveFile: deps.resolveFile });

  let resolvedSite = null;
  if (siteId !== undefined && siteId !== null && siteId !== '') {
    resolvedSite = await deps.resolveSiteId(siteId);
    if (resolvedSite === false) throw new EngineError(403, 'Not allowed.');
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await db.from('document_records').insert({
    company_id: cid,
    definition_id: def.id,
    version_id: version.id,
    status: flags.needsReview ? 'pending_approval' : 'submitted',
    site_id: resolvedSite || null,
    submitted_by_roster_id: authorId,
    client_submission_id: csid,
    pdf_path: pdfReceipt ? deps.resolveFile(pdfReceipt, { field_type: 'pdf' }) : null,
    awaiting_signature: wantsSignLater,
    signature_requested_at: wantsSignLater ? nowIso : null,
    submitted_at: nowIso,
  }).select('*');
  if (error || !data || !data[0]) throw dbFail(error, 'save the document');
  const record = data[0];

  try {
    if (checked.rows.length > 0) {
      await must(db.from('document_answers').insert(checked.rows.map((x) => ({ ...x, record_id: record.id }))), 'save the answers');
    }
    const sigRows = [...crewSigs];
    if (workerSigPath && !wantsSignLater) {
      sigRows.unshift({ kind: 'worker', signer_roster_id: authorId, signer_name: sessionName(session), signer_role: session?.role || null, signature_path: workerSigPath });
    }
    if (sigRows.length > 0) {
      await must(db.from('document_signatures').insert(sigRows.map((x) => ({ ...x, record_id: record.id, signed_at: nowIso }))), 'save the signatures');
    }
  } catch (e) {
    // Do not leave a half-saved record behind. Answers and signatures
    // cascade from the record.
    await db.from('document_records').delete().eq('id', record.id);
    throw e;
  }
  return { record, duplicate: false };
}

function sessionName(session) {
  return String((session && (session.name || session.userName)) || '').trim() || 'Unknown';
}

async function loadRecord(db, recordId, companyId) {
  const id = asId(recordId);
  if (!id) throw new EngineError(400, 'Missing record id.');
  const record = await one(db.from('document_records').select('*').eq('id', id).eq('company_id', companyId), 'load the record');
  if (!record) throw new EngineError(404, 'Record not found.');
  return record;
}

/** Who may see one record: its author, or a supervisor tier caller inside their scope. */
async function requireRecordView(db, session, record) {
  if (authorRosterId(session) != null && same(record.submitted_by_roster_id, authorRosterId(session))) return;
  if (!isSupervisorTier(session)) throw new EngineError(403, 'Not allowed.');
  const out = await scopeRecords(db, session, [record]);
  if (out.denied) throw new EngineError(out.denied.status, out.denied.error);
  if (out.records.length === 0) throw new EngineError(403, 'Not allowed.');
}

export async function getRecord(db, { session, companyId, recordId }) {
  const cid = asId(companyId);
  const record = await loadRecord(db, recordId, cid);
  await requireRecordView(db, session, record);
  const answers = await many(db.from('document_answers').select('*').eq('record_id', record.id), 'read the answers');
  const signatures = await many(db.from('document_signatures').select('*').eq('record_id', record.id), 'read the signatures');
  return { record, answers, signatures };
}

export async function listRecords(db, { session, companyId, definitionId, status, limit }) {
  const cid = asId(companyId);
  if (!cid) throw new EngineError(400, 'Missing company id.');
  const max = Math.min(Math.max(Number(limit) || 100, 1), 300);
  let q = db.from('document_records').select('*').eq('company_id', cid);
  if (definitionId) q = q.eq('definition_id', asId(definitionId));
  if (status) q = q.eq('status', String(status));
  const own = authorRosterId(session);
  if (!isSupervisorTier(session)) {
    // A worker lists only their own records.
    if (own == null) return { records: [] };
    q = q.eq('submitted_by_roster_id', own);
  }
  const rows = await many(q.order('created_at', { ascending: false }).limit(max), 'list the records');
  if (!isSupervisorTier(session)) return { records: rows };
  const out = await scopeRecords(db, session, rows);
  if (out.denied) throw new EngineError(out.denied.status, out.denied.error);
  return { records: out.records };
}

/**
 * Approve or return a record that is waiting on a reviewer. Supervisor tier
 * only, and only inside the caller's scope. The general reviewer rules (own
 * document refused, crew only, no lead on lead) arrive with WP3; until then
 * a worker who is a crew lead cannot review engine records at all.
 */
export async function reviewRecord(db, { session, companyId, recordId, decision, reason }) {
  if (!isSupervisorTier(session)) throw new EngineError(403, 'Not allowed.');
  if (decision !== 'approve' && decision !== 'return') throw new EngineError(400, 'Choose approve or return.');
  const cid = asId(companyId);
  const record = await loadRecord(db, recordId, cid);
  await requireRecordView(db, session, record);
  if (record.awaiting_signature) throw new EngineError(409, "The worker hasn't signed this yet.");
  if (record.status !== 'pending_approval') throw new EngineError(409, 'This document is not waiting for review.');
  const reviewerId = authorRosterId(session);
  if (reviewerId != null && same(record.submitted_by_roster_id, reviewerId)) throw new EngineError(403, 'You cannot review your own document.');

  const nowIso = new Date().toISOString();
  // Each change is a guarded update FIRST (it only matches a record still
  // waiting for review), so two reviewers, or one double click, cannot both
  // win. The approval signature is written after, and undone if it fails.
  if (decision === 'return') {
    const text = String(reason || '').trim();
    if (!text) throw new EngineError(400, 'Say what needs fixing.');
    const hit = await updated(
      db.from('document_records').update({ status: 'returned', returned_reason: text.slice(0, 1000), updated_at: nowIso }).eq('id', record.id).eq('company_id', cid).eq('status', 'pending_approval'),
      'return the document',
    );
    if (hit.length === 0) throw new EngineError(409, 'This document is not waiting for review.');
    return { status: 'returned' };
  }
  const hit = await updated(
    db.from('document_records').update({ status: 'approved', returned_reason: null, updated_at: nowIso }).eq('id', record.id).eq('company_id', cid).eq('status', 'pending_approval'),
    'approve the document',
  );
  if (hit.length === 0) throw new EngineError(409, 'This document is not waiting for review.');
  const { error: sigErr } = await db.from('document_signatures').insert({
    record_id: record.id,
    kind: 'approval',
    signer_roster_id: reviewerId,
    signer_name: sessionName(session),
    signer_role: session.role,
    signed_at: nowIso,
  });
  if (sigErr) {
    await db.from('document_records').update({ status: 'pending_approval' }).eq('id', record.id).eq('company_id', cid);
    throw dbFail(sigErr, 'save the approval');
  }
  return { status: 'approved' };
}

/**
 * The worker fixes a returned document: the same record, same history. Only
 * the author, only while it is returned. Answers are replaced, the status
 * goes back to waiting on review.
 */
export async function resubmitRecord(db, { session, companyId, recordId, answers, notes, deps }) {
  const cid = asId(companyId);
  const record = await loadRecord(db, recordId, cid);
  const own = authorRosterId(session);
  if (own == null || !same(record.submitted_by_roster_id, own)) throw new EngineError(403, 'Only the person who filed this can fix it.');
  if (record.status !== 'returned') throw new EngineError(409, 'This document was not sent back.');

  const version = await one(db.from('document_versions').select('*').eq('id', record.version_id), 'read the version');
  if (!version) throw new EngineError(404, 'Document not found.');
  const content = await readVersionContent(db, version);
  const checked = validateAnswers(content.fields, answers, { notes, resolveFile: deps.resolveFile });
  if (checked.error) throw new EngineError(400, checked.error);

  // Claim the record first (only one resubmit can move it out of
  // 'returned'), then replace the answers, and put it back if that fails.
  const claimed = await updated(
    db.from('document_records').update({ status: 'pending_approval', returned_reason: null, updated_at: new Date().toISOString() }).eq('id', record.id).eq('company_id', cid).eq('status', 'returned'),
    'resubmit',
  );
  if (claimed.length === 0) throw new EngineError(409, 'This document was not sent back.');
  try {
    await must(db.from('document_answers').delete().eq('record_id', record.id), 'replace the answers');
    if (checked.rows.length > 0) {
      await must(db.from('document_answers').insert(checked.rows.map((x) => ({ ...x, record_id: record.id }))), 'save the answers');
    }
  } catch (e) {
    await db.from('document_records').update({ status: 'returned', returned_reason: record.returned_reason }).eq('id', record.id).eq('company_id', cid);
    throw e;
  }
  return { status: 'pending_approval' };
}

/** The author signs a record they saved unsigned. Anyone else is refused. */
export async function signNow(db, { session, companyId, recordId, signature, pdfReceipt, deps }) {
  const cid = asId(companyId);
  const record = await loadRecord(db, recordId, cid);
  const own = authorRosterId(session);
  if (own == null || !same(record.submitted_by_roster_id, own)) throw new EngineError(403, 'Only the person who filed this can sign it.');
  if (!record.awaiting_signature) throw new EngineError(409, 'This document is not waiting for your signature.');
  const sigPath = signature ? deps.resolveFile(signature, { field_type: 'signature' }) : null;
  if (!sigPath) throw new EngineError(400, 'Sign the document first.');
  const pdfPath = pdfReceipt ? deps.resolveFile(pdfReceipt, { field_type: 'pdf' }) : null;

  const nowIso = new Date().toISOString();
  // The guarded update goes first, so a double submit changes nothing the
  // second time and writes no second signature. The signature row follows,
  // and the record goes back to awaiting if it cannot be saved.
  const patch = { awaiting_signature: false, worker_signed_at: nowIso, updated_at: nowIso };
  if (pdfPath) patch.pdf_path = pdfPath;
  const hit = await updated(
    db.from('document_records').update(patch).eq('id', record.id).eq('company_id', cid).eq('awaiting_signature', true),
    'finish signing',
  );
  if (hit.length === 0) throw new EngineError(409, 'This document is not waiting for your signature.');
  const { error: sigErr } = await db.from('document_signatures').insert({
    record_id: record.id, kind: 'worker', signer_roster_id: own, signer_name: sessionName(session), signer_role: session.role, signature_path: sigPath, signed_at: nowIso,
  });
  if (sigErr) {
    await db.from('document_records').update({ awaiting_signature: true, worker_signed_at: null }).eq('id', record.id).eq('company_id', cid);
    throw dbFail(sigErr, 'save the signature');
  }
  return { signed: true };
}
