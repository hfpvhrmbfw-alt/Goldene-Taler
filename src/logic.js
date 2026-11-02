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
 * Eine Zeile aus der Kurzbefehl-Datei: "Datum;Titel;Untertitel;Text" (Wallet-Mitteilung) oder alt "Datum;Betrag;Händler;Karte".
 * Der Betrag wird in den Feldern nach dem Datum gesucht; das erste übrige Feld gilt als Händler, das letzte als Karte.
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
  // Wallet nennt die Karte oft zweimal (Titel und Mitteilungstext): dann ist sie die Karte, der andere Text der Händler.
  const twice = texts.find((t, i) => texts.findIndex((u) => u.toLowerCase() === t.toLowerCase()) !== i);
  const merchant = (twice ? texts.find((t) => t.toLowerCase() !== twice.toLowerCase()) : texts[0]) || '';
  const card = twice || (texts.length >= 2 ? texts[texts.length - 1] : '');
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
  const lines = String(text || '').split(/\r?\n/).map((raw) => raw.trim());
  lines.forEach((first, i) => {
    let line = first;
    let r = parseLogLine(line);
    // Mehrzeiliger Mitteilungstext: der Betrag steht dann in der Folgezeile, die selbst kein Datum hat.
    for (let j = i + 1; !r.ok && r.error === 'amount' && j < lines.length && lines[j] && !parseDateTime(lines[j]); j++) {
      const joined = `${line} ${lines[j]}`;
      const rj = parseLogLine(joined);
      line = joined;
      if (rj.ok) { r = rj; lines.fill('', i + 1, j + 1); }
    }
    if (!r.ok) {
      if (r.error === 'amount') ignored.push(i + 1);
      else if (r.error !== 'empty') errors.push({ line: i + 1, error: r.error, text: first.slice(0, 40) });
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

/** Welche Buchungsart (ohne Kategorie) zu welcher Kategorieart passt. */
const FITS = { expense: ['expense'], income: ['income'], balance: ['expense', 'income'], saving: ['expense'] };

/**
 * Wendet die Regeln an: setzt Kategorie und damit die Art der Buchung (Kategorie „gleicht sich aus“ macht aus Ausgabe und
 * Einnahme eine Ausgleichsbuchung, Kategorie „Sparen“ ein Sparen). Von Hand gesetzte Kategorien bleiben, ebenso Umbuchungen und
 * Sparen ohne Kategorie (z. B. Sparplan aus dem Auszug). Passt die Art nicht zur Kategorie (Ausgabe in „Gehalt“), gilt die Regel nicht.
 * Ohne Treffer fällt eine zuvor durch Regel gesetzte Art zurück auf Einnahme (Betrag negativ) oder Ausgabe.
 * Gibt dasselbe Objekt zurück, wo sich nichts ändert.
 * @param {import('./model.js').Transaction[]} transactions
 * @param {import('./model.js').Rule[]} rules
 * @param {import('./model.js').Category[]} categories
 */
export function applyRules(transactions, rules, categories = []) {
  return transactions.map((t) => {
    const k = kindOf(t);
    if (t.manualCategory || k === 'transfer' || (k === 'saving' && !t.categoryId)) return t;
    const base = k === 'balance' || k === 'saving' ? (t.amountCents < 0 ? 'income' : 'expense') : k;
    const id = categorize(t.merchant, rules);
    const ck = id ? categoryKind(categories, id) : null;
    const fits = ck && FITS[ck].includes(base);
    const next = fits ? { categoryId: id, kind: ck } : { categoryId: null, kind: base };
    return next.categoryId === t.categoryId && next.kind === k ? t : { ...t, ...next };
  });
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

/** Art einer Buchung; ältere Daten ohne Angabe sind Ausgaben. */
export const kindOf = (t) => t.kind || 'expense';

/** Zählt eine Buchung bei den Ausgaben mit? Von Hand ausgenommene (z. B. für andere ausgelegt) nicht, Einnahmen, Sparen und Umbuchungen auch nicht. */
export const counts = (t) => !t.excluded && kindOf(t) === 'expense';

/** Braucht die Buchung eine Kategorie? Ausgaben und Einnahmen, die mitzählen und noch keine haben. */
export const needsCategory = (t) => !t.excluded && !t.categoryId && (kindOf(t) === 'expense' || kindOf(t) === 'income');

/** Art einer Kategorie nach ID; unbekannte IDs gelten als Ausgabe. */
export const categoryKind = (categories, id) => categories.find((c) => c.id === id)?.kind ?? 'expense';

/** Summe in der Hauptwährung für Buchungen einer Art, ohne ausgenommene. Geld, das reinkam, steht positiv (Einnahmen). */
function kindTotal(list, kind, currency) {
  let cents = 0;
  let count = 0;
  for (const t of list) {
    if (t.excluded || kindOf(t) !== kind) continue;
    const v = baseAmount(t, currency);
    if (v === null) continue;
    cents += kind === 'income' ? -v : v;
    count += 1;
  }
  return { cents, count };
}

/**
 * Betrag in der Hauptwährung: bei gleicher Währung der Betrag selbst, bei Fremdwährung der von Hand
 * oder aus dem Kontoauszug eingetragene Euro-Betrag (`baseCents`), sonst null (dann zählt er in keiner Summe).
 */
export const baseAmount = (t, currency = 'EUR') =>
  (t.currency === currency ? t.amountCents : Number.isInteger(t.baseCents) ? t.baseCents : null);

/** Gibt es mitgezählte Buchungen vor diesem Monat? Erst dann ist der Monat selbst vollständig erfasst. */
export function trackedBefore(transactions, month) {
  return transactions.some((t) => counts(t) && monthOf(t.date) < month);
}

/** Fremdwährungsbeträge ohne Euro-Betrag, je Währung summiert. */
function foreignOf(list, currency) {
  const map = new Map();
  for (const t of list) {
    if (baseAmount(t, currency) !== null) continue;
    const e = map.get(t.currency) || { currency: t.currency, cents: 0, count: 0 };
    e.cents += t.amountCents;
    e.count += 1;
    map.set(t.currency, e);
  }
  return [...map.values()];
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
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * @typedef {Object} MonthSummary
 * @property {string} month
 * @property {number} spentCents       Summe der Ausgaben minus Erstattungen
 * @property {number} count
 * @property {number} previousCents    gleicher Wert für den Vormonat
 * @property {boolean} previousComplete  Vormonat ab dem ersten Tag erfasst (sonst ist ein Vergleich irreführend)
 * @property {number|null} comparedToDay  laufender Monat: Vormonat nur bis zu diesem Tag verglichen, sonst null
 * @property {number} previousToDateCents Vormonat bis comparedToDay (sonst = previousCents)
 * @property {number} monthProgress    vergangener Anteil des Monats, 0..1
 * @property {{currency: string, cents: number, count: number}[]} foreign  Fremdwährung ohne Euro-Betrag, in keiner Summe
 * @property {number|null} budgetLeftCents
 * @property {number|null} budgetShare  Anteil verbraucht, 0..n
 * @property {number} incomeCents      Einnahmen des Monats (positiv)
 * @property {number} savingCents      Sparpläne des Monats
 * @property {number} balanceCents     Einnahmen − Ausgaben − Sparen
 * @property {{categoryId: string|null, outCents: number, inCents: number, openCents: number, count: number}[]} settling
 *   Kategorien „gleicht sich aus“ im Monat: raus, rein und was noch offen ist (raus − rein)
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
  const counted = transactions.filter((t) => counts(t) && monthOf(t.date) === month);
  // Mit Euro-Betrag; Fremdwährung ohne Umrechnung steht nur in `foreign`.
  const inMonth = counted.filter((t) => baseAmount(t, currency) !== null).map((t) => ({ ...t, amountCents: baseAmount(t, currency) }));
  const prev = previousMonth(month);
  const spentCents = inMonth.reduce((s, t) => s + t.amountCents, 0);
  const inPrev = transactions.filter((t) => counts(t) && monthOf(t.date) === prev && baseAmount(t, currency) !== null);
  const previousCents = inPrev.reduce((s, t) => s + baseAmount(t, currency), 0);
  const comparedToDay = monthOf(today) === month ? Number(today.slice(8, 10)) : null;
  const previousToDateCents = comparedToDay === null ? previousCents
    : inPrev.filter((t) => Number(t.date.slice(8, 10)) <= comparedToDay).reduce((s, t) => s + baseAmount(t, currency), 0);
  const foreign = foreignOf(counted, currency);
  const monthAll = transactions.filter((t) => monthOf(t.date) === month);
  const incomeCents = kindTotal(monthAll, 'income', currency).cents;
  const savingCents = kindTotal(monthAll, 'saving', currency).cents;
  const settle = new Map();
  for (const t of monthAll) {
    const v = kindOf(t) === 'balance' && !t.excluded ? baseAmount(t, currency) : null;
    if (v === null) continue;
    const e = settle.get(t.categoryId) || { categoryId: t.categoryId, outCents: 0, inCents: 0, openCents: 0, count: 0 };
    if (v > 0) e.outCents += v; else e.inCents -= v;
    e.openCents = e.outCents - e.inCents;
    e.count += 1;
    settle.set(t.categoryId, e);
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
    count: counted.length,
    previousCents,
    previousComplete: trackedBefore(transactions, prev),
    comparedToDay,
    previousToDateCents,
    monthProgress: elapsed / total,
    foreign,
    settling: [...settle.values()],
    incomeCents,
    savingCents,
    balanceCents: incomeCents - spentCents - savingCents,
    budgetLeftCents: budgetCents ? budgetCents - spentCents : null,
    budgetShare: budgetCents ? spentCents / budgetCents : null,
    dailyAverageCents: elapsed > 0 ? Math.round(spentCents / elapsed) : 0,
    byCategory,
    topMerchants,
  };
}

/**
 * Monatsbudget. „auto“ = Einnahmen minus Sparpläne des Monats aus den Kontoauszügen; sind im Monat noch keine Einnahmen da,
 * gilt der Vormonat. „fixed“ = der eingetragene Betrag, „off“ = keins.
 * @returns {{cents: number, auto: boolean, month: string, incomeCents?: number, savingCents?: number}|null}
 */
export function budgetFor(transactions, settings, month, currency = 'EUR') {
  if (settings.budgetMode === 'off') return null;
  if (settings.budgetMode === 'fixed') return settings.monthlyBudgetCents ? { cents: settings.monthlyBudgetCents, auto: false, month } : null;
  for (const m of [month, previousMonth(month)]) {
    const inM = transactions.filter((t) => monthOf(t.date) === m);
    const incomeCents = kindTotal(inM, 'income', currency).cents;
    if (incomeCents <= 0) continue;
    const savingCents = kindTotal(inM, 'saving', currency).cents;
    const cents = incomeCents - savingCents;
    return cents > 0 ? { cents, auto: true, month: m, incomeCents, savingCents } : null;
  }
  return null;
}

/**
 * Verlauf eines Monats: aufgelaufene Ausgaben Tag für Tag, dazu der Vormonat zum Vergleich.
 * `current` reicht im laufenden Monat nur bis heute, in künftigen Monaten ist es leer.
 * `previous` ist null, wenn der Vormonat nicht vollständig erfasst ist (sonst irreführend).
 * @returns {{days: number, current: number[], previous: number[]|null, previousDays: number}}
 */
export function monthCurve(transactions, month, today, currency = 'EUR') {
  const cumulate = (m, upTo) => {
    const perDay = new Array(daysInMonth(m)).fill(0);
    for (const t of transactions) {
      if (!counts(t) || monthOf(t.date) !== m) continue;
      const c = baseAmount(t, currency);
      if (c !== null) perDay[Number(t.date.slice(8, 10)) - 1] += c;
    }
    let sum = 0;
    return perDay.slice(0, upTo).map((c) => (sum += c));
  };
  const days = daysInMonth(month);
  const elapsed = monthOf(today) === month ? Number(today.slice(8, 10)) : today < month ? 0 : days;
  const prev = previousMonth(month);
  return {
    days,
    current: cumulate(month, elapsed),
    previous: trackedBefore(transactions, prev) ? cumulate(prev, daysInMonth(prev)) : null,
    previousDays: daysInMonth(prev),
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
 * Soll „künftig alle so einordnen“ vorab angehakt sein? Nur, wenn das Muster eindeutig einen Händler meint:
 * mindestens zwei Zahlungen passen, und alle gehören zum selben Händler (ohne Filialnummern).
 * „hotel“ bei einem einzigen Hotel bleibt aus, damit ein Fehltipp nicht gleich zur Regel wird.
 */
export function ruleDefault(transactions, pattern) {
  const p = String(pattern || '').trim().toLowerCase();
  if (!p) return false;
  const probe = [{ id: 'probe', pattern: p, categoryId: 'sonstiges' }];
  const hits = transactions.filter((t) => categorize(t.merchant, probe) === 'sonstiges');
  return hits.length >= 2 && new Set(hits.map((t) => recurringKey(t.merchant))).size === 1;
}

/**
 * Buchungen nach Tag gruppiert, für die Liste (neueste zuerst).
 * @param {import('./model.js').Transaction[]} transactions
 * @param {{month?: string|null, categoryId?: string|null|undefined, query?: string, merchant?: string|null, currency?: string}} filter
 *   categoryId: undefined = alle, null = ohne Kategorie; categoryIds: mehrere (leer = alle)
 *   kind: Art; sources: Quellen; hideExcluded; sort: 'new' (Standard) | 'old' | 'big' (größter Betrag, ohne Tage)
 * @returns {{date: string|null, totalCents: number, incomeCents: number, foreign: {currency: string, cents: number, count: number}[], items: import('./model.js').Transaction[]}[]}
 *   totalCents = Ausgaben in der Hauptwährung ohne ausgenommene, incomeCents = Einnahmen (positiv);
 *   Fremdwährung ohne Euro-Betrag in `foreign`
 */
export function groupByDay(transactions, filter = {}) {
  const q = (filter.query || '').trim().toLowerCase();
  const cats = filter.categoryIds || (filter.categoryId === undefined ? null : [filter.categoryId]);
  const cur = filter.currency || 'EUR';
  const list = sortTransactions(transactions).filter((t) =>
    (!filter.month || monthOf(t.date) === filter.month)
    && (!filter.kind || kindOf(t) === filter.kind)
    && (!cats || !cats.length || cats.includes(t.categoryId))
    && (!filter.sources || !filter.sources.length || filter.sources.includes(t.source))
    && (!filter.hideExcluded || !t.excluded)
    && (!filter.merchant || t.merchant === filter.merchant)
    && (!q || t.merchant.toLowerCase().includes(q) || t.note.toLowerCase().includes(q)));
  const sort = filter.sort || 'new';
  if (sort === 'old') list.reverse();
  if (sort === 'big') list.sort((a, b) => Math.abs(baseAmount(b, cur) ?? 0) - Math.abs(baseAmount(a, cur) ?? 0));
  const groups = [];
  for (const t of list) {
    let g = groups[groups.length - 1];
    // Nach Betrag sortiert gibt es keine Tage mehr: eine einzige Gruppe ohne Datum.
    const date = sort === 'big' ? null : t.date;
    if (!g || g.date !== date) { g = { date, totalCents: 0, incomeCents: 0, items: [] }; groups.push(g); }
    g.items.push(t);
    if (counts(t)) g.totalCents += baseAmount(t, cur) ?? 0;
    else if (!t.excluded && kindOf(t) === 'income') g.incomeCents += -(baseAmount(t, cur) ?? 0);
  }
  for (const g of groups) g.foreign = foreignOf(g.items.filter(counts), cur);
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
 * Kategorien für die Knöpfe beim Einordnen: nur sichtbare der gewünschten Arten, oft genutzte zuerst, sonst Listenreihenfolge.
 * @param {import('./model.js').Transaction[]} transactions
 * @param {import('./model.js').Category[]} categories
 * @param {string[]} kinds  erlaubte Arten
 * @returns {string[]}
 */
export function categoriesByUse(transactions, categories, kinds) {
  const n = new Map();
  for (const t of transactions) if (t.categoryId) n.set(t.categoryId, (n.get(t.categoryId) || 0) + 1);
  const list = categories.filter((c) => !c.hidden && kinds.includes(c.kind));
  return list.map((c, i) => ({ id: c.id, i })).sort((a, b) => (n.get(b.id) || 0) - (n.get(a.id) || 0) || a.i - b.i).map((c) => c.id);
}

/** Kategorie `from` in `to` aufgehen lassen: Buchungen und Regeln wandern mit. `to` muss dieselbe Art haben (prüft der Aufrufer). */
export function mergeCategory(transactions, rules, from, to) {
  return {
    transactions: transactions.map((t) => (t.categoryId === from ? { ...t, categoryId: to } : t)),
    rules: rules.map((r) => (r.categoryId === from ? { ...r, categoryId: to } : r)),
  };
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

/**
 * Dieselbe Kartenzahlung kann zweimal ankommen: per Kurzbefehl (Apple Pay) und später im Kontoauszug.
 * Gleich heißt: gleicher Betrag, und der Auszug nennt sie höchstens einen Tag früher oder fünf Tage später
 * (Banken buchen oft verzögert). Verglichen wird nur Kurzbefehl mit Auszug, jede vorhandene Buchung deckt
 * höchstens eine neue ab, und bei mehreren Kandidaten gewinnt das nächste Datum.
 * @param {import('./model.js').Transaction[]} existing
 * @param {import('./model.js').Transaction[]} incoming  neue Buchungen, deren ID noch unbekannt ist
 * @returns {Set<string>} IDs aus incoming, die schon erfasst sind
 */
export function findCrossDuplicates(existing, incoming) {
  const other = { statement: 'shortcut', shortcut: 'statement' };
  const taken = new Set();
  const dupes = new Set();
  for (const t of incoming) {
    const want = other[t.source];
    if (!want || kindOf(t) !== 'expense') continue;
    let best = null;
    let bestDist = Infinity;
    for (const e of existing) {
      if (e.source !== want || kindOf(e) !== 'expense' || taken.has(e.id) || e.amountCents !== t.amountCents || e.currency !== t.currency) continue;
      const shortcutDate = want === 'shortcut' ? e.date : t.date;
      const statementDate = want === 'shortcut' ? t.date : e.date;
      const d = daysBetween(shortcutDate, statementDate);
      if (d < -1 || d > 5) continue;
      if (Math.abs(d) < bestDist) { bestDist = Math.abs(d); best = e; }
    }
    if (best) { taken.add(best.id); dupes.add(t.id); }
  }
  return dupes;
}

/**
 * Umbuchungen zwischen eigenen Konten: Auf einem Konto geht Geld raus, auf einem anderen kommt derselbe Betrag
 * höchstens drei Tage später oder früher rein. Gepaart werden nur Buchungen aus Kontoauszügen von verschiedenen Konten
 * (Spalte `card`), je Buchung höchstens ein Partner, das nächste Datum gewinnt. Beide Seiten werden Umbuchungen.
 * Bereits bekannte Buchungen kommen nur als Partner infrage, nicht neu in `incoming`.
 * @param {import('./model.js').Transaction[]} existing
 * @param {import('./model.js').Transaction[]} incoming  neue Buchungen
 * @returns {Set<string>} IDs aus existing und incoming, die Umbuchungen sind
 */
export function findTransfers(existing, incoming) {
  const open = (t) => t.source === 'statement' && !t.excluded && (kindOf(t) === 'expense' || kindOf(t) === 'income');
  const pool = [...existing.filter(open), ...incoming.filter(open)];
  const fresh = new Set(incoming.map((t) => t.id));
  const pairs = [];
  for (const a of pool) {
    if (!fresh.has(a.id)) continue;
    for (const b of pool) {
      if (b.card === a.card || b.currency !== a.currency || b.amountCents !== -a.amountCents) continue;
      const d = Math.abs(daysBetween(a.date, b.date));
      if (d <= 3) pairs.push({ d, a, b });
    }
  }
  const used = new Set();
  const hits = new Set();
  for (const { a, b } of pairs.sort((x, y) => x.d - y.d)) {
    if (used.has(a.id) || used.has(b.id)) continue;
    used.add(a.id); used.add(b.id); hits.add(a.id); hits.add(b.id);
  }
  return hits;
}

/**
 * Ein Kalenderjahr in zwölf Monaten, für den Jahresblick.
 * Der Durchschnitt zählt nur abgeschlossene Monate ab dem ersten mit Daten; der Vorjahresvergleich
 * reicht im laufenden Jahr nur bis zum heutigen Tag und fehlt (null), solange das Vorjahr nicht ab Januar erfasst ist.
 * @param {import('./model.js').Transaction[]} transactions
 * @param {string} year   YYYY
 * @param {string} today  YYYY-MM-DD
 * @returns {{year: string, months: {month: string, cents: number, count: number}[], totalCents: number, incomeCents: number, savingCents: number,
 *   averageCents: number|null, maxCents: number, previousCents: number|null, comparedTo: string|null}}
 */
export function yearSummary(transactions, year, today, currency = 'EUR') {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, cents: 0, count: 0 }));
  const prevYear = String(Number(year) - 1);
  const thisYear = today.slice(0, 4);
  const cutoff = year === thisYear ? today.slice(5) : null;
  // Vorjahresvergleich nur, wenn das Vorjahr ab Januar erfasst ist.
  let previousCents = trackedBefore(transactions, `${prevYear}-01`) ? 0 : null;
  const inYear = transactions.filter((t) => t.date.startsWith(year));
  const incomeCents = kindTotal(inYear, 'income', currency).cents;
  const savingCents = kindTotal(inYear, 'saving', currency).cents;
  for (const t of transactions) {
    const v = counts(t) ? baseAmount(t, currency) : null;
    if (v === null) continue;
    const y = t.date.slice(0, 4);
    if (y === year) {
      const m = months[Number(t.date.slice(5, 7)) - 1];
      m.cents += v;
      m.count += 1;
    } else if (y === prevYear && previousCents !== null) {
      if (!cutoff || t.date.slice(5) <= cutoff) previousCents += v;
    }
  }
  const totalCents = months.reduce((s, m) => s + m.cents, 0);
  const first = months.findIndex((m) => m.count > 0);
  const lastDone = year < thisYear ? 11 : year === thisYear ? Number(today.slice(5, 7)) - 2 : -1;
  const done = first >= 0 && lastDone >= first ? months.slice(first, lastDone + 1) : [];
  return {
    year, months, totalCents, incomeCents, savingCents,
    averageCents: done.length ? Math.round(done.reduce((s, m) => s + m.cents, 0) / done.length) : null,
    maxCents: Math.max(0, ...months.map((m) => m.cents)),
    previousCents,
    comparedTo: cutoff,
  };
}

/**
 * Alles zu einem Händler (genauer Name): Summen für das Jahr von `today` und insgesamt.
 * @returns {{merchant: string, count: number, totalCents: number, yearCount: number, yearCents: number,
 *   averageCents: number, firstDate: string|null, lastDate: string|null}}
 */
export function merchantSummary(transactions, merchant, today, currency = 'EUR') {
  const list = transactions.filter((t) => counts(t) && t.merchant === merchant && baseAmount(t, currency) !== null)
    .map((t) => ({ ...t, amountCents: baseAmount(t, currency) }));
  const year = today.slice(0, 4);
  const inYear = list.filter((t) => t.date.slice(0, 4) === year);
  const totalCents = list.reduce((s, t) => s + t.amountCents, 0);
  const dates = list.map((t) => t.date).sort();
  return {
    merchant,
    count: list.length,
    totalCents,
    yearCount: inYear.length,
    yearCents: inYear.reduce((s, t) => s + t.amountCents, 0),
    averageCents: list.length ? Math.round(totalCents / list.length) : 0,
    firstDate: dates[0] || null,
    lastDate: dates[dates.length - 1] || null,
  };
}

/**
 * Rückblick auf einen Monat: Summe, Vergleich zum Vormonat, größte Kategorie, häufigster Händler, größte Zahlung.
 * @returns {null | {month: string, spentCents: number, count: number, previousCents: number, previousComplete: boolean, categorizedShare: number,
 *   topCategory: {categoryId: string, cents: number}|null, topMerchant: {merchant: string, count: number, cents: number}|null,
 *   largest: {merchant: string, cents: number, date: string}}}
 */
export function monthReview(transactions, month, currency = 'EUR') {
  const inMonth = transactions.filter((t) => counts(t) && monthOf(t.date) === month && baseAmount(t, currency) !== null)
    .map((t) => ({ ...t, amountCents: baseAmount(t, currency) }));
  if (!inMonth.length) return null;
  const prev = previousMonth(month);
  const cat = new Map();
  const mer = new Map();
  for (const t of inMonth) {
    if (t.categoryId) cat.set(t.categoryId, (cat.get(t.categoryId) || 0) + t.amountCents);
    const e = mer.get(t.merchant) || { merchant: t.merchant, count: 0, cents: 0 };
    e.count += 1;
    e.cents += t.amountCents;
    mer.set(t.merchant, e);
  }
  const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const [topCat] = [...cat].sort((a, b) => b[1] - a[1] || CATEGORY_IDS.indexOf(a[0]) - CATEGORY_IDS.indexOf(b[0]));
  const [topMerchant] = [...mer.values()].filter((e) => e.merchant && e.count > 1)
    .sort((a, b) => b.count - a.count || b.cents - a.cents || order(a.merchant, b.merchant));
  const largest = [...inMonth].sort((a, b) => b.amountCents - a.amountCents || order(a.date, b.date))[0];
  const positive = inMonth.reduce((s, t) => s + Math.max(0, t.amountCents), 0);
  const sorted = inMonth.filter((t) => t.categoryId).reduce((s, t) => s + Math.max(0, t.amountCents), 0);
  return {
    month,
    spentCents: inMonth.reduce((s, t) => s + t.amountCents, 0),
    count: inMonth.length,
    previousCents: transactions.filter((t) => counts(t) && monthOf(t.date) === prev)
      .reduce((s, t) => s + (baseAmount(t, currency) ?? 0), 0),
    previousComplete: trackedBefore(transactions, prev),
    categorizedShare: positive > 0 ? sorted / positive : 0,
    topCategory: topCat ? { categoryId: topCat[0], cents: topCat[1] } : null,
    topMerchant: topMerchant || null,
    largest: { merchant: largest.merchant, cents: largest.amountCents, date: largest.date },
  };
}

/** Händlername ohne Ziffern (Filial- und Vorgangsnummern), für das Erkennen wiederkehrender Zahlungen. */
const recurringKey = (merchant) => normalizeMerchant(merchant).replace(/[\d#*]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Erkennt Abos und andere monatlich wiederkehrende Zahlungen: derselbe Händler in mindestens drei
 * aufeinanderfolgenden Monaten, höchstens eine Zahlung pro Monat, die letzten drei Beträge fast gleich
 * (±10 %, mindestens ±1 €). Nur noch laufende (letzte Zahlung höchstens 45 Tage her).
 * @returns {{merchant: string, categoryId: string|null, currency: string, monthlyCents: number, yearlyCents: number, since: string, lastDate: string}[]}
 *   teuerste zuerst
 */
export function detectRecurring(transactions, today) {
  const groups = new Map();
  for (const t of sortTransactions(transactions).reverse()) {
    if (!counts(t) || t.amountCents <= 0) continue;
    const k = recurringKey(t.merchant);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const found = [];
  for (const list of groups.values()) {
    const last = list[list.length - 1];
    if (daysBetween(last.date, today) > 45) continue;
    // Von hinten: Monate mit genau einer Zahlung, lückenlos, ähnlicher Betrag.
    const byMonth = new Map();
    for (const t of list) byMonth.set(monthOf(t.date), [...(byMonth.get(monthOf(t.date)) || []), t]);
    const similar = (a, b) => Math.abs(a - b) <= Math.max(100, Math.round(b * 0.1));
    let month = monthOf(last.date);
    let run = 0;
    let since = month;
    while (byMonth.get(month)?.length === 1 && (run < 3 ? similar(byMonth.get(month)[0].amountCents, last.amountCents) : true)) {
      since = month;
      run += 1;
      month = previousMonth(month);
    }
    if (run < 3) continue;
    found.push({
      merchant: last.merchant, categoryId: last.categoryId, currency: last.currency,
      monthlyCents: last.amountCents, yearlyCents: last.amountCents * 12, since, lastDate: last.date,
    });
  }
  return found.sort((a, b) => b.monthlyCents - a.monthlyCents || (a.merchant < b.merchant ? -1 : 1));
}
