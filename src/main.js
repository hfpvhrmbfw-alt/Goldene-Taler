// Start, Aktionen, Ereignisse. Einzige Stelle, die die Uhr liest.
import { open } from './storage.js';
import {
  sanitizeTransaction, sanitizeRule, sanitizeSettings, DEFAULT_SETTINGS, emptyTransaction, buildExport, parseImport,
} from './model.js';
import {
  parseLog, parseAmount, applyRules, mergeTransactions, orderRules, upsertRule, editRule, categorize, suggestPattern,
  sortTransactions, monthOf, findCrossDuplicates,
} from './logic.js';
import { parseStatement } from './statement.js';
import { pdfPages } from './pdf.js';
import { DEFAULT_RULES } from './catalog.js';
import { IMPORT_ERRORS, CATEGORY_LABELS, STATEMENT_ERRORS } from './texts.js';
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
const state = { transactions: [], rules: [], settings: { ...DEFAULT_SETTINGS }, deletedIds: [] };
const view = {
  tab: 'overview', month: clock().month,
  listMonth: clock().month, lastListMonth: clock().month, listCategory: undefined, listMerchant: null, query: '', from: null,
  importReport: '', fresh: new Set(), editing: null, editingRule: null,
};
const info = { lastImport: null, lastBackup: null, reviewDismissed: null, storageKind: 'indexeddb', standalone: false, version: '' };

// ---------- Speichern ----------
async function saveTransactions(list) { await db.putTransactions(list); }
async function saveRules() { await db.putRules(state.rules); }

/** Regeln neu anwenden und geänderte Buchungen speichern. */
async function reapplyRules() {
  const before = new Map(state.transactions.map((t) => [t.id, t.categoryId]));
  state.transactions = applyRules(state.transactions, state.rules);
  const changed = state.transactions.filter((t) => before.get(t.id) !== t.categoryId);
  if (changed.length) await saveTransactions(changed);
  return changed.length;
}

// ---------- Rückgängig ----------
// Der Zustand wird nie verändert, nur ersetzt. Ein Schnappschuss sind daher nur die alten Verweise.
const snapshot = () => ({ transactions: state.transactions, rules: state.rules, deletedIds: state.deletedIds, settings: state.settings });

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
  await db.setMeta('deletedIds', state.deletedIds);
  await db.setMeta('settings', state.settings);
}

/** Meldung mit „rückgängig“, das den Stand vor der Aktion wiederherstellt. */
function undoable(msg, snap) {
  toast(msg, {
    label: 'rückgängig',
    async run() { await restore(snap); render(); toast('Rückgängig gemacht'); },
  });
}

// ---------- Rendering ----------
const TABS = { overview: 'Übersicht', list: 'Buchungen', settings: 'Einstellungen', rules: 'Regeln' };
const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

function render() {
  const c = clock();
  const el = $(`#view-${view.tab}`);
  if (view.tab === 'overview') ui.renderOverview(el, state, view, c, info);
  if (view.tab === 'list') ui.renderList(el, state, view, c);
  if (view.tab === 'settings') ui.renderSettings(el, state, view, info, c);
  if (view.tab === 'rules') ui.renderRules(el, state);
  document.title = `Taler · ${TABS[view.tab]}`;
  $('#add-btn').hidden = !(view.tab === 'overview' || view.tab === 'list');
  const back = view.tab === 'rules' ? ['settings', 'einstellungen'] : view.tab === 'list' && view.from === 'overview' ? ['overview', 'übersicht'] : null;
  $('#head-left').innerHTML = back
    ? `<button class="backbtn" type="button" data-act="back" data-tab="${back[0]}">${BACK}<span>${back[1]}</span></button>` : '';
  updateBadge();
}

