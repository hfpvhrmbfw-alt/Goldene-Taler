// Datenmodell: Typen, Stammdaten (stabile IDs), Validierung, Export/Import.
// Keine Abhängigkeiten, keine Anzeigetexte.

export const APP_ID = 'taler';
export const SCHEMA_VERSION = 1;

/** Kategorien als stabile IDs. Nie umbenennen, nur ergänzen. Reihenfolge = Anzeige- und Gleichstandsreihenfolge. */
export const CATEGORY_IDS = [
  'lebensmittel', 'essen', 'mobilitaet', 'shopping', 'drogerie',
  'haushalt', 'gesundheit', 'freizeit', 'abos', 'reisen', 'bargeld', 'sonstiges',
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

/** Art eines Kontos: konto = Girokonto, Konto mit Karte, Unterkonto; tagesgeld; depot. */
export const ACCOUNT_TYPES = ['konto', 'tagesgeld', 'depot'];

/**
 * @typedef {Object} Account
 * @property {string} id
 * @property {string} bank       Name der Bank, fasst Konten zusammen ("ING")
 * @property {string} name       "Girokonto", "Extra-Konto", "Kinderdepot"
 * @property {'konto'|'tagesgeld'|'depot'} type
 * @property {boolean} main      Eingangskonto: hier kommt das Gehalt an, hier wird „frei für den Monat“ gerechnet
 * @property {boolean} other     gehört jemand anderem (z. B. Kinderdepot): wird gezeigt, zählt nicht zum eigenen Vermögen
 * @property {number|null} rateBp  Zinsen pro Jahr in Basispunkten (250 = 2,5 %), null = keine Angabe
 * @property {string[]} match    woran Taler das Konto erkennt: Kartenname, Name im Verwendungszweck, IBAN
 * @property {{cents: number, date: string, source: 'manual'|'statement'}|null} balance  letzter bekannter Stand
 */

/** Art einer Position im Depot. */
export const POSITION_KINDS = ['etf', 'aktie', 'fonds', 'krypto', 'anderes'];
/** Coins, deren Kurs Taler selbst holt. */
export const POSITION_COINS = ['BTC', 'ETH'];

/**
 * Eine Aktie, ein ETF oder Fonds in einem Depot. Stück und Kaufwert gelten am Tag `date`; Sparplan-Ausführungen danach
 * (gleiche ISIN im Auszug) zählen dazu, wenn `plan` an ist. Stück in Millionstel, damit Bruchstücke genau bleiben.
 * @typedef {Object} Position
 * @property {string} id
 * @property {string} accountId   das Depot
 * @property {string} name
 * @property {string} isin        ISIN oder WKN, groß geschrieben, darf leer sein
 * @property {'etf'|'aktie'|'fonds'|'anderes'} kind
 * @property {number} unitsMicro  Stück × 1.000.000
 * @property {number} costCents   Kaufwert gesamt
 * @property {string} date        YYYY-MM-DD, Stand von Stück und Kaufwert
 * @property {number|null} priceCents  Kurs je Stück
 * @property {string|null} priceDate   YYYY-MM-DD
 * @property {boolean} plan       Sparplan-Buchungen mit dieser ISIN dazuzählen
 * @property {''|'BTC'|'ETH'} coin  nur bei Krypto: Kurs kommt von CoinGecko
 */

/**
 * @typedef {Object} Category
 * @property {string} id       stabil; die mitgelieferten behalten ihre ID, eigene heißen c-…
 * @property {string} name
 * @property {'expense'|'income'|'balance'|'saving'} kind
 * @property {boolean} hidden  erscheint nicht mehr als Knopf beim Einordnen
 * @property {number|null} budgetCents  eigenes Monatsbudget (nur Ausgaben), null = keins
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
 * @property {string|null} accountId    von Hand gewähltes Konto (sonst erkennt Taler es an der Karte)
 * @property {string|null} toAccountId  von Hand gewähltes Gegenkonto bei Umbuchung oder Sparen
 * @property {boolean} spread       Jahreskosten: zählt zu je einem Zwölftel in diesem und den elf folgenden Monaten
 * @property {{categoryId: string, cents: number}[]} splits  Teile in anderen Kategorien (gleiches Vorzeichen wie amountCents); der Rest bleibt bei categoryId
 * @property {boolean} tax          für die Steuer markiert (Werbungskosten, Spenden …)
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
 * @property {string[]} ownAccounts  eigene Konten (Name, IBAN, eigener Name): Buchungen dorthin sind Umbuchungen
 */

export const DEFAULT_OWN_ACCOUNTS = Object.freeze(['Trade Republic', 'ING']);
export const DEFAULT_SETTINGS = Object.freeze({ monthlyBudgetCents: null, budgetMode: 'auto', budgetSince: null, currency: 'EUR', ownAccounts: DEFAULT_OWN_ACCOUNTS });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** @returns {Transaction} */
export function emptyTransaction(id, date) {
  return {
    id, date, time: null, amountCents: 0, currency: 'EUR', baseCents: null, merchant: '', card: '',
    categoryId: null, manualCategory: false, note: '', source: 'manual', excluded: false, kind: 'expense',
    accountId: null, toAccountId: null, spread: false, splits: [], tax: false,
  };
}

/** Höchstens so viele Teile pro Buchung. */
export const MAX_SPLITS = 4;

/** Teile einer Buchung: gültige Kategorie, Betrag mit dem Vorzeichen der Buchung, zusammen nicht mehr als die Buchung. */
export function sanitizeSplits(raw, amountCents) {
  if (!Array.isArray(raw) || !amountCents) return [];
  const sign = Math.sign(amountCents);
  const out = [];
  let left = Math.abs(amountCents);
  for (const p of raw) {
    if (out.length >= MAX_SPLITS || !p || typeof p !== 'object') continue;
    const categoryId = str(p.categoryId, 80);
    const cents = Number.isFinite(p.cents) ? Math.abs(Math.round(p.cents)) : 0;
    if (!categoryId || !cents || cents >= left) continue;
    out.push({ categoryId, cents: sign * cents });
    left -= cents;
  }
  return out;
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
    accountId: str(raw.accountId, 80) || null,
    toAccountId: str(raw.toAccountId, 80) || null,
    spread: raw.spread === true && (KINDS.includes(raw.kind) ? raw.kind : 'expense') === 'expense',
    splits: sanitizeSplits(raw.splits, Math.round(raw.amountCents)),
    tax: raw.tax === true,
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
  const kind = CATEGORY_KINDS.includes(raw.kind) ? raw.kind : 'expense';
  const b = raw.budgetCents;
  const budgetCents = kind === 'expense' && Number.isFinite(b) && b > 0 ? Math.round(b) : null;
  return { id, name, kind, hidden: raw.hidden === true, budgetCents };
}

/** Liste aus dem Speicher oder einer Sicherung; doppelte IDs fallen weg. */
export function sanitizeCategories(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(sanitizeCategory).filter((c) => c && !seen.has(c.id) && seen.add(c.id));
}

/** @returns {Account|null} */
export function sanitizeAccount(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, 80);
  const name = str(raw.name, 40);
  if (!id || !name) return null;
  const b = raw.balance;
  const balance = b && typeof b === 'object' && Number.isFinite(b.cents) && DATE_RE.test(b.date)
    ? { cents: Math.round(b.cents), date: b.date, source: b.source === 'statement' ? 'statement' : 'manual' } : null;
  return {
    id, name,
    bank: str(raw.bank, 40),
    type: ACCOUNT_TYPES.includes(raw.type) ? raw.type : 'konto',
    main: raw.main === true,
    other: raw.other === true,
    rateBp: Number.isFinite(raw.rateBp) && raw.rateBp >= 0 ? Math.round(raw.rateBp) : null,
    match: [...new Set((Array.isArray(raw.match) ? raw.match : []).map((m) => str(m, 60)).filter(Boolean))].slice(0, 10),
    balance,
  };
}

