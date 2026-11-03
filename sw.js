// Service Worker: App-Hülle offline verfügbar. VERSION bei jeder Änderung hochzählen.
const VERSION = 'goldene-taler-v19';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'src/main.js', 'src/ui.js', 'src/logic.js', 'src/model.js', 'src/storage.js', 'src/texts.js', 'src/catalog.js',
  'src/statement.js', 'src/accounts.js', 'src/prices.js', 'src/pdf.js', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
  'fonts/asap.woff2', 'fonts/chivo-mono.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  // Nur die eigene App-Hülle; Abrufe ins Netz (Kurse) gehen am Cache vorbei.
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
