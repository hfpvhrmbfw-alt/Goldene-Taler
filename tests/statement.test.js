import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/statement.js';
import * as L from '../src/logic.js';
import { trPages, ingPages } from './fixtures/statements.js';

const brief = (t) => [t.date, t.merchant, t.amountCents, t.card];

test('detectBank: Trade Republic, ING, sonst nichts', () => {
  assert.equal(S.detectBank(trPages()), 'traderepublic');
  assert.equal(S.detectBank(ingPages()), 'ing');
  assert.equal(S.detectBank([[{ s: 'Sparkasse Musterstadt', x: 0, y: 0 }]]), null);
  assert.deepEqual(S.parseStatement([[{ s: 'Irgendein PDF', x: 0, y: 0 }]]), { ok: false, error: 'unknown' });
});

test('Trade Republic: alle Zeilen mit Art, Richtung aus dem Saldo', () => {
  const r = S.parseStatement(trPages());
  assert.equal(r.ok, true);
  assert.equal(r.bank, 'traderepublic');
  assert.equal(r.errors, 0);
  assert.deepEqual(r.transactions.map((t) => [...brief(t), t.kind]), [
    ['2026-11-01', 'Incoming transfer from Erika Muster (DE00123456781234567890)', -100000, 'Trade Republic', 'income'],
    ['2026-11-02', 'APPLE.COM/BILL', 299, 'Trade Republic', 'expense'],
    ['2026-11-02', 'Savings plan execution IE0000000001 Beispiel Fonds - World ETF Accumulating, quantity: 0.5', 5000, 'Trade Republic', 'saving'],
    ['2026-11-03', 'Bäckerei Krume', 420, 'Trade Republic', 'expense'],
    ['2026-11-03', 'Bäckerei Krume', 420, 'Trade Republic', 'expense'],
    ['2026-11-04', 'Lebensmittel Fröhlich', 101250, 'Trade Republic', 'expense'],
    ['2026-11-05', 'Lebensmittel Fröhlich', -1250, 'Trade Republic', 'expense'],
    ['2026-11-07', 'Stadtwerke Beispielstadt', 1251, 'Trade Republic', 'expense'],
  ]);
  // Zinsen über 0,00 € fallen weg; die Geldmarktfonds-Tabelle darunter wird nicht gelesen.
  assert.equal(r.ignored, 1);
  assert.ok(r.transactions.every((t) => t.source === 'statement' && t.id.startsWith('st-')));
  // Zwei gleiche Einkäufe am selben Tag bleiben zwei Buchungen (der Saldo unterscheidet sie).
  assert.notEqual(r.transactions[3].id, r.transactions[4].id);
});

test('Trade Republic: mehrzeilige Beschreibung bleibt zusammen und in Lesereihenfolge', () => {
  const { rows } = S.parseTradeRepublic(trPages());
  assert.equal(rows[0].merchant, 'Incoming transfer from Erika Muster (DE00123456781234567890)');
  assert.equal(rows[0].cents, -100000);
  assert.equal(rows[2].type, 'Handel');
  assert.match(rows[2].merchant, /^Savings plan .* quantity: 0\.5$/);
});

test('Trade Republic: ohne Anfangssaldo hilft die Spalte des Betrags', () => {
  const pages = trPages().map((p) => p.filter((i) => i.s !== 'ANFANGSSALDO'));
  const r = S.parseStatement(pages);
  assert.equal(r.errors, 0);
  assert.equal(r.transactions.find((t) => t.date === '2026-11-05').amountCents, -1250);
});

test('ING: Lastschriften, Visa, Gehalt und Überweisungen, Kauftag statt Buchungstag, PayPal-Händler', () => {
  const r = S.parseStatement(ingPages());
  assert.equal(r.ok, true);
  assert.equal(r.bank, 'ing');
  assert.equal(r.errors, 0);
  assert.deepEqual(r.transactions.map((t) => [...brief(t), t.kind]), [
    ['2027-01-02', 'Vermieterin Muster', 65000, 'ING', 'expense'],
    ['2026-12-30', 'BAUMARKT BEISPIEL', 1999, 'ING Visa', 'expense'],
    ['2027-01-05', 'Musik Dienst (PayPal)', 999, 'ING', 'expense'],
    ['2027-01-06', 'PayPal', 2500, 'ING', 'expense'],
    ['2027-01-07', 'Arbeitgeber GmbH', -250000, 'ING', 'income'],
    ['2027-01-07', 'BAUMARKT BEISPIEL', -500, 'ING Visa', 'expense'],
    ['2027-01-09', 'Versicherung Beispiel AG', 1234, 'ING', 'expense'],
    ['2027-01-09', 'Erika Muster', 10000, 'ING', 'expense'],
  ]);
  // „Neuer Saldo“ und Kundeninfo sind keine Buchungen.
  assert.equal(r.ignored, 0);
});

