// Oberfläche: Formatierung und Rendering. Liest nur Daten aus der Logik, verändert keinen Zustand.
import { CATEGORY_IDS } from './model.js';
import {
  monthSummary, groupByDay, monthsWithData, categoriesByUse, previousMonth, daysBetween,
  yearSummary, merchantSummary, monthReview, detectRecurring, ruleDefault, monthCurve,
} from './logic.js';
import { DEFAULT_RULES } from './catalog.js';
import { CATEGORY_LABELS, UNCATEGORIZED, MONTHS, WEEKDAYS, LOG_ERRORS, BANK_LABELS } from './texts.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtCache = new Map();
function fmt(currency) {
  if (!fmtCache.has(currency)) {
    try { fmtCache.set(currency, new Intl.NumberFormat('de-DE', { style: 'currency', currency })); }
    catch { fmtCache.set(currency, new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); }
  }
  return fmtCache.get(currency);
}
/** Betrag mit echtem Minuszeichen (−), nie mit Bindestrich. */
export const money = (cents, currency = 'EUR') => fmt(currency).format(cents / 100).replace('-', '−');
/** Differenz mit Vorzeichen: "+12,00 €", "−8,50 €". */
export const signed = (cents, currency = 'EUR') => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${money(Math.abs(cents), currency)}`;
/** Große Zahl: Euro voll, Cent und Währung kleiner. */
function moneyHero(cents, currency) {
  let main = '';
  let rest = '';
  let after = false;
  for (const p of fmt(currency).formatToParts(cents / 100)) {
    if (p.type === 'decimal') after = true;
    const v = p.type === 'minusSign' ? '−' : p.value;
    if (after) rest += v; else main += v;
  }
  return `${esc(main)}<small>${esc(rest)}</small>`;
}
/** Summe für Listen: Ausgaben ohne Vorzeichen, Erstattungen grün mit „+“ (wie die einzelnen Zahlungen). */
const sumHtml = (cents, currency) => (cents < 0 ? `<span class="in">+${money(-cents, currency)}</span>` : money(cents, currency));
/** "120,00 $" bzw. "120,00 $, 5,00 £" für Fremdwährung ohne Euro-Betrag. */
const foreignText = (foreign) => foreign.map((f) => money(f.cents, f.currency)).join(', ');
/** Betrag für Eingabefelder: 1234 → "12,34" */
export const amountInput = (cents) => (cents / 100).toFixed(2).replace('.', ',');

export const catLabel = (id) => (id ? CATEGORY_LABELS[id] || id : UNCATEGORIZED);
export const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const monthName = (m) => MONTHS[Number(m.slice(5, 7)) - 1];

/** Wochentag aus YYYY-MM-DD ohne Zeitzone (Zeller-Variante nach Sakamoto). */
function weekday(date) {
  let [y, m, d] = date.split('-').map(Number);
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  if (m < 3) y -= 1;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[m - 1] + d) % 7;
}
export function dayLabel(date, today, yesterday) {
  if (date === today) return 'Heute';
  if (date === yesterday) return 'Gestern';
  return `${WEEKDAYS[weekday(date)]}, ${Number(date.slice(8, 10))}. ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}
/** "heute", "gestern", "vor 3 tagen" – klein, für Sätze. */
export function sinceLabel(date, today) {
  const n = daysBetween(date, today);
  if (n <= 0) return 'heute';
  if (n === 1) return 'gestern';
  return `vor ${n} tagen`;
}
const pct = (x) => `${Math.round(x * 100)} %`;
/** Veränderung in Prozent mit Vorzeichen, null ohne Vergleichswert. */
const change = (now, before) => (before > 0 ? `${now >= before ? '+' : '−'}${Math.round(Math.abs(now - before) / before * 100)} %` : null);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function categoryOptions(selected, { withNone = true } = {}) {
  let html = withNone ? `<option value=""${selected === null ? ' selected' : ''}>${esc(UNCATEGORIZED)}</option>` : '';
  for (const id of CATEGORY_IDS) html += `<option value="${id}"${selected === id ? ' selected' : ''}>${esc(CATEGORY_LABELS[id])}</option>`;
  return html;
}

const ICON = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
export const coin = (cls = '') => `<svg class="coin ${cls}" aria-hidden="true"><use href="#coin"/></svg>`;

const item = ({ tag = 'div', attrs = '', cls = '', title, sub = '', n = '', nCls = '', extra = '', chev = false }) =>
  `<li><${tag} class="item${cls ? ` ${cls}` : ''}" ${attrs}><span class="t"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}${extra}</span>${n !== '' ? `<span class="n${nCls ? ` ${nCls}` : ''}">${n}</span>` : ''}${chev ? '<span class="chev" aria-hidden="true">›</span>' : ''}</${tag}></li>`;
const head = (text) => `<h3 class="cap listhead">${text}</h3>`;
/** Kopf eines klappbaren Abschnitts; zugeklappt steht `sum` (das Größte) rechts. Schließt mit </details>. */
const foldOpen = (key, title, sum, view) =>
  `<details class="fold" data-fold="${key}"${view.folds[key] ? ' open' : ''}><summary><span class="cap">${title}</span><span class="foldsum">${esc(sum)}</span></summary>`;

