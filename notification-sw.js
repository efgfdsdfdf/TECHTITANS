self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { title: 'Tech Titans', body: event.data ? event.data.text() : 'New activity' };
  }

  const title = payload.title || 'Tech Titans';
  const options = {
    body: payload.body || 'New activity',
    icon: payload.icon || 'img/titans_logo2.png',
    badge: payload.badge || 'img/titans_logo2.png',
    data: {
      url: payload.url || payload.data?.url || '/'
    },
    vibrate: payload.vibrate || [100, 50, 100]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const absoluteUrl = new URL(targetUrl, self.location.origin).href;

    for (const client of clientsList) {
      if (client.url === absoluteUrl && 'focus' in client) {
        return client.focus();
      }
    }

    if (clients.openWindow) {
      return clients.openWindow(absoluteUrl);
    }
  })());
});