test('IDs sind stabil: dieselbe Datei zweimal ergibt dieselben Buchungen', () => {
  const a = S.parseStatement(ingPages()).transactions.map((t) => t.id);
  const b = S.parseStatement(ingPages()).transactions.map((t) => t.id);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});

test('pageLines: gleiche Höhe wird eine Zeile, von links nach rechts', () => {
  const lines = S.pageLines([{ s: 'b', x: 50, y: 100.4 }, { s: 'a', x: 10, y: 100 }, { s: 'c', x: 10, y: 80 }, { s: ' ', x: 0, y: 90 }]);
  assert.deepEqual(lines.map((l) => l.items.map((i) => i.s).join('')), ['ab', 'c']);
});

const tx = (id, source, date, amountCents) => ({ id, source, date, amountCents, currency: 'EUR' });

test('findCrossDuplicates: Apple-Pay-Zeile und Auszug sind dieselbe Zahlung', () => {
  const existing = [tx('sc-1', 'shortcut', '2026-11-02', 420), tx('sc-2', 'shortcut', '2026-11-02', 999), tx('m-1', 'manual', '2026-11-03', 500)];
  const incoming = [
    tx('st-a', 'statement', '2026-11-03', 420), // einen Tag später gebucht → gleich
    tx('st-b', 'statement', '2026-11-03', 420), // zweiter gleicher Betrag: sc-1 ist schon vergeben
    tx('st-c', 'statement', '2026-11-20', 999), // zu weit weg
    tx('st-d', 'statement', '2026-11-03', 500), // von Hand erfasst zählt nicht
  ];
  assert.deepEqual([...L.findCrossDuplicates(existing, incoming)], ['st-a']);
});

test('findCrossDuplicates: auch andersherum, wenn der Auszug zuerst da war', () => {
  const existing = [tx('st-a', 'statement', '2026-11-04', 420)];
  assert.deepEqual([...L.findCrossDuplicates(existing, [tx('sc-1', 'shortcut', '2026-11-02', 420)])], ['sc-1']);
  // Auszug zwei Tage vor der Apple-Pay-Zahlung passt nicht.
  assert.deepEqual([...L.findCrossDuplicates([tx('st-a', 'statement', '2026-10-31', 420)], [tx('sc-1', 'shortcut', '2026-11-02', 420)])], []);
});

const stmt = (id, date, cents, card, kind = cents > 0 ? 'expense' : 'income') => ({
  id, date, time: null, amountCents: cents, currency: 'EUR', baseCents: null, merchant: 'Erika Muster', card,
  categoryId: null, manualCategory: false, note: '', source: 'statement', excluded: false, kind,
});

test('findTransfers: gleicher Betrag raus und rein auf verschiedenen Konten ist eine Umbuchung', () => {
  const ing = stmt('a', '2026-10-31', 100000, 'ING');
  const tr = stmt('b', '2026-11-02', -100000, 'Trade Republic');
  // Neuer Zugang, der Abgang stand schon da: beide Seiten werden gefunden.
  assert.deepEqual([...L.findTransfers([ing], [tr])].sort(), ['a', 'b']);
  // Und umgekehrt.
  assert.deepEqual([...L.findTransfers([tr], [ing])].sort(), ['a', 'b']);
  // Beide neu, wie bei zwei Auszügen in einem Rutsch.
  assert.deepEqual([...L.findTransfers([], [ing, tr])].sort(), ['a', 'b']);
});

test('findTransfers: nicht bei anderem Betrag, mehr als 3 Tagen, gleichem Konto oder anderer Quelle', () => {
  const out = stmt('a', '2026-10-31', 100000, 'ING');
  assert.equal(L.findTransfers([out], [stmt('b', '2026-11-02', -100100, 'Trade Republic')]).size, 0);
  assert.equal(L.findTransfers([out], [stmt('b', '2026-11-04', -100000, 'Trade Republic')]).size, 0);
  assert.equal(L.findTransfers([out], [stmt('b', '2026-11-01', -100000, 'ING')]).size, 0);
  assert.equal(L.findTransfers([out], [{ ...stmt('b', '2026-11-01', -100000, 'Trade Republic'), source: 'manual' }]).size, 0);
});

test('findTransfers: jede Buchung hat höchstens einen Partner, das nächste Datum gewinnt', () => {
  const out = stmt('a', '2026-11-01', 5000, 'ING');
  const near = stmt('n', '2026-11-02', -5000, 'Trade Republic');
  const far = stmt('f', '2026-11-04', -5000, 'Trade Republic');
  assert.deepEqual([...L.findTransfers([out], [far, near])].sort(), ['a', 'n']);
});
