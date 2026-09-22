// A small in-memory IndexedDB, for tests that exercise src/offlineQueue.js
// for real rather than mocking it away.
//
// Implements exactly the surface offlineQueue.js uses: open/upgrade, object
// stores with a keyPath, one index, cursors over IDBKeyRange.only, and
// transaction completion. Requests fire asynchronously and a transaction
// completes only once every request it issued has, which is what makes
// "items drain in order" assertions meaningful.
//
// Shared by tests/unit/offline-queue-drain.test.js (the drop path itself)
// and tests/unit/module-gate.test.js (a real 403 from a real handler
// reaching that drop path). Lives outside *.test.js so the runner's glob
// does not try to execute it.

export function installFakeIndexedDB() {
  const dbs = new Map();

  class FakeIndex {
    constructor(store, keyPath) { this.store = store; this.keyPath = keyPath; }
    openCursor(range) {
      const req = { onsuccess: null, onerror: null, result: null };
      const matches = [...this.store.data.values()].filter(v => range.includes(v[this.keyPath]));
      let i = 0;
      const step = () => {
        this.store.tx.schedule(() => {
          if (i >= matches.length) { req.result = null; req.onsuccess && req.onsuccess(); return; }
          const value = matches[i++];
          req.result = { value, continue: step };
          req.onsuccess && req.onsuccess();
        });
      };
      step();
      return req;
    }
  }

  class FakeStore {
    constructor(name, keyPath) { this.name = name; this.keyPath = keyPath; this.data = new Map(); this.indexes = new Map(); this.tx = null; }
    createIndex(name, keyPath) { this.indexes.set(name, keyPath); }
    bind(tx) { const bound = Object.create(this); bound.tx = tx; return bound; }
    index(name) { return new FakeIndex(this, this.indexes.has(name) ? this.indexes.get(name) : name); }
    put(value) {
      const req = { onsuccess: null, onerror: null, result: null };
      this.tx.schedule(() => { this.data.set(value[this.keyPath], JSON.parse(JSON.stringify(value))); req.onsuccess && req.onsuccess(); });
      return req;
    }
    get(key) {
      const req = { onsuccess: null, onerror: null, result: null };
      this.tx.schedule(() => { req.result = this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : undefined; req.onsuccess && req.onsuccess(); });
      return req;
    }
    delete(key) {
      const req = { onsuccess: null, onerror: null, result: null };
      this.tx.schedule(() => { this.data.delete(key); req.onsuccess && req.onsuccess(); });
      return req;
    }
  }

  class FakeDb {
    constructor(name) { this.name = name; this.stores = new Map(); }
    get objectStoreNames() { const stores = this.stores; return { contains: (n) => stores.has(n) }; }
    createObjectStore(name, { keyPath }) { const s = new FakeStore(name, keyPath); this.stores.set(name, s); return s; }
    transaction(storeName) {
      const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
      let pending = 0, done = false;
      tx.schedule = (fn) => {
        pending += 1;
        setTimeout(() => {
          try { fn(); } finally {
            pending -= 1;
            if (pending === 0 && !done) { done = true; setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); }
          }
        }, 0);
      };
      const store = this.stores.get(storeName);
      tx.objectStore = () => store.bind(tx);
      return tx;
    }
    close() {}
  }

  globalThis.indexedDB = {
    open(name) {
      const req = { onupgradeneeded: null, onsuccess: null, onerror: null, result: null };
      let db = dbs.get(name);
      const fresh = !db;
      if (fresh) { db = new FakeDb(name); dbs.set(name, db); }
      req.result = db;
      setTimeout(() => {
        if (fresh && req.onupgradeneeded) req.onupgradeneeded();
        req.onsuccess && req.onsuccess();
      }, 0);
      return req;
    },
  };
  globalThis.IDBKeyRange = { only: (v) => ({ includes: (x) => x === v }) };
  return { reset: () => dbs.clear() };
}