/** Zeile „neue zahlungen einlesen“: öffnet den Dateiwähler für ausgaben.txt. */
function importRow(info, today) {
  const last = info.lastImport;
  let sub = 'iCloud Drive › Shortcuts › ausgaben.txt';
  if (last?.at) sub = `zuletzt ${sinceLabel(last.at, today)}${last.time && last.at === today ? `, ${last.time}` : ''} · ${last.added} neu`;
  else if (last?.when) sub = `zuletzt ${String(last.when).toLowerCase()} · ${last.added} neu`;
  return `<li><label class="item action" for="log-file"><span class="t"><b>Neue Zahlungen einlesen</b><span>${esc(sub)}</span></span><span class="chev" aria-hidden="true">›</span></label></li>`;
}

/** Zeile „kontoauszug einlesen“: öffnet den Dateiwähler für ein PDF von Trade Republic oder ING. */
function statementRow() {
  return `<li><label class="item action" for="statement-file"><span class="t"><b>Kontoauszug einlesen</b><span>PDF von Trade Republic oder ING · bleibt auf dem Gerät</span></span><span class="chev" aria-hidden="true">›</span></label></li>`;
}

/** Sicherung fällig? Ab 20 eigenen Buchungen und wenn die letzte Sicherung über 30 Tage her ist. */
export function backupDue(state, info, today) {
  const own = state.transactions.filter((t) => t.source !== 'demo').length;
  if (own < 20) return false;
  return !info.lastBackup || daysBetween(String(info.lastBackup).slice(0, 10), today) > 30;
}
const backupLabel = (info, today) => (info.lastBackup ? `letzte ${sinceLabel(String(info.lastBackup).slice(0, 10), today)}` : 'noch nie gesichert');

