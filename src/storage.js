// Speicher: IndexedDB. Die Logik kennt diese Datei nicht.

const DB_NAME = 'taler';
const DB_VERSION = 1;
const STORES = ['transactions', 'rules', 'meta'];

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

/**
 * Öffnet den Speicher. Schlägt fehl, wenn IndexedDB nicht geht (dann startet die App nicht).
 * @returns {Promise<{
 *   allTransactions(): Promise<object[]>, putTransactions(list: object[]): Promise<void>, deleteTransaction(id: string): Promise<void>,
 *   allRules(): Promise<object[]>, putRules(list: object[]): Promise<void>, deleteRule(id: string): Promise<void>,
 *   getMeta(key: string): Promise<any>, setMeta(key: string, value: any): Promise<void>, clear(): Promise<void>
 * }>}
 */
export async function open() {
  const r = indexedDB.open(DB_NAME, DB_VERSION);
  r.onupgradeneeded = () => {
    for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
  };
  const db = await req(r);
  const tx = (store, mode = 'readonly') => db.transaction(store, mode).objectStore(store);
  const done = (t) => new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });
  const putMany = async (store, items) => {
    const t = db.transaction(store, 'readwrite');
    for (const it of items) t.objectStore(store).put(it);
    await done(t);
  };
  return {
    allTransactions: () => req(tx('transactions').getAll()),
    putTransactions: (list) => putMany('transactions', list),
    deleteTransaction: (id) => req(tx('transactions', 'readwrite').delete(id)),
    allRules: () => req(tx('rules').getAll()),
    putRules: (list) => putMany('rules', list),
    deleteRule: (id) => req(tx('rules', 'readwrite').delete(id)),
    async getMeta(key) { const m = await req(tx('meta').get(key)); return m ? m.value : null; },
    setMeta: (key, value) => req(tx('meta', 'readwrite').put({ id: key, value })),
    async clear() {
      const t = db.transaction(STORES, 'readwrite');
      for (const s of STORES) t.objectStore(s).clear();
      await done(t);
    },
  };
}
