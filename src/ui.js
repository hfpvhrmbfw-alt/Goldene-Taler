// Oberfläche: Formatierung und Rendering. Liest nur Daten aus der Logik, verändert keinen Zustand.
import { CATEGORY_IDS } from './model.js';
import { monthSummary, groupByDay, monthsWithData } from './logic.js';
import { CATEGORY_LABELS, UNCATEGORIZED, MONTHS, WEEKDAYS, LOG_ERRORS } from './texts.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtCache = new Map();
export function money(cents, currency = 'EUR') {
  if (!fmtCache.has(currency)) {
    try { fmtCache.set(currency, new Intl.NumberFormat('de-DE', { style: 'currency', currency })); }
    catch { fmtCache.set(currency, new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); }
  }
  return fmtCache.get(currency).format(cents / 100);
}
/** Betrag für Eingabefelder: 1234 → "12,34" */
export const amountInput = (cents) => (cents / 100).toFixed(2).replace('.', ',');

export const catLabel = (id) => (id ? CATEGORY_LABELS[id] || id : UNCATEGORIZED);
export const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

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
const pct = (x) => `${Math.round(x * 100)} %`;

export function categoryOptions(selected, { withNone = true, withAll = false } = {}) {
  let html = withAll ? `<option value="__all"${selected === undefined ? ' selected' : ''}>Alle Kategorien</option>` : '';
  if (withNone) html += `<option value=""${selected === null ? ' selected' : ''}>${esc(UNCATEGORIZED)}</option>`;
  for (const id of CATEGORY_IDS) html += `<option value="${id}"${selected === id ? ' selected' : ''}>${esc(CATEGORY_LABELS[id])}</option>`;
  return html;
}

const ICON = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

const item = ({ tag = 'div', attrs = '', cls = '', title, sub = '', n = '', nCls = '', extra = '' }) =>
  `<li><${tag} class="item${cls ? ` ${cls}` : ''}" ${attrs}><span class="t"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}${extra}</span>${n !== '' ? `<span class="n${nCls ? ` ${nCls}` : ''}">${n}</span>` : ''}</${tag}></li>`;

