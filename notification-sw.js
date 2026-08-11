self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { title: 'Tech Titans', body: event.data ? event.data.text() : 'New activity' };
  }

  const title = payload.title || 'Tech Titans';
  const type = payload.data?.type || payload.type || 'system';
  const isCall = type === 'incoming_call';
  const isCallCancel = type === 'call_cancelled';
  const isAnnouncement = type === 'announcement';

  // If call was cancelled, close the existing call notification
  if (isCallCancel) {
    const callTag = payload.data?.callId ? `call-${payload.data.callId}` : null;
    if (callTag) {
      event.waitUntil(
        self.registration.getNotifications({ tag: callTag }).then((notifications) => {
          notifications.forEach((n) => n.close());
        })
      );
    }
    return;
  }

  const options = {
    body: payload.body || 'New activity',
    icon: payload.icon || 'img/titans_logo2.png',
    badge: payload.badge || 'img/titans_logo2.png',
    tag: payload.tag || payload.data?.tag || (isCall ? `call-${payload.data?.callId}` : undefined),
    requireInteraction: isCall || isAnnouncement || Boolean(payload.requireInteraction),
    renotify: isCall || Boolean(payload.renotify),
    data: {
      ...(payload.data || {}),
      url: payload.url || payload.data?.url || '/'
    },
    vibrate: isCall
      ? [300, 100, 300, 100, 300, 100, 300]
      : (payload.vibrate || [100, 50, 100]),
    silent: false
  };

  // Incoming call: also notify open clients to show the in-app overlay
  if (isCall) {
    event.waitUntil(
      Promise.all([
        self.registration.showNotification(title, options),
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
          windowClients.forEach((client) => {
            client.postMessage({
              type: 'incoming_call',
              callId: payload.data?.callId,
              callType: payload.data?.callType,
              callerName: payload.data?.callerName || title,
              callerId: payload.data?.callerId,
              roomId: payload.data?.roomId
            });
          });
        })
      ])
    );
    return;
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || '/';
  const isCall = data.type === 'incoming_call';

  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const absoluteUrl = new URL(targetUrl, self.location.origin).href;

    // For call notifications, notify all clients that the call was accepted from notification
    if (isCall) {
      for (const client of clientsList) {
        client.postMessage({
          type: 'call_accepted_from_notification',
          callId: data.callId,
          callType: data.callType,
          callerName: data.callerName,
          callerId: data.callerId,
          roomId: data.roomId
        });
      }
    }

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

self.addEventListener('notificationclose', (event) => {
  const data = event.notification.data || {};

  // If a call notification was dismissed, notify clients to stop ringing
  if (data.type === 'incoming_call' && data.callId) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
        windowClients.forEach((client) => {
          client.postMessage({
            type: 'call_notification_dismissed',
            callId: data.callId
          });
        });
      })
    );
  }
});