/** Übersicht eines Monats. */
export function renderOverview(el, state, view, clock, info) {
  const cur = state.settings.currency;
  const months = monthsWithData(state.transactions, clock.month);
  const s = monthSummary(state.transactions, view.month, clock.today, state.settings.monthlyBudgetCents, cur);
  const idx = months.indexOf(view.month);
  const uncategorized = s.byCategory.find((c) => c.categoryId === null);
  const open = state.transactions.filter((t) => !t.categoryId && !t.excluded).length;
  const demoCount = state.transactions.filter((t) => t.source === 'demo').length;

  let html = `
  <div class="titlerow">
    <h2 class="bigtitle">${esc(monthLabel(view.month))}</h2>
    <div class="pager">
      <button class="iconbtn" data-act="month" data-month="${months[idx + 1] || ''}" ${months[idx + 1] ? '' : 'disabled'} aria-label="Vorheriger Monat">${ICON.prev}</button>
      <button class="iconbtn" data-act="month" data-month="${months[idx - 1] || ''}" ${idx > 0 ? '' : 'disabled'} aria-label="Nächster Monat">${ICON.next}</button>
    </div>
  </div>
  <p class="meta-line">${view.month === clock.month ? 'laufender Monat' : view.month > clock.month ? 'noch nicht begonnen' : 'abgeschlossen'} · ${plural(s.count, 'Zahlung', 'Zahlungen')}</p>`;

  if (state.transactions.length === 0) {
    html += `
    <div class="emptyhero">${coin('big')}<p>Noch keine Buchungen.<br>Richte einmal den Kurzbefehl ein, danach kommt jede Apple-Pay-Zahlung von selbst in die Datei <code>ausgaben.txt</code>. Einlesen kannst du sie unter <b>Einstellungen</b>.</p></div>
    <ul class="list">
      ${item({ tag: 'button', attrs: 'data-act="setup"', title: 'Kurzbefehl einrichten', sub: 'einmalig, etwa drei Minuten', chev: true })}
      ${item({ tag: 'button', attrs: 'data-act="demo"', title: 'Mit Beispieldaten ausprobieren', sub: 'lassen sich danach mit einem Tipp entfernen', chev: true })}
    </ul>
    ${info.standalone ? '' : standaloneNote()}`;
    el.innerHTML = html;
    return;
  }

  const ref = s.comparedToDay !== null ? s.previousToDateCents : s.previousCents;
  // Ein Vergleich mit einem halb erfassten Vormonat (Taler lief erst ab Monatsmitte) wäre irreführend.
  const compare = !s.previousComplete
    ? (s.previousCents ? `${monthName(previousMonth(view.month))} nur teilweise erfasst` : 'Vormonat ohne Daten')
    : `${signed(s.spentCents - ref, cur)} zum ${monthName(previousMonth(view.month))}${s.comparedToDay !== null ? ` bis ${s.comparedToDay}.` : ''}`;
  html += `
  <div class="kpis">
    <div class="kpi hero"><div class="cap">erfasste ausgaben</div><div class="v">${moneyHero(s.spentCents, cur)}</div><div class="sub">${compare}</div></div>
    ${s.budgetLeftCents !== null
      ? `<div class="kpi"><div class="cap">budget übrig</div><div class="v">${money(s.budgetLeftCents, cur)}</div><div class="sub">${pct(s.budgetShare)} von ${money(state.settings.monthlyBudgetCents, cur)}</div></div>`
      : `<div class="kpi"><div class="cap">pro tag</div><div class="v">${money(s.dailyAverageCents, cur)}</div><div class="sub">Durchschnitt</div></div>`}
  </div>`;
  if (s.budgetShare !== null) {
    const pace = s.comparedToDay !== null ? s.monthProgress : null;
    const label = `Budget zu ${pct(s.budgetShare)} verbraucht${pace !== null ? `, ${pct(pace)} des Monats vorbei` : ''}`;
    html += `<div class="bar${s.budgetShare > 1 ? ' over' : ''}" role="img" aria-label="${label}"><span style="width:${Math.min(100, s.budgetShare * 100).toFixed(1)}%"></span>${pace !== null ? `<i class="pace" style="left:${(pace * 100).toFixed(1)}%"></i>` : ''}</div>`;
    if (pace !== null && s.budgetShare <= 1) html += `<p class="barnote">${s.budgetShare > pace + 0.05 ? 'schneller als der Monat' : 'im Plan'} · Strich = heute</p>`;
    if (s.budgetShare > 1) html += `<div class="note err"><span class="cap">achtung</span>Budget um ${money(-s.budgetLeftCents, cur)} überschritten.</div>`;
  }
  if (s.foreign.length) {
    html += `<p class="barnote">Nicht eingerechnet: ${s.foreign.map((f) => `${money(f.cents, f.currency)} (${plural(f.count, 'Zahlung', 'Zahlungen')})`).join(', ')}. Den Betrag in ${esc(cur)} trägst du in der Buchung ein.</p>`;
  }

  // Was zu tun ist: einordnen, aufräumen. Petrol nur hier. Einlesen und Sichern stehen unter Einstellungen.
  let todo = '';
  if (open) {
    todo += item({ tag: 'button', cls: 'open', attrs: 'data-act="sort"', title: `${plural(open, 'Zahlung', 'Zahlungen')} einordnen`, sub: 'ohne Kategorie · ein Tipp pro Zahlung', chev: true });
  }
  if (demoCount) {
    todo += item({ tag: 'button', attrs: 'data-act="demo-remove"', title: 'Beispieldaten entfernen', sub: `${demoCount} Beispielbuchungen, deine eigenen bleiben`, chev: true });
  }
  if (todo) html += `<ul class="list todo">${todo}</ul>`;
  html += view.importReport || '';
  html += curveBlock(state, view, clock, s);

  // Kategorien, dazu „ohne Kategorie“ als letzte Zeile, damit die Anteile zusammen 100 % ergeben.
  // Klappbar; zugeklappt steht die größte Kategorie in der Kopfzeile.
  const cats = s.byCategory.filter((c) => c.categoryId !== null);
  const top = cats[0] && cats[0].cents > 0 ? `${catLabel(cats[0].categoryId)} ${pct(cats[0].share)}` : '';
  html += `${foldOpen('cats', 'kategorien', top, view)}<ul class="list">`;
  if (s.count === 0) html += `<li class="empty">In diesem Monat noch keine Zahlungen.</li>`;
  cats.forEach((c, i) => {
    html += item({
      tag: 'button', attrs: `data-act="filter-cat" data-cat="${c.categoryId}"${i === 0 && c.cents > 0 ? ' aria-current="true"' : ''}`,
      title: esc(catLabel(c.categoryId)), sub: `${c.count}× · ${pct(c.share)}`, n: sumHtml(c.cents, cur),
      extra: `<span class="share" aria-hidden="true"><i style="width:${(c.share * 100).toFixed(1)}%"></i></span>`,
    });
  });
  if (uncategorized) {
    html += item({
      tag: 'button', cls: 'open', attrs: 'data-act="sort"',
      title: esc(UNCATEGORIZED), sub: `${uncategorized.count}× · ${pct(uncategorized.share)} · antippen zum Einordnen`, n: sumHtml(uncategorized.cents, cur),
      extra: `<span class="share" aria-hidden="true"><i style="width:${(uncategorized.share * 100).toFixed(1)}%"></i></span>`,
    });
  }
  html += `</ul></details>`;
  if (view.month === clock.month) html += reviewCard(state, clock, info);

  if (s.topMerchants.length) {
    const m0 = s.topMerchants[0];
    html += `${foldOpen('merchants', 'größte händler', `${m0.merchant || '—'} ${money(m0.cents, cur)}`, view)}<ul class="list">
      ${s.topMerchants.map((m) => item({ tag: 'button', attrs: `data-act="filter-merchant" data-merchant="${esc(m.merchant)}"`, title: esc(m.merchant || '—'), sub: `${m.count}×`, n: sumHtml(m.cents, cur), chev: true })).join('')}</ul></details>`;
  }
  html += yearBlock(state, view, clock, months);
  if (view.month === clock.month) html += recurringBlock(state, clock);
  el.innerHTML = html;
}

/**
 * Verlauf: aufgelaufene Ausgaben im Monat als Linie, Vormonat gestrichelt, Budget als waagrechte Linie.
 * Antippen oder Ziehen zeigt den Stand an einem Tag (main.js liest data-cur/data-prev).
 */
