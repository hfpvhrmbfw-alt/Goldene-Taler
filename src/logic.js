// Reine Logik: Daten rein, Ergebnis raus. Kein DOM, kein Speicher, keine Uhr.
import { CATEGORY_IDS, sanitizeTransaction } from './model.js';

/** FNV-1a 32 Bit als Hex. Gleiche Eingabe → gleiche ID, auch später in Swift. */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (const ch of new TextEncoder().encode(s)) {
    h ^= ch;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const CURRENCY_SIGNS = { '€': 'EUR', '$': 'USD', '£': 'GBP', 'CHF': 'CHF', 'Fr.': 'CHF' };

/**
 * Liest einen Betrag, wie ihn der Kurzbefehl liefert: "12,34 €", "€12.34", "1.234,56 €", "-5,00 €", "EUR 3,20".
 * @param {string} text
 * @returns {{cents: number, currency: string|null}|null}
 */
export function parseAmount(text) {
  if (typeof text !== 'string') return null;
  let s = text.replace(/[  \s]/g, '');
  if (!s) return null;
  let currency = null;
  const code = s.match(/[A-Z]{3}/);
  if (code) currency = code[0];
  else for (const [sign, c] of Object.entries(CURRENCY_SIGNS)) if (s.includes(sign)) { currency = c; break; }
  const negative = /^[^\d]*[-−]/.test(s) || /[-−]$/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const decPos = Math.max(lastComma, lastDot);
  let intPart = s;
  let fracPart = '';
  // Ein Trenner mit genau 3 Ziffern danach und ohne zweiten Trenner gilt als Tausenderpunkt ("1.234").
  if (decPos >= 0) {
    const after = s.length - decPos - 1;
    const onlyOneSep = s.indexOf(s[decPos]) === decPos && (lastComma < 0 || lastDot < 0);
    if (!(onlyOneSep && after === 3)) {
      intPart = s.slice(0, decPos);
      fracPart = s.slice(decPos + 1);
    }
  }
  intPart = intPart.replace(/[.,]/g, '');
  fracPart = (fracPart + '00').slice(0, 2);
  const cents = Number(intPart || '0') * 100 + Number(fracPart);
  if (!Number.isFinite(cents)) return null;
  return { cents: negative ? -cents : cents, currency };
}

/**
 * Liest Datum und Uhrzeit: ISO 8601 ("2026-10-20T18:55:12+02:00") oder deutsch ("20.10.2026, 18:55").
 * Es zählt das Datum, wie es geschrieben steht (lokale Zeit des iPhones), ohne Umrechnung.
 * @returns {{date: string, time: string|null}|null}
 */
export function parseDateTime(text) {
  const s = String(text || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : null };
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:,?\s*(\d{1,2}):(\d{2}))?/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return {
      date: `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`,
      time: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : null,
    };
  }
  return null;
}

const CUR = '(?:€|EUR|\\$|USD|£|GBP|CHF|Fr\\.)';
const NUM = '[-−]?\\d{1,3}(?:[.,\\s\\u00a0\\u202f]?\\d{3})*(?:[.,]\\d{1,2})?';
/** Ein ganzes Feld ist ein Betrag ("42,17 €", "€42.17", "-5,00 EUR", "12,90"). */
const AMOUNT_FIELD_RE = new RegExp(`^(?:${CUR}\\s*${NUM}|${NUM}\\s*${CUR}|[-−]?\\d+[.,]\\d{2})$`);
/** Ein Betrag mit Währung irgendwo im Text ("Zahlung über 42,17 € mit Visa"). */
const AMOUNT_IN_TEXT_RE = new RegExp(`${CUR}\\s*${NUM}|${NUM}\\s*${CUR}`);

/**
 * Eine Zeile aus der Kurzbefehl-Datei: "Datum;Betrag;Händler;Karte".
 * Steht der Betrag nicht im zweiten Feld (andere Bank, Felder vertauscht, Mitteilungstext),
 * wird er in den übrigen Feldern gesucht; dann gilt das erste übrige Feld als Händler, das letzte als Karte.
 * Enthält der Händlername selbst ein Semikolon, bleibt er im Normalfall ganz (alles zwischen Betrag und Karte).
 * @param {string} line
 * @returns {{ok: true, date: string, time: string|null, amountCents: number, currency: string|null, merchant: string, card: string}
 *          | {ok: false, error: 'empty'|'fields'|'date'|'amount'}}
 */
