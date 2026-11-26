/* WalletWeb — service worker: la app funciona sin conexión. No guarda datos financieros: solo los archivos de la app. */
const VERSION = 'walletweb-v1.39.0';
const SHELL = ['./', './index.html', './styles.css', './core.js', './app-base.js', './app-views.js', './app-forms.js', './app-scan.js', './app-main.js', './app-charts.js', './app-fx.js', './app-loans.js', './app-colors.js', './app-profiles.js', './app-drive.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css'];
// El lector de facturas (vendor/tesseract, ~6 MB) se guarda en caché la primera vez que se usa.
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Navegación: red primero (para recibir actualizaciones), caché si no hay conexión.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put('./index.html', copy)); return r; }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; })));
});