function curveBlock(state, view, clock, s) {
  const cur = state.settings.currency;
  const c = monthCurve(state.transactions, view.month, clock.today, cur);
  if (!c.current.some((v) => v !== 0)) return '';
  const budget = state.settings.monthlyBudgetCents || null;
  const prev = c.previous;
  const max = Math.max(1, ...c.current, ...(prev || []), budget || 0) * 1.08;
  const W = 300;
  const H = 120;
  const xy = (v, i, days) => `${((i + 0.5) / days * W).toFixed(1)},${(H - Math.max(0, v) / max * H).toFixed(1)}`;
  const line = (vals, days) => vals.map((v, i) => xy(v, i, days)).join(' ');
  const last = c.current.length - 1;
  const [ex, ey] = xy(c.current[last], last, c.days).split(',');
  const prevName = monthName(previousMonth(view.month));
  const area = `${(0.5 / c.days * W).toFixed(1)},${H} ${line(c.current, c.days)} ${ex},${H}`;
  const legend = [`<span class="lg cur">${esc(monthName(view.month))}</span>`];
  if (prev) legend.push(`<span class="lg prev">${esc(prevName)}</span>`);
  if (budget) legend.push(`<span class="lg bud">Budget</span>`);
  const label = `Verlauf ${monthLabel(view.month)}: ${money(c.current[last], cur)} bis zum ${last + 1}.${prev ? `, ${prevName} am selben Tag ${money(prev[Math.min(last, prev.length - 1)], cur)}` : ''}`;
  return `${head('verlauf')}
  <figure class="curve" data-cur="${c.current.join(',')}" data-prev="${prev ? prev.join(',') : ''}" data-days="${c.days}" data-pdays="${c.previousDays}"
    data-name="${esc(monthName(view.month))}" data-pname="${esc(prevName)}" data-currency="${esc(cur)}">
    <p class="readout" aria-live="polite"></p>
    <div class="plot">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
        ${budget ? `<line class="bud" x1="0" x2="${W}" y1="${(H - budget / max * H).toFixed(1)}" y2="${(H - budget / max * H).toFixed(1)}"/>` : ''}
        ${prev ? `<polyline class="prev" points="${line(prev, c.previousDays)}"/>` : ''}
        <polygon class="area" points="${area}"/>
        <polyline class="cur" points="${line(c.current, c.days)}"/>
        <line class="cross" x1="0" x2="0" y1="0" y2="${H}" style="display:none"/>
      </svg>
      <i class="dot" style="left:${(ex / W * 100).toFixed(2)}%;top:${(ey / H * 100).toFixed(2)}%"></i>
    </div>
    <div class="axis" aria-hidden="true"><span>1.</span><span>15.</span><span>${c.days}.</span></div>
    <figcaption class="legend">${legend.join('')}</figcaption>
  </figure>`;
}

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/** Jahresblick: zwölf Balken, antippbar, darunter Summe, Durchschnitt und Vorjahr. */
function yearBlock(state, view, clock, months) {
  const cur = state.settings.currency;
  const year = view.month.slice(0, 4);
  const y = yearSummary(state.transactions, year, clock.today, cur);
  if (!y.months.some((m) => m.count)) return '';
  const bars = y.months.map((m, i) => {
    const h = y.maxCents > 0 ? Math.max(0, m.cents) / y.maxCents : 0;
    const can = months.includes(m.month);
    const label = `${MONTHS[i]}: ${m.count ? money(m.cents, cur) : 'keine Zahlungen'}`;
    return `<button class="ybar${m.month === view.month ? ' on' : ''}${m.month > clock.month ? ' future' : ''}" data-act="month" data-month="${can ? m.month : ''}" ${can ? '' : 'disabled'} aria-label="${esc(label)}"${m.month === view.month ? ' aria-current="true"' : ''}>`
      + `<span class="col"><i style="height:${(h * 100).toFixed(1)}%"></i></span><span class="lbl" aria-hidden="true">${MONTH_INITIALS[i]}</span></button>`;
  }).join('');
  const notes = [];
  if (y.averageCents !== null) notes.push(`ø ${money(y.averageCents, cur)} pro monat`);
  const ch = y.previousCents !== null ? change(y.totalCents, y.previousCents) : null;
  if (ch) notes.push(`${ch} zu ${Number(year) - 1}${y.comparedTo ? ` bis ${Number(y.comparedTo.slice(3))}. ${MONTHS[Number(y.comparedTo.slice(0, 2)) - 1].toLowerCase()}` : ''}`);
  return `${head(`jahr ${year}`)}
  <div class="year">
    <div class="yearhead"><span class="v">${money(y.totalCents, cur)}</span>${notes.length ? `<span class="sub">${esc(notes.join(' · '))}</span>` : ''}</div>
    <div class="ybars" role="group" aria-label="Ausgaben pro Monat ${year}">${bars}</div>
  </div>`;
}

/** Wiederkehrende Zahlungen (Abos), nur im laufenden Monat. */
function recurringBlock(state, clock) {
  const cur = state.settings.currency;
  const list = detectRecurring(state.transactions, clock.today).filter((r) => r.currency === cur);
  if (!list.length) return '';
  const monthly = list.reduce((a, r) => a + r.monthlyCents, 0);
  return `${head('jeden monat')}<ul class="list">
    ${list.map((r) => item({ tag: 'button', attrs: `data-act="filter-merchant" data-merchant="${esc(r.merchant)}"`, title: esc(r.merchant), sub: `seit ${esc(monthLabel(r.since).toLowerCase())} · ${money(r.yearlyCents, cur)} im jahr`, n: money(r.monthlyCents, cur), chev: true })).join('')}
  </ul>
  <p class="barnote">Zusammen ${money(monthly, cur)} im Monat, ${money(monthly * 12, cur)} im Jahr. Erkannt an gleichen Beträgen in mindestens drei Monaten hintereinander.</p>`;
}

