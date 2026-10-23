import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../src/logic.js';
import * as M from '../src/model.js';
import { DEFAULT_RULES } from '../src/catalog.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

test('parseAmount: Fixtures', () => {
  for (const c of JSON.parse(fx('amounts.json'))) {
    const r = L.parseAmount(c.in);
    if ('result' in c) assert.equal(r, c.result, c.in);
    else assert.deepEqual(r, { cents: c.cents, currency: c.currency }, c.in);
  }
});

test('parseDateTime: ISO und deutsch, ohne Zeitzonen-Umrechnung', () => {
  assert.deepEqual(L.parseDateTime('2026-10-20T23:59:00-10:00'), { date: '2026-10-20', time: '23:59' });
  assert.deepEqual(L.parseDateTime('2026-10-20'), { date: '2026-10-20', time: null });
  assert.deepEqual(L.parseDateTime('5.3.2026, 9:05'), { date: '2026-03-05', time: '09:05' });
  assert.equal(L.parseDateTime('gestern'), null);
});

test('parseLog: Zeilen, Fehler, doppelte Zeilen, Semikolon im Händler', () => {
  const { transactions, errors, ignored } = L.parseLog(fx('log.txt'));
  assert.equal(transactions.length, 6);
  assert.deepEqual(errors, [{ line: 5, error: 'fields' }]);
  // Zeilen ohne Betrag (Bordkarten u. Ä.) sind kein Fehler, sie werden nur gezählt.
  assert.deepEqual(ignored, [6]);
  const rewe = transactions.filter((t) => t.merchant.startsWith('REWE'));
  assert.equal(rewe.length, 2);
  assert.notEqual(rewe[0].id, rewe[1].id);
  assert.equal(rewe[1].id, `${rewe[0].id}-1`);
  const shop = transactions.find((t) => t.merchant.startsWith('Shop'));
  assert.equal(shop.merchant, 'Shop;mit Semikolon');
  assert.equal(shop.card, 'Visa');
  const mvg = transactions.find((t) => t.merchant === 'MVG Automat');
  assert.deepEqual([mvg.date, mvg.time, mvg.amountCents], ['2026-10-20', '07:30', 210]);
});

test('parseLog: gleiche Datei ergibt gleiche IDs (stabil)', () => {
  const a = L.parseLog(fx('log.txt')).transactions.map((t) => t.id);
  const b = L.parseLog(fx('log.txt')).transactions.map((t) => t.id);
  assert.deepEqual(a, b);
  assert.equal(L.hashString('abc'), '1a47e90b');
});

test('mergeTransactions: kein Doppel, Änderungen bleiben, Gelöschte kommen nicht zurück', () => {
  const first = L.parseLog(fx('log.txt')).transactions;
  const edited = first.map((t, i) => (i === 0 ? { ...t, note: 'Frühstück' } : t));
  const deleted = [first[1].id];
  const kept = edited.filter((t) => t.id !== first[1].id);
  const r = L.mergeTransactions(kept, L.parseLog(fx('log.txt')).transactions, deleted);
  assert.equal(r.added.length, 0);
  assert.equal(r.transactions.length, 5);
  assert.equal(r.transactions.find((t) => t.id === first[0].id).note, 'Frühstück');
});

test('categorize: Wortanfang, Reihenfolge nach Genauigkeit', () => {
  const rules = L.orderRules(DEFAULT_RULES);
  assert.equal(L.categorize('REWE Markt GmbH 1234', rules), 'lebensmittel');
  assert.equal(L.categorize('OBI Markt Bonn', rules), 'haushalt');
  assert.equal(L.categorize('Mobilcom Debitel', rules), null);
  assert.equal(L.categorize('JET Tankstelle', rules), 'mobilitaet');
  assert.equal(L.categorize('Jetbrains', rules), null);
  assert.equal(L.categorize('APPLE.COM/BILL', rules), 'abos');
  const { rules: r2 } = L.upsertRule(rules, 'REWE to go', 'essen', 'u-1');
  assert.equal(L.categorize('REWE To Go Bahnhof', r2), 'essen');
  assert.equal(L.categorize('REWE City', r2), 'lebensmittel');
  const { rules: r3, rule } = L.upsertRule(r2, 'rewe', 'haushalt', 'u-2');
  assert.equal(rule.id, DEFAULT_RULES.find((x) => x.pattern === 'rewe').id);
  assert.equal(r3.length, r2.length);
});

test('applyRules lässt von Hand gesetzte Kategorien in Ruhe', () => {
  const t = L.parseLog(fx('log.txt')).transactions;
  t[1] = { ...t[1], categoryId: 'freizeit', manualCategory: true };
  const out = L.applyRules(t, L.orderRules(DEFAULT_RULES));
  assert.equal(out[1].categoryId, 'freizeit');
  assert.equal(out[0].categoryId, 'essen');
});

