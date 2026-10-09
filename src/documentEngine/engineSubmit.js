// Files an engine document: uploads signature and attachment files, draws the
// PDF from the document's layout, uploads it, then calls submit. Shared by a
// live submit and by the offline queue's drain, so both do exactly the same
// thing from plain data. Same error flags as PortalDocumentForm: a network
// failure sets isNetworkFailure (queue and retry), a server refusal sets
// isServerError (show it, do not queue).

import { splitAnswers, extForDataUrl, BUCKET_FOR_KIND } from './formModel.js';
import { dataUrlToBlob } from '../dataUrlToBlob.js';
import { queuedAtFor } from '../offlineQueue.js';

async function defaultUpload({ token, kind, filename, blob }) {
  const { uploadViaSignedUrl } = await import('../uploadViaSignedUrl.js');
  const { receipt } = await uploadViaSignedUrl({
    endpoint: '/api/documents', action: 'create_upload_url', token, bucket: BUCKET_FOR_KIND[kind], filename,
    file: blob, contentType: blob.type || 'application/octet-stream', extra: { kind },
  });
  return receipt || null;
}

async function defaultRender(input) {
  const { renderDocumentPDF } = await import('./renderLayout.js');
  const doc = await renderDocumentPDF(input);
  return doc.output('blob');
}

export async function foraLogoDataUrl() {
  try {
    const blob = await (await fetch('/fora-logo-dark.png')).blob();
    return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(blob); });
  } catch (e) { return undefined; }
}

/**
 * payload: { definitionId, title, layout, fields, answers, notes, siteId, siteName,
 *            companyName, companyLogo, submittedBy, signature (data URL or null),
 *            signLater, crew, dateText, dateTimeText }
 * deps (tests): { upload, render, fetchFn, logo }
 */
export async function submitEngineDocument(payload, clientSubmissionId, token, deps = {}) {
  const upload = deps.upload || defaultUpload;
  const render = deps.render || defaultRender;
  const fetchFn = deps.fetchFn || fetch;
  const { values, uploads } = splitAnswers(payload.fields, payload.answers);

  // A missing attachment is not a reason to lose the rest of a finished document.
  const answers = { ...values };
  for (const u of uploads) {
    try {
      const blob = dataUrlToBlob(u.dataUrl);
      const receipt = await upload({ token, kind: u.kind, filename: `${u.field_type}-${u.key}.${extForDataUrl(u.dataUrl)}`, blob });
      if (receipt) answers[u.key] = receipt;
    } catch (e) { /* answer stays empty */ }
  }

  // Crew sign-off: each crew member's signature is uploaded and sent with their
  // roster id. The server takes the name from the roster, never from here.
  const crew = [];
  for (const c of payload.crew || []) {
    const receipt = await upload({ token, kind: 'signature', filename: `crew-${c.rosterId}.png`, blob: dataUrlToBlob(c.signature) }).catch(() => null);
    if (!receipt) throw Object.assign(new Error(`${c.name || 'A crew member'}'s signature did not upload. Try again.`), { isServerError: true });
    crew.push({ rosterId: c.rosterId, signature: receipt });
  }

  let signature = null;
  if (payload.signature) {
    try { signature = await upload({ token, kind: 'signature', filename: 'signature.png', blob: dataUrlToBlob(payload.signature) }); } catch (e) { /* server will ask again */ }
  }

  let pdfReceipt = null;
  try {
    const pdfBlob = await render({
      layout: payload.layout, document: { title: payload.title }, company: { name: payload.companyName, logoDataUrl: payload.companyLogo || undefined },
      record: {
        site: payload.siteName, author: payload.submittedBy, dateText: payload.dateText, dateTimeText: payload.dateTimeText,
        status: 'submitted', awaitingSignature: payload.signLater === true,
      },
      fields: payload.fields, answers: payload.answers,
      signatures: [
        ...(payload.signature ? [{ kind: 'worker', signer_name: payload.submittedBy, signature: payload.signature, signedAtText: payload.dateTimeText }] : []),
        ...(payload.crew || []).map((c) => ({ kind: 'crew', signer_name: c.name, signature: c.signature, signedAtText: payload.dateTimeText })),
      ],
      assets: { foraLogoDataUrl: deps.logo !== undefined ? deps.logo : await foraLogoDataUrl() },
    });
    pdfReceipt = await upload({ token, kind: 'pdf', filename: 'document.pdf', blob: pdfBlob });
  } catch (e) { /* the record still files; the PDF can be drawn again from the data */ }

  let res;
  try {
    res = await fetchFn('/api/documents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'submit', token, definitionId: payload.definitionId, clientSubmissionId, queuedAt: queuedAtFor(clientSubmissionId),
        answers, notes: payload.notes || {}, siteId: payload.siteId || undefined,
        signature, signLater: payload.signLater === true || undefined, pdfReceipt: pdfReceipt || undefined, crew: crew.length ? crew : undefined, aiEditSignal: payload.aiEditSignal || undefined,
      }),
    });
  } catch (networkErr) {
    networkErr.isNetworkFailure = true;
    throw networkErr;
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const err = new Error(errBody.error || `Save failed (${res.status})`);
    err.isServerError = true;
    err.status = res.status;
    throw err;
  }
  return await res.json().catch(() => ({}));
}

