// Start, Aktionen, Ereignisse. Einzige Stelle, die die Uhr liest.
import { open } from './storage.js';
import {
  sanitizeTransaction, sanitizeRule, sanitizeSettings, sanitizeCategories, sanitizeAccounts, sanitizeAccount, sanitizePositions, sanitizePosition, DEFAULT_SETTINGS, emptyTransaction, buildExport, parseImport,
} from './model.js';
import { accountFor, counterFor, ownNames, statementAccount, withStatementBalance, migrateOwnAccounts, quantityIn, positionValue } from './accounts.js';
import {
  parseLog, parseAmount, applyRules, mergeTransactions, orderRules, upsertRule, editRule, categorize, suggestPattern,
  sortTransactions, monthOf, findCrossDuplicates, findTransfers, categoriesByUse, ruleDefault, needsCategory, kindOf, groupByDay,
  categoryKind, mergeCategory, isOwnAccountMove, transfersIn,
} from './logic.js';
import { parseStatement } from './statement.js';
import { searchUrl, pickQuote, isinsToFetch, applyQuotes, failureKind } from './prices.js';
import { pdfPages } from './pdf.js';
import { DEFAULT_RULES, DEFAULT_CATEGORIES, BANK_TEMPLATES } from './catalog.js';
import { IMPORT_ERRORS, STATEMENT_ERRORS, CATEGORY_GROUPS } from './texts.js';
import * as ui from './ui.js';

const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function clock() {
  const now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const today = localDate(now);
  return { today, yesterday: localDate(y), month: monthOf(today), time: `${pad(now.getHours())}:${pad(now.getMinutes())}`, iso: now.toISOString() };
}

let db;
const state = { transactions: [], rules: [], settings: { ...DEFAULT_SETTINGS }, deletedIds: [], categories: DEFAULT_CATEGORIES, accounts: [], positions: [] };
const view = {
  tab: 'overview', month: clock().month,
  listMonth: clock().month, lastListMonth: clock().month, listCats: [], listKind: undefined, listSources: [], hideExcluded: false, sort: 'new', listMerchant: null, query: '', from: null,
  importReport: '', fresh: new Set(), editing: null, editingRule: null, folds: { cats: true, merchants: true, fixed: true }, budgetShow: null, editKind: 'expense', catEditing: null,
  accountId: null, listAccount: null, tplBank: null, accountEditing: null, accountType: 'konto', positionEditing: null, positionKind: 'etf', pricesAccount: null,
};
// Klappbare Abschnitte der Übersicht: offen, solange nicht ausdrücklich zugeklappt.
for (const k of Object.keys(view.folds)) {
  try { view.folds[k] = localStorage.getItem(`taler:${k}`) !== 'zu'; } catch { /* egal */ }
}
const info = { lastImport: null, lastBackup: null, reviewDismissed: null, standalone: false, priceKey: null, priceFetch: null, fetchingPrices: false };

// ---------- Speichern ----------
/** Kategorienliste setzen: Zustand und Oberfläche kennen dieselbe Liste. */
function setCategories(list) { state.categories = list; ui.setCategories(list); }
async function saveCategories() { await db.setMeta('categories', state.categories); }
async function saveAccounts() { await db.setMeta('accounts', state.accounts); }
async function savePositions() { await db.setMeta('positions', state.positions); }
const newAccountId = (i = 0) => `a-${Date.now().toString(36)}${i ? `-${i}` : ''}`;
/** Alle Namen, an denen Taler eigene Konten erkennt (Konten und weitere Namen aus den Einstellungen). */
const own = () => ownNames(state.settings, state.accounts);
/** Mitgelieferte Kategorien, die in einer gespeicherten Liste fehlen (z. B. neu dazugekommene), hinten ergänzen. */
const withDefaults = (list) => [...list, ...DEFAULT_CATEGORIES.filter((d) => !list.some((c) => c.id === d.id))];

async function saveTransactions(list) { await db.putTransactions(list); }
async function saveRules() { await db.putRules(state.rules); }

/** Regeln neu anwenden und geänderte Buchungen speichern. */
async function reapplyRules() {
  const before = new Set(state.transactions);
  state.transactions = applyRules(state.transactions, state.rules, state.categories);
  const changed = state.transactions.filter((t) => !before.has(t));
  if (changed.length) await saveTransactions(changed);
  return changed.length;
}

// ---------- Rückgängig ----------
// Der Zustand wird nie verändert, nur ersetzt. Ein Schnappschuss sind daher nur die alten Verweise.
const snapshot = () => ({ transactions: state.transactions, rules: state.rules, deletedIds: state.deletedIds, settings: state.settings, categories: state.categories, accounts: state.accounts, positions: state.positions });

async function restore(snap) {
  const keepT = new Set(snap.transactions.map((t) => t.id));
  for (const t of state.transactions) if (!keepT.has(t.id)) await db.deleteTransaction(t.id);
  const curT = new Map(state.transactions.map((t) => [t.id, t]));
  await saveTransactions(snap.transactions.filter((t) => curT.get(t.id) !== t));
  const keepR = new Set(snap.rules.map((r) => r.id));
  for (const r of state.rules) if (!keepR.has(r.id)) await db.deleteRule(r.id);
  const curR = new Map(state.rules.map((r) => [r.id, r]));
  await db.putRules(snap.rules.filter((r) => curR.get(r.id) !== r));
  Object.assign(state, snap);
  ui.setCategories(state.categories);
  await db.setMeta('deletedIds', state.deletedIds);
  await db.setMeta('settings', state.settings);
  await saveCategories();
  await saveAccounts();
  await savePositions();
}

/** Meldung mit „rückgängig“, das den Stand vor der Aktion wiederherstellt. */
function undoable(msg, snap) {
  toast(msg, {
    label: 'rückgängig',
    async run() { await restore(snap); render(); toast('Rückgängig gemacht'); },
  });
}

// ---------- Rendering ----------
const TABS = { overview: 'Übersicht', list: 'Buchungen', accounts: 'Konten', account: 'Konto', settings: 'Einstellungen', rules: 'Regeln', categories: 'Kategorien' };
/** Unterseiten gehören zu einem Reiter der Leiste. */
const NAV_TAB = { rules: 'settings', categories: 'settings', account: 'accounts' };
const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

function render() {
  const c = clock();
  const el = $(`#view-${view.tab}`);
  if (view.tab === 'overview') ui.renderOverview(el, state, view, c, info);
  if (view.tab === 'list') ui.renderList(el, state, view, c);
  if (view.tab === 'settings') ui.renderSettings(el, state, view, info, c);
  if (view.tab === 'rules') ui.renderRules(el, state);
  if (view.tab === 'categories') ui.renderCategories(el, state);
  if (view.tab === 'accounts') ui.renderAccounts(el, state, view, c);
  if (view.tab === 'account') ui.renderAccount(el, state, view, c, info);
  document.title = `Taler · ${TABS[view.tab]}`;
  $('#add-btn').hidden = !(view.tab === 'overview' || view.tab === 'list');
  const back = view.tab === 'rules' || view.tab === 'categories' ? ['settings', 'einstellungen']
    : view.tab === 'account' ? ['accounts', 'konten']
      : view.tab === 'list' && view.from === 'overview' ? ['overview', 'übersicht']
        : view.tab === 'list' && view.from === 'account' && view.listAccount ? ['account', view.listAccount.name.toLowerCase()] : null;
  $('#head-left').innerHTML = back
    ? `<button class="backbtn" type="button" data-act="back" data-tab="${back[0]}">${BACK}<span>${back[1]}</span></button>` : '';
  // Sicherung fällig: Punkt am Reiter Einstellungen statt einer Zeile in der Übersicht.
  const due = ui.backupDue(state, info, c.today);
  const st = $('.tabbar a[data-tab="settings"]');
  st.classList.toggle('due', due);
  st.setAttribute('aria-label', due ? 'Einstellungen, Sicherung fällig' : 'Einstellungen');
  if (view.tab === 'overview') showCurveDay(el.querySelector('.curve'), null);
  updateBadge();
}

/** Verlauf: Stand an einem Tag (null = letzter Tag) in die Zeile über dem Diagramm schreiben. */
function showCurveDay(fig, day) {
  if (!fig) return;
  const cur = fig.dataset.cur.split(',').map(Number);
  const prev = fig.dataset.prev ? fig.dataset.prev.split(',').map(Number) : null;
  const days = Number(fig.dataset.days);
  const d = day === null ? cur.length : Math.max(1, Math.min(days, day));
  const v = cur[Math.min(d, cur.length) - 1];
  const m = (x) => ui.money(x, fig.dataset.currency);
  let text = `bis ${d}. ${fig.dataset.name.toLowerCase()}: <b>${m(v)}</b>`;
  if (d > cur.length) text = `${d}. ${fig.dataset.name.toLowerCase()}: noch offen`;
  if (prev) text += ` · ${ui.esc(fig.dataset.pname.toLowerCase())}: ${m(prev[Math.min(d, prev.length) - 1])}`;
  fig.querySelector('.readout').innerHTML = text;
  const cross = fig.querySelector('.cross');
  cross.style.display = day === null ? 'none' : '';
  const x = ((d - 0.5) / days * 300).toFixed(1);
  cross.setAttribute('x1', x);
  cross.setAttribute('x2', x);
}

