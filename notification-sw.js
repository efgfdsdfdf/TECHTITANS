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
  const isMessage = type === 'message' || type === 'private_message' || type === 'group_message';

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
    tag: payload.tag || payload.data?.tag || (isCall ? `call-${payload.data?.callId}` : `msg-${Date.now()}`),
    requireInteraction: isCall || isAnnouncement || isMessage || Boolean(payload.requireInteraction),
    renotify: isCall || isMessage || Boolean(payload.renotify),
    data: {
      ...(payload.data || {}),
      url: payload.url || payload.data?.url || '/'
    },
    vibrate: isCall
      ? [300, 100, 300, 100, 300, 100, 300]
      : [200, 100, 200], // Double vibration for messages
    silent: false
  };

  if (isCall) {
    options.actions = [
      { action: 'accept', title: 'Accept' },
      { action: 'decline', title: 'Decline' }
    ];
  }

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

    // Decline button: tell open clients to decline, or open a page that declines silently
    if (isCall && event.action === 'decline') {
      if (clientsList.length > 0) {
        for (const client of clientsList) {
          client.postMessage({
            type: 'call_declined_from_notification',
            callId: data.callId,
            callType: data.callType,
            callerId: data.callerId
          });
        }
        return;
      }
      const declineUrl = new URL(`dm.html?callId=${encodeURIComponent(data.callId || '')}&nativeDeclined=1`, self.location.origin).href;
      if (clients.openWindow) {
        return clients.openWindow(declineUrl);
      }
      return;
    }

    // Accept button or notification body tap
    const callUrl = isCall
      ? new URL(`dm.html?callId=${encodeURIComponent(data.callId || '')}${event.action === 'accept' ? '&nativeAccepted=1' : ''}`, self.location.origin).href
      : null;
    const absoluteUrl = callUrl || new URL(targetUrl, self.location.origin).href;

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
      if (clientsList.length > 0 && 'focus' in clientsList[0]) {
        return clientsList[0].focus();
      }
      if (clients.openWindow) {
        return clients.openWindow(absoluteUrl);
      }
      return;
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

// Keep push delivery working when the browser rotates the subscription
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const oldSubscription = event.oldSubscription || await self.registration.pushManager.getSubscription();
      const applicationServerKey = oldSubscription?.options?.applicationServerKey;
      if (!applicationServerKey) return;

      const newSubscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      });

      const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      windowClients.forEach((client) => {
        client.postMessage({
          type: 'push_subscription_changed',
          subscription: newSubscription.toJSON(),
          endpoint: newSubscription.endpoint,
          oldEndpoint: oldSubscription?.endpoint || null
        });
      });
    } catch (error) {
      // Re-subscription will be retried on next page load via registerPushDevice
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
