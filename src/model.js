// Datenmodell: Typen, Stammdaten (stabile IDs), Validierung, Export/Import.
// Keine Abhängigkeiten, keine Anzeigetexte.

export const APP_ID = 'taler';
export const SCHEMA_VERSION = 1;

/** Kategorien als stabile IDs. Nie umbenennen, nur ergänzen. Reihenfolge = Anzeige- und Gleichstandsreihenfolge. */
export const CATEGORY_IDS = [
  'lebensmittel', 'essen', 'mobilitaet', 'shopping', 'drogerie',
  'haushalt', 'gesundheit', 'freizeit', 'abos', 'reisen', 'sonstiges',
];

/** demo = Beispieldaten, lassen sich getrennt entfernen. statement = aus einem Kontoauszug (PDF). */
export const SOURCES = ['shortcut', 'manual', 'demo', 'statement'];

/**
 * Art einer Buchung. expense = Ausgabe (oder Erstattung, dann negativ), income = Einnahme (Betrag negativ),
 * saving = Sparplan (zählt nicht als Ausgabe), transfer = Umbuchung zwischen eigenen Konten (zählt nirgends),
 * balance = Kategorie „gleicht sich aus“ (z. B. Dienstwagen: Sprit raus, Abrechnung rein; zählt weder als Ausgabe noch als Einnahme).
 * Hat eine Buchung eine Kategorie, bestimmt deren Art die der Buchung (siehe `kindForCategory` in logic.js).
 */
export const KINDS = ['expense', 'income', 'saving', 'transfer', 'balance'];

/** Art einer Kategorie: expense, income, balance (gleicht sich aus) oder saving. */
export const CATEGORY_KINDS = ['expense', 'income', 'balance', 'saving'];

/**
 * @typedef {Object} Category
 * @property {string} id       stabil; die mitgelieferten behalten ihre ID, eigene heißen c-…
 * @property {string} name
 * @property {'expense'|'income'|'balance'|'saving'} kind
 * @property {boolean} hidden  erscheint nicht mehr als Knopf beim Einordnen
 */

/**
 * @typedef {Object} Transaction
 * @property {string} id
 * @property {string} date          YYYY-MM-DD (lokales Datum der Zahlung)
 * @property {string|null} time     HH:MM oder null
 * @property {number} amountCents   ganze Cent, positiv = Geld ging raus, negativ = Geld kam rein (Erstattung, Einnahme)
 * @property {'expense'|'income'|'saving'|'transfer'|'balance'} kind
 * @property {string} currency      ISO 4217, z. B. EUR
 * @property {number|null} baseCents  bei Fremdwährung: abgerechneter Betrag in der Hauptwährung (sonst null)
 * @property {string} merchant
 * @property {string} card
 * @property {string|null} categoryId
 * @property {boolean} manualCategory  true = von Hand gesetzt, Regeln überschreiben nicht
 * @property {string} note
 * @property {'shortcut'|'manual'|'demo'|'statement'} source
 * @property {boolean} excluded     true = zählt in keiner Summe mit (z. B. für andere ausgelegt)
 */

/**
 * @typedef {Object} Rule
 * @property {string} id
 * @property {string} pattern     klein geschrieben, wird im Händlernamen gesucht
 * @property {string} categoryId
 */

/**
 * @typedef {Object} Settings
 * @property {number|null} monthlyBudgetCents  fester Betrag (nur bei budgetMode „fixed“)
 * @property {'auto'|'fixed'|'off'} budgetMode  auto = Einnahmen minus Sparpläne aus den Kontoauszügen
 * @property {string|null} budgetSince  YYYY-MM, ab dem das Budget gilt (für den Rückblick)
 * @property {string} currency
 */