/** Zahl am Home-Bildschirm-Icon: Zahlungen ohne Kategorie (iOS 16.4+, nur installiert). */
function updateBadge() {
  const n = state.transactions.filter(needsCategory).length;
  try {
    if (n && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {});
    else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch { /* nicht unterstützt */ }
}

function selectTab(tab, { keepFrom = false } = {}) {
  if (!TABS[tab]) tab = 'overview';
  if (tab !== view.tab) clearUndo();
  if (tab !== 'overview') view.importReport = '';
  view.tab = tab;
  if (!keepFrom) view.from = null;
  const navTab = NAV_TAB[tab] || tab;
  for (const a of document.querySelectorAll('.tabbar a')) {
    if (a.dataset.tab === navTab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  for (const t of Object.keys(TABS)) $(`#view-${t}`).hidden = t !== tab;
  try { sessionStorage.setItem('taler:tab', tab); } catch { /* egal */ }
  render();
  window.scrollTo(0, 0);
}

/** Rückfrage im eigenen Dialog (confirm() ist in manchen Ansichten gesperrt). */
function ask(text, okLabel = 'OK', { danger = false, cancel = true } = {}) {
  const d = $('#confirm-dialog');
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okLabel;
  $('#confirm-ok').className = danger ? 'btn danger' : 'btn primary';
  $('#confirm-cancel').hidden = !cancel;
  d.returnValue = '';
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
}

let toastTimer;
let toastAction = null;

/** „rückgängig“ gilt nur direkt nach der Aktion: Sobald sich etwas anderes ändert, verschwindet das Angebot,
 *  sonst würde der Schnappschuss auch spätere Änderungen zurücknehmen. */
function clearUndo() {
  if (!toastAction) return;
  clearTimeout(toastTimer);
  $('#toast').hidden = true;
  toastAction = null;
}
function toast(msg, action = null) {
  const t = $('#toast');
  $('#toast-text').textContent = msg;
  const b = $('#toast-action');
  toastAction = action;
  b.hidden = !action;
  if (action) b.textContent = action.label;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; toastAction = null; }, action ? 6000 : 3200);
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Datei weitergeben: auf dem iPhone über das Teilen-Menü („In Dateien sichern“), sonst als Download. false = abgebrochen. */
async function saveFile(name, content, type) {
  try {
    const file = new File([content], name, { type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return true;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return false;
  }
  download(name, content, type);
  return true;
}

async function saveBackup() {
  const c = clock();
  const ok = await saveFile(`taler-sicherung-${c.today}.json`, JSON.stringify(buildExport(state, c.iso), null, 2), 'application/json');
  if (!ok) return;
  info.lastBackup = c.today;
  await db.setMeta('lastBackup', info.lastBackup);
  render();
  toast('Sicherung gespeichert');
}

// ---------- Import ----------
/** Neue Buchungen ohne die, die aus der anderen Quelle (Kurzbefehl bzw. Kontoauszug) schon da sind. */
function withoutCrossDuplicates(incoming) {
  const known = new Set([...state.transactions.map((t) => t.id), ...state.deletedIds]);
  const dupes = findCrossDuplicates(state.transactions, incoming.filter((t) => !known.has(t.id)));
  return { incoming: incoming.filter((t) => !dupes.has(t.id)), dupes: dupes.size };
}

const toTransfer = (t) => ({ ...t, kind: 'transfer', categoryId: null, manualCategory: false });

/**
 * Umbuchungen zwischen eigenen Konten in neuen Zeilen finden: Gegenstück auf einem anderen Konto oder ein eigenes Konto als Gegenseite.
 * Bekannte Gegenstücke werden mit umgestellt (`changed`).
 */
function markTransfers(rows) {
  const known = new Set([...state.transactions.map((t) => t.id), ...state.deletedIds]);
  const fresh = rows.filter((t) => !known.has(t.id));
  const marks = findTransfers(state.transactions, fresh);
  for (const t of fresh) if (isOwnAccountMove(t, own())) marks.add(t.id);
  return {
    incoming: rows.map((t) => (marks.has(t.id) ? { ...t, kind: 'transfer' } : t)),
    changed: state.transactions.filter((t) => marks.has(t.id) && kindOf(t) !== 'transfer').map(toTransfer),
  };
}

/** Vorhandene Buchungen, die ein eigenes Konto nennen (oder ein Gegenstück haben), zu Umbuchungen machen. */
async function applyTransfers({ pairs = false } = {}) {
  const hits = pairs ? transfersIn(state.transactions, own())
    : new Set(state.transactions.filter((t) => isOwnAccountMove(t, own())).map((t) => t.id));
  const changed = state.transactions.filter((t) => hits.has(t.id) && kindOf(t) !== 'transfer').map(toTransfer);
  if (!changed.length) return 0;
  const byId = new Map(changed.map((t) => [t.id, t]));
  state.transactions = state.transactions.map((t) => byId.get(t.id) || t);
  await saveTransactions(changed);
  return changed.length;
}

async function importLog(text, { demo = false } = {}) {
  const snap = snapshot();
  const parsed = parseLog(text, state.settings.currency);
  let incoming = parsed.transactions;
  let dupes = 0;
  if (demo) incoming = incoming.map((t) => ({ ...t, id: t.id.replace(/^sc-/, 'demo-'), source: 'demo' }));
  else ({ incoming, dupes } = withoutCrossDuplicates(incoming));
  let changed = [];
  if (!demo) ({ incoming, changed } = markTransfers(incoming));
  const byId = new Map(changed.map((t) => [t.id, t]));
  const categorized = applyRules(incoming, state.rules, state.categories);
  const { transactions: merged, added } = mergeTransactions(state.transactions.map((t) => byId.get(t.id) || t), categorized, state.deletedIds);
  state.transactions = merged;
  if (changed.length) await saveTransactions(changed);
  if (added.length) await saveTransactions(added);
  if (demo) {
    view.importReport = '';
  } else {
    const c = clock();
    const ignoredNew = Math.max(0, parsed.ignored.length - (info.lastImport?.ignored ?? 0));
    info.lastImport = { at: c.today, time: c.time, added: added.length, ignored: parsed.ignored.length };
    await db.setMeta('lastImport', info.lastImport);
    view.importReport = ui.importReportHtml(added.length, incoming.length - added.length, parsed.errors, ignoredNew, dupes);
  }
  view.fresh = new Set(added.map((t) => t.id));
  if (added.length) view.month = monthOf(sortTransactions(added)[0].date);
  selectTab('overview');
  if (added.length) undoable(demo ? 'Beispieldaten geladen' : `${added.length} neue ${added.length === 1 ? 'Zahlung' : 'Zahlungen'} eingelesen`, snap);
  else toast('Keine neuen Zahlungen');
}

/** Kontoauszug (PDF) einlesen. Die Datei wird nur gelesen, nicht gespeichert. */
async function importStatement(file) {
  let pages;
  try {
    pages = await pdfPages(await file.arrayBuffer());
  } catch {
    await ask(STATEMENT_ERRORS.pdf, 'OK', { cancel: false });
    return;
  }
  const r = parseStatement(pages, state.settings.currency);
  if (!r.ok) { await ask(STATEMENT_ERRORS[r.error], 'OK', { cancel: false }); return; }
  const snap = snapshot();
  const { incoming: rows, dupes } = withoutCrossDuplicates(r.transactions);
  // Umbuchungen zwischen eigenen Konten: neue Zeile gegen alle bekannten, auch die älteren bekommen dann die Art „Umbuchung“.
  const { incoming, changed } = markTransfers(rows);
  const byId = new Map(changed.map((t) => [t.id, t]));
  const { transactions: merged, added } = mergeTransactions(state.transactions.map((t) => byId.get(t.id) || t), applyRules(incoming, state.rules, state.categories), state.deletedIds);
  state.transactions = merged;
  if (changed.length) await saveTransactions(changed);
  if (added.length) await saveTransactions(added);
  const kinds = { expense: 0, income: 0, saving: 0, transfer: changed.length };
  for (const t of added) kinds[kindOf(t)] += 1;
  // Stand des Kontos aus dem Auszug; gibt es das Konto noch nicht, legt Taler es nach der Vorlage an.
  let account = statementAccount(state.accounts, r.card);
  if (!account) {
    const tpl = BANK_TEMPLATES[r.bank === 'ing' ? 'ing' : 'traderepublic'];
    const main = tpl.accounts[0];
    account = sanitizeAccount({ id: newAccountId(), bank: tpl.bank, name: main.name, type: main.type, main: !!main.main, match: main.match });
    state.accounts = [...state.accounts, account];
  }
  const updated = withStatementBalance(account, r.closing);
  state.accounts = state.accounts.map((a) => (a.id === account.id ? updated : a));
  await saveAccounts();
  view.importReport = ui.statementReportHtml(r.bank, added, incoming.length - added.length, dupes, kinds, r.errors);
  view.fresh = new Set(added.map((t) => t.id));
  if (added.length) view.month = monthOf(sortTransactions(added)[0].date);
  selectTab('overview');
  if (added.length) undoable(`${added.length} ${added.length === 1 ? 'Buchung' : 'Buchungen'} aus dem Kontoauszug`, snap);
  else toast('Keine neuen Buchungen');
}

async function removeDemo() {
  const snap = snapshot();
  const demo = state.transactions.filter((t) => t.source === 'demo');
  for (const t of demo) await db.deleteTransaction(t.id);
  state.transactions = state.transactions.filter((t) => t.source !== 'demo');
  render();
  undoable(`${demo.length} Beispielbuchungen entfernt`, snap);
}

async function restoreBackup(text) {
  const r = parseImport(text);
  if (!r.ok) { await ask(IMPORT_ERRORS[r.error], 'OK', { cancel: false }); return; }
  if (!(await ask(`Sicherung mit ${r.transactions.length} Buchungen laden? Der aktuelle Stand wird ersetzt.`, 'Laden'))) return;
  await db.clear();
  state.transactions = sortTransactions(r.transactions);
  state.rules = orderRules(r.rules.length ? r.rules : DEFAULT_RULES);
  state.settings = r.settings;
  state.deletedIds = r.deletedIds;
  setCategories(withDefaults(r.categories || []));
  state.accounts = r.accounts || [];
  state.positions = r.positions;
  view.budgetShow = null;
  await saveTransactions(state.transactions);
  await saveRules();
  await saveCategories();
  await saveAccounts();
  await savePositions();
  await db.setMeta('settings', state.settings);
  await db.setMeta('deletedIds', state.deletedIds);
  await db.setMeta('initialized', true);
  if (info.lastImport) await db.setMeta('lastImport', info.lastImport);
  if (info.lastBackup) await db.setMeta('lastBackup', info.lastBackup);
  const n = await applyTransfers({ pairs: true });
  render();
  toast(`${r.skipped ? `Geladen, ${r.skipped} fehlerhafte Einträge übersprungen` : 'Sicherung geladen'}${n ? `, ${n} Umbuchungen erkannt` : ''}`);
}

function demoLog() {
  const items = [
    ['REWE Markt GmbH', 4217], ['Backwerk', 345], ['Lieferando.de', 2390], ['DB Vertrieb GmbH', 2990], ['dm-drogerie markt', 1265],
    ['EDEKA Center', 3108], ['Starbucks', 560], ['Apple.com/bill', 299], ['IKEA Deutschland', 7999], ['Aral Tankstelle', 6420],
    ['Lidl', 1834], ['Kiosk am Markt', 450], ['Apotheke am Dom', 1295], ['ZARA', 3995], ['Cinemaxx', 2400], ['Bäckerei Schmidt', 680],
  ];
  const now = new Date();
  const lines = [];
  for (let i = 0; i < 46; i++) {
    const d = new Date(now); d.setDate(now.getDate() - Math.floor(i * 1.3));
    const [m, c] = items[(i * 7) % items.length];
    const cents = Math.max(99, Math.round(c * (0.7 + ((i * 37) % 60) / 100)));
    lines.push(`${localDate(d)}T${pad(8 + (i % 12))}:${pad((i * 13) % 60)}:00;${ui.amountInput(cents)} €;${m};${i % 3 ? 'Visa' : 'Girocard'}`);
  }
  // Abos: gleicher Betrag am gleichen Tag, vier Monate zurück.
  for (const [m, c, day] of [['Spotify', 1099, 3], ['Netflix', 1399, 15], ['FitX', 2499, 1]]) {
    for (let k = 0; k < 4; k++) {
      const d = new Date(now.getFullYear(), now.getMonth() - k, day, 7, 30);
      if (d <= now) lines.push(`${localDate(d)}T07:30:00;${ui.amountInput(c)} €;${m};Visa`);
    }
  }
  return lines.join('\n');
}

// ---------- Filter ----------
function renderFilter() {
  const count = groupByDay(state.transactions, ui.listFilter(view, state.settings.currency)).reduce((a, g) => a + g.items.length, 0);
  ui.renderFilter($('#filter-body'), state, view, count);
}

// ---------- Bearbeiten ----------
/** Art im Bearbeiten-Blatt wählen. Eine Kategorie gibt es überall außer bei Umbuchungen; „gleicht sich aus“ hat keinen eigenen Knopf. */
function setEditKind(kind) {
  view.editKind = kind;
  for (const b of document.querySelectorAll('#kind-seg button')) b.setAttribute('aria-pressed', String(b.dataset.kind === kind));
  const f = $('#edit-form');
  f.categoryId.closest('label').hidden = kind === 'transfer';
  if (kind === 'transfer') $('#rule-offer').hidden = true;
  fillAccountSelects();
  updateOwnOffer();
  $('#edit-amount-cap').textContent = kind === 'income' ? 'betrag (eingegangen)' : kind === 'balance' ? 'betrag (− = eingegangen)' : 'betrag';
}

/** Konto und Gegenkonto im Bearbeiten-Blatt: leer = erkennen lassen (der erkannte Name steht dabei). Nur, wenn es Konten gibt. */
function fillAccountSelects() {
  const f = $('#edit-form');
  const t = view.editing;
  $('#acct-row').hidden = !state.accounts.length || !t;
  if (!state.accounts.length || !t) return;
  const moving = view.editKind === 'transfer' || view.editKind === 'saving';
  const probe = { ...t, merchant: f.merchant.value, card: f.card.value, kind: view.editKind, accountId: f.accountId.value || null, toAccountId: null };
  const opts = (selected, derived) => `<option value="">${derived ? `${ui.esc(ui.accountLabel(derived))} · erkannt` : 'keins'}</option>`
    + state.accounts.map((a) => `<option value="${ui.esc(a.id)}"${a.id === selected ? ' selected' : ''}>${ui.esc(ui.accountLabel(a))}</option>`).join('');
  const from = f.accountId.dataset.filled ? f.accountId.value || null : t.accountId;
  const to = f.toAccountId.dataset.filled ? f.toAccountId.value || null : t.toAccountId;
  f.accountId.innerHTML = opts(from, accountFor({ ...probe, accountId: null }, state.accounts));
  f.toAccountId.innerHTML = opts(to, counterFor(probe, state.accounts));
  f.accountId.dataset.filled = '1';
  f.toAccountId.dataset.filled = '1';
  $('#to-field').hidden = !moving;
  $('#acct-cap').textContent = moving ? 'von' : 'konto';
}

function openEditor(id) {
  const c = clock();
  const t = id ? state.transactions.find((x) => x.id === id) : { ...emptyTransaction(null, c.today), time: c.time };
  if (!t) return;
  view.editing = t;
  const f = $('#edit-form');
  f.merchant.value = t.merchant;
  f.amount.value = id ? ui.amountInput(kindOf(t) === 'income' ? Math.abs(t.amountCents) : t.amountCents) : '';
  const cur = state.settings.currency;
  const foreign = !!id && t.currency !== cur;
  $('#base-field').hidden = !foreign;
  $('#base-cap').textContent = `abgerechnet in ${cur.toLowerCase()}`;
  f.baseAmount.value = foreign && t.baseCents !== null ? ui.amountInput(t.baseCents) : '';
  f.card.value = t.card;
  f.date.value = t.date;
  f.time.value = t.time || '';
  f.categoryId.innerHTML = `${ui.categoryOptions(t.categoryId)}<optgroup label="Zählt nicht"><option value="__transfer">Umbuchung (eigene Konten)</option></optgroup>`;
  f.note.value = t.note;
  f.excluded.checked = !!t.excluded;
  delete f.accountId.dataset.filled;
  delete f.toAccountId.dataset.filled;
  setEditKind(kindOf(t));
  if (foreign) $('#edit-amount-cap').textContent = `betrag (${t.currency.toLowerCase()})`;
  const ml = $('#edit-merchant');
  ml.hidden = !id || !t.merchant;
  ml.dataset.merchant = t.merchant;
  ml.textContent = `alle zahlungen bei ${t.merchant} ›`;
  f.rulePattern.value = suggestPattern(t.merchant);
  f.ownPattern.value = t.merchant.trim().split(/\s+/).slice(0, 2).join(' ');
  f.makeRule.checked = ruleDefault(state.transactions, f.rulePattern.value);
  $('#rule-offer').hidden = true;
  $('#edit-error').hidden = true;
  $('#edit-delete').hidden = !id;
  $('#edit-title').textContent = id ? 'buchung ändern' : 'neue buchung';
  openSheet($('#edit-dialog'));
  if (!id) f.merchant.focus();
}

/** Bei „umbuchung“: Gegenseite als eigenes Konto merken, damit es künftig von selbst passt. */
function updateOwnOffer() {
  const f = $('#edit-form');
  if (!view.editing) return;
  const to = state.accounts.find((a) => a.id === f.toAccountId.value);
  const moving = view.editKind === 'transfer' || view.editKind === 'saving';
  // Gegenkonto von Hand gewählt: den Namen an diesem Konto merken, damit es beim nächsten Mal von selbst passt.
  if (moving && to && f.merchant.value.trim()) {
    const probe = { merchant: f.merchant.value, card: f.card.value, kind: view.editKind, accountId: f.accountId.value || null, toAccountId: null };
    $('#own-text').textContent = `künftig an „${ui.accountLabel(to)}“ erkennen`;
    $('#own-offer').hidden = counterFor(probe, state.accounts)?.id === to.id;
    return;
  }
  const probe = { merchant: f.merchant.value, card: f.card.value, kind: 'expense' };
  $('#own-text').textContent = 'als eigenes Konto merken, künftig immer Umbuchung';
  $('#own-offer').hidden = !(view.editKind === 'transfer' && f.merchant.value.trim() && !isOwnAccountMove(probe, own()));
}

function updateRuleOffer() {
  const f = $('#edit-form');
  const t = view.editing;
  const cat = f.categoryId.value || null;
  const changed = cat && cat !== t.categoryId;
  if (changed && !f.rulePattern.value) f.rulePattern.value = suggestPattern(f.merchant.value);
  const already = cat && categorize(f.merchant.value, state.rules) === cat;
  $('#rule-offer').hidden = !(changed && f.rulePattern.value && !already);
}

async function saveEditor() {
  const f = $('#edit-form');
  const t = view.editing;
  const amount = parseAmount(f.amount.value);
  if (!amount || !f.merchant.value.trim() || !f.date.value) {
    $('#edit-error').textContent = 'Bitte Händler, Betrag und Datum angeben.';
    $('#edit-error').hidden = false;
    return false;
  }
  // Hat die Buchung eine Kategorie, bestimmt deren Art die der Buchung; sonst gilt der Umschalter.
  const cat = view.editKind === 'transfer' ? null : f.categoryId.value || null;
  const kind = cat ? categoryKind(state.categories, cat) : view.editKind;
  // Einnahmen stehen negativ (Geld kam rein), Sparen positiv; sonst gilt das Vorzeichen, wie eingetippt (negativ = Erstattung).
  const cents = kind === 'income' ? -Math.abs(amount.cents) : kind === 'saving' ? Math.abs(amount.cents) : amount.cents;
  const currency = amount.currency || t.currency || state.settings.currency;
  let baseCents = null;
  if (currency !== state.settings.currency && f.baseAmount.value.trim()) {
    const b = parseAmount(f.baseAmount.value);
    if (!b) {
      $('#edit-error').textContent = `Den Betrag in ${state.settings.currency} bitte als Zahl angeben, z. B. 112,40.`;
      $('#edit-error').hidden = false;
      return false;
    }
    baseCents = b.cents;
  }
  const snap = snapshot();
  const id = t.id || `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  let categoryId = cat;
  let manualCategory = t.manualCategory || (cat !== t.categoryId);
  if (kind === 'transfer') { categoryId = null; manualCategory = false; }
  let next = sanitizeTransaction({
    ...t, id, merchant: f.merchant.value, amountCents: cents, kind, currency, baseCents,
    card: f.card.value, date: f.date.value, time: f.time.value || null, categoryId, manualCategory, note: f.note.value,
    excluded: f.excluded.checked,
    accountId: state.accounts.length ? f.accountId.value || null : t.accountId,
    toAccountId: state.accounts.length && (kind === 'transfer' || kind === 'saving') ? f.toAccountId.value || null : null,
  });
  if (!next) return false;
  // Neue Buchung ohne Kategorie: die Regeln dürfen einordnen.
  if (!t.id && !cat && (kind === 'expense' || kind === 'income')) next = applyRules([next], state.rules, state.categories)[0];
  state.transactions = sortTransactions([...state.transactions.filter((x) => x.id !== id), next]);
  await saveTransactions([next]);

  const ownName = f.ownPattern.value.trim();
  const toAcc = state.accounts.find((a) => a.id === next.toAccountId);
  if (toAcc && !$('#own-offer').hidden && f.makeOwn.checked && ownName) {
    state.accounts = state.accounts.map((a) => (a.id === toAcc.id ? sanitizeAccount({ ...a, match: [...a.match, ownName] }) : a));
    await saveAccounts();
    const n = await applyTransfers();
    undoable(`„${ownName}“ gehört jetzt zu ${ui.accountLabel(toAcc)}${n ? `, ${n} weitere Umbuchungen` : ''}`, snap);
  } else if (kind === 'transfer' && !$('#own-offer').hidden && f.makeOwn.checked && ownName) {
    state.settings = sanitizeSettings({ ...state.settings, ownAccounts: [...state.settings.ownAccounts, ownName] });
    await db.setMeta('settings', state.settings);
    const n = await applyTransfers();
    undoable(`„${ownName}“ ist jetzt ein eigenes Konto${n ? `, ${n} weitere Umbuchungen` : ''}`, snap);
  } else if (!$('#rule-offer').hidden && f.makeRule.checked && f.rulePattern.value.trim() && cat) {
    const { rules, rule } = upsertRule(state.rules, f.rulePattern.value, cat, `u-${Date.now().toString(36)}`);
    state.rules = rules;
    await db.putRules([rule]);
    const n = await reapplyRules();
    undoable(`Regel „${rule.pattern}“ gespeichert${n ? `, ${n} weitere eingeordnet` : ''}`, snap);
  } else {
    const ex = next.excluded !== !!t.excluded ? (next.excluded ? ', zählt nicht mit' : ', zählt wieder mit') : '';
    undoable(`${t.id ? 'Gespeichert' : 'Buchung hinzugefügt'}${ex}`, snap);
  }
  render();
  return true;
}

/** Löschen ohne Rückfrage, dafür mit „rückgängig“. */
async function deleteEditing() {
  const t = view.editing;
  if (!t?.id) return false;
  closeSheet($('#edit-dialog'));
  const snap = snapshot();
  state.transactions = state.transactions.filter((x) => x.id !== t.id);
  await db.deleteTransaction(t.id);
  if (t.source === 'shortcut' || t.source === 'statement') {
    state.deletedIds = [...state.deletedIds, t.id];
    await db.setMeta('deletedIds', state.deletedIds);
  }
  render();
  undoable(`„${t.merchant}“ gelöscht`, snap);
  return true;
}

// ---------- Einordnen ----------
// history: Stapel der Schritte (neuester zuletzt), jeder mit Schnappschuss davor. order: Knopf-Reihenfolge, fest solange das Blatt offen ist.
const sorter = { total: 0, skipped: new Set(), history: [], order: { expense: [], income: [] } };

/** Alle Zahlungen ohne Kategorie, über alle Monate, neueste zuerst (dieselbe Zahl wie am App-Symbol). */
function sortQueue() {
  return sortTransactions(state.transactions)
    .filter((t) => needsCategory(t) && !sorter.skipped.has(t.id));
}

function renderSorter() {
  const q = sortQueue();
  const t = q[0] || null;
  ui.renderSorter($('#sort-body'), state, {
    t, pos: Math.min(sorter.total, Math.max(1, sorter.total - q.length + 1)), total: sorter.total,
    pattern: t ? suggestPattern(t.merchant) : '', history: sorter.history,
    cats: sorterCats(t && kindOf(t) === 'income' ? 'income' : 'expense'),
  }, clock());
}

const SORT_KINDS = { expense: ['expense', 'balance', 'saving'], income: ['income', 'balance'] };
/** Knöpfe in fester Reihenfolge: beim Öffnen nach Gebrauch sortiert, neu angelegte hinten dran, ausgeblendete fallen weg. */
function sorterCats(side) {
  const now = categoriesByUse(state.transactions, state.categories, SORT_KINDS[side]);
  const order = [...sorter.order[side].filter((id) => now.includes(id)), ...now.filter((id) => !sorter.order[side].includes(id))];
  sorter.order[side] = order;
  return order;
}

function openSorter() {
  clearUndo();
  sorter.skipped = new Set();
  sorter.history = [];
  sorter.order = { expense: [], income: [] };
  sorter.total = sortQueue().length;
  renderSorter();
  openSheet($('#sort-dialog'));
}

async function sortInto(categoryId) {
  const t = sortQueue()[0];
  if (!t) return;
  const snap = snapshot();
  const next = categoryId === null ? { ...t, categoryId: null, manualCategory: false, kind: 'transfer' }
    : { ...t, categoryId, manualCategory: true, kind: categoryKind(state.categories, categoryId) };
  state.transactions = state.transactions.map((x) => (x.id === t.id ? next : x));
  await saveTransactions([next]);
  let n = 0;
  const pattern = $('#sort-pattern')?.value.trim();
  if (categoryId !== null && $('#sort-make-rule')?.checked && pattern) {
    const { rules, rule } = upsertRule(state.rules, pattern, categoryId, `u-${Date.now().toString(36)}`);
    state.rules = rules;
    await db.putRules([rule]);
    n = await reapplyRules();
  }
  sorter.history.push({ snap, text: `${t.merchant} → ${categoryId === null ? 'Umbuchung' : ui.catLabel(categoryId)}${n ? ` (+${n})` : ''}` });
  renderSorter();
  render();
}

async function sorterAction(act) {
  if (act === 'close') { closeSheet($('#sort-dialog')); render(); return; }
  if (act === 'new-cat') { const t = sortQueue()[0]; openCatEditor(null, { kind: t && kindOf(t) === 'income' ? 'income' : 'expense', forSort: true }); return; }
  if (act === 'skip') { const t = sortQueue()[0]; if (t) sorter.skipped.add(t.id); }
  if (act === 'transfer') { await sortInto(null); return; }
  if (act === 'undo' && sorter.history.length) {
    const step = sorter.history.pop();
    await restore(step.snap);
    // Übersprungene bleiben übersprungen; die zurückgenommene Zahlung kommt wieder dran.
    render();
  }
  renderSorter();
}

// ---------- Budget ----------
/** Automatisch und aus gelten sofort; fester Betrag erst, wenn einer eingetragen ist. */
async function setBudgetMode(mode) {
  if (mode === 'fixed' && !state.settings.monthlyBudgetCents) { view.budgetShow = 'fixed'; render(); return; }
  view.budgetShow = null;
  if (state.settings.budgetMode === mode) { render(); return; }
  state.settings = sanitizeSettings({ ...state.settings, budgetMode: mode });
  await db.setMeta('settings', state.settings);
  render();
}

// ---------- Kategorien ----------
const KIND_HINTS = {
  expense: 'Zählt bei den Ausgaben und im Budget.',
  income: 'Zählt bei den Einnahmen.',
  balance: 'Ein- und Auszahlungen gleichen sich aus (z. B. Dienstwagen: Tanken und Kostenabrechnung). Zählt weder bei Ausgaben noch Einnahmen, ein offener Rest steht in der Übersicht.',
  saving: 'Geht vom Übrigen ab, zählt aber nicht als Ausgabe.',
};

function setCatKind(kind, locked) {
  view.catKind = kind;
  for (const b of document.querySelectorAll('#cat-kind [data-ckind]')) {
    b.setAttribute('aria-pressed', String(b.dataset.ckind === kind));
    b.disabled = locked && b.dataset.ckind !== kind;
  }
  $('#cat-kind-hint').textContent = KIND_HINTS[kind] + (locked ? ' Die Art lässt sich nur bei neuen Kategorien wählen.' : '');
}

/** Kategorie bearbeiten oder neu anlegen. `forSort`: aus dem Einordnen heraus, die Zahlung kommt danach gleich hinein. */
function openCatEditor(id, { kind = 'expense', forSort = false } = {}) {
  const c = id ? state.categories.find((x) => x.id === id) : null;
  view.catEditing = { c, forSort };
  const f = $('#cat-form');
  f.name.value = c ? c.name : '';
  f.hidden.checked = !!c?.hidden;
  setCatKind(c ? c.kind : kind, !!c);
  const others = c ? state.categories.filter((x) => x.id !== c.id && x.kind === c.kind) : [];
  $('#cat-merge').hidden = !others.length;
  f.mergeTo.innerHTML = others.map((x) => `<option value="${ui.esc(x.id)}">${ui.esc(x.name)}</option>`).join('');
  const used = c && state.transactions.some((t) => t.categoryId === c.id);
  $('#cat-delete').hidden = !(c && c.id.startsWith('c-') && !used);
  $('#cat-title').textContent = c ? 'kategorie ändern' : 'neue kategorie';
  $('#cat-error').hidden = true;
  f.hidden.closest('label').hidden = forSort;
  openSheet($('#cat-dialog'));
  if (!c) f.name.focus();
}

function catError(text) { $('#cat-error').textContent = text; $('#cat-error').hidden = false; return false; }

async function saveCatEditor() {
  const f = $('#cat-form');
  const { c, forSort } = view.catEditing;
  const name = f.name.value.trim();
  if (!name) return catError('Bitte einen Namen angeben.');
  if (state.categories.some((x) => x !== c && x.name.toLowerCase() === name.toLowerCase())) return catError('Diesen Namen gibt es schon.');
  const snap = snapshot();
  const next = { id: c ? c.id : `c-${Date.now().toString(36)}`, name, kind: c ? c.kind : view.catKind, hidden: forSort ? false : f.hidden.checked };
  setCategories(c ? state.categories.map((x) => (x.id === c.id ? next : x)) : [...state.categories, next]);
  await saveCategories();
  if (forSort) { closeSheet($('#cat-dialog'), 'save'); await sortInto(next.id); return true; }
  render();
  undoable(c ? 'Kategorie gespeichert' : `Kategorie „${name}“ angelegt`, snap);
  return true;
}

async function mergeCatEditor() {
  const { c } = view.catEditing;
  const to = $('#cat-form').mergeTo.value;
  const target = state.categories.find((x) => x.id === to);
  if (!c || !target) return;
  const n = state.transactions.filter((t) => t.categoryId === c.id).length;
  if (!(await ask(`„${c.name}“ mit „${target.name}“ zusammenlegen? ${n} Buchungen und die Regeln wandern mit.${c.id.startsWith('c-') ? ` „${c.name}“ fällt danach weg.` : ` „${c.name}“ wird ausgeblendet.`}`, 'Zusammenlegen'))) return;
  const snap = snapshot();
  const moved = mergeCategory(state.transactions, state.rules, c.id, to);
  const changedT = moved.transactions.filter((t, i) => t !== state.transactions[i]);
  state.transactions = moved.transactions;
  state.rules = orderRules(moved.rules);
  await saveTransactions(changedT);
  await saveRules();
  setCategories(c.id.startsWith('c-') ? state.categories.filter((x) => x.id !== c.id) : state.categories.map((x) => (x.id === c.id ? { ...x, hidden: true } : x)));
  await saveCategories();
  closeSheet($('#cat-dialog'));
  render();
  undoable(`Zusammengelegt mit „${target.name}“`, snap);
}

async function deleteCatEditor() {
  const { c } = view.catEditing;
  if (!c || !c.id.startsWith('c-') || state.transactions.some((t) => t.categoryId === c.id)) return;
  const snap = snapshot();
  const gone = state.rules.filter((r) => r.categoryId === c.id);
  for (const r of gone) await db.deleteRule(r.id);
  state.rules = state.rules.filter((r) => r.categoryId !== c.id);
  setCategories(state.categories.filter((x) => x.id !== c.id));
  await saveCategories();
  closeSheet($('#cat-dialog'));
  render();
  undoable(`Kategorie „${c.name}“ gelöscht`, snap);
}

// ---------- Regeln ----------
function openRuleEditor(id) {
  const r = id ? state.rules.find((x) => x.id === id) : null;
  view.editingRule = r;
  const f = $('#rule-form');
  f.pattern.value = r ? r.pattern : '';
  f.categoryId.innerHTML = ui.categoryOptions(r ? r.categoryId : 'lebensmittel', { withNone: false });
  $('#rule-title').textContent = r ? 'regel ändern' : 'neue regel';
  $('#rule-delete').hidden = !r;
  openSheet($('#rule-dialog'));
  if (!r) f.pattern.focus();
}

async function saveRuleEditor() {
  const f = $('#rule-form');
  const r = view.editingRule;
  const snap = snapshot();
  if (r) {
    const next = sanitizeRule({ id: r.id, pattern: f.pattern.value, categoryId: f.categoryId.value });
    if (!next) return false;
    const rules = editRule(state.rules, r.id, next.pattern, next.categoryId);
    for (const old of state.rules) if (!rules.some((x) => x.id === old.id)) await db.deleteRule(old.id);
    state.rules = rules;
    await db.putRules([next]);
  } else {
    const { rules, rule } = upsertRule(state.rules, f.pattern.value, f.categoryId.value, `u-${Date.now().toString(36)}`);
    if (!sanitizeRule(rule)) return false;
    state.rules = rules;
    await db.putRules([rule]);
  }
  const n = await reapplyRules();
  render();
  undoable(`Regel gespeichert${n ? `, ${n} Buchungen neu eingeordnet` : ''}`, snap);
  return true;
}

async function deleteRule(id) {
  const snap = snapshot();
  const r = state.rules.find((x) => x.id === id);
  state.rules = state.rules.filter((x) => x.id !== id);
  await db.deleteRule(id);
  await reapplyRules();
  render();
  undoable(`Regel „${r?.pattern}“ gelöscht`, snap);
}

async function restoreDefaultRules() {
  const snap = snapshot();
  const missing = DEFAULT_RULES.filter((d) => !state.rules.some((r) => r.id === d.id || r.pattern === d.pattern));
  state.rules = orderRules([...state.rules, ...missing]);
  await db.putRules(missing);
  const n = await reapplyRules();
  render();
  undoable(`${missing.length} Vorgaben wiederhergestellt${n ? `, ${n} Buchungen eingeordnet` : ''}`, snap);
}

// ---------- Konten ----------
/** Zinssatz aus der Eingabe: „2,5“ oder „2,5 %“ → 250 Basispunkte; leer → null; Unsinn → undefined. */
function parseRate(text) {
  const v = String(text || '').replace('%', '').trim().replace(',', '.');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 100 ? Math.round(n * 100) : undefined;
}

function openAccount(id) { view.accountId = id; selectTab('account'); }

function setAccountType(type) {
  view.accountType = type;
  for (const b of document.querySelectorAll('#account-type [data-atype]')) b.setAttribute('aria-pressed', String(b.dataset.atype === type));
  $('#rate-field').hidden = type === 'depot';
}

/** Konto bearbeiten oder neu anlegen (ohne Vorlage). */
function openAccountEditor(id) {
  const a = id ? state.accounts.find((x) => x.id === id) : null;
  view.accountEditing = a;
  const f = $('#account-form-sheet');
  f.bank.value = a ? a.bank : '';
  f.name.value = a ? a.name : '';
  f.rate.value = a?.rateBp ? ui.rateText(a.rateBp) : '';
  f.match.value = a ? a.match.join(', ') : '';
  f.main.checked = !!a?.main;
  f.other.checked = !!a?.other;
  setAccountType(a ? a.type : 'konto');
  $('#account-delete').hidden = !a;
  $('#account-title').textContent = a ? 'konto ändern' : 'neues konto';
  $('#account-error').hidden = true;
  openSheet($('#account-dialog'));
  if (!a) f.bank.focus();
}

async function saveAccountEditor() {
  const f = $('#account-form-sheet');
  const a = view.accountEditing;
  const err = (t) => { $('#account-error').textContent = t; $('#account-error').hidden = false; return false; };
  if (!f.name.value.trim()) return err('Bitte einen Namen angeben, z. B. Girokonto.');
  const rateBp = view.accountType === 'depot' ? null : parseRate(f.rate.value);
  if (rateBp === undefined) return err('Zinsen bitte als Zahl angeben, z. B. 2,5.');
  const snap = snapshot();
  const next = sanitizeAccount({
    ...(a || { balance: null }), id: a ? a.id : newAccountId(), bank: f.bank.value, name: f.name.value, type: view.accountType, rateBp,
    match: f.match.value.split(','), main: f.main.checked, other: f.other.checked,
  });
  state.accounts = a ? state.accounts.map((x) => (x.id === a.id ? next : x)) : [...state.accounts, next];
  await saveAccounts();
  const n = await applyTransfers();
  render();
  undoable(`${a ? 'Konto gespeichert' : `„${next.name}“ angelegt`}${n ? `, ${n} ${n === 1 ? 'Buchung ist' : 'Buchungen sind'} jetzt Umbuchungen` : ''}`, snap);
  return true;
}

/** Konto löschen: Buchungen bleiben, verlieren nur die Zuordnung (von Hand gewählte zeigen dann wieder auf „erkannt“). */
async function deleteAccountEditor() {
  const a = view.accountEditing;
  if (!a) return;
  closeSheet($('#account-dialog'));
  const snap = snapshot();
  state.accounts = state.accounts.filter((x) => x.id !== a.id);
  const changed = state.transactions.filter((t) => t.accountId === a.id || t.toAccountId === a.id)
    .map((t) => ({ ...t, accountId: t.accountId === a.id ? null : t.accountId, toAccountId: t.toAccountId === a.id ? null : t.toAccountId }));
  const byId = new Map(changed.map((t) => [t.id, t]));
  state.transactions = state.transactions.map((t) => byId.get(t.id) || t);
  state.positions = state.positions.filter((p) => p.accountId !== a.id);
  await saveTransactions(changed);
  await saveAccounts();
  await savePositions();
  if (view.tab === 'account') selectTab('accounts'); else render();
  undoable(`„${a.name}“ gelöscht, die Buchungen bleiben`, snap);
}

function openTemplate(bank = null) {
  view.tplBank = bank;
  ui.renderTemplate($('#tpl-body'), state, bank);
  openSheet($('#tpl-dialog'));
}

async function saveTemplate() {
  const t = BANK_TEMPLATES[view.tplBank];
  if (!t) return;
  const f = $('#tpl-form');
  const picks = t.accounts.map((x, i) => ({ x, i })).filter(({ i }) => f[`pick-${i}`]?.checked && !f[`pick-${i}`].disabled);
  if (!picks.length) { closeSheet($('#tpl-dialog')); return; }
  const snap = snapshot();
  const created = picks.map(({ x, i }, k) => sanitizeAccount({
    id: newAccountId(k), bank: t.bank, name: x.name, type: x.type, main: !!x.main && !state.accounts.some((a) => a.main),
    other: !!x.other, match: x.match || [], rateBp: parseRate(f[`rate-${i}`]?.value) ?? null,
  }));
  state.accounts = [...state.accounts, ...created];
  await saveAccounts();
  const n = await applyTransfers();
  closeSheet($('#tpl-dialog'), 'save');
  if (view.tab !== 'accounts') selectTab('accounts'); else render();
  undoable(`${t.bank}: ${created.length} ${created.length === 1 ? 'Konto' : 'Konten'} angelegt${n ? `, ${n} Umbuchungen erkannt` : ''}`, snap);
}

function openBalanceEditor(id) {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return;
  view.accountEditing = a;
  const f = $('#balance-form');
  f.amount.value = a.balance ? ui.amountInput(a.balance.cents) : '';
  f.date.value = clock().today;
  $('#balance-title').textContent = `stand ${a.name.toLowerCase()}`;
  $('#balance-hint').textContent = a.type === 'depot'
    ? 'Der Wert des Depots, wie ihn deine Bank zeigt.'
    : 'Wie in der Banking-App. Buchungen nach diesem Tag rechnet Taler dazu.';
  $('#balance-error').hidden = true;
  openSheet($('#balance-dialog'));
  f.amount.focus();
}

async function saveBalanceEditor() {
  const f = $('#balance-form');
  const a = view.accountEditing;
  const amount = parseAmount(f.amount.value);
  if (!amount || !f.date.value) { $('#balance-error').textContent = 'Bitte Betrag und Tag angeben.'; $('#balance-error').hidden = false; return false; }
  const snap = snapshot();
  const next = { ...a, balance: { cents: amount.cents, date: f.date.value, source: 'manual' } };
  state.accounts = state.accounts.map((x) => (x.id === a.id ? next : x));
  await saveAccounts();
  render();
  undoable('Stand gespeichert', snap);
  return true;
}

// ---------- Depots ----------
/** Stück aus der Eingabe („12,5“, „1.234,567“) in Millionstel; leer → 0; Unsinn → null. */
const parseUnits = (text) => (String(text || '').trim() ? quantityIn(`Stück ${text.trim()}`) : 0);

function setPositionKind(kind) {
  view.positionKind = kind;
  for (const b of document.querySelectorAll('#position-kind [data-pkind]')) b.setAttribute('aria-pressed', String(b.dataset.pkind === kind));
}

/** Position eintragen oder ändern. Bei einer bestehenden stehen Stück und Kaufwert inklusive der Sparplan-Käufe bis heute. */
function openPositionEditor(id, { accountId = null, isin = '', name = '' } = {}) {
  const p = id ? state.positions.find((x) => x.id === id) : null;
  const acc = state.accounts.find((a) => a.id === (p ? p.accountId : accountId));
  if (!acc) return;
  view.positionEditing = { p, accountId: acc.id };
  const v = p ? positionValue(p, state.transactions, state.accounts, state.settings.currency) : null;
  const f = $('#position-form');
  f.name.value = p ? p.name : name;
  f.isin.value = p ? p.isin : isin;
  f.units.value = v ? ui.unitsText(v.unitsMicro) : '';
  f.cost.value = v && v.costCents ? ui.amountInput(v.costCents) : '';
  f.price.value = p?.priceCents != null ? ui.amountInput(p.priceCents) : '';
  f.priceDate.value = p?.priceDate || clock().today;
  f.plan.checked = p ? p.plan : !!isin;
  setPositionKind(p ? p.kind : 'etf');
  $('#position-hint').textContent = `im ${acc.name === 'Depot' ? `Depot von ${acc.bank}` : acc.name}`;
  $('#position-title').textContent = p ? 'position ändern' : 'aktie oder etf';
  $('#position-delete').hidden = !p;
  $('#position-error').hidden = true;
  openSheet($('#position-dialog'));
  if (!p && !name) f.name.focus();
}

async function savePositionEditor() {
  const f = $('#position-form');
  const { p, accountId } = view.positionEditing;
  const err = (t) => { $('#position-error').textContent = t; $('#position-error').hidden = false; return false; };
  const units = parseUnits(f.units.value);
  const cost = f.cost.value.trim() ? parseAmount(f.cost.value) : { cents: 0 };
  const price = f.price.value.trim() ? parseAmount(f.price.value) : null;
  if (!f.name.value.trim()) return err('Bitte einen Namen angeben.');
  if (units === null) return err('Stück bitte als Zahl angeben, z. B. 12,5.');
  if (!cost || (f.price.value.trim() && !price)) return err('Beträge bitte als Zahl angeben, z. B. 1.250,00.');
  const today = clock().today;
  const snap = snapshot();
  const next = sanitizePosition({
    id: p ? p.id : `p-${Date.now().toString(36)}`, accountId, name: f.name.value, isin: f.isin.value, kind: view.positionKind,
    unitsMicro: units, costCents: Math.abs(cost.cents), date: today,
    priceCents: price ? Math.abs(price.cents) : p?.priceCents ?? null, priceDate: price ? f.priceDate.value || today : p?.priceDate ?? null,
    plan: f.plan.checked,
  });
  if (!next) return err('Bitte Name und Datum prüfen.');
  state.positions = p ? state.positions.map((x) => (x.id === p.id ? next : x)) : [...state.positions, next];
  await savePositions();
  render();
  undoable(p ? 'Position gespeichert' : `„${next.name}“ eingetragen`, snap);
  return true;
}

async function deletePositionEditor() {
  const { p } = view.positionEditing;
  if (!p) return;
  closeSheet($('#position-dialog'));
  const snap = snapshot();
  state.positions = state.positions.filter((x) => x.id !== p.id);
  await savePositions();
  render();
  undoable(`„${p.name}“ gelöscht`, snap);
}

function openPrices(accountId) {
  view.pricesAccount = accountId;
  ui.renderPrices($('#prices-body'), state, accountId, clock().today);
  openSheet($('#prices-dialog'));
}

// ---------- Kurse aus dem Netz ----------
const PRICE_ERRORS = {
  key: 'Kurse: Der Schlüssel stimmt nicht. Bitte in den Einstellungen prüfen.',
  limit: 'Kurse: Für heute sind die kostenlosen Abrufe aufgebraucht. Morgen geht es wieder.',
  net: 'Kurse: Gerade nicht erreichbar. Später noch einmal versuchen.',
};

/** Holt die Schlusskurse aller Positionen mit ISIN. still = automatisch beim Start, dann nur bei Änderungen ein Hinweis. */
async function fetchPrices({ quiet = false } = {}) {
  const isins = isinsToFetch(state.positions);
  if (!info.priceKey || !isins.length || info.fetchingPrices) return;
  info.fetchingPrices = true;
  if (!quiet) { render(); toast('Kurse werden geholt …'); }
  const quotes = new Map();
  const missing = [];
  let failure = null;
  for (const isin of isins) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(searchUrl(isin, info.priceKey), { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) { failure = failureKind(res.status); break; }
      const q = pickQuote(await res.json(), isin, state.settings.currency);
      if (q) quotes.set(isin, q); else missing.push(isin);
    } catch {
      failure = 'net';
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  info.fetchingPrices = false;
  info.priceFetch = { date: clock().today, ok: !failure };
  await db.setMeta('priceFetch', info.priceFetch);
  const { positions, changed } = applyQuotes(state.positions, quotes);
  if (changed) {
    state.positions = positions;
    await savePositions();
  }
  render();
  if (failure && (!quiet || failure === 'key')) { toast(PRICE_ERRORS[failure]); return; }
  if (quiet && !changed) return;
  const names = missing.map((i) => state.positions.find((p) => p.isin === i)?.name || i);
  const msg = changed ? `${changed} ${changed === 1 ? 'Kurs' : 'Kurse'} aus dem Netz geholt` : 'Kurse sind schon aktuell';
  toast(names.length ? `${msg}. Ohne Kurs in ${state.settings.currency}: ${names.join(', ')}` : msg);
}

/** Einmal am Tag von selbst, wenn ein Schlüssel da ist. */
function pricesDue() {
  return !!info.priceKey && info.priceFetch?.date !== clock().today && isinsToFetch(state.positions).length > 0;
}

async function savePriceKey(key) {
  info.priceKey = key || null;
  info.priceFetch = null;
  await db.setMeta('priceKey', info.priceKey);
  await db.setMeta('priceFetch', null);
  render();
  if (info.priceKey) {
    if (isinsToFetch(state.positions).length) await fetchPrices();
    else toast('Schlüssel gespeichert');
  } else toast('Schlüssel entfernt, Kurse wieder von Hand');
}

async function savePrices() {
  const f = $('#prices-form');
  const date = f.date.value || clock().today;
  const updates = new Map();
  for (const p of state.positions.filter((x) => x.accountId === view.pricesAccount)) {
    const v = f[`price-${p.id}`]?.value.trim();
    if (!v) continue;
    const a = parseAmount(v);
    if (!a) { toast(`Kurs für „${p.name}“ bitte als Zahl angeben`); return false; }
    updates.set(p.id, { ...p, priceCents: Math.abs(a.cents), priceDate: date });
  }
  if (!updates.size) return true;
  const snap = snapshot();
  state.positions = state.positions.map((p) => updates.get(p.id) || p);
  await savePositions();
  render();
  undoable(`${updates.size} ${updates.size === 1 ? 'Kurs' : 'Kurse'} gespeichert`, snap);
  return true;
}

/** Buchungen eines Kontos in der Liste: eigene und Umbuchungen dorthin, alle Monate. */
function showAccountList(id) {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return;
  const ids = new Set(state.transactions.filter((t) => accountFor(t, state.accounts)?.id === a.id || counterFor(t, state.accounts)?.id === a.id).map((t) => t.id));
  Object.assign(view, { listKind: undefined, listCats: [], listSources: [], hideExcluded: false, listMerchant: null, query: '', listMonth: null });
  view.listAccount = { id: a.id, name: a.name, ids };
  view.from = 'account';
  selectTab('list', { keepFrom: true });
}

// ---------- Sheets: Hintergrund tippen oder nach unten wischen schließt ----------
function openSheet(d) { clearUndo(); d.style.transform = ''; d.returnValue = ''; d.showModal(); }
function closeSheet(d, value = 'cancel') { if (d.open) d.close(value); }

function bindSheet(d) {
  d.addEventListener('click', (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeSheet(d);
  });
  let startY = null;
  let dy = 0;
  d.addEventListener('touchstart', (e) => {
    const r = d.getBoundingClientRect();
    // Nur am Griff bzw. Kopf und nur, wenn das Sheet ganz oben ist, damit Scrollen und Eingaben ungestört bleiben.
    if (d.scrollTop > 0 || e.touches[0].clientY - r.top > 64) { startY = null; return; }
    startY = e.touches[0].clientY;
    dy = 0;
  }, { passive: true });
  d.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    d.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  d.addEventListener('touchend', () => {
    if (startY === null) return;
    startY = null;
    if (dy > 90) closeSheet(d);
    d.style.transform = '';
  });
}

// ---------- Ereignisse ----------
function bind() {
  for (const a of document.querySelectorAll('.tabbar a')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (a.dataset.tab === 'list') { view.listCats = []; view.listMerchant = null; view.listAccount = null; }
      selectTab(a.dataset.tab);
    });
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'month' && b.dataset.month) { view.month = b.dataset.month; view.importReport = ''; render(); if (b.closest('.review')) window.scrollTo(0, 0); }
    if (act === 'goto') selectTab(b.dataset.tab);
    if (act === 'back') {
      if (b.dataset.tab === 'overview') { view.listCats = []; view.listMerchant = null; }
      selectTab(b.dataset.tab);
    }
    if (act === 'filter-cat' || act === 'filter-merchant' || act === 'show-merchant') {
      const merchant = act !== 'filter-cat';
      // Händler: alle Zahlungen dort, nicht nur dieser Monat.
      Object.assign(view, { listKind: undefined, listSources: [], hideExcluded: false, listCats: merchant ? [] : [b.dataset.cat || null], listAccount: null });
      view.listMerchant = merchant ? b.dataset.merchant : null;
      view.listMonth = merchant ? null : view.month;
      view.lastListMonth = view.month;
      view.query = '';
      const from = view.tab === 'overview' ? 'overview' : null;
      if (act === 'show-merchant') closeSheet($('#edit-dialog'));
      view.from = from;
      selectTab('list', { keepFrom: true });
    }
    if (act === 'review-dismiss') {
      info.reviewDismissed = b.dataset.month;
      await db.setMeta('reviewDismissed', info.reviewDismissed);
      render();
    }
    if (act === 'list-month' && b.dataset.month) { view.listMonth = b.dataset.month; view.lastListMonth = b.dataset.month; render(); }
    if (act === 'list-scope') { view.listMonth = b.dataset.scope === 'all' ? null : view.lastListMonth; render(); }
    if (act === 'clear-cat') { view.listCats = view.listCats.filter((c) => c !== (b.dataset.cat || null)); render(); }
    if (act === 'clear-source') { view.listSources = view.listSources.filter((k) => k !== b.dataset.source); render(); }
    if (act === 'clear-excluded') { view.hideExcluded = false; render(); }
    if (act === 'list-kind') { view.listKind = b.dataset.kind || undefined; render(); }
    if (act === 'list-sort') { view.sort = { new: 'old', old: 'big', big: 'new' }[view.sort]; render(); }
    if (act === 'open-filter') { renderFilter(); openSheet($('#filter-dialog')); }
    if (act === 'clear-merchant') { view.listMerchant = null; render(); }
    if (act === 'kind-list') {
      Object.assign(view, { listKind: b.dataset.kind, listCats: [], listSources: [], hideExcluded: false, listMerchant: null, query: '', listAccount: null });
      view.listMonth = view.month;
      view.lastListMonth = view.month;
      view.from = 'overview';
      selectTab('list', { keepFrom: true });
    }
    if (act === 'edit') openEditor(b.dataset.id);
    if (act === 'open-account') openAccount(b.dataset.id);
    if (act === 'template') openTemplate(b.dataset.bank || null);
    if (act === 'new-account') openAccountEditor(null);
    if (act === 'edit-account') openAccountEditor(b.dataset.id);
    if (act === 'edit-balance') openBalanceEditor(b.dataset.id);
    if (act === 'account-list') showAccountList(b.dataset.id);
    if (act === 'new-position') openPositionEditor(null, { accountId: b.dataset.account, isin: b.dataset.isin || '', name: b.dataset.name || '' });
    if (act === 'edit-position') openPositionEditor(b.dataset.id);
    if (act === 'edit-prices') openPrices(b.dataset.id);
    if (act === 'fetch-prices') fetchPrices();
    if (act === 'goto-prices') { selectTab('settings'); $('#price-key')?.scrollIntoView({ block: 'center' }); }
    if (act === 'remove-price-key') savePriceKey(null);
    if (act === 'clear-account') { view.listAccount = null; if (view.from === 'account') view.from = null; render(); }
    if (act === 'sort') openSorter();
    if (act === 'setup') { selectTab('settings'); const d = $('#setup-details'); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } }
    if (act === 'edit-rule') openRuleEditor(b.dataset.id);
    if (act === 'edit-cat') openCatEditor(b.dataset.id);
    if (act === 'new-cat') openCatEditor(null);
    if (act === 'budget-mode') await setBudgetMode(b.dataset.mode);
    if (act === 'remove-account') {
      const snap = snapshot();
      state.settings = sanitizeSettings({ ...state.settings, ownAccounts: state.settings.ownAccounts.filter((a) => a !== b.dataset.name) });
      await db.setMeta('settings', state.settings);
      render();
      undoable(`„${b.dataset.name}“ entfernt. Bisherige Umbuchungen bleiben.`, snap);
    }
    if (act === 'new-rule') openRuleEditor(null);
    if (act === 'restore-std') await restoreDefaultRules();
    if (act === 'demo') await importLog(demoLog(), { demo: true });
    if (act === 'demo-remove') await removeDemo();
    if (act === 'export-csv') await saveFile(`taler-${clock().today}.csv`, ui.buildCsv(state.transactions), 'text/csv;charset=utf-8');
    if (act === 'export-json') await saveBackup();
    if (act === 'reset' && await ask('Wirklich alle Buchungen, Regeln und Einstellungen löschen? Die Datei aus dem Kurzbefehl bleibt erhalten.', 'Alles löschen', { danger: true })) {
      await db.clear();
      Object.assign(state, { transactions: [], rules: orderRules(DEFAULT_RULES), settings: { ...DEFAULT_SETTINGS }, deletedIds: [], accounts: [], positions: [] });
      setCategories(DEFAULT_CATEGORIES);
      view.budgetShow = null;
      await saveRules();
      await saveCategories();
      await db.setMeta('initialized', true);
      info.lastImport = null;
      info.lastBackup = null;
      info.priceKey = null;
      info.priceFetch = null;
      view.importReport = '';
      render();
      toast('Alles gelöscht');
    }
  });

  $('#toast-action').addEventListener('click', async () => {
    const a = toastAction;
    $('#toast').hidden = true;
    toastAction = null;
    if (a) await a.run();
  });

  $('#sort-dialog').addEventListener('click', async (e) => {
    const c = e.target.closest('[data-sort-cat]');
    if (c) { await sortInto(c.dataset.sortCat); return; }
    const a = e.target.closest('[data-sort]');
    if (a) await sorterAction(a.dataset.sort);
  });
  $('#sort-dialog').addEventListener('close', () => render());
  $('#filter-dialog').addEventListener('close', () => render());
  $('#filter-dialog').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
    const act = b.dataset.filter;
    if (act === 'cat') view.listCats = toggle(view.listCats, b.dataset.cat || null);
    if (act === 'source') view.listSources = toggle(view.listSources, b.dataset.source);
    if (act === 'excluded') view.hideExcluded = b.checked;
    if (act === 'reset') Object.assign(view, { listCats: [], listSources: [], hideExcluded: false });
    if (act === 'close') { closeSheet($('#filter-dialog')); return; }
    renderFilter();
  });
  // Art der Buchung im Bearbeiten-Blatt
  $('#kind-seg').addEventListener('click', (e) => {
    const k = e.target.closest('[data-kind]')?.dataset.kind;
    if (!k) return;
    setEditKind(k);
    const f = $('#edit-form');
    if (f.categoryId.value && categoryKind(state.categories, f.categoryId.value) !== k) f.categoryId.value = '';
  });

  document.addEventListener('change', async (e) => {
    if (e.target.id === 'statement-file') {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) await importStatement(file);
      return;
    }
    if (e.target.id === 'log-file' || e.target.id === 'backup-file') {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      e.target.value = '';
      if (e.target.id === 'log-file') await importLog(text); else await restoreBackup(text);
    }
  });

  // Auf- und Zuklappen merken (toggle steigt nicht auf, daher capture).
  document.addEventListener('toggle', (e) => {
    const k = e.target.dataset?.fold;
    if (!k || !(k in view.folds)) return;
    view.folds[k] = e.target.open;
    try { localStorage.setItem(`taler:${k}`, e.target.open ? 'auf' : 'zu'); } catch { /* egal */ }
  }, true);

  // Verlauf: antippen oder ziehen zeigt den Tag, loslassen springt zurück auf heute.
  const curveAt = (e) => {
    const plot = e.target.closest?.('.curve .plot');
    if (!plot) return;
    const fig = plot.closest('.curve');
    const r = plot.getBoundingClientRect();
    showCurveDay(fig, Math.floor((e.clientX - r.left) / r.width * Number(fig.dataset.days)) + 1);
  };
  document.addEventListener('pointerdown', curveAt);
  document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) curveAt(e); });
  const curveReset = (e) => {
    const fig = e.target.closest?.('.curve');
    if (fig) showCurveDay(fig, null);
  };
  document.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') curveReset(e); });
  document.addEventListener('pointercancel', curveReset);
  document.addEventListener('pointerleave', (e) => { if (e.target.classList?.contains('plot')) curveReset(e); }, true);

  let qTimer;
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'f-query') return;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      view.query = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const q = $('#f-query'); q.focus(); q.setSelectionRange(pos, pos);
    }, 200);
  });

  document.addEventListener('submit', async (e) => {
    if (e.target.id === 'account-form') {
      e.preventDefault();
      const name = e.target.account.value.trim();
      if (!name) return;
      const snap = snapshot();
      state.settings = sanitizeSettings({ ...state.settings, ownAccounts: [...state.settings.ownAccounts, name] });
      await db.setMeta('settings', state.settings);
      const n = await applyTransfers();
      render();
      undoable(`„${name}“ hinzugefügt${n ? `, ${n} ${n === 1 ? 'Buchung ist' : 'Buchungen sind'} jetzt Umbuchungen` : ''}`, snap);
    }
    if (e.target.id === 'price-key-form') {
      e.preventDefault();
      const key = e.target.key.value.trim();
      if (!/^[\w.-]{8,80}$/.test(key)) { toast('Bitte den Schlüssel von EODHD vollständig einfügen'); return; }
      await savePriceKey(key);
    }
    if (e.target.id === 'budget-form') {
      e.preventDefault();
      const snap = snapshot();
      const v = e.target.budget.value.trim();
      const a = v ? parseAmount(v) : null;
      if (v && !a) { toast('Bitte einen Betrag wie 1500 angeben'); return; }
      const since = state.settings.monthlyBudgetCents && state.settings.budgetSince ? state.settings.budgetSince : clock().month;
      state.settings = sanitizeSettings({ ...state.settings, monthlyBudgetCents: a ? a.cents : null, budgetSince: since, budgetMode: a ? 'fixed' : 'off' });
      view.budgetShow = null;
      await db.setMeta('settings', state.settings);
      render();
      undoable(state.settings.monthlyBudgetCents ? 'Budget gespeichert' : 'Budget entfernt', snap);
    }
  });

  const f = $('#edit-form');
  const refreshAccounts = () => { fillAccountSelects(); updateOwnOffer(); };
  f.merchant.addEventListener('input', refreshAccounts);
  f.card.addEventListener('input', refreshAccounts);
  f.accountId.addEventListener('change', () => { fillAccountSelects(); updateOwnOffer(); });
  f.toAccountId.addEventListener('change', updateOwnOffer);
  f.categoryId.addEventListener('change', () => {
    if (f.categoryId.value === '__transfer') { f.categoryId.value = ''; setEditKind('transfer'); return; }
    if (f.categoryId.value) setEditKind(categoryKind(state.categories, f.categoryId.value));
    updateRuleOffer();
  });
  f.addEventListener('submit', async (e) => {
    const action = e.submitter?.value;
    if (action === 'save') { e.preventDefault(); if (await saveEditor()) closeSheet($('#edit-dialog'), 'save'); }
    if (action === 'delete') { e.preventDefault(); await deleteEditing(); }
  });
  const rf = $('#rule-form');
  rf.addEventListener('submit', async (e) => {
    const action = e.submitter?.value;
    if (action === 'save') { e.preventDefault(); if (await saveRuleEditor()) closeSheet($('#rule-dialog'), 'save'); }
    if (action === 'delete') { e.preventDefault(); closeSheet($('#rule-dialog')); await deleteRule(view.editingRule.id); }
  });
  const cf = $('#cat-form');
  cf.addEventListener('submit', async (e) => {
    const action = e.submitter?.value;
    if (action === 'save') { e.preventDefault(); if (await saveCatEditor()) closeSheet($('#cat-dialog'), 'save'); }
    if (action === 'merge') { e.preventDefault(); await mergeCatEditor(); }
    if (action === 'delete') { e.preventDefault(); await deleteCatEditor(); }
  });
  $('#cat-kind').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ckind]');
    if (b && !b.disabled) setCatKind(b.dataset.ckind, false);
  });
  const af = $('#account-form-sheet');
  af.addEventListener('submit', async (e) => {
    const action = e.submitter?.value;
    if (action === 'save') { e.preventDefault(); if (await saveAccountEditor()) closeSheet($('#account-dialog'), 'save'); }
    if (action === 'delete') { e.preventDefault(); await deleteAccountEditor(); }
  });
  $('#account-type').addEventListener('click', (e) => {
    const t = e.target.closest('[data-atype]')?.dataset.atype;
    if (t) setAccountType(t);
  });
  $('#position-form').addEventListener('submit', async (e) => {
    const action = e.submitter?.value;
    if (action === 'save') { e.preventDefault(); if (await savePositionEditor()) closeSheet($('#position-dialog'), 'save'); }
    if (action === 'delete') { e.preventDefault(); await deletePositionEditor(); }
  });
  $('#position-kind').addEventListener('click', (e) => {
    const k = e.target.closest('[data-pkind]')?.dataset.pkind;
    if (k) setPositionKind(k);
  });
  $('#prices-dialog').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    if (await savePrices()) closeSheet($('#prices-dialog'), 'save');
  });
  $('#balance-form').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    if (await saveBalanceEditor()) closeSheet($('#balance-dialog'), 'save');
  });
  $('#tpl-dialog').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tpl]');
    if (!b) return;
    if (b.dataset.tpl === 'other') { closeSheet($('#tpl-dialog')); openAccountEditor(null); return; }
    view.tplBank = b.dataset.tpl;
    ui.renderTemplate($('#tpl-body'), state, view.tplBank);
  });
  $('#tpl-dialog').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    await saveTemplate();
  });
  for (const d of document.querySelectorAll('dialog.sheet')) bindSheet(d);
  $('#add-btn').addEventListener('click', () => openEditor(null));
}

// ---------- Start ----------
async function start() {
  try {
    db = await open();
  } catch {
    // Ohne Speicher wäre jede Eingabe beim Schließen verloren, also lieber gar nicht erst starten.
    $('#view-overview').innerHTML = '<div class="note err"><span class="cap">kein speicher</span>Taler kann auf diesem Gerät nichts speichern. Ist das ein privates Fenster? Dann Taler normal in Safari oder vom Home-Bildschirm öffnen.</div>';
    return;
  }
  info.standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  state.transactions = sortTransactions((await db.allTransactions()).map(sanitizeTransaction).filter(Boolean));
  state.settings = sanitizeSettings(await db.getMeta('settings'));
  state.deletedIds = (await db.getMeta('deletedIds')) || [];
  info.lastImport = await db.getMeta('lastImport');
  info.lastBackup = await db.getMeta('lastBackup');
  info.reviewDismissed = await db.getMeta('reviewDismissed');
  info.priceKey = await db.getMeta('priceKey');
  info.priceFetch = await db.getMeta('priceFetch');
  if (!(await db.getMeta('initialized'))) {
    await db.putRules(DEFAULT_RULES);
    await db.setMeta('initialized', true);
  }
  state.rules = orderRules((await db.allRules()).map(sanitizeRule).filter(Boolean));
  setCategories(withDefaults(sanitizeCategories(await db.getMeta('categories'))));
  const storedAccounts = await db.getMeta('accounts');
  state.accounts = sanitizeAccounts(storedAccounts);
  state.positions = sanitizePositions(await db.getMeta('positions'));
  // Einmalig: Aus der Liste „eigene Konten“ werden Konten (ING, Trade Republic), sobald es echte Buchungen gibt.
  if (storedAccounts === null && state.transactions.some((t) => t.source === 'statement' || t.source === 'shortcut')) {
    const m = migrateOwnAccounts(state.settings.ownAccounts, newAccountId);
    state.accounts = sanitizeAccounts(m.accounts);
    state.settings = sanitizeSettings({ ...state.settings, ownAccounts: m.ownAccounts });
    await saveAccounts();
    await db.setMeta('settings', state.settings);
  }
  bind();
  let tab = 'overview';
  try { tab = sessionStorage.getItem('taler:tab') || tab; } catch { /* egal */ }
  selectTab(tab);
  // Einmalig: Umbuchungen im Bestand nachträglich erkennen (eigene Konten, Gegenstücke bis 7 Tage, auch Apple Pay).
  if ((await db.getMeta('transferScan')) !== 1) {
    const snap = snapshot();
    const n = await applyTransfers({ pairs: true });
    await db.setMeta('transferScan', 1);
    if (n) { render(); undoable(`${n} ${n === 1 ? 'Buchung ist' : 'Buchungen sind'} jetzt Umbuchungen zwischen deinen Konten`, snap); }
  }
  if (pricesDue()) fetchPrices({ quiet: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && pricesDue()) fetchPrices({ quiet: true }); });
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) toast('Neue Version bereit', { label: 'neu laden', run: () => location.reload() });
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
