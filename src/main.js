// Start, Aktionen, Ereignisse. Einzige Stelle, die die Uhr liest.
import { open } from './storage.js';
import {
  sanitizeTransaction, sanitizeRule, sanitizeSettings, DEFAULT_SETTINGS, emptyTransaction, buildExport, parseImport,
} from './model.js';
import {
  parseLog, parseAmount, applyRules, mergeTransactions, orderRules, upsertRule, categorize, suggestPattern,
  sortTransactions, monthOf,
} from './logic.js';
import { DEFAULT_RULES } from './catalog.js';
import { IMPORT_ERRORS } from './texts.js';
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
const view = { tab: 'overview', month: clock().month, listMonth: clock().month, listCategory: undefined, query: '', importReport: '', editing: null };
const info = { lastImport: null, storageKind: 'indexeddb' };

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

// ---------- Rendering ----------
function render() {
  const c = clock();
  const el = $(`#view-${view.tab}`);
  if (view.tab === 'overview') ui.renderOverview(el, state, view, c);
  if (view.tab === 'list') ui.renderList(el, state, view, c);
  if (view.tab === 'rules') ui.renderRules(el, state);
  if (view.tab === 'data') ui.renderData(el, state, view, info);
  document.title = `Taler · ${TAB_TITLES[view.tab]}`;
  $('#add-btn').style.visibility = view.tab === 'rules' || view.tab === 'data' ? 'hidden' : 'visible';
}

const TAB_TITLES = { overview: 'Übersicht', list: 'Buchungen', rules: 'Regeln', data: 'Daten' };