export function parseLogLine(line) {
  const s = String(line || '').trim();
  if (!s) return { ok: false, error: 'empty' };
  const parts = s.split(';').map((p) => p.trim());
  if (parts.length < 3) return { ok: false, error: 'fields' };
  const dt = parseDateTime(parts[0]);
  if (!dt) return { ok: false, error: 'date' };

  if (AMOUNT_FIELD_RE.test(parts[1].replace(/\s+/g, ' '))) {
    const amount = parseAmount(parts[1]);
    const card = parts.length >= 4 ? parts[parts.length - 1] : '';
    const merchant = (parts.length >= 4 ? parts.slice(2, -1) : parts.slice(2)).join(';');
    return { ok: true, ...dt, amountCents: amount.cents, currency: amount.currency, merchant, card };
  }

  const rest = parts.slice(1);
  let idx = rest.findIndex((p) => AMOUNT_FIELD_RE.test(p.replace(/\s+/g, ' ')));
  let amountText = idx >= 0 ? rest[idx] : null;
  let remainder = '';
  if (idx < 0) {
    idx = rest.findIndex((p) => AMOUNT_IN_TEXT_RE.test(p));
    if (idx < 0) return { ok: false, error: 'amount' };
    amountText = rest[idx].match(AMOUNT_IN_TEXT_RE)[0];
    remainder = rest[idx].replace(amountText, ' ').replace(/\s+/g, ' ').replace(/^[\s:–—-]+|[\s:–—-]+$/g, '')
      .replace(/^(?:mit|über|per|via|with|using|bei|at)\s+/i, '');
  }
  const amount = parseAmount(amountText);
  if (!amount) return { ok: false, error: 'amount' };
  const texts = rest.map((p, i) => (i === idx ? remainder : p)).filter(Boolean);
  const merchant = texts[0] || '';
  const card = texts.length >= 2 ? texts[texts.length - 1] : '';
  return { ok: true, ...dt, amountCents: amount.cents, currency: amount.currency, merchant, card };
}

/**
 * Liest die ganze Datei. IDs entstehen aus dem Zeileninhalt, damit ein erneuter Import nichts doppelt anlegt.
 * Gleiche Zeilen (seltener Fall) bekommen eine laufende Nummer.
 * @param {string} text
 * @param {string} defaultCurrency
 * Zeilen ohne Betrag (Wallet-Mitteilungen zu Bordkarten, Tickets usw.) sind kein Fehler und landen in `ignored`.
 * @returns {{transactions: import('./model.js').Transaction[], errors: {line: number, error: string}[], ignored: number[]}}
 */
export function parseLog(text, defaultCurrency = 'EUR') {
  const seen = new Map();
  const transactions = [];
  const errors = [];
  const ignored = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const r = parseLogLine(line);
    if (!r.ok) {
      if (r.error === 'amount') ignored.push(i + 1);
      else if (r.error !== 'empty') errors.push({ line: i + 1, error: r.error });
      return;
    }
    const base = `sc-${hashString(line)}`;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    transactions.push(sanitizeTransaction({
      id: n === 0 ? base : `${base}-${n}`,
      date: r.date, time: r.time, amountCents: r.amountCents,
      currency: r.currency || defaultCurrency,
      merchant: r.merchant, card: r.card,
      categoryId: null, manualCategory: false, note: '', source: 'shortcut',
    }));
  });
  return { transactions, errors, ignored };
}

/** Händlername für den Regelvergleich: klein, Leerzeichen vereinheitlicht, vorne und hinten ein Leerzeichen. */
export function normalizeMerchant(merchant) {
  return ` ${String(merchant || '').toLowerCase().replace(/\s+/g, ' ').trim()} `;
}

/**
 * Erste passende Regel gewinnt. Ein Muster passt, wenn es im Händlernamen an einem Wortanfang steht
 * ("obi" passt auf "OBI Markt", aber nicht auf "Mobilcom").
 * @param {string} merchant
 * @param {import('./model.js').Rule[]} rules
 * @returns {string|null} categoryId
 */
export function categorize(merchant, rules) {
  const m = normalizeMerchant(merchant);
  for (const rule of rules) {
    const p = rule.pattern.toLowerCase();
    let i = m.indexOf(p);
    while (i >= 0) {
      if (i === 0 || !/[\p{L}\p{N}]/u.test(m[i - 1]) || !/[\p{L}\p{N}]/u.test(p[0])) return rule.categoryId;
      i = m.indexOf(p, i + 1);
    }
  }
  return null;
}

/** Wendet Regeln auf alle Buchungen an, deren Kategorie nicht von Hand gesetzt wurde. */
export function applyRules(transactions, rules) {
  return transactions.map((t) => (t.manualCategory ? t : { ...t, categoryId: categorize(t.merchant, rules) }));
}

/**
 * Fügt neue Buchungen hinzu. Vorhandene bleiben unverändert (eigene Änderungen gehen nicht verloren),
 * gelöschte IDs kommen nicht zurück.
 * @returns {{transactions: import('./model.js').Transaction[], added: import('./model.js').Transaction[]}}
 */