/** The queue-drain entry point for formType "engineform". */
export const resubmitEngineForm = (payload, clientSubmissionId, tokenForRequest) => submitEngineDocument(payload, clientSubmissionId, tokenForRequest);

async function postDocuments(body, fetchFn) {
  let res;
  try {
    res = await fetchFn('/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (networkErr) { networkErr.isNetworkFailure = true; throw networkErr; }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const err = new Error(errBody.error || `Save failed (${res.status})`);
    err.isServerError = true; err.status = res.status;
    throw err;
  }
  return await res.json().catch(() => ({}));
}

async function drawPdf(payload, signature, deps) {
  const render = deps.render || defaultRender;
  return render({
    layout: payload.layout, document: { title: payload.title }, company: { name: payload.companyName, logoDataUrl: payload.companyLogo || undefined },
    record: { site: payload.siteName, author: payload.submittedBy, dateText: payload.dateText, dateTimeText: payload.dateTimeText, status: payload.status || 'submitted', awaitingSignature: false, amendedNote: payload.amendedNote || null },
    fields: payload.fields, answers: payload.answers,
    signatures: payload.signatureInputs ? payload.signatureInputs : (signature ? [{ kind: 'worker', signer_name: payload.submittedBy, signature, signedAtText: payload.dateTimeText }] : []),
    assets: { foraLogoDataUrl: deps.logo !== undefined ? deps.logo : await foraLogoDataUrl() },
  });
}

/** A returned document, fixed and sent back for review. Files not sent again stay as they were (server side). */
export async function resubmitEngineDocument(payload, recordId, token, deps = {}) {
  const upload = deps.upload || defaultUpload;
  const { values, uploads } = splitAnswers(payload.fields, payload.answers);
  const answers = { ...values };
  for (const u of uploads) {
    try { const r = await upload({ token, kind: u.kind, filename: `${u.field_type}-${u.key}.${extForDataUrl(u.dataUrl)}`, blob: dataUrlToBlob(u.dataUrl) }); if (r) answers[u.key] = r; } catch (e) { /* keeps the earlier file */ }
  }
  let pdfReceipt = null;
  try { pdfReceipt = await upload({ token, kind: 'pdf', filename: 'document.pdf', blob: await drawPdf(payload, payload.signature || null, deps) }); } catch (e) { /* the old PDF stays */ }
  return postDocuments({ action: 'resubmit', token, recordId, answers, notes: payload.notes || {}, pdfReceipt: pdfReceipt || undefined }, deps.fetchFn || fetch);
}

/**
 * What the renderer draws for the signatures on a record. Approvals from an
 * earlier review round are left out: they were given to content that has since
 * changed. `links` is the get_record_links answer; `fetchImage` turns a signed
 * URL into a data URL.
 */
export async function signatureInputsFor(signatures, links, fetchImage, reviewRound) {
  const when = (t) => (t ? new Date(t).toLocaleString('en-CA') : '');
  const out = [];
  for (const g of signatures || []) {
    const isApproval = g.kind === 'approval' || g.kind === 'reviewer';
    if (isApproval && (Number(g.meta && g.meta.round) || 0) !== (Number(reviewRound) || 0)) continue;
    const url = links && links.signatures && links.signatures[g.id];
    out.push({ kind: isApproval ? 'approval' : g.kind, step_key: g.step_key, signer_name: g.signer_name, signature: url ? await fetchImage(url) : null, signedAtText: when(g.signed_at) });
  }
  return out;
}

/**
 * The author amends a document they filed earlier today. The PDF is redrawn
 * with the new answers, the signatures already on the record (no approvals
 * from before the change) and an "Amended" note. Needs a connection.
 */
export async function amendEngineDocument(payload, recordId, record, signatures, token, deps = {}) {
  const upload = deps.upload || defaultUpload;
  const fetchImage = deps.fetchImage || defaultFetchImage;
  const { values, uploads } = splitAnswers(payload.fields, payload.answers);
  const answers = { ...values };
  for (const u of uploads) {
    try { const r = await upload({ token, kind: u.kind, filename: `${u.field_type}-${u.key}.${extForDataUrl(u.dataUrl)}`, blob: dataUrlToBlob(u.dataUrl) }); if (r) answers[u.key] = r; } catch (e) { /* keeps the earlier file */ }
  }
  let pdfReceipt = null;
  try {
    const links = await postDocuments({ action: 'get_record_links', token, companyId: payload.companyId, recordId }, deps.fetchFn || fetch).catch(() => ({ signatures: {} }));
    const signatureInputs = await signatureInputsFor(signatures, links, fetchImage, (Number(record && record.review_round) || 0) + 1); // the server moves the round on, so no earlier approval is drawn
    const now = new Date();
    pdfReceipt = await upload({ token, kind: 'pdf', filename: 'document.pdf', blob: await drawPdf({ ...payload, signatureInputs, amendedNote: `Amended ${now.toLocaleString('en-CA')}`, status: 'submitted' }, null, deps) });
  } catch (e) { /* the earlier PDF stays */ }
  return postDocuments({ action: 'amend', token, companyId: payload.companyId, recordId, answers, notes: payload.notes || {}, pdfReceipt: pdfReceipt || undefined }, deps.fetchFn || fetch);
}

/** The author signs a document they saved unsigned. Needs a connection; it is not queued. */
export async function signEngineDocument(payload, recordId, signatureDataUrl, token, deps = {}) {
  const upload = deps.upload || defaultUpload;
  const signature = await upload({ token, kind: 'signature', filename: 'signature.png', blob: dataUrlToBlob(signatureDataUrl) });
  if (!signature) throw Object.assign(new Error('The signature did not upload. Try again.'), { isServerError: true });
  let pdfReceipt = null;
  // When the form changed since this was filed the old layout cannot redraw it, so the PDF stays as filed.
  if (!payload.skipPdf) {
    try { pdfReceipt = await upload({ token, kind: 'pdf', filename: 'document.pdf', blob: await drawPdf(payload, signatureDataUrl, deps) }); } catch (e) { /* the record still signs */ }
  }
  return postDocuments({ action: 'sign_now', token, recordId, signature, pdfReceipt: pdfReceipt || undefined }, deps.fetchFn || fetch);
}

/** Everything the worker screens need to redraw or fix one record: the form, the record, its answers. */
export async function loadRecordForWorker(token, companyId, recordId, call) {
  const { record, answers, signatures } = await call(token, 'get_record', { companyId, recordId });
  const doc = await call(token, 'get_document', { companyId, definitionId: record.definition_id });
  return { record, answers, signatures, doc, sameVersion: Number(doc.versionId) === Number(record.version_id) };
}

async function defaultFetchImage(url) {
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ok(null); r.readAsDataURL(blob); });
  } catch (e) { return null; }
}

