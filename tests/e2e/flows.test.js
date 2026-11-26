// Abläufe im echten Browser: Einlesen, Sicherung laden und zurückholen, Umbuchung bestätigen, Aufteilen und Verteilen.
// Erfundene Daten. Start: `npm run e2e` (braucht Playwright mit Chromium; PLAYWRIGHT = Pfad zu einer anderen Installation).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };

let server;
let browser;
let base;
let dir;

before(async () => {
  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      const body = await readFile(join(ROOT, path.endsWith('/') ? `${path}index.html` : path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
  dir = await mkdtemp(join(tmpdir(), 'taler-e2e-'));
});
after(async () => { await browser?.close(); server?.close(); });

/** Neue Seite mit leerem Speicher und festem Datum. */
async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-11-20T12:00:00') });
  await page.goto(base);
  await page.waitForSelector('#view-overview .bigtitle, #view-overview .emptyhero');
  return { page, errors, ctx };
}
const click = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const settle = (page) => page.waitForTimeout(300);
/** Buchungen im Speicher, ohne Beispieldaten: id → "art/kategorie". */
const stored = (page) => page.evaluate(() => new Promise((r) => {
  const q = indexedDB.open('taler');
  q.onsuccess = () => { const g = q.result.transaction('transactions').objectStore('transactions').getAll(); g.onsuccess = () => r(g.result); };
}));
const T = (id, date, cents, card, merchant, kind, extra = {}) => ({ id, date, time: null, amountCents: cents, currency: 'EUR', baseCents: null, merchant, card, categoryId: null, manualCategory: false, note: '', source: 'statement', excluded: false, kind, accountId: null, toAccountId: null, ...extra });

async function loadBackup(page, transactions, name) {
  const file = join(dir, name);
  await writeFile(file, JSON.stringify({ app: 'taler', version: 1, transactions, rules: [], deletedIds: [], settings: { budgetMode: 'off', ownAccounts: ['Trade Republic', 'ING'] } }));
  await page.setInputFiles('#backup-file', file);
  await settle(page);
  await click(page, '#confirm-ok');
  await settle(page);
}

test('Kurzbefehl-Datei: einlesen, erneut einlesen legt nichts doppelt an', async () => {
  const { page, errors, ctx } = await fresh();
  const file = join(dir, 'ausgaben.txt');
  await writeFile(file, '2026-11-18T08:12:03+01:00;3,45 €;Backwerk;Visa\n2026-11-19T18:55:41+01:00;42,17 €;REWE Markt;Visa\n');
  await page.setInputFiles('#log-file', file);
  await settle(page);
  assert.equal((await stored(page)).length, 2);
  await page.setInputFiles('#log-file', file);
  await settle(page);
  assert.equal((await stored(page)).length, 2);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Sicherung laden behält Handkorrekturen; vorheriger Stand lässt sich zurückholen', async () => {
  const { page, errors, ctx } = await fresh();
  await loadBackup(page, [
    T('m', '2026-11-10', 3000, 'ING', 'Kino Max', 'expense', { categoryId: 'freizeit', manualCategory: true }),
    T('n', '2026-11-12', -3000, 'Trade Republic', 'Max Muster', 'income', { categoryId: 'sonstige-einnahmen', manualCategory: true }),
  ], 'a.json');
  const kinds = Object.fromEntries((await stored(page)).map((t) => [t.id, `${t.kind}/${t.categoryId}`]));
  assert.deepEqual(kinds, { m: 'expense/freizeit', n: 'income/sonstige-einnahmen' });
  await loadBackup(page, [T('x', '2026-11-11', 999, 'ING', 'Bäcker', 'expense')], 'b.json');
  assert.deepEqual((await stored(page)).map((t) => t.id), ['x']);
  await click(page, '[data-tab="settings"]');
  await settle(page);
  await click(page, '[data-act="restore-previous"]');
  await settle(page);
  await click(page, '#confirm-ok');
  await settle(page);
  assert.deepEqual((await stored(page)).map((t) => t.id).sort(), ['m', 'n']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Unsichere Umbuchung: Frage beim Einordnen, „nein“ lässt beide einzeln', async () => {
  const { page, errors, ctx } = await fresh();
  await loadBackup(page, [
    T('k', '2026-11-03', 5000, 'Trade Republic', 'Eventim', 'expense', { source: 'shortcut' }),
    T('f', '2026-11-06', -5000, 'ING', 'Lisa Muster', 'income'),
  ], 'c.json');
  // Als neue Zeilen einlesen geht nur über Dateien; hier reicht der Durchlauf beim Start (Stufe 1 → 2).
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('taler'); q.onsuccess = () => { const t = q.result.transaction('meta', 'readwrite'); t.objectStore('meta').put({ id: 'transferScan', value: 0 }); t.oncomplete = r; }; }));
  await page.reload();
  await page.waitForSelector('[data-act="sort"]');
  await click(page, '[data-act="sort"]');
  await settle(page);
  assert.match(await page.textContent('#sort-body'), /umbuchung zwischen deinen konten/i);
  await click(page, '[data-sort="pair-no"]');
  await settle(page);
  const kinds = Object.fromEntries((await stored(page)).map((t) => [t.id, t.kind]));
  assert.deepEqual(kinds, { k: 'expense', f: 'income' });
  assert.match(await page.textContent('#sort-body'), /2 von 3/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Bearbeiten: Aufteilen und auf 12 Monate verteilen wirken in der Übersicht', async () => {
  const { page, errors, ctx } = await fresh();
  await loadBackup(page, [
    T('dm', '2026-11-05', 3000, 'ING', 'dm', 'expense', { categoryId: 'drogerie', manualCategory: true }),
    T('kfz', '2026-11-07', 12000, 'ING', 'Kfz-Versicherung', 'expense', { categoryId: 'mobilitaet', manualCategory: true }),
  ], 'd.json');
  await click(page, '[data-tab="list"]');
  await settle(page);
  await click(page, '[data-act="edit"][data-id="dm"]');
  await settle(page);
  await click(page, '[data-act="add-split"]');
  await page.selectOption('#split-rows select', 'haushalt');
  await page.fill('#split-rows input[name="splitAmount"]', '12');
  await click(page, '#edit-form [value="save"]');
  await settle(page);
  await click(page, '[data-act="edit"][data-id="kfz"]');
  await settle(page);
  await page.check('#edit-form [name="spread"]');
  await click(page, '#edit-form [value="save"]');
  await settle(page);
  const byId = Object.fromEntries((await stored(page)).map((t) => [t.id, t]));
  assert.deepEqual(byId.dm.splits, [{ categoryId: 'haushalt', cents: 1200 }]);
  assert.equal(byId.kfz.spread, true);
  await click(page, '[data-tab="overview"]');
  await page.waitForTimeout(1500); // Zahlen zählen hoch
  const text = await page.textContent('#view-overview');
  assert.match(text, /Haushalt & Wohnen/);
  assert.match(text, /erfasste ausgaben40,00\s€/); // 30 € dm + 120 € / 12
  assert.match(text, /10,00\s€/);
  assert.match(text, /18,00\s€/);
  assert.match(text, /dm1×30,00\s€/); // Teile zählen nicht als eigene Zahlung // dm ohne den Haushaltsteil
  assert.deepEqual(errors, []);
  await ctx.close();
});