/** Liste aus dem Speicher oder einer Sicherung; doppelte IDs fallen weg. */
export function sanitizeAccounts(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(sanitizeAccount).filter((a) => a && !seen.has(a.id) && seen.add(a.id));
}

/** @returns {Position|null} */
export function sanitizePosition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, 80);
  const accountId = str(raw.accountId, 80);
  const name = str(raw.name, 60);
  const date = str(raw.date, 10);
  if (!id || !accountId || !name || !DATE_RE.test(date)) return null;
  const int = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
  const priceOk = Number.isFinite(raw.priceCents) && raw.priceCents >= 0 && DATE_RE.test(raw.priceDate);
  return {
    id, accountId, name, date,
    isin: str(raw.isin, 12).toUpperCase().replace(/\s+/g, ''),
    kind: POSITION_KINDS.includes(raw.kind) ? raw.kind : 'etf',
    unitsMicro: int(raw.unitsMicro),
    costCents: int(raw.costCents),
    priceCents: priceOk ? Math.round(raw.priceCents) : null,
    priceDate: priceOk ? raw.priceDate : null,
    plan: raw.plan === true,
    coin: raw.kind === 'krypto' && POSITION_COINS.includes(raw.coin) ? raw.coin : '',
  };
}

/** Liste aus dem Speicher oder einer Sicherung; doppelte IDs fallen weg. */
export function sanitizePositions(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(sanitizePosition).filter((p) => p && !seen.has(p.id) && seen.add(p.id));
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
    ownAccounts: Array.isArray(s.ownAccounts)
      ? [...new Set(s.ownAccounts.map((a) => str(a, 60)).filter(Boolean))].slice(0, 30) : [...DEFAULT_OWN_ACCOUNTS],
  };
}