export function mergeTransactions(existing, incoming, deletedIds = []) {
  const known = new Set(existing.map((t) => t.id));
  const gone = new Set(deletedIds);
  const added = incoming.filter((t) => !known.has(t.id) && !gone.has(t.id));
  return { transactions: sortTransactions([...existing, ...added]), added };
}

/** Neueste zuerst; bei Gleichstand nach Uhrzeit, dann ID. */
export function sortTransactions(transactions) {
  return [...transactions].sort((a, b) =>
    (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
    || ((a.time || '') < (b.time || '') ? 1 : (a.time || '') > (b.time || '') ? -1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** "2026-10-20" → "2026-10" */
export const monthOf = (date) => date.slice(0, 7);

/** Alle Monate mit Buchungen, neueste zuerst; der übergebene aktuelle Monat ist immer dabei. */
export function monthsWithData(transactions, currentMonth) {
  const set = new Set(transactions.map((t) => monthOf(t.date)));
  set.add(currentMonth);
  return [...set].sort().reverse();
}

/** Vormonat zu "YYYY-MM". */
export function previousMonth(month) {
  let [y, m] = month.split('-').map(Number);
  m -= 1;
  if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Tage im Monat "YYYY-MM" (Kalenderrechnung, ohne Uhr und Zeitzone). */
export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/**
 * @typedef {Object} MonthSummary
 * @property {string} month
 * @property {number} spentCents       Summe der Ausgaben minus Erstattungen
 * @property {number} count
 * @property {number} previousCents    gleicher Wert für den Vormonat
 * @property {number|null} comparedToDay  laufender Monat: Vormonat nur bis zu diesem Tag verglichen, sonst null
 * @property {number} previousToDateCents Vormonat bis comparedToDay (sonst = previousCents)
 * @property {number} monthProgress    vergangener Anteil des Monats, 0..1
 * @property {{currency: string, cents: number, count: number}[]} foreign  Beträge in anderer Währung (unumgerechnet mitgezählt)
 * @property {number|null} budgetLeftCents
 * @property {number|null} budgetShare  Anteil verbraucht, 0..n
 * @property {number} dailyAverageCents bezogen auf vergangene Tage (laufender Monat) bzw. alle Tage
 * @property {{categoryId: string|null, cents: number, count: number, share: number}[]} byCategory  größte zuerst
 * @property {{merchant: string, cents: number, count: number}[]} topMerchants  max. 5
 */

/**
 * @param {import('./model.js').Transaction[]} transactions
 * @param {string} month   YYYY-MM
 * @param {string} today   YYYY-MM-DD
 * @param {number|null} budgetCents
 * @param {string} currency  Hauptwährung
 * @returns {MonthSummary}
 */
export function monthSummary(transactions, month, today, budgetCents = null, currency = 'EUR') {
  const inMonth = transactions.filter((t) => monthOf(t.date) === month);
  const prev = previousMonth(month);
  const spentCents = inMonth.reduce((s, t) => s + t.amountCents, 0);
  const inPrev = transactions.filter((t) => monthOf(t.date) === prev);
  const previousCents = inPrev.reduce((s, t) => s + t.amountCents, 0);
  const comparedToDay = monthOf(today) === month ? Number(today.slice(8, 10)) : null;
  const previousToDateCents = comparedToDay === null ? previousCents
    : inPrev.filter((t) => Number(t.date.slice(8, 10)) <= comparedToDay).reduce((s, t) => s + t.amountCents, 0);
  const foreignMap = new Map();
  for (const t of inMonth) {
    if (t.currency === currency) continue;
    const e = foreignMap.get(t.currency) || { currency: t.currency, cents: 0, count: 0 };
    e.cents += t.amountCents;
    e.count += 1;
    foreignMap.set(t.currency, e);
  }

  const order = [...CATEGORY_IDS, null];
  const byCat = new Map();
  for (const t of inMonth) {
    const k = t.categoryId;
    const e = byCat.get(k) || { categoryId: k, cents: 0, count: 0, share: 0 };
    e.cents += t.amountCents;
    e.count += 1;
    byCat.set(k, e);
  }
  const positive = [...byCat.values()].reduce((s, e) => s + Math.max(0, e.cents), 0);
  const byCategory = [...byCat.values()]
    .map((e) => ({ ...e, share: positive > 0 ? Math.max(0, e.cents) / positive : 0 }))
    .sort((a, b) => b.cents - a.cents || order.indexOf(a.categoryId) - order.indexOf(b.categoryId));

  const byMerchant = new Map();
  for (const t of inMonth) {
    const k = t.merchant || '';
    const e = byMerchant.get(k) || { merchant: k, cents: 0, count: 0 };
    e.cents += t.amountCents;
    e.count += 1;
    byMerchant.set(k, e);
  }
  const topMerchants = [...byMerchant.values()]
    .sort((a, b) => b.cents - a.cents || (a.merchant < b.merchant ? -1 : a.merchant > b.merchant ? 1 : 0))
    .slice(0, 5);

  const total = daysInMonth(month);
  const elapsed = monthOf(today) === month ? Number(today.slice(8, 10)) : today < month ? 0 : total;
  return {
    month,
    spentCents,
    count: inMonth.length,
    previousCents,
    comparedToDay,
    previousToDateCents,
    monthProgress: elapsed / total,
    foreign: [...foreignMap.values()],
    budgetLeftCents: budgetCents ? budgetCents - spentCents : null,
    budgetShare: budgetCents ? spentCents / budgetCents : null,
    dailyAverageCents: elapsed > 0 ? Math.round(spentCents / elapsed) : 0,
    byCategory,
    topMerchants,
  };
}

/**
 * Vorschlag für ein Regelmuster aus einem Händlernamen: erstes Wort mit mindestens drei Buchstaben,
 * ohne Filialnummern ("REWE Markt GmbH 1234" → "rewe", "DM-Drogerie Markt" → "dm-drogerie").
 */
export function suggestPattern(merchant) {
  const words = String(merchant || '').toLowerCase().split(/\s+/).filter(Boolean);
  const w = words.find((x) => /\p{L}{2,}/u.test(x) && !/^\d+$/.test(x));
  return w ? w.replace(/[*#]+$/, '') : '';
}

/**
 * Buchungen nach Tag gruppiert, für die Liste (neueste zuerst).
 * @param {import('./model.js').Transaction[]} transactions
 * @param {{month?: string|null, categoryId?: string|null|undefined, query?: string, merchant?: string|null}} filter
 *   categoryId: undefined = alle, null = ohne Kategorie
 * @returns {{date: string, totalCents: number, items: import('./model.js').Transaction[]}[]}
 */
export function groupByDay(transactions, filter = {}) {
  const q = (filter.query || '').trim().toLowerCase();
  const list = sortTransactions(transactions).filter((t) =>
    (!filter.month || monthOf(t.date) === filter.month)
    && (filter.categoryId === undefined || t.categoryId === filter.categoryId)
    && (!filter.merchant || t.merchant === filter.merchant)
    && (!q || t.merchant.toLowerCase().includes(q) || t.note.toLowerCase().includes(q)));
  const groups = [];
  for (const t of list) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== t.date) { g = { date: t.date, totalCents: 0, items: [] }; groups.push(g); }
    g.items.push(t);
    g.totalCents += t.amountCents;
  }
  return groups;
}

/** Regeln nach Genauigkeit: längere Muster zuerst ("rewe to go" vor "rewe"), bei Gleichstand nach ID. */
export function orderRules(rules) {
  return [...rules].sort((a, b) => b.pattern.length - a.pattern.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Legt eine Regel an oder ändert die Kategorie einer Regel mit gleichem Muster.
 * @returns {{rules: import('./model.js').Rule[], rule: import('./model.js').Rule}}
 */
export function upsertRule(rules, pattern, categoryId, newId) {
  const p = String(pattern || '').trim().toLowerCase();
  const existing = rules.find((r) => r.pattern === p);
  const rule = existing ? { ...existing, categoryId } : { id: newId, pattern: p, categoryId };
  return { rules: orderRules([...rules.filter((r) => r.id !== rule.id), rule]), rule };
}

/**
 * Kategorien nach Häufigkeit, für die Auswahl beim Einordnen: oft genutzte zuerst, sonst feste Reihenfolge.
 * @returns {string[]}
 */
export function categoriesByUse(transactions) {
  const n = new Map();
  for (const t of transactions) if (t.categoryId) n.set(t.categoryId, (n.get(t.categoryId) || 0) + 1);
  return [...CATEGORY_IDS].sort((a, b) => (n.get(b) || 0) - (n.get(a) || 0) || CATEGORY_IDS.indexOf(a) - CATEGORY_IDS.indexOf(b));
}

/** Ändert Muster oder Kategorie einer Regel. Hat eine andere Regel schon dieses Muster, ersetzt die geänderte sie. */
export function editRule(rules, id, pattern, categoryId) {
  const p = String(pattern || '').trim().toLowerCase();
  const rule = { id, pattern: p, categoryId };
  return orderRules([...rules.filter((r) => r.id !== id && r.pattern !== p), rule]);
}

/** Ganze Kalendertage von a bis b (beide YYYY-MM-DD), ohne Uhr und Zeitzone. */
export function daysBetween(a, b) {
  const utc = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((utc(b) - utc(a)) / 86400000);
}
