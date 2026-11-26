/* =========================================================
   Lifeline ICE: sw.js (service worker)
   Runs in the background, separately from the page.
   - Saves the app's files so it opens with no internet.
   - Handles taps on the lock-screen card.
   - Re-pins the card when Chrome wakes it (periodic sync).
   Change VERSION whenever you edit the app, so phones fetch the new files.
   ========================================================= */
const VERSION = 'lifeline-v4.0.0';
const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'ai.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-96.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(FILES);
    try { await cache.add(new Request(QR_LIB, { mode: 'cors' })); } catch (err) { /* cached on first use instead */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION && k !== 'lifeline-pins').map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return; // AI always needs the network

  // Pages: try the network first so updates show, fall back to the saved copy
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put('index.html', copy));
      return res;
    }).catch(() => caches.match('index.html')));
    return;
  }

  // Everything else (CSS, JS, icons, fonts, QR library): saved copy first, then network
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && (url.origin === location.origin || url.href === QR_LIB || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com'))) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
    }
    return res;
  })));
});

// Tap on the lock-screen card or one of its buttons
self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  // The card stays pinned: we do not close it
  let target = data.url || './';
  if (event.action === 'call' && data.call) target = data.call; // opens the phone dialler where supported
  event.waitUntil((async () => {
    if (target.startsWith('tel:')) {
      // Some browsers cannot open tel: links from here, so fall back to the medical ID page
      try { await self.clients.openWindow(target); return; } catch (err) { target = data.url || './'; }
    }
    await self.clients.openWindow(target);
  })());
});

// Chrome (installed app on Android) wakes us about twice a day: put the cards back if they were swiped away
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'lifeline-repin') event.waitUntil(repin());
});

async function repin() {
  const cache = await caches.open('lifeline-pins');
  const res = await cache.match('pins.json');
  if (!res) return;
  const pins = await res.json();
  const showing = await self.registration.getNotifications();
  for (const pin of pins) {
    if (!showing.some((n) => n.tag === pin.options.tag)) {
      await self.registration.showNotification(pin.title, pin.options);
    }
  }
}