function selectTab(tab) {
  if (!TAB_TITLES[tab]) tab = 'overview';
  view.tab = tab;
  for (const a of document.querySelectorAll('.tabbar a')) {
    const on = a.dataset.tab === tab;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    $(`#view-${a.dataset.tab}`).hidden = !on;
  }
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
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Import ----------
async function importLog(text) {
  const { transactions, errors } = parseLog(text, state.settings.currency);
  const categorized = applyRules(transactions, state.rules);
  const { transactions: merged, added } = mergeTransactions(state.transactions, categorized, state.deletedIds);
  state.transactions = merged;
  if (added.length) await saveTransactions(added);
  const c = clock();
  info.lastImport = { when: `${ui.dayLabel(c.today, c.today, c.yesterday)}, ${c.time}`, added: added.length };
  await db.setMeta('lastImport', info.lastImport);
  view.importReport = ui.importReportHtml(added.length, transactions.length - added.length, errors);
  if (added.length) {
    const newest = sortTransactions(added)[0];
    view.month = monthOf(newest.date);
  }
  render();
  toast(added.length ? `${added.length} neue Zahlungen importiert` : 'Keine neuen Zahlungen');
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
  f.rulePattern.value = suggestPattern(t.merchant);
  $('#rule-offer').hidden = true;
  $('#edit-error').hidden = true;
  $('#edit-delete').hidden = !id;
  $('#edit-title').textContent = id ? 'buchung ändern' : 'neue buchung';
  $('#edit-dialog').showModal();
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
  const cat = f.categoryId.value || null;
  const id = t.id || `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  let categoryId = cat;
  let manualCategory = t.manualCategory || (cat !== t.categoryId);
  if (!t.id && !cat) { categoryId = categorize(f.merchant.value, state.rules); manualCategory = false; }
  const next = sanitizeTransaction({
    ...t, id, merchant: f.merchant.value, amountCents: amount.cents, currency: amount.currency || t.currency || state.settings.currency,
    card: f.card.value, date: f.date.value, time: f.time.value || null, categoryId, manualCategory, note: f.note.value,
  });
  if (!next) return false;
  state.transactions = sortTransactions([...state.transactions.filter((x) => x.id !== id), next]);
  await saveTransactions([next]);

  if (!$('#rule-offer').hidden && f.makeRule.checked && f.rulePattern.value.trim() && cat) {
    const { rules, rule } = upsertRule(state.rules, f.rulePattern.value, cat, `u-${Date.now().toString(36)}`);
    state.rules = rules;
    await db.putRules([rule]);
    const n = await reapplyRules();
    toast(`Regel „${rule.pattern}“ gespeichert${n ? `, ${n} weitere eingeordnet` : ''}`);
  } else {
    toast(t.id ? 'Gespeichert' : 'Buchung hinzugefügt');
  }
  render();
  return true;
}

async function deleteEditing() {
  const t = view.editing;
  if (!t?.id) return false;
  $('#edit-dialog').close();
  if (!(await ask(`„${t.merchant}“ löschen?`, 'Löschen', { danger: true }))) { $('#edit-dialog').showModal(); return false; }
  state.transactions = state.transactions.filter((x) => x.id !== t.id);
  await db.deleteTransaction(t.id);
  if (t.source === 'shortcut') {
    state.deletedIds = [...state.deletedIds, t.id];
    await db.setMeta('deletedIds', state.deletedIds);
  }
  render();
  toast('Gelöscht');
  return true;
}

// ---------- Ereignisse ----------
function bind() {
  for (const a of document.querySelectorAll('.tabbar a')) {
    a.addEventListener('click', (e) => { e.preventDefault(); selectTab(a.dataset.tab); });
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'month' && b.dataset.month) { view.month = b.dataset.month; render(); }
    if (act === 'goto') selectTab(b.dataset.tab);
    if (act === 'filter-cat') {
      view.listCategory = b.dataset.cat || null;
      view.listMonth = view.month;
      view.query = '';
      selectTab('list');
    }
    if (act === 'list-month') { view.listMonth = b.dataset.month || null; render(); }
    if (act === 'clear-cat') { view.listCategory = undefined; render(); }
    if (act === 'edit') openEditor(b.dataset.id);
    if (act === 'del-rule') {
      state.rules = state.rules.filter((r) => r.id !== b.dataset.id);
      await db.deleteRule(b.dataset.id);
      await reapplyRules();
      render();
      toast('Regel gelöscht');
    }
    if (act === 'import-text') await importLog($('#log-text').value);
    if (act === 'demo') { await importLog(demoLog()); }
    if (act === 'export-csv') download(`taler-${clock().today}.csv`, ui.buildCsv(state.transactions), 'text/csv;charset=utf-8');
    if (act === 'export-json') {
      download(`taler-sicherung-${clock().today}.json`, JSON.stringify(buildExport(state, clock().iso), null, 2), 'application/json');
      await db.setMeta('lastBackup', clock().iso);
    }
    if (act === 'reset' && await ask('Wirklich alle Buchungen, Regeln und Einstellungen löschen? Die Datei aus dem Kurzbefehl bleibt erhalten.', 'Alles löschen', { danger: true })) {
      await db.clear();
      Object.assign(state, { transactions: [], rules: orderRules(DEFAULT_RULES), settings: { ...DEFAULT_SETTINGS }, deletedIds: [] });
      await saveRules();
      await db.setMeta('initialized', true);
      info.lastImport = null;
      view.importReport = '';
      render();
      toast('Alles gelöscht');
    }
  });

  document.addEventListener('change', async (e) => {
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
    if (e.target.id === 'rule-form') {
      e.preventDefault();
      const f = e.target;
      const { rules, rule } = upsertRule(state.rules, f.pattern.value, f.categoryId.value, `u-${Date.now().toString(36)}`);
      if (!sanitizeRule(rule)) return;
      state.rules = rules;
      await db.putRules([rule]);
      const n = await reapplyRules();
      render();
      toast(`Regel gespeichert${n ? `, ${n} Buchungen eingeordnet` : ''}`);
    }
    if (e.target.id === 'budget-form') {
      e.preventDefault();
      const v = e.target.budget.value.trim();
      const a = v ? parseAmount(v) : null;
      state.settings = sanitizeSettings({ ...state.settings, monthlyBudgetCents: a ? a.cents : null });
      await db.setMeta('settings', state.settings);
      render();
      toast(state.settings.monthlyBudgetCents ? 'Budget gespeichert' : 'Budget entfernt');
    }
  });

  const f = $('#edit-form');
  f.categoryId.addEventListener('change', updateRuleOffer);
  f.addEventListener('submit', async (e) => {
    const action = e.submitter?.value;
    if (action === 'save') { e.preventDefault(); if (await saveEditor()) $('#edit-dialog').close(); }
    if (action === 'delete') { e.preventDefault(); await deleteEditing(); }
  });
  $('#add-btn').addEventListener('click', () => openEditor(null));
}

// ---------- Start ----------
async function start() {
  db = await open();
  info.storageKind = db.kind === 'indexeddb' ? 'IndexedDB' : 'localStorage';
  state.transactions = sortTransactions((await db.allTransactions()).map(sanitizeTransaction).filter(Boolean));
  state.settings = sanitizeSettings(await db.getMeta('settings'));
  state.deletedIds = (await db.getMeta('deletedIds')) || [];
  info.lastImport = await db.getMeta('lastImport');
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
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