test('monthSummary', () => {
  const t = L.applyRules(L.parseLog(fx('log.txt')).transactions, L.orderRules(DEFAULT_RULES));
  t.push({ ...M.emptyTransaction('m-1', '2026-09-30'), amountCents: 1000 });
  const s = L.monthSummary(t, '2026-10', '2026-10-20', 20000);
  assert.equal(s.count, 6);
  assert.equal(s.spentCents, 345 + 4217 * 2 + 1290 + 210 + 999);
  assert.equal(s.previousCents, 1000);
  assert.equal(s.budgetLeftCents, 20000 - s.spentCents);
  assert.equal(s.dailyAverageCents, Math.round(s.spentCents / 20));
  assert.equal(s.byCategory[0].categoryId, 'lebensmittel');
  assert.ok(Math.abs(s.byCategory.reduce((a, e) => a + e.share, 0) - 1) < 1e-6);
  assert.equal(s.topMerchants[0].merchant, 'REWE Markt GmbH 1234');
  const past = L.monthSummary(t, '2026-09', '2026-10-20', null);
  assert.equal(past.dailyAverageCents, Math.round(1000 / 30));
  assert.equal(past.budgetLeftCents, null);
  assert.equal(past.comparedToDay, null);
  assert.equal(past.monthProgress, 1);
});

test('monthSummary: Vormonat bis zum gleichen Tag, Fremdwährung', () => {
  const tx = (id, date, amountCents, currency = 'EUR') => ({ ...M.emptyTransaction(id, date), amountCents, currency });
  const t = [tx('a', '2026-09-05', 1000), tx('b', '2026-09-25', 5000), tx('c', '2026-10-03', 2000), tx('d', '2026-10-04', 900, 'USD')];
  const s = L.monthSummary(t, '2026-10', '2026-10-20', null, 'EUR');
  assert.equal(s.comparedToDay, 20);
  assert.equal(s.previousToDateCents, 1000);
  assert.equal(s.previousCents, 6000);
  assert.ok(Math.abs(s.monthProgress - 20 / 31) < 1e-9);
  assert.deepEqual(s.foreign, [{ currency: 'USD', cents: 900, count: 1 }]);
  assert.equal(L.monthSummary(t, '2026-09', '2026-10-20').previousToDateCents, 0);
});

test('categoriesByUse und editRule', () => {
  const t = [{ categoryId: 'reisen' }, { categoryId: 'reisen' }, { categoryId: 'abos' }, { categoryId: null }];
  const order = L.categoriesByUse(t);
  assert.deepEqual(order.slice(0, 3), ['reisen', 'abos', 'lebensmittel']);
  assert.equal(order.length, M.CATEGORY_IDS.length);
  const rules = [{ id: 'u-1', pattern: 'rewe', categoryId: 'lebensmittel' }, { id: 'u-2', pattern: 'rewe to go', categoryId: 'essen' }];
  const r = L.editRule(rules, 'u-2', 'REWE', 'essen');
  assert.deepEqual(r, [{ id: 'u-2', pattern: 'rewe', categoryId: 'essen' }]);
});

test('Beispieldaten haben eine eigene Quelle', () => {
  const t = M.sanitizeTransaction({ ...M.emptyTransaction('demo-1', '2026-10-01'), source: 'demo' });
  assert.equal(t.source, 'demo');
});

test('Kalender: Monate, Vormonat, Tage', () => {
  assert.equal(L.previousMonth('2026-01'), '2025-12');
  assert.equal(L.daysInMonth('2028-02'), 29);
  assert.equal(L.daysInMonth('2100-02'), 28);
  assert.equal(L.daysInMonth('2026-04'), 30);
  assert.deepEqual(L.monthsWithData([], '2026-10'), ['2026-10']);
  assert.equal(L.daysBetween('2026-10-20', '2026-10-22'), 2);
  assert.equal(L.daysBetween('2026-02-27', '2026-03-01'), 2);
  assert.equal(L.daysBetween('2026-03-28', '2026-03-30'), 2);
});

test('suggestPattern', () => {
  assert.equal(L.suggestPattern('REWE Markt GmbH 1234'), 'rewe');
  assert.equal(L.suggestPattern('1234 Bäckerei Schmidt'), 'bäckerei');
  assert.equal(L.suggestPattern('DM-Drogerie Markt'), 'dm-drogerie');
});

