/**
 * Service worker for rtc-webCLI.
 *
 * It makes the app installable and lets it open offline. It caches only this site's own static files (the page, the
 * About page, the pinned libraries, the diagrams and icons). It does not touch the network paths that carry a call:
 * WebSockets to the introduction relays and WebRTC media never pass through a service worker, and /whoami and
 * /lan.json (the local server's answers about this device) are always fetched live.
 *
 * Strategy: network first, cache as the fallback. Online, every file is fetched fresh and the cache is refreshed, so
 * the page and the libraries it checks by SHA-256 always come from the same release. Offline, the last copy is used.
 * A call still needs the network (introductions go through public relays), and the app says so when offline.
 */

const CACHE_VERSION = '0.3.0'; // bump with each release
const CACHE_NAME = `rtc-webCLI-${CACHE_VERSION}`;

// Relative to the worker's scope, so the app works from a domain root or a project subpath.
const SHELL = [
  './', 'index.html', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-192-maskable.png', 'icon-512-maskable.png', 'apple-touch-icon.png',
  'about/', 'about/index.html',
  'lib/trystero-nostr.js', 'lib/qrcode.js', 'lib/PINS.json',
  'img/architecture.svg', 'img/connect-flow.svg', 'img/invite-link.svg', 'img/privacy.svg', 'img/mesh.svg', 'img/same-network.svg',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // One missing file must not stop the app from installing.
      await Promise.all(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch((e) => console.warn('rtc-webCLI: not cached', u, e))));
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('rtc-webCLI-') && n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never handle other hosts
  if (/\/(whoami|lan\.json)$/.test(url.pathname)) return; // live answers about this device, never cached

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (fresh.ok && fresh.type === 'basic') {
        const copy = fresh.clone();
        caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {});
      }
      return fresh;
    } catch (err) {
      // Offline. A navigation to a folder or the fragment-bearing start URL matches its cached page.
      const hit = await caches.match(request, { ignoreSearch: true });
      if (hit) return hit;
      if (request.mode === 'navigate') {
        const fallback = await caches.match(url.pathname.includes('/about') ? 'about/' : './', { ignoreSearch: true });
        if (fallback) return fallback;
      }
      throw err;
    }
  })());
});