/**
 * Redraws a filed record's PDF with every signature it has now (worker, crew,
 * approvals) and replaces the stored one. Run by the reviewer right after they
 * approve, so the file carries the approval. Best effort and never throws: if
 * anything fails the earlier PDF stays. `call(token, action, body)` is the
 * documents API. Returns { redrawn: boolean }.
 */
export async function redrawRecordPdf(token, companyId, recordId, call, deps = {}) {
  try {
    const upload = deps.upload || defaultUpload;
    const fetchImage = deps.fetchImage || defaultFetchImage;
    const { record, answers, signatures, doc, sameVersion } = await loadRecordForWorker(token, companyId, recordId, call);
    // A form changed since this was filed cannot redraw it faithfully: keep the PDF as filed.
    if (!sameVersion) return { redrawn: false };
    const links = await call(token, 'get_record_links', { companyId, recordId }).catch(() => ({ signatures: {} }));
    const siteName = deps.siteName !== undefined ? deps.siteName : await (async () => {
      try {
        const res = await fetch('/api/companydata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list_sites', token, companyId }) });
        const d = res.ok ? await res.json() : {};
        return ((d.sites || []).find((x) => String(x.id) === String(record.site_id)) || {}).name || '';
      } catch (e) { return ''; }
    })();
    const when = (t) => (t ? new Date(t).toLocaleString('en-CA') : '');
    const sigInputs = await signatureInputsFor(signatures, links, fetchImage, record.review_round);
    const worker = signatures.find((g) => g.kind === 'worker');
    const { rowsToForm } = await import('./recordView.js');
    const render = deps.render || defaultRender;
    const pdf = await render({
      layout: doc.layout, document: { title: doc.definition.title }, company: { name: deps.companyName || '', logoDataUrl: deps.companyLogo || undefined },
      record: { site: siteName, author: worker ? worker.signer_name : '', dateText: when(record.submitted_at).slice(0, 10), dateTimeText: when(record.submitted_at), status: record.status, awaitingSignature: record.awaiting_signature === true },
      fields: doc.fields, answers: rowsToForm(answers).answers, signatures: sigInputs,
      assets: { foraLogoDataUrl: deps.logo !== undefined ? deps.logo : await foraLogoDataUrl() },
    });
    const receipt = await upload({ token, kind: 'pdf', filename: 'document.pdf', blob: pdf });
    if (!receipt) return { redrawn: false };
    await call(token, 'set_record_pdf', { companyId, recordId, pdfReceipt: receipt });
    return { redrawn: true };
  } catch (e) {
    return { redrawn: false };
  }
}
