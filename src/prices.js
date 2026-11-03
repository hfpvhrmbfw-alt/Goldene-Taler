// Kurse aus dem Netz: Aktien und ETFs per ISIN von EODHD (mit Schlüssel), BTC und ETH von CoinGecko (ohne).
// Rein: baut die Adressen, wählt aus der Antwort den passenden Kurs, trägt ihn ein.
// Abruf und Uhr bleiben in main.js. Ins Netz geht nur die ISIN oder der Coin, nie ein Betrag.

export const PRICE_SOURCE = 'EODHD';
export const PRICE_KEY_URL = 'https://eodhd.com/register';

/** Suche per ISIN: liefert je Börse Kürzel, Währung und den letzten Schlusskurs. */
export function searchUrl(isin, key) {
  return `https://eodhd.com/api/search/${encodeURIComponent(isin)}?api_token=${encodeURIComponent(key)}&fmt=json&limit=50`;
}

// Deutsche Handelsplätze zuerst, Xetra vor Frankfurt, dann die übrigen.
const EXCHANGE_RANK = { XETRA: 0, F: 1, STU: 2, MU: 2, BE: 2, HM: 2, HA: 2, DU: 2 };

/**
 * Wählt aus den Suchtreffern den Kurs für eine ISIN in der App-Währung.
 * @returns {{priceCents: number, priceDate: string, symbol: string}|null}
 */
export function pickQuote(results, isin, currency = 'EUR') {
  if (!Array.isArray(results)) return null;
  const want = String(isin).toUpperCase();
  const hits = results.filter((r) => r && String(r.ISIN || '').toUpperCase() === want
    && String(r.Currency || '').toUpperCase() === currency
    && Number(r.previousClose) > 0
    && /^\d{4}-\d{2}-\d{2}$/.test(String(r.previousCloseDate || '')));
  if (!hits.length) return null;
  const rank = (r) => EXCHANGE_RANK[r.Exchange] ?? 3;
  hits.sort((a, b) => rank(a) - rank(b)
    || String(b.previousCloseDate).localeCompare(String(a.previousCloseDate))
    || Number(!!b.isPrimary) - Number(!!a.isPrimary));
  const h = hits[0];
  return { priceCents: Math.round(Number(h.previousClose) * 100), priceDate: h.previousCloseDate, symbol: `${h.Code}.${h.Exchange}` };
}

/** Coins mit Kurs aus dem Netz: Kürzel → Name bei CoinGecko. */
export const COINS = { BTC: 'bitcoin', ETH: 'ethereum' };
export const COIN_NAMES = { BTC: 'Bitcoin', ETH: 'Ethereum' };

/** Ein Abruf für alle Coins, ohne Schlüssel. */
export function coinUrl(coins, currency = 'EUR') {
  return `https://api.coingecko.com/api/v3/simple/price?ids=${coins.map((c) => COINS[c]).join(',')}&vs_currencies=${currency.toLowerCase()}&include_last_updated_at=true`;
}

/**
 * Kurse aus der CoinGecko-Antwort. `toDate` macht aus Sekunden seit 1970 ein Datum (die Uhr gehört main.js).
 * @returns {Map<string, {priceCents: number, priceDate: string}>} Schlüssel wie quoteKey
 */
export function pickCoinQuotes(json, currency, toDate) {
  const out = new Map();
  const cur = String(currency).toLowerCase();
  for (const [coin, id] of Object.entries(COINS)) {
    const row = json && typeof json === 'object' ? json[id] : null;
    const v = Number(row?.[cur]);
    const at = Number(row?.last_updated_at);
    if (v > 0 && at > 0) out.set(`coin:${coin}`, { priceCents: Math.round(v * 100), priceDate: toDate(at) });
  }
  return out;
}

/** Woran ein Kurs hängt: Coin bei Krypto, sonst ISIN. */
export function quoteKey(p) {
  if (p.kind === 'krypto') return p.coin ? `coin:${p.coin}` : '';
  return p.isin || '';
}

/** ISINs, für die sich ein Abruf lohnt, ohne Doppelte. */
export function isinsToFetch(positions) {
  return [...new Set(positions.filter((p) => p.kind !== 'krypto').map((p) => p.isin).filter(Boolean))];
}

/** Coins im Bestand, ohne Doppelte. */
export function coinsToFetch(positions) {
  return [...new Set(positions.filter((p) => p.kind === 'krypto' && COINS[p.coin]).map((p) => p.coin))];
}

/**
 * Trägt geholte Kurse ein. Ein von Hand eingetragener neuerer Kurs bleibt stehen.
 * @param {Map<string, {priceCents: number, priceDate: string}>} quotes nach quoteKey (ISIN oder „coin:BTC“)
 */
export function applyQuotes(positions, quotes) {
  let changed = 0;
  const next = positions.map((p) => {
    const k = quoteKey(p);
    const q = k && quotes.get(k);
    if (!q || (p.priceDate && p.priceDate > q.priceDate)) return p;
    if (p.priceCents === q.priceCents && p.priceDate === q.priceDate) return p;
    changed++;
    return { ...p, priceCents: q.priceCents, priceDate: q.priceDate };
  });
  return { positions: next, changed };
}

/** Antwortstatus in eine Fehlerart übersetzen: Schlüssel falsch, Tageslimit erreicht oder sonst etwas. */
export function failureKind(status) {
  if (status === 401 || status === 403) return 'key';
  if (status === 402 || status === 429) return 'limit';
  return 'net';
}