/** Übersicht eines Monats. */
export function renderOverview(el, state, view, clock) {
  const months = monthsWithData(state.transactions, clock.month);
  const s = monthSummary(state.transactions, view.month, clock.today, state.settings.monthlyBudgetCents);
  const cur = state.settings.currency;
  const idx = months.indexOf(view.month);
  const diff = s.spentCents - s.previousCents;
  const uncategorized = s.byCategory.find((c) => c.categoryId === null);

  let html = `
  <div class="titlerow">
    <h2 class="bigtitle">${esc(monthLabel(view.month))}</h2>
    <div class="pager">
      <button class="iconbtn" data-act="month" data-month="${months[idx + 1] || ''}" ${months[idx + 1] ? '' : 'disabled'} aria-label="Vorheriger Monat">${ICON.prev}</button>
      <button class="iconbtn" data-act="month" data-month="${months[idx - 1] || ''}" ${idx > 0 ? '' : 'disabled'} aria-label="Nächster Monat">${ICON.next}</button>
    </div>
  </div>
  <p class="meta-line">${view.month === clock.month ? 'laufender Monat' : 'abgeschlossen'} · ${s.count} ${s.count === 1 ? 'Zahlung' : 'Zahlungen'}</p>`;

  if (state.transactions.length === 0) {
    html += `
    <div class="note info"><span class="cap">start</span>Noch keine Buchungen. Richte den Kurzbefehl ein und importiere danach die Datei <code>ausgaben.txt</code>, oder probiere die App mit Beispieldaten aus.</div>
    <ul class="list">
      ${item({ tag: 'button', attrs: 'data-act="goto" data-tab="data"', title: 'Kurzbefehl einrichten und importieren', n: '›', nCls: 'chev' })}
      ${item({ tag: 'button', attrs: 'data-act="demo"', title: 'Beispieldaten laden', sub: 'zum Ausprobieren, später wieder löschbar', n: '›', nCls: 'chev' })}
    </ul>`;
    el.innerHTML = html;
    return;
  }

  html += `
  <div class="grid kpis">
    <div class="kpi"><div class="cap">ausgegeben</div><div class="v">${money(s.spentCents, cur)}</div>
      <div class="sub">${s.previousCents ? `${diff >= 0 ? '+' : '−'}${money(Math.abs(diff), cur)} zum Vormonat` : 'Vormonat ohne Daten'}</div></div>
    ${s.budgetLeftCents !== null
      ? `<div class="kpi"><div class="cap">budget übrig</div><div class="v">${money(s.budgetLeftCents, cur)}</div><div class="sub">${pct(s.budgetShare)} von ${money(state.settings.monthlyBudgetCents, cur)}</div></div>`
      : `<div class="kpi"><div class="cap">pro tag</div><div class="v">${money(s.dailyAverageCents, cur)}</div><div class="sub">Durchschnitt</div></div>`}
  </div>`;
  if (s.budgetShare !== null) {
    html += `<div class="bar${s.budgetShare > 1 ? ' over' : ''}" role="img" aria-label="Budget zu ${pct(s.budgetShare)} verbraucht"><span style="width:${Math.min(100, s.budgetShare * 100).toFixed(1)}%"></span></div>`;
    if (s.budgetShare > 1) html += `<div class="note err"><span class="cap">achtung</span>Budget um ${money(-s.budgetLeftCents, cur)} überschritten.</div>`;
  }
  if (uncategorized) {
    html += `<ul class="list">${item({ tag: 'button', cls: 'open', attrs: 'data-act="filter-cat" data-cat=""', title: `${uncategorized.count} ${uncategorized.count === 1 ? 'Zahlung' : 'Zahlungen'} ohne Kategorie`, sub: 'antippen zum Einordnen', n: '›', nCls: 'chev' })}</ul>`;
  }

  html += `<ul class="list"><li class="cap">kategorien</li>`;
  if (s.count === 0) html += `<li class="empty">In diesem Monat noch keine Zahlungen.</li>`;
  s.byCategory.forEach((c, i) => {
    html += item({
      tag: 'button', attrs: `data-act="filter-cat" data-cat="${c.categoryId ?? ''}"${i === 0 && c.cents > 0 ? ' aria-current="true"' : ''}`,
      title: esc(catLabel(c.categoryId)), sub: `${c.count}× · ${pct(c.share)}`, n: money(c.cents, cur),
      extra: `<span class="share"><i style="width:${(c.share * 100).toFixed(1)}%"></i></span>`,
    });
  });
  html += `</ul>`;

  if (s.topMerchants.length) {
    html += `<ul class="list"><li class="cap">häufigste händler</li>
      ${s.topMerchants.map((m) => item({ title: esc(m.merchant || '—'), sub: `${m.count}×`, n: money(m.cents, cur) })).join('')}</ul>`;
  }
  el.innerHTML = html;
}

/** Liste der Buchungen mit Suche, Monat und Kategorie. */
export function renderList(el, state, view, clock) {
  const groups = groupByDay(state.transactions, { month: view.listMonth, categoryId: view.listCategory, query: view.query });
  const cur = state.settings.currency;
  const count = groups.reduce((a, g) => a + g.items.length, 0);
  const total = groups.reduce((a, g) => a + g.totalCents, 0);

  let html = `
  <h2 class="bigtitle">buchungen</h2>
  <p class="meta-line">${count} · ${money(total, cur)}</p>
  <label class="search">${ICON.search}<input type="search" id="f-query" value="${esc(view.query)}" placeholder="suchen" aria-label="Händler oder Notiz suchen"></label>
  <div class="seg" role="group" aria-label="Zeitraum">
    <button data-act="list-month" data-month="${view.month}" aria-pressed="${view.listMonth === view.month}">${esc(monthLabel(view.month))}</button>
    <button data-act="list-month" data-month="" aria-pressed="${!view.listMonth}">alle</button>
  </div>`;
  if (view.listCategory !== undefined) {
    html += `<div class="chips"><button class="chip" data-act="clear-cat" aria-label="Filter ${esc(catLabel(view.listCategory))} entfernen">${esc(catLabel(view.listCategory))} ${ICON.close.replace('<svg', '<svg width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"')}</button></div>`;
  }

  if (!groups.length) html += `<p class="empty">Keine Buchungen für diese Auswahl.</p>`;
  html += `<ul class="list">`;
  for (const g of groups) {
    html += `<li class="cap day"><span>${esc(dayLabel(g.date, clock.today, clock.yesterday))}</span><span class="num">${money(g.totalCents, cur)}</span></li>`;
    for (const t of g.items) {
      const sub = [catLabel(t.categoryId), t.time, t.card, t.note].filter(Boolean).map(esc).join(' · ');
      html += item({
        tag: 'button', cls: t.categoryId ? '' : 'open', attrs: `data-act="edit" data-id="${esc(t.id)}"`,
        title: esc(t.merchant || 'Ohne Händler'), sub,
        n: `${t.amountCents < 0 ? '+' : ''}${money(Math.abs(t.amountCents), t.currency)}`, nCls: t.amountCents < 0 ? 'in' : '',
      });
    }
  }
  html += `</ul>`;
  el.innerHTML = html;
}

