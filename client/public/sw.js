// Trading Journal service worker — enables install + fast loads.
const CACHE = 'tj-v2'; // v2: manifest allows any orientation (old cache dropped on activate)

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/index.html'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Never cache API calls — always live.
  if (req.method !== 'GET' || url.pathname.startsWith('/api')) return;

  // Navigations: network-first so a new deploy is picked up; fall back to cache offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  // Static assets (hashed): cache-first, then network.
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      });
    })
  );
});

// App notifications (news alerts). The server sends {title, body, url, tag}.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Trading Journal', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Trading Journal', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
    icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/?view=news' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/?view=news';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin) { c.postMessage({ type: 'open-view', url }); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