/** Rückblick auf den Vormonat, in den ersten zehn Tagen eines Monats, bis er weggetippt wird. */
function reviewCard(state, clock, info) {
  const prev = previousMonth(clock.month);
  if (Number(clock.today.slice(8, 10)) > 10 || info.reviewDismissed === prev) return '';
  const cur = state.settings.currency;
  const r = monthReview(state.transactions, prev, cur);
  if (!r) return '';
  // Budget nur, wenn es im Vormonat schon galt.
  const b = state.settings.budgetSince && state.settings.budgetSince <= prev ? state.settings.monthlyBudgetCents : null;
  const ch = r.previousComplete ? change(r.spentCents, r.previousCents) : null;
  const lines = [];
  if (ch) lines.push(`${ch} zum ${monthName(previousMonth(prev))}`);
  if (b) lines.push(r.spentCents <= b ? `${money(b - r.spentCents, cur)} unter dem Budget` : `${money(r.spentCents - b, cur)} über dem Budget`);
  // „Am meisten für …“ sagt erst etwas, wenn der größte Teil eingeordnet ist.
  if (r.topCategory && r.categorizedShare >= 0.7) lines.push(`am meisten für ${esc(catLabel(r.topCategory.categoryId))}: ${money(r.topCategory.cents, cur)}`);
  else if (r.categorizedShare < 0.7) lines.push(`erst ${pct(r.categorizedShare)} eingeordnet`);
  if (r.topMerchant) lines.push(`am häufigsten bei ${esc(r.topMerchant.merchant)}: ${r.topMerchant.count}×`);
  if (r.largest.cents > 0) lines.push(`größte Zahlung: ${money(r.largest.cents, cur)} bei ${esc(r.largest.merchant || '—')}`);
  return `<section class="review" aria-label="Rückblick ${esc(monthLabel(prev))}">
    <div class="reviewhead"><span class="cap">rückblick ${esc(monthName(prev).toLowerCase())}</span><button class="iconbtn" data-act="review-dismiss" data-month="${prev}" aria-label="Rückblick schließen">${ICON.close}</button></div>
    <div class="v">${moneyHero(r.spentCents, cur)}</div>
    <p class="sub">${plural(r.count, 'Zahlung', 'Zahlungen')}</p>
    <ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
    <button class="textbtn" data-act="month" data-month="${prev}">${esc(monthName(prev).toLowerCase())} ansehen ›</button>
  </section>`;
}

const standaloneNote = () => `<div class="note info"><span class="cap">tipp</span>Öffne Taler über <b>Teilen › Zum Home-Bildschirm</b>. Safari und die App auf dem Home-Bildschirm speichern getrennt.</div>`;

/** Liste der Buchungen mit eigenem Monat, Suche und Filtern. */
export function renderList(el, state, view, clock) {
  const cur = state.settings.currency;
  const groups = groupByDay(state.transactions, { month: view.listMonth, categoryId: view.listCategory, merchant: view.listMerchant, query: view.query, currency: cur });
  const count = groups.reduce((a, g) => a + g.items.length, 0);
  const total = groups.reduce((a, g) => a + g.totalCents, 0);
  const months = monthsWithData(state.transactions, clock.month);
  const m = view.listMonth;
  const idx = m ? months.indexOf(m) : -1;

  let html = `
  <div class="titlerow">
    <h2 class="bigtitle${view.listMerchant ? ' asis' : ''}">${view.listMerchant ? esc(view.listMerchant) : m ? esc(monthLabel(m)) : 'alle buchungen'}</h2>
    ${m ? `<div class="pager">
      <button class="iconbtn" data-act="list-month" data-month="${months[idx + 1] || ''}" ${months[idx + 1] ? '' : 'disabled'} aria-label="Vorheriger Monat">${ICON.prev}</button>
      <button class="iconbtn" data-act="list-month" data-month="${months[idx - 1] || ''}" ${idx > 0 ? '' : 'disabled'} aria-label="Nächster Monat">${ICON.next}</button>
    </div>` : ''}
  </div>
  <p class="meta-line">${view.listMerchant && m ? `${esc(monthLabel(m))} · ` : ''}${plural(count, 'Buchung', 'Buchungen')} · ${sumHtml(total, cur)}</p>
  ${view.listMerchant ? merchantKpis(state, view.listMerchant, clock) : ''}
  <label class="search">${ICON.search}<input type="search" id="f-query" value="${esc(view.query)}" placeholder="suchen" aria-label="Händler oder Notiz suchen"></label>
  <div class="seg" role="group" aria-label="Zeitraum">
    <button data-act="list-scope" data-scope="month" aria-pressed="${!!m}">${esc(monthName(m || view.lastListMonth || clock.month).toLowerCase())}</button>
    <button data-act="list-scope" data-scope="all" aria-pressed="${!m}">alle</button>
  </div>`;
  const chips = [];
  const x = ICON.close.replace('<svg', '<svg width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"');
  if (view.listCategory !== undefined) chips.push(`<button class="chip" data-act="clear-cat" aria-label="Filter ${esc(catLabel(view.listCategory))} entfernen">${esc(catLabel(view.listCategory))} ${x}</button>`);
  if (chips.length) html += `<div class="chips">${chips.join('')}</div>`;

  if (!groups.length) html += `<p class="empty">Keine Buchungen für diese Auswahl.</p>`;
  html += `<ul class="list">`;
  for (const g of groups) {
    const daySum = [g.totalCents || !g.foreign.length ? sumHtml(g.totalCents, cur) : '', foreignText(g.foreign)].filter(Boolean).join(' + ');
    html += `<li class="cap day" role="heading" aria-level="3"><span>${esc(dayLabel(g.date, clock.today, clock.yesterday))}</span><span class="num">${daySum}</span></li>`;
    for (const t of g.items) {
      const base = t.currency !== cur ? (t.baseCents !== null ? `= ${money(t.baseCents, cur)}` : `ohne ${cur}-Betrag`) : '';
      const sub = [t.excluded ? 'zählt nicht mit' : '', catLabel(t.categoryId), base, t.time, t.card, t.note, t.source === 'demo' ? 'Beispiel' : ''].filter(Boolean).map(esc).join(' · ');
      const fresh = view.fresh?.has(t.id);
      html += item({
        tag: 'button', cls: `${t.categoryId || t.excluded ? '' : 'open'}${fresh ? ' fresh' : ''}${t.excluded ? ' excluded' : ''}`, attrs: `data-act="edit" data-id="${esc(t.id)}"${fresh ? ' aria-description="neu"' : ''}`,
        title: esc(t.merchant || 'Ohne Händler'), sub,
        n: `${t.amountCents < 0 ? '+' : ''}${money(Math.abs(t.amountCents), t.currency)}`, nCls: t.amountCents < 0 ? 'in' : '',
      });
    }
  }
  html += `</ul>`;
  el.innerHTML = html;
}

