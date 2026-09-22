// src/offlineQueue.js
// Phase 1 of docs/scope-offline-capability.md: a small IndexedDB-backed
// queue for worker form submissions made while offline. The `queue` store
// is deliberately text-only — no photo/PDF blobs, see the file comment on
// `enqueueSubmission` for why — which is what kept Phase 1 a same-day
// build instead of Phase 3's harder blob-storage problem.
//
// A queued item stores the plain input data a form's submit function
// needs to redo the ENTIRE submission later (PDF generation + upload +
// the final POST) — not a captured fetch request — because PDF
// generation itself needs a network round trip (the signed-upload-URL
// step in uploadViaSignedUrl.js), so there's nothing useful to "replay"
// while still offline. Draining a queued item means calling the same
// resubmit function a live online submit would have called.
//
// Phase 3 adds a second store, `photos`, for exactly the blobs `queue`
// deliberately excludes — a photo whose upload couldn't complete (offline,
// or just a bad moment for the connection) gets its Blob persisted here
// instead of silently dropped, keyed by a local id. Only Incident.jsx uses
// this today — it's the only worker form that captures photos at all
// (checked every form; NearMiss's signature upload is a data URL string,
// no blob, already handled fine by the `queue` store alone).

const DB_NAME = "fora_offline_queue";
const DB_VERSION = 2;
const STORE = "queue";
const PHOTO_STORE = "photos";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("formType", "formType", { unique: false });
      }
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        db.createObjectStore(PHOTO_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
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
  await withStore(STORE, "readwrite", (store) => store.put(item));
  return item.id;
}

export async function listQueued(formType) {
  return withStore(STORE, "readonly", (store) => {
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
  await withStore(STORE, "readwrite", (store) => store.delete(id));
}

export async function markAttempt(id, error) {
  await withStore(STORE, "readwrite", (store) => {
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

// ── Phase 3: pending photo blobs ────────────────────────────────────────
// Stores a photo Blob for later upload once back online. Returns the local
// id a form uses to reference it — both from its own React state (for the
// thumbnail/status) and, if the whole record ends up queued offline too,
// from the submission payload (as e.g. `pendingPhotoIds`) so a resubmit
// function can upload it for real once there's connectivity.
export async function storePhoto(blob, contentType) {
  const id = genId();
  await withStore(PHOTO_STORE, "readwrite", (store) => store.put({ id, blob, contentType: contentType || blob.type, createdAt: Date.now() }));
  return id;
}

export async function getPhoto(id) {
  return withStore(PHOTO_STORE, "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function deletePhoto(id) {
  await withStore(PHOTO_STORE, "readwrite", (store) => store.delete(id));
}

export async function listPhotos() {
  return withStore(PHOTO_STORE, "readonly", (store) => {
    return new Promise((resolve, reject) => {
      const items = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) { items.push(cursor.value); cursor.continue(); }
        else resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

// Total bytes currently held across all pending photo blobs — used to warn/
// block new offline photo capture past a fixed budget (see PHOTO_BUDGET_BYTES
// in Incident.jsx) so a multi-day offline stretch can't silently exhaust
// device storage.
export async function totalPhotoBytes() {
  const items = await listPhotos();
  return items.reduce((sum, p) => sum + (p.blob?.size || 0), 0);
}

// Whether a failed resubmit can NEVER succeed on a retry.
//
// The resubmit functions attach `status` (the HTTP status) alongside the
// `isServerError` / `isNetworkFailure` flags they already carried. A 4xx is
// the server saying the submission itself is unacceptable, and it will keep
// saying it — so retrying is not resilience, it is a wedge (see drainQueue
// below). Everything else is retried, including anything with no status at
// all: a resubmit does more than one round trip (PDF generation, a
// signed-upload step), and a throw from an inner step carries no status.
// Guessing "permanent" there would delete a worker's real work.
//
// Four 4xx codes are deliberately NOT permanent:
//   * 401 — the token is stale, the payload is fine. Queued items can drain
//     days later, so meeting an expired session on the way out is normal;
//     dropping there would cost a shift's work over a re-login.
//   * 408 / 425 / 429 — the server is explicitly asking to be asked again.
export function isPermanentRejection(error) {
  if (!error || error.isNetworkFailure) return false;
  const status = Number(error.status);
  if (!Number.isFinite(status) || status < 400 || status >= 500) return false;
  if (status === 401 || status === 408 || status === 425 || status === 429) return false;
  return true;
}

// Drains every queued item for `formType`, calling `resubmit(payload)` for
// each. `resubmit` must return a truthy result on success (falls through
// to removing the item) or throw on failure.
//
// A failure is one of two things, and they are handled differently:
//
//   * TRANSIENT (network failure, 5xx, no status) — the item stays queued,
//     its attempt count bumps, and draining stops for this formType. Items
//     drain in order, so a stuck first item must not let later ones be
//     retried out of order.
//   * PERMANENT (see isPermanentRejection) — the item is REMOVED and
//     reported in `dropped`, and the drain carries on with the rest.
//
// The drop path is why there is still no attempt cap, and that is
// deliberate: a cap counts attempts, and a worker offline for a week racks
// up attempts on submissions that are perfectly good. Only the server
// saying "never" drops anything.
//
// Without the drop path, one permanently-rejected item wedged that worker's
// entire queue for that form type forever — every later submission of the
// same form sat behind it, unsent, with nothing shown anywhere. That was
// only survivable while nothing on the server rejected a well-formed submit
// permanently; server-side module gating (break #21) makes 403 a stable
// answer, so this had to land first.
//
// A dropped item is still lost work, so it comes back to the caller in
// `dropped` rather than disappearing — same reason `pdfUnlinked` is
// reported instead of being left to a server log nobody reads. Each entry
// is the queued item itself plus `status` and `reason`, so the caller can
// tell the worker which form went nowhere and why.
//
// Safe to call opportunistically (on the `online` event, on mount) — a
// no-op when the queue is empty.
export async function drainQueue(formType, resubmit) {
  const items = await listQueued(formType);
  // `pdfUnlinked` counts drained submissions the server saved but couldn't
  // attach a PDF to. Receipts deliberately carry no expiry so a queued
  // submission can drain days later, which means the one realistic way this
  // fires is SESSION_SECRET being rotated in between — the record is safe,
  // its PDF link isn't, and without this it would only ever show up in a
  // server log. See receiptWasDropped() in server-lib/uploadUrls.js.
  const results = { succeeded: 0, remaining: items.length, lastError: null, pdfUnlinked: 0, dropped: [] };
  for (const item of items) {
    try {
      const response = await resubmit(item.payload, item.clientSubmissionId);
      if (response && response.pdfLinked === false) results.pdfUnlinked += 1;
      await removeQueued(item.id);
      results.succeeded += 1;
      results.remaining -= 1;
    } catch (e) {
      if (isPermanentRejection(e)) {
        // Rejected for good. Removing it is the only way the items behind
        // it ever send, but it is reported so it is not lost silently.
        await removeQueued(item.id);
        results.remaining -= 1;
        results.dropped.push({
          ...item,
          attempts: (item.attempts || 0) + 1,
          status: Number(e.status),
          reason: String(e.message || e),
        });
        continue;
      }
      await markAttempt(item.id, e);
      results.lastError = e;
      break; // stop draining this formType — keep order, don't hammer a dead connection
    }
  }
  return results;
}