export function renderRules(el, state) {
  const custom = state.rules.filter((r) => !r.id.startsWith('std-'));
  const std = state.rules.filter((r) => r.id.startsWith('std-'));
  const row = (r) => `<li><div class="item"><span class="t"><b class="num">${esc(r.pattern)}</b><span>${esc(catLabel(r.categoryId))}</span></span>
    <button class="iconbtn" data-act="del-rule" data-id="${esc(r.id)}" aria-label="Regel ${esc(r.pattern)} löschen">${ICON.close}</button></div></li>`;
  el.innerHTML = `
  <h2 class="bigtitle">regeln</h2>
  <p class="meta-line">Steht das Muster am Wortanfang im Händlernamen, bekommt die Zahlung diese Kategorie. Längere Muster gewinnen, von Hand gesetzte Kategorien bleiben.</p>
  <form class="addrule" id="rule-form">
    <label class="field"><span class="cap">händler enthält</span><input name="pattern" required placeholder="z. B. rewe to go" autocomplete="off"></label>
    <label class="field"><span class="cap">kategorie</span><select name="categoryId">${categoryOptions('lebensmittel', { withNone: false })}</select></label>
    <button class="btn primary">regel hinzufügen</button>
  </form>
  <ul class="list"><li class="cap">eigene regeln · ${custom.length}</li>
    ${custom.length ? custom.map(row).join('') : '<li class="empty">Noch keine. Wenn du bei einer Buchung die Kategorie änderst, kannst du sie direkt als Regel merken.</li>'}</ul>
  <details><summary>vorgegebene regeln · ${std.length}</summary><div><ul class="list">${std.map(row).join('')}</ul></div></details>`;
}