/** Kopf der Händler-Ansicht: dieses Jahr und insgesamt. */
function merchantKpis(state, merchant, clock) {
  const cur = state.settings.currency;
  const s = merchantSummary(state.transactions, merchant, clock.today, cur);
  if (!s.count) return '';
  return `<div class="kpis">
    <div class="kpi"><div class="cap">${clock.today.slice(0, 4)}</div><div class="v">${money(s.yearCents, cur)}</div><div class="sub">${plural(s.yearCount, 'Zahlung', 'Zahlungen')}</div></div>
    <div class="kpi"><div class="cap">insgesamt</div><div class="v">${money(s.totalCents, cur)}</div><div class="sub">ø ${money(s.averageCents, cur)} · seit ${esc(monthLabel(s.firstDate).toLowerCase())}</div></div>
  </div>`;
}

/** Einstellungen: Budget, Regeln, Kurzbefehl, Sicherung, Zurücksetzen. */
export function renderSettings(el, state, view, info, clock) {
  const cur = state.settings.currency;
  const b = state.settings.monthlyBudgetCents;
  const custom = state.rules.filter((r) => !r.id.startsWith('std-')).length;
  const std = state.rules.length - custom;
  const demoCount = state.transactions.filter((t) => t.source === 'demo').length;
  el.innerHTML = `
  <h2 class="bigtitle">einstellungen</h2>
  <p class="meta-line">${plural(state.transactions.length, 'Buchung', 'Buchungen')} · alles bleibt auf diesem Gerät</p>

  ${head('einlesen')}
  <ul class="list">
    ${importRow(info, clock.today)}
    ${statementRow()}
    ${backupDue(state, info, clock.today) ? item({ tag: 'button', cls: 'open', attrs: 'data-act="export-json"', title: 'Sicherung speichern', sub: `${backupLabel(info, clock.today)} · für Regeln und Notizen`, chev: true }) : ''}
  </ul>

  ${head(`monatsbudget (${esc(cur)})`)}
  <form class="inlineform" id="budget-form">
    <label class="field"><span class="visually-hidden">Monatsbudget in ${esc(cur)}, leer für kein Budget</span><input name="budget" inputmode="decimal" placeholder="leer = kein Budget" value="${b ? amountInput(b) : ''}"></label>
    <button class="btn">übernehmen</button>
  </form>

  ${head('einordnen')}
  <ul class="list">
    ${item({ tag: 'button', attrs: 'data-act="goto" data-tab="rules"', title: 'Regeln', sub: `${custom} eigene · ${std} vorgegeben`, chev: true })}
  </ul>

  ${head('hilfe')}
  <details id="setup-details"><summary>kurzbefehl einrichten</summary><div>
    <ol class="steps">
      <li>App <b>Kurzbefehle</b>, unten <b>Automation</b>, dann <b>+</b> und <b>Mitteilung</b>. App: <b>Wallet</b>. <b>Sofort ausführen</b>, <b>Weiter</b>, <b>Neuer leerer Kurzbefehl</b>.</li>
      <li>Aktion <b>Datum formatieren</b>: Datum = <i>Aktuelles Datum</i>, Format = <b>ISO 8601</b>, <b>Uhrzeit einschließen</b> an.</li>
      <li>Aktion <b>Text</b>. Nichts abtippen außer <code>;</code>: Jeder Teil ist eine blaue Variablen-Blase.
        <pre>(Formatiertes Datum) ; (Titel) ; (Untertitel) ; (Text)</pre>
        <span class="muted">Über der Tastatur <i>Kurzbefehleingabe</i> wählen, die Blase antippen und unter „Laden“ das Feld wählen. Fehlt es, bei <i>Typ</i> zuerst <i>Mitteilung</i> einstellen.</span></li>
      <li>Aktion <b>An Textdatei anhängen</b>: Text = die gelbe Variable <i>Text</i>, Ordner <b>Shortcuts</b>, Dateipfad <code>ausgaben.txt</code>, <b>Neue Zeile erstellen</b> an.</li>
      <li>Fertig. Nach der nächsten Zahlung hier oben <b>Neue Zahlungen einlesen</b>.</li>
    </ol>
    <p class="muted">Mitteilungen ohne Betrag (Bordkarten, Tickets) landen auch in der Datei. Taler überspringt sie still.</p>
    <div class="note info"><span class="cap">hinweis</span>iOS lässt Kurzbefehle nicht direkt in den Speicher einer Web-App schreiben, deshalb der Weg über die Datei.</div>
  </div></details>
  <details><summary>zeilen einfügen</summary><div class="stack">
    <label class="field"><span class="cap">zeilen</span><textarea id="log-text" placeholder="2026-10-20T18:55:41+02:00;REWE Markt;;42,17 € mit Visa"></textarea></label>
    <button class="btn" data-act="import-text">einlesen</button></div></details>

  <details><summary>kontoauszug: was übernommen wird</summary><div>
  <p class="muted">Übernimmt Kartenzahlungen und Lastschriften, keine Überweisungen, Daueraufträge oder Wertpapiere.
    Was der Kurzbefehl schon per Apple Pay erfasst hat (gleicher Betrag, Datum bis fünf Tage später), kommt nicht doppelt.
    Das PDF wird nur hier im Browser gelesen und nicht gespeichert.</p></div></details>

  ${head('sicherung')}
  <ul class="list">
    ${item({ tag: 'button', attrs: 'data-act="export-json"', title: 'Sicherung speichern', sub: backupLabel(info, clock.today), n: 'json' })}
    ${item({ tag: 'button', attrs: 'data-act="export-csv"', title: 'Tabelle für Numbers oder Excel', n: 'csv' })}
    <li><label class="item" for="backup-file"><span class="t"><b>Sicherung laden</b><span>ersetzt den aktuellen Stand</span></span><span class="chev" aria-hidden="true">›</span></label></li>
  </ul>
  ${info.standalone ? '' : standaloneNote()}

  ${head('zurücksetzen')}
  <ul class="list">
    ${demoCount
      ? item({ tag: 'button', attrs: 'data-act="demo-remove"', title: 'Beispieldaten entfernen', sub: `${demoCount} Beispielbuchungen, deine eigenen bleiben`, chev: true })
      : item({ tag: 'button', attrs: 'data-act="demo"', title: 'Beispieldaten laden', sub: 'zum Ausprobieren, getrennt entfernbar', chev: true })}
    ${item({ tag: 'button', cls: 'danger', attrs: 'data-act="reset"', title: 'Alles löschen', sub: 'Buchungen, Regeln und Budget', chev: true })}
  </ul>
  <p class="footnote">Speicher: ${esc(info.storageKind)}${info.version ? ` · ${esc(info.version)}` : ''}</p>`;
}

