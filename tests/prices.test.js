import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchUrl, pickQuote, isinsToFetch, applyQuotes, failureKind } from '../src/prices.js';

// Erfundene Suchtreffer im Format der EODHD-Suche.
const hits = [
  { Code: 'XMPL', Exchange: 'LSE', Currency: 'USD', ISIN: 'IE00TEST0001', previousClose: 110.5, previousCloseDate: '2026-10-30', isPrimary: true },
  { Code: 'XMPL', Exchange: 'F', Currency: 'EUR', ISIN: 'IE00TEST0001', previousClose: 100.9, previousCloseDate: '2026-10-30', isPrimary: false },
  { Code: 'XMPL', Exchange: 'XETRA', Currency: 'EUR', ISIN: 'IE00TEST0001', previousClose: 101.234, previousCloseDate: '2026-10-30', isPrimary: false },
  { Code: 'OTHR', Exchange: 'XETRA', Currency: 'EUR', ISIN: 'DE000TEST002', previousClose: 50, previousCloseDate: '2026-10-30' },
];

test('searchUrl: ISIN im Pfad, Schlüssel codiert', () => {
  assert.equal(searchUrl('IE00TEST0001', 'ab c'), 'https://eodhd.com/api/search/IE00TEST0001?api_token=ab%20c&fmt=json&limit=50');
});

test('pickQuote: Xetra in Euro vor Frankfurt und fremder Währung', () => {
  assert.deepEqual(pickQuote(hits, 'ie00test0001', 'EUR'), { priceCents: 10123, priceDate: '2026-10-30', symbol: 'XMPL.XETRA' });
});

test('pickQuote: neuerer Schlusskurs schlägt bei gleichem Rang', () => {
  const r = [
    { Code: 'A', Exchange: 'AS', Currency: 'EUR', ISIN: 'NL0000TEST01', previousClose: 10, previousCloseDate: '2026-10-29' },
    { Code: 'A', Exchange: 'PA', Currency: 'EUR', ISIN: 'NL0000TEST01', previousClose: 11, previousCloseDate: '2026-10-30' },
  ];
  assert.equal(pickQuote(r, 'NL0000TEST01').priceCents, 1100);
});

test('pickQuote: nichts Passendes', () => {
  assert.equal(pickQuote(hits, 'US0000TEST03'), null);
  assert.equal(pickQuote(hits.slice(0, 1), 'IE00TEST0001', 'EUR'), null);
  assert.equal(pickQuote({ message: 'error' }, 'IE00TEST0001'), null);
  assert.equal(pickQuote([{ ISIN: 'X', Currency: 'EUR', previousClose: 0, previousCloseDate: '2026-10-30' }], 'X'), null);
});

test('isinsToFetch: ohne Leere und Doppelte', () => {
  assert.deepEqual(isinsToFetch([{ isin: 'A' }, { isin: '' }, { isin: 'A' }, { isin: 'B' }]), ['A', 'B']);
});

test('applyQuotes: trägt ein, neuerer Kurs von Hand bleibt', () => {
  const positions = [
    { id: '1', isin: 'A', priceCents: 900, priceDate: '2026-10-01' },
    { id: '2', isin: 'B', priceCents: 5100, priceDate: '2026-11-01' },
    { id: '3', isin: '', priceCents: null, priceDate: null },
    { id: '4', isin: 'C', priceCents: 700, priceDate: '2026-10-30' },
  ];
  const quotes = new Map([['A', { priceCents: 1000, priceDate: '2026-10-30' }], ['B', { priceCents: 5000, priceDate: '2026-10-30' }], ['C', { priceCents: 700, priceDate: '2026-10-30' }]]);
  const r = applyQuotes(positions, quotes);
  assert.equal(r.changed, 1);
  assert.deepEqual(r.positions[0], { id: '1', isin: 'A', priceCents: 1000, priceDate: '2026-10-30' });
  assert.equal(r.positions[1], positions[1]);
  assert.equal(r.positions[3], positions[3]);
});

test('failureKind', () => {
  assert.equal(failureKind(401), 'key');
  assert.equal(failureKind(402), 'limit');
  assert.equal(failureKind(429), 'limit');
  assert.equal(failureKind(500), 'net');
});

import { coinUrl, pickCoinQuotes, coinsToFetch, quoteKey } from '../src/prices.js';
import { sanitizePosition } from '../src/model.js';

test('coinUrl: ein Abruf für BTC und ETH in Euro', () => {
  assert.equal(coinUrl(['BTC', 'ETH'], 'EUR'), 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=eur&include_last_updated_at=true');
});

test('pickCoinQuotes: Kurs in Cent, Datum über die übergebene Uhr', () => {
  const json = { bitcoin: { eur: 61234.567, last_updated_at: 1793000000 }, ethereum: { usd: 3000, last_updated_at: 1793000000 } };
  const q = pickCoinQuotes(json, 'EUR', () => '2026-11-03');
  assert.deepEqual([...q], [['coin:BTC', { priceCents: 6123457, priceDate: '2026-11-03' }]]);
  assert.equal(pickCoinQuotes(null, 'EUR', () => 'x').size, 0);
});

test('Krypto: Coin statt ISIN, nur bekannte Coins', () => {
  const base = { id: 'k', accountId: 'a', name: 'Bitcoin', date: '2026-11-03', kind: 'krypto', isin: 'IE00TEST0001' };
  assert.equal(sanitizePosition({ ...base, coin: 'BTC' }).coin, 'BTC');
  assert.equal(sanitizePosition({ ...base, coin: 'DOGE' }).coin, '');
  assert.equal(sanitizePosition({ ...base, kind: 'etf', coin: 'BTC' }).coin, '');
  const ps = [sanitizePosition({ ...base, coin: 'BTC' }), sanitizePosition({ ...base, id: 'k2', coin: 'BTC' }), sanitizePosition({ ...base, id: 'k3', coin: 'ETH' }), sanitizePosition({ ...base, id: 'e', kind: 'etf' })];
  assert.deepEqual(coinsToFetch(ps), ['BTC', 'ETH']);
  assert.deepEqual(isinsToFetch(ps), ['IE00TEST0001']);
  assert.equal(quoteKey(ps[0]), 'coin:BTC');
  assert.equal(quoteKey(sanitizePosition({ ...base, coin: '' })), '');
  const r = applyQuotes(ps, new Map([['coin:BTC', { priceCents: 6000000, priceDate: '2026-11-03' }], ['IE00TEST0001', { priceCents: 100, priceDate: '2026-11-03' }]]));
  assert.equal(r.changed, 3);
  assert.equal(r.positions[2].priceCents, null);
  assert.equal(r.positions[3].priceCents, 100);
});
