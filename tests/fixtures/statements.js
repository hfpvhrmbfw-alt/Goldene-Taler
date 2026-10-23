// Erfundene Kontoauszüge im Layout von Trade Republic und ING, als Textstücke mit Position
// (so, wie pdf.js sie liefert). Namen, Beträge und Nummern sind ausgedacht.

const it = (s, x, y) => ({ s, x, y });

/** Eine TR-Zeile: Tag/Monat/Jahr untereinander, Typ und Beschreibung auf Höhe des Monats. */
function trRow(y, [d, m, yr], type, desc, amount, saldo, { incoming = false, merged = false } = {}) {
  const out = [it(d, 74.4, y + 7.5), it(m, 74.4, y), it(yr, 74.4, y - 7.6)];
  const lines = Array.isArray(desc) ? desc : [desc];
  if (merged) out.push(it(`${type} ${lines[0]}`, 99.9, y));
  else {
    out.push(it(type, 99.9, y));
    const top = y + (lines.length - 1) * 3.8;
    lines.forEach((l, i) => out.push(it(l, 160.1, top - i * 7.6)));
  }
  out.push(it(amount, incoming ? 372.9 : 427.1, y), it(saldo, 483.5, y));
  return out;
}

const trFooter = (n, of) => [
  it('Trade Republic Bank GmbH', 73, 78.2), it('Brunnenstraße 1', 73, 71.4), it('www.traderepublic.com', 187.3, 78.2),
  it(`Seite ${n} von ${of}`, 483.4, 28.2),
];

export function trPages() {
  const p1 = [
    it('TRADE REPUBLIC BANK GMBH', 73.7, 732.7), it('ERIKA MUSTER', 75.2, 697.5), it('Musterweg 1', 75.2, 688.6),
    it('DATUM', 388.7, 697), it('01 Nov. 2026 - 30 Nov. 2026', 427.5, 696.8),
    it('KONTOÜBERSICHT', 73.7, 629.9),
    it('PRODUKT', 74.4, 596.3), it('ANFANGSSALDO', 148.2, 596.3), it('ZAHLUNGSEINGANG', 238.7, 596.3),
    it('ZAHLUNGSAUSGANG', 347.1, 596.3), it('ENDSALDO', 492.1, 596.3),
    it('Cashkonto', 74.4, 580.1), it('100,00 €', 148.2, 580.1), it('1.012,50 €', 238.7, 580.1),
    it('1.036,40 €', 347.1, 580.1), it('76,10 €', 491.3, 580.1),
    it('UMSATZÜBERSICHT', 73.7, 520),
    it('DATUM', 74.4, 494.8), it('TYP', 99.9, 494.8), it('BESCHREIBUNG', 160.1, 494.8),
    it('ZAHLUNGSEINGANG ZAHLUNGSAUSGANG', 372.9, 494.8), it('SALDO', 501.3, 494.8),
    ...trRow(471, ['01', 'Nov.', '2026'], 'Überweisung', ['Incoming transfer from Erika Muster', '(DE00123456781234567890)'], '1.000,00 €', '1.100,00 €', { incoming: true }),
    ...trRow(431.7, ['02', 'Nov.', '2026'], 'Kartentransaktion', 'APPLE.COM/BILL', '2,99 €', '1.097,01 €', { merged: true }),
    ...trRow(392.5, ['02', 'Nov.', '2026'], 'Handel', ['Savings plan execution IE0000000001 Beispiel Fonds -', 'World ETF Accumulating,', 'quantity: 0.5'], '50,00 €', '1.047,01 €'),
    ...trRow(353.3, ['03', 'Nov.', '2026'], 'Kartentransaktion', 'Bäckerei Krume', '4,20 €', '1.042,81 €', { merged: true }),
    ...trRow(314.1, ['03', 'Nov.', '2026'], 'Kartentransaktion', 'Bäckerei Krume', '4,20 €', '1.038,61 €', { merged: true }),
    ...trFooter(1, 2),
  ];
  const p2 = [
    it('TRADE REPUBLIC BANK GMBH BRUNNENSTRASSE 1', 73.8, 732.1),
    it('DATUM', 74.4, 684.1), it('TYP', 99.9, 684.1), it('BESCHREIBUNG', 160.1, 684.1),
    it('ZAHLUNGSEINGANG ZAHLUNGSAUSGANG', 372.9, 684.1), it('SALDO', 501.3, 684.1),
    ...trRow(660, ['04', 'Nov.', '2026'], 'Kartentransaktion', 'Lebensmittel Fröhlich', '1.012,50 €', '26,11 €', { merged: true }),
    // Erstattung: Kartentransaktion als Eingang
    ...trRow(620, ['05', 'Nov.', '2026'], 'Kartentransaktion', 'Lebensmittel Fröhlich', '12,50 €', '38,61 €', { incoming: true, merged: true }),
    ...trRow(580, ['06', 'Nov.', '2026'], 'Zinsen', 'Interest payment', '0,00 €', '38,61 €', { incoming: true }),
    ...trRow(540, ['07', 'Nov.', '2026'], 'Lastschrift', 'Stadtwerke Beispielstadt', '12,51 €', '26,10 €'),
    it('BARMITTELÜBERSICHT', 73.7, 469.5),
    it('TRANSAKTIONSÜBERSICHT', 73.7, 400),
    it('DATUM', 74.4, 380), it('ZAHLUNGSART', 139, 380), it('BETRAG', 497.7, 380),
    it('02 Nov. 2026', 74.4, 360), it('Kauf', 139, 360), it('658,01 €', 489.1, 360),
    ...trFooter(2, 2),
  ];
  return [p1, p2];
}