/** Regeln: eigene oben, Vorgaben eingeklappt, gelöschte Vorgaben wiederherstellbar. */
export function renderRules(el, state) {
  const custom = state.rules.filter((r) => !r.id.startsWith('std-'));
  const std = state.rules.filter((r) => r.id.startsWith('std-'));
  const missing = DEFAULT_RULES.filter((d) => !state.rules.some((r) => r.id === d.id || r.pattern === d.pattern)).length;
  const row = (r) => item({ tag: 'button', attrs: `data-act="edit-rule" data-id="${esc(r.id)}"`, title: `<span class="mono">${esc(r.pattern)}</span>`, sub: esc(catLabel(r.categoryId)), chev: true });
  el.innerHTML = `
  <h2 class="bigtitle">regeln</h2>
  <p class="meta-line">Steht das Muster am Wortanfang im Händlernamen, bekommt die Zahlung diese Kategorie. Regeln entstehen meist beim Einordnen.</p>
  ${head(`eigene regeln · ${custom.length}`)}
  <ul class="list">
    ${custom.length ? custom.map(row).join('') : '<li class="empty">Noch keine. Beim Einordnen merkt sich Taler den Händler auf Wunsch als Regel.</li>'}
    ${item({ tag: 'button', attrs: 'data-act="new-rule"', title: 'Neue Regel', chev: true })}
  </ul>
  <details><summary>vorgegebene regeln · ${std.length}</summary><div><ul class="list">${std.map(row).join('')}</ul></div></details>
  ${missing ? `<ul class="list">${item({ tag: 'button', attrs: 'data-act="restore-std"', title: `${plural(missing, 'gelöschte Vorgabe', 'gelöschte Vorgaben')} wiederherstellen`, chev: true })}</ul>` : ''}`;
}

/**
 * Einordnen-Sheet: eine Zahlung, darunter alle Kategorien als Knöpfe. Ein Tipp ordnet ein und zeigt die nächste.
 * Die Reihenfolge der Kategorien (`cats`) bleibt während einer Sitzung gleich, damit kein Knopf unter dem Finger wegrutscht.
 * @param {{t: object|null, pos: number, total: number, pattern: string, cats: string[], last: {text: string}|null}} s
 */
