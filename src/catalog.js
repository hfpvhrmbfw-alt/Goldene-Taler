// Feste Inhalte: Startregeln für häufige Händler in Deutschland.
// Vom Assistenten zusammengestellt, ohne Gewähr. Wird nur beim ersten Start übernommen und ist danach frei änderbar.

/**
 * Mitgelieferte Kategorien. IDs nie ändern; Namen und Sichtbarkeit kann Anna ändern, eigene kommen dazu.
 * @type {import('./model.js').Category[]}
 */
export const DEFAULT_CATEGORIES = [
  ['lebensmittel', 'Lebensmittel', 'expense'], ['essen', 'Essen & Café', 'expense'], ['mobilitaet', 'Mobilität', 'expense'],
  ['shopping', 'Shopping', 'expense'], ['drogerie', 'Drogerie', 'expense'], ['haushalt', 'Haushalt & Wohnen', 'expense'],
  ['gesundheit', 'Gesundheit', 'expense'], ['freizeit', 'Freizeit', 'expense'], ['abos', 'Abos & Digitales', 'expense'],
  ['reisen', 'Reisen', 'expense'], ['sonstiges', 'Sonstiges', 'expense'],
  ['gehalt', 'Gehalt', 'income'], ['erstattung', 'Erstattung', 'income'], ['sonstige-einnahmen', 'Sonstige Einnahmen', 'income'],
  ['sparen', 'Sparen', 'saving'],
].map(([id, name, kind]) => ({ id, name, kind, hidden: false }));

/** @type {{id: string, pattern: string, categoryId: string}[]} */
export const DEFAULT_RULES = [
  ['rewe', 'lebensmittel'], ['edeka', 'lebensmittel'], ['lidl', 'lebensmittel'], ['aldi', 'lebensmittel'],
  ['penny', 'lebensmittel'], ['netto', 'lebensmittel'], ['kaufland', 'lebensmittel'], ['tegut', 'lebensmittel'],
  ['denns', 'lebensmittel'], ['alnatura', 'lebensmittel'], ['globus', 'lebensmittel'],
  ['baecker', 'essen'], ['bäcker', 'essen'], ['backwerk', 'essen'], ['starbucks', 'essen'], ['mcdonald', 'essen'],
  ['burger king', 'essen'], ['lieferando', 'essen'], ['wolt', 'essen'], ['restaurant', 'essen'], ['cafe', 'essen'],
  ['deutsche bahn', 'mobilitaet'], ['db vertrieb', 'mobilitaet'], ['bvg', 'mobilitaet'], ['mvg', 'mobilitaet'],
  ['hvv', 'mobilitaet'], ['uber', 'mobilitaet'], ['bolt', 'mobilitaet'], ['free now', 'mobilitaet'],
  ['aral', 'mobilitaet'], ['shell', 'mobilitaet'], ['esso', 'mobilitaet'], ['jet ', 'mobilitaet'], ['totalenergies', 'mobilitaet'],
  ['amazon', 'shopping'], ['zalando', 'shopping'], ['h&m', 'shopping'], ['zara', 'shopping'], ['primark', 'shopping'],
  ['mediamarkt', 'shopping'], ['saturn', 'shopping'], ['decathlon', 'shopping'],
  ['dm-drogerie', 'drogerie'], ['dm drogerie', 'drogerie'], ['rossmann', 'drogerie'], ['mueller', 'drogerie'], ['müller', 'drogerie'],
  ['ikea', 'haushalt'], ['obi', 'haushalt'], ['bauhaus', 'haushalt'], ['hornbach', 'haushalt'], ['toom', 'haushalt'],
  ['apotheke', 'gesundheit'],
  ['kino', 'freizeit'], ['cinemaxx', 'freizeit'], ['thalia', 'freizeit'],
  ['apple.com', 'abos'], ['spotify', 'abos'], ['netflix', 'abos'], ['disney', 'abos'],
  ['lufthansa', 'reisen'], ['eurowings', 'reisen'], ['ryanair', 'reisen'], ['booking.com', 'reisen'], ['airbnb', 'reisen'],
].map(([pattern, categoryId], i) => ({ id: `std-${String(i + 1).padStart(2, '0')}`, pattern, categoryId }));

/**
 * Vorlagen für Banken: Konten zum Anhaken. `on` = vorab angehakt. Alles ist danach frei änderbar.
 * Erkennungswörter passen zu den Kontoauszügen (Karte „ING“, „Trade Republic“).
 * @type {Record<string, {bank: string, accounts: {name: string, type: 'konto'|'tagesgeld'|'depot', main?: boolean, other?: boolean, match?: string[], rate?: boolean, on: boolean, hint: string}[]}>}
 */
export const BANK_TEMPLATES = {
  ing: {
    bank: 'ING',
    accounts: [
      { name: 'Girokonto', type: 'konto', main: true, match: ['ING'], on: true, hint: 'Eingangskonto · Auszüge als PDF einlesbar' },
      { name: 'Extra-Konto', type: 'tagesgeld', match: ['Extra-Konto'], on: true, hint: 'Tagesgeld' },
      { name: 'Depot', type: 'depot', on: true, hint: 'Aktien und ETFs' },
      { name: 'Kinderdepot', type: 'depot', other: true, on: false, hint: 'gehört jemand anderem · zählt nicht zu deinem Vermögen' },
    ],
  },
  traderepublic: {
    bank: 'Trade Republic',
    accounts: [
      { name: 'Konto mit Karte', type: 'konto', match: ['Trade Republic'], rate: true, on: true, hint: 'Verrechnungskonto mit Zinsen · Auszüge als PDF einlesbar' },
      { name: 'Depot', type: 'depot', on: true, hint: 'Aktien, ETFs, Sparpläne' },
    ],
  },
  scalable: {
    bank: 'Scalable Capital',
    accounts: [
      { name: 'Tagesgeld', type: 'tagesgeld', match: ['Scalable'], on: true, hint: 'Stand von Hand, Umbuchungen rechnet Taler dazu' },
      { name: 'Depot', type: 'depot', on: true, hint: 'Aktien und ETFs' },
    ],
  },
};
