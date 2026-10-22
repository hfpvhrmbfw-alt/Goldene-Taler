// Datenmodell: Typen, Stammdaten (stabile IDs), Validierung, Export/Import, Migration.
// Keine Abhängigkeiten, keine Anzeigetexte.

export const APP_ID = 'taler';
export const SCHEMA_VERSION = 1;

/** Kategorien als stabile IDs. Nie umbenennen, nur ergänzen. Reihenfolge = Anzeige- und Gleichstandsreihenfolge. */
export const CATEGORY_IDS = [
  'lebensmittel', 'essen', 'mobilitaet', 'shopping', 'drogerie',
  'haushalt', 'gesundheit', 'freizeit', 'abos', 'reisen', 'sonstiges',
];

/** demo = Beispieldaten, lassen sich getrennt entfernen. */
export const SOURCES = ['shortcut', 'manual', 'demo'];

/**
 * @typedef {Object} Transaction
 * @property {string} id
 * @property {string} date          YYYY-MM-DD (lokales Datum der Zahlung)
 * @property {string|null} time     HH:MM oder null
 * @property {number} amountCents   ganze Cent, positiv = Ausgabe, negativ = Erstattung
 * @property {string} currency      ISO 4217, z. B. EUR
 * @property {string} merchant
 * @property {string} card
 * @property {string|null} categoryId
 * @property {boolean} manualCategory  true = von Hand gesetzt, Regeln überschreiben nicht
 * @property {string} note
 * @property {'shortcut'|'manual'|'demo'} source
 */

/**
 * @typedef {Object} Rule
 * @property {string} id
 * @property {string} pattern     klein geschrieben, wird im Händlernamen gesucht
 * @property {string} categoryId
 */

/**
 * @typedef {Object} Settings
 * @property {number|null} monthlyBudgetCents
 * @property {string} currency
 */

export const DEFAULT_SETTINGS = Object.freeze({ monthlyBudgetCents: null, currency: 'EUR' });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** @returns {Transaction} */
export function emptyTransaction(id, date) {
  return {
    id, date, time: null, amountCents: 0, currency: 'EUR', merchant: '', card: '',
    categoryId: null, manualCategory: false, note: '', source: 'manual',
  };
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** @returns {Transaction|null} */
export function sanitizeTransaction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, 80);
  const date = str(raw.date, 10);
  if (!id || !DATE_RE.test(date)) return null;
  if (typeof raw.amountCents !== 'number' || !Number.isFinite(raw.amountCents)) return null;
  const time = typeof raw.time === 'string' && TIME_RE.test(raw.time) ? raw.time : null;
  const categoryId = CATEGORY_IDS.includes(raw.categoryId) ? raw.categoryId : null;
  const currency = /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : 'EUR';
  return {
    id, date, time,
    amountCents: Math.round(raw.amountCents),
    currency,
    merchant: str(raw.merchant),
    card: str(raw.card, 80),
    categoryId,
    manualCategory: categoryId !== null && raw.manualCategory === true,
    note: str(raw.note, 500),
    source: SOURCES.includes(raw.source) ? raw.source : 'manual',
  };
}

/** @returns {Rule|null} */
export function sanitizeRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, 80);
  const pattern = str(raw.pattern, 80).toLowerCase();
  if (!id || !pattern || !CATEGORY_IDS.includes(raw.categoryId)) return null;
  return { id, pattern, categoryId: raw.categoryId };
}

/** @returns {Settings} */
export function sanitizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const b = s.monthlyBudgetCents;
  return {
    monthlyBudgetCents: typeof b === 'number' && Number.isFinite(b) && b > 0 ? Math.round(b) : null,
    currency: /^[A-Z]{3}$/.test(s.currency) ? s.currency : DEFAULT_SETTINGS.currency,
  };
}

/** Hebt alte Daten auf das aktuelle Schema. Idempotent. Bisher nur Version 1. */
export function upgradeRaw(data) {
  const d = { ...data };
  if (!d.version) d.version = 1;
  return d;
}

/**
 * @param {{transactions: Transaction[], rules: Rule[], settings: Settings, deletedIds: string[]}} state
 * @param {string} exportedAt ISO-Zeitstempel
 */
export function buildExport(state, exportedAt) {
  return {
    app: APP_ID,
    version: SCHEMA_VERSION,
    exportedAt,
    settings: state.settings,
    transactions: state.transactions,
    rules: state.rules,
    deletedIds: state.deletedIds,
  };
}

/**
 * Prüft eine Sicherungsdatei.
 * @param {string} text
 * @returns {{ok: true, transactions: Transaction[], rules: Rule[], settings: Settings, deletedIds: string[], skipped: number}
 *          | {ok: false, error: 'json'|'app'|'newer'|'shape'}}
 */
export function parseImport(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'json' }; }
  if (!data || typeof data !== 'object' || data.app !== APP_ID) return { ok: false, error: 'app' };
  if (typeof data.version === 'number' && data.version > SCHEMA_VERSION) return { ok: false, error: 'newer' };
  data = upgradeRaw(data);
  if (!Array.isArray(data.transactions)) return { ok: false, error: 'shape' };
  const transactions = data.transactions.map(sanitizeTransaction).filter(Boolean);
  const rules = (Array.isArray(data.rules) ? data.rules : []).map(sanitizeRule).filter(Boolean);
  const deletedIds = (Array.isArray(data.deletedIds) ? data.deletedIds : []).filter((x) => typeof x === 'string');
  return {
    ok: true, transactions, rules, deletedIds,
    settings: sanitizeSettings(data.settings),
    skipped: data.transactions.length - transactions.length,
  };
}
