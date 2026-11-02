import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../src/accounts.js';
import { sanitizeAccount, sanitizeTransaction, parseImport, buildExport } from '../src/model.js';

// Erfundene Konten und Beträge, angelehnt an einen Aufbau mit Girokonto, Tagesgeld und Depots bei drei Banken.
const acc = (id, bank, name, type, extra = {}) => sanitizeAccount({ id, bank, name, type, ...extra });
const ACCOUNTS = [
  acc('giro', 'ING', 'Girokonto', 'konto', { main: true, match: ['ING'], balance: { cents: 200000, date: '2026-10-31', source: 'statement' } }),
  acc('kind', 'ING', 'Kinderdepot', 'depot', { other: true, balance: { cents: 300000, date: '2026-10-31', source: 'manual' } }),
  acc('tr', 'Trade Republic', 'Konto mit Karte', 'konto', { match: ['Trade Republic'], rateBp: 250, balance: { cents: 480000, date: '2026-10-31', source: 'statement' } }),
  acc('trd', 'Trade Republic', 'Depot', 'depot', { balance: { cents: 900000, date: '2026-10-31', source: 'manual' } }),
  acc('sc', 'Scalable Capital', 'Tagesgeld', 'tagesgeld', { match: ['Scalable'], balance: { cents: 500000, date: '2026-10-15', source: 'manual' } }),
  acc('scd', 'Scalable Capital', 'Depot', 'depot'),
];
let n = 0;
const tx = (date, merchant, amountCents, card, kind = 'expense', extra = {}) =>
  sanitizeTransaction({ id: `t${++n}`, date, merchant, amountCents, card, kind, source: 'statement', ...extra });

const DATA = [
  tx('2026-11-01', 'Arbeitgeber GmbH', -320000, 'ING', 'income'),
  tx('2026-11-01', 'Vermieterin', 85000, 'ING'),
  tx('2026-11-01', 'Trade Republic Bank GmbH', 50000, 'ING', 'transfer'),
  tx('2026-11-02', 'Anna Beispiel', -50000, 'Trade Republic', 'transfer'),
  tx('2026-11-02', 'Scalable Capital GmbH', 30000, 'ING', 'transfer'),
  tx('2026-11-02', 'Savings plan execution IE0000000001', 20000, 'Trade Republic', 'saving'),
  tx('2026-11-03', 'Bäckerei', 450, 'ING Visa'),
  tx('2026-10-10', 'Scalable Capital GmbH', 99900, 'ING', 'transfer'),
  tx('2026-11-04', 'Kiosk', 300, 'Visa', 'expense', { source: 'demo' }),
];

test('accountFor: Karte erkennt das Konto, längstes Wort gewinnt, von Hand gewählt geht vor', () => {
  assert.equal(A.accountFor(DATA[6], ACCOUNTS).id, 'giro');
  assert.equal(A.accountFor(DATA[3], ACCOUNTS).id, 'tr');
  assert.equal(A.accountFor({ ...DATA[6], accountId: 'tr' }, ACCOUNTS).id, 'tr');
  assert.equal(A.accountFor({ ...DATA[6], accountId: 'weg' }, ACCOUNTS).id, 'giro');
  assert.equal(A.accountFor(DATA[8], ACCOUNTS), null);
});

test('counterFor: Name im Händler, Sparplan ins Depot derselben Bank, nur bei Umbuchung und Sparen', () => {
  assert.equal(A.counterFor(DATA[2], ACCOUNTS).id, 'tr');
  assert.equal(A.counterFor(DATA[4], ACCOUNTS).id, 'sc');
  assert.equal(A.counterFor(DATA[5], ACCOUNTS).id, 'trd');
  assert.equal(A.counterFor(DATA[3], ACCOUNTS), null);
  assert.equal(A.counterFor(DATA[1], ACCOUNTS), null);
  assert.equal(A.counterFor({ ...DATA[4], toAccountId: 'scd' }, ACCOUNTS).id, 'scd');
});

test('balanceOf: Auszugsstand plus eigene Buchungen danach; ohne eigene Buchungen geschätzt aus Umbuchungen', () => {
  const giro = A.balanceOf(ACCOUNTS[0], DATA, ACCOUNTS);
  // 2.000 + 3.200 − 850 − 500 − 300 − 4,50 (Bäckerei per ING Visa); Beispieldaten zählen nicht.
  assert.equal(giro.cents, 200000 + 320000 - 85000 - 50000 - 30000 - 450);
  assert.equal(giro.since, 5);
  assert.equal(giro.estimated, false);
  const tr = A.balanceOf(ACCOUNTS[2], DATA, ACCOUNTS);
  assert.equal(tr.cents, 480000 + 50000 - 20000);
  const sc = A.balanceOf(ACCOUNTS[4], DATA, ACCOUNTS);
  // Stand 15.10. plus die Umbuchung vom 2.11.; die vom 10.10. steckt schon im Stand.
  assert.deepEqual([sc.cents, sc.estimated], [530000, true]);
  assert.equal(A.balanceOf(ACCOUNTS[5], DATA, ACCOUNTS), null);
});