test('groupByDay mit Filtern', () => {
  const t = L.parseLog(fx('log.txt')).transactions;
  const g = L.groupByDay(t, { month: '2026-10', query: 'rewe' });
  assert.equal(g.length, 1);
  assert.equal(g[0].totalCents, 8434);
  assert.equal(L.groupByDay(t, { categoryId: null }).reduce((a, x) => a + x.items.length, 0), 6);
  assert.equal(L.groupByDay(t, { merchant: 'MVG Automat' })[0].items.length, 1);
});

test('Katalog: IDs eindeutig, Kategorien gültig', () => {
  const ids = new Set(DEFAULT_RULES.map((r) => r.id));
  assert.equal(ids.size, DEFAULT_RULES.length);
  for (const r of DEFAULT_RULES) assert.ok(M.sanitizeRule(r), r.pattern);
});

test('Export/Import: Rundweg, neuere Version abgelehnt, kaputte Einträge übersprungen', () => {
  const tx = L.parseLog(fx('log.txt')).transactions;
  const state = { transactions: tx, rules: DEFAULT_RULES, settings: M.sanitizeSettings({ monthlyBudgetCents: 50000 }), deletedIds: ['x'] };
  const json = JSON.stringify(M.buildExport(state, '2026-10-20T12:00:00Z'));
  const r = M.parseImport(json);
  assert.equal(r.ok, true);
  assert.deepEqual(r.transactions, tx);
  assert.equal(r.settings.monthlyBudgetCents, 50000);
  assert.deepEqual(r.deletedIds, ['x']);
  assert.deepEqual(M.parseImport('{'), { ok: false, error: 'json' });
  assert.deepEqual(M.parseImport('{"app":"x"}'), { ok: false, error: 'app' });
  assert.deepEqual(M.parseImport('{"app":"taler","version":99,"transactions":[]}'), { ok: false, error: 'newer' });
  const bad = M.parseImport('{"app":"taler","transactions":[{"id":"a","date":"2026-1-1","amountCents":1},{"id":"b","date":"2026-01-01","amountCents":1}]}');
  assert.equal(bad.ok, true);
  assert.equal(bad.skipped, 1);
  assert.deepEqual(M.upgradeRaw(M.upgradeRaw({ app: 'taler' })), M.upgradeRaw({ app: 'taler' }));
});

test('parseLogLine: Betrag in anderem Feld oder im Text', () => {
  const d = '2026-10-20T18:55:41+02:00';
  const pick = (r) => [r.amountCents, r.merchant, r.card];
  assert.deepEqual(pick(L.parseLogLine(`${d};REWE Markt;42,17 €;Visa`)), [4217, 'REWE Markt', 'Visa']);
  assert.deepEqual(pick(L.parseLogLine(`${d};REWE;Zahlung über 42,17 € mit Visa;Apple Card`)), [4217, 'REWE', 'Apple Card']);
  assert.deepEqual(pick(L.parseLogLine(`${d};1.234,56 €;IKEA;Visa`)), [123456, 'IKEA', 'Visa']);
  // Filialnummern sind kein Betrag.
  assert.deepEqual(L.parseLogLine(`${d};REWE Markt 1234;Visa`), { ok: false, error: 'amount' });
});

test('parseLogLine: Wallet-Mitteilung (Titel ; Untertitel ; Text)', () => {
  const d = '2026-10-22T15:50:00+02:00';
  const pick = (r) => [r.amountCents, r.merchant, r.card];
  assert.deepEqual(pick(L.parseLogLine(`${d};REWE Markt;;42,17 € mit Visa`)), [4217, 'REWE Markt', 'Visa']);
  assert.deepEqual(pick(L.parseLogLine(`${d};Bäckerei Schmidt;Apple Card;3,45 €`)), [345, 'Bäckerei Schmidt', 'Apple Card']);
  // Wallet-Mitteilungen ohne Betrag (z. B. Bordkarte) werden übersprungen.
  assert.deepEqual(L.parseLogLine(`${d};Lufthansa;Boarding beginnt;Gate B12`), { ok: false, error: 'amount' });
});

test('parseLog: Mitteilungstext über zwei Zeilen (echte Datei vom iPhone)', () => {
  const { transactions, errors, ignored } = L.parseLog(fx('wallet-mehrzeilig.txt'));
  assert.equal(transactions.length, 1);
  const t = transactions[0];
  assert.deepEqual([t.date, t.time, t.amountCents, t.merchant, t.card],
    ['2026-10-23', '13:41', 362, 'Fleischmarkt Becker', 'Trade Republic']);
  assert.deepEqual(errors, []);
  assert.deepEqual(ignored, [1, 2]);
  assert.equal(L.parseLog(fx('wallet-mehrzeilig.txt')).transactions[0].id, t.id);
});
