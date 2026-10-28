/* App shell only. Network-first, and the fetch bypasses the HTTP cache so a
   deploy shows up on the next reload instead of lingering in the browser cache.
   The Cache API is only an offline fallback. Cross-origin requests, including
   the NFL data API, are not intercepted and are never stored. */
const CACHE = 'nfl-shell-v2';
const SHELL = /\/(?:index\.html|styles\.css|app\.js|logic\.js|manifest\.webmanifest|icon\.svg)$/;

function isShell(pathname) {
  return pathname.endsWith('/') || SHELL.test(pathname);
}

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;
  if (request.mode !== 'navigate' && !isShell(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(request, { cache: 'reload' });
      if (fresh && fresh.ok && fresh.type === 'basic') {
        try { await cache.put(request, fresh.clone()); } catch { /* redirected responses cannot be stored */ }
      }
      return fresh;
    } catch (error) {
      const cached = await cache.match(request)
        || (request.mode === 'navigate' ? await cache.match('./index.html') || await cache.match('./') : undefined);
      if (cached) return cached;
      throw error;
    }
  })());
});