export const DEFAULT_SETTINGS = Object.freeze({ monthlyBudgetCents: null, budgetMode: 'auto', budgetSince: null, currency: 'EUR' });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** @returns {Transaction} */
export function emptyTransaction(id, date) {
  return {
    id, date, time: null, amountCents: 0, currency: 'EUR', baseCents: null, merchant: '', card: '',
    categoryId: null, manualCategory: false, note: '', source: 'manual', excluded: false, kind: 'expense',
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
  const categoryId = str(raw.categoryId, 80) || null;
  const currency = /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : 'EUR';
  return {
    id, date, time,
    amountCents: Math.round(raw.amountCents),
    currency,
    baseCents: Number.isFinite(raw.baseCents) ? Math.round(raw.baseCents) : null,
    merchant: str(raw.merchant),
    card: str(raw.card, 80),
    categoryId,
    manualCategory: categoryId !== null && raw.manualCategory === true,
    note: str(raw.note, 500),
    source: SOURCES.includes(raw.source) ? raw.source : 'manual',
    excluded: raw.excluded === true,
    kind: KINDS.includes(raw.kind) ? raw.kind : 'expense',
  };
}

/** @returns {Rule|null} */
export function sanitizeRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, 80);
  const pattern = str(raw.pattern, 80).toLowerCase();
  const categoryId = str(raw.categoryId, 80);
  if (!id || !pattern || !categoryId) return null;
  return { id, pattern, categoryId };
}

/** @returns {Category|null} */
export function sanitizeCategory(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, 80);
  const name = str(raw.name, 40);
  if (!id || !name) return null;
  return { id, name, kind: CATEGORY_KINDS.includes(raw.kind) ? raw.kind : 'expense', hidden: raw.hidden === true };
}

/** Liste aus dem Speicher oder einer Sicherung; doppelte IDs fallen weg. */
export function sanitizeCategories(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(sanitizeCategory).filter((c) => c && !seen.has(c.id) && seen.add(c.id));
}

/** @returns {Settings} */
export function sanitizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const b = s.monthlyBudgetCents;
  const budget = typeof b === 'number' && Number.isFinite(b) && b > 0 ? Math.round(b) : null;
  const mode = ['auto', 'fixed', 'off'].includes(s.budgetMode) ? s.budgetMode : budget ? 'fixed' : 'auto';
  return {
    monthlyBudgetCents: budget,
    budgetMode: mode === 'fixed' && !budget ? 'auto' : mode,
    budgetSince: budget && /^\d{4}-\d{2}$/.test(s.budgetSince) ? s.budgetSince : null,
    currency: /^[A-Z]{3}$/.test(s.currency) ? s.currency : DEFAULT_SETTINGS.currency,
  };
}

/**
 * @param {{transactions: Transaction[], rules: Rule[], settings: Settings, deletedIds: string[], categories: Category[]}} state
 * @param {string} exportedAt ISO-Zeitstempel
 */
export function buildExport(state, exportedAt) {
  return {
    app: APP_ID,
    version: SCHEMA_VERSION,
    exportedAt,
    settings: state.settings,
    categories: state.categories,
    transactions: state.transactions,
    rules: state.rules,
    deletedIds: state.deletedIds,
  };
}

/**
 * Prüft eine Sicherungsdatei.
 * @param {string} text
 * @returns {{ok: true, transactions: Transaction[], rules: Rule[], settings: Settings, deletedIds: string[], categories: Category[]|null, skipped: number}
 *          | {ok: false, error: 'json'|'app'|'newer'|'shape'}}
 */
export function parseImport(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'json' }; }
  if (!data || typeof data !== 'object' || data.app !== APP_ID) return { ok: false, error: 'app' };
  if (typeof data.version === 'number' && data.version > SCHEMA_VERSION) return { ok: false, error: 'newer' };
  // Bisher gibt es nur Version 1. Kommt eine zweite, wird alte Sicherung hier umgebaut.
  if (!Array.isArray(data.transactions)) return { ok: false, error: 'shape' };
  const transactions = data.transactions.map(sanitizeTransaction).filter(Boolean);
  const rules = (Array.isArray(data.rules) ? data.rules : []).map(sanitizeRule).filter(Boolean);
  const deletedIds = (Array.isArray(data.deletedIds) ? data.deletedIds : []).filter((x) => typeof x === 'string');
  // Ältere Sicherungen haben keine Kategorienliste: dann bleiben die mitgelieferten.
  const categories = Array.isArray(data.categories) ? sanitizeCategories(data.categories) : null;
  return {
    ok: true, transactions, rules, deletedIds, categories,
    settings: sanitizeSettings(data.settings),
    skipped: data.transactions.length - transactions.length,
  };
}
