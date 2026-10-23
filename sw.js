// Service Worker: App-Hülle offline verfügbar. VERSION bei jeder Änderung hochzählen.
const VERSION = 'goldene-taler-v6';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'src/main.js', 'src/ui.js', 'src/logic.js', 'src/model.js', 'src/storage.js', 'src/texts.js', 'src/catalog.js',
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
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) {
    // Schriften: aus dem Cache, sonst Netz und merken.
    e.respondWith(caches.open(VERSION).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { c.put(e.request, r.clone()); return r; })));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