export function renderSorter(el, state, s, clock) {
  const undo = s.last ? `<button class="textbtn undo" data-sort="undo">rückgängig: ${esc(s.last.text)}</button>` : '';
  if (!s.t) {
    el.innerHTML = `
    <div class="sheethead"><h2 id="sort-title">einordnen</h2><button class="iconbtn" data-sort="close" aria-label="Schließen">${ICON.close}</button></div>
    <div class="emptyhero small">${coin('big')}<p>Alles eingeordnet.</p></div>
    ${undo}
    <div class="actions"><button class="btn primary" data-sort="close">fertig</button></div>`;
    return;
  }
  const t = s.t;
  const cats = s.cats || categoriesByUse(state.transactions);
  el.innerHTML = `
  <div class="sheethead"><h2 id="sort-title" class="cap">einordnen · ${s.pos} von ${s.total}</h2><button class="iconbtn" data-sort="close" aria-label="Schließen">${ICON.close}</button></div>
  <div class="sortcard">
    <div class="sortmerchant">${esc(t.merchant || 'Ohne Händler')}</div>
    <div class="sortamount">${t.amountCents < 0 ? '+' : ''}${money(Math.abs(t.amountCents), t.currency)}</div>
    <div class="muted small">${esc([dayLabel(t.date, clock.today, clock.yesterday), t.date.slice(0, 7) !== clock.month ? t.date.slice(0, 4) : '', t.time, t.card].filter(Boolean).join(' · '))}</div>
  </div>
  <div class="catgrid" role="group" aria-label="Kategorie wählen">
    ${cats.map((id) => `<button class="catbtn" data-sort-cat="${id}">${esc(CATEGORY_LABELS[id])}</button>`).join('')}
  </div>
  ${s.pattern ? `<label class="ruleopt"><input type="checkbox" id="sort-make-rule"${ruleDefault(state.transactions, s.pattern) ? ' checked' : ''}><span>Künftig alle bei <input id="sort-pattern" class="inline-input" value="${esc(s.pattern)}" aria-label="Muster"> so einordnen</span></label>` : ''}
  ${undo}
  <div class="actions sticky"><button class="btn" data-sort="skip">überspringen</button><button class="btn" data-sort="close">später</button></div>`;
}

/** Bericht nach dem Einlesen der Kurzbefehl-Datei. Zeilen ohne Betrag sind kein Fehler und erscheinen nur grau. */
export function importReportHtml(added, known, errors, ignoredNew, dupes = 0) {
  let html = `<div class="note ${added ? 'ok' : 'info'}"><span class="cap">${added ? 'eingelesen' : 'nichts neues'}</span>${added} neu, ${known} schon bekannt${dupes ? `, ${dupes} schon aus dem Kontoauszug` : ''}.</div>`;
  if (errors.length) {
    html += `<div class="note warn"><span class="cap">übersprungen</span>${plural(errors.length, 'Zeile', 'Zeilen')} nicht lesbar: `
      + errors.slice(0, 5).map((e) => `„${esc(e.text || `Zeile ${e.line}`)}“ (${esc(LOG_ERRORS[e.error] || e.error)})`).join(', ')
      + (errors.length > 5 ? ' …' : '') + '. Meist nichts zu tun: Taler liest den Rest der Datei trotzdem.</div>';
  }
  if (ignoredNew) html += `<p class="barnote">${plural(ignoredNew, 'Wallet-Mitteilung', 'Wallet-Mitteilungen')} ohne Betrag (z. B. Bordkarte) übersprungen.</p>`;
  return html;
}

/** Ergebnis eines Kontoauszugs: neu, bekannt, schon per Kurzbefehl da, nicht übernommen. */
export function statementReportHtml(bank, added, known, dupes, other, errors) {
  const parts = [`${added} neu`, `${known} schon bekannt`];
  if (dupes) parts.push(`${dupes} schon per Apple Pay erfasst`);
  let html = `<div class="note ${added ? 'ok' : 'info'}"><span class="cap">${esc(BANK_LABELS[bank] || bank)}</span>${parts.join(', ')}.</div>`;
  if (errors) html += `<div class="note warn"><span class="cap">übersprungen</span>${plural(errors, 'Zeile', 'Zeilen')} nicht lesbar.</div>`;
  if (other) html += `<p class="barnote">${plural(other, 'Buchung', 'Buchungen')} ohne Karte oder Lastschrift (Überweisungen, Gutschriften, Wertpapiere) nicht übernommen.</p>`;
  return html;
}

/** CSV mit Semikolon und deutschem Komma, damit Numbers und Excel (de) es direkt öffnen. */
export function buildCsv(transactions) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Datum', 'Uhrzeit', 'Händler', 'Betrag', 'Währung', 'Kategorie', 'Karte', 'Notiz', 'Mitgezählt'].map(q).join(';')];
  for (const t of transactions) {
    lines.push([t.date, t.time || '', t.merchant, amountInput(t.amountCents), t.currency, catLabel(t.categoryId), t.card, t.note, t.excluded ? 'nein' : 'ja'].map(q).join(';'));
  }
  return '﻿' + lines.join('\r\n');
}
