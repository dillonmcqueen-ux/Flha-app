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
      signatures: payload.signature ? [{ kind: 'worker', signer_name: payload.submittedBy, signature: payload.signature, signedAtText: payload.dateTimeText }] : [],
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
        signature, signLater: payload.signLater === true || undefined, pdfReceipt: pdfReceipt || undefined, crew: payload.crew || undefined,
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
