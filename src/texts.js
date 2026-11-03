// Beschriftungen zu den IDs aus dem Modell und Meldungen. Gehört zur Oberfläche.

export const KIND_LABELS = { expense: 'Ausgabe', income: 'Einnahme', balance: 'Gleicht sich aus', saving: 'Sparen', transfer: 'Umbuchung' };
/** Überschriften der Kategoriengruppen und Namen der Arten (Umschalter). */
export const CATEGORY_GROUPS = { expense: 'Ausgaben', income: 'Einnahmen', balance: 'Gleicht sich aus', saving: 'Sparen' };
export const CATEGORY_KIND_NAMES = { expense: 'ausgabe', income: 'einnahme', balance: 'gleicht sich aus', saving: 'sparen' };
export const UNCATEGORIZED = 'Ohne Kategorie';

export const LOG_ERRORS = {
  fields: 'zu wenige Felder',
  date: 'Datum nicht lesbar',
  amount: 'Betrag nicht lesbar',
};

export const IMPORT_ERRORS = {
  json: 'Die Datei ist keine gültige Sicherung (kein JSON).',
  app: 'Die Datei ist keine Sicherung dieser App.',
  newer: 'Die Sicherung stammt aus einer neueren Version der App. Bitte zuerst die App aktualisieren.',
  shape: 'Die Sicherung ist unvollständig.',
};

/** Arten von Konten, wie sie in Listen stehen. */
export const ACCOUNT_TYPE_LABELS = { konto: 'Konto', tagesgeld: 'Tagesgeld', depot: 'Depot' };

/** Arten von Positionen im Depot. */
export const POSITION_KIND_LABELS = { etf: 'ETF', aktie: 'Aktie', fonds: 'Fonds', krypto: 'Krypto', anderes: 'Anderes' };

export const BANK_LABELS = { traderepublic: 'Trade Republic', ing: 'ING' };

export const STATEMENT_ERRORS = {
  pdf: 'Das PDF ließ sich nicht lesen. Ist es vielleicht mit einem Passwort geschützt?',
  unknown: 'Diesen Kontoauszug kennt Taler noch nicht. Bisher gehen Trade Republic und ING (Girokonto).',
  empty: 'In diesem Kontoauszug stehen keine Buchungen.',
};

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