export function renderData(el, state, view, info) {
  const cur = state.settings.currency;
  const b = state.settings.monthlyBudgetCents;
  const last = info.lastImport;
  el.innerHTML = `
  <h2 class="bigtitle">daten</h2>
  <p class="meta-line">${state.transactions.length} Buchungen · alles bleibt auf diesem Gerät</p>

  <ul class="list"><li class="cap">import</li>
    <li><label class="item" for="log-file"><span class="t"><b>Kurzbefehl-Datei einlesen</b><span>${last ? `zuletzt ${esc(last.when)} · ${last.added} neu` : 'iCloud Drive › Shortcuts › ausgaben.txt'}</span></span><span class="n chev">›</span></label>
      <input type="file" id="log-file" accept=".txt,.csv,text/plain" class="visually-hidden"></li>
  </ul>
  ${view.importReport || ''}
  <details><summary>zeilen einfügen</summary><div class="stack">
    <label class="field"><span class="cap">zeilen</span><textarea id="log-text" placeholder="2026-10-20T18:55:41+02:00;42,17 €;REWE Markt;Visa"></textarea></label>
    <button class="btn" data-act="import-text">einlesen</button></div></details>

  <details><summary>kurzbefehl einrichten</summary><div>
    <ol class="steps">
      <li>App <b>Kurzbefehle</b> öffnen, unten <b>Automation</b>, dann <b>+</b> und <b>Transaktion</b> wählen.</li>
      <li>Bei <b>Karte</b> alle Apple-Pay-Karten auswählen, bei <b>Kategorie</b> alle lassen. <b>Sofort ausführen</b>, <b>Weiter</b>, <b>Neuer leerer Kurzbefehl</b>.</li>
      <li>Aktion <b>Datum formatieren</b>: Datum = <i>Aktuelles Datum</i>, Format = <b>ISO 8601</b>, <b>Uhrzeit einschließen</b> an.</li>
      <li>Aktion <b>Text</b>, genau so füllen (Teile in Klammern sind Variablen aus <i>Kurzbefehl-Eingabe</i>):
        <pre>[Formatiertes Datum];[Betrag];[Händler];[Name]</pre>
        <span class="muted"><i>Name</i> ist der Kartenname, je nach iOS-Version auch <i>Karte oder Ausweis</i>.</span></li>
      <li>Aktion <b>An Textdatei anhängen</b>: Datei = <code>Shortcuts/ausgaben.txt</code>, <b>Neue Zeile anfangen</b> an.</li>
      <li>Fertig. Nach der nächsten Zahlung hier <b>Kurzbefehl-Datei einlesen</b>.</li>
    </ol>
    <div class="note info"><span class="cap">hinweis</span>iOS lässt Kurzbefehle nicht direkt in den Speicher einer Web-App schreiben, deshalb der Weg über die Datei.</div>
  </div></details>

  <ul class="list"><li class="cap">budget</li></ul>
  <form class="addrule" id="budget-form">
    <label class="field" style="grid-column:1 / -1"><span class="cap">monatsbudget (${esc(cur)})</span><input name="budget" inputmode="decimal" placeholder="leer = kein Budget" value="${b ? amountInput(b) : ''}"></label>
    <button class="btn">budget speichern</button>
  </form>

  <ul class="list"><li class="cap">export und sicherung</li>
    ${item({ tag: 'button', attrs: 'data-act="export-csv"', title: 'CSV für Numbers oder Excel', n: 'csv' })}
    ${item({ tag: 'button', attrs: 'data-act="export-json"', title: 'Sicherung speichern', sub: 'Buchungen, Regeln und Budget', n: 'json' })}
    <li><label class="item" for="backup-file"><span class="t"><b>Sicherung laden</b><span>ersetzt den aktuellen Stand</span></span><span class="n chev">›</span></label>
      <input type="file" id="backup-file" accept=".json,application/json" class="visually-hidden"></li>
  </ul>

  <ul class="list"><li class="cap">zurücksetzen</li>
    ${item({ tag: 'button', attrs: 'data-act="demo"', title: 'Beispieldaten laden', n: '›', nCls: 'chev' })}
    ${item({ tag: 'button', cls: 'danger', attrs: 'data-act="reset"', title: 'Alles löschen', sub: `Speicher: ${esc(info.storageKind)}`, n: '›', nCls: 'chev' })}
  </ul>`;
}

/** Bericht nach dem Einlesen der Kurzbefehl-Datei. */
export function importReportHtml(added, known, errors) {
  let html = `<div class="note ${added ? 'ok' : 'info'}"><span class="cap">${added ? 'importiert' : 'nichts neues'}</span>${added} neu, ${known} schon bekannt.</div>`;
  if (errors.length) {
    html += `<div class="note warn"><span class="cap">übersprungen</span>${errors.length} ${errors.length === 1 ? 'Zeile' : 'Zeilen'} nicht lesbar: `
      + errors.slice(0, 5).map((e) => `Zeile ${e.line} (${esc(LOG_ERRORS[e.error] || e.error)})`).join(', ')
      + (errors.length > 5 ? ' …' : '') + '</div>';
  }
  return html;
}

/** CSV mit Semikolon und deutschem Komma, damit Numbers und Excel (de) es direkt öffnen. */
export function buildCsv(transactions) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Datum', 'Uhrzeit', 'Händler', 'Betrag', 'Währung', 'Kategorie', 'Karte', 'Notiz'].map(q).join(';')];
  for (const t of transactions) {
    lines.push([t.date, t.time || '', t.merchant, amountInput(t.amountCents), t.currency, catLabel(t.categoryId), t.card, t.note].map(q).join(';'));
  }
  return '﻿' + lines.join('\r\n');
}
