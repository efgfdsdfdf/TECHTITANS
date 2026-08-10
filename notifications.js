/**
 * TechTitans Notification System
 * Handles browser-level alerts and the in-app notification center.
 */

const TechTitansNotifications = {
  _supabase: null,
  _userId: null,
  _notificationRoot: null,
  _notificationPanel: null,
  _unreadBadge: null,
  _channel: null,
  _connected: false,
  _pushPublicKey: null,

  async requestPermission() {
    if (!('Notification' in window)) {
      console.warn('This browser does not support desktop notifications');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }

    return false;
  },

  async display(title, options = {}) {
    if (document.hasFocus()) {
      return null;
    }

    if (Notification.permission === 'granted') {
      const defaultOptions = {
        icon: 'img/titans_logo2.png',
        badge: 'img/titans_logo2.png',
        silent: false,
        vibrate: [100, 50, 100]
      };

      const finalOptions = { ...defaultOptions, ...options };
      const notification = new Notification(title, finalOptions);

      notification.onclick = function(event) {
        event.preventDefault();
        window.focus();
        notification.close();
        if (options.url) {
          window.location.href = options.url;
        }
      };

      return notification;
    }
    return null;
  },

  async connect(supabase, options = {}) {
    if (!supabase || !supabase.from) {
      console.warn('Supabase client is required to initialize notifications.');
      return;
    }

    if (this._connected && this._supabase === supabase) {
      return;
    }

    this._supabase = supabase;
    this._connected = true;

    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      console.warn('Unable to resolve authenticated user for notifications.');
      return;
    }

    this._userId = data.user.id;
    this._pushPublicKey = options.pushPublicKey || window.TECH_TITANS_PUSH_PUBLIC_KEY || null;
    this._renderNotificationWidget(options);
    await this._refreshUnreadCount();
    await this.subscribe();
    await this._loadPushPublicKey();
    await this.registerPushDevice();
  },

  async _loadPushPublicKey() {
    if (this._pushPublicKey) return this._pushPublicKey;

    try {
      const { data: sessionData } = await this._supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) return null;

      const supabaseUrl = this._supabase.supabaseUrl;
      const response = await fetch(`${supabaseUrl}/functions/v1/push-public-key`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      const data = await response.json();
      if (!response.ok || !data.publicKey) {
        console.warn(data.error || 'Unable to load push public key.');
        return null;
      }

      this._pushPublicKey = data.publicKey;
      return this._pushPublicKey;
    } catch (error) {
      console.warn('Unable to load push public key:', error);
      return null;
    }
  },

  async registerPushDevice() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('This browser does not support web push notifications.');
      return null;
    }

    const permissionGranted = await this.requestPermission();
    if (!permissionGranted) return null;

    try {
      const registration = await navigator.serviceWorker.register('notification-sw.js');
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription && this._pushPublicKey) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this._urlBase64ToUint8Array(this._pushPublicKey)
        });
      }

      if (!subscription) {
        console.warn('Push registration needs PUSH_PUBLIC_KEY to create a browser subscription.');
        return null;
      }

      const browser = navigator.userAgent || 'unknown';
      const deviceRecord = {
        user_id: this._userId,
        device_type: this._detectDeviceType(),
        browser,
        push_token: JSON.stringify(subscription.toJSON()),
        device_identifier: subscription.endpoint,
        is_active: true,
        last_seen_at: new Date().toISOString()
      };

      const { data: existingDevice } = await this._supabase
        .from('user_devices')
        .select('id')
        .eq('user_id', this._userId)
        .eq('device_identifier', subscription.endpoint)
        .maybeSingle();

      const { error } = existingDevice?.id
        ? await this._supabase.from('user_devices').update(deviceRecord).eq('id', existingDevice.id)
        : await this._supabase.from('user_devices').insert(deviceRecord);

      if (error) {
        console.error('Unable to store push subscription:', error);
      }

      return subscription;
    } catch (error) {
      console.error('Push registration failed:', error);
      return null;
    }
  },

  async fetchNotifications({ limit = 15 } = {}) {
    if (!this._supabase) return [];
    const { data, error } = await this._supabase
      .from('notifications')
      .select('id, title, body, data, entity_type, entity_id, is_read, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Failed to load notifications:', error);
      return [];
    }
    return data || [];
  },

  async getUnreadCount() {
    if (!this._supabase) return 0;
    const { count, error } = await this._supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false);

    if (error) {
      console.error('Failed to count notifications:', error);
      return 0;
    }
    return count || 0;
  },

  async markNotificationRead(notificationId) {
    if (!this._supabase || !notificationId) return;
    const { error } = await this._supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', notificationId);

    if (error) {
      console.error('Unable to mark notification read:', error);
    }
    await this._refreshUnreadCount();
  },

  async markAllRead() {
    if (!this._supabase) return;
    const { error } = await this._supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('is_read', false);

    if (error) {
      console.error('Unable to mark all notifications read:', error);
    }
    await this._refreshUnreadCount();
    this._renderNotifications([]);
  },

  async subscribe() {
    if (!this._supabase || !this._userId) return;

    if (this._channel) {
      try { this._channel.unsubscribe(); } catch (err) { }
      this._channel = null;
    }

    this._channel = this._supabase
      .channel(`notifications-${this._userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${this._userId}` }, async () => {
        await this._refreshUnreadCount();
        if (this._notificationPanel && this._notificationPanel.style.display === 'block') {
          await this._loadAndRenderNotifications();
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${this._userId}` }, async () => {
        await this._refreshUnreadCount();
        if (this._notificationPanel && this._notificationPanel.style.display === 'block') {
          await this._loadAndRenderNotifications();
        }
      })
      .subscribe();
  },

  async _refreshUnreadCount() {
    const count = await this.getUnreadCount();
    if (!this._unreadBadge) return;
    if (count > 0) {
      this._unreadBadge.style.display = 'inline-flex';
      this._unreadBadge.textContent = count;
    } else {
      this._unreadBadge.style.display = 'none';
    }
  },

  async _loadAndRenderNotifications() {
    const notifications = await this.fetchNotifications({ limit: 20 });
    this._renderNotifications(notifications);
  },

  _renderNotificationWidget(options = {}) {
    if (this._notificationRoot) return;

    this._injectStyles();

    const root = document.createElement('div');
    root.id = 'techTitansNotificationRoot';
    root.className = 'tt-notification-root';

    const button = document.createElement('button');
    button.id = 'techTitansNotificationBell';
    button.type = 'button';
    button.innerHTML = '🔔 <span>Notifications</span>';

    const badge = document.createElement('span');
    badge.id = 'techTitansNotificationBadge';
    badge.textContent = '0';
    badge.style.display = 'none';
    button.appendChild(badge);

    const panel = document.createElement('div');
    panel.id = 'techTitansNotificationPanel';
    panel.innerHTML = `
      <div class="tt-notification-panel-header">
        <div>
          <strong>Notifications</strong>
          <div class="tt-notification-panel-subtitle">Recent activity for your account</div>
        </div>
        <button id="techTitansNotificationsMarkAll" type="button">Mark all read</button>
      </div>
      <div id="techTitansNotificationList" class="tt-notification-list">
        <div class="tt-notification-empty">Loading notifications...</div>
      </div>
    `;

    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (panel.style.display === 'block') {
        panel.style.display = 'none';
        return;
      }
      panel.style.display = 'block';
      await this._loadAndRenderNotifications();
    });

    const markAllButton = panel.querySelector('#techTitansNotificationsMarkAll');
    markAllButton.addEventListener('click', async () => {
      await this.markAllRead();
    });

    root.appendChild(button);
    root.appendChild(panel);

    const container = this._findNotificationHost();
    if (container) {
      container.appendChild(root);
    } else {
      root.style.position = 'fixed';
      root.style.top = '1rem';
      root.style.right = '1rem';
      document.body.appendChild(root);
    }

    this._notificationRoot = root;
    this._notificationPanel = panel;
    this._unreadBadge = badge;

    document.addEventListener('click', (event) => {
      if (!root.contains(event.target) && panel.style.display === 'block') {
        panel.style.display = 'none';
      }
    });
  },

  _findNotificationHost() {
    const topBar = document.querySelector('.top-bar');
    if (topBar) return topBar;

    const chatHeader = document.querySelector('.chat-header');
    if (chatHeader) return chatHeader;

    const pageHeader = document.querySelector('header');
    if (pageHeader) return pageHeader;

    return null;
  },

  _renderNotifications(notifications) {
    if (!this._notificationPanel) return;
    const list = this._notificationPanel.querySelector('#techTitansNotificationList');
    if (!list) return;

    if (!notifications || notifications.length === 0) {
      list.innerHTML = '<div class="tt-notification-empty">No new notifications yet.</div>';
      return;
    }

    list.innerHTML = notifications.map((notification) => {
      const time = new Date(notification.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const bodyText = notification.body ? `<div class="tt-notification-body">${this._escapeHtml(notification.body)}</div>` : '';
      return `
        <div class="tt-notification-item ${notification.is_read ? 'read' : 'unread'}" data-notification-id="${notification.id}" data-notification-url="${this._escapeHtml(notification.data?.url || '')}">
          <div class="tt-notification-content">
            <div class="tt-notification-title">${this._escapeHtml(notification.title)}</div>
            ${bodyText}
          </div>
          <div class="tt-notification-meta">
            <span>${time}</span>
            ${notification.is_read ? '' : '<span class="tt-notification-dot"></span>'}
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.tt-notification-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const notificationId = item.dataset.notificationId;
        const notificationUrl = item.dataset.notificationUrl;
        await this.markNotificationRead(notificationId);
        if (notificationUrl) {
          window.location.href = notificationUrl;
        }
      });
    });
  },

  _injectStyles() {
    if (document.getElementById('techTitansNotificationStyles')) return;

    const style = document.createElement('style');
    style.id = 'techTitansNotificationStyles';
    style.textContent = `
      .tt-notification-root { position: relative; font-family: Inter, system-ui, sans-serif; }
      #techTitansNotificationBell { display: inline-flex; align-items: center; gap: 0.5rem; border: 1px solid rgba(255,255,255,0.12); background: rgba(12,18,32,0.88); color: #eef2fb; border-radius: 999px; padding: 0.8rem 1rem; cursor: pointer; transition: background 0.2s ease, transform 0.2s ease; }
      #techTitansNotificationBell:hover { background: rgba(66,140,255,0.16); }
      #techTitansNotificationBell span { font-size: 0.95rem; font-weight: 600; }
      #techTitansNotificationBadge { min-width: 20px; display: inline-flex; justify-content: center; align-items: center; border-radius: 999px; background: #ff4d4d; color: #fff; font-size: 0.75rem; padding: 0.15rem 0.45rem; margin-left: 0.5rem; }
      #techTitansNotificationPanel { position: absolute; top: calc(100% + 0.75rem); right: 0; width: min(360px, calc(100vw - 2rem)); max-height: 420px; overflow-y: auto; background: rgba(5, 12, 24, 0.98); border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 20px 50px rgba(0,0,0,0.35); border-radius: 1rem; padding: 1rem; display: none; z-index: 9999; backdrop-filter: blur(18px); }
      .tt-notification-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
      .tt-notification-panel-header strong { display: block; font-size: 1rem; margin-bottom: 0.2rem; }
      .tt-notification-panel-subtitle { color: #9aa4bf; font-size: 0.8rem; }
      #techTitansNotificationsMarkAll { background: transparent; border: 1px solid rgba(255,255,255,0.14); color: #eef2fb; border-radius: 999px; padding: 0.45rem 0.75rem; cursor: pointer; font-size: 0.8rem; }
      #techTitansNotificationsMarkAll:hover { background: rgba(255,255,255,0.06); }
      .tt-notification-list { display: grid; gap: 0.75rem; }
      .tt-notification-item { border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); border-radius: 1rem; padding: 0.9rem; cursor: pointer; transition: transform 0.2s ease, background 0.2s ease; }
      .tt-notification-item:hover { transform: translateY(-1px); background: rgba(66,140,255,0.08); }
      .tt-notification-item.unread { box-shadow: inset 3px 0 0 0 #428cff; }
      .tt-notification-content { display: grid; gap: 0.35rem; }
      .tt-notification-title { font-weight: 700; font-size: 0.95rem; color: #eef2fb; }
      .tt-notification-body { color: #c8d0e7; font-size: 0.88rem; line-height: 1.45; }
      .tt-notification-meta { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; color: #8f9cc9; font-size: 0.75rem; margin-top: 0.5rem; }
      .tt-notification-dot { width: 8px; height: 8px; border-radius: 50%; background: #38d7a8; display: inline-block; }
      .tt-notification-empty { padding: 2rem 1rem; color: #9aa4bf; text-align: center; font-size: 0.9rem; }
      @media (max-width: 640px) { #techTitansNotificationPanel { width: calc(100vw - 1.5rem); right: 0.75rem; left: 0.75rem; } }
    `;
    document.head.appendChild(style);
  },

  _escapeHtml(value) {
    if (!value) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  _detectDeviceType() {
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return 'mobile';
    return 'desktop';
  },

  _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
};

if (window.location.pathname.includes('dashboard.html') ||
    window.location.pathname.includes('dm.html') ||
    window.location.pathname.includes('messages.html')) {
  document.addEventListener('click', () => {
    if (Notification.permission === 'default') {
      TechTitansNotifications.requestPermission();
    }
  }, { once: true });
}

window.TechTitansNotifications = TechTitansNotifications;