/** Zahl am Home-Bildschirm-Icon: Zahlungen ohne Kategorie (iOS 16.4+, nur installiert). */
function updateBadge() {
  const n = state.transactions.filter((t) => !t.categoryId && !t.excluded).length;
  try {
    if (n && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {});
    else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch { /* nicht unterstützt */ }
}

function selectTab(tab, { keepFrom = false } = {}) {
  if (!TABS[tab]) tab = 'overview';
  if (tab !== 'overview') view.importReport = '';
  view.tab = tab;
  if (!keepFrom) view.from = null;
  const navTab = tab === 'rules' ? 'settings' : tab;
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

async function importLog(text, { demo = false } = {}) {
  const snap = snapshot();
  const parsed = parseLog(text, state.settings.currency);
  let incoming = parsed.transactions;
  let dupes = 0;
  if (demo) incoming = incoming.map((t) => ({ ...t, id: t.id.replace(/^sc-/, 'demo-'), source: 'demo' }));
  else ({ incoming, dupes } = withoutCrossDuplicates(incoming));
  const categorized = applyRules(incoming, state.rules);
  const { transactions: merged, added } = mergeTransactions(state.transactions, categorized, state.deletedIds);
  state.transactions = merged;
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
  const { incoming, dupes } = withoutCrossDuplicates(r.transactions);
  const { transactions: merged, added } = mergeTransactions(state.transactions, applyRules(incoming, state.rules), state.deletedIds);
  state.transactions = merged;
  if (added.length) await saveTransactions(added);
  view.importReport = ui.statementReportHtml(r.bank, added.length, incoming.length - added.length, dupes, r.other, r.errors);
  view.fresh = new Set(added.map((t) => t.id));
  if (added.length) view.month = monthOf(sortTransactions(added)[0].date);
  selectTab('overview');
  if (added.length) undoable(`${added.length} ${added.length === 1 ? 'Zahlung' : 'Zahlungen'} aus dem Kontoauszug`, snap);
  else toast('Keine neuen Zahlungen');
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
  await saveTransactions(state.transactions);
  await saveRules();
  await db.setMeta('settings', state.settings);
  await db.setMeta('deletedIds', state.deletedIds);
  await db.setMeta('initialized', true);
  if (info.lastImport) await db.setMeta('lastImport', info.lastImport);
  if (info.lastBackup) await db.setMeta('lastBackup', info.lastBackup);
  render();
  toast(r.skipped ? `Geladen, ${r.skipped} fehlerhafte Einträge übersprungen` : 'Sicherung geladen');
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

// ---------- Bearbeiten ----------
function openEditor(id) {
  const c = clock();
  const t = id ? state.transactions.find((x) => x.id === id) : { ...emptyTransaction(null, c.today), time: c.time };
  if (!t) return;
  view.editing = t;
  const f = $('#edit-form');
  f.merchant.value = t.merchant;
  f.amount.value = id ? ui.amountInput(t.amountCents) : '';
  f.card.value = t.card;
  f.date.value = t.date;
  f.time.value = t.time || '';
  f.categoryId.innerHTML = ui.categoryOptions(t.categoryId);
  f.note.value = t.note;
  f.excluded.checked = !!t.excluded;
  const ml = $('#edit-merchant');
  ml.hidden = !id || !t.merchant;
  ml.dataset.merchant = t.merchant;
  ml.textContent = `alle zahlungen bei ${t.merchant} ›`;
  f.rulePattern.value = suggestPattern(t.merchant);
  $('#rule-offer').hidden = true;
  $('#edit-error').hidden = true;
  $('#edit-delete').hidden = !id;
  $('#edit-title').textContent = id ? 'buchung ändern' : 'neue buchung';
  openSheet($('#edit-dialog'));
  if (!id) f.merchant.focus();
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
  const snap = snapshot();
  const cat = f.categoryId.value || null;
  const id = t.id || `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  let categoryId = cat;
  let manualCategory = t.manualCategory || (cat !== t.categoryId);
  if (!t.id && !cat) { categoryId = categorize(f.merchant.value, state.rules); manualCategory = false; }
  const next = sanitizeTransaction({
    ...t, id, merchant: f.merchant.value, amountCents: amount.cents, currency: amount.currency || t.currency || state.settings.currency,
    card: f.card.value, date: f.date.value, time: f.time.value || null, categoryId, manualCategory, note: f.note.value,
    excluded: f.excluded.checked,
  });
  if (!next) return false;
  state.transactions = sortTransactions([...state.transactions.filter((x) => x.id !== id), next]);
  await saveTransactions([next]);

  if (!$('#rule-offer').hidden && f.makeRule.checked && f.rulePattern.value.trim() && cat) {
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
const sorter = { total: 0, skipped: new Set(), last: null };

function sortQueue() {
  return sortTransactions(state.transactions)
    .filter((t) => !t.categoryId && !t.excluded && monthOf(t.date) === view.month && !sorter.skipped.has(t.id));
}

function renderSorter() {
  const q = sortQueue();
  const t = q[0] || null;
  ui.renderSorter($('#sort-body'), state, {
    t, pos: Math.min(sorter.total, Math.max(1, sorter.total - q.length + 1)), total: sorter.total,
    pattern: t ? suggestPattern(t.merchant) : '', last: sorter.last,
  }, clock());
}

function openSorter() {
  sorter.skipped = new Set();
  sorter.last = null;
  sorter.total = sortQueue().length;
  renderSorter();
  openSheet($('#sort-dialog'));
}

async function sortInto(categoryId) {
  const t = sortQueue()[0];
  if (!t) return;
  const snap = snapshot();
  const next = { ...t, categoryId, manualCategory: true };
  state.transactions = state.transactions.map((x) => (x.id === t.id ? next : x));
  await saveTransactions([next]);
  let n = 0;
  const pattern = $('#sort-pattern')?.value.trim();
  if ($('#sort-make-rule')?.checked && pattern) {
    const { rules, rule } = upsertRule(state.rules, pattern, categoryId, `u-${Date.now().toString(36)}`);
    state.rules = rules;
    await db.putRules([rule]);
    n = await reapplyRules();
  }
  sorter.last = { snap, text: `${t.merchant} → ${CATEGORY_LABELS[categoryId]}${n ? ` (+${n})` : ''}` };
  renderSorter();
  render();
}

async function sorterAction(act) {
  if (act === 'close') { closeSheet($('#sort-dialog')); render(); return; }
  if (act === 'skip') { const t = sortQueue()[0]; if (t) sorter.skipped.add(t.id); }
  if (act === 'undo' && sorter.last) { await restore(sorter.last.snap); sorter.last = null; render(); }
  renderSorter();
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

// ---------- Sheets: Hintergrund tippen oder nach unten wischen schließt ----------
function openSheet(d) { d.style.transform = ''; d.returnValue = ''; d.showModal(); }
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
      if (a.dataset.tab === 'list') { view.listCategory = undefined; view.listMerchant = null; }
      selectTab(a.dataset.tab);
    });
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'month' && b.dataset.month) { view.month = b.dataset.month; render(); if (b.closest('.review')) window.scrollTo(0, 0); }
    if (act === 'goto') selectTab(b.dataset.tab);
    if (act === 'back') {
      if (b.dataset.tab === 'overview') { view.listCategory = undefined; view.listMerchant = null; }
      selectTab(b.dataset.tab);
    }
    if (act === 'filter-cat' || act === 'filter-merchant' || act === 'show-merchant') {
      const merchant = act !== 'filter-cat';
      // Händler: alle Zahlungen dort, nicht nur dieser Monat.
      view.listCategory = merchant ? undefined : b.dataset.cat || null;
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
    if (act === 'clear-cat') { view.listCategory = undefined; render(); }
    if (act === 'clear-merchant') { view.listMerchant = null; render(); }
    if (act === 'edit') openEditor(b.dataset.id);
    if (act === 'sort') openSorter();
    if (act === 'setup') { selectTab('settings'); const d = $('#setup-details'); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } }
    if (act === 'edit-rule') openRuleEditor(b.dataset.id);
    if (act === 'new-rule') openRuleEditor(null);
    if (act === 'restore-std') await restoreDefaultRules();
    if (act === 'import-text') await importLog($('#log-text').value);
    if (act === 'demo') await importLog(demoLog(), { demo: true });
    if (act === 'demo-remove') await removeDemo();
    if (act === 'export-csv') await saveFile(`taler-${clock().today}.csv`, ui.buildCsv(state.transactions), 'text/csv;charset=utf-8');
    if (act === 'export-json') await saveBackup();
    if (act === 'reset' && await ask('Wirklich alle Buchungen, Regeln und Einstellungen löschen? Die Datei aus dem Kurzbefehl bleibt erhalten.', 'Alles löschen', { danger: true })) {
      await db.clear();
      Object.assign(state, { transactions: [], rules: orderRules(DEFAULT_RULES), settings: { ...DEFAULT_SETTINGS }, deletedIds: [] });
      await saveRules();
      await db.setMeta('initialized', true);
      info.lastImport = null;
      info.lastBackup = null;
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
    if (e.target.id === 'budget-form') {
      e.preventDefault();
      const snap = snapshot();
      const v = e.target.budget.value.trim();
      const a = v ? parseAmount(v) : null;
      state.settings = sanitizeSettings({ ...state.settings, monthlyBudgetCents: a ? a.cents : null });
      await db.setMeta('settings', state.settings);
      render();
      undoable(state.settings.monthlyBudgetCents ? 'Budget gespeichert' : 'Budget entfernt', snap);
    }
  });

  const f = $('#edit-form');
  f.categoryId.addEventListener('change', updateRuleOffer);
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
  for (const d of document.querySelectorAll('dialog.sheet')) bindSheet(d);
  $('#add-btn').addEventListener('click', () => openEditor(null));
}

// ---------- Start ----------
async function start() {
  db = await open();
  info.storageKind = db.kind === 'indexeddb' ? 'IndexedDB' : 'localStorage';
  info.standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  state.transactions = sortTransactions((await db.allTransactions()).map(sanitizeTransaction).filter(Boolean));
  state.settings = sanitizeSettings(await db.getMeta('settings'));
  state.deletedIds = (await db.getMeta('deletedIds')) || [];
  info.lastImport = await db.getMeta('lastImport');
  info.lastBackup = await db.getMeta('lastBackup');
  info.reviewDismissed = await db.getMeta('reviewDismissed');
  if (!(await db.getMeta('initialized'))) {
    await db.putRules(DEFAULT_RULES);
    await db.setMeta('initialized', true);
  }
  state.rules = orderRules((await db.allRules()).map(sanitizeRule).filter(Boolean));
  bind();
  let tab = 'overview';
  try { tab = sessionStorage.getItem('taler:tab') || tab; } catch { /* egal */ }
  selectTab(tab);
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
