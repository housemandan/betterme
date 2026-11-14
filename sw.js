/* Better Me service worker: makes the site installable and shows "your turn" alerts.
   It does not cache pages, so every visit always gets the newest version of the game. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'Better Me';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || 'It’s your turn!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'betterme',
    renotify: true,
    data: { url: d.url || '/play.html' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/play.html';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.url.includes('/play.html') && 'focus' in c) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
