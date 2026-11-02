// Kurse aus dem Netz (EODHD). Rein: baut die Adresse, wählt aus der Antwort den passenden Kurs, trägt ihn ein.
// Abruf und Uhr bleiben in main.js. Ins Netz geht nur die ISIN, nie ein Betrag.

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

/** ISINs, für die sich ein Abruf lohnt, ohne Doppelte. */
export function isinsToFetch(positions) {
  return [...new Set(positions.map((p) => p.isin).filter(Boolean))];
}

/**
 * Trägt geholte Kurse ein. Ein von Hand eingetragener neuerer Kurs bleibt stehen.
 * @param {Map<string, {priceCents: number, priceDate: string}>} quotes nach ISIN
 */
export function applyQuotes(positions, quotes) {
  let changed = 0;
  const next = positions.map((p) => {
    const q = p.isin && quotes.get(p.isin);
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
