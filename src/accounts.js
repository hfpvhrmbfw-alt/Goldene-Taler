// Konten: welches Konto zu einer Buchung gehört, Kontostände, Vermögen, Geldfluss. Reine Logik, keine Uhr, kein DOM.
import { kindOf, baseAmount, monthOf, previousMonth, detectRecurring, wordIn } from './logic.js';

/** @typedef {import('./model.js').Account} Account */
/** @typedef {import('./model.js').Transaction} Transaction */

/** Konto, dessen Erkennungswort im Text steht. Das längste Wort gewinnt („ING Visa“ vor „ING“), bei Gleichstand das erste Konto. */
function matchIn(text, accounts, exceptId = null) {
  let best = null;
  let len = 0;
  for (const a of accounts) {
    if (a.id === exceptId) continue;
    for (const m of a.match) if (m.length > len && wordIn(text, m)) { best = a; len = m.length; }
  }
  return best;
}

/** Konto einer Buchung: von Hand gewählt, sonst am Kartennamen erkannt („ING Visa“ → Konto mit „ING“). Depots haben keine Karte. */
export function accountFor(t, accounts) {
  if (t.accountId) {
    const a = accounts.find((x) => x.id === t.accountId);
    if (a) return a;
  }
  return t.card ? matchIn(t.card, accounts.filter((a) => a.type !== 'depot')) : null;
}

/**
 * Gegenkonto einer Umbuchung oder eines Sparplans: von Hand gewählt, sonst am Namen im Händler bzw. Verwendungszweck erkannt.
 * Ein Sparplan ohne erkanntes Ziel geht ins Depot derselben Bank (bei Trade Republic: Konto mit Karte → Depot).
 * @returns {Account|null}
 */
export function counterFor(t, accounts) {
  const k = kindOf(t);
  if (k !== 'transfer' && k !== 'saving') return null;
  if (t.toAccountId) {
    const a = accounts.find((x) => x.id === t.toAccountId);
    if (a) return a;
  }
  const own = accountFor(t, accounts);
  const hit = matchIn(t.merchant, accounts, own?.id);
  if (hit) return hit;
  if (k === 'saving' && own) return accounts.find((a) => a.type === 'depot' && a.bank === own.bank && !a.other) || null;
  return null;
}

/** Alle Namen, an denen Taler eigene Konten erkennt: die Erkennungswörter der Konten und die weiteren Namen aus den Einstellungen. */
export const ownNames = (settings, accounts) => [...new Set([...settings.ownAccounts, ...accounts.flatMap((a) => a.match)])];

/**
 * Stand eines Kontos heute: letzter bekannter Stand plus alles, was danach passiert ist.
 * Hat das Konto eigene Buchungen (Auszug, Apple Pay), zählen die; sonst die erkannten Umbuchungen dorthin (dann „geschätzt“).
 * Beispieldaten zählen nie, „nicht mitzählen“ schon (das Geld ist trotzdem geflossen).
 * @returns {{cents: number, date: string, source: 'manual'|'statement', since: number, estimated: boolean}|null}
 */
export function balanceOf(a, transactions, accounts, currency = 'EUR') {
  if (!a.balance) return null;
  const real = transactions.filter((t) => t.source !== 'demo');
  const own = real.filter((t) => accountFor(t, accounts)?.id === a.id);
  let cents = a.balance.cents;
  let since = 0;
  const after = (t) => t.date > a.balance.date;
  if (own.length) {
    for (const t of own.filter(after)) {
      const v = baseAmount(t, currency);
      if (v === null) continue;
      cents -= v;
      since += 1;
    }
  } else {
    for (const t of real.filter(after)) {
      if (counterFor(t, accounts)?.id !== a.id || accountFor(t, accounts)?.id === a.id) continue;
      const v = baseAmount(t, currency);
      if (v === null) continue;
      cents += v;
      since += 1;
    }
  }
  return { cents, date: a.balance.date, source: a.balance.source, since, estimated: !own.length && since > 0 };
}

/** Zinsen im Monat, grob: Stand × Zinssatz / 12. */
export const monthlyInterest = (cents, rateBp) => (rateBp ? Math.round(cents * rateBp / 10000 / 12) : 0);

/**
 * Vermögen: Summe aller eigenen Konten mit Stand, nach Art und nach Bank. Konten für jemand anderen stehen dabei, zählen aber nicht.
 * @returns {{totalCents: number, byType: {konto: number, tagesgeld: number, depot: number}, otherCents: number, missing: number,
 *   banks: {bank: string, cents: number, items: {account: Account, balance: ReturnType<typeof balanceOf>}[]}[]}}
 */
export function wealth(accounts, transactions, currency = 'EUR') {
  const byType = { konto: 0, tagesgeld: 0, depot: 0 };
  let totalCents = 0;
  let otherCents = 0;
  let missing = 0;
  const banks = [];
  for (const a of accounts) {
    const balance = balanceOf(a, transactions, accounts, currency);
    let g = banks.find((b) => b.bank === a.bank);
    if (!g) { g = { bank: a.bank, cents: 0, items: [] }; banks.push(g); }
    g.items.push({ account: a, balance });
    if (!balance) { missing += 1; continue; }
    if (a.other) { otherCents += balance.cents; continue; }
    g.cents += balance.cents;
    byType[a.type] += balance.cents;
    totalCents += balance.cents;
  }
  return { totalCents, byType, otherCents, missing, banks };
}

