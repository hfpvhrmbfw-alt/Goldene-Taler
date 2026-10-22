// Feste Inhalte: Startregeln für häufige Händler in Deutschland.
// Vom Assistenten zusammengestellt, ohne Gewähr. Wird nur beim ersten Start übernommen und ist danach frei änderbar.

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