/** Eine ING-Buchung: erste Zeile Datum · Art · Name · Betrag, dann Valuta und Verwendungszweck. */
function ingRec(y, booking, valuta, type, name, amount, vz = []) {
  const out = [it(booking, 70.8, y), it(type, 141.6, y)];
  if (name) out.push(it(name, 195, y));
  out.push(it(amount, 517.8, y), it(valuta, 70.8, y - 11.7));
  vz.forEach((l, i) => out.push(it(l, 141.6, y - 12 - i * 12.6)));
  return out;
}

export function ingPages() {
  const p1 = [
    it('ING-DiBa AG · 60628 Frankfurt am Main', 70.8, 705.9),
    it('Erika Muster', 70.8, 654.9), it('Musterweg 1', 70.8, 631.2),
    it('Alter Saldo', 311.7, 627.3), it('2.000,00 Euro', 488.1, 627.3),
    it('IBAN', 311.7, 597), it('DE00 0000 0000 0000 0000 00', 408.3, 597),
    it('Girokonto Nummer 0000000000', 70.8, 530.1), it('Kontoauszug Januar 2027', 70.8, 517.8),
    it('Buchung', 70.8, 493.5), it('Buchung / Verwendungszweck', 141.6, 493.5), it('Betrag (EUR)', 493.8, 493.5),
    it('Valuta', 70.8, 480.9),
    ...ingRec(459.6, '02.01.2027', '02.01.2027', 'Dauerauftrag/Terminueberw.', 'Vermieterin Muster', '-650,00', ['Miete Januar']),
    // Kartenzahlung vom Dezember, gebucht im Januar: Jahr des Kaufs ist 2026.
    ...ingRec(420, '02.01.2027', '02.01.2027', 'Lastschrift', 'VISA BAUMARKT BEISPIEL', '-19,99', ['NR XXXX 1234 BEISPIELSTADT DE KAUFUMSATZ 30.12 19.99 123456', 'ARN00000000000000000000001']),
    ...ingRec(370, '05.01.2027', '05.01.2027', 'Lastschrift', 'PayPal Europe S.a.r.l. et Cie S.C.A', '-9,99', ['1000000000001/PP.0000.PP/. Musik Dienst, Ihr Ei', 'nkauf bei Musik Dienst', 'Mandat: ABC123', 'Referenz: 1000000000001']),
    ...ingRec(310, '06.01.2027', '06.01.2027', 'Lastschrift', 'PayPal (Europe) S.a r.l. et Cie, S. C.A.', '-25,00', ['1000000000002 PP.0000.PP . , Ihr Einkauf bei', 'Mandat: ABC123']),
    it('ING-DiBa AG · Theodor-Heuss-Allee 2 · 60486 Frankfurt am Main', 70.8, 92.7),
    it('00XXXX0000000000_T', 28.2, 70.8),
  ];
  const p2 = [
    it('Girokonto Nummer 0000000000', 70.8, 690), it('Kontoauszug Januar 2027', 70.8, 678),
    it('Buchung', 70.8, 650.1), it('Buchung / Verwendungszweck', 141.6, 650.1), it('Betrag (EUR)', 493.8, 650.1),
    it('Valuta', 70.8, 637.5),
    ...ingRec(616.2, '07.01.2027', '07.01.2027', 'Gutschrift', 'Arbeitgeber GmbH', '2.500,00', ['Gehalt Januar']),
    ...ingRec(570, '08.01.2027', '08.01.2027', 'Gutschrift', 'VISA BAUMARKT BEISPIEL', '5,00', ['NR XXXX 1234 BEISPIELSTADT DE KAUFUMSATZ 07.01 5.00 654321']),
    ...ingRec(530, '09.01.2027', '09.01.2027', 'Lastschrift', 'Versicherung Beispiel AG', '-12,34', ['Beitrag 01/2027', 'Mandat: V-1', 'Referenz: R-1']),
    ...ingRec(480, '09.01.2027', '08.01.2027', 'Echtzeitüberweisung', 'Erika Muster', '-100,00'),
    it('Neuer Saldo', 141.6, 440), it('3.693,68', 511.8, 440),
    it('Kunden-Information', 70.8, 410), it('Vorliegender Freistellungsauftrag', 70.8, 398), it('500,00', 521.4, 398),
  ];
  return [p1, p2];
}