/**
 * Geldfluss eines Monats zwischen den Konten: Einnahmen auf ein Konto, Ausgaben von einem Konto, Umbuchungen und Sparpläne von Konto zu Konto.
 * Umbuchungen zählen nur mit dem ausgehenden Teil (sonst stünden sie doppelt da). Buchungen ohne erkanntes Konto fehlen hier.
 * @returns {{kind: 'income'|'expense'|'transfer'|'saving', from: Account|null, to: Account|null, cents: number, count: number}[]}
 */
export function monthFlows(transactions, accounts, month, currency = 'EUR') {
  const map = new Map();
  const add = (key, row, v) => {
    const r = map.get(key) || { ...row, cents: 0, count: 0 };
    r.cents += v;
    r.count += 1;
    map.set(key, r);
  };
  for (const t of transactions) {
    if (t.source === 'demo' || monthOf(t.date) !== month) continue;
    const a = accountFor(t, accounts);
    const v = baseAmount(t, currency);
    if (!a || v === null) continue;
    const k = kindOf(t);
    if (k === 'income' && !t.excluded) add(`in|${a.id}`, { kind: 'income', from: null, to: a }, -v);
    else if (k === 'expense' && !t.excluded) add(`out|${a.id}`, { kind: 'expense', from: a, to: null }, v);
    else if ((k === 'transfer' || k === 'saving') && v > 0) {
      const to = counterFor(t, accounts);
      add(`${k}|${a.id}|${to?.id ?? ''}`, { kind: k, from: a, to }, v);
    }
  }
  const order = { income: 0, expense: 1, transfer: 2, saving: 2 };
  return [...map.values()].sort((x, y) => order[x.kind] - order[y.kind] || y.cents - x.cents);
}

/** Wiederkehrende Ausgaben (Fixkosten) eines Kontos, wie „jeden Monat“ in der Übersicht. */
export function fixedCosts(a, transactions, accounts, today) {
  return detectRecurring(transactions.filter((t) => t.source !== 'demo' && accountFor(t, accounts)?.id === a.id), today);
}

/**
 * „Frei für den Monat“ auf einem Eingangskonto: Eingang minus Fixkosten minus das, was an eigene Konten weitergeht.
 * Bis im laufenden Monat Geld eingegangen ist, gilt der Vormonat.
 * @returns {{month: string, inCents: number, fixedCents: number, onwardCents: number, freeCents: number,
 *   onward: {to: Account|null, cents: number, count: number}[]}}
 */
export function freeForMonth(a, transactions, accounts, month, today, currency = 'EUR') {
  const flowsOf = (m) => monthFlows(transactions, accounts, m, currency);
  let m = month;
  let flows = flowsOf(m);
  const inOf = (list) => list.filter((f) => f.kind === 'income' && f.to.id === a.id).reduce((s, f) => s + f.cents, 0);
  if (!inOf(flows)) {
    const prev = flowsOf(previousMonth(month));
    if (inOf(prev)) { m = previousMonth(month); flows = prev; }
  }
  const onward = flows.filter((f) => (f.kind === 'transfer' || f.kind === 'saving') && f.from.id === a.id)
    .map((f) => ({ to: f.to, cents: f.cents, count: f.count }));
  const inCents = inOf(flows);
  const fixedCents = fixedCosts(a, transactions, accounts, today).filter((r) => r.currency === currency).reduce((s, r) => s + r.monthlyCents, 0);
  const onwardCents = onward.reduce((s, f) => s + f.cents, 0);
  return { month: m, inCents, fixedCents, onwardCents, freeCents: inCents - fixedCents - onwardCents, onward };
}

/**
 * Konto zu einem eingelesenen Kontoauszug: das Konto, das die Karte der Buchungen erkennt („ING“, „Trade Republic“).
 * @param {Account[]} accounts
 * @param {string} card  Kartenname aus dem Auszug
 */
export const statementAccount = (accounts, card) => matchIn(card, accounts.filter((a) => a.type !== 'depot'));

/**
 * Neuer Stand aus einem Auszug, wenn er nicht älter ist als der bekannte (ein alter Auszug überschreibt nichts).
 * @returns {Account}
 */
export function withStatementBalance(a, closing) {
  if (!closing || (a.balance && a.balance.date > closing.date)) return a;
  return { ...a, balance: { cents: closing.cents, date: closing.date, source: 'statement' } };
}

/**
 * Übernahme der bisherigen Liste „eigene Konten“: bekannte Banken werden zu Konten, der Rest (eigener Name, IBAN, Tagesgeld)
 * bleibt als weitere Namen in den Einstellungen.
 * @param {string[]} ownAccounts
 * @param {(i: number) => string} newId
 * @returns {{accounts: Account[], ownAccounts: string[]}}
 */
export function migrateOwnAccounts(ownAccounts, newId) {
  const known = { ing: ['ING', 'Girokonto'], 'trade republic': ['Trade Republic', 'Konto mit Karte'] };
  const accounts = [];
  const rest = [];
  for (const name of ownAccounts) {
    const k = known[name.trim().toLowerCase()];
    if (!k) { rest.push(name); continue; }
    accounts.push({ id: newId(accounts.length), bank: k[0], name: k[1], type: 'konto', main: k[0] === 'ING', other: false, rateBp: null, match: [name.trim()], balance: null });
  }
  // Das Eingangskonto zuerst: Banken erscheinen in der Reihenfolge ihrer Konten.
  return { accounts: accounts.sort((x, y) => Number(y.main) - Number(x.main)), ownAccounts: rest };
}