/**
 * @param {{transactions: Transaction[], rules: Rule[], settings: Settings, deletedIds: string[], categories: Category[], accounts: Account[], positions: Position[], transferAsk?: [string, string][]}} state
 * @param {string} exportedAt ISO-Zeitstempel
 */
export function buildExport(state, exportedAt) {
  return {
    app: APP_ID,
    version: SCHEMA_VERSION,
    exportedAt,
    settings: state.settings,
    categories: state.categories,
    accounts: state.accounts,
    positions: state.positions,
    transactions: state.transactions,
    rules: state.rules,
    deletedIds: state.deletedIds,
    transferAsk: state.transferAsk || [],
    contracts: state.contracts || {},
  };
}

/** Verträge je Händler (genauer Name): bis wann kündbar. Ungültige Einträge fallen weg. */
export function sanitizeContracts(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(0, 200)) {
    const merchant = str(k, 200);
    if (merchant && v && DATE_RE.test(v.cancelBy)) out[merchant] = { cancelBy: v.cancelBy };
  }
  return out;
}

/** Offene Fragen „Umbuchung?“ als Paare von Buchungs-IDs (Ausgabe, Einnahme). */
export function sanitizeTransferAsk(list) {
  return (Array.isArray(list) ? list : [])
    .filter((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'string' && x && x.length <= 80))
    .map(([a, b]) => [a, b]);
}

/**
 * Prüft eine Sicherungsdatei.
 * @param {string} text
 * @returns {{ok: true, transactions: Transaction[], rules: Rule[], settings: Settings, deletedIds: string[], categories: Category[]|null, accounts: Account[]|null, positions: Position[], transferAsk: [string, string][], skipped: number}
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
  const accounts = Array.isArray(data.accounts) ? sanitizeAccounts(data.accounts) : null;
  const positions = sanitizePositions(data.positions);
  return {
    ok: true, transactions, rules, deletedIds, categories, accounts, positions, transferAsk: sanitizeTransferAsk(data.transferAsk), contracts: sanitizeContracts(data.contracts),
    settings: sanitizeSettings(data.settings),
    skipped: data.transactions.length - transactions.length,
  };
}