test('wealth: eigenes Vermögen nach Art und Bank, Kinderdepot getrennt, Konten ohne Stand gezählt', () => {
  const w = A.wealth(ACCOUNTS, DATA);
  assert.equal(w.otherCents, 300000);
  assert.equal(w.missing, 1);
  // Depot: Stand von Hand plus der Sparplan danach.
  assert.equal(w.byType.depot, 920000);
  assert.equal(w.byType.tagesgeld, 530000);
  assert.equal(w.totalCents, w.byType.konto + w.byType.tagesgeld + w.byType.depot);
  assert.deepEqual(w.banks.map((b) => b.bank), ['ING', 'Trade Republic', 'Scalable Capital']);
});

test('monthFlows: Einnahmen, Ausgaben, Umbuchungen nur ausgehend', () => {
  const f = A.monthFlows(DATA, ACCOUNTS, '2026-11');
  const brief = f.map((x) => [x.kind, x.from?.id ?? null, x.to?.id ?? null, x.cents]);
  assert.deepEqual(brief, [
    ['income', null, 'giro', 320000],
    ['expense', 'giro', null, 85450],
    ['transfer', 'giro', 'tr', 50000],
    ['transfer', 'giro', 'sc', 30000],
    ['saving', 'tr', 'trd', 20000],
  ]);
});

test('freeForMonth: Eingang minus Fixkosten minus Weiterleitungen, vor dem Gehalt der Vormonat', () => {
  const rent = ['08', '09', '10'].map((m) => tx(`2026-${m}-01`, 'Vermieterin', 85000, 'ING'));
  const all = [...DATA, ...rent];
  const f = A.freeForMonth(ACCOUNTS[0], all, ACCOUNTS, '2026-11', '2026-11-05');
  assert.deepEqual([f.month, f.inCents, f.fixedCents, f.onwardCents, f.freeCents], ['2026-11', 320000, 85000, 80000, 155000]);
  const early = A.freeForMonth(ACCOUNTS[0], all, ACCOUNTS, '2026-12', '2026-12-01');
  assert.equal(early.month, '2026-11');
});

test('withStatementBalance: neuer Auszug setzt den Stand, ein älterer nicht', () => {
  const a = ACCOUNTS[0];
  assert.deepEqual(A.withStatementBalance(a, { cents: 1, date: '2026-11-30' }).balance, { cents: 1, date: '2026-11-30', source: 'statement' });
  assert.equal(A.withStatementBalance(a, { cents: 1, date: '2026-09-30' }), a);
  assert.equal(A.withStatementBalance(a, null), a);
});

test('migrateOwnAccounts: ING und Trade Republic werden Konten, der Rest bleibt', () => {
  const m = A.migrateOwnAccounts(['Trade Republic', 'ING', 'Anna Beispiel'], (i) => `a${i}`);
  assert.deepEqual(m.ownAccounts, ['Anna Beispiel']);
  assert.deepEqual(m.accounts.map((a) => [a.id, a.bank, a.name, a.main, a.match]), [
    ['a1', 'ING', 'Girokonto', true, ['ING']],
    ['a0', 'Trade Republic', 'Konto mit Karte', false, ['Trade Republic']],
  ]);
  assert.deepEqual(A.ownNames({ ownAccounts: ['Anna Beispiel'] }, ACCOUNTS), ['Anna Beispiel', 'ING', 'Trade Republic', 'Scalable']);
});

test('Sicherung: Konten und Kontozuordnung kommen mit', () => {
  const state = { transactions: [{ ...DATA[4], toAccountId: 'scd' }], rules: [], settings: {}, deletedIds: [], categories: [], accounts: ACCOUNTS };
  const r = parseImport(JSON.stringify(buildExport(state, '2026-11-02T10:00:00Z')));
  assert.equal(r.ok, true);
  assert.deepEqual(r.accounts, ACCOUNTS);
  assert.equal(r.transactions[0].toAccountId, 'scd');
  assert.equal(sanitizeAccount({ id: 'x', name: 'Y', rateBp: -1, type: 'bargeld' }).type, 'konto');
});
