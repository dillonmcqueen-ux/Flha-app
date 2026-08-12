// src/offlineQueue.js
// Phase 1 of docs/scope-offline-capability.md: a small IndexedDB-backed
// queue for worker form submissions made while offline. Deliberately
// text-only — no photo/PDF blobs are ever stored here (see the file
// comment on `enqueueSubmission` for why), which is what keeps this a
// same-day build instead of Phase 3's harder blob-storage problem.
//
// A queued item stores the plain input data a form's submit function
// needs to redo the ENTIRE submission later (PDF generation + upload +
// the final POST) — not a captured fetch request — because PDF
// generation itself needs a network round trip (the signed-upload-URL
// step in uploadViaSignedUrl.js), so there's nothing useful to "replay"
// while still offline. Draining a queued item means calling the same
// resubmit function a live online submit would have called.

const DB_NAME = "fora_offline_queue";
const DB_VERSION = 1;
const STORE = "queue";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("formType", "formType", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const result = fn(store);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function genId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`);
}

// Queues a submission for later. `formType` matches the form's own draft
// autosave key (e.g. "daily", "nearmiss"). `clientSubmissionId` must be
// the same id already sent (or about to be sent) with the record, so a
// later retry is idempotent server-side. `payload` is whatever plain,
// JSON-serializable data the form's resubmit function needs.
export async function enqueueSubmission(formType, clientSubmissionId, payload) {
  const item = {
    id: genId(),
    formType,
    clientSubmissionId,
    payload,
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
  };
  await withStore("readwrite", (store) => store.put(item));
  return item.id;
}

export async function listQueued(formType) {
  return withStore("readonly", (store) => {
    return new Promise((resolve, reject) => {
      const items = [];
      const index = store.index("formType");
      const req = index.openCursor(IDBKeyRange.only(formType));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) { items.push(cursor.value); cursor.continue(); }
        else resolve(items.sort((a, b) => a.createdAt - b.createdAt));
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function countQueued(formType) {
  const items = await listQueued(formType);
  return items.length;
}

export async function removeQueued(id) {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function markAttempt(id, error) {
  await withStore("readwrite", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => {
        const item = req.result;
        if (!item) { resolve(); return; }
        item.attempts += 1;
        item.lastError = error ? String(error.message || error) : null;
        store.put(item);
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  });
}

// Drains every queued item for `formType`, calling `resubmit(payload)` for
// each. `resubmit` must return a truthy result on success (falls through
// to removing the item) or throw on failure (item stays queued, attempt
// count bumps, and draining stops for this formType — items are drained
// in order, so a stuck first item shouldn't cause later ones to be
// retried out of order). Safe to call opportunistically (on the `online`
// event, on mount) — a no-op when the queue is empty.
export async function drainQueue(formType, resubmit) {
  const items = await listQueued(formType);
  const results = { succeeded: 0, remaining: items.length, lastError: null };
  for (const item of items) {
    try {
      await resubmit(item.payload, item.clientSubmissionId);
      await removeQueued(item.id);
      results.succeeded += 1;
      results.remaining -= 1;
    } catch (e) {
      await markAttempt(item.id, e);
      results.lastError = e;
      break; // stop draining this formType — keep order, don't hammer a dead connection
    }
  }
  return results;
}
