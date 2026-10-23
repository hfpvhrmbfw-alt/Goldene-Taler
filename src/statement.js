// Kontoauszüge (PDF) von Trade Republic und ING lesen. Reine Logik: bekommt die Textstücke der Seiten
// mit ihrer Position (wie pdf.js sie liefert), gibt Buchungen zurück. Kein DOM, kein pdf.js, keine Uhr.
import { sanitizeTransaction } from './model.js';
import { hashString, parseAmount } from './logic.js';

/**
 * Ein Textstück auf einer PDF-Seite. y wächst nach oben (PDF-Koordinaten), x nach rechts.
 * @typedef {{s: string, x: number, y: number, w?: number}} PdfItem
 * @typedef {PdfItem[]} PdfPage
 */

/**
 * Eine Zeile des Auszugs, egal ob Ausgabe oder nicht.
 * @typedef {Object} StatementRow
 * @property {string} date        YYYY-MM-DD, bei Kartenzahlungen möglichst der Kauftag
 * @property {string} type        Buchungsart, wie sie im Auszug steht ("Kartentransaktion", "Lastschrift")
 * @property {string} merchant
 * @property {number} cents       positiv = Geld ging raus, negativ = Geld kam rein
 * @property {boolean} expense    zählt als Ausgabe (Karte, Lastschrift) oder als Erstattung dazu
 * @property {string} card
 * @property {string} key         stabiler Inhalt für die ID
 */

