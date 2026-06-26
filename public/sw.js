/**
 * Service Worker — Cache-First 策略
 * 缓存 App Shell，支持离线阅读
 */
const CACHE = 'reader-v2';
const SHELL = ['/reader/', '/reader/manifest.json', '/reader/icons/192.png', '/reader/icons/512.png'];

/** 只处理 http/https 请求，过滤 chrome-extension 等 */
function isCacheable(req: Request): boolean {
  const url = new URL(req.url);
  return url.protocol === 'http:' || url.protocol === 'https:';
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (!isCacheable(e.request)) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request)
        .then((response) => {
          if (response.ok && isCacheable(e.request)) {
            const clone = response.clone();
            caches.open(CACHE).then((cache) => cache.put(e.request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
