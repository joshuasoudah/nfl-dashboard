/* App shell only, network-first.
   A successful response replaces the cache, so the next load picks up a deploy.
   Cross-origin requests (the NFL data API included) are not intercepted and are never cached.
   API responses must stay no-store from the page as well. */
const CACHE = 'nfl-shell-v1';
const SHELL = /\.(?:html|css|js|svg|webmanifest)$/;

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
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
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(request);
      const cacheable = fresh.ok && (request.mode === 'navigate' || SHELL.test(url.pathname) || url.pathname.endsWith('/'));
      if (cacheable) {
        try { await cache.put(request, fresh.clone()); } catch { /* ignore redirected responses */ }
      }
      return fresh;
    } catch (error) {
      const cached = await cache.match(request) || (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
      if (cached) return cached;
      throw error;
    }
  })());
});