const MONTHS = { jan: 1, feb: 2, mär: 3, mar: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
const monthNum = (word) => MONTHS[String(word).toLowerCase().replace(/[^a-zäöü]/g, '').slice(0, 3)] || null;
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const clean = (items) => items.map((i) => ({ ...i, s: String(i.s ?? '').trim() })).filter((i) => i.s);
const joinText = (parts) => parts.join(' ').replace(/\s+/g, ' ').trim();

/** Textstücke zu Zeilen: gleiche Höhe (± tol), oben zuerst, in der Zeile von links nach rechts. */
export function pageLines(items, tol = 2) {
  const lines = [];
  for (const it of clean(items).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
    if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y);
}

/** @returns {'traderepublic'|'ing'|null} */
export function detectBank(pages) {
  const text = pages.slice(0, 2).flat().map((i) => i.s).join(' ');
  if (/trade\s*republic/i.test(text)) return 'traderepublic';
  if (/ING-DiBa|\bING\b.*Girokonto|Girokonto.*\bING\b/i.test(text)) return 'ing';
  return null;
}

// ---------- Trade Republic ----------

const TR_AMOUNT = /^-?\d{1,3}(?:\.\d{3})*,\d{2}\s?€$/;
const isHeading = (s) => /^[A-ZÄÖÜ][A-ZÄÖÜ ]{7,}$/.test(s);

/**
 * Umsatzübersicht von Trade Republic. Spalten DATUM (Tag, Monat, Jahr untereinander) · TYP · BESCHREIBUNG ·
 * ZAHLUNGSEINGANG · ZAHLUNGSAUSGANG · SALDO. Ob Eingang oder Ausgang, ergibt sich aus der Saldo-Änderung;
 * die Kopfzeile beider Spalten ist ein einziges Textstück und taugt nicht zur Zuordnung.
 * @param {PdfPage[]} pages
 * @returns {{rows: StatementRow[], errors: number}}
 */
export function parseTradeRepublic(pages) {
  const raw = [];
  let opening = null;
  for (const page of pages) {
    const items = clean(page);
    const openHead = items.find((i) => /^ANFANGSSALDO$/i.test(i.s));
    if (openHead && opening === null) {
      const v = items.filter((i) => Math.abs(i.x - openHead.x) < 4 && i.y < openHead.y && TR_AMOUNT.test(i.s)).sort((a, b) => b.y - a.y)[0];
      if (v) opening = parseAmount(v.s).cents;
    }
    const head = items.find((i) => /^BESCHREIBUNG$/i.test(i.s));
    if (!head) continue;
    const sameRow = (i) => Math.abs(i.y - head.y) < 2;
    const dateX = (items.find((i) => sameRow(i) && /^DATUM$/i.test(i.s)) || { x: head.x - 86 }).x;
    const descX = head.x;
    // Unter der Tabelle beginnt ein neuer Abschnitt mit Überschrift in Großbuchstaben (BARMITTELÜBERSICHT …).
    const bottom = Math.max(-Infinity, ...items.filter((i) => i.y < head.y - 2 && isHeading(i.s)).map((i) => i.y));
    const body = items.filter((i) => i.y < head.y - 2 && i.y > bottom + 2);
    const inDateCol = (i) => Math.abs(i.x - dateX) < 4;

    const anchors = [];
    for (const i of body.filter(inDateCol)) {
      const one = i.s.match(/^(\d{1,2})\.?\s+(\p{L}+)\.?\s+(\d{4})$/u);
      if (one && monthNum(one[2])) { anchors.push({ y: i.y, date: ymd(one[3], monthNum(one[2]), one[1]), parts: [i] }); continue; }
      if (!/^\p{L}+\.?$/u.test(i.s) || !monthNum(i.s)) continue;
      const day = body.filter((j) => inDateCol(j) && /^\d{1,2}$/.test(j.s) && j.y > i.y && j.y - i.y < 12).sort((a, b) => a.y - b.y)[0];
      const year = body.filter((j) => inDateCol(j) && /^\d{4}$/.test(j.s) && j.y < i.y && i.y - j.y < 12).sort((a, b) => b.y - a.y)[0];
      if (day && year) anchors.push({ y: i.y, date: ymd(year.s, monthNum(i.s), day.s), parts: [i, day, year] });
    }
    if (!anchors.length) continue;
    const used = new Set(anchors.flatMap((a) => a.parts));
    const groups = anchors.map((a) => ({ a, items: [] }));
    for (const i of body) {
      if (used.has(i)) continue;
      let best = null;
      let dist = Infinity;
      for (const g of groups) {
        const d = Math.abs(g.a.y - i.y);
        if (d < dist) { dist = d; best = g; }
      }
      if (best && dist <= 18) best.items.push(i);
    }
    for (const g of groups.sort((p, q) => q.a.y - p.a.y)) {
      const amounts = g.items.filter((i) => TR_AMOUNT.test(i.s)).sort((p, q) => p.x - q.x);
      const rest = g.items.filter((i) => !amounts.includes(i));
      const byLine = (p, q) => q.y - p.y || p.x - q.x;
      // Lange Typen ("Kartentransaktion APPLE.COM/BILL") stehen samt Beschreibung in einem Textstück.
      const typeText = joinText(rest.filter((i) => i.x < descX - 2).sort(byLine).map((i) => i.s));
      const [type = '', ...typeRest] = typeText.split(' ');
      const desc = joinText([...typeRest, ...rest.filter((i) => i.x >= descX - 2).sort(byLine).map((i) => i.s)]);
      raw.push({
        date: g.a.date, type, desc,
        amount: amounts.length >= 2 ? amounts[amounts.length - 2] : null,
        saldo: amounts.length >= 2 ? amounts[amounts.length - 1] : null,
      });
    }
  }

  // Richtung aus dem Saldo; wo das nicht aufgeht, nach der Spalte, in der der Betrag steht.
  let prev = opening;
  const xs = { out: [], in: [] };
  const sized = raw.map((r) => {
    if (!r.amount) { prev = null; return { ...r, dir: null }; }
    const a = parseAmount(r.amount.s).cents;
    const s = parseAmount(r.saldo.s).cents;
    let dir = null;
    if (prev !== null && prev - a === s) dir = 'out';
    else if (prev !== null && prev + a === s) dir = 'in';
    if (dir) xs[dir].push(r.amount.x);
    prev = s;
    return { ...r, a, s, dir };
  });
  const avg = (l) => l.reduce((x, y) => x + y, 0) / l.length;
  let errors = 0;
  const rows = [];
  for (const r of sized) {
    let dir = r.dir;
    if (!dir && r.amount && (xs.out.length || xs.in.length)) {
      const dOut = xs.out.length ? Math.abs(avg(xs.out) - r.amount.x) : Infinity;
      const dIn = xs.in.length ? Math.abs(avg(xs.in) - r.amount.x) : Infinity;
      dir = dOut <= dIn ? 'out' : 'in';
    }
    if (!dir) { errors += 1; continue; }
    const cents = dir === 'out' ? r.a : -r.a;
    rows.push({
      date: r.date, type: r.type, merchant: r.desc, cents,
      expense: /karte|card|lastschrift/i.test(r.type),
      card: 'Trade Republic',
      key: `tr|${r.date}|${r.type}|${r.desc}|${cents}|${r.s}`,
    });
  }
  return { rows, errors };
}

// ---------- ING ----------

const ING_AMOUNT = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/;
const DATE_DE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const loose = (word) => word.split('').join('\\s?');
const PAYPAL_SHOP = new RegExp(`${loose('Einkauf')}\\s+${loose('bei')}\\s+(.*?)\\s*(?:Mandat:|Referenz:|$)`, 'i');

/**
 * Girokonto-Auszug der ING. Je Buchung: erste Zeile Buchungsdatum · Art · Name · Betrag (mit Vorzeichen),
 * zweite Zeile Valuta · Verwendungszweck, danach weitere Zeilen Verwendungszweck.
 * @param {PdfPage[]} pages
 * @returns {{rows: StatementRow[], errors: number}}
 */
export function parseIng(pages) {
  const recs = [];
  for (const page of pages) {
    const items = clean(page);
    const head = items.find((i) => /^Buchung\s*\/\s*Verwendungszweck$/i.test(i.s));
    if (!head) continue;
    const vzX = head.x;
    const dateX = (items.find((i) => Math.abs(i.y - head.y) < 2 && /^Buchung$/i.test(i.s) && i.x < vzX) || { x: vzX - 70 }).x;
    let cur = null;
    for (const line of pageLines(items.filter((i) => i.y < head.y - 2))) {
      const [first, ...others] = line.items;
      const isDate = DATE_DE.test(first.s) && Math.abs(first.x - dateX) < 4;
      const amount = line.items.find((i) => ING_AMOUNT.test(i.s) && i.x > vzX + 150);
      const texts = others.filter((i) => i !== amount);
      if (isDate && amount) {
        cur = { booking: first.s, valuta: null, head: texts.map((i) => i.s), amount: amount.s, vz: [] };
        recs.push(cur);
      } else if (cur && isDate && !amount && !cur.valuta) {
        cur.valuta = first.s;
        if (texts.length) cur.vz.push(joinText(texts.map((i) => i.s)));
      } else if (cur && !isDate && !amount && Math.abs(first.x - vzX) < 4) {
        cur.vz.push(joinText(line.items.map((i) => i.s)));
      } else {
        cur = null;
      }
    }
  }

  const rows = [];
  let errors = 0;
  for (const r of recs) {
    const m = r.booking.match(DATE_DE);
    const parsed = parseAmount(r.amount);
    if (!m || !parsed) { errors += 1; continue; }
    let [type = '', ...nameParts] = r.head;
    if (!nameParts.length && type.includes(' ')) [type, ...nameParts] = type.split(' ');
    const name = joinText(nameParts);
    const vz = joinText(r.vz);
    const visa = /^VISA\s/i.test(name);
    let merchant = visa ? name.replace(/^VISA\s+/i, '') : name;
    let date = ymd(m[3], m[2], m[1]);
    if (visa) {
      // Kauftag steht im Verwendungszweck ("KAUFUMSATZ 28.08"), das Jahr nur am Buchungstag.
      const k = vz.match(/KAUFUMSATZ\s+(\d{2})\.(\d{2})/);
      if (k) date = ymd(Number(k[2]) > Number(m[2]) ? Number(m[3]) - 1 : m[3], k[2], k[1]);
    }
    if (/paypal/i.test(name)) {
      const shop = (vz.match(PAYPAL_SHOP)?.[1] || '').replace(/[\s,.;]+$/, '');
      merchant = shop ? `${shop} (PayPal)` : 'PayPal';
    }
    const cents = -parsed.cents;
    rows.push({
      date, type, merchant, cents,
      expense: /^lastschrift/i.test(type) || (visa && /gutschrift/i.test(type)),
      card: visa ? 'ING Visa' : 'ING',
      key: `ing|${r.booking}|${r.valuta || ''}|${type}|${name}|${vz}|${cents}`,
    });
  }
  return { rows, errors };
}

// ---------- gemeinsam ----------

/**
 * Liest einen Auszug und macht aus Kartenzahlungen und Lastschriften Buchungen.
 * Überweisungen, Daueraufträge, Gutschriften, Zinsen und Wertpapiere zählen nicht als Ausgabe und werden nur gezählt.
 * IDs entstehen aus dem Inhalt der Zeile: Dieselbe Datei (oder ein überlappender Zeitraum) legt nichts doppelt an.
 * @param {PdfPage[]} pages
 * @param {string} currency
 * @returns {{ok: true, bank: 'traderepublic'|'ing', transactions: import('./model.js').Transaction[], other: number, errors: number}
 *          | {ok: false, error: 'unknown'|'empty'}}
 */
export function parseStatement(pages, currency = 'EUR') {
  const bank = detectBank(pages);
  if (!bank) return { ok: false, error: 'unknown' };
  const { rows, errors } = bank === 'traderepublic' ? parseTradeRepublic(pages) : parseIng(pages);
  if (!rows.length && !errors) return { ok: false, error: 'empty' };
  const seen = new Map();
  const transactions = [];
  for (const r of rows) {
    if (!r.expense) continue;
    const base = `st-${hashString(r.key)}`;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    transactions.push(sanitizeTransaction({
      id: n === 0 ? base : `${base}-${n}`,
      date: r.date, time: null, amountCents: r.cents, currency,
      merchant: r.merchant, card: r.card,
      categoryId: null, manualCategory: false, note: '', source: 'statement',
    }));
  }
  return { ok: true, bank, transactions, other: rows.length - transactions.length, errors };
}
