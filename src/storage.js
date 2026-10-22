// Speicher: IndexedDB, Fallback localStorage. Die Logik kennt diese Datei nicht.

const DB_NAME = 'taler';
const DB_VERSION = 1;
const STORES = ['transactions', 'rules', 'meta'];
const LS_PREFIX = 'taler:';

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

function idbBackend(db) {
  const tx = (store, mode = 'readonly') => db.transaction(store, mode).objectStore(store);
  const done = (t) => new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });
  return {
    all: (store) => req(tx(store).getAll()),
    async putMany(store, items) {
      const t = db.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      for (const it of items) s.put(it);
      await done(t);
    },
    del: (store, id) => req(tx(store, 'readwrite').delete(id)),
    async getMeta(key) { const r = await req(tx('meta').get(key)); return r ? r.value : null; },
    setMeta: (key, value) => req(tx('meta', 'readwrite').put({ id: key, value })),
    async clear() {
      const t = db.transaction(STORES, 'readwrite');
      for (const s of STORES) t.objectStore(s).clear();
      await done(t);
    },
  };
}

function lsBackend() {
  const read = (store) => { try { return JSON.parse(localStorage.getItem(LS_PREFIX + store) || '{}'); } catch { return {}; } };
  const write = (store, obj) => { try { localStorage.setItem(LS_PREFIX + store, JSON.stringify(obj)); } catch { /* voll oder gesperrt */ } };
  return {
    async all(store) { return Object.values(read(store)); },
    async putMany(store, items) { const o = read(store); for (const it of items) o[it.id] = it; write(store, o); },
    async del(store, id) { const o = read(store); delete o[id]; write(store, o); },
    async getMeta(key) { const o = read('meta'); return o[key] ? o[key].value : null; },
    async setMeta(key, value) { const o = read('meta'); o[key] = { id: key, value }; write('meta', o); },
    async clear() { for (const s of STORES) { try { localStorage.removeItem(LS_PREFIX + s); } catch { /* egal */ } } },
  };
}

/**
 * Öffnet den Speicher.
 * @returns {Promise<{
 *   kind: 'indexeddb'|'localstorage',
 *   allTransactions(): Promise<object[]>, putTransactions(list: object[]): Promise<void>, deleteTransaction(id: string): Promise<void>,
 *   allRules(): Promise<object[]>, putRules(list: object[]): Promise<void>, deleteRule(id: string): Promise<void>,
 *   getMeta(key: string): Promise<any>, setMeta(key: string, value: any): Promise<void>, clear(): Promise<void>
 * }>}
 */
export async function open() {
  let backend;
  let kind = 'indexeddb';
  try {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
    };
    backend = idbBackend(await req(r));
  } catch {
    backend = lsBackend();
    kind = 'localstorage';
  }
  return {
    kind,
    allTransactions: () => backend.all('transactions'),
    putTransactions: (list) => backend.putMany('transactions', list),
    deleteTransaction: (id) => backend.del('transactions', id),
    allRules: () => backend.all('rules'),
    putRules: (list) => backend.putMany('rules', list),
    deleteRule: (id) => backend.del('rules', id),
    getMeta: (key) => backend.getMeta(key),
    setMeta: (key, value) => backend.setMeta(key, value),
    clear: () => backend.clear(),
  };
}
